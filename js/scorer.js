/**
 * scorer.js — LEXICON Wordle Solver
 *
 * Responsible for:
 *   1. Scoring each vocabulary word by expected residual candidate count
 *   2. Ranking all vocabulary words and returning the top N
 *   3. Normalising scores to percentages relative to the best guess
 *
 * Scoring model — Expected Residual Count:
 *   For a guess g and current candidate set C, partition C by the pattern
 *   each candidate would produce: B(g,p) = {c ∈ C : pattern(g,c) = p}.
 *
 *   E[residual | g] = Σ P(p) × |B(g,p)|
 *                   = Σ (|B(g,p)|² / |C|)
 *                   = sumOfSquares(buckets) / |C|
 *
 *   Lower score = fewer expected remaining candidates = better guess.
 *   Minimum possible score is 1.0 (guess always uniquely identifies the answer).
 *
 * Why not Shannon entropy?
 *   Entropy maximisation minimises uncertainty (bits). Residual minimisation
 *   directly minimises expected work remaining. In late-game scenarios where
 *   |C| < 10, residual minimisation more reliably picks the guess that resolves
 *   the game in one additional move. The two objectives diverge most when
 *   bucket sizes are uneven.
 *
 * This module is stateless between calls. It requires setScorer() to be called
 * once before use (by matrix_loader.js in production, or by tests directly).
 */


// ─── Module-level injected state ──────────────────────────────────
// Set once at startup via setScorer(). Not exported — callers use the API.

let _patternMatrix = null;  // Uint8Array — shared with filter.js
let _answerSize    = 0;     // number of answer words (matrix column stride)
let _vocabulary    = [];    // string[] — all valid guess words
let _answers       = [];
let _answerSet     = null;  // Set<number> — answer indices within VOCABULARY

/**
 * Inject the vocabulary and matrix needed for scoring.
 * Called by matrix_loader.js after loading; called directly by tests.
 *
 * @param {Uint8Array} matrix     - Flat VOCAB_SIZE × ANSWER_SIZE pattern matrix
 * @param {number}     answerSize - Number of answer words (column stride)
 * @param {string[]}   vocabulary - All valid guess words (VOCABULARY array)
 * @param {Set<number>} answerSet - Set of VOCABULARY indices that are valid answers
 */
export function setScorer(matrix, answerSize, vocabulary, answers, answerSet) {
  _patternMatrix = matrix;
  _answerSize    = answerSize;
  _vocabulary    = vocabulary;
  _answers       = answers;    // ← ADD THIS LINE
  _answerSet     = answerSet;
}

/**
 * Internal matrix lookup. Identical access pattern to filter.js getPattern().
 * Row-major: row = guessIdx, column = answerIdx.
 */
function getPattern(guessIdx, answerIdx) {
  return _patternMatrix[guessIdx * _answerSize + answerIdx];
}


// ─── Public API ───────────────────────────────────────────────────

/**
 * Score a single guess against the current candidate set.
 *
 * Computes expected residual candidate count using the sum-of-squares formula:
 *   E[residual] = Σ bucket[p]² / |candidates|
 *
 * Uses Uint16Array for bucket counting — avoids GC pressure on the inner loop
 * and safely holds counts up to 65535 (well above ANSWER_SIZE of 2315).
 *
 * Complexity: O(|candidates|) per call.
 *
 * @param {number}   guessIdx   - VOCABULARY index of the guess word
 * @param {number[]} candidates - Current candidate answer indices
 * @returns {number}              Expected residual count (lower = better)
 */
export function scoreGuess(guessIdx, candidates) {
  if (candidates.length === 0) return 0;

  const buckets = new Uint16Array(243); // patterns 0..242
  for (let i = 0; i < candidates.length; i++) {
    buckets[getPattern(guessIdx, candidates[i])]++;
  }

  let sumSq = 0;
  for (let p = 0; p < 242; p++) {           // 242 excluded — win bucket not residual
    sumSq += buckets[p] * buckets[p];
  }
  // Subtract win bucket to credit immediate-solve probability.
  // Makes non-candidate perfect-partitioners tie with candidate words
  // at the same true game-tree expectation, allowing FR-13 to fire.
  return (sumSq - buckets[242]) / candidates.length;
}

/**
 * Rank all vocabulary words by their score against the current candidate set.
 * Returns the top n recommendations, sorted best-first.
 *
 * Tie-breaking order (per PRD FR-13/FR-14):
 *   1. Score ascending  (lower residual = better)
 *   2. isCandidate descending  (prefer words still in the answer pool)
 *   3. vocabIndex ascending  (stable deterministic ordering)
 *
 * @param {number[]} candidates - Current candidate answer indices
 * @param {number}   [n=5]      - Number of recommendations to return
 * @returns {Recommendation[]}    Top n recommendations, normalised
 */
export function rankGuesses(candidates, n = 5) {
  const candidateWords = new Set(candidates.map(ai => _answers[ai]));

  const recs = [];
  for (let gi = 0; gi < _vocabulary.length; gi++) {
    recs.push({
      word:        _vocabulary[gi],
      vocabIndex:  gi,
      score:       scoreGuess(gi, candidates),
      pct:         0,
      isCandidate: candidateWords.has(_vocabulary[gi]),
    });
  }
  recs.sort((a, b) => {
    if (a.score !== b.score) return a.score - b.score;
    if (a.isCandidate !== b.isCandidate) return b.isCandidate - a.isCandidate;
    return a.vocabIndex - b.vocabIndex;
  });
  return normaliseScores(recs.slice(0, n));
}

/**
 * Normalise score fields to percentages relative to the best (lowest) score.
 *
 * Formula: pct = round((bestScore / rec.score) * 100)
 * The best guess always receives pct = 100.
 * A guess with twice the residual receives pct = 50.
 *
 * Mutates the pct field of each Recommendation in-place and returns the array.
 *
 * @param {Recommendation[]} recs - Array sorted best-first (recs[0] is best)
 * @returns {Recommendation[]}      Same array with pct fields populated
 */
export function normaliseScores(recs) {
  if (recs.length === 0) return recs;
  const bestScore = recs[0].score;
  for (const rec of recs) {
    rec.pct = bestScore === 0
      ? 100
      : Math.round((bestScore / rec.score) * 100);
  }
  return recs;
}
