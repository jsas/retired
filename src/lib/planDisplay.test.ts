import { describe, expect, it } from 'vitest';
import { firstEmptyAge, potDisplay } from './planDisplay';
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
