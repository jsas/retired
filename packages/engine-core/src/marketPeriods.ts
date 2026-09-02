// Market-hypothesis curve builder (issue #138).
//
// A plan may carry an ordered set of `MarketPeriod` anchors (per-age expected
// return, optionally per-age volatility). This module turns those anchors into
// the per-age sequences the engine and Monte Carlo consume. The curve is
// PIECEWISE-LINEAR between anchors with CLAMPED ENDS: inside the outermost
// anchors the value is linearly interpolated; before the first and after the
// last anchor the supplied flat baseline (`investmentReturn` /
// `returnVolatility`) holds — so a hypothesis that covers only part of the
// horizon (say, a crash window) degrades gracefully to the constants
// everywhere else.
//
// `buildReturnSequence` / `buildVolatilitySequence` return `undefined` when
// there is nothing to interpolate (no usable anchors), so callers can write
// `options.returnSequence ?? buildReturnSequence(...)` and stay on the
// constant path untouched when the feature is off. That no-op-when-absent is
// what keeps the golden master byte-identical for every existing plan.

import type { MarketPeriod } from './retirementEngine';

/**
 * Sort anchors by age, drop unusable ones (non-finite age/value), and collapse
 * duplicate ages to the LAST occurrence (later edits win) so interpolation
 * never divides by a zero age-gap. Volatility is clamped to ≥ 0.
 */
function normalize(periods: MarketPeriod[] | undefined): MarketPeriod[] {
  if (!Array.isArray(periods)) return [];
  const usable = periods.filter(
    p => p && Number.isFinite(p.age) && Number.isFinite(p.return),
  );
  const byAge = new Map<number, MarketPeriod>();
  for (const p of usable) {
    byAge.set(p.age, {
      ...p,
      volatility:
        p.volatility != null && Number.isFinite(p.volatility)
          ? Math.max(0, p.volatility)
          : undefined,
    });
  }
  return [...byAge.values()].sort((a, b) => a.age - b.age);
}

/**
 * Linear interpolation over sorted anchors at integer `age`. A hypothesis is a
 * LOCAL regime, not a whole-horizon re-rating, so outside the outermost anchors
 * the value returns to the plan's `fallback` constant — and it does so over a
 * ONE-YEAR ramp from the edge anchor's value back to the constant, rather than
 * a vertical cliff at the anchor's age. `pick` selects which field the curve
 * reads (return, or volatility); a missing field falls back to the constant.
 */
function valueAt(
  anchors: MarketPeriod[],
  age: number,
  fallback: number,
  pick: (p: MarketPeriod) => number | undefined,
): number {
  if (anchors.length === 0) return fallback;
  const first = anchors[0];
  const last = anchors[anchors.length - 1];

  // Beyond the hypothesis window: the flat constant holds.
  if (age < first.age - 1 || age > last.age + 1) return fallback;

  // One-year ramp at the leading edge: first.age-1 lerps the constant to the
  // first anchor's value, so the regime eases in instead of stepping.
  if (age === first.age - 1) {
    const v = pick(first) ?? fallback;
    return (fallback + v) / 2;
  }
  // One-year ramp at the trailing edge: last.age+1 lerps back to the constant.
  if (age === last.age + 1) {
    const v = pick(last) ?? fallback;
    return (fallback + v) / 2;
  }

  // Exact hit, or a single anchor (first === last): no interpolation needed.
  const exact = anchors.find(p => p.age === age);
  if (exact) return pick(exact) ?? fallback;

  // Walk to the bracketing pair. Anchors are sorted and deduped by age.
  for (let i = 0; i < anchors.length - 1; i++) {
    const a = anchors[i];
    const b = anchors[i + 1];
    if (age > a.age && age < b.age) {
      const av = pick(a);
      const bv = pick(b);
      // A missing endpoint value (e.g. volatility set on only one anchor)
      // falls back to the constant for that side, so a sparse curve still
      // produces a sensible lerp rather than NaN.
      const lo = av ?? fallback;
      const hi = bv ?? fallback;
      const t = (age - a.age) / (b.age - a.age);
      return lo + (hi - lo) * t;
    }
  }
  return fallback;
}

/**
 * Build the per-age expected-return sequence for `[startAge, maxAge]` from the
 * plan's market periods. Returns `undefined` when there are no usable anchors
 * so the caller falls back to the flat `investmentReturn` untouched.
 */
export function buildReturnSequence(
  periods: MarketPeriod[] | undefined,
  startAge: number,
  maxAge: number,
  baseReturn: number,
): Record<number, number> | undefined {
  const anchors = normalize(periods);
  if (anchors.length === 0) return undefined;
  const seq: Record<number, number> = {};
  for (let age = startAge; age <= maxAge; age++) {
    seq[age] = valueAt(anchors, age, baseReturn, p => p.return);
  }
  return seq;
}

/**
 * Build the per-age volatility sequence. Only anchors that actually carry a
 * `volatility` participate; a hypothesis that sets returns only yields
 * `undefined` so Monte Carlo keeps using the flat `volatility` for every age.
 */
export function buildVolatilitySequence(
  periods: MarketPeriod[] | undefined,
  startAge: number,
  maxAge: number,
  baseVolatility: number,
): Record<number, number> | undefined {
  const anchors = normalize(periods).filter(p => p.volatility != null);
  if (anchors.length === 0) return undefined;
  const seq: Record<number, number> = {};
  for (let age = startAge; age <= maxAge; age++) {
    seq[age] = valueAt(anchors, age, baseVolatility, p => p.volatility);
  }
  return seq;
}
