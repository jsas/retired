/**
 * Design tokens — the single source of truth for the beta skin's visual
 * language. These are plain constants (not Tailwind theme overrides) so the
 * engine-adjacent code (SVG fills, canvas, chart strokes) and the style guide
 * can read the same values the components use.
 *
 * The vocabulary, distilled from the f7 finalist:
 *   - flat: no shadows, no rounded corners (browser defaults are left alone)
 *   - hairline: structure comes from 1px borders, never boxes or cards
 *   - one accent: blue says "the plan holds"; red says "runs out early";
 *     amber is reserved for the borderline case only — never a traffic light
 *   - text does the work: weight and slate tint carry hierarchy, not chrome
 */

export const BLUE = '#1d4ed8';        // the plan holds (blue-700)
export const BLUE_DEEP = '#1e3a8a';   // the wash's deep end (blue-900)
export const BLUE_WASH_FROM = 0.05;   // holdWash gradient stops (alpha)
export const BLUE_WASH_TO = 0.20;

export const RED_TEXT = '#be123c';    // runs out early (rose-700)
export const RED_DOT = '#f43f5e';     // the dot / chip when short (rose-500)

export const AMBER_TEXT = '#b45309';  // borderline, sparing (amber-700)
export const AMBER_DOT = '#f59e0b';   // borderline dot / chip (amber-500)

export const INK = '#0f172a';         // slate-900 — headings, primary buttons
export const BODY = '#1e293b';        // slate-800 — body text
export const MUTED = '#64748b';       // slate-500 — secondary text
export const FAINT = '#94a3b8';       // slate-400 — captions, axis labels
export const HAIRLINE = '#e2e8f0';    // slate-200 — the 1px structural border
export const HAIRLINE_STRONG = '#cbd5e1'; // slate-300 — input borders
export const PAPER = '#ffffff';       // the ground; the app is paper-white
export const WASH = '#fbfbfa';        // barely-off-white page bg (BetaApp)

/** Type scale (px) — small, tight, num-aligned. Matches the mock's sizes. */
export const TEXT = {
  verdict: 28,      // the one-number answer, md+
  section: 11,      // uppercase section labels, tracking 0.16em
  label: 13,        // control labels
  body: 13.5,       // prose lines
  caption: 11,      // footnotes, legends
} as const;

/** The one number that must always be tabular. */
export const NUM_CLASS = 'num';

/** Shared class fragments so components and the style guide agree. */
export const cls = {
  sectionLabel:
    'text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400',
  hairlineBtn:
    'border border-slate-300 px-3 py-1.5 text-xs text-slate-600 hover:border-slate-900 hover:text-slate-900',
  primaryBtn:
    'bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700',
  input:
    'border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:outline-none',
} as const;
