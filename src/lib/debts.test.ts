// Debts: consumer debt + mortgage as a drag on the plan. Each liability
// compounds at its own rate and is serviced out of cash flow, so it pushes
// portfolio withdrawals up until it's paid off. These tests pin the ledger
// math (interest accrual, the payment floor, payoff timing) and the
// second-order effect the feature exists to show: a debt makes the plan
// deplete earlier / leave less.
import { describe, it, expect } from 'vitest';
import { baseInputs, testConfig, yearAt, closeTo } from '@retired/engine-core/test/helpers';
import { calculateRetirement, calculateHousehold, combineHouseholdBreakdown } from '@retired/engine-core/retirementEngine';
import { legacyToPerson, legacySpouseToPerson, toHousehold } from '@retired/engine-core/householdTypes';
import type { Debt } from '@retired/engine-core/retirementEngine';

const card: Debt = {
  id: 'cc', label: 'Credit card', kind: 'creditCard',
  balance: 8000, interestRate: 0.1999, monthlyPayment: 400,
};

const mortgage = (over: Partial<Debt> = {}): Debt => ({
  id: 'mtg', label: 'Mortgage', kind: 'mortgage',
  balance: 320000, interestRate: 0.051, monthlyPayment: 2100,
  ...over,
});

describe('debt ledger', () => {
  it('accrues interest when the payment is zero', () => {
    const inputs = baseInputs({
      currentAge: 65, retirementAge: 65, maxAge: 67,
      tfsaBalance: 0, desiredSpending: 0,
      debts: [{ ...card, monthlyPayment: 0 }],
    });
    const res = calculateRetirement(inputs, testConfig());
    // $8,000 compounding at 19.99% for three years, never paid.
    expect(yearAt(res.yearlyBreakdown, 65).debtBalance).toBeCloseTo(8000 * 1.1999, 0);
    expect(yearAt(res.yearlyBreakdown, 66).debtBalance).toBeCloseTo(8000 * Math.pow(1.1999, 2), 0);
    expect(yearAt(res.yearlyBreakdown, 67).debtBalance).toBeCloseTo(8000 * Math.pow(1.1999, 3), 0);
    expect(yearAt(res.yearlyBreakdown, 65).debtPayments).toBe(0);
  });

  it('pays the debt off in the expected number of years, then frees the payment', () => {
    // $10,000 at 0% paid $500/mo ($6,000/yr) is gone in year 2 (the second
    // year's payment is capped at the remaining $4,000). With no interest the
    // payoff timing is exact, which makes the freed payment easy to assert.
    const inputs = baseInputs({
      currentAge: 65, retirementAge: 65, maxAge: 69,
      tfsaBalance: 100000, desiredSpending: 0,
      debts: [{ ...card, balance: 10000, interestRate: 0, monthlyPayment: 500 }],
    });
    const res = calculateRetirement(inputs, testConfig());
    expect(yearAt(res.yearlyBreakdown, 65).debtPayments).toBe(6000);
    expect(yearAt(res.yearlyBreakdown, 65).debtBalance).toBe(4000);
    expect(yearAt(res.yearlyBreakdown, 66).debtPayments).toBe(4000); // capped at the remainder
    expect(yearAt(res.yearlyBreakdown, 66).debtBalance).toBe(0);
    // Paid off: no payment from 67 on.
    expect(yearAt(res.yearlyBreakdown, 67).debtPayments).toBe(0);
    expect(yearAt(res.yearlyBreakdown, 67).debtBalance).toBe(0);
  });

  it('never lets the payment exceed the remaining balance (the final year pays less)', () => {
    // $1,000 at 0% with a $500/mo payment: the year-1 payment is capped at $1,000.
    const inputs = baseInputs({
      currentAge: 65, retirementAge: 65, maxAge: 66,
      tfsaBalance: 50000, desiredSpending: 0,
      debts: [{ ...card, balance: 1000, interestRate: 0, monthlyPayment: 500 }],
    });
    const res = calculateRetirement(inputs, testConfig());
    expect(yearAt(res.yearlyBreakdown, 65).debtPayments).toBe(1000);
    expect(yearAt(res.yearlyBreakdown, 65).debtBalance).toBe(0);
  });

  it('reports per-debt detail (interest, payment, ending balance)', () => {
    const inputs = baseInputs({
      currentAge: 65, retirementAge: 65, maxAge: 65,
      tfsaBalance: 100000, desiredSpending: 0,
      debts: [card],
    });
    const res = calculateRetirement(inputs, testConfig());
    const rows = yearAt(res.yearlyBreakdown, 65).detail?.debts;
    expect(rows).toHaveLength(1);
    expect(rows![0].label).toBe('Credit card');
    expect(closeTo(rows![0].interestAccrued, 8000 * 0.1999, 0.5)).toBe(true);
    expect(closeTo(rows![0].payment, 4800, 0.5)).toBe(true);
    expect(closeTo(rows![0].balanceEnd, 8000 * 1.1999 - 4800, 0.5)).toBe(true);
  });

  it('honours a startAge before which the debt is inert', () => {
    const inputs = baseInputs({
      currentAge: 60, retirementAge: 60, maxAge: 64,
      tfsaBalance: 100000, desiredSpending: 0,
      debts: [{ ...card, balance: 1000, interestRate: 0, monthlyPayment: 100, startAge: 62 }],
    });
    const res = calculateRetirement(inputs, testConfig());
    expect(yearAt(res.yearlyBreakdown, 60).debtPayments).toBe(0);
    expect(yearAt(res.yearlyBreakdown, 60).debtBalance).toBe(1000);
    expect(yearAt(res.yearlyBreakdown, 61).debtPayments).toBe(0);
    expect(yearAt(res.yearlyBreakdown, 62).debtPayments).toBe(1000); // pays off the $1,000
    expect(yearAt(res.yearlyBreakdown, 62).debtBalance).toBe(0);
  });

  it('honours an explicit endAge stop', () => {
    const inputs = baseInputs({
      currentAge: 65, retirementAge: 65, maxAge: 68,
      tfsaBalance: 100000, desiredSpending: 0,
      debts: [{ ...card, balance: 100000, interestRate: 0, monthlyPayment: 100, endAge: 66 }],
    });
    const res = calculateRetirement(inputs, testConfig());
    expect(yearAt(res.yearlyBreakdown, 66).debtPayments).toBe(1200);
    // Payments stop at endAge even though a balance remains.
    expect(yearAt(res.yearlyBreakdown, 67).debtPayments).toBe(0);
    expect(yearAt(res.yearlyBreakdown, 67).debtBalance).toBeGreaterThan(0);
  });
});

describe('debts drag on the plan', () => {
  // A modest plan with a tight budget so the card payment is material.
  const tight = (debts?: Debt[]) => baseInputs({
    currentAge: 65, retirementAge: 65, maxAge: 90,
    tfsaBalance: 150000, desiredSpending: 12000,
    investmentReturn: 0.05, debts,
  });

  it('raises the spending target by the year’s payment (decumulation funding)', () => {
    const noDebt = calculateRetirement(tight(), testConfig());
    const withCard = calculateRetirement(tight([card]), testConfig());
    const baseTarget = yearAt(noDebt.yearlyBreakdown, 65).spendingTarget;
    const cardTarget = yearAt(withCard.yearlyBreakdown, 65).spendingTarget;
    // The card adds its $4,800/yr on top of the same lifestyle target.
    expect(closeTo(cardTarget - baseTarget, 4800, 1)).toBe(true);
  });

  it('leaves less money than the debt-free plan', () => {
    // A funded plan (no depletion) so the difference shows in the estate, not
    // in a shared depletion. Same spending, more savings than `tight`.
    const funded = (debts?: Debt[]) => baseInputs({
      currentAge: 65, retirementAge: 65, maxAge: 90,
      tfsaBalance: 500000, desiredSpending: 12000, investmentReturn: 0.05, debts,
    });
    const noDebt = calculateRetirement(funded(), testConfig());
    const withCard = calculateRetirement(funded([card]), testConfig());
    const last = (r: typeof noDebt) => r.yearlyBreakdown[r.yearlyBreakdown.length - 1].endingBalance;
    expect(last(withCard)).toBeLessThan(last(noDebt));
  });

  it('a big mortgage can flip a plan from ON_TRACK to SHORTFALL', () => {
    // A plan that's just funded ($400k against $18k/yr); a large mortgage
    // payment tips it over.
    const barely = (debts?: Debt[]) => baseInputs({
      currentAge: 65, retirementAge: 65, maxAge: 90,
      tfsaBalance: 400000, desiredSpending: 18000, investmentReturn: 0.05, debts,
    });
    const okPlan = calculateRetirement(barely(), testConfig());
    const withMtg = calculateRetirement(barely([mortgage({ monthlyPayment: 2600 })]), testConfig());
    expect(okPlan.status).toBe('ON_TRACK');
    expect(withMtg.status).toBe('SHORTFALL');
    expect(withMtg.depletionAge).not.toBeNull();
  });

  it('funds pre-retirement payments from the accounts (accumulation)', () => {
    // Working to 67 with a card: each accumulation year services the payment,
    // so the TFSA is lower at retirement than the debt-free twin.
    const accum = (debts?: Debt[]) => baseInputs({
      currentAge: 60, retirementAge: 67, maxAge: 90,
      tfsaBalance: 50000, tfsaContribution: 0, desiredSpending: 10000,
      investmentReturn: 0.05, debts,
    });
    const noDebt = calculateRetirement(accum(), testConfig());
    const withCard = calculateRetirement(accum([card]), testConfig());
    // The payment is a pre-retirement outflow: it shows in the year's spending
    // target and the balance net of interest is lower the next year.
    expect(yearAt(withCard.yearlyBreakdown, 60).debtPayments).toBe(4800);
    expect(yearAt(withCard.yearlyBreakdown, 61).debtBalance!).toBeLessThan(
      yearAt(withCard.yearlyBreakdown, 60).debtBalance!,
    );
    expect(noDebt.totalNetWorthAtRetirement).toBeGreaterThan(withCard.totalNetWorthAtRetirement);
  });
});

describe('debt register plumbing', () => {
  it('legacy converters pass debts through to the person', () => {
    const inputs = baseInputs({ debts: [card] });
    expect(legacyToPerson(inputs).debts).toEqual([card]);
  });

  it('spouse debts run in the spouse plan and sum into the household', () => {
    const inputs = baseInputs({
      currentAge: 65, retirementAge: 65, maxAge: 70,
      tfsaBalance: 200000, desiredSpending: 10000,
      spouse: {
        enabled: true, currentAge: 65, retirementAge: 65,
        rrspBalance: 0, tfsaBalance: 100000, taxableBalance: 0, cashCushionBalance: 0,
        rrspContribution: 0, tfsaContribution: 0, taxableContribution: 0,
        cppStartAge: null, cppMonthlyAmount: 0, oasStartAge: null, oasYearsInCanada: 40,
        desiredSpending: 8000, debts: [card],
      },
    });
    const res = calculateHousehold(inputs, testConfig());
    // The spouse's own run carries the card.
    expect(yearAt(res.spouse!.yearlyBreakdown, 65).debtPayments).toBe(4800);
    expect(yearAt(res.spouse!.yearlyBreakdown, 65).debtBalance).toBeGreaterThan(0);
    // The combined household row sums the payment.
    const combined = combineHouseholdBreakdown(res, toHousehold(inputs));
    expect(yearAt(combined, 65).debtPayments).toBe(4800);
  });

  it('legacySpouseToPerson passes spouse debts through', () => {
    const sp = legacySpouseToPerson({
      enabled: true, currentAge: 65, retirementAge: 65,
      rrspBalance: 0, tfsaBalance: 0, taxableBalance: 0, cashCushionBalance: 0,
      rrspContribution: 0, tfsaContribution: 0, taxableContribution: 0,
      cppStartAge: null, cppMonthlyAmount: 0, oasStartAge: null, oasYearsInCanada: 40,
      desiredSpending: 0, debts: [card],
    });
    expect(sp.debts).toEqual([card]);
  });
});
