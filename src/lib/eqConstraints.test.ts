import { describe, it, expect } from 'vitest';
import {
  AXES, axisValue, withAxis, deterministicOutcome, pinSatisfied,
  findBoundary, clampToBoundary, slidePoint, isViolation,
  type EqPin, type SuccessScorer,
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
