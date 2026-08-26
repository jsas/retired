import { describe, it, expect } from 'vitest';
import {
  metricsFromResults, computeScenarioMetrics, compareScenarios,
} from './compareMetrics';
import { calculateHousehold } from './retirementEngine';
import { testConfig, baseInputs } from '../test/helpers';
import type { Scenario } from './scenarioStorage';

const config = testConfig();

let seq = 0;
function scenario(name: string, overrides: Parameters<typeof baseInputs>[0]): Scenario {
  seq += 1;
  return { id: `sc-${seq}`, name, inputs: baseInputs(overrides) };
}

// A well-funded plan (big TFSA, modest spend) and a lean plan (small TFSA,
// heavy spend) that depletes early.
const rich = () => scenario('Rich', { tfsaBalance: 800000, desiredSpending: 30000, cppStartAge: null, oasStartAge: null });
const lean = () => scenario('Lean', { tfsaBalance: 60000, desiredSpending: 45000, cppStartAge: null, oasStartAge: null });

describe('metricsFromResults', () => {
  it('flattens a single plan: worth, depletion, rate, status', () => {
    const inputs = baseInputs({ tfsaBalance: 500000, desiredSpending: 20000, cppStartAge: null, oasStartAge: null });
    const r = calculateHousehold(inputs, config);
    const m = metricsFromResults('a', 'Solo', r);
    expect(m.isCouple).toBe(false);
    expect(m.householdWorth).toBeCloseTo(r.totalNetWorthAtRetirement, 6);
    expect(m.withdrawalRate).toBeCloseTo(r.withdrawalRate, 9);
    expect(m.status).toBe(r.status);
  });

  it('sums household worth and takes the earliest depletion across spouses', () => {
    const inputs = baseInputs({
      tfsaBalance: 400000, desiredSpending: 20000, cppStartAge: null, oasStartAge: null,
      spouse: {
        enabled: true, currentAge: 65, retirementAge: 65,
        rrspBalance: 0, tfsaBalance: 40000, taxableBalance: 0, cashCushionBalance: 0,
        rrspContribution: 0, tfsaContribution: 0, taxableContribution: 0,
        cppStartAge: null, cppMonthlyAmount: 0, oasStartAge: null, oasYearsInCanada: 40,
        desiredSpending: 50000, withdrawalOrder: ['tfsa', 'taxable', 'rrsp'], pensions: [],
      },
    });
    const r = calculateHousehold(inputs, config);
    const m = metricsFromResults('c', 'Couple', r);
    expect(m.isCouple).toBe(true);
    expect(m.householdWorth).toBeCloseTo(
      r.totalNetWorthAtRetirement + r.spouse!.totalNetWorthAtRetirement, 6,
    );
    // The spouse (lean) depletes; the household depletion age is the earliest.
    expect(m.depletionAge).toBe(r.spouse!.depletionAge);
    expect(m.status).toBe('SHORTFALL');
  });

  it('reports depletionAge null when the plan never runs out', () => {
    const r = calculateHousehold(baseInputs({ tfsaBalance: 5000000, desiredSpending: 10000, cppStartAge: null, oasStartAge: null }), config);
    expect(metricsFromResults('n', 'Never', r).depletionAge).toBeNull();
  });
});

describe('computeScenarioMetrics', () => {
  it('runs the scenario inputs through the engine with the given config', () => {
    const s = rich();
    const m = computeScenarioMetrics(s, config);
    expect(m.id).toBe(s.id);
    expect(m.name).toBe('Rich');
    expect(m.status).toBe('ON_TRACK');
  });
});

describe('compareScenarios', () => {
  it('gives the baseline no diff and others a signed diff per metric', () => {
    const base = rich();
    const other = lean();
    const rows = compareScenarios([base, other], base.id, config);
    expect(rows).toHaveLength(2);

    const baseRow = rows.find(r => r.metrics.id === base.id)!;
    const otherRow = rows.find(r => r.metrics.id === other.id)!;

    expect(baseRow.diff).toBeUndefined();
    expect(otherRow.diff).toBeDefined();

    // Lean has less wealth → negative, worse.
    expect(otherRow.diff!.householdWorth.delta).toBeLessThan(0);
    expect(otherRow.diff!.householdWorth.better).toBe(false);
    // Lean has a higher withdrawal rate → positive delta but worse.
    expect(otherRow.diff!.withdrawalRate.delta).toBeGreaterThan(0);
    expect(otherRow.diff!.withdrawalRate.better).toBe(false);
  });

  it('marks a later depletion age as better', () => {
    const depletesEarly = lean();           // baseline
    const depletesLater = scenario('Later', { tfsaBalance: 200000, desiredSpending: 40000, cppStartAge: null, oasStartAge: null });
    const rows = compareScenarios([depletesEarly, depletesLater], depletesEarly.id, config);
    const later = rows.find(r => r.metrics.id === depletesLater.id)!;
    // Both deplete, but Later holds out longer → positive age delta, better.
    expect(later.metrics.depletionAge).not.toBeNull();
    expect(later.diff!.depletionAge.delta).toBeGreaterThan(0);
    expect(later.diff!.depletionAge.better).toBe(true);
  });

  it('treats "never runs out" as better than any finite depletion age', () => {
    const base = lean();     // depletes
    const never = scenario('Never', { tfsaBalance: 5000000, desiredSpending: 10000, cppStartAge: null, oasStartAge: null });
    const rows = compareScenarios([base, never], base.id, config);
    const neverRow = rows.find(r => r.metrics.id === never.id)!;
    expect(neverRow.metrics.depletionAge).toBeNull();
    expect(neverRow.diff!.depletionAge.better).toBe(true);
    expect(neverRow.diff!.depletionAge.neutral).toBe(false);

    // And the reverse: a finite age is worse than "never".
    const flipped = compareScenarios([base, never], never.id, config);
    const baseRow = flipped.find(r => r.metrics.id === base.id)!;
    expect(baseRow.diff!.depletionAge.better).toBe(false);
  });

  it('marks equal scenarios neutral on every diff', () => {
    const a = rich();
    const b = rich(); // identical inputs
    const rows = compareScenarios([a, b], a.id, config);
    const bRow = rows.find(r => r.metrics.id === b.id)!;
    expect(bRow.diff!.householdWorth.neutral).toBe(true);
    expect(bRow.diff!.withdrawalRate.neutral).toBe(true);
    expect(bRow.diff!.depletionAge.neutral).toBe(true);
    expect(bRow.diff!.householdWorth.better).toBe(true); // neutral counts as not-worse
  });

  it('is insensitive to scenario order — baseline is found by id', () => {
    const base = rich();
    const other = lean();
    const forward = compareScenarios([base, other], base.id, config);
    const reversed = compareScenarios([other, base], base.id, config);
    const f = forward.find(r => r.metrics.id === other.id)!;
    const rev = reversed.find(r => r.metrics.id === other.id)!;
    expect(f.diff!.householdWorth.delta).toBeCloseTo(rev.diff!.householdWorth.delta, 6);
  });
});
