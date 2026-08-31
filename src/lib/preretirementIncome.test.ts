// Pre-retirement income (issue #119 Track 1). Before this, income sources
// active before retirementAge vanished — the accumulation loop used them only
// as the meltdown transfer-tax floor, never taxing, depositing, or reporting
// them. Now each working year is taxed at the marginal rate and savingsRate ×
// net is saved into the source's account; pension net lands in taxable.
import { describe, it, expect } from 'vitest';
import { calculateRetirement, type IncomeSource } from '@retired/engine-core/retirementEngine';
import { calculateTax } from '@retired/engine-core/canadianTax';
import { testConfig, baseInputs, yearAt, closeTo } from '@retired/engine-core/test/helpers';

const config = testConfig();
const ONT = 'ONT';

const job = (over: Partial<IncomeSource> = {}): IncomeSource => ({
  id: 'j', label: 'salary', kind: 'employment', annualAmount: 80000,
  startAge: 55, endAge: 59, destAccount: 'taxable', indexedToCpi: false, ...over,
});

// A working person: employed 55–59, retires at 60, no starting assets, no
// spending target (isolate the income flow).
const mk = (income: IncomeSource[], over: Parameters<typeof baseInputs>[0] = {}) =>
  calculateRetirement(baseInputs({
    currentAge: 55, retirementAge: 60, maxAge: 62,
    rrspBalance: 0, tfsaBalance: 0, taxableBalance: 0, cashCushionBalance: 0,
    desiredSpending: 0, income, ...over,
  }), config);

const taxOn = (gross: number) => calculateTax(gross, ONT, config).totalTax;

describe('pre-retirement employment income', () => {
  it('taxes the gross and deposits the after-tax net into the source account', () => {
    const r = mk([job()]);
    const row = yearAt(r.yearlyBreakdown, 55);
    const net = 80000 - taxOn(80000);
    // Reported gross/tax/net on the accumulation row.
    expect(closeTo(row.employmentGross ?? 0, 80000)).toBe(true);
    expect(closeTo(row.employmentTax ?? 0, taxOn(80000), 1)).toBe(true);
    expect(closeTo(row.employmentNet ?? 0, net, 1)).toBe(true);
    // The full net (unset savingsRate = 100%) landed in taxable. Deposits are
    // applied after the year's growth step, so the year-end balance is the
    // ungrown deposit; it starts growing next year.
    expect(closeTo(row.taxableBalance, net, 1)).toBe(true);
    expect(closeTo(row.detail?.deposit?.taxable ?? 0, net, 1)).toBe(true);
  });

  it('reports the earnings tax in incomeTax and cumulativeTax', () => {
    const r = mk([job()]);
    const row = yearAt(r.yearlyBreakdown, 55);
    expect(closeTo(row.incomeTax, taxOn(80000), 1)).toBe(true);
    expect(closeTo(row.cumulativeTax, taxOn(80000), 1)).toBe(true);
    // Second working year compounds the cumulative tax.
    const y56 = yearAt(r.yearlyBreakdown, 56);
    expect(closeTo(y56.cumulativeTax, 2 * taxOn(80000), 2)).toBe(true);
  });

  it('stops depositing once the job ends', () => {
    const r = mk([job()]);
    // 60 is the first decumulation year; the job ended at 59 → no employment.
    expect(yearAt(r.yearlyBreakdown, 60).employmentGross ?? 0).toBe(0);
  });

  it('saves only savingsRate × net when the rate is set below 1', () => {
    const r = mk([job({ savingsRate: 0.5 })]);
    const row = yearAt(r.yearlyBreakdown, 55);
    const net = 80000 - taxOn(80000);
    // Only half the net is saved; the rest is assumed consumed.
    expect(closeTo(row.detail?.deposit?.taxable ?? 0, net * 0.5, 1)).toBe(true);
    // Gross/tax/net are still reported in full (the rate affects saving, not pay).
    expect(closeTo(row.employmentNet ?? 0, net, 1)).toBe(true);
  });

  it('respects TFSA room caps on a registered destination pre-retirement', () => {
    const r = mk([job({ destAccount: 'tfsa' })], { tfsaRoom: 0 });
    const row = yearAt(r.yearlyBreakdown, 55);
    const net = 80000 - taxOn(80000);
    // Only the accrued $7k room fits; the rest of the net overflows to taxable.
    expect(closeTo(row.detail?.deposit?.tfsa ?? 0, 7000)).toBe(true);
    expect(closeTo(row.detail?.overflow?.tfsa ?? 0, net - 7000, 1)).toBe(true);
  });

  it('applies savingsRate to post-retirement (decumulation) work too', () => {
    // A semi-retirement job starting at 60 (the retirement age) — save-mode,
    // savingsRate 0.5, so only half the net is deposited into taxable.
    const semi = job({ startAge: 60, endAge: 61, savingsRate: 0.5 });
    const r = mk([semi], { retirementAge: 60 });
    const row = yearAt(r.yearlyBreakdown, 60);
    const net = 80000 - taxOn(80000);
    expect(closeTo(row.employmentGross ?? 0, 80000)).toBe(true);
    // Half the after-tax net is saved; the rest is consumed.
    expect(closeTo(row.detail?.deposit?.taxable ?? 0, net * 0.5, 1)).toBe(true);
  });
});

describe('pre-retirement pension income', () => {
  it('reports pensionIncome and deposits the net to taxable', () => {
    const pension: IncomeSource = {
      id: 'p', label: 'bridge', kind: 'pension', annualAmount: 12000,
      startAge: 55, endAge: 59, indexedToCpi: false,
    };
    const r = mk([pension]);
    const row = yearAt(r.yearlyBreakdown, 55);
    const net = 12000 - taxOn(12000);
    expect(closeTo(row.pensionIncome, 12000)).toBe(true);
    // Pension net lands in taxable after the growth step (ungrown at year-end).
    expect(closeTo(row.taxableBalance, net, 1)).toBe(true);
    expect(closeTo(row.detail?.deposit?.taxable ?? 0, net, 1)).toBe(true);
  });
});

describe('no double-tax with a meltdown transfer', () => {
  it('taxes employment once and the transfer incrementally on top', () => {
    const r = mk([job()], {
      rrspBalance: 200000,
      events: [{
        id: 'm', age: 55, label: 'm', amount: 50000, direction: 'out',
        from: { kind: 'account', person: 'primary', account: 'rrsp' },
        to: { kind: 'account', person: 'primary', account: 'taxable' },
      }],
    });
    const row = yearAt(r.yearlyBreakdown, 55);
    // Year tax = tax(80000 + 50000) − tax(0): employment tax + transfer's
    // incremental tax over the employment base. Verified against a single
    // calculateTax call on the combined income.
    const expected = taxOn(80000 + 50000);
    expect(closeTo(row.incomeTax, expected, 1)).toBe(true);
  });
});
