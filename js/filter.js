/**
 * filter.js — LEXICON Wordle Solver
 *
 * Responsible for:
 *   1. Initialising the full candidate set at game start
 *   2. Filtering candidates by pattern after each guess (non-mutating)
 *   3. Snapshotting candidate state for undo support
 *
 * Depends on:
 *   - patternMatrix: Uint8Array set by matrix_loader.js before any filtering
 *   - ANSWER_SIZE:   number of valid answers (column stride of the matrix)
 *
 * Design contract:
 *   filterCandidates() is intentionally non-mutating. It returns a new array
 *   and never modifies the input. The caller (solver.js) is responsible for:
 *     1. Pushing snapshotCandidates(current) onto undoStack BEFORE filtering
 *     2. Replacing GameState.candidates with the returned array
 *
 * This module is stateless. It holds no references to GameState.
 */


// ─── Module-level matrix reference ───────────────────────────────
// Set once by matrix_loader.js via setMatrix() before any game logic runs.
// Exported for testing — tests inject a small hand-built matrix directly.

let _patternMatrix = null;
let _answerSize    = 0;

/**
 * Inject the loaded pattern matrix. Called by matrix_loader.js on startup.
 *
 * @param {Uint8Array} matrix     - Flat VOCAB_SIZE × ANSWER_SIZE pattern matrix
 * @param {number}     answerSize - Number of answer words (column stride)
 */
export function setMatrix(matrix, answerSize) {
  _patternMatrix = matrix;
  _answerSize    = answerSize;
}

/**
 * Look up the precomputed pattern for a (guessIdx, answerIdx) pair.
 * Internal helper — not exported.
 *
 * @param {number} guessIdx  - Row index into VOCABULARY
 * @param {number} answerIdx - Column index into ANSWERS
 * @returns {number}           Pattern integer 0–242
 */
function getPattern(guessIdx, answerIdx) {
  return _patternMatrix[guessIdx * _answerSize + answerIdx];
}


// ─── Public API ───────────────────────────────────────────────────

/**
 * Initialise the full candidate set.
 * Returns an array of every answer index: [0, 1, 2, ..., ANSWER_SIZE-1].
 * Called by solver.js at the start of each game.
 *
 * @param {number} [answerSize] - Override for testing; defaults to module _answerSize
 * @returns {number[]}
 */
export function initCandidates(answerSize) {
  const size = answerSize ?? _answerSize;
  return Array.from({ length: size }, (_, i) => i);
}

/**
 * Filter the current candidate set by a (guess, pattern) observation.
 *
 * Retains only those candidate answer indices where the precomputed
 * pattern for (guessIdx, answerIdx) matches the observed pattern exactly.
 *
 * Complexity: O(|candidates|) — one matrix lookup per candidate.
 * By round 2, |candidates| is typically 100–400, making this fast.
 *
 * @param {number[]} candidates - Current candidate answer indices
 * @param {number}   guessIdx   - VOCABULARY index of the guess word
 * @param {number}   pattern    - Observed pattern integer 0–242
 * @returns {number[]}            New filtered array (input is NOT mutated)
 *
 * @example
 *   // After guessing 'crane' against a 5-word mini-vocabulary:
 *   const next = filterCandidates([0,1,2,3,4], craneIdx, 47); // XYGXG
 *   // next contains only answer indices whose pattern vs crane === 47
 */
export function filterCandidates(candidates, guessIdx, pattern) {
  const next = [];
  for (let i = 0; i < candidates.length; i++) {
    if (getPattern(guessIdx, candidates[i]) === pattern) {
      next.push(candidates[i]);
    }
  }
  return next;
}

/**
 * Snapshot the current candidate set for undo support.
 * Returns a shallow copy — sufficient because candidates are plain integers.
 *
 * Called by solver.js immediately before filterCandidates() so the prior
 * state can be restored by undoLastGuess().
 *
 * @param {number[]} candidates - Current candidate array
 * @returns {number[]}            Independent copy
 */
export function snapshotCandidates(candidates) {
  return candidates.slice();
}
