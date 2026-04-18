/**
 * matrix_builder.js — LEXICON Wordle Solver
 *
 * Builds the precomputed pattern matrix used by filter.js and scorer.js.
 *
 * Matrix layout:
 *   matrix[guessIdx * ANSWER_SIZE + answerIdx] = computePattern(guess, answer)
 *   Dimensions: VOCAB_SIZE rows × ANSWER_SIZE columns
 *   Storage: Uint8Array — values 0–242 fit in uint8; total ~30 MB
 *
 * Performance contract (from tech spec §11.2):
 *   Desktop Chrome:    3–8 s
 *   iPhone 13 Safari: 8–15 s
 *   Mid-range Android: 12–25 s
 *
 * The critical constraint is the yield point every 500 rows (setTimeout 0ms).
 * This keeps the browser event loop unblocked so the loading progress bar
 * can repaint. Do NOT remove the yield — the UI will freeze on mobile.
 *
 * Dependency injection:
 *   The optional second parameter `{ vocabulary, answers }` is provided for
 *   testing only. Production callers omit it and the full word lists are used.
 *   This avoids a 3+ second test cost while still exercising the algorithm.
 */

import { VOCABULARY, ANSWERS, VOCAB_SIZE, ANSWER_SIZE } from './words.js';
import { computePattern } from './pattern.js';


/**
 * Build the full pattern matrix.
 *
 * Iterates every (guess, answer) pair in VOCABULARY × ANSWERS, encodes the
 * Wordle feedback pattern as an integer 0–242, and stores it in a flat
 * Uint8Array. Yields to the event loop every 500 rows so progress bar
 * repaints don't get blocked.
 *
 * @param {function(number): void} [onProgress]
 *   Optional callback receiving a percentage 0–100 approximately every 500
 *   rows. Called once more with 100 on completion.
 *
 * @param {object} [_opts]
 *   For testing only — overrides the word lists. Production callers omit this.
 * @param {string[]} [_opts.vocabulary=VOCABULARY]
 * @param {string[]} [_opts.answers=ANSWERS]
 *
 * @returns {Promise<Uint8Array>}
 *   Flat matrix of size vocabulary.length × answers.length.
 */
export async function buildMatrix(onProgress, _opts = {}) {
  const vocabulary = _opts.vocabulary ?? VOCABULARY;
  const answers    = _opts.answers    ?? ANSWERS;

  const vocabSize  = vocabulary.length;
  const answerSize = answers.length;
  const matrix     = new Uint8Array(vocabSize * answerSize);

  for (let gi = 0; gi < vocabSize; gi++) {
    // Fill one row — all answers against this guess word
    const base = gi * answerSize;
    for (let ai = 0; ai < answerSize; ai++) {
      matrix[base + ai] = computePattern(vocabulary[gi], answers[ai]);
    }

    // Yield and report progress every 500 rows.
    // The yield (setTimeout 0) is essential for browser UI responsiveness.
    if (gi % 500 === 0) {
      onProgress?.(Math.round((gi / vocabSize) * 100));
      await new Promise(r => setTimeout(r, 0));
    }
  }

  // Final 100% callback — always fire even if vocabSize < 500.
  onProgress?.(100);

  return matrix;
}


/**
 * Validate a completed matrix against the expected dimensions and known
 * diagonal invariant. Returns a result object rather than throwing, so
 * the caller can surface the error gracefully in the loading UI.
 *
 * Checks:
 *   1. Byte length equals vocabSize × answerSize
 *   2. All values are <= 242 (pattern values are 0–242)
 *   3. Diagonal entries equal 242 (a word guessed against itself is all-green)
 *      — only checked where VOCABULARY[i] === ANSWERS[i], i.e. the first
 *        ANSWER_SIZE rows where answers and vocabulary share indices.
 *
 * @param {Uint8Array} matrix
 * @param {number} [vocabSize=VOCAB_SIZE]
 * @param {number} [answerSize=ANSWER_SIZE]
 * @returns {{ valid: boolean, reason: string|null }}
 */
export function validateMatrix(matrix, vocabSize = VOCAB_SIZE, answerSize = ANSWER_SIZE) {
  // Check 1: byte length
  const expected = vocabSize * answerSize;
  if (matrix.length !== expected) {
    return {
      valid: false,
      reason: `Matrix size mismatch: expected ${expected} bytes ` +
              `(${vocabSize}x${answerSize}), got ${matrix.length}.`,
    };
  }

  // Check 2: value range — Uint8Array max is 255, but pattern max is 242
  for (let i = 0; i < matrix.length; i++) {
    if (matrix[i] > 242) {
      return {
        valid: false,
        reason: `Matrix contains value ${matrix[i]} at index ${i} — max is 242.`,
      };
    }
  }

  // Check 3: diagonal == 242 for answer rows
  // VOCABULARY[0..ANSWER_SIZE-1] === ANSWERS[0..ANSWER_SIZE-1]
  for (let i = 0; i < answerSize; i++) {
    const diag = matrix[i * answerSize + i];
    if (diag !== 242) {
      return {
        valid: false,
        reason: `Diagonal entry at (${i},${i}) is ${diag} — expected 242 (all-green).`,
      };
    }
  }

  return { valid: true, reason: null };
}
