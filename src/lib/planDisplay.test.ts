import { describe, expect, it } from 'vitest';
import { firstEmptyAge, formatReScore, potDisplay, unsetDetailGroups } from './planDisplay';
import { baselineInputs } from '@retired/engine-core/exampleScenarios';
import type { YearlyBreakdown } from '@retired/engine-core/retirementEngine';

function row(age: number, endingBalance: number): YearlyBreakdown {
  return {
    age,
    startingBalance: endingBalance + 1,
    contributions: 0,
    marketGains: 0,
    withdrawals: 0,
    incomeTax: 0,
    cumulativeTax: 0,
    spendingTarget: 0,
    endingBalance,
    rrspBalance: 0,
    rrifBalance: 0,
    tfsaBalance: endingBalance,
    taxableBalance: 0,
    cashCushionBalance: 0,
    cppIncome: 0,
    oasIncome: 0,
    gisIncome: 0,
    pensionIncome: 0,
  };
}

describe('potDisplay', () => {
  it('holds past the plan when leftover is still there', () => {
    const rows = [row(88, 40_000), row(89, 20_000), row(90, 8_000)];
    const d = potDisplay(rows, 90);
    expect(d.holds).toBe(true);
    expect(d.lastsTo).toBe(90);
    expect(d.emptyAge).toBeNull();
    expect(d.leftover).toBe(8_000);
    expect(firstEmptyAge(rows)).toBeNull();
  });

  it('does not print the horizon as lasting when the pot is already empty', () => {
    // The screenshot case: chart pins 86, leftover at 90 is $0, engine may
    // still be ON_TRACK (e.g. reverse-mortgage headroom).
    const rows = [row(85, 12_000), row(86, 0), row(87, 0), row(90, 0)];
    const d = potDisplay(rows, 90);
    expect(d.holds).toBe(false);
    expect(d.lastsTo).toBe(86);
    expect(d.emptyAge).toBe(86);
    expect(d.leftover).toBe(0);
  });
});

describe('formatReScore', () => {
  it('is 100 when the plan never depletes', () => {
    expect(formatReScore({ depletionAge: null }, 90)).toBe(100);
  });

  it('is 100 when depletion lands on maxAge', () => {
    expect(formatReScore({ depletionAge: 90 }, 90)).toBe(100);
  });

  it('rounds depletionAge / maxAge × 100 and clamps 0–100', () => {
    expect(formatReScore({ depletionAge: 45 }, 90)).toBe(50);
    expect(formatReScore({ depletionAge: 0 }, 90)).toBe(0);
    expect(formatReScore({ depletionAge: 180 }, 90)).toBe(100);
  });
});

// The starter plan the set-up card and New Scenario both start from.
const SPOUSE = {
  enabled: true, currentAge: 62, retirementAge: 65, rrspBalance: 0, tfsaBalance: 0,
  taxableBalance: 0, cashCushionBalance: 0, rrspContribution: 0, tfsaContribution: 0,
  taxableContribution: 0, cppStartAge: 65, cppMonthlyAmount: 800, oasStartAge: 65,
  oasYearsInCanada: 40, desiredSpending: 30000,
};
const DEBT = { id: 'd1', label: 'Mortgage', kind: 'mortgage' as const, balance: 250000, interestRate: 0.05, monthlyPayment: 1500 };
const EVENT = { id: 'e1', age: 68, label: 'Roof', amount: 30000, direction: 'out' as const };
const PENSION = { id: 'i1', label: 'DB pension', kind: 'pension' as const, annualAmount: 12000, startAge: 60, endAge: null, indexedToCpi: true };
const PHASE = { fromAge: 75, pctOfBase: 0.8 };

describe('unsetDetailGroups', () => {
  it('names every untouched register on a starter plan, in Plans-page order', () => {
    expect(unsetDetailGroups(baselineInputs())).toEqual(
      ['accounts', 'partner', 'debts', 'events', 'income', 'phases'],
    );
  });

  it('clears each group as soon as that register carries data', () => {
    const base = baselineInputs();
    expect(unsetDetailGroups({ ...base, tfsaBalance: 25_000 })).not.toContain('accounts');
    expect(unsetDetailGroups({ ...base, spouse: SPOUSE })).not.toContain('partner');
    expect(unsetDetailGroups({ ...base, debts: [DEBT] })).not.toContain('debts');
    expect(unsetDetailGroups({ ...base, events: [EVENT] })).not.toContain('events');
    expect(unsetDetailGroups({ ...base, income: [PENSION] })).not.toContain('income');
    expect(unsetDetailGroups({ ...base, spendingBands: [PHASE] })).not.toContain('phases');
  });

  it('counts a switch that exists but is off as untouched', () => {
    expect(unsetDetailGroups({ ...baselineInputs(), spouse: { ...SPOUSE, enabled: false } }))
      .toContain('partner');
  });

  it('counts a linked partner scenario as a partner, not a gap', () => {
    expect(unsetDetailGroups({ ...baselineInputs(), spouseSource: { kind: 'scenario', scenarioId: 'p2' } }))
      .not.toContain('partner');
  });

  it('says nothing is left once every register holds data', () => {
    expect(unsetDetailGroups({
      ...baselineInputs(),
      rrspBalance: 200_000, spouse: SPOUSE, debts: [DEBT], events: [EVENT],
      income: [PENSION], spendingBands: [PHASE],
    })).toEqual([]);
  });
});
