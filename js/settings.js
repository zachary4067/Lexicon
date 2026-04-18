/**
 * settings.js — LEXICON Settings Management
 * v1.0
 *
 * Standalone module for persisted user preferences.
 * Settings are stored in sessionStorage under 'lexicon-settings'.
 * Visual changes are applied by toggling CSS classes on document.body;
 * the actual colour values are owned by ui.js CSS_VARS and styles.css.
 *
 * Public API  (TechSpec §3.9):
 *   loadSettings()          → SettingsState
 *   saveSettings(state)     → void
 *   applyMode(mode)         → void
 *   applyColourBlind(on)    → void
 *   defaultSettings()       → SettingsState
 *   loadAndApplySettings()  → SettingsState   [convenience]
 *
 * Storage key  : 'lexicon-settings'  (sessionStorage)
 * Body classes : 'analysis-mode'     (applyMode)
 *                'colour-blind'      (applyColourBlind)
 *
 * PRD refs: §4.1 (Dual-Mode UI), §9.4 (Settings Panel), §9.5 ACC-1
 * TechSpec refs: §2.1.5 (SettingsState), §3.9, §6.5 (CSS vars)
 */

// ═══════════════════════════════════════════════════════════════════
// STORAGE KEY
// ═══════════════════════════════════════════════════════════════════

/** sessionStorage key for serialised SettingsState. */
export const SETTINGS_KEY = 'lexicon-settings';

// ═══════════════════════════════════════════════════════════════════
// DEFAULT STATE  (TechSpec §2.1.5)
// ═══════════════════════════════════════════════════════════════════

/**
 * Returns a fresh SettingsState with all factory defaults.
 * Called when no persisted settings exist, or as a merge base
 * to handle forward-compatibility with newly added keys.
 *
 * @returns {SettingsState}
 */
export function defaultSettings() {
  return {
    /** UI density mode.
     *  'simple'   — casual users; best guess only, low information density.
     *  'analysis' — power users; top-5 alts, scores, candidate list visible.
     *  PRD §4.1 */
    mode: 'simple',

    /** Deuteranopia-safe palette: replaces green→blue, yellow→orange.
     *  PRD §9.5 ACC-1; TechSpec §6.5
     *  false → { green: #538D4E, yellow: #B59F3B }
     *  true  → { green: #1565C0, yellow: #E65100 } */
    colourBlind: false,

    /** Show percentage scores on alternative guesses.
     *  Forced true in analysis mode; optional in simple mode.
     *  PRD §9.4 */
    showScores: false,

    /** Restrict guesses to words consistent with known constraints.
     *  TechSpec §3.9; PRD §9.4 */
    hardMode: false,

    /** True once the user has seen or explicitly skipped the tutorial.
     *  Controls auto-show on first launch. PRD §5.5 FR-21 */
    hasSeenTutorial: false,
  };
}

// ═══════════════════════════════════════════════════════════════════
// PERSISTENCE
// ═══════════════════════════════════════════════════════════════════

/**
 * Load settings from sessionStorage.
 *
 * Merges stored JSON with defaultSettings() so newly added keys always
 * have a valid value even if the stored JSON predates their addition.
 * Safe against JSON parse errors and unavailable sessionStorage.
 *
 * @returns {SettingsState}
 */
export function loadSettings() {
  try {
    const raw = sessionStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      // Spread order: defaults first, then stored values override.
      // This ensures any key not yet in storage gets its default value.
      return { ...defaultSettings(), ...parsed };
    }
  } catch (err) {
    // sessionStorage may be unavailable (private browsing with strict settings,
    // or a JSON parse error from corrupted data). Degrade silently to defaults.
    console.warn('[settings] loadSettings failed — returning defaults.', err);
  }
  return defaultSettings();
}

/**
 * Persist settings to sessionStorage and immediately apply visual state.
 *
 * Write failures (e.g. storage quota exceeded) are logged but do not
 * propagate — the in-memory state is still valid for the current session.
 *
 * @param {SettingsState} state
 */
export function saveSettings(state) {
  try {
    sessionStorage.setItem(SETTINGS_KEY, JSON.stringify(state));
  } catch (err) {
    console.warn('[settings] saveSettings failed — visual state still applied.', err);
  }
  // Apply CSS changes regardless of write success
  applyMode(state.mode);
  applyColourBlind(state.colourBlind);
}

// ═══════════════════════════════════════════════════════════════════
// CSS APPLICATION  (TechSpec §3.9, §6.5)
// ═══════════════════════════════════════════════════════════════════

/**
 * Toggle Analysis Mode by adding/removing 'analysis-mode' on document.body.
 *
 * All Analysis Mode elements are gated via CSS:
 *   body.analysis-mode .analysis-only { display: block; }
 *   body.analysis-mode #alternatives  { display: flex; }
 *   body.analysis-mode .pattern-code  { display: block; }
 *   body.analysis-mode #best-score    { display: block; }
 *
 * PRD §4.1; TechSpec §3.9 applyMode
 *
 * @param {'simple'|'analysis'} mode
 */
export function applyMode(mode) {
  if (typeof document === 'undefined') return; // guard: non-browser (test) context
  document.body.classList.toggle('analysis-mode', mode === 'analysis');
}

/**
 * Toggle colour-blind mode by adding/removing 'colour-blind' on document.body.
 *
 * The CSS class swaps two custom properties (defined in ui.js CSS_VARS
 * and mirrored in css/styles.css):
 *   .colour-blind { --colour-green: #1565C0; --colour-yellow: #E65100; }
 *
 * This accommodates deuteranopia (red-green colour blindness, ~8% of
 * male users) without changing any HTML structure.
 *
 * PRD §9.5 ACC-1; TechSpec §3.9 applyColourBlind, §10.2
 *
 * @param {boolean} on
 */
export function applyColourBlind(on) {
  if (typeof document === 'undefined') return;
  document.body.classList.toggle('colour-blind', on);
}

// ═══════════════════════════════════════════════════════════════════
// CONVENIENCE
// ═══════════════════════════════════════════════════════════════════

/**
 * Load persisted settings, apply CSS state immediately, and return
 * the active SettingsState.
 *
 * Intended for use at application startup — call once during init()
 * before the first render so mode and colour-blind class are set
 * before any DOM is painted.
 *
 * @returns {SettingsState}
 */
export function loadAndApplySettings() {
  const s = loadSettings();
  applyMode(s.mode);
  applyColourBlind(s.colourBlind);
  return s;
}

/**
 * Reset settings to factory defaults: persist the defaults and
 * re-apply CSS state. Used by a future "Reset to defaults" control.
 *
 * @returns {SettingsState} The reset state
 */
export function resetSettings() {
  const s = defaultSettings();
  saveSettings(s);
  return s;
}
