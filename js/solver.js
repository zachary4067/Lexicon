/**
 * solver.js — LEXICON Wordle Solver
 *
 * Responsible for:
 *   1. Owning and managing GameState across the full game lifecycle
 *   2. Orchestrating the submitGuess → validate → snapshot → filter → rank pipeline
 *   3. Providing hardcoded opener (CRANE) to skip round-1 matrix scan
 *   4. Implementing the undo contract (one level, depth-1 stack)
 *   5. Exposing read-only state to ui.js via getSolverState()
 *
 * State management contract:
 *   - All mutable state lives in the _state object below
 *   - getSolverState() returns a frozen shallow copy — callers must not mutate it
 *   - initGame() is the only function that resets state to a clean baseline
 *   - submitGuess() is the only function that advances state
 *   - undoLastGuess() is the only function that rolls back state
 *
 * Undo contract (v1):
 *   - Only one undo level is supported
 *   - undoStack holds at most one entry (the snapshot taken before the last guess)
 *   - After undo, the stack is empty and the Undo button must be disabled
 *   - initGame() and resetGame() both clear the stack
 *
 * Dependency injection:
 *   - configure() must be called once before any other function
 *   - In production: called by matrix_loader.js after the matrix is ready
 *   - In tests: called directly with a mini vocabulary + hand-built matrix
 *
 * Error codes (matching PRD error catalogue):
 *   E-001 — guess not in vocabulary
 *   E-002 — pattern yields zero candidates (contradicts prior observations)
 *   E-003 — pattern conflicts with a prior confirmed green position
 */

import { filterCandidates, initCandidates, snapshotCandidates, setMatrix }
  from './filter.js';
import { rankGuesses, setScorer }
  from './scorer.js';
import { validatePattern, PATTERN_WIN }
  from './pattern.js';


// ─── Hardcoded opener ─────────────────────────────────────────────
// Pre-validated against the residual-minimising scoring model.
// Must be re-validated if the word list changes.
const OPENER = 'raise'; // Validated #1 of 2314 by validate_opener.js (score: 61.02 vs CRANE 78.73)


// ─── Module-level injected vocabulary ────────────────────────────
let _vocabulary  = [];       // string[]        — all valid guess words
let _vocabIndex  = new Map(); // Map<string,num> — word → VOCABULARY index
let _answerSize  = 0;        // number          — ANSWERS array length


/**
 * Inject vocabulary and matrix data. Must be called before any game function.
 *
 * @param {object}    opts
 * @param {string[]}  opts.vocabulary  - All valid guess words (VOCABULARY)
 * @param {string[]}  opts.answers     - Valid answer words (ANSWERS)
 * @param {Uint8Array} opts.matrix     - Flat VOCAB_SIZE × ANSWER_SIZE pattern matrix
 */
export function configure({ vocabulary, answers, matrix }) {
  _vocabulary = vocabulary;
  _answerSize = answers.length;

  // Build vocab index map
  _vocabIndex = new Map();
  for (let i = 0; i < vocabulary.length; i++) {
    _vocabIndex.set(vocabulary[i], i);
  }

  // Build answer set — indices within VOCABULARY that are valid answers
  const answerWords = new Set(answers);
  const answerSet   = new Set();
  for (let i = 0; i < vocabulary.length; i++) {
    if (answerWords.has(vocabulary[i])) answerSet.add(i);
  }

  // Inject into dependent modules
  setMatrix(matrix, answers.length);
  setScorer(matrix, answers.length, vocabulary, answerSet);
}


// ─── GameState ────────────────────────────────────────────────────

/**
 * Single source of truth for game session state.
 * Private — external code reads via getSolverState() only.
 */
let _state = _freshState();

function _freshState() {
  return {
    round:              1,
    guesses:            [],    // string[]
    patterns:           [],    // number[]
    candidates:         [],    // number[]  (answer indices)
    undoStack:          [],    // number[][] (depth-1 snapshots)
    solved:             false,
    failed:             false,
    lastRecommendation: null,  // Recommendation | null
  };
}

/** Empty SolverResult used as base for error returns. */
function _emptyResult(error) {
  return {
    state:           getSolverState(),
    recommendations: [],
    solved:          false,
    failed:          false,
    error:           error ?? null,
  };
}


// ─── Public API ───────────────────────────────────────────────────

/**
 * Reset game state to a clean baseline.
 * Does NOT archive history — that is onNewGame()'s responsibility.
 * Called by both Reset Game and New Game flows.
 *
 * @returns {GameState} Fresh frozen state snapshot
 */
export function initGame() {
  _state = _freshState();
  _state.candidates = initCandidates(_answerSize);
  return getSolverState();
}

/**
 * Return the hardcoded opener recommendation for Round 1.
 * No matrix scan is performed — CRANE is pre-validated.
 *
 * @returns {Recommendation}
 */
export function getOpener() {
  return {
    word:        OPENER,
    vocabIndex:  _vocabIndex.get(OPENER) ?? 0,
    score:       0,   // not computed — hardcoded opener
    pct:         100,
    isCandidate: true,
  };
}

/**
 * Submit a guess and observed pattern, advancing the game by one round.
 *
 * Pipeline:
 *   1. Validate guess is in vocabulary             → E-001
 *   2. Validate pattern against prior state        → E-002 / E-003
 *   3. Snapshot candidates for undo
 *   4. Record guess + pattern, filter candidates
 *   5. Detect terminal conditions (solved / failed)
 *   6. Rank next guesses (skipped if terminal)
 *
 * @param {string} guess   - 5-letter lowercase guess word
 * @param {number} pattern - Observed feedback pattern integer (0–242)
 * @returns {SolverResult}
 */
export function submitGuess(guess, pattern) {
  // ── 1. Vocabulary check (E-001) ───────────────────────────────
  if (!_vocabIndex.has(guess)) {
    return _emptyResult(`'${guess}' is not in the word list.`);
  }

  // ── 2. Contradiction check (E-002 / E-003) ────────────────────
  const guessIdx = _vocabIndex.get(guess);

  const validation = validatePattern({
    guess,
    pattern,
    priorGuesses:   _state.guesses,
    priorPatterns:  _state.patterns,
    candidates:     _state.candidates,
    filterFn:       filterCandidates,
    vocabIndexFn:   (w) => _vocabIndex.get(w),
  });

  if (!validation.valid) {
    return _emptyResult(validation.reason);
  }

  // ── 3. Snapshot for undo ──────────────────────────────────────
  _state.undoStack.push(snapshotCandidates(_state.candidates));
  if (_state.undoStack.length > 1) _state.undoStack.shift(); // depth-1 limit

  // ── 4. Record and filter ──────────────────────────────────────
  _state.guesses.push(guess);
  _state.patterns.push(pattern);
  _state.candidates = filterCandidates(_state.candidates, guessIdx, pattern);
  _state.round++;

  // ── 5. Terminal conditions ────────────────────────────────────
  if (pattern === PATTERN_WIN) {
    _state.solved = true;
  } else if (_state.round > 6) {
    _state.failed = true;
  }

  // ── 6. Rank next guesses ──────────────────────────────────────
  const recommendations = (_state.solved || _state.failed || _state.candidates.length === 0)
    ? []
    : rankGuesses(_state.candidates);

  if (recommendations.length > 0) {
    _state.lastRecommendation = recommendations[0];
  }

  return {
    state:           getSolverState(),
    recommendations,
    solved:          _state.solved,
    failed:          _state.failed,
    error:           null,
  };
}

/**
 * Undo the most recent guess-pattern entry.
 * Pops the undoStack, restores candidates, decrements round.
 *
 * @returns {GameState|null} Updated frozen state, or null if nothing to undo
 */
export function undoLastGuess() {
  if (_state.undoStack.length === 0) return null;

  _state.candidates = _state.undoStack.pop();
  _state.guesses.pop();
  _state.patterns.pop();
  _state.round--;
  _state.solved = false;
  _state.failed = false;
  _state.lastRecommendation = null;

  return getSolverState();
}

/**
 * Return a frozen shallow copy of current GameState.
 * Callers (ui.js) must not mutate the returned object.
 * Arrays are copied so callers can't accidentally corrupt internal state.
 *
 * @returns {Readonly<GameState>}
 */
export function getSolverState() {
  return Object.freeze({
    round:              _state.round,
    guesses:            [..._state.guesses],
    patterns:           [..._state.patterns],
    candidates:         [..._state.candidates],
    undoStack:          _state.undoStack.map(s => [...s]),
    solved:             _state.solved,
    failed:             _state.failed,
    lastRecommendation: _state.lastRecommendation
      ? { ..._state.lastRecommendation }
      : null,
  });
}
