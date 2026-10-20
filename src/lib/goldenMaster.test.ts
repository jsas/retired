// Golden master — a regression net over a synthetic RICH fixture that exercises
// every engine subsystem at once: accumulation→decumulation, spending bands,
// one-time & recurring cash events, a DB pension, a reverse-mortgage top-up, a
// spouse with pension-splitting, GIS, the OAS clawback, and a fixed charitable
// giving stream (the CRA donation-credit path — tiers, cap, household pooling).
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
import { calculateHousehold, type YearlyBreakdown } from '@retired/engine-core/retirementEngine';
import { testConfig, baseInputs, closeTo } from '@retired/engine-core/test/helpers';

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
  giving: [{ id: 'foodbank', label: 'Food Bank', mode: 'fixed', pct: 0, amount: 10000, basis: 'gross', fromAge: 65, toAge: null }],
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
  lifetimeTax: 233159.04,
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
  [65, 1534927.37, 1554494.9, 53577.25, -373.3, 13200, 8907.72, 0, 15000],
  [66, 1554494.9, 1573119.48, 55402.69, -138.1, 13200, 8907.72, 0, 15000],
  [67, 1573119.48, 1590716.53, 57263.76, 1530.21, 13200, 8907.72, 0, 15000],
  [68, 1590716.53, 1563898.06, 100397.77, 3010.47, 13200, 8907.72, 0, 15000],
  [69, 1563898.06, 1571544.41, 66292.61, 2441.44, 13200, 8907.72, 0, 15000],
  [70, 1571544.41, 1690340.6, 60795.24, 0, 13200, 8907.72, 0, 15000],
  [71, 1690340.6, 1692660.33, 77377.67, 4233.31, 13200, 8907.72, 0, 15000],
  [72, 1692660.33, 1692410.37, 79930.91, 4678.03, 13200, 8907.72, 0, 15000],
  [73, 1692410.37, 1675309.78, 95962.69, 13412.27, 13200, 8907.72, 0, 15000],
  [74, 1675309.78, 1653751.44, 99389.27, 13992.37, 13200, 8907.72, 0, 15000],
  [75, 1653751.44, 1656083.67, 75605.17, 6999.03, 13200, 9798.48, 0, 15000],
  [76, 1656083.67, 1655639.18, 78356.11, 7406.86, 13200, 9798.48, 0, 15000],
  [77, 1655639.18, 1651994.51, 81378.09, 11637.98, 13200, 9798.48, 0, 15000],
  [78, 1651994.51, 1644854.13, 84529.12, 12177.37, 13200, 9798.48, 0, 15000],
  [79, 1644854.13, 1633974.44, 87745.65, 12739.06, 13200, 9798.48, 0, 15000],
  [80, 1633974.44, 1619100.48, 91026.94, 13297.87, 13200, 9798.48, 0, 15000],
  [81, 1619100.48, 1599963.56, 94373.87, 13875.45, 13200, 9798.48, 0, 15000],
  [82, 1599963.56, 1576284.33, 97783.84, 14461.17, 13200, 9798.48, 0, 15000],
  [83, 1576284.33, 1547760.96, 101264.94, 15075.59, 13200, 9798.48, 0, 15000],
  [84, 1547760.96, 1514075.3, 104818.36, 16022.49, 13200, 9798.48, 0, 15000],
  [85, 1514075.3, 1508816.28, 76136.44, 11493.7, 13200, 9798.48, 0, 15000],
  [86, 1508816.28, 1500386.19, 78901.23, 11983.31, 13200, 9798.48, 0, 15000],
  [87, 1500386.19, 1488288.51, 81987.86, 12526.94, 13200, 9798.48, 0, 15000],
  [88, 1488288.51, 1472256.37, 85153.98, 13074.81, 13200, 9798.48, 0, 15000],
  [89, 1472256.37, 1452027.79, 88382.23, 13634.68, 13200, 9798.48, 0, 15000],
  [90, 1452027.79, 1452640.42, 67565.23, 3966.04, 13200, 9798.48, 0, 15000],
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
