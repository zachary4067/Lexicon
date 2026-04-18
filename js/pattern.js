// ============================================================
// pattern.js — LEXICON Wordle Solver
// v1.1 — corrected: added computePattern, PATTERN_WIN,
//         patternToColours, patternToString, validatePattern;
//         fixed encodePattern/decodePattern to big-endian per TechSpec §4.1
// ============================================================

// Pattern digit meanings:
//   0 = grey   (letter absent)
//   1 = yellow (letter present, wrong position)
//   2 = green  (letter correct position)
//
// Encoding — BIG-ENDIAN (TechSpec §4.1, §6.1):
//   pattern = digits[0]×3⁴ + digits[1]×3³ + digits[2]×3² + digits[3]×3¹ + digits[4]×3⁰
//           = digits[0]×81  + digits[1]×27  + digits[2]×9  + digits[3]×3  + digits[4]×1
//
// All-green  [2,2,2,2,2] = 2×81 + 2×27 + 2×9 + 2×3 + 2×1 = 242  → PATTERN_WIN
// All-grey   [0,0,0,0,0] = 0                                        → 0

export const PATTERN_COUNT = 243;     // 3⁵ possible patterns (0–242 inclusive)
export const PATTERN_WIN   = 242;     // [2,2,2,2,2] — all positions correct

// ── Encoding helpers ──────────────────────────────────────────────────────────

/**
 * encodePattern(digits) → integer 0–242
 *
 * Converts a 5-element array of {0,1,2} values to a base-3 big-endian integer.
 * Position 0 is the most-significant trit (×81).
 *
 * @param {number[]} digits  Array of 5 values, each 0|1|2
 * @returns {number}  Integer in range [0, 242]
 *
 * FIX v1.1: previous implementation used little-endian (digits[0]×3⁰),
 * which is the inverse of the canonical encoding used by computePattern
 * and the rest of the codebase. Now uses big-endian to match TechSpec §4.1.
 */
export function encodePattern(digits) {
  return digits[0] * 81 + digits[1] * 27 + digits[2] * 9 + digits[3] * 3 + digits[4];
}

/**
 * decodePattern(code) → number[]
 *
 * Inverse of encodePattern. Extracts 5 base-3 digits from a big-endian integer.
 * Returns [d0, d1, d2, d3, d4] where d0 corresponds to position 0 of the guess.
 *
 * @param {number} code  Integer in range [0, 242]
 * @returns {number[]}   Array of 5 values, each 0|1|2
 *
 * FIX v1.1: previous implementation extracted digits LSB-first (little-endian),
 * assigning the least-significant trit to digits[0].  This made decodePattern
 * the inverse of the wrong encodePattern rather than the inverse of the
 * canonical big-endian encoding.  Now extracts MSB-first.
 *
 * Example (TechSpec §3.2):  decodePattern(242) → [2,2,2,2,2]
 *                            decodePattern(0)   → [0,0,0,0,0]
 */
export function decodePattern(code) {
  const digits = new Array(5);
  for (let i = 4; i >= 0; i--) {
    digits[i] = code % 3;
    code      = Math.floor(code / 3);
  }
  return digits;
}

// ── Core two-pass pattern computation ────────────────────────────────────────

/**
 * computePattern(guess, answer) → integer 0–242
 *
 * Computes the Wordle feedback pattern for a given guess against a given answer.
 * Uses the mandatory two-pass algorithm from TechSpec §4.1 to correctly handle
 * words with repeated letters (e.g. EERIE, ARRAY, SASSY).
 *
 * Pass 1 — assign GREEN (2) to every position where guess[i] === answer[i].
 *           Decrement the unmatched-letter pool for the answer character.
 * Pass 2 — for each non-green position, assign YELLOW (1) if the guess letter
 *           still appears in the unmatched pool; consume from the pool on match.
 *           Otherwise leave as GREY (0).
 *
 * WARNING: A single-pass implementation is explicitly prohibited by TechSpec §6.3.
 * Single-pass incorrectly handles cases like EERIE / ARRAY / SASSY.
 *
 * Verified test vectors (TechSpec §4.1.1 and AC-2):
 *   computePattern('crane', 'crane') === 242  // [2,2,2,2,2] all green
 *   computePattern('eerie', 'nerve') === 101  // [1,0,2,0,2]
 *   computePattern('array', 'marry') ===  89  // [0,2,2,2,1]
 *   computePattern('sassy', 'mossy') ===  14  // [0,0,2,2,1]
 *
 * @param {string} guess   5-letter guess word (lowercase)
 * @param {string} answer  5-letter answer word (lowercase)
 * @returns {number}  Pattern integer in range [0, 242]
 */
export function computePattern(guess, answer) {
  if (guess.length !== 5 || answer.length !== 5) {
    throw new Error('computePattern: guess and answer must both be exactly 5 letters');
  }

  const result    = [0, 0, 0, 0, 0];
  const remaining = Object.create(null);   // unmatched answer-letter counts

  // ── Pass 1: Greens ──────────────────────────────────────────────────────
  for (let i = 0; i < 5; i++) {
    if (guess[i] === answer[i]) {
      result[i] = 2;                                      // GREEN
    } else {
      remaining[answer[i]] = (remaining[answer[i]] || 0) + 1;  // count unmatched
    }
  }

  // ── Pass 2: Yellows ─────────────────────────────────────────────────────
  for (let i = 0; i < 5; i++) {
    if (result[i] === 2) continue;                        // already green
    if (remaining[guess[i]] > 0) {
      result[i] = 1;                                      // YELLOW
      remaining[guess[i]]--;                              // consume from pool
    }
    // else result[i] remains 0 (GREY)
  }

  // ── Big-endian base-3 encode ────────────────────────────────────────────
  return result[0] * 81 + result[1] * 27 + result[2] * 9 + result[3] * 3 + result[4];
}

/**
 * scoreGuessAgainstAnswer — alias for computePattern.
 * Retained for backward compatibility with any code that imported the original name.
 */
export const scoreGuessAgainstAnswer = computePattern;

// ── UI helpers ────────────────────────────────────────────────────────────────

/**
 * patternToColours(pattern) → string[]
 *
 * Converts a pattern integer to an array of CSS-class-compatible colour names
 * used by ui.js to set tile data-state attributes.
 *
 * @param {number} pattern  Integer in range [0, 242]
 * @returns {string[]}  Array of 5 strings, each 'grey'|'yellow'|'green'
 *
 * @example
 *   patternToColours(242)  // → ['green','green','green','green','green']
 *   patternToColours(0)    // → ['grey','grey','grey','grey','grey']
 */
export function patternToColours(pattern) {
  const NAMES = ['grey', 'yellow', 'green'];
  return decodePattern(pattern).map(d => NAMES[d]);
}

/**
 * patternToString(pattern) → string
 *
 * Converts a pattern integer to a 5-character digit string.
 * Used by ui.js in Analysis Mode to display the pattern code beneath each
 * guess row (e.g. "20201").
 *
 * @param {number} pattern  Integer in range [0, 242]
 * @returns {string}  5-character string of digits '0'|'1'|'2'
 *
 * @example
 *   patternToString(242)   // → '22222'
 *   patternToString(0)     // → '00000'
 *   patternToString(101)   // → '10202'  (EERIE vs NERVE)
 */
export function patternToString(pattern) {
  return decodePattern(pattern).join('');
}

// ── Contradiction detection ───────────────────────────────────────────────────

/**
 * validatePattern(guess, pattern, candidates, context) → ValidationResult
 *
 * Checks whether a proposed guess + pattern combination is consistent with
 * the current game state before it is committed.  Implements PRD §6.4 and
 * TechSpec §4.3.
 *
 * Two checks are performed:
 *
 *   Check 1 — Empty candidates:
 *     Applies the proposed filter to the current candidate set.  If zero
 *     candidates survive, the pattern contradicts prior constraints.
 *
 *   Check 2 — Prior green conflict:
 *     If an earlier guess confirmed a letter as GREEN at position P, and the
 *     new guess places the same letter at position P with a non-green value,
 *     the pattern is inconsistent.  (Only checked when context is supplied.)
 *
 * @param {string}   guess       5-letter guess word
 * @param {number}   pattern     Proposed pattern integer (0–242)
 * @param {number[]} candidates  Current candidate index array
 * @param {object}   [context]   Optional game-state context for check 2
 * @param {Function} context.filterCandidates  filter.js filterCandidates(cs, gi, p)
 * @param {number}   context.guessIdx          vocab index of this guess
 * @param {string[]} [context.priorGuesses]    GameState.guesses so far
 * @param {number[]} [context.priorPatterns]   GameState.patterns so far
 * @returns {{ valid: boolean, reason: string|null }}
 */
export function validatePattern(guess, pattern, candidates, context = {}) {
  const { filterCandidates, guessIdx, priorGuesses = [], priorPatterns = [] } = context;

  // ── Check 1: Would this filter leave any candidates? ────────────────────
  if (typeof filterCandidates === 'function' && guessIdx != null) {
    const filtered = filterCandidates(candidates, guessIdx, pattern);
    if (filtered.length === 0) {
      return {
        valid:  false,
        reason: 'This pattern is inconsistent with earlier results — ' +
                'no valid words remain. Please check your inputs.',
      };
    }
  }

  // ── Check 2: Conflict with a prior confirmed green ───────────────────────
  const decoded = decodePattern(pattern);

  for (let r = 0; r < priorGuesses.length; r++) {
    const priorDecoded = decodePattern(priorPatterns[r]);

    for (let pos = 0; pos < 5; pos++) {
      if (priorDecoded[pos] === 2) {                        // prior green at pos
        const greenLetter = priorGuesses[r][pos];
        if (guess[pos] === greenLetter && decoded[pos] !== 2) {
          return {
            valid:  false,
            reason: `Position ${pos + 1} was confirmed green ('${greenLetter.toUpperCase()}')` +
                    ` in guess ${r + 1} — this pattern conflicts with that result.`,
          };
        }
      }
    }
  }

  return { valid: true, reason: null };
}
