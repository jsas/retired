// Golden master — a regression net over a synthetic RICH fixture that exercises
// every engine subsystem at once: accumulation→decumulation, spending bands,
// one-time & recurring cash events, a DB pension, a reverse-mortgage top-up, a
// spouse with pension-splitting, GIS and the OAS clawback.
//
// Two layers of protection:
//   1. GOLDEN — the full per-year output locked to the values the engine
//      produces today. Any numeric drift in any year/field fails the test and
//      names the exact divergence. Update ONLY deliberately (regenerate the
//      table, eyeball the diff, confirm the change was intended).
//   2. Structural invariants — continuity, accounting identities and
//      monotonicity that must hold for ANY correct run, so the test also
//      catches "changed but self-inconsistent" output, not just "≠ snapshot".
//
// The fixture is deterministic (no Monte Carlo): constant return, no volatility.
import { describe, it, expect } from 'vitest';
import { calculateHousehold, type YearlyBreakdown } from './retirementEngine';
import { testConfig, baseInputs, closeTo } from '../test/helpers';

const config = testConfig();

// The rich fixture. Spouse is 2 years younger and retires 2 years earlier, so
// the household projection aligns by calendar year across an age gap and the
// pension-splitting pass has eligible income to work with.
const richInputs = () => baseInputs({
  currentAge: 60, retirementAge: 65, maxAge: 90,
  rrspBalance: 600000, tfsaBalance: 300000, taxableBalance: 200000, cashCushionBalance: 20000,
  rrspContribution: 10000, tfsaContribution: 6000, taxableContribution: 4000,
  cppStartAge: 65, cppMonthlyAmount: 1100, oasStartAge: 65, oasYearsInCanada: 40,
  desiredSpending: 72000, investmentReturn: 0.05, provinceCode: 'ONT',
  withdrawalOrder: ['taxable', 'rrsp', 'tfsa'],
  spendingBands: [{ fromAge: 75, pctOfBase: 0.85 }, { fromAge: 85, pctOfBase: 0.7 }],
  events: [
    { id: 'reno', age: 68, label: 'Reno', amount: 40000, direction: 'out' },
    { id: 'inherit', age: 70, label: 'Inheritance', amount: 100000, direction: 'in', account: 'taxable' },
  ],
  income: [{ id: 'db', label: 'DB Pension', kind: 'pension', annualAmount: 15000, startAge: 65, endAge: null, indexedToCpi: false }],
  reverseMortgage: {
    enabled: true, homeValue: 800000, appreciationRate: 0.02, interestRate: 0.055,
    drawAmount: 0, topUp: true,
  },
  spouse: {
    enabled: true, currentAge: 58, retirementAge: 63,
    rrspBalance: 250000, tfsaBalance: 150000, taxableBalance: 50000, cashCushionBalance: 10000,
    rrspContribution: 8000, tfsaContribution: 5000, taxableContribution: 2000,
    cppStartAge: 65, cppMonthlyAmount: 700, oasStartAge: 65, oasYearsInCanada: 40,
    desiredSpending: 0, withdrawalOrder: ['rrsp', 'taxable', 'tfsa'],
    income: [],
  },
});

// Locked summary aggregates.
const GOLDEN_SUMMARY = {
  status: 'ON_TRACK',
  depletionAge: null,
  totalNetWorthAtRetirement: 1534927.37,
  withdrawalRate: 0.05179,
  lifetimeTax: 187924.65,
  rows: 31,
};

// Locked per-year rows: [age, startingBalance, endingBalance, withdrawals,
// incomeTax, cppIncome, oasIncome, gisIncome, pensionIncome].
const GOLDEN_ROWS: number[][] = [
  [60, 1120000, 1195100, 0, 0, 0, 0, 0, 0],
  [61, 1195100, 1273950.5, 0, 0, 0, 0, 0, 0],
  [62, 1273950.5, 1356739, 0, 0, 0, 0, 0, 0],
  [63, 1356739, 1443662.39, 0, 0, 0, 0, 0, 0],
  [64, 1443662.39, 1534927.37, 0, 0, 0, 0, 0, 0],
  [65, 1534927.37, 1560949.49, 47430.02, -494.39, 13200, 8907.72, 0, 15000],
  [66, 1560949.49, 1586375.34, 49232.65, -281.84, 13200, 8907.72, 0, 15000],
  [67, 1586375.34, 1611136.5, 51072.03, 1364.75, 13200, 8907.72, 0, 15000],
  [68, 1611136.5, 1591862.17, 94185.25, 2824.18, 13200, 8907.72, 0, 15000],
  [69, 1591862.17, 1612906.25, 54864.49, 1815.64, 13200, 8907.72, 0, 15000],
  [70, 1612906.25, 1739857.63, 54998, 228.79, 13200, 8907.72, 0, 15000],
  [71, 1739857.63, 1750456, 71851.2, 4490.43, 13200, 8907.72, 0, 15000],
  [72, 1750456, 1759249.24, 74070.52, 4750.73, 13200, 8907.72, 0, 15000],
  [73, 1759249.24, 1766085.35, 76348.64, 5025.94, 13200, 8907.72, 0, 15000],
  [74, 1766085.35, 1770812.26, 78678.35, 5313.8, 13200, 8907.72, 0, 15000],
  [75, 1770812.26, 1789829.34, 65289.16, 5121.23, 13200, 9798.48, 0, 15000],
  [76, 1789829.34, 1806185.69, 68724.14, 5917.26, 13200, 9798.48, 0, 15000],
  [77, 1806185.69, 1820479.86, 71462.36, 6384.86, 13200, 9798.48, 0, 15000],
  [78, 1820479.86, 1832760.18, 74056.32, 6769.41, 13200, 9798.48, 0, 15000],
  [79, 1832760.18, 1842687.07, 76877.77, 11127.9, 13200, 9798.48, 0, 15000],
  [80, 1842687.07, 1849888.94, 79941.03, 11654.38, 13200, 9798.48, 0, 15000],
  [81, 1849888.94, 1853932.98, 83286.69, 12231.78, 13200, 9798.48, 0, 15000],
  [82, 1853932.98, 1854589.93, 86700.31, 12818.04, 13200, 9798.48, 0, 15000],
  [83, 1854589.93, 1851619.05, 90181.88, 13410.84, 13200, 9798.48, 0, 15000],
  [84, 1851619.05, 1844769.24, 93729.83, 14021.19, 13200, 9798.48, 0, 15000],
  [85, 1844769.24, 1865621.66, 67015.74, 5725.65, 13200, 9798.48, 0, 15000],
  [86, 1865621.66, 1884977.7, 69428.98, 10579.04, 13200, 9798.48, 0, 15000],
  [87, 1884977.7, 1902630.96, 71967.51, 11041.42, 13200, 9798.48, 0, 15000],
  [88, 1902630.96, 1918429.55, 74569.6, 11505.68, 13200, 9798.48, 0, 15000],
  [89, 1918429.55, 1931982.84, 77455.36, 12014.77, 13200, 9798.48, 0, 15000],
  [90, 1931982.84, 1942917.87, 80589.38, 12563.15, 13200, 9798.48, 0, 15000],
];

const run = () => calculateHousehold(richInputs(), config);

// Project a row down to the golden tuple for comparison.
const tuple = (y: YearlyBreakdown): number[] => [
  y.age,
  +y.startingBalance.toFixed(2), +y.endingBalance.toFixed(2),
  +y.withdrawals.toFixed(2), +y.incomeTax.toFixed(2),
  +y.cppIncome.toFixed(2), +y.oasIncome.toFixed(2), +y.gisIncome.toFixed(2), +y.pensionIncome.toFixed(2),
];

describe('golden master — summary aggregates', () => {
  it('matches the locked plan summary', () => {
    const r = run();
    expect(r.status).toBe(GOLDEN_SUMMARY.status);
    expect(r.depletionAge).toBe(GOLDEN_SUMMARY.depletionAge);
    expect(closeTo(r.totalNetWorthAtRetirement, GOLDEN_SUMMARY.totalNetWorthAtRetirement, 0.5)).toBe(true);
    expect(closeTo(r.withdrawalRate, GOLDEN_SUMMARY.withdrawalRate, 0.0001)).toBe(true);
    const last = r.yearlyBreakdown[r.yearlyBreakdown.length - 1];
    expect(closeTo(last.cumulativeTax, GOLDEN_SUMMARY.lifetimeTax, 0.5)).toBe(true);
    expect(r.yearlyBreakdown.length).toBe(GOLDEN_SUMMARY.rows);
  });
});

describe('golden master — full per-year table', () => {
  it('every year matches the locked output', () => {
    const r = run();
    expect(r.yearlyBreakdown.length).toBe(GOLDEN_ROWS.length);
    r.yearlyBreakdown.forEach((y, i) => {
      const got = tuple(y);
      const want = GOLDEN_ROWS[i];
      got.forEach((v, k) => {
        // Money fields to the cent; the age column exact.
        expect(closeTo(v, want[k], k === 0 ? 0 : 0.02)).toBe(true);
      });
    });
  });
});

describe('golden master — structural invariants (any correct run)', () => {
  const r = run();
  const rows = r.yearlyBreakdown;

  it('balance continuity: each year starts where the last ended', () => {
    for (let i = 1; i < rows.length; i++) {
      expect(closeTo(rows[i].startingBalance, rows[i - 1].endingBalance, 0.5)).toBe(true);
    }
  });

  it('ages are consecutive from currentAge to maxAge (no depletion here)', () => {
    rows.forEach((y, i) => expect(y.age).toBe(60 + i));
    expect(rows[rows.length - 1].age).toBe(90);
  });

  it('cumulative tax is a running sum of per-year incomeTax', () => {
    let cum = 0;
    for (const y of rows) {
      cum += y.incomeTax;
      expect(closeTo(y.cumulativeTax, cum, 0.5)).toBe(true);
    }
  });

  it('account balances sum to the ending balance', () => {
    for (const y of rows) {
      const sum = y.rrspBalance + y.rrifBalance + y.tfsaBalance + y.taxableBalance + y.cashCushionBalance;
      expect(closeTo(sum, y.endingBalance, 1)).toBe(true);
    }
  });

  it('no negative balances anywhere', () => {
    for (const y of rows) {
      for (const b of [y.rrspBalance, y.rrifBalance, y.tfsaBalance, y.taxableBalance, y.cashCushionBalance]) {
        expect(b).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('benefits are present from the start age and pension is constant (non-indexed)', () => {
    const retired = rows.filter(y => y.age >= 65);
    for (const y of retired) {
      expect(y.cppIncome).toBeGreaterThan(0);
      expect(y.oasIncome).toBeGreaterThan(0);
      expect(y.pensionIncome).toBe(15000); // non-indexed DB pension
    }
  });

  it('OAS bumps at 75 (the 75+ base rate)', () => {
    const at74 = rows.find(y => y.age === 74)!.oasIncome;
    const at75 = rows.find(y => y.age === 75)!.oasIncome;
    expect(at75).toBeGreaterThan(at74);
  });

  it('reverse-mortgage loan and home value are tracked once retired', () => {
    const y = rows.find(y => y.age === 80)!;
    expect(y.homeValue).toBeGreaterThan(800000); // appreciated
    expect(y.netHomeEquity).toBeCloseTo((y.homeValue ?? 0) - (y.loanBalance ?? 0), 1);
  });
});
