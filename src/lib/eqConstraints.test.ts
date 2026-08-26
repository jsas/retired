import { describe, it, expect } from 'vitest';
import {
  AXES, axisValue, withAxis, deterministicOutcome, pinSatisfied,
  findBoundary, clampToBoundary, slidePoint, isViolation,
  fullBand, normalizeBand, effectiveRange, clampToBand, isLimited, renderRange, bandWithValue,
  type EqPin, type SuccessScorer, type Band,
} from './eqConstraints';
import { testConfig, baseInputs } from '../test/helpers';
import type { RetirementInputs } from './retirementEngine';

const config = testConfig();

const fundedTo = (age: number): EqPin => ({ kind: 'fundedToAge', value: age, enabled: true });
const legacy = (floor: number): EqPin => ({ kind: 'legacyFloor', value: floor, enabled: true });
const success = (rate: number): EqPin => ({ kind: 'successRate', value: rate, enabled: true });

// A lean plan that depletes early at high spending, funded at low spending.
const lean = () => baseInputs({
  currentAge: 60, retirementAge: 65, maxAge: 90,
  tfsaBalance: 150000, rrspBalance: 0, taxableBalance: 0, cashCushionBalance: 0,
  desiredSpending: 40000, cppStartAge: null, oasStartAge: null,
});

describe('axis read/write', () => {
  it('reads and writes each axis; retirementAge is rounded to an integer', () => {
    const i = lean();
    expect(axisValue(i, 'desiredSpending')).toBe(40000);
    expect(axisValue(withAxis(i, 'desiredSpending', 50000), 'desiredSpending')).toBe(50000);
    expect(axisValue(withAxis(i, 'retirementAge', 66.7), 'retirementAge')).toBe(67);
    expect(axisValue(withAxis(i, 'investmentReturn', 0.07), 'investmentReturn')).toBeCloseTo(0.07, 9);
  });

  it('every axis is monotonic in the documented direction', () => {
    expect(AXES.desiredSpending.increasingRate).toBe(false);
    expect(AXES.retirementAge.increasingRate).toBe(true);
    expect(AXES.investmentReturn.increasingRate).toBe(true);
    expect(AXES.maxAge.increasingRate).toBe(false);
    expect(AXES.annualSavings.increasingRate).toBe(true);
    expect(AXES.returnVolatility.increasingRate).toBe(false);
    expect(AXES.cppStartAge.increasingRate).toBe(true);
  });
});

describe('derived axes', () => {
  it('annualSavings reads the total of the three contribution buckets', () => {
    const i = baseInputs({ rrspContribution: 10000, tfsaContribution: 6000, taxableContribution: 4000 });
    expect(axisValue(i, 'annualSavings')).toBe(20000);
  });

  it('annualSavings writes the whole total to taxable, clearing registered buckets', () => {
    // Whatever the registered mix was, setting the axis moves it all to the
    // taxable account — no RRSP/TFSA limit to collide with, exact round-trip.
    const i = baseInputs({ rrspContribution: 10000, tfsaContribution: 5000, taxableContribution: 5000 });
    const next = withAxis(i, 'annualSavings', 40000);
    expect(axisValue(next, 'annualSavings')).toBe(40000);
    expect(next.rrspContribution).toBe(0);
    expect(next.tfsaContribution).toBe(0);
    expect(next.taxableContribution).toBe(40000);
  });

  it('annualSavings round-trips exactly through the taxable account', () => {
    const i = baseInputs({ rrspContribution: 0, tfsaContribution: 0, taxableContribution: 0 });
    const next = withAxis(i, 'annualSavings', 53333);
    expect(next.taxableContribution).toBe(53333);
    expect(axisValue(next, 'annualSavings')).toBe(53333);
    // Setting it again from a non-zero base is still exact (no scaling drift).
    expect(axisValue(withAxis(next, 'annualSavings', 21000), 'annualSavings')).toBe(21000);
  });

  it('cppStartAge reads a null start as the default 65 and writes an integer', () => {
    const i = baseInputs({ cppStartAge: null });
    expect(axisValue(i, 'cppStartAge')).toBe(65);
    expect(axisValue(withAxis(i, 'cppStartAge', 62.6), 'cppStartAge')).toBe(63);
    expect(withAxis(i, 'cppStartAge', 70).cppStartAge).toBe(70);
  });

  it('maxAge and other integer axes snap to whole numbers', () => {
    const i = baseInputs({ maxAge: 95 });
    expect(axisValue(withAxis(i, 'maxAge', 97.4), 'maxAge')).toBe(97);
    expect(normalizeBand('maxAge', { min: 80.6, max: 99.2 })).toEqual({ min: 81, max: 99 });
  });
});

describe('deterministicOutcome', () => {
  it('reports depletion age and a zero ending balance when the plan runs out', () => {
    const o = deterministicOutcome(lean(), config);
    expect(o.depletionAge).not.toBeNull();
    expect(o.endingBalance).toBe(0);
    expect(o.status).toBe('SHORTFALL');
  });

  it('reports no depletion and a positive ending balance when funded', () => {
    const o = deterministicOutcome(withAxis(lean(), 'desiredSpending', 5000), config);
    expect(o.depletionAge).toBeNull();
    expect(o.endingBalance).toBeGreaterThan(0);
    expect(o.status).toBe('ON_TRACK');
  });
});

describe('pinSatisfied — deterministic pins', () => {
  it('fundedToAge: satisfied when depletion is null or at/after the target age', () => {
    const funded = withAxis(lean(), 'desiredSpending', 5000);
    expect(pinSatisfied(fundedTo(90), funded, config)).toBe(true);
    const depleted = lean();
    const o = deterministicOutcome(depleted, config);
    // Fails for a target beyond the depletion age, passes at/below it.
    expect(pinSatisfied(fundedTo(o.depletionAge! + 5), depleted, config)).toBe(false);
    expect(pinSatisfied(fundedTo(o.depletionAge! - 5), depleted, config)).toBe(true);
  });

  it('legacyFloor: satisfied only when the ending balance clears the floor', () => {
    const funded = withAxis(lean(), 'desiredSpending', 5000);
    const o = deterministicOutcome(funded, config);
    expect(pinSatisfied(legacy(o.endingBalance - 1), funded, config)).toBe(true);
    expect(pinSatisfied(legacy(o.endingBalance + 1), funded, config)).toBe(false);
    // A depleted plan never satisfies a positive floor.
    expect(pinSatisfied(legacy(1), lean(), config)).toBe(false);
  });
});

describe('pinSatisfied — successRate pin (synthetic monotonic scorer)', () => {
  // Score falls as spending rises: 1.0 at $0, 0 at $100k. Deterministic and
  // monotonic, so the binary search is exercised without Monte Carlo.
  const spendScorer: SuccessScorer = (i: RetirementInputs) =>
    Math.max(0, 1 - i.desiredSpending / 100000);

  it('passes at/below the rate threshold and fails above it', () => {
    const at = (spend: number) => withAxis(lean(), 'desiredSpending', spend);
    expect(pinSatisfied(success(0.5), at(40000), config, spendScorer)).toBe(true);  // 0.6
    expect(pinSatisfied(success(0.5), at(60000), config, spendScorer)).toBe(false); // 0.4
  });

  it('treats a missing scorer as unconstrained (satisfied)', () => {
    expect(pinSatisfied(success(0.9), lean(), config)).toBe(true);
  });
});

describe('findBoundary', () => {
  const spendScorer: SuccessScorer = (i) => Math.max(0, 1 - i.desiredSpending / 100000);

  it('decreasing-rate axis (spending): boundary is the max satisfying value', () => {
    // rate >= 0.5 ⇔ spending <= 50000.
    const b = findBoundary(success(0.5), lean(), config, 'desiredSpending', spendScorer, 100);
    expect(b.kind).toBe('bounded');
    expect(b.value).toBeGreaterThan(49000);
    expect(b.value).toBeLessThanOrEqual(50000);
  });

  it('increasing-rate axis (return): boundary is the min satisfying value', () => {
    // rate = return * 10 → rate >= 0.5 ⇔ return >= 0.05.
    const returnScorer: SuccessScorer = (i) => Math.min(1, i.investmentReturn * 10);
    const b = findBoundary(success(0.5), lean(), config, 'investmentReturn', returnScorer, 0.001);
    expect(b.kind).toBe('bounded');
    expect(b.value).toBeGreaterThanOrEqual(0.05);
    expect(b.value).toBeLessThan(0.055);
  });

  it('unconstrained when the whole range satisfies; infeasible when nothing does', () => {
    // Very low target → all spending levels pass.
    expect(findBoundary(success(0.0), lean(), config, 'desiredSpending', spendScorer).kind).toBe('unconstrained');
    // A target above what even the best case reaches → nothing passes. (Cap the
    // scorer at 0.9 so the 0.95 target is genuinely unreachable.)
    const capped: SuccessScorer = (i) => Math.min(0.9, Math.max(0, 1 - i.desiredSpending / 100000));
    expect(findBoundary(success(0.95), lean(), config, 'desiredSpending', capped).kind).toBe('infeasible');
  });

  it('works against a deterministic fundedToAge pin on the spending axis', () => {
    // Find the max spending still funded to 90. Should sit between the lean
    // (depleted) and funded (5000) endpoints.
    const b = findBoundary(fundedTo(90), lean(), config, 'desiredSpending', undefined, 250);
    expect(b.kind).toBe('bounded');
    expect(b.value).toBeGreaterThan(5000);
    expect(b.value).toBeLessThan(40000);
    // The boundary itself is funded; a step above it is not.
    expect(pinSatisfied(fundedTo(90), withAxis(lean(), 'desiredSpending', b.value), config)).toBe(true);
  });
});

describe('clampToBoundary', () => {
  const bounded = (v: number) => ({ value: v, kind: 'bounded' as const });

  it('decreasing-rate axis: clamps values above the boundary down to it', () => {
    expect(clampToBoundary('desiredSpending', 80000, bounded(50000))).toBe(50000);
    expect(clampToBoundary('desiredSpending', 30000, bounded(50000))).toBe(30000); // already feasible
  });

  it('increasing-rate axis: clamps values below the boundary up to it', () => {
    expect(clampToBoundary('retirementAge', 50, bounded(62))).toBe(62);
    expect(clampToBoundary('retirementAge', 70, bounded(62))).toBe(70);
  });

  it('unconstrained passes through; respects the axis hard min/max', () => {
    expect(clampToBoundary('desiredSpending', 80000, { value: 0, kind: 'unconstrained' })).toBe(80000);
    expect(clampToBoundary('desiredSpending', 999999, { value: 0, kind: 'unconstrained' }))
      .toBe(AXES.desiredSpending.max);
  });
});

describe('slidePoint — XY boundary slide', () => {
  // A square feasible region: x <= 60 and y <= 60 (retire-age x, spending y in
  // abstract units). solveX/solveY return a bounded boundary at 60 regardless.
  const solveX = () => ({ value: 60, kind: 'bounded' as const });
  const solveY = () => ({ value: 60000, kind: 'bounded' as const });

  it('clamps a point outside the region back onto the boundary', () => {
    const p = slidePoint({ x: 70, y: 80000 }, 'retirementAge', 'desiredSpending', solveX, solveY);
    expect(p.x).toBeLessThanOrEqual(70); // x-axis (retirementAge) increasingRate → clamped up only, not down
    expect(p.y).toBe(60000);             // spending clamped down to the boundary
  });

  it('leaves a point already inside the region unchanged', () => {
    const p = slidePoint({ x: 65, y: 40000 }, 'retirementAge', 'desiredSpending', solveX, solveY);
    expect(p.x).toBe(65);
    expect(p.y).toBe(40000);
  });
});

describe('isViolation', () => {
  it('flags a soft-pinned point that breaches the constraint', () => {
    const depleted = lean();
    expect(isViolation(fundedTo(90), depleted, config)).toBe(true);
    expect(isViolation(fundedTo(90), withAxis(lean(), 'desiredSpending', 5000), config)).toBe(false);
  });
});

describe('bands — per-control crop range (no enable flag)', () => {
  it('fullBand spans the whole axis and is NOT limited', () => {
    expect(fullBand('desiredSpending')).toEqual({ min: 0, max: 250000 });
    expect(fullBand('retirementAge')).toEqual({ min: 40, max: 75 });
    expect(isLimited('desiredSpending', fullBand('desiredSpending'))).toBe(false);
  });

  it('isLimited is true exactly when the crop is narrower than the axis', () => {
    expect(isLimited('desiredSpending', { min: 50000, max: 250000 })).toBe(true); // at-least
    expect(isLimited('desiredSpending', { min: 0, max: 120000 })).toBe(true);      // at-most
    expect(isLimited('desiredSpending', { min: 50000, max: 120000 })).toBe(true);  // range
    expect(isLimited('desiredSpending', { min: 0, max: 250000 })).toBe(false);     // full = free
  });

  it('normalizeBand clamps edges to the axis, orders them, and rounds ages', () => {
    // out-of-order + out-of-range
    expect(normalizeBand('desiredSpending', { min: 200000, max: -5000 }))
      .toEqual({ min: 0, max: 200000 });
    // ages snap to integers
    expect(normalizeBand('retirementAge', { min: 60.6, max: 70.2 }))
      .toEqual({ min: 61, max: 70 });
  });

  it('effectiveRange is the axis range when undefined, else the normalized crop', () => {
    expect(effectiveRange('desiredSpending', undefined)).toEqual({ min: 0, max: 250000 });
    expect(effectiveRange('desiredSpending', fullBand('desiredSpending'))).toEqual({ min: 0, max: 250000 });
    const band: Band = { min: 50000, max: 120000 };
    expect(effectiveRange('desiredSpending', band)).toEqual({ min: 50000, max: 120000 });
  });

  it('clampToBand holds the value inside the crop (at-least and at-most)', () => {
    const band: Band = { min: 60000, max: 120000 };
    // at-most: drag above the ceiling clamps down
    expect(clampToBand('desiredSpending', band, 200000)).toBe(120000);
    // at-least: drag below the floor clamps up
    expect(clampToBand('desiredSpending', band, 10000)).toBe(60000);
    // inside the crop passes through
    expect(clampToBand('desiredSpending', band, 90000)).toBe(90000);
    // a full-axis crop constrains nothing
    expect(clampToBand('desiredSpending', fullBand('desiredSpending'), 200000)).toBe(200000);
  });

  it('clampToBand rounds retirement-age values to integers', () => {
    const band: Band = { min: 60, max: 70 };
    expect(clampToBand('retirementAge', band, 65.6)).toBe(66);
    expect(clampToBand('retirementAge', band, 55)).toBe(60);
  });
});

describe('renderRange — growing the axis to fit out-of-range values', () => {
  it('is the axis range when the value fits', () => {
    expect(renderRange('desiredSpending', 100000)).toEqual({ min: 0, max: 250000 });
    expect(renderRange('desiredSpending', 250000)).toEqual({ min: 0, max: 250000 });
    expect(renderRange('retirementAge', 65)).toEqual({ min: 40, max: 75 });
  });

  it('grows by whole-axis steps until the value fits', () => {
    // spending axis is 0..250000 (base 250000). $500,307 needs two extra steps:
    // 250k + 2×250k = 750k.
    expect(renderRange('desiredSpending', 500307)).toEqual({ min: 0, max: 750000 });
    // Just past the max needs one step.
    expect(renderRange('desiredSpending', 250001)).toEqual({ min: 0, max: 500000 });
    // Exactly at a grown boundary doesn't grow further.
    expect(renderRange('desiredSpending', 500000)).toEqual({ min: 0, max: 500000 });
  });

  it('never grows the minimum below the axis min', () => {
    expect(renderRange('desiredSpending', -5000).min).toBe(0);
    expect(renderRange('cppStartAge', 30).min).toBe(60);
  });
});

describe('bandWithValue — the crop frames the value', () => {
  it('extends the max edge when the value lands above the crop', () => {
    // The Image #53 case: retirement age dragged to 63 with a crop of 49..60.
    expect(bandWithValue('retirementAge', { min: 49, max: 60 }, 63))
      .toEqual({ min: 49, max: 63 });
  });

  it('extends the min edge when the value lands below the crop', () => {
    expect(bandWithValue('retirementAge', { min: 49, max: 60 }, 45))
      .toEqual({ min: 45, max: 60 });
  });

  it('is a no-op when the value is already inside the crop', () => {
    const band: Band = { min: 49, max: 60 };
    expect(bandWithValue('retirementAge', band, 55)).toEqual(band);
    expect(bandWithValue('retirementAge', band, 49)).toEqual(band);
    expect(bandWithValue('retirementAge', band, 60)).toEqual(band);
  });

  it('rounds extended edges on integer axes and never leaves the axis', () => {
    expect(bandWithValue('retirementAge', { min: 49, max: 60 }, 63.4))
      .toEqual({ min: 49, max: 63 });
    // Value beyond the axis clamps to the axis max.
    expect(bandWithValue('retirementAge', { min: 49, max: 60 }, 99))
      .toEqual({ min: 49, max: 75 });
  });
});
