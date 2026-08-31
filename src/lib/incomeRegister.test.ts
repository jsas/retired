// Full income register (issue #119 Track 2). selfEmployment and rental were
// schema-only kinds the engine ignored; now selfEmployment is earned income
// (taxed like wages, builds RRSP room, saves its net) and rental is taxable
// investment income (net lands in taxable, no RRSP room, no pension-split).
import { describe, it, expect } from 'vitest';
import { calculateRetirement, type IncomeSource } from './retirementEngine';
import { calculateTax } from './canadianTax';
import { testConfig, baseInputs, yearAt, closeTo } from '../test/helpers';

const config = testConfig();
const ONT = 'ONT';

const src = (over: Partial<IncomeSource> = {}): IncomeSource => ({
  id: 's', label: 'src', kind: 'employment', annualAmount: 40000,
  startAge: 55, endAge: 59, indexedToCpi: false, ...over,
});

const mk = (income: IncomeSource[], over: Parameters<typeof baseInputs>[0] = {}) =>
  calculateRetirement(baseInputs({
    currentAge: 55, retirementAge: 60, maxAge: 62,
    rrspBalance: 0, tfsaBalance: 0, taxableBalance: 0, cashCushionBalance: 0,
    desiredSpending: 0, income, ...over,
  }), config);

const taxOn = (gross: number) => calculateTax(gross, ONT, config).totalTax;

describe('self-employment income', () => {
  it('is taxed and saved like employment (earned income)', () => {
    const r = mk([src({ kind: 'selfEmployment', destAccount: 'taxable' })]);
    const row = yearAt(r.yearlyBreakdown, 55);
    const net = 40000 - taxOn(40000);
    // Reported under the employment umbrella (earned) and saved to taxable.
    expect(closeTo(row.employmentGross ?? 0, 40000)).toBe(true);
    expect(closeTo(row.detail?.deposit?.taxable ?? 0, net, 1)).toBe(true);
    expect(closeTo(row.incomeTax, taxOn(40000), 1)).toBe(true);
  });

  it('builds RRSP room at 18% of earned income', () => {
    // Track room from $0; the first accrual year should add 18% × 40000 = 7200.
    const r = mk([src({ kind: 'selfEmployment', destAccount: 'taxable' })], { rrspRoom: 0 });
    const row = yearAt(r.yearlyBreakdown, 55);
    expect(closeTo(row.detail?.roomRemaining?.rrsp ?? 0, 7200, 1)).toBe(true);
  });
});

describe('rental income', () => {
  it('is taxed and the net lands in taxable (investment income)', () => {
    const r = mk([src({ kind: 'rental' })]);
    const row = yearAt(r.yearlyBreakdown, 55);
    const net = 40000 - taxOn(40000);
    expect(closeTo(row.rentalIncome ?? 0, 40000)).toBe(true);
    expect(closeTo(row.detail?.deposit?.taxable ?? 0, net, 1)).toBe(true);
    expect(closeTo(row.incomeTax, taxOn(40000), 1)).toBe(true);
  });

  it('does NOT build RRSP room (not earned income)', () => {
    const r = mk([src({ kind: 'rental' })], { rrspRoom: 0 });
    const row = yearAt(r.yearlyBreakdown, 55);
    // No earned income → no RRSP accrual this year.
    expect(row.detail?.roomRemaining?.rrsp ?? 0).toBe(0);
  });

  it('is reported separately from pension income', () => {
    const pension = src({ id: 'p', kind: 'pension', annualAmount: 10000 });
    const rental = src({ id: 'r', kind: 'rental', annualAmount: 40000 });
    const r = mk([pension, rental]);
    const row = yearAt(r.yearlyBreakdown, 55);
    expect(closeTo(row.pensionIncome, 10000)).toBe(true);
    expect(closeTo(row.rentalIncome ?? 0, 40000)).toBe(true);
  });
});

describe('rental in decumulation', () => {
  it('stacks for tax and covers spending like pension, but does not split', () => {
    // Rental through retirement; a modest spending target so draws occur.
    const rental = src({ kind: 'rental', annualAmount: 30000, startAge: 60, endAge: 70 });
    const r = calculateRetirement(baseInputs({
      currentAge: 60, retirementAge: 60, maxAge: 65,
      rrspBalance: 0, tfsaBalance: 0, taxableBalance: 100000, cashCushionBalance: 0,
      desiredSpending: 50000, cppStartAge: null, oasStartAge: null, income: [rental],
    }), config);
    const row = yearAt(r.yearlyBreakdown, 60);
    expect(closeTo(row.rentalIncome ?? 0, 30000)).toBe(true);
    // Rental is split-INELIGIBLE: splitEligibleIncome (registered + pension)
    // must not include it.
    expect((row.splitEligibleIncome ?? 0)).toBe(0);
  });
});
