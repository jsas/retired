// Tax character (issue #119 Track 3). Two bounded refinements over the single
// ordinary-income calculator: (1) the self-employed both-sides CPP contribution
// is a deduction from taxable income AND money paid out of take-home; (2)
// registered (RRIF/RRSP) draws are pension-split-eligible only from age 65 —
// a DB pension is eligible at any age. Deferred: $2k pension-amount credit, EI,
// dividend gross-up, CCA.
import { describe, it, expect } from 'vitest';
import { calculateRetirement, calculateHousehold, type IncomeSource } from './retirementEngine';
import { calculateTax, selfEmployedCppContribution } from './canadianTax';
import { testConfig, baseInputs, yearAt, closeTo } from '../test/helpers';

const config = testConfig();
const ONT = 'ONT';

describe('selfEmployedCppContribution', () => {
  it('is 0 at/below the basic exemption', () => {
    expect(selfEmployedCppContribution(3500, config)).toBe(0);
    expect(selfEmployedCppContribution(0, config)).toBe(0);
  });
  it('charges the combined rate on pensionable earnings', () => {
    // (40000 − 3500) × 11.9% = 4343.50
    expect(closeTo(selfEmployedCppContribution(40000, config), 36500 * 0.119, 0.5)).toBe(true);
  });
  it('caps pensionable earnings at the YMPE', () => {
    // (71300 − 3500) × 11.9% — earnings above the YMPE add nothing.
    const cap = (71300 - 3500) * 0.119;
    expect(closeTo(selfEmployedCppContribution(200000, config), cap, 0.5)).toBe(true);
  });
});

describe('self-employment CPP in the engine', () => {
  const selfEmp = (over: Partial<IncomeSource> = {}): IncomeSource => ({
    id: 'se', label: 'consulting', kind: 'selfEmployment', annualAmount: 40000,
    startAge: 55, endAge: 59, destAccount: 'taxable', indexedToCpi: false, ...over,
  });
  const mk = (income: IncomeSource[]) =>
    calculateRetirement(baseInputs({
      currentAge: 55, retirementAge: 60, maxAge: 62,
      rrspBalance: 0, tfsaBalance: 0, taxableBalance: 0, cashCushionBalance: 0,
      desiredSpending: 0, income,
    }), config);

  it('taxes self-employment net of the CPP deduction', () => {
    const r = mk([selfEmp()]);
    const row = yearAt(r.yearlyBreakdown, 55);
    const cpp = selfEmployedCppContribution(40000, config);
    // Tax is on (gross − CPP deduction), not the full gross.
    expect(closeTo(row.incomeTax, calculateTax(40000 - cpp, ONT, config).totalTax, 1)).toBe(true);
  });

  it('withholds the CPP contribution from the saved take-home', () => {
    const r = mk([selfEmp()]);
    const row = yearAt(r.yearlyBreakdown, 55);
    const cpp = selfEmployedCppContribution(40000, config);
    const tax = calculateTax(40000 - cpp, ONT, config).totalTax;
    // Take-home = gross − income tax − CPP; saved 100% to taxable.
    expect(closeTo(row.detail?.deposit?.taxable ?? 0, 40000 - tax - cpp, 1)).toBe(true);
  });

  it('does not deduct CPP for a T4 employment source (employee)', () => {
    const r = mk([selfEmp({ kind: 'employment' })]);
    const row = yearAt(r.yearlyBreakdown, 55);
    // A T4 job has no both-sides CPP deduction in the engine: tax on full gross.
    expect(closeTo(row.incomeTax, calculateTax(40000, ONT, config).totalTax, 1)).toBe(true);
  });
});

describe('registered-draw split gating at 65', () => {
  // A 60-year-old couple drawing heavily from RRSP; the spouse has no income.
  // Before 65 the registered draws are NOT split-eligible, so no split occurs;
  // from 65 they become eligible.
  const youngCouple = () => baseInputs({
    currentAge: 60, retirementAge: 60, maxAge: 70,
    rrspBalance: 900000, tfsaBalance: 0, withdrawalOrder: ['rrsp', 'tfsa', 'taxable'],
    desiredSpending: 70000,
    cppStartAge: null, oasStartAge: null, cppMonthlyAmount: 0,
    spouse: {
      enabled: true, currentAge: 60, retirementAge: 60,
      rrspBalance: 0, tfsaBalance: 20000, taxableBalance: 0, cashCushionBalance: 0,
      rrspContribution: 0, tfsaContribution: 0, taxableContribution: 0,
      cppStartAge: null, cppMonthlyAmount: 0, oasStartAge: null, oasYearsInCanada: 40,
      desiredSpending: 8000,
    },
  });

  it('treats pre-65 registered draws as split-INELIGIBLE', () => {
    const r = calculateHousehold(youngCouple(), config);
    // At 60–64 the primary draws registered income but splitEligible excludes it.
    const early = r.yearlyBreakdown.filter(y => y.age < 65 && (y.withdrawals ?? 0) > 0);
    expect(early.length).toBeGreaterThan(0);
    for (const y of early) expect(y.splitEligibleIncome ?? 0).toBe(0);
  });

  it('treats registered draws as split-eligible from age 65', () => {
    const r = calculateHousehold(youngCouple(), config);
    const at65 = r.yearlyBreakdown.filter(y => y.age >= 65 && (y.withdrawals ?? 0) > 0);
    expect(at65.length).toBeGreaterThan(0);
    for (const y of at65) expect(y.splitEligibleIncome ?? 0).toBeGreaterThan(0);
  });

  it('keeps a DB pension split-eligible before 65', () => {
    const pension: IncomeSource = {
      id: 'p', label: 'DB', kind: 'pension', annualAmount: 40000,
      startAge: 60, endAge: null, indexedToCpi: false,
    };
    const inputs = youngCouple();
    inputs.income = [pension];
    inputs.rrspBalance = 0; inputs.desiredSpending = 10000; // isolate the pension
    const r = calculateHousehold(inputs, config);
    const early = yearAt(r.yearlyBreakdown, 60);
    // No registered draws, but the DB pension is split-eligible at 60.
    expect(early.pensionIncome).toBeGreaterThan(0);
    expect(early.splitEligibleIncome ?? 0).toBeGreaterThan(0);
  });
});
