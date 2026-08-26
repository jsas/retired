// Persist the EQ steering surface (control crops) to localStorage so the page
// restores exactly as left.
//
// Crops are stored as AXIS-FRACTION SCALARS (0..1 of the axis range), NOT
// absolute values. That decouples a saved crop from the axis min/max shown in
// the UI: if an axis's range ever changes (or differs across scenarios), a crop
// saved as "the middle 60%" still means the middle 60% — rehydrated by scaling
// back onto whatever the axis's current range is.
import { AXES, fullBand, normalizeBand, type Band, type EqAxis } from './eqConstraints';

const STORAGE_KEY = 'wealthconsole_eq';

/** A crop as axis fractions: 0 = axis min, 1 = axis max. */
export interface BandFrac {
  lo: number;
  hi: number;
}

export const ALL_EQ_AXES: EqAxis[] = [
  'desiredSpending', 'retirementAge', 'investmentReturn',
  'maxAge', 'annualSavings', 'returnVolatility', 'cppStartAge', 'oasStartAge',
];

export type EqBands = Record<EqAxis, Band>;

/** Convert an absolute crop to axis fractions (0..1). */
export function bandToFrac(axis: EqAxis, band: Band): BandFrac {
  const s = AXES[axis];
  const n = normalizeBand(axis, band);
  const span = s.max - s.min;
  return span === 0
    ? { lo: 0, hi: 1 }
    : { lo: (n.min - s.min) / span, hi: (n.max - s.min) / span };
}

/** Scale axis fractions back onto the axis's current absolute range. */
export function bandFromFrac(axis: EqAxis, frac: BandFrac): Band {
  const s = AXES[axis];
  const span = s.max - s.min;
  const lo = Math.min(1, Math.max(0, frac.lo));
  const hi = Math.min(1, Math.max(0, frac.hi));
  return normalizeBand(axis, { min: s.min + lo * span, max: s.min + hi * span });
}

export function defaultEqBands(): EqBands {
  const bands = {} as EqBands;
  for (const a of ALL_EQ_AXES) bands[a] = fullBand(a);
  return bands;
}

/** Persist the crops, encoding each as axis-fraction scalars. */
export function saveEqBands(bands: EqBands): void {
  try {
    const bandsFrac: Record<string, BandFrac> = {};
    for (const a of ALL_EQ_AXES) bandsFrac[a] = bandToFrac(a, bands[a] ?? fullBand(a));
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ bandsFrac }));
  } catch (err) {
    console.warn('Failed to persist EQ state to localStorage:', err);
  }
}

/** Load the crops, scaling saved fractions onto the current axis ranges. */
export function loadEqBands(): EqBands {
  const fallback = defaultEqBands();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as { bandsFrac?: Record<string, BandFrac> };
    const bands = {} as EqBands;
    for (const a of ALL_EQ_AXES) {
      const f = parsed.bandsFrac?.[a];
      bands[a] = f && typeof f.lo === 'number' && typeof f.hi === 'number'
        ? bandFromFrac(a, f)
        : fullBand(a);
    }
    return bands;
  } catch {
    return fallback;
  }
}
