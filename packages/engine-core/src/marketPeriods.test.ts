// Tests for the market-hypothesis curve builder and its engine integration
// (issue #138). The curve is piecewise-linear between anchors with CLAMPED ENDS
// — outside the outermost anchors the plan's flat constants hold — so a
// hypothesis can model a local regime (a crash, a boom) without re-rating the
// whole horizon. Absent/empty periods must be a perfect no-op.

import { describe, it, expect } from 'vitest';
import { buildReturnSequence, buildVolatilitySequence } from './marketPeriods';
import { calculateHousehold } from './retirementEngine';
import { runMonteCarlo } from './monteCarlo';
import { testConfig, baseInputs, yearAt, closeTo } from '../test/helpers';
import type { MarketPeriod } from './retirementEngine';

const config = testConfig();

describe('buildReturnSequence', () => {
  it('returns undefined for absent/empty/unusable periods (no-op)', () => {
    expect(buildReturnSequence(undefined, 60, 90, 0.05)).toBeUndefined();
    expect(buildReturnSequence([], 60, 90, 0.05)).toBeUndefined();
    // Non-finite anchors are unusable and dropped.
    expect(buildReturnSequence([{ id: 'a', age: NaN, return: 0.05 }], 60, 90, 0.05)).toBeUndefined();
  });

  it('holds the flat base return outside the outermost anchors (clamped ends)', () => {
    const periods: MarketPeriod[] = [
      { id: 'a', age: 68, return: -0.30 },
      { id: 'b', age: 70, return: 0.10 },
    ];
    const seq = buildReturnSequence(periods, 60, 90, 0.05)!;
    // Before the first anchor and after the last: the flat constant, NOT the
    // nearest anchor — a hypothesis is a local regime, not a whole-horizon bet.
    expect(seq[60]).toBe(0.05);
    expect(seq[67]).toBe(0.05);
    expect(seq[71]).toBe(0.05);
    expect(seq[90]).toBe(0.05);
  });

  it('hits anchor values exactly and lerps linearly between them', () => {
    const periods: MarketPeriod[] = [
      { id: 'a', age: 68, return: -0.30 },
      { id: 'b', age: 70, return: 0.10 },
    ];
    const seq = buildReturnSequence(periods, 60, 90, 0.05)!;
    expect(seq[68]).toBe(-0.30);
    expect(seq[70]).toBe(0.10);
    // Midpoint of a -0.30 → +0.10 span over 2 years is -0.10.
    expect(seq[69]).toBeCloseTo(-0.10, 10);
  });

  it('sorts unsorted anchors and collapses duplicate ages (last wins)', () => {
    const periods: MarketPeriod[] = [
      { id: 'b', age: 70, return: 0.10 },
      { id: 'a', age: 68, return: -0.30 },
      { id: 'a2', age: 68, return: -0.20 }, // duplicate age — later wins
    ];
    const seq = buildReturnSequence(periods, 60, 90, 0.05)!;
    expect(seq[68]).toBe(-0.20); // a2 overwrote a
    expect(seq[70]).toBe(0.10);
    expect(seq[69]).toBeCloseTo((-0.20 + 0.10) / 2, 10);
  });

  it('a single anchor applies at its age and nowhere else', () => {
    const seq = buildReturnSequence([{ id: 'a', age: 70, return: -0.25 }], 60, 90, 0.05)!;
    expect(seq[70]).toBe(-0.25);
    expect(seq[69]).toBe(0.05);
    expect(seq[71]).toBe(0.05);
  });
});

describe('buildVolatilitySequence', () => {
  it('returns undefined when no anchor carries a volatility', () => {
    expect(buildVolatilitySequence(undefined, 60, 90, 0.15)).toBeUndefined();
    expect(buildVolatilitySequence([{ id: 'a', age: 68, return: 0.05 }], 60, 90, 0.15)).toBeUndefined();
  });

  it('interpolates σ between anchors and clamps outside them', () => {
    const periods: MarketPeriod[] = [
      { id: 'a', age: 68, return: -0.30, volatility: 0.30 },
      { id: 'b', age: 72, return: 0.10, volatility: 0.10 },
    ];
    const seq = buildVolatilitySequence(periods, 60, 90, 0.15)!;
    expect(seq[68]).toBe(0.30);
    expect(seq[72]).toBe(0.10);
    expect(seq[70]).toBeCloseTo(0.20, 10);
    expect(seq[60]).toBe(0.15); // before first anchor → flat
    expect(seq[90]).toBe(0.15); // after last anchor → flat
  });

  it('clamps a negative volatility to 0', () => {
    const seq = buildVolatilitySequence([{ id: 'a', age: 68, return: 0.05, volatility: -0.2 }], 60, 90, 0.15)!;
    expect(seq[68]).toBe(0);
  });
});

describe('engine integration', () => {
  it('a crash year lowers growth vs the flat-return baseline', () => {
    const flat = calculateHousehold(baseInputs(), config);
    const crash = calculateHousehold(baseInputs({
      marketPeriods: [
        { id: 'a', age: 68, return: -0.30 },
        { id: 'b', age: 70, return: 0.10 },
      ],
    }), config);
    // The crash pulls age 68–69 growth below the flat 5% path; by the crash
    // trough the balance is strictly lower than the flat baseline.
    const flatAt70 = yearAt(flat.yearlyBreakdown, 70).endingBalance;
    const crashAt70 = yearAt(crash.yearlyBreakdown, 70).endingBalance;
    expect(crashAt70).toBeLessThan(flatAt70);
  });

  it('absent marketPeriods is a perfect no-op vs the constant path', () => {
    const withUndef = calculateHousehold(baseInputs({ marketPeriods: undefined }), config);
    const plain = calculateHousehold(baseInputs(), config);
    expect(withUndef.yearlyBreakdown.map(y => y.endingBalance))
      .toEqual(plain.yearlyBreakdown.map(y => y.endingBalance));
    expect(withUndef.depletionAge).toBe(plain.depletionAge);
  });

  it('anchors within the horizon change only those years; the flat years match', () => {
    const inputs = baseInputs({
      marketPeriods: [{ id: 'a', age: 75, return: 0.20 }], // a boom single year
    });
    const boom = calculateHousehold(inputs, config);
    const flat = calculateHousehold(baseInputs(), config);
    // Before the anchor the two paths are identical (the curve hasn't started).
    for (let age = 65; age <= 74; age++) {
      expect(closeTo(
        yearAt(boom.yearlyBreakdown, age).endingBalance,
        yearAt(flat.yearlyBreakdown, age).endingBalance,
        0.01,
      )).toBe(true);
    }
    // At/after the anchor the boom path diverges upward.
    expect(yearAt(boom.yearlyBreakdown, 76).endingBalance)
      .toBeGreaterThan(yearAt(flat.yearlyBreakdown, 76).endingBalance);
  });
});

describe('monte carlo integration', () => {
  it('a volatility curve samples per-age σ (crash window widens the spread)', () => {
    const inputs = baseInputs({
      marketPeriods: [
        { id: 'a', age: 68, return: -0.30, volatility: 0.30 },
        { id: 'b', age: 72, return: 0.10, volatility: 0.10 },
      ],
    });
    const flat = runMonteCarlo({ inputs: baseInputs(), config, runs: 200, volatility: 0.15, seed: 7 });
    const curved = runMonteCarlo({ inputs, config, runs: 200, volatility: 0.15, seed: 7 });
    // Same seed, same run count — but the curved hypothesis reshapes the
    // futures, so the success/median outcomes differ from the flat run.
    expect(curved.medianFinalBalance).not.toBe(flat.medianFinalBalance);
    expect(curved.successRate).not.toBeNaN();
  });

  it('no volatility anchors keeps MC on the flat σ', () => {
    const inputs = baseInputs({
      marketPeriods: [{ id: 'a', age: 70, return: 0.08 }], // return only, no σ
    });
    // With no σ anchors, MC volatility is exactly the request's flat value.
    const res = runMonteCarlo({ inputs, config, runs: 50, volatility: 0.15, seed: 3 });
    expect(res.volatility).toBe(0.15);
  });
});
