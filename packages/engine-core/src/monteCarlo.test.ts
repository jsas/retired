// Tests for the Monte Carlo screen's household consistency (issue #175). The
// success verdict became household-first in #33, but the percentile bands and
// median final balance kept reading the PRIMARY's silo — so a couple whose
// spouse's savings cover the household showed 100% success over a median band
// at $0. The chart must describe the SAME money the verdict is scored on.

import { describe, it, expect } from 'vitest';
import { runMonteCarlo, simulate, generateSequences } from './monteCarlo';
import { calculateHouseholdModel, householdOutcome } from './retirementEngine';
import { toHousehold } from './householdTypes';
import { testConfig, baseInputs } from '../test/helpers';

const config = testConfig();

describe('monte carlo household bands (issue #175)', () => {
  // Primary has nothing; the spouse's TFSA funds the household. The primary's
  // own plan depletes immediately, but the household verdict is ON_TRACK —
  // the bands must show the household's money, not the empty primary silo.
  const flushPrimaryCouple = () => baseInputs({
    tfsaBalance: 0,
    desiredSpending: 20000,
    spouse: {
      enabled: true, currentAge: 65, retirementAge: 65,
      rrspBalance: 0, tfsaBalance: 900000, taxableBalance: 0, cashCushionBalance: 0,
      rrspContribution: 0, tfsaContribution: 0, taxableContribution: 0,
      cppStartAge: null, cppMonthlyAmount: 0, oasStartAge: null, oasYearsInCanada: 40,
      desiredSpending: 20000,
    },
  });

  it('bands read the combined household balance, not the primary silo', () => {
    const mc = runMonteCarlo({ inputs: flushPrimaryCouple(), config, runs: 50, volatility: 0.1, seed: 42 });
    // The household money lasts to max age in every run…
    expect(mc.successRate).toBe(1);
    // …so the median band must be positive at every age (bug: $0 everywhere,
    // because the primary's empty silo anchored every percentile).
    expect(mc.medianFinalBalance).toBeGreaterThan(0);
    for (const band of mc.percentileBands) {
      expect(band.p50).toBeGreaterThan(0);
    }
  });

  it('bands zero out at the household depletion age, not the primary silo', () => {
    // Mirror image: the PRIMARY funds everything and runs out mid-horizon
    // with nothing behind it — the household genuinely fails, so the bands
    // must collapse to 0 from the household depletion age onward.
    const inputs = baseInputs({
      tfsaBalance: 150000,
      desiredSpending: 40000,
      spouse: {
        enabled: true, currentAge: 65, retirementAge: 65,
        rrspBalance: 0, tfsaBalance: 0, taxableBalance: 0, cashCushionBalance: 0,
        rrspContribution: 0, tfsaContribution: 0, taxableContribution: 0,
        cppStartAge: null, cppMonthlyAmount: 0, oasStartAge: null, oasYearsInCanada: 40,
        desiredSpending: 20000,
      },
    });
    const mc = runMonteCarlo({ inputs, config, runs: 20, volatility: 0.1, seed: 7 });
    expect(mc.successRate).toBe(0);
    const lastPositive = [...mc.percentileBands].reverse().find(b => b.p50 > 0);
    expect(lastPositive).toBeDefined();
    // After the collapse, every band percentile is 0 to max age.
    const collapsed = mc.percentileBands.filter(b => lastPositive && b.age > lastPositive.age);
    expect(collapsed.length).toBeGreaterThan(0);
    expect(collapsed.every(b => b.p10 === 0 && b.p50 === 0 && b.p90 === 0)).toBe(true);
  });

  // E-MC-01 / issue #33: the solver scores a plan through simulate(), the MC
  // screen through runMonteCarlo(). Both MUST reach the same verdict on the
  // same futures, or the solver steers toward a success rate the screen will
  // never report. The case that used to diverge is a couple whose PRIMARY
  // silo runs dry while the spouse's savings carry the household: the raw
  // engine `depletionAge` fires, and a silo-based scorer counts every run as
  // a failure.
  it('simulate() agrees with runMonteCarlo() when only the primary silo depletes (E-MC-01 / #33)', () => {
    const inputs = flushPrimaryCouple();
    const runs = 25;
    const volatility = 0.1;
    const seed = 42;

    // The primary's OWN plan depletes (that's the raw engine's view)…
    const det = calculateHouseholdModel(toHousehold(inputs), config);
    expect(det.depletionAge).not.toBeNull();
    // …while the household verdict is intact: combined money lasts to max age.
    expect(householdOutcome(det, toHousehold(inputs)).depletionAge).toBeNull();

    const mc = runMonteCarlo({ inputs, config, runs, volatility, seed });
    const shared = simulate(inputs, config, generateSequences(runs, inputs.currentAge, inputs.maxAge, inputs.investmentReturn, volatility, seed));

    // Same futures, same household-first verdict: every run succeeds in both.
    expect(mc.runs).toBe(runs);
    expect(shared.runs).toBe(runs);
    expect(shared.successCount).toBe(mc.successCount);
    expect(shared.successRate).toBe(mc.successRate);
    expect(shared.successRate).toBe(1);
    expect(shared.medianFinalBalance).toBeCloseTo(mc.medianFinalBalance, 0);
    // And the scorer isn't just reading the primary silo — it would have said
    // 0% here, which is the bug #33 fixed.
    expect(shared.successCount).toBeGreaterThan(0);
  });

  it('single-person plans are unchanged: bands track the plan balance', () => {
    // No spouse → combineHouseholdBreakdown returns the primary's own rows.
    // With zero volatility every run is the deterministic projection, so each
    // percentile must equal the plan's own ending balance at that age.
    const inputs = baseInputs();
    const mc = runMonteCarlo({ inputs, config, runs: 5, volatility: 0, seed: 1 });
    expect(mc.successRate).toBe(1);
    const det = calculateHouseholdModel(toHousehold(inputs), config);
    for (const band of mc.percentileBands) {
      const row = det.yearlyBreakdown.find(y => y.age === band.age);
      expect(band.p50).toBeCloseTo(Math.max(0, row?.endingBalance ?? 0), 0);
    }
  });
});
