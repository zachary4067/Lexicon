/**
* ui.js — LEXICON Wordle Solver
* v1.1  (Feature 1: clickable candidate autofill)
*
* The single source of DOM truth for the LEXICON application.
* No other module may directly mutate DOM elements.
* All UI updates flow through the render functions defined here.
*
* Architecture (unidirectional data flow):
*   User Action → ui.js event handler → solver.js / settings.js
*   → ui.js render function → Updated DOM
*
* Responsibilities:
*   1. Bootstrap: loadMatrix → configure → initGame → renderRound1
*   2. Loading / error state rendering (§6.3)
*   3. Tile tap-to-cycle interaction (§6.2)
*   4. Guess history grid (§6.1)
*   5. Recommendation and alternatives (Simple + Analysis mode)
*   6. Status bar, CTA button, Undo/Reset/New-Game controls
*   7. Settings panel: mode, colour-blind, hard mode, tutorial
*   8. Confirmation modals for destructive actions (§6.4)
*   9. Session history and stats tabs
*  10. Full ARIA labelling and keyboard navigation (§10)
*
* v1.1 change:
*   Feature 1 — Clickable candidate autofill (renderCandidateList).
*   When the remaining candidate set is ≤ CANDIDATE_CLICK_THRESHOLD (15),
*   each word chip renders as a <button> that autofills the word input and
*   syncs the tile letter faces. Above the threshold chips remain read-only
*   <span> elements (unchanged behaviour).
*
* Dependencies (ES Modules):
*   ./solver.js       — game state & recommendation engine
*   ./matrix_loader.js — matrix load / cache
*   ./pattern.js      — patternToColours, patternToString
*   ./words.js        — ANSWERS, VOCABULARY (for word list version display)
*
* IndexedDB backend:
*   Injected via _setCache() before init() is called.
*   Production entry point (index.html) loads idb-keyval then calls
*   _setCache({ get, set, del }) before importing ui.js.
*/
import {
  configure,
  initGame,
  getOpener,
  submitGuess,
  undoLastGuess,
  getSolverState,
} from './solver.js';
import { loadMatrix, _setCache } from './matrix_loader.js';
import { patternToColours, patternToString, PATTERN_WIN, decodePattern } from './pattern.js';
import { ANSWERS, VOCABULARY, ANSWER_SIZE, VOCAB_SIZE, VERSION_HASH, wordsReady } from './words.js';

// ═══════════════════════════════════════════════════════════════════
// FEATURE CONSTANTS
// ═══════════════════════════════════════════════════════════════════

/**
 * Maximum candidate-set size at which word chips become clickable autofill
 * buttons. Above this threshold chips revert to read-only display spans.
 * Not player-configurable. Change requires a code update.
 *
 * Rationale: at 16+ candidates a scrollable list of buttons is noisy and
 * offers little accuracy benefit (player should use the recommendation).
 * At ≤ 15 the set is small enough that rapid selection adds genuine value.
 */
const CANDIDATE_CLICK_THRESHOLD = 15;

// ═══════════════════════════════════════════════════════════════════
// CSS CUSTOM PROPERTIES (injected into :root at init)
// Matches TechSpec §6.5
// ═══════════════════════════════════════════════════════════════════
const CSS_VARS = `
  :root {
    /* Tile colours — swapped by applyColourBlind() */
    --colour-green:      #538D4E;
    --colour-yellow:     #B59F3B;
    --colour-grey:       #3A3A3C;
    --colour-grey-light: #818384;
    --colour-empty:      #121213;
    --colour-border:     #3A3A3C;
    /* App chrome */
    --bg-primary:    #121213;
    --bg-secondary:  #1A1A1B;
    --bg-tertiary:   #242424;
    --text-primary:  #FFFFFF;
    --text-secondary:#818384;
    --text-muted:    #565758;
    --accent:        #538D4E;
    /* Layout */
    --tile-size:    56px;
    --gap:          6px;
    --content-max:  420px;
    --header-h:     52px;
    --nav-h:        58px;
    /* Typography */
    --font-ui:    'Segoe UI', 'Helvetica Neue', Arial, sans-serif;
    --font-mono:  'Courier New', monospace;
    /* Transitions */
    --transition-fast: 80ms ease;
    --transition-med:  200ms ease;
  }
  .colour-blind {
    --colour-green:  #1565C0;
    --colour-yellow: #E65100;
  }
`;
const APP_STYLES = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html { height: 100%; }
  body {
    font-family: var(--font-ui);
    background: var(--bg-primary);
    color: var(--text-primary);
    min-height: 100%;
    display: flex;
    flex-direction: column;
    -webkit-font-smoothing: antialiased;
    user-select: none;
    overflow-x: hidden;
  }
  /* ── Loading Overlay ─────────────────────────────────────── */
  #loading-overlay {
    position: fixed;
    inset: 0;
    background: var(--bg-primary);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 20px;
    z-index: 9999;
    transition: opacity var(--transition-med);
  }
  #loading-overlay.hidden { opacity: 0; pointer-events: none; }
  #loading-logo {
    font-size: 36px;
    font-weight: 900;
    letter-spacing: 8px;
    color: var(--text-primary);
  }
  #loading-logo span { color: var(--colour-green); }
  #loading-message {
    font-size: 13px;
    color: var(--text-secondary);
    letter-spacing: 1px;
    text-transform: uppercase;
  }
  #loading-bar-wrap {
    width: 200px;
    height: 3px;
    background: var(--bg-tertiary);
    border-radius: 2px;
    overflow: hidden;
  }
  #loading-bar {
    height: 100%;
    width: 0%;
    background: var(--colour-green);
    border-radius: 2px;
    transition: width 200ms ease;
  }
  #loading-error { color: #E57373; font-size: 14px; text-align: center; max-width: 280px; }
  #loading-retry {
    margin-top: 12px;
    padding: 10px 24px;
    background: var(--colour-green);
    color: #fff;
    border: none;
    border-radius: 4px;
    font-size: 14px;
    font-weight: 700;
    letter-spacing: 1px;
    cursor: pointer;
    text-transform: uppercase;
  }
  /* ── Header ─────────────────────────────────────────────── */
  header {
    height: var(--header-h);
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 16px;
    border-bottom: 1px solid var(--colour-border);
    background: var(--bg-primary);
    position: sticky;
    top: 0;
    z-index: 100;
    flex-shrink: 0;
  }
  .header-actions { display: flex; gap: 4px; align-items: center; }
  .icon-btn {
    width: 36px;
    height: 36px;
    border: none;
    background: transparent;
    color: var(--text-primary);
    cursor: pointer;
    border-radius: 4px;
    font-size: 18px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background var(--transition-fast);
  }
  .icon-btn:hover, .icon-btn:focus-visible { background: var(--bg-tertiary); outline: none; }
  h1#app-title {
    font-size: 22px;
    font-weight: 900;
    letter-spacing: 6px;
    text-transform: uppercase;
    color: var(--text-primary);
  }
  /* ── Main content area ──────────────────────────────────── */
  main {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 12px 16px 16px;
    gap: 12px;
    max-width: var(--content-max);
    width: 100%;
    margin: 0 auto;
    min-height: 0;
  }
  /* ── Status bar ──────────────────────────────────────────── */
  #status-bar {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.5px;
    color: var(--text-secondary);
    text-transform: uppercase;
    padding: 0 2px;
  }
  #candidate-counter { color: var(--text-secondary); }
  #candidate-counter.warning { color: #E57373; }
  #guess-counter { color: var(--text-secondary); }
  /* ── Guess Grid ─────────────────────────────────────────── */
  #guess-grid {
    display: flex;
    flex-direction: column;
    gap: var(--gap);
    width: 100%;
    align-items: center;
  }
  .guess-row {
    display: flex;
    gap: var(--gap);
  }
  .guess-tile {
    width: var(--tile-size);
    height: var(--tile-size);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 20px;
    font-weight: 900;
    letter-spacing: 0;
    text-transform: uppercase;
    border: 2px solid var(--colour-border);
    border-radius: 3px;
    background: transparent;
    color: var(--text-primary);
    transition: background var(--transition-med), border-color var(--transition-med);
    flex-shrink: 0;
  }
  .guess-tile[data-state="green"]  { background: var(--colour-green);  border-color: var(--colour-green);  color: #fff; }
  .guess-tile[data-state="yellow"] { background: var(--colour-yellow); border-color: var(--colour-yellow); color: #fff; }
  .guess-tile[data-state="grey"]   { background: var(--colour-grey);   border-color: var(--colour-grey);   color: #fff; }
  /* Analysis mode: pattern codes under each row */
  .guess-row-wrap { display: flex; flex-direction: column; align-items: center; gap: 4px; }
  .pattern-code { font-size: 10px; letter-spacing: 1px; color: var(--text-muted); font-family: var(--font-mono); display: none; }
  body.analysis-mode .pattern-code { display: block; }
  /* ── Recommendation ─────────────────────────────────────── */
  #recommendation {
    width: 100%;
    background: var(--bg-secondary);
    border: 1px solid var(--colour-border);
    border-radius: 8px;
    padding: 14px 16px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .rec-label {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 2px;
    text-transform: uppercase;
    color: var(--text-muted);
  }
  #best-word {
    font-size: 42px;
    font-weight: 900;
    letter-spacing: 10px;
    text-transform: uppercase;
    color: var(--text-primary);
    line-height: 1;
  }
  #best-word.solved { color: var(--colour-green); font-size: 32px; }
  #best-word.failed { color: #E57373; font-size: 24px; }
  #best-score {
    font-size: 11px;
    color: var(--text-muted);
    display: none;
    letter-spacing: 0.5px;
  }
  body.analysis-mode #best-score { display: block; }
  /* Alternatives (Analysis Mode) */
  #alternatives {
    display: none;
    flex-direction: column;
    gap: 4px;
    margin-top: 4px;
    border-top: 1px solid var(--colour-border);
    padding-top: 10px;
  }
  body.analysis-mode #alternatives { display: flex; }
  .alt-row {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 13px;
  }
  .alt-word {
    font-weight: 700;
    letter-spacing: 2px;
    text-transform: uppercase;
    color: var(--text-primary);
    width: 60px;
    flex-shrink: 0;
  }
  .alt-pct-bar-wrap {
    flex: 1;
    height: 4px;
    background: var(--bg-tertiary);
    border-radius: 2px;
    overflow: hidden;
  }
  .alt-pct-bar {
    height: 100%;
    background: var(--colour-green);
    border-radius: 2px;
    transition: width var(--transition-med);
  }
  .alt-pct { font-size: 11px; color: var(--text-muted); width: 36px; text-align: right; flex-shrink: 0; }
  .alt-candidate-badge {
    font-size: 9px;
    padding: 1px 5px;
    border-radius: 10px;
    background: var(--colour-green);
    color: #fff;
    font-weight: 700;
    letter-spacing: 0.5px;
    flex-shrink: 0;
  }
  .alt-label { font-size: 10px; font-weight: 600; letter-spacing: 1px; text-transform: uppercase; color: var(--text-muted); }
  /* ── Input Row ──────────────────────────────────────────── */
  #input-section {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  #word-input-wrap {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  #word-input {
    flex: 1;
    height: 48px;
    background: var(--bg-secondary);
    border: 1px solid var(--colour-border);
    border-radius: 6px;
    color: var(--text-primary);
    font-size: 20px;
    font-weight: 700;
    letter-spacing: 8px;
    text-transform: uppercase;
    text-align: center;
    padding: 0 12px;
    outline: none;
    font-family: var(--font-ui);
    caret-color: var(--colour-green);
    transition: border-color var(--transition-fast);
  }
  #word-input:focus { border-color: var(--colour-green); }
  #word-input::placeholder { letter-spacing: 4px; font-size: 14px; color: var(--text-muted); }
  #tile-row {
    display: flex;
    gap: var(--gap);
    justify-content: center;
  }
  .feedback-tile {
    width: var(--tile-size);
    height: var(--tile-size);
    border: 2px solid var(--colour-border);
    border-radius: 3px;
    background: transparent;
    color: var(--text-secondary);
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.5px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    text-transform: uppercase;
    transition: background var(--transition-fast), border-color var(--transition-fast), transform var(--transition-fast);
    -webkit-tap-highlight-color: transparent;
    touch-action: manipulation;
    flex-shrink: 0;
  }
  .feedback-tile:active { transform: scale(0.93); }
  .feedback-tile[data-state="yellow"] {
    background: var(--colour-yellow);
    border-color: var(--colour-yellow);
    color: #fff;
  }
  .feedback-tile[data-state="green"] {
    background: var(--colour-green);
    border-color: var(--colour-green);
    color: #fff;
  }
  /* Error message */
  #input-error {
    font-size: 13px;
    color: #E57373;
    text-align: center;
    padding: 6px 12px;
    background: rgba(229, 115, 115, 0.1);
    border-radius: 4px;
    border: 1px solid rgba(229, 115, 115, 0.3);
  }
  /* ── Buttons ─────────────────────────────────────────────── */
  #calculate-btn {
    width: 100%;
    height: 52px;
    background: var(--colour-green);
    border: none;
    border-radius: 6px;
    color: #fff;
    font-size: 14px;
    font-weight: 800;
    letter-spacing: 2px;
    text-transform: uppercase;
    cursor: pointer;
    transition: background var(--transition-fast), opacity var(--transition-fast), transform var(--transition-fast);
    -webkit-tap-highlight-color: transparent;
    touch-action: manipulation;
  }
  #calculate-btn:hover:not(:disabled) { background: #4a7d44; }
  #calculate-btn:active:not(:disabled) { transform: scale(0.98); }
  #calculate-btn:disabled { opacity: 0.35; cursor: not-allowed; }
  .secondary-btns {
    display: flex;
    gap: 8px;
    width: 100%;
  }
  .secondary-btn {
    flex: 1;
    height: 40px;
    background: transparent;
    border: 1px solid var(--colour-border);
    border-radius: 6px;
    color: var(--text-secondary);
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 1.5px;
    text-transform: uppercase;
    cursor: pointer;
    transition: background var(--transition-fast), color var(--transition-fast), border-color var(--transition-fast);
    -webkit-tap-highlight-color: transparent;
    touch-action: manipulation;
  }
  .secondary-btn:hover:not(:disabled) { background: var(--bg-tertiary); color: var(--text-primary); border-color: var(--text-muted); }
  .secondary-btn:active:not(:disabled) { background: var(--bg-tertiary); }
  .secondary-btn:disabled { opacity: 0.25; cursor: not-allowed; }
  #undo-btn { color: #F9A825; border-color: rgba(249,168,37,0.3); }
  #undo-btn:hover:not(:disabled) { background: rgba(249,168,37,0.1); border-color: #F9A825; }
  /* ── Bottom Nav ─────────────────────────────────────────── */
  #bottom-nav {
    height: var(--nav-h);
    display: flex;
    background: var(--bg-secondary);
    border-top: 1px solid var(--colour-border);
    flex-shrink: 0;
    position: sticky;
    bottom: 0;
    z-index: 100;
    width: 100%;
  }
  #bottom-nav button {
    flex: 1;
    border: none;
    background: transparent;
    color: var(--text-muted);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 1px;
    text-transform: uppercase;
    cursor: pointer;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    padding-bottom: 4px;
    transition: color var(--transition-fast);
    -webkit-tap-highlight-color: transparent;
    touch-action: manipulation;
  }
  #bottom-nav button .nav-icon { font-size: 18px; }
  #bottom-nav button.active { color: var(--colour-green); }
  #bottom-nav button:hover:not(.active) { color: var(--text-secondary); }
  /* ── Tab Panels ─────────────────────────────────────────── */
  .tab-panel { display: none; width: 100%; }
  .tab-panel.active { display: flex; flex-direction: column; gap: 12px; }
  /* History panel */
  .history-entry {
    background: var(--bg-secondary);
    border: 1px solid var(--colour-border);
    border-radius: 6px;
    padding: 12px;
    font-size: 13px;
  }
  .history-meta { display: flex; justify-content: space-between; color: var(--text-muted); font-size: 11px; margin-bottom: 6px; }
  .history-guesses { font-family: var(--font-mono); font-size: 12px; letter-spacing: 2px; color: var(--text-secondary); }
  .history-result { font-weight: 700; }
  .history-result.won { color: var(--colour-green); }
  .history-result.lost { color: #E57373; }
  .history-empty { color: var(--text-muted); font-size: 13px; text-align: center; padding: 24px 0; }
  /* Stats panel */
  .stats-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 8px;
    width: 100%;
  }
  .stat-box {
    background: var(--bg-secondary);
    border: 1px solid var(--colour-border);
    border-radius: 6px;
    padding: 12px 8px;
    text-align: center;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .stat-value { font-size: 28px; font-weight: 900; color: var(--text-primary); line-height: 1; }
  .stat-label { font-size: 10px; color: var(--text-muted); letter-spacing: 0.5px; text-transform: uppercase; }
  .dist-bar-row { display: flex; align-items: center; gap: 8px; width: 100%; }
  .dist-label { font-size: 12px; font-weight: 700; width: 16px; text-align: right; flex-shrink: 0; }
  .dist-bar-wrap { flex: 1; height: 20px; background: var(--bg-tertiary); border-radius: 3px; overflow: hidden; }
  .dist-bar { height: 100%; background: var(--colour-grey); border-radius: 3px; display: flex; align-items: center; justify-content: flex-end; padding-right: 6px; min-width: 20px; }
  .dist-bar.current { background: var(--colour-green); }
  .dist-bar span { font-size: 11px; font-weight: 700; color: #fff; }
  /* ── Settings Modal ─────────────────────────────────────── */
  #settings-modal, #confirm-modal, #tutorial-modal {
    border: 1px solid var(--colour-border);
    border-radius: 12px;
    background: var(--bg-secondary);
    color: var(--text-primary);
    padding: 0;
    max-width: 360px;
    width: calc(100% - 32px);
    outline: none;
  }
  #settings-modal::backdrop, #confirm-modal::backdrop, #tutorial-modal::backdrop {
    background: rgba(0,0,0,0.75);
    backdrop-filter: blur(2px);
  }
  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
    border-bottom: 1px solid var(--colour-border);
  }
  .modal-title { font-size: 14px; font-weight: 700; letter-spacing: 2px; text-transform: uppercase; }
  .modal-close {
    width: 28px; height: 28px;
    border: none; background: transparent; color: var(--text-muted);
    font-size: 18px; cursor: pointer; border-radius: 4px; display: flex;
    align-items: center; justify-content: center;
  }
  .modal-close:hover { background: var(--bg-tertiary); color: var(--text-primary); }
  .modal-body { padding: 16px 20px; display: flex; flex-direction: column; gap: 16px; }
  .modal-footer { padding: 12px 20px 16px; border-top: 1px solid var(--colour-border); }
  .setting-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  .setting-info { display: flex; flex-direction: column; gap: 2px; flex: 1; }
  .setting-name { font-size: 14px; font-weight: 600; }
  .setting-desc { font-size: 11px; color: var(--text-muted); }
  .setting-divider { height: 1px; background: var(--colour-border); }
  /* Toggle switch */
  .toggle {
    position: relative;
    width: 44px;
    height: 26px;
    flex-shrink: 0;
  }
  .toggle input { opacity: 0; width: 0; height: 0; }
  .toggle-track {
    position: absolute;
    inset: 0;
    background: var(--bg-tertiary);
    border-radius: 13px;
    cursor: pointer;
    transition: background var(--transition-med);
    border: 1px solid var(--colour-border);
  }
  .toggle input:checked + .toggle-track { background: var(--colour-green); border-color: var(--colour-green); }
  .toggle-track::before {
    content: '';
    position: absolute;
    width: 18px;
    height: 18px;
    left: 3px;
    top: 3px;
    background: #fff;
    border-radius: 50%;
    transition: transform var(--transition-med);
  }
  .toggle input:checked + .toggle-track::before { transform: translateX(18px); }
  .setting-version { font-size: 11px; color: var(--text-muted); text-align: center; padding-top: 4px; }
  /* Confirm modal */
  .confirm-msg { font-size: 14px; color: var(--text-secondary); line-height: 1.5; }
  .confirm-actions { display: flex; gap: 10px; }
  .btn-cancel {
    flex: 1; height: 42px;
    background: transparent;
    border: 1px solid var(--colour-border);
    border-radius: 6px;
    color: var(--text-secondary);
    font-size: 13px; font-weight: 700; letter-spacing: 1px;
    text-transform: uppercase; cursor: pointer;
  }
  .btn-cancel:hover { background: var(--bg-tertiary); }
  .btn-confirm {
    flex: 1; height: 42px;
    background: #E57373;
    border: none;
    border-radius: 6px;
    color: #fff;
    font-size: 13px; font-weight: 700; letter-spacing: 1px;
    text-transform: uppercase; cursor: pointer;
  }
  .btn-confirm:hover { background: #ef5350; }
  .btn-confirm.safe { background: var(--colour-green); }
  .btn-confirm.safe:hover { background: #4a7d44; }
  /* Tutorial */
  .tutorial-step {
    display: none;
    flex-direction: column;
    gap: 12px;
  }
  .tutorial-step.active { display: flex; }
  .tutorial-step-num { font-size: 11px; color: var(--text-muted); letter-spacing: 1px; text-transform: uppercase; }
  .tutorial-heading { font-size: 18px; font-weight: 800; letter-spacing: 1px; }
  .tutorial-body { font-size: 14px; color: var(--text-secondary); line-height: 1.6; }
  .tutorial-example {
    display: flex;
    gap: 6px;
    justify-content: center;
    padding: 12px 0;
  }
  .tutorial-tile {
    width: 44px; height: 44px;
    border: 2px solid var(--colour-border);
    border-radius: 3px;
    display: flex; align-items: center; justify-content: center;
    font-size: 18px; font-weight: 900; text-transform: uppercase;
  }
  .tutorial-tile.green  { background: var(--colour-green);  border-color: var(--colour-green);  color: #fff; }
  .tutorial-tile.yellow { background: var(--colour-yellow); border-color: var(--colour-yellow); color: #fff; }
  .tutorial-tile.grey   { background: var(--colour-grey);   border-color: var(--colour-grey);   color: #fff; }
  .tutorial-nav { display: flex; gap: 10px; align-items: center; justify-content: space-between; }
  .tutorial-dots { display: flex; gap: 6px; }
  .tutorial-dot {
    width: 8px; height: 8px; border-radius: 50%;
    background: var(--bg-tertiary); border: 1px solid var(--colour-border);
    transition: background var(--transition-fast);
  }
  .tutorial-dot.active { background: var(--colour-green); border-color: var(--colour-green); }
  .tutorial-btn {
    padding: 8px 18px;
    background: var(--colour-green);
    border: none; border-radius: 6px;
    color: #fff; font-size: 12px; font-weight: 700; letter-spacing: 1px;
    text-transform: uppercase; cursor: pointer;
  }
  .tutorial-btn.secondary {
    background: transparent;
    border: 1px solid var(--colour-border);
    color: var(--text-muted);
  }
  .tutorial-btn.secondary:hover { color: var(--text-primary); border-color: var(--text-muted); }
  /* ── Solved / Failed banners ────────────────────────────── */
  .result-banner {
    width: 100%;
    padding: 12px 16px;
    border-radius: 6px;
    font-size: 13px;
    font-weight: 700;
    letter-spacing: 1px;
    text-transform: uppercase;
    text-align: center;
    display: none;
  }
  .result-banner.show { display: block; }
  .result-banner.solved { background: rgba(83,141,78,0.2); border: 1px solid rgba(83,141,78,0.4); color: var(--colour-green); }
  .result-banner.failed { background: rgba(229,115,115,0.15); border: 1px solid rgba(229,115,115,0.3); color: #E57373; }
  /* ── Candidate list (Analysis Mode) ─────────────────────── */
  #candidate-list-wrap {
    width: 100%;
    display: none;
  }
  body.analysis-mode #candidate-list-wrap { display: block; }
  #candidate-list-toggle {
    background: transparent;
    border: 1px solid var(--colour-border);
    border-radius: 6px;
    color: var(--text-muted);
    font-size: 11px; font-weight: 700; letter-spacing: 1px;
    text-transform: uppercase;
    cursor: pointer;
    width: 100%;
    padding: 8px;
    display: flex; align-items: center; justify-content: center; gap: 8px;
  }
  #candidate-list-toggle:hover { background: var(--bg-tertiary); color: var(--text-primary); }
  #candidate-list {
    display: none;
    flex-wrap: wrap;
    gap: 6px;
    padding: 10px 0;
    max-height: 160px;
    overflow-y: auto;
  }
  #candidate-list.open { display: flex; }

  /* ── Candidate chip — base (read-only span) ──────────────── */
  .cand-chip {
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 1px;
    text-transform: uppercase;
    background: var(--bg-tertiary);
    border: 1px solid var(--colour-border);
    border-radius: 4px;
    padding: 3px 8px;
    color: var(--text-secondary);
  }

  /* ── Candidate chip — clickable button variant ──────────────
   * Applied automatically when candidates.length ≤ CANDIDATE_CLICK_THRESHOLD.
   * The element type changes from <span> to <button> so specificity
   * is retained via the element selector; no extra class needed.
   *
   * Interaction states:
   *   default  — green border + green text (visually signals interactivity)
   *   hover    — filled green background + white text
   *   active   — slight scale-down (tactile press feedback)
   *   focus    — inherited :focus-visible green ring (ACC-6)
   *
   * PRD refs: FR-18 (expandable word list), ACC-2 (ARIA labels), ACC-6 (keyboard)
   * ──────────────────────────────────────────────────────────── */
  button.cand-chip {
    cursor: pointer;
    border-color: var(--colour-green);
    color: var(--colour-green);
    transition:
      background var(--transition-fast),
      color var(--transition-fast),
      border-color var(--transition-fast),
      transform var(--transition-fast);
    -webkit-tap-highlight-color: transparent;
    touch-action: manipulation;
    /* Ensure minimum tap target per PRD §9.2a / G-7.
       Padding extends the hit area while chip text stays compact. */
    min-height: 32px;
    padding: 5px 10px;
  }
  button.cand-chip:hover,
  button.cand-chip:focus-visible {
    background: var(--colour-green);
    border-color: var(--colour-green);
    color: #fff;
    outline: none;
  }
  button.cand-chip:active { transform: scale(0.93); }

  /* Focus visible for keyboard nav */
  :focus-visible {
    outline: 2px solid var(--colour-green);
    outline-offset: 2px;
  }
  /* Animations */
  @keyframes fadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
  .anim-fade { animation: fadeIn 200ms ease forwards; }
  @keyframes shake {
    0%, 100% { transform: translateX(0); }
    20% { transform: translateX(-6px); }
    40% { transform: translateX(6px); }
    60% { transform: translateX(-4px); }
    80% { transform: translateX(4px); }
  }
  .anim-shake { animation: shake 350ms ease; }
`;

// ═══════════════════════════════════════════════════════════════════
// SETTINGS STATE
// ═══════════════════════════════════════════════════════════════════
const SETTINGS_KEY = 'lexicon-settings';
const HISTORY_KEY  = 'lexicon-history';
const MAX_HISTORY  = 50;

/** @returns {SettingsState} */
function loadSettings() {
  try {
    const raw = sessionStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...defaultSettings(), ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return defaultSettings();
}

function defaultSettings() {
  return {
    mode:             'simple',   // 'simple' | 'analysis'
    colourBlind:      false,
    showScores:       false,
    hardMode:         false,
    hasSeenTutorial:  false,
  };
}

function saveSettings(s) {
  try { sessionStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* ignore */ }
  applyMode(s.mode);
  applyColourBlind(s.colourBlind);
}

function applyMode(mode) {
  document.body.classList.toggle('analysis-mode', mode === 'analysis');
}

function applyColourBlind(on) {
  document.body.classList.toggle('colour-blind', on);
}

// ═══════════════════════════════════════════════════════════════════
// SESSION HISTORY
// ═══════════════════════════════════════════════════════════════════
/** @returns {HistoryEntry[]} */
function loadHistory() {
  try {
    const raw = sessionStorage.getItem(HISTORY_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return [];
}

function saveHistory(entries) {
  try { sessionStorage.setItem(HISTORY_KEY, JSON.stringify(entries.slice(-MAX_HISTORY))); } catch { /* ignore */ }
}

function archiveCurrentGame(state) {
  if (state.guesses.length === 0) return;
  const history = loadHistory();
  history.push({
    gameNumber: history.length + 1,
    guesses:    state.guesses,
    patterns:   state.patterns,
    guessCount: state.solved ? state.round - 1 : null,
    solved:     state.solved,
    timestamp:  new Date().toISOString(),
  });
  saveHistory(history);
}

// ═══════════════════════════════════════════════════════════════════
// MODULE-LEVEL STATE
// ═══════════════════════════════════════════════════════════════════
let _settings = defaultSettings();
let _activeTab = 'solver';  // 'solver' | 'history' | 'stats'
let _matrixReady = false;
let _currentGameResult = null; // last SolverResult

// ═══════════════════════════════════════════════════════════════════
// DOM BOOTSTRAP — inject styles and scaffold
// ═══════════════════════════════════════════════════════════════════
function injectStyles() {
  const styleEl = document.createElement('style');
  styleEl.textContent = CSS_VARS + APP_STYLES;
  document.head.appendChild(styleEl);
}

function buildDOMScaffold() {
  document.body.innerHTML = `
    <!-- Loading Overlay -->
    <div id="loading-overlay" aria-label="Loading word database" aria-busy="true">
      <div id="loading-logo">LE<span>X</span>ICON</div>
      <p id="loading-message">Initialising…</p>
      <div id="loading-bar-wrap"><div id="loading-bar"></div></div>
    </div>
    <!-- Header -->
    <header>
      <div class="header-actions">
        <button class="icon-btn" id="help-btn" aria-label="Help / Tutorial" title="Help">?</button>
      </div>
      <h1 id="app-title">LEXICON</h1>
      <div class="header-actions">
        <button class="icon-btn" id="settings-btn" aria-label="Settings" title="Settings">⚙</button>
      </div>
    </header>
    <!-- Main solver -->
    <main id="solver-panel" class="tab-panel active">
      <!-- Status bar -->
      <div id="status-bar" aria-live="polite">
        <span id="guess-counter">Guess 1 / 6</span>
        <span id="candidate-counter">2,315 words remaining</span>
      </div>
      <!-- Guess grid -->
      <div id="guess-grid" role="list" aria-label="Guess history"></div>
      <!-- Result banner (solved / failed) -->
      <div id="result-banner" class="result-banner" role="alert"></div>
      <!-- Recommendation -->
      <div id="recommendation" aria-live="polite">
        <p class="rec-label">Optimal Strategy</p>
        <p id="best-word">—</p>
        <p id="best-score"></p>
        <div id="alternatives" aria-label="Alternative guesses">
          <p class="alt-label" style="margin-bottom:6px">Alternatives</p>
        </div>
      </div>
      <!-- Candidate list (Analysis Mode) -->
      <div id="candidate-list-wrap">
        <button id="candidate-list-toggle">▼ Show remaining words</button>
        <div id="candidate-list" role="list"></div>
      </div>
      <!-- Input section -->
      <div id="input-section">
        <div id="word-input-wrap">
          <input
            id="word-input"
            type="text"
            maxlength="5"
            autocomplete="off"
            autocorrect="off"
            autocapitalize="off"
            spellcheck="false"
            placeholder="type word"
            aria-label="Enter your 5-letter guess"
          />
        </div>
        <div id="tile-row" role="group" aria-label="Colour feedback tiles"></div>
        <div id="input-error" role="alert" aria-live="assertive" style="display:none"></div>
      </div>
      <!-- CTA -->
      <button id="calculate-btn" aria-disabled="false">Calculate Next Step</button>
      <!-- Secondary actions -->
      <div class="secondary-btns">
        <button class="secondary-btn" id="undo-btn" disabled aria-label="Undo last guess">↩ Undo</button>
        <button class="secondary-btn" id="reset-btn" aria-label="Reset this game">Reset Game</button>
        <button class="secondary-btn" id="new-game-btn" aria-label="Start a new game">New Game</button>
      </div>
    </main>
    <!-- History panel -->
    <div id="history-panel" class="tab-panel">
      <div id="history-list"></div>
    </div>
    <!-- Stats panel -->
    <div id="stats-panel" class="tab-panel">
      <div class="stats-grid" id="stats-grid"></div>
      <div id="dist-chart" style="width:100%;display:flex;flex-direction:column;gap:6px;"></div>
    </div>
    <!-- Bottom nav -->
    <nav id="bottom-nav" role="navigation" aria-label="App sections">
      <button data-tab="solver" class="active" aria-label="Solver">
        <span class="nav-icon">🧩</span>SOLVER
      </button>
      <button data-tab="history" aria-label="History">
        <span class="nav-icon">🕐</span>HISTORY
      </button>
      <button data-tab="stats" aria-label="Stats">
        <span class="nav-icon">📊</span>STATS
      </button>
    </nav>
    <!-- Modals -->
    <dialog id="confirm-modal"></dialog>
    <dialog id="settings-modal"></dialog>
    <dialog id="tutorial-modal"></dialog>
  `;
}

// ═══════════════════════════════════════════════════════════════════
// LOADING STATE (§6.3)
// ═══════════════════════════════════════════════════════════════════
/** @param {number} pct @param {string} message */
export function renderLoading(pct, message) {
  const bar = document.getElementById('loading-bar');
  const msg = document.getElementById('loading-message');
  if (bar) bar.style.width = `${Math.max(0, Math.min(100, pct))}%`;
  if (msg) msg.textContent = message || 'Loading…';
}

/** @param {string} msg */
export function renderError(msg) {
  const overlay = document.getElementById('loading-overlay');
  if (!overlay) return;
  overlay.innerHTML = `
    <div id="loading-logo">LE<span>X</span>ICON</div>
    <p id="loading-error">${_escape(msg)}</p>
    <button id="loading-retry" onclick="location.reload()">Retry</button>
  `;
}

function hideLoadingOverlay() {
  const overlay = document.getElementById('loading-overlay');
  if (!overlay) return;
  overlay.setAttribute('aria-busy', 'false');
  overlay.classList.add('hidden');
  // Remove after transition
  setTimeout(() => overlay.remove(), 300);
}

// ═══════════════════════════════════════════════════════════════════
// TILE ROW (input area)
// ═══════════════════════════════════════════════════════════════════
const TILE_CYCLE  = { grey: 'yellow', yellow: 'green', green: 'grey' };
const TILE_LABELS = { grey: 'Grey — absent', yellow: 'Yellow — present', green: 'Green — correct' };

function buildTileRow() {
  const row = document.getElementById('tile-row');
  if (!row) return;
  row.innerHTML = '';
  for (let i = 0; i < 5; i++) {
    const btn = document.createElement('button');
    btn.className = 'feedback-tile';
    btn.dataset.position = String(i);
    btn.dataset.state = 'grey';
    btn.setAttribute('aria-label', `Position ${i + 1}: Grey — tap to change`);
    btn.textContent = '?';
    btn.addEventListener('click', () => onTileTap(i));
    row.appendChild(btn);
  }
  _updateTileLetters();

  // ── "All Green" shortcut button ─────────────────────────────
  let btnAllGreen = document.getElementById('all-green-btn');
  if (!btnAllGreen) {
    btnAllGreen = document.createElement('button');
    btnAllGreen.id          = 'all-green-btn';
    btnAllGreen.textContent = 'Set All Green';
    btnAllGreen.className   = 'secondary-btn';
    btnAllGreen.style.color       = 'var(--colour-green)';
    btnAllGreen.style.borderColor = 'rgba(83,141,78,0.3)';
    btnAllGreen.setAttribute('aria-label', 'Set all tiles to green');
    btnAllGreen.addEventListener('click', setAllTilesGreen);

    // Append into the existing .secondary-btns row
    const secondaryRow = document.querySelector('.secondary-btns');
    if (secondaryRow) secondaryRow.appendChild(btnAllGreen);
  }
}

/** Cycle tile state on tap. */
export function onTileTap(pos) {
  const tile = document.querySelector(`.feedback-tile[data-position="${pos}"]`);
  if (!tile) return;
  const next = TILE_CYCLE[tile.dataset.state] ?? 'grey';
  tile.dataset.state = next;
  const label = TILE_LABELS[next];
  tile.setAttribute('aria-label', `Position ${pos + 1}: ${label} — tap to change`);
  clearInputError();
}

/** Sync tile face-letters from the word input. */
function _updateTileLetters() {
  const word = (document.getElementById('word-input')?.value ?? '').toUpperCase();
  document.querySelectorAll('.feedback-tile').forEach((tile, i) => {
    tile.textContent = word[i] ?? '?';
  });
}

/** Read the current 5-tile pattern as an integer 0–242. */
function readTilePattern() {
  const BASE3 = [81, 27, 9, 3, 1];
  const CODE  = { grey: 0, yellow: 1, green: 2 };
  let total = 0;
  document.querySelectorAll('.feedback-tile').forEach((tile, i) => {
    total += (CODE[tile.dataset.state] ?? 0) * BASE3[i];
  });
  return total;
}

/** Reset all tiles to grey. */
function resetTiles() {
  document.querySelectorAll('.feedback-tile').forEach((tile, i) => {
    tile.dataset.state = 'grey';
    tile.textContent = '?';
    tile.setAttribute('aria-label', `Position ${i + 1}: Grey — tap to change`);
  });
}

/** Set all tiles to green (correct answer state). */
function setAllTilesGreen() {
  document.querySelectorAll('.feedback-tile').forEach((tile, i) => {
    tile.dataset.state = 'green';
    tile.setAttribute(
      'aria-label',
      `Position ${i + 1}: ${TILE_LABELS.green} — tap to change`
    );
  });
}

/** Disable tiles (game ended). */
function disableTiles(disabled) {
  document.querySelectorAll('.feedback-tile').forEach(t => {
    t.disabled = disabled;
    t.style.pointerEvents = disabled ? 'none' : '';
    t.style.opacity = disabled ? '0.4' : '';
  });
}

// ═══════════════════════════════════════════════════════════════════
// GUESS GRID
// ═══════════════════════════════════════════════════════════════════
/**
 * Re-render the full guess grid from current GameState.
 * @param {GameState} state
 */
function renderGuessGrid(state) {
  const grid = document.getElementById('guess-grid');
  if (!grid) return;
  grid.innerHTML = '';
  state.guesses.forEach((guess, round) => {
    const pattern  = state.patterns[round];
    const colours  = patternToColours(pattern);
    const pString  = patternToString(pattern);
    const wrap = document.createElement('div');
    wrap.className = 'guess-row-wrap anim-fade';
    wrap.setAttribute('role', 'listitem');
    const row = document.createElement('div');
    row.className = 'guess-row';
    for (let i = 0; i < 5; i++) {
      const tile = document.createElement('div');
      tile.className = 'guess-tile';
      tile.dataset.state = colours[i];
      tile.textContent = guess[i].toUpperCase();
      tile.setAttribute('aria-label',
        `Guess ${round + 1}, position ${i + 1}: ${guess[i].toUpperCase()}, ${colours[i]}`);
      row.appendChild(tile);
    }
    const code = document.createElement('div');
    code.className = 'pattern-code';
    code.textContent = pString;
    wrap.appendChild(row);
    wrap.appendChild(code);
    grid.appendChild(wrap);
  });
}

// ═══════════════════════════════════════════════════════════════════
// RECOMMENDATION AREA
// ═══════════════════════════════════════════════════════════════════
/**
 * Render the recommendation box from a SolverResult.
 * @param {SolverResult} result
 */
function renderRecommendation(result) {
  const bestWordEl  = document.getElementById('best-word');
  const bestScoreEl = document.getElementById('best-score');
  const altsEl      = document.getElementById('alternatives');
  if (!bestWordEl) return;
  const recs = result?.recommendations ?? [];

  if (result?.solved) {
    bestWordEl.className = 'solved';
    bestWordEl.textContent = `Solved in ${result.state.round - 1}!`;
    if (bestScoreEl) bestScoreEl.textContent = '';
    if (altsEl) altsEl.innerHTML = '<p class="alt-label" style="margin-bottom:6px">Alternatives</p>';
    return;
  }
  if (result?.failed) {
    bestWordEl.className = 'failed';
    bestWordEl.textContent = 'No solution found';
    if (bestScoreEl) bestScoreEl.textContent = '';
    if (altsEl) altsEl.innerHTML = '<p class="alt-label" style="margin-bottom:6px">Alternatives</p>';
    return;
  }

  const top = recs[0];
  if (!top) return;
  bestWordEl.className = '';
  bestWordEl.textContent = top.word.toUpperCase();

  if (bestScoreEl) {
    const candidateCount = result.state?.candidates?.length ?? 0;
    bestScoreEl.textContent =
      `Expected residual: ${top.score.toFixed(2)} · ` +
      `${candidateCount.toLocaleString()} candidates remaining`;
  }

  // Alternatives (top 5, shown in Analysis Mode)
  if (altsEl) {
    altsEl.innerHTML = '<p class="alt-label" style="margin-bottom:6px">Alternatives</p>';
    recs.slice(0, 5).forEach((rec, idx) => {
      const row = document.createElement('div');
      row.className = 'alt-row';
      const wordEl = document.createElement('span');
      wordEl.className = 'alt-word';
      wordEl.textContent = rec.word.toUpperCase();
      const barWrap = document.createElement('div');
      barWrap.className = 'alt-pct-bar-wrap';
      const bar = document.createElement('div');
      bar.className = 'alt-pct-bar';
      bar.style.width = `${rec.pct}%`;
      barWrap.appendChild(bar);
      const pctEl = document.createElement('span');
      pctEl.className = 'alt-pct';
      pctEl.textContent = `${rec.pct}%`;
      row.appendChild(wordEl);
      row.appendChild(barWrap);
      row.appendChild(pctEl);
      if (rec.isCandidate) {
        const badge = document.createElement('span');
        badge.className = 'alt-candidate-badge';
        badge.textContent = '✓';
        badge.title = 'Valid answer word';
        row.appendChild(badge);
      }
      altsEl.appendChild(row);
      void idx; // suppress lint
    });
  }
}

// ═══════════════════════════════════════════════════════════════════
// STATUS BAR
// ═══════════════════════════════════════════════════════════════════
function renderStatusBar(state) {
  const guessEl = document.getElementById('guess-counter');
  const candEl  = document.getElementById('candidate-counter');
  if (!guessEl || !candEl) return;
  const round = state?.round ?? 1;
  guessEl.textContent = `Guess ${Math.min(round, 6)} / 6`;
  const count = state?.candidates?.length ?? ANSWER_SIZE;
  candEl.textContent = `${count.toLocaleString()} word${count === 1 ? '' : 's'} remaining`;
  candEl.classList.toggle('warning', count <= 3 && count > 0);
}

// ═══════════════════════════════════════════════════════════════════
// CANDIDATE LIST (Analysis Mode)
// ═══════════════════════════════════════════════════════════════════
/**
 * Render the expandable remaining-candidate list in Analysis Mode.
 *
 * Feature 1 (v1.1): When candidates.length ≤ CANDIDATE_CLICK_THRESHOLD (15),
 * each chip is rendered as an interactive <button> that autofills the word
 * input and syncs the tile letter faces on click/tap.
 *
 * When candidates.length > CANDIDATE_CLICK_THRESHOLD, chips are read-only
 * <span> elements (original behaviour, unchanged).
 *
 * Toggle label reflects the active mode:
 *   clickable  → "▼ Show N words — tap to autofill"
 *   read-only  → "▼ Show N remaining words"
 *
 * @param {GameState} state
 */
function renderCandidateList(state) {
  const list   = document.getElementById('candidate-list');
  const toggle = document.getElementById('candidate-list-toggle');
  if (!list || !toggle) return;

  const candidates  = state?.candidates ?? [];
  const count       = candidates.length;

  // ── Feature 1: determine whether chips should be clickable ──────
  // Chips are clickable only when the set is small enough to be
  // actionable (≤ threshold) and non-empty.  Zero candidates means
  // the game is in an error state; we don't render buttons for that.
  const isClickable = count > 0 && count <= CANDIDATE_CLICK_THRESHOLD;

  // ── Toggle button label ─────────────────────────────────────────
  const closedLabel = isClickable
    ? `▼ Show ${count} word${count === 1 ? '' : 's'} — tap to autofill`
    : `▼ Show ${count.toLocaleString()} remaining word${count === 1 ? '' : 's'}`;

  toggle.textContent = closedLabel;

  toggle.onclick = () => {
    const isOpen = list.classList.toggle('open');

    // Update toggle label for open/closed state
    if (isOpen) {
      toggle.textContent = isClickable
        ? `▲ Hide — tap a word to autofill`
        : `▲ Hide remaining words`;
    } else {
      toggle.textContent = closedLabel;
    }

    // Lazily build chips on first open
    if (isOpen && list.innerHTML === '') {
      candidates.slice(0, 200).forEach(idx => {
        const word = ANSWERS[idx]; // lowercase, e.g. 'stare'

        if (isClickable) {
          // ── Clickable button chip (Feature 1) ───────────────────
          // Element: <button> so it is keyboard-reachable and announced
          //          by screen readers as "button" (ACC-2, ACC-6).
          // aria-label: includes the word and its action for SR users.
          // Click handler: writes lowercase word to the text input and
          //   refreshes tile face letters.  Does NOT call onCalculate —
          //   the player must still set tile colours and confirm.
          const btn = document.createElement('button');
          btn.className    = 'cand-chip';
          btn.setAttribute('role', 'listitem');
          btn.setAttribute('aria-label', `Autofill ${word.toUpperCase()}`);
          btn.textContent  = word.toUpperCase();
          btn.addEventListener('click', () => {
            const input = document.getElementById('word-input');
            if (input) {
              input.value = word; // lowercase matches onCalculate expectation
              _updateTileLetters();
              clearInputError();
              // Move focus to the input so keyboard users can proceed
              // immediately without an extra Tab stop.
              input.focus();
            }
          });
          list.appendChild(btn);

        } else {
          // ── Read-only span chip (original behaviour) ─────────────
          const chip = document.createElement('span');
          chip.className = 'cand-chip';
          chip.setAttribute('role', 'listitem');
          chip.textContent = word.toUpperCase();
          list.appendChild(chip);
        }
      });

      // "+N more" overflow label — only needed above the threshold
      // (below it the list is ≤ 15 words, never exceeds 200).
      if (!isClickable && candidates.length > 200) {
        const more = document.createElement('span');
        more.className = 'cand-chip';
        more.style.color = 'var(--text-muted)';
        more.textContent = `+${candidates.length - 200} more`;
        list.appendChild(more);
      }
    }
  };

  // Reset list content and collapse on every new state
  list.innerHTML = '';
  list.classList.remove('open');
}

// ═══════════════════════════════════════════════════════════════════
// VOCAB CANDIDATE DERIVATION
// Filters VOCABULARY[] to words consistent with all known constraints.
// Derived from state.guesses + state.patterns using the same two-pass
// logic as pattern.js — greens fix positions, yellows forbid positions
// but require presence, greys set letter maximums.
// Called by renderSmartCandidatePanel() as the data source.
// ═══════════════════════════════════════════════════════════════════

function _deriveVocabCandidates(state) {
  if (!state?.guesses?.length) return null;

  const greens    = Array(5).fill(null);                     // greens[i]    = confirmed letter at position i
  const yellowPos = Array.from({length: 5}, () => new Set()); // yellowPos[i] = letters forbidden at position i
  const minCount  = new Map();  // letter → minimum occurrences required in word
  const maxCount  = new Map();  // letter → maximum occurrences allowed in word

  state.guesses.forEach((guess, r) => {
    const codes = decodePattern(state.patterns[r]);  // [0|1|2] × 5

    // ── Per-letter tallies for this single guess ──────────────
    const presentInGuess = new Map();  // letters appearing as green or yellow
    const greyInGuess    = new Set();  // letters appearing as grey at least once

    codes.forEach((code, i) => {
      const ch = guess[i];
      if (code === 2 || code === 1) {
        presentInGuess.set(ch, (presentInGuess.get(ch) || 0) + 1);
      }
      if (code === 0) greyInGuess.add(ch);
    });

    // ── Apply position-level constraints ──────────────────────
    codes.forEach((code, i) => {
      const ch = guess[i];
      if (code === 2) {
        greens[i] = ch;            // must appear here
      } else if (code === 1) {
        yellowPos[i].add(ch);      // must NOT appear here (but exists somewhere)
      }
    });

    // ── Derive min / max letter-count constraints ─────────────
    // Min count: every green+yellow occurrence must exist in the word
    presentInGuess.forEach((count, ch) => {
      minCount.set(ch, Math.max(minCount.get(ch) || 0, count));

      // Grey alongside present letter = exact count (no more than `count`)
      if (greyInGuess.has(ch)) {
        const prev = maxCount.get(ch);
        maxCount.set(ch, prev === undefined ? count : Math.min(prev, count));
      }
    });

    // Fully absent letter (grey only, never green/yellow in this guess)
    greyInGuess.forEach(ch => {
      if (!presentInGuess.has(ch)) {
        maxCount.set(ch, 0);       // zero allowed = letter absent from answer
      }
    });
  });

  // ── Filter VOCABULARY ──────────────────────────────────────────
  return VOCABULARY.filter(word => {

    // Rule 1: confirmed green positions must match exactly
    for (let i = 0; i < 5; i++) {
      if (greens[i] !== null && word[i] !== greens[i]) return false;
    }

    // Rule 2: yellow letters must not appear at their forbidden positions
    for (let i = 0; i < 5; i++) {
      for (const ch of yellowPos[i]) {
        if (word[i] === ch) return false;
      }
    }

    // Rule 3: required letters must appear at least minCount times
    for (const [ch, min] of minCount) {
      if (min === 0) continue;
      let count = 0;
      for (const c of word) if (c === ch) count++;
      if (count < min) return false;
    }

    // Rule 4: capped letters must not exceed maxCount
    // (covers: absent letters (max=0) and duplicate-grey exact counts)
    for (const [ch, max] of maxCount) {
      let count = 0;
      for (const c of word) if (c === ch) count++;
      if (count > max) return false;
    }

    return true;
  });
}

// ═══════════════════════════════════════════════════════════════════
// SMART CANDIDATE PANEL
// Auto-renders when valid vocabulary candidates drop to ≤ SMART_THRESHOLD.
// Derives candidates from VOCABULARY[] via _deriveVocabCandidates().
// Chips populate the word input on tap.
// ═══════════════════════════════════════════════════════════════════

const SMART_THRESHOLD = 20;  // tune this to taste

function renderSmartCandidatePanel(state) {
  // ── Locate or create container ─────────────────────────────────
  let panel = document.getElementById('smart-candidates');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'smart-candidates';
    panel.style.cssText = 'width:100%; display:none; flex-direction:column; gap:8px;';
    const rec = document.getElementById('recommendation');
    if (rec?.parentNode) {
      rec.parentNode.insertBefore(panel, rec.nextSibling);
    }
  }

  // ── CHANGED: derive from VOCABULARY, not state.candidates ──────
  const vocabWords = _deriveVocabCandidates(state);  // string[] | null
  const count      = vocabWords?.length ?? 0;

  // ── Hide when out of useful range ─────────────────────────────
  if (!vocabWords || count ===0 || count > SMART_THRESHOLD) {
    panel.style.display = 'none';
    return;
  }

  panel.style.display = 'flex';
  panel.innerHTML = '';

  // ── Outer card — mirrors #recommendation card style ───────────
  const card = document.createElement('div');
  card.style.cssText = `
    width: 100%;
    background: var(--bg-secondary);
    border: 1px solid var(--colour-border);
    border-radius: 8px;
    padding: 12px 14px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  `;

  // ── Header row ─────────────────────────────────────────────────
  const header = document.createElement('div');
  header.style.cssText = `
    display: flex;
    align-items: center;
    justify-content: space-between;
  `;

  const labelEl = document.createElement('span');
  labelEl.style.cssText = `
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 2px;
    text-transform: uppercase;
    color: var(--text-muted);
  `;
  // CHANGED: label reflects vocabulary source, not answer candidates
  labelEl.textContent = 'Valid Guesses Remaining';

  const countBadge = document.createElement('span');
  countBadge.style.cssText = `
    font-size: 11px;
    font-weight: 700;
    color: var(--colour-green);
    letter-spacing: 0.5px;
  `;
  countBadge.textContent = `${count} word${count === 1 ? '' : 's'}`;

  const hintEl = document.createElement('span');
  hintEl.style.cssText = `
    font-size: 10px;
    color: var(--text-muted);
    letter-spacing: 0.3px;
  `;
  hintEl.textContent = 'tap to use';

  header.appendChild(labelEl);
  header.appendChild(countBadge);
  header.appendChild(hintEl);

  // ── Chip grid ──────────────────────────────────────────────────
  const chipWrap = document.createElement('div');
  chipWrap.style.cssText = 'display:flex; flex-wrap:wrap; gap:6px;';
  chipWrap.setAttribute('role', 'list');
  chipWrap.setAttribute('aria-label', 'Valid vocabulary words remaining');

  // CHANGED: iterate word strings directly (no index→ANSWERS lookup needed)
  vocabWords.forEach(word => {
    const chip = document.createElement('button');
    chip.className = 'cand-chip';
    chip.setAttribute('role',       'listitem');
    chip.setAttribute('aria-label', `Use ${word.toUpperCase()} as next guess`);
    chip.style.cssText = `
      cursor: pointer;
      padding: 5px 11px;
      border: 1px solid var(--colour-border);
      background: var(--bg-tertiary);
      color: var(--text-secondary);
      transition:
        background var(--transition-fast),
        border-color var(--transition-fast),
        color var(--transition-fast);
      -webkit-tap-highlight-color: transparent;
      touch-action: manipulation;
    `;
    chip.textContent = word.toUpperCase();

    chip.addEventListener('click', () => {
      const input = document.getElementById('word-input');
      if (input) {
        input.value = word;
        input.dispatchEvent(new Event('input'));  // triggers _updateTileLetters()
        input.focus();
      }
      // Highlight selected, clear others
      chipWrap.querySelectorAll('button').forEach(c => {
        c.style.background  = '';
        c.style.borderColor = '';
        c.style.color       = '';
      });
      chip.style.background  = 'rgba(83,141,78,0.15)';
      chip.style.borderColor = 'var(--colour-green)';
      chip.style.color       = 'var(--colour-green)';
    });

    chipWrap.appendChild(chip);
  });

  card.appendChild(header);
  card.appendChild(chipWrap);
  panel.appendChild(card);
}

// ═══════════════════════════════════════════════════════════════════
// ROUND 1 RENDERER
// ═══════════════════════════════════════════════════════════════════
/** Render initial state: opener recommendation, fresh tiles, disabled Undo. */
export function renderRound1() {
  const opener = getOpener();
  const state  = getSolverState();

  renderGuessGrid(state);
  renderStatusBar(state);
  renderSmartCandidatePanel(state);

  // Recommendation: show opener
  const bestWordEl = document.getElementById('best-word');
  const recLabel   = document.querySelector('#recommendation .rec-label');
  const bestScore  = document.getElementById('best-score');
  if (bestWordEl) { bestWordEl.className = ''; bestWordEl.textContent = opener.word.toUpperCase(); }
  if (recLabel)   recLabel.textContent = 'Recommended Opener';
  if (bestScore)  bestScore.textContent = 'Hardcoded — no scan required for round 1';
  const altsEl = document.getElementById('alternatives');
  if (altsEl) altsEl.innerHTML = '<p class="alt-label" style="margin-bottom:6px">Alternatives</p>';

  renderCandidateList(state);

  // Word input: pre-fill with opener
  const input = document.getElementById('word-input');
  if (input) {
    input.value = opener.word;
    input.disabled = false;
  }

  // Reset tiles
  resetTiles();
  disableTiles(false);
  _updateTileLetters();

  // Result banner: hidden
  const banner = document.getElementById('result-banner');
  if (banner) { banner.className = 'result-banner'; banner.textContent = ''; }

  // Buttons
  _setBtn('calculate-btn', { disabled: false });
  _setBtn('undo-btn',      { disabled: true });
  _setBtn('reset-btn',     { disabled: false });
  _setBtn('new-game-btn',  { disabled: false });
  clearInputError();
}

// ═══════════════════════════════════════════════════════════════════
// RESULT RENDERER
// ═══════════════════════════════════════════════════════════════════
/**
 * Render after a guess is submitted.
 * @param {SolverResult} result
 */
export function renderResult(result) {
  _currentGameResult = result;
  const state = result.state;

  renderGuessGrid(state);
  renderStatusBar(state);
  renderRecommendation(result);
  renderSmartCandidatePanel(state); 
  renderCandidateList(state);

  // Pre-fill next guess
  const top   = result.recommendations?.[0];
  const input = document.getElementById('word-input');
  if (input) {
    input.value = top?.word ?? '';
    input.disabled = false;
  }
  resetTiles();
  disableTiles(false);
  _updateTileLetters();
  clearInputError();

  // Undo: enabled after a guess, disabled after undo
  _setBtn('undo-btn', { disabled: state.undoStack.length === 0 });
  _setBtn('calculate-btn', { disabled: false });

  // Update rec label
  const recLabel = document.querySelector('#recommendation .rec-label');
  if (recLabel) recLabel.textContent = 'Optimal Strategy';
}

// ═══════════════════════════════════════════════════════════════════
// SOLVED RENDERER
// ═══════════════════════════════════════════════════════════════════
/** @param {GameState} state */
export function renderSolved(state) {
  renderGuessGrid(state);
  renderStatusBar(state);

  const banner = document.getElementById('result-banner');
  if (banner) {
    banner.className = 'result-banner solved show anim-fade';
    const guesses = state.round - 1;
    banner.textContent = `✓ Solved in ${guesses} guess${guesses === 1 ? '' : 'es'}!`;
  }
  const bestWordEl = document.getElementById('best-word');
  if (bestWordEl) {
    bestWordEl.className = 'solved';
    bestWordEl.textContent = `${state.guesses[state.guesses.length - 1]?.toUpperCase() ?? ''}`;
  }
  const recLabel = document.querySelector('#recommendation .rec-label');
  if (recLabel) recLabel.textContent = 'Answer Found';
  const bestScore = document.getElementById('best-score');
  if (bestScore) bestScore.textContent = `Solved in ${state.round - 1} guesses`;
  const altsEl = document.getElementById('alternatives');
  if (altsEl) altsEl.innerHTML = '<p class="alt-label" style="margin-bottom:6px">Alternatives</p>';

  const input = document.getElementById('word-input');
  if (input) { input.value = ''; input.disabled = true; }
  disableTiles(true);
  _setBtn('calculate-btn', { disabled: true });
  _setBtn('undo-btn',      { disabled: state.undoStack.length === 0 });
  _setBtn('reset-btn',     { disabled: false });
  _setBtn('new-game-btn',  { disabled: false });
  clearInputError();
}

// ═══════════════════════════════════════════════════════════════════
// FAILED RENDERER
// ═══════════════════════════════════════════════════════════════════
/** @param {GameState} state */
export function renderFailed(state) {
  renderGuessGrid(state);
  renderStatusBar(state);

  const banner = document.getElementById('result-banner');
  if (banner) {
    banner.className = 'result-banner failed show anim-fade';
    banner.textContent = '✗ No solution found in 6 guesses';
  }
  const bestWordEl = document.getElementById('best-word');
  if (bestWordEl) {
    bestWordEl.className = 'failed';
    bestWordEl.textContent = 'FAILED';
  }
  const recLabel = document.querySelector('#recommendation .rec-label');
  if (recLabel) recLabel.textContent = 'Game Over';
  const bestScore = document.getElementById('best-score');
  if (bestScore) bestScore.textContent = `${state.candidates?.length ?? 0} candidates still possible`;

  const input = document.getElementById('word-input');
  if (input) { input.value = ''; input.disabled = true; }
  disableTiles(true);
  _setBtn('calculate-btn', { disabled: true });
  _setBtn('undo-btn',      { disabled: true });
  _setBtn('reset-btn',     { disabled: false });
  _setBtn('new-game-btn',  { disabled: false });
  clearInputError();
}

// ═══════════════════════════════════════════════════════════════════
// CALCULATE HANDLER (primary game action)
// ═══════════════════════════════════════════════════════════════════
export function onCalculate() {
  clearInputError();
  const input = document.getElementById('word-input');
  const guess = (input?.value ?? '').trim().toLowerCase();

  // Validate length
  if (guess.length !== 5) {
    showInputError('Please enter exactly 5 letters.');
    _shakeInput();
    return;
  }

  // Read pattern from tiles
  const pattern = readTilePattern();

  // Submit to solver
  const result = submitGuess(guess, pattern);
  if (result.error) {
    showInputError(result.error);
    _shakeInput();
    return;
  }

  _currentGameResult = result;
  if (result.solved) {
    renderSolved(result.state);
    // Auto-archive to history on solve
    archiveCurrentGame(result.state);
  } else if (result.failed) {
    renderFailed(result.state);
    archiveCurrentGame(result.state);
  } else {
    renderResult(result);
  }
}

// ═══════════════════════════════════════════════════════════════════
// UNDO HANDLER
// ═══════════════════════════════════════════════════════════════════
export function onUndo() {
  const state = undoLastGuess();
  if (!state) return;

  renderGuessGrid(state);
  renderStatusBar(state);
  renderSmartCandidatePanel(state);

  // Restore the undone guess word as input
  const prevGuess = state.guesses[state.guesses.length - 1] ?? getOpener().word;
  const input = document.getElementById('word-input');
  if (input) { input.value = prevGuess; input.disabled = false; }
  disableTiles(false);
  resetTiles();
  _updateTileLetters();

  // After undo: stack is empty (depth-1 limit)
  _setBtn('undo-btn', { disabled: true });
  _setBtn('calculate-btn', { disabled: false });

  const banner = document.getElementById('result-banner');
  if (banner) { banner.className = 'result-banner'; banner.textContent = ''; }

  if (state.guesses.length === 0) {
    renderRound1();
  } else {
    const bestWordEl = document.getElementById('best-word');
    if (bestWordEl) { bestWordEl.className = ''; bestWordEl.textContent = prevGuess.toUpperCase(); }
    const recLabel = document.querySelector('#recommendation .rec-label');
    if (recLabel) recLabel.textContent = 'Undo — Re-enter feedback';
    const bestScore = document.getElementById('best-score');
    if (bestScore) bestScore.textContent = `${state.candidates?.length ?? '?'} candidates remaining`;
  }

  renderCandidateList(state);
  clearInputError();
}

// ═══════════════════════════════════════════════════════════════════
// RESET GAME (clears current game, keeps history)
// ═══════════════════════════════════════════════════════════════════
export function onReset() {
  const state = getSolverState();
  if (state.guesses.length === 0) {
    initGame();
    renderRound1();
    return;
  }
  showConfirmModal({
    title: 'Reset this game?',
    message: 'Your guess history will be saved but this game\'s progress will be lost.',
    confirmLabel: 'Reset',
    confirmClass: '',
    onConfirm: () => {
      archiveCurrentGame(state);
      initGame();
      renderRound1();
    },
  });
}

// ═══════════════════════════════════════════════════════════════════
// NEW GAME (archives current, increments game count)
// ═══════════════════════════════════════════════════════════════════
export function onNewGame() {
  const state = getSolverState();
  if (state.guesses.length === 0) {
    initGame();
    renderRound1();
    return;
  }
  showConfirmModal({
    title: 'Start a new game?',
    message: 'This will archive the current game.',
    confirmLabel: 'New Game',
    confirmClass: 'safe',
    onConfirm: () => {
      // Only archive if game is still in progress — solved/failed games
      // are already archived by onCalculate() at the moment of resolution
      if (!state.solved && !state.failed) {
        archiveCurrentGame(state);
      }
      initGame();
      renderRound1();
    },
  });
}

// ═══════════════════════════════════════════════════════════════════
// CONFIRMATION MODAL (§6.4)
// ═══════════════════════════════════════════════════════════════════
function showConfirmModal({ title, message, confirmLabel, confirmClass, onConfirm }) {
  const modal = document.getElementById('confirm-modal');
  if (!modal) return;
  modal.innerHTML = `
    <div class="modal-header">
      <span class="modal-title">${_escape(title)}</span>
      <button class="modal-close" aria-label="Close">✕</button>
    </div>
    <div class="modal-body">
      <p class="confirm-msg">${_escape(message)}</p>
    </div>
    <div class="modal-footer">
      <div class="confirm-actions">
        <button class="btn-cancel" id="modal-cancel">Cancel</button>
        <button class="btn-confirm ${confirmClass ?? ''}" id="modal-confirm">${_escape(confirmLabel)}</button>
      </div>
    </div>
  `;
  modal.querySelector('.modal-close').addEventListener('click', () => modal.close());
  modal.querySelector('#modal-cancel').addEventListener('click',  () => modal.close());
  modal.querySelector('#modal-confirm').addEventListener('click', () => {
    modal.close();
    onConfirm();
  });
  modal.showModal();
}

// ═══════════════════════════════════════════════════════════════════
// SETTINGS PANEL
// ═══════════════════════════════════════════════════════════════════
function openSettingsPanel() {
  const modal = document.getElementById('settings-modal');
  if (!modal) return;
  const s = _settings;
  modal.innerHTML = `
    <div class="modal-header">
      <span class="modal-title">Settings</span>
      <button class="modal-close" aria-label="Close">✕</button>
    </div>
    <div class="modal-body">
      <div class="setting-row">
        <div class="setting-info">
          <span class="setting-name">Analysis Mode</span>
          <span class="setting-desc">Show alternatives, scores, and candidate list</span>
        </div>
        <label class="toggle" aria-label="Toggle analysis mode">
          <input type="checkbox" id="tog-analysis" ${s.mode === 'analysis' ? 'checked' : ''}>
          <span class="toggle-track"></span>
        </label>
      </div>
      <div class="setting-divider"></div>
      <div class="setting-row">
        <div class="setting-info">
          <span class="setting-name">Colour-Blind Mode</span>
          <span class="setting-desc">Replaces green/yellow with blue/orange</span>
        </div>
        <label class="toggle" aria-label="Toggle colour-blind mode">
          <input type="checkbox" id="tog-colourblind" ${s.colourBlind ? 'checked' : ''}>
          <span class="toggle-track"></span>
        </label>
      </div>
      <div class="setting-divider"></div>
      <div class="setting-row">
        <div class="setting-info">
          <span class="setting-name">Hard Mode</span>
          <span class="setting-desc">Restrict guesses to words consistent with known clues</span>
        </div>
        <label class="toggle" aria-label="Toggle hard mode">
          <input type="checkbox" id="tog-hard" ${s.hardMode ? 'checked' : ''}>
          <span class="toggle-track"></span>
        </label>
      </div>
      <div class="setting-divider"></div>
      <div class="setting-row" style="justify-content:center">
        <button class="tutorial-btn secondary" id="settings-tutorial-btn">View Tutorial</button>
      </div>
      <p class="setting-version">
        Word list: Official Wordle (${ANSWER_SIZE.toLocaleString()} answers,
        ${VOCAB_SIZE.toLocaleString()} guesses)<br>
        Opener: RAISE · Hash: ${VERSION_HASH.slice(0, 8)}
      </p>
    </div>
  `;
  modal.querySelector('.modal-close').addEventListener('click', () => modal.close());
  modal.querySelector('#tog-analysis').addEventListener('change', e => {
    _settings.mode = e.target.checked ? 'analysis' : 'simple';
    saveSettings(_settings);
  });
  modal.querySelector('#tog-colourblind').addEventListener('change', e => {
    _settings.colourBlind = e.target.checked;
    saveSettings(_settings);
  });
  modal.querySelector('#tog-hard').addEventListener('change', e => {
    _settings.hardMode = e.target.checked;
    saveSettings(_settings);
  });
  modal.querySelector('#settings-tutorial-btn').addEventListener('click', () => {
    modal.close();
    openTutorial();
  });
  modal.showModal();
}

// ═══════════════════════════════════════════════════════════════════
// TUTORIAL (§5.5 — 3 steps, skippable)
// ═══════════════════════════════════════════════════════════════════
const TUTORIAL_STEPS = [
  {
    heading: 'Your Opening Move',
    body: `LEXICON recommends <strong>RAISE</strong> as your opener — it's the
           statistically optimal first guess, tested against all 2,314 answers
           using our expected-residual minimisation model.`,
    example: [
      { letter: 'R', state: 'grey' },
      { letter: 'A', state: 'yellow' },
      { letter: 'I', state: 'grey' },
      { letter: 'S', state: 'grey' },
      { letter: 'E', state: 'green' },
    ],
  },
  {
    heading: 'Enter Wordle Feedback',
    body: `After guessing in Wordle, tap each tile to cycle its colour:
           <strong>Grey → Yellow → Green</strong>. Match the colours Wordle
           showed you. Tap "Calculate Next Step" to get your next suggestion.`,
    example: [
      { letter: '?', state: 'grey' },
      { letter: '?', state: 'yellow' },
      { letter: '?', state: 'green' },
      { letter: '?', state: 'grey' },
      { letter: '?', state: 'grey' },
    ],
  },
  {
    heading: 'Reading the Results',
    body: `LEXICON shows the next guess that minimises expected remaining candidates.
           Enable <strong>Analysis Mode</strong> in Settings to see the top 5
           alternatives, percentage scores, and the full candidate list.`,
    example: null,
  },
];

let _tutorialStep = 0;

export function openTutorial() {
  const modal = document.getElementById('tutorial-modal');
  if (!modal) return;
  _tutorialStep = 0;
  _renderTutorialStep(modal);
  modal.showModal();
}

function _renderTutorialStep(modal) {
  const step   = TUTORIAL_STEPS[_tutorialStep];
  const total  = TUTORIAL_STEPS.length;
  const isLast = _tutorialStep === total - 1;

  const exampleHTML = step.example
    ? `<div class="tutorial-example">
        ${step.example.map(t =>
          `<div class="tutorial-tile ${t.state}">${t.letter}</div>`
        ).join('')}
       </div>`
    : '';

  const dotsHTML = TUTORIAL_STEPS.map((_, i) =>
    `<span class="tutorial-dot ${i === _tutorialStep ? 'active' : ''}"></span>`
  ).join('');

modal.innerHTML = `
    <div class="modal-header">
      <span class="modal-title">Tutorial</span>
    </div>
    <div class="modal-body">
      <div class="tutorial-step active">
        <p class="tutorial-step-num">Step ${_tutorialStep + 1} of ${total}</p>
        <p class="tutorial-heading">${step.heading}</p>
        <p class="tutorial-body">${step.body}</p>
        ${exampleHTML}
        <div class="tutorial-nav">
          <button class="tutorial-btn secondary" id="tut-skip">Skip</button>
          <div class="tutorial-dots">${dotsHTML}</div>
          <button class="tutorial-btn" id="tut-next">${isLast ? 'Got it!' : 'Next →'}</button>
        </div>
      </div>
    </div>
  `;

  modal.querySelector('#tut-skip').addEventListener('click', () => {
    modal.close();
    _settings.hasSeenTutorial = true;
    saveSettings(_settings);
  });
  modal.querySelector('#tut-next').addEventListener('click', () => {
    if (isLast) {
      modal.close();
      _settings.hasSeenTutorial = true;
      saveSettings(_settings);
    } else {
      _tutorialStep++;
      _renderTutorialStep(modal);
    }
  });
}

// ═══════════════════════════════════════════════════════════════════
// HISTORY TAB
// ═══════════════════════════════════════════════════════════════════
function renderHistoryTab() {
  const list = document.getElementById('history-list');
  if (!list) return;
  const history = loadHistory().reverse();
  if (history.length === 0) {
    list.innerHTML = '<p class="history-empty">No games recorded yet.<br>Complete a game to see history.</p>';
    return;
  }
  list.innerHTML = '';
  history.forEach(entry => {
    const div = document.createElement('div');
    div.className = 'history-entry anim-fade';
    const date = new Date(entry.timestamp).toLocaleString();
    const result = entry.solved
      ? `<span class="history-result won">${entry.guessCount} ${entry.guessCount === 1 ? 'guess' : 'guesses'}</span>`
      : `<span class="history-result lost">Failed</span>`;
    div.innerHTML = `
      <div class="history-meta">
        <span>Game #${entry.gameNumber}</span>
        <span>${date}</span>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <div class="history-guesses">${entry.guesses.map(g => g.toUpperCase()).join(' · ')}</div>
        ${result}
      </div>
    `;
    list.appendChild(div);
  });
}

// ═══════════════════════════════════════════════════════════════════
// STATS TAB
// ═══════════════════════════════════════════════════════════════════
function renderStatsTab() {
  const history = loadHistory();
  const grid    = document.getElementById('stats-grid');
  const dist    = document.getElementById('dist-chart');
  if (!grid || !dist) return;

  const played  = history.length;
  const won     = history.filter(e => e.solved).length;
  const winRate = played > 0 ? Math.round((won / played) * 100) : 0;
  const guesses = history.filter(e => e.solved).map(e => e.guessCount);
  const avg     = guesses.length > 0
    ? (guesses.reduce((a, b) => a + b, 0) / guesses.length).toFixed(2)
    : '—';

  // Stat boxes
  grid.innerHTML = [
    { value: played,      label: 'Played' },
    { value: `${winRate}%`, label: 'Win Rate' },
    { value: avg,         label: 'Avg Guesses' },
    { value: won,         label: 'Wins' },
  ].map(s => `
    <div class="stat-box">
      <div class="stat-value">${s.value}</div>
      <div class="stat-label">${s.label}</div>
    </div>
  `).join('');

  // Distribution
  const distribution = [1, 2, 3, 4, 5, 6].map(n => ({
    count: guesses.filter(g => g === n).length,
    n,
  }));
  const maxCount  = Math.max(1, ...distribution.map(d => d.count));
  const lastGuess = guesses.length > 0 ? guesses[guesses.length - 1] : null;

  dist.innerHTML = '';
  const distTitle = document.createElement('p');
  distTitle.style.cssText = 'font-size:11px;letter-spacing:1px;text-transform:uppercase;color:var(--text-muted);margin-bottom:4px;';
  distTitle.textContent = 'Guess Distribution';
  dist.appendChild(distTitle);

  distribution.forEach(({ count, n }) => {
    const row = document.createElement('div');
    row.className = 'dist-bar-row';
    const pct = Math.max(8, Math.round((count / maxCount) * 100));
    const isCurrent = n === lastGuess;
    row.innerHTML = `
      <span class="dist-label">${n}</span>
      <div class="dist-bar-wrap">
        <div class="dist-bar ${isCurrent ? 'current' : ''}" style="width:${pct}%">
          <span>${count}</span>
        </div>
      </div>
    `;
    dist.appendChild(row);
  });
}

// ═══════════════════════════════════════════════════════════════════
// BOTTOM NAV TABS
// ═══════════════════════════════════════════════════════════════════
function setupTabNavigation() {
  const nav = document.getElementById('bottom-nav');
  if (!nav) return;
  nav.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      if (!tab || tab === _activeTab) return;
      _activeTab = tab;
      nav.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
      ['solver', 'history', 'stats'].forEach(panelId => {
        const panel = document.getElementById(`${panelId}-panel`);
        if (panel) panel.classList.toggle('active', panelId === tab);
      });
      if (tab === 'history') renderHistoryTab();
      if (tab === 'stats')   renderStatsTab();
    });
  });
}

// ═══════════════════════════════════════════════════════════════════
// EVENT WIRING
// ═══════════════════════════════════════════════════════════════════
function wireEvents() {
  document.getElementById('calculate-btn')?.addEventListener('click', onCalculate);
  document.getElementById('undo-btn')?.addEventListener('click', onUndo);
  document.getElementById('reset-btn')?.addEventListener('click', onReset);
  document.getElementById('new-game-btn')?.addEventListener('click', onNewGame);
  document.getElementById('settings-btn')?.addEventListener('click', openSettingsPanel);
  document.getElementById('help-btn')?.addEventListener('click', openTutorial);

  const input = document.getElementById('word-input');
  if (input) {
    input.addEventListener('input', () => {
      clearInputError();
      _updateTileLetters();
    });
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') onCalculate();
    });
  }
}

// ═══════════════════════════════════════════════════════════════════
// ERROR DISPLAY HELPERS
// ═══════════════════════════════════════════════════════════════════
export function showInputError(message) {
  const el = document.getElementById('input-error');
  if (!el) return;
  el.textContent = message;
  el.style.display = 'block';
}

export function clearInputError() {
  const el = document.getElementById('input-error');
  if (el) { el.textContent = ''; el.style.display = 'none'; }
}

function _shakeInput() {
  const input = document.getElementById('word-input');
  if (!input) return;
  input.classList.remove('anim-shake');
  void input.offsetWidth; // force reflow
  input.classList.add('anim-shake');
  input.addEventListener('animationend', () => input.classList.remove('anim-shake'), { once: true });
}

// ═══════════════════════════════════════════════════════════════════
// BUTTON HELPERS
// ═══════════════════════════════════════════════════════════════════
function _setBtn(id, { disabled } = {}) {
  const btn = document.getElementById(id);
  if (!btn) return;
  if (disabled !== undefined) {
    btn.disabled = disabled;
    btn.setAttribute('aria-disabled', String(disabled));
  }
}

// ═══════════════════════════════════════════════════════════════════
// MISC UTILITIES
// ═══════════════════════════════════════════════════════════════════
function _escape(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ═══════════════════════════════════════════════════════════════════
// INIT — Entry Point
// ═══════════════════════════════════════════════════════════════════
/**
 * Application entry point. Called from index.html.
 * Bootstraps the full UI, loads the matrix, and renders round 1.
 *
 * @example
 *   // index.html:
 *   import { init } from './js/ui.js';
 *   import { get, set, del } from 'https://cdn.jsdelivr.net/npm/idb-keyval@6/+esm';
 *   import { _setCache } from './js/matrix_loader.js';
 *   _setCache({ get, set, del });
 *   init();
 */
export async function init() {
  // 1. Inject styles and build DOM scaffold
  injectStyles();
  buildDOMScaffold();

  // 2. Load persisted settings and apply immediately
  _settings = loadSettings();
  applyMode(_settings.mode);
  applyColourBlind(_settings.colourBlind);

  // 3. Build tile row in input section
  buildTileRow();

  // 4. Set up tab navigation and event handlers
  setupTabNavigation();
  wireEvents();

  // 5. Ensure words hash is ready (for VERSION_HASH display)
  await wordsReady;

  // 6. Load / build the pattern matrix
  renderLoading(0, 'Loading word database…');
  let matrix;
  try {
    matrix = await loadMatrix((pct, phase) => {
      renderLoading(pct, phase ?? 'Loading…');
    });
  } catch (err) {
    renderError('Failed to load word database. Please refresh the page.');
    return;
  }

  // 7. Configure solver with loaded matrix and word lists
  configure({
    vocabulary: VOCABULARY,
    answers:    ANSWERS,
    matrix,
  });

  // 8. Initialise game state
  initGame();

  // 9. Hide loading overlay (150ms fade)
  hideLoadingOverlay();

  // 10. Render Round 1
  renderRound1();

  // 11. Show tutorial if first visit
  if (!_settings.hasSeenTutorial) {
    setTimeout(openTutorial, 500);
  }
}

// ═══════════════════════════════════════════════════════════════════
// NAMED EXPORTS (for testing and direct invocation)
// ═══════════════════════════════════════════════════════════════════
export {
  loadSettings,
  saveSettings,
  applyMode,
  applyColourBlind,
  loadHistory,
  saveHistory,
  archiveCurrentGame,
  showConfirmModal,
  openSettingsPanel,
  CANDIDATE_CLICK_THRESHOLD,   // exported for test verification
};
