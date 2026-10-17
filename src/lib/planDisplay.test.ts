import { describe, expect, it } from 'vitest';
import { firstEmptyAge, formatReScore, potDisplay } from './planDisplay';
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
