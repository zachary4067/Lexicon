/**
 * matrix_loader.js — LEXICON Wordle Solver
 *
 * Responsible for:
 *   1. Loading the pattern matrix from IndexedDB cache when available
 *   2. Falling back to buildMatrix() on cache miss or hash mismatch
 *   3. Writing newly-built matrices back to the cache
 *   4. Exposing clearCache() for developer tools and settings panel
 *
 * Cache strategy:
 *   The matrix is stored as a { hash, matrix } object under STORE_KEY in
 *   IndexedDB. On load, the stored hash is compared against VERSION_HASH
 *   (derived from the current word lists). A mismatch means the word lists
 *   changed since the matrix was cached; the matrix is rebuilt and recached.
 *
 * IndexedDB backend (injectable):
 *   idb-keyval is a browser-only library. To keep this module testable in
 *   Node.js, the cache backend is injectable via _setCache(). In production,
 *   ui.js calls _setCache() with real idb-keyval bindings immediately after
 *   importing the library. In tests, a Map-based stub is injected instead.
 *
 *   Default behaviour with no injection: cache always misses (get returns
 *   null, set/del are no-ops). This is safe — loadMatrix falls back to
 *   buildMatrix and works correctly, just without persistence.
 *
 * Production wiring (in ui.js or index.html):
 *   import { get, set, del } from 'https://cdn.jsdelivr.net/npm/idb-keyval@6/+esm';
 *   import { _setCache } from './js/matrix_loader.js';
 *   _setCache({ get, set, del });
 *
 * onProgress signature:
 *   (pct: number, phase: string) => void
 *   pct:   0–100
 *   phase: 'Loaded from cache' | 'Building word database...' | 'Ready'
 */

import { VERSION_HASH, VOCAB_SIZE, ANSWER_SIZE, wordsReady } from './words.js';
import { buildMatrix, validateMatrix } from './matrix_builder.js';


// ─── Cache Backend ────────────────────────────────────────────────

const STORE_KEY = 'matrix';

/**
 * Default no-op cache — used when no IndexedDB backend has been injected.
 * get() always returns null (cache miss), set/del are no-ops.
 * This means loadMatrix will always call buildMatrix in this state.
 */
let _cache = {
  get: async (_key)       => null,
  set: async (_key, _val) => {},
  del: async (_key)       => {},
};

/**
 * Inject a cache backend. Call this before loadMatrix().
 *
 * In production:
 *   import { get, set, del } from 'https://cdn.jsdelivr.net/npm/idb-keyval@6/+esm';
 *   _setCache({ get, set, del });
 *
 * In tests:
 *   const store = new Map();
 *   _setCache({
 *     get: async (k) => store.get(k) ?? null,
 *     set: async (k, v) => store.set(k, v),
 *     del: async (k) => store.delete(k),
 *   });
 *
 * @param {{ get: Function, set: Function, del: Function }} backend
 */
export function _setCache(backend) {
  _cache = backend;
}


// ─── Public API ───────────────────────────────────────────────────

/**
 * Load the pattern matrix, using the IndexedDB cache when possible.
 *
 * Flow:
 *   1. Await wordsReady so VERSION_HASH is populated.
 *   2. Attempt to load from cache.
 *      a. Hit + valid hash + valid dimensions → return cached matrix immediately.
 *      b. Miss or stale hash or corrupt entry → rebuild via buildMatrix().
 *   3. After rebuild: validate the matrix, store it in cache, return it.
 *
 * @param {function(number, string): void} [onProgress]
 *   Optional. Called with (pct, phase) at key points:
 *     (0,   'Building word database...')  — before build starts
 *     (N,   'Building word database...')  — during build (~every 500 rows)
 *     (100, 'Loaded from cache')          — on cache hit
 *     (100, 'Ready')                      — after successful build
 *
 * @param {object} [_opts]
 *   For testing only — overrides the word lists passed to buildMatrix().
 *   Production callers omit this parameter.
 * @param {string[]} [_opts.vocabulary]
 * @param {string[]} [_opts.answers]
 *
 * @returns {Promise<Uint8Array>}  The pattern matrix.
 * @throws  {Error}  If the built matrix fails validation.
 */
export async function loadMatrix(onProgress, _opts = {}) {
  // Must wait for VERSION_HASH to be computed from the word lists.
  await wordsReady;

  // Derive expected dimensions (may differ from module-level constants if
  // _opts injects a mini vocabulary for testing).
  const vocabSize  = _opts.vocabulary?.length ?? VOCAB_SIZE;
  const answerSize = _opts.answers?.length    ?? ANSWER_SIZE;

  // ── Attempt cache load ────────────────────────────────────────
  let cached = null;
  try {
    cached = await _cache.get(STORE_KEY);
  } catch {
    // Ignore cache read errors — treat as a miss.
  }

  if (
    cached &&
    cached.hash === VERSION_HASH &&
    cached.matrix instanceof Uint8Array &&
    cached.matrix.length === vocabSize * answerSize
  ) {
    // Cache hit — validate the matrix before trusting the data.
    const check = validateMatrix(cached.matrix, vocabSize, answerSize);
    if (check.valid) {
      onProgress?.(100, 'Loaded from cache');
      return cached.matrix;
    }
    // Corrupt or invalid cache entry — fall through to rebuild.
  }

  // ── Build matrix (cache miss, stale hash, or corrupt entry) ──
  onProgress?.(0, 'Building word database...');

  const matrix = await buildMatrix(
    pct => onProgress?.(pct, 'Building word database...'),
    _opts
  );

  // Validate before caching.
  const check = validateMatrix(matrix, vocabSize, answerSize);
  if (!check.valid) {
    throw new Error(`matrix_loader: built matrix failed validation — ${check.reason}`);
  }

  // Store in cache. Failure here is non-fatal — the matrix is still usable.
  try {
    await _cache.set(STORE_KEY, { hash: VERSION_HASH, matrix });
  } catch {
    // Cache write failure is non-fatal; the matrix still works for this session.
  }

  onProgress?.(100, 'Ready');
  return matrix;
}


/**
 * Delete the cached matrix from IndexedDB.
 * Forces a full rebuild on the next loadMatrix() call.
 * Used by developer tools and the settings panel.
 *
 * @returns {Promise<void>}
 */
export async function clearCache() {
  try {
    await _cache.del(STORE_KEY);
  } catch {
    // Ignore errors — if the key doesn't exist, that's fine.
  }
}
