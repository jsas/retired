/**
 * Design tokens — the single source of truth for the app's visual
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
export const WASH = '#fbfbfa';        // barely-off-white page bg (Dashboard)

/** The verdict behind a dot, chip or bar. `neutral` / `checking` are the
 *  no-verdict-yet states, so every tone the UI can name maps to one colour. */
export type Tone = 'holds' | 'short' | 'borderline' | 'neutral' | 'checking';

/** One tone, one colour — shared by `Chip`, the verdict dot and any future
 *  surface so a verdict can never render two different blues. */
export function toneColor(tone: Tone): string {
  return tone === 'holds' ? BLUE
    : tone === 'short' ? RED_DOT
    : tone === 'borderline' ? AMBER_DOT
    : FAINT;
}

/** The one number that must always be tabular. */
export const NUM_CLASS = 'num';

/** Shared class fragments so components and the style guide agree.
 *
 *  Each fragment is *complete for the properties it sets*: never stack a second
 *  `px-3` / `text-xs` / `text-slate-700` next to one of these to change its
 *  mind. Tailwind resolves same-specificity utilities by stylesheet order, not
 *  by the order they appear in `className`, so the override may or may not
 *  win. A control that needs a different size takes the variant that already
 *  exists, and a control that needs a size nothing repeats keeps its own
 *  literal recipe (and says so in a comment).
 *
 *  The variants are the sizes the app actually repeats, measured over the
 *  pages: `_Sm` / `_Xs` are the compact scales the Details, Connections, Data,
 *  Settings and assistant-rail surfaces grew, not new designs. */
export const cls = {
  sectionLabel:
    'text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400',

  // Buttons. The hairline pair is the secondary action; the primary trio is
  // the one dark call-to-action at three densities.
  hairlineBtn:
    'border border-slate-300 px-3 py-1.5 text-xs text-slate-600 hover:border-slate-900 hover:text-slate-900',
  hairlineBtnSm:
    'border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:border-slate-900 hover:text-slate-900',
  primaryBtn:
    'bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700',
  primaryBtnSm:
    'bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700',
  primaryBtnXs:
    'bg-slate-900 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-slate-700',
  // A CTA that is disabled keeps the primary's box and loses its voice: the
  // same rectangle, hairline instead of fill, grey text. Pair it with the
  // real `disabled` attribute (see PrintOptionsCard, SharingPage).
  disabledBtn:
    'border border-slate-200 px-4 py-2 text-sm font-medium text-slate-400',

  // Fields. `input` is a full-size form field, `inputSm` the dense one the
  // plan/Details editors and the `Num` primitive use, `numField` a compact
  // numeric box — tabular figures (`num`), no fill of its own: it inherits the
  // panel behind it, so `bg-white` stays with the sites that want one, and
  // monospace stays a taste (`${cls.numField} font-mono`) rather than law.
  input:
    'border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:outline-none',
  inputSm:
    'border border-slate-300 bg-white px-2 py-1.5 text-[13px] text-slate-900 focus:border-slate-900 focus:outline-none',
  numField:
    'num border border-slate-300 px-2 py-1 text-xs focus:border-slate-900 focus:outline-none',

  // Surfaces: the card, the same hairline with no fill, the recessed note.
  panel: 'bg-white border border-slate-200',
  panelBare: 'border border-slate-200',
  panelTinted: 'bg-slate-50 border border-slate-200',

  // Small labels: dark-on-light counters, and their hairline twin.
  badgeDark: 'bg-slate-900 px-1 py-0.5 text-[9px] font-semibold text-white',
  badgeHairline:
    'border border-slate-200 px-1 py-0.5 text-[9px] font-semibold text-slate-500',

  // The "RE:" monogram, identical wherever it appears.
  mark: 'flex h-6 w-6 shrink-0 items-center justify-center bg-slate-900 text-[10px] font-bold text-white',
} as const;
