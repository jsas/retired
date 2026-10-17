import { prefKV } from './prefKv';

/**
 * Lever range prefs (BETA-MAP.md §2).
 *
 * The four axes that can conceivably "run away" — spending, savings, expected
 * return, volatility — read their slider min/max from here so a Settings page
 * can widen or narrow them as a preference. Retirement age, max age, CPP and
 * OAS start ages stay fixed; a fixed span is part of their meaning.
 *
 * Values live in prefKV under `wealthconsole_ranges` so they survive backup /
 * restore with the rest of the UI prefs. Any field left unset falls back to
 * the engine's own constraint range (eqConstraints AXES), so a partial or
 * stale pref can never produce a broken slider.
 */

export const RANGES_PREF_KEY = 'wealthconsole_ranges';

export interface RangePrefs {
  spendingMax: number;
  savingsMax: number;
  returnMin: number; // fraction, e.g. 0 = 0%
  returnMax: number;
  volatilityMax: number; // fraction, e.g. 0.3 = 30%
}

export const DEFAULT_RANGE_PREFS: RangePrefs = {
  spendingMax: 300_000,
  savingsMax: 500_000,
  returnMin: 0,
  returnMax: 0.2,
  volatilityMax: 0.3,
};

const NUMERIC_FIELDS: readonly (keyof RangePrefs)[] = [
  'spendingMax', 'savingsMax', 'returnMin', 'returnMax', 'volatilityMax',
];

export function getRangePrefs(): RangePrefs {
  try {
    const raw = prefKV().getItem(RANGES_PREF_KEY);
    if (!raw) return { ...DEFAULT_RANGE_PREFS };
    const parsed = JSON.parse(raw) as Partial<Record<keyof RangePrefs, unknown>>;
    const out = { ...DEFAULT_RANGE_PREFS };
    for (const key of NUMERIC_FIELDS) {
      const v = parsed[key];
      if (typeof v === 'number' && Number.isFinite(v) && v >= 0) out[key] = v;
    }
    // Keep each axis internally ordered even if a hand-edited pref inverts it.
    if (out.returnMax <= out.returnMin) out.returnMax = DEFAULT_RANGE_PREFS.returnMax;
    return out;
  } catch {
    return { ...DEFAULT_RANGE_PREFS };
  }
}

export function setRangePrefs(patch: Partial<RangePrefs>): RangePrefs {
  const next = { ...getRangePrefs(), ...patch };
  prefKV().setItem(RANGES_PREF_KEY, JSON.stringify(next));
  return next;
}

/**
 * The prefs as a steering-axis range override — the shape renderRange/
 * reconcileControl take. Maps the four user-tunable axes onto their EQ axis
 * names; the fixed-span axes (retirement age, plan-to age, CPP/OAS start)
 * stay absent, per the Settings page's own promise. Kept here (not in
 * engine-core) so the engine never reads browser prefs.
 */
export function rangePrefsOverride(): Partial<Record<
  'desiredSpending' | 'annualSavings' | 'investmentReturn' | 'returnVolatility',
  { min: number; max: number }
>> {
  const r = getRangePrefs();
  return {
    desiredSpending: { min: 0, max: r.spendingMax },
    annualSavings: { min: 0, max: r.savingsMax },
    investmentReturn: { min: r.returnMin, max: r.returnMax },
    returnVolatility: { min: 0, max: r.volatilityMax },
  };
}
