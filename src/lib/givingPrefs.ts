import { prefKV } from './prefKv';

/**
 * Giving defaults (issue #164).
 *
 * The prefilled mode for a NEW charitable-giving stream on the Details page:
 * most pledges are a percentage of income, so the editor starts there — but
 * how big the pledge is and whether the percent rides on gross or after-tax
 * income is personal. These are UI preferences (like the lever ranges), not
 * engine settings: they shape a form's initial values, never the math, and
 * save the moment they change.
 *
 * `defaultPct` is in PERCENTAGE POINTS (5 = 5%), matching GivingStream.pct.
 * Values live in prefKV under `wealthconsole_giving` so they ride along with
 * backup/restore like the other UI prefs.
 */

export const GIVING_PREF_KEY = 'wealthconsole_giving';

export interface GivingPrefs {
  defaultPct: number;
  defaultBasis: 'gross' | 'net';
}

export const DEFAULT_GIVING_PREFS: GivingPrefs = {
  defaultPct: 5,
  defaultBasis: 'gross',
};

export function getGivingPrefs(): GivingPrefs {
  try {
    const raw = prefKV().getItem(GIVING_PREF_KEY);
    if (!raw) return { ...DEFAULT_GIVING_PREFS };
    const parsed = JSON.parse(raw) as Partial<Record<keyof GivingPrefs, unknown>>;
    const out = { ...DEFAULT_GIVING_PREFS };
    const pct = parsed.defaultPct;
    if (typeof pct === 'number' && Number.isFinite(pct) && pct >= 0 && pct <= 100) out.defaultPct = pct;
    if (parsed.defaultBasis === 'gross' || parsed.defaultBasis === 'net') out.defaultBasis = parsed.defaultBasis;
    return out;
  } catch {
    return { ...DEFAULT_GIVING_PREFS };
  }
}

export function setGivingPrefs(patch: Partial<GivingPrefs>): GivingPrefs {
  const next = { ...getGivingPrefs(), ...patch };
  prefKV().setItem(GIVING_PREF_KEY, JSON.stringify(next));
  return next;
}
