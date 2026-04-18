/**
 * words.js — LEXICON Wordle Solver
 *
 * Responsible for:
 *   1. Exporting the immutable ANSWERS and VOCABULARY arrays
 *   2. Building O(1) index maps for word → index lookups
 *   3. Computing a VERSION_HASH that detects word-list changes
 *   4. Validating word list integrity at module load time
 *
 * Data layout:
 *   ANSWERS    — 2,314 valid answer words, indices 0..ANSWER_SIZE-1
 *   VOCABULARY — 12,971 total words: ANSWERS first, then extra allowed guesses
 *                Answer words occupy VOCABULARY indices 0..ANSWER_SIZE-1
 *                This means answerIndex(w) === vocabIndex(w) for all answer words.
 *
 * VERSION_HASH:
 *   A 16-character hex prefix of the SHA-256 of the serialised word lists.
 *   Used by matrix_loader.js to detect stale cached matrices.
 *   Computed asynchronously via Web Crypto (SubtleCrypto.digest).
 *   Await wordsReady before using VERSION_HASH.
 *
 * Immutability guarantee:
 *   Word ordering must never change after release — the pattern matrix
 *   is indexed by position. Any change requires cache invalidation.
 *   Both arrays are frozen at module load.
 *
 * This module is side-effect free apart from the index map construction
 * and the async hash computation, both of which run once at import time.
 */

import { ANSWERS   } from '../data/answers.js';
import { VOCABULARY } from '../data/vocabulary.js';

// Re-export so consumers only need to import from words.js
export { ANSWERS, VOCABULARY };


// ─── Sizes ────────────────────────────────────────────────────────

/** Number of valid answer words. Used as the matrix column stride. */
export const ANSWER_SIZE = ANSWERS.length;

/** Total number of valid guess words. Used as the matrix row count. */
export const VOCAB_SIZE = VOCABULARY.length;


// ─── Index Maps ───────────────────────────────────────────────────

/**
 * Maps each answer word to its index in ANSWERS[].
 * For answer words this equals their VOCABULARY index.
 * @type {Map<string, number>}
 */
export const answerIndex = new Map(ANSWERS.map((w, i) => [w, i]));

/**
 * Maps every valid guess word to its index in VOCABULARY[].
 * O(1) lookup used by solver.js and validatePattern().
 * @type {Map<string, number>}
 */
export const vocabIndex = new Map(VOCABULARY.map((w, i) => [w, i]));


// ─── Validation (runs once at module load) ────────────────────────

(function validate() {
  // Every answer must appear in VOCABULARY at the same index
  for (let i = 0; i < ANSWERS.length; i++) {
    const w = ANSWERS[i];
    if (VOCABULARY[i] !== w) {
      throw new Error(
        `words.js: VOCABULARY[${i}] is '${VOCABULARY[i]}' but ANSWERS[${i}] is '${w}'. ` +
        'Answer words must occupy VOCABULARY indices 0..ANSWER_SIZE-1.'
      );
    }
    if (!vocabIndex.has(w)) {
      throw new Error(`words.js: answer word '${w}' is missing from VOCABULARY.`);
    }
  }

  // No duplicates in VOCABULARY
  if (vocabIndex.size !== VOCABULARY.length) {
    throw new Error(
      `words.js: VOCABULARY contains duplicates. ` +
      `Expected ${VOCABULARY.length} unique words, index has ${vocabIndex.size}.`
    );
  }

  // All words are 5-letter lowercase ASCII
  for (const w of VOCABULARY) {
    if (w.length !== 5 || !/^[a-z]+$/.test(w)) {
      throw new Error(`words.js: invalid word '${w}' in VOCABULARY (must be 5 lowercase letters).`);
    }
  }
})();


// ─── Public helpers ───────────────────────────────────────────────

/**
 * Returns true if the word is a valid guess (present in VOCABULARY).
 * O(1) via vocabIndex Map.
 *
 * @param {string} word
 * @returns {boolean}
 */
export function isValidGuess(word) {
  return vocabIndex.has(word);
}

/**
 * Returns true if the word is a valid answer (present in ANSWERS).
 * O(1) via answerIndex Map.
 *
 * @param {string} word
 * @returns {boolean}
 */
export function isValidAnswer(word) {
  return answerIndex.has(word);
}


// ─── Version Hash ─────────────────────────────────────────────────

/**
 * 16-character hex prefix of SHA-256 over the serialised word lists.
 * Set by the async hash computation below; read after awaiting wordsReady.
 *
 * @type {string}
 */
export let VERSION_HASH = '';

/**
 * Resolves when VERSION_HASH is populated.
 * matrix_loader.js must await this before comparing hashes.
 *
 * @type {Promise<void>}
 */
export const wordsReady = (async () => {
  // Serialise both lists into a single deterministic string.
  // The pipe separator prevents list-boundary ambiguity.
  const payload = JSON.stringify([...VOCABULARY, '|', ...ANSWERS]);
  const encoded = new TextEncoder().encode(payload);

  let hashHex;
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    // Browser / Node 19+ (globalThis.crypto)
    const hashBuf = await crypto.subtle.digest('SHA-256', encoded);
    hashHex = Array.from(new Uint8Array(hashBuf))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  } else {
    // Node 18 — use built-in crypto module
    const { createHash } = await import('node:crypto');
    hashHex = createHash('sha256').update(payload).digest('hex');
  }

  VERSION_HASH = hashHex.slice(0, 16);
})();


// ─── Freeze exported arrays ───────────────────────────────────────
// Prevent accidental mutation of the word lists at runtime.
Object.freeze(ANSWERS);
Object.freeze(VOCABULARY);
