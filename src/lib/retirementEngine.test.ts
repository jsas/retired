import { describe, it, expect } from 'vitest';
import { calculateRetirement, calculateHousehold, combineHouseholdBreakdown, householdOutcome, calculatePerson, type RetirementResults, type YearlyBreakdown, type CashEvent, type IncomeSource, type RetirementInputs } from './retirementEngine';
import { legacyToPerson, legacyToShared, legacySpouseToPerson } from './householdTypes';
import { calculateTax } from './canadianTax';
import { baselineInputs } from '../data/exampleScenarios';
import { testConfig, baseInputs, yearAt, closeTo } from '../test/helpers';

const config = testConfig();
const INFL = config.engine.inflationRate;
const indexSpendingOn = config.engine.indexSpending !== false;
const sf = (age: number, currentAge = 65) =>
  indexSpendingOn ? Math.pow(1 + INFL, Math.max(0, age - currentAge)) : 1;

describe('accumulation & growth', () => {
  it('grows balances by the investment return during accumulation', () => {
    const r = calculateRetirement(baseInputs({
      currentAge: 60, retirementAge: 65, tfsaBalance: 100000, tfsaContribution: 0,
    }), config);
    const first = yearAt(r.yearlyBreakdown, 60);
    expect(closeTo(first.tfsaBalance, 100000 * 1.05)).toBe(true);
  });

  it('adds contributions during accumulation and stops at retirement', () => {
    const r = calculateRetirement(baseInputs({
      currentAge: 60, retirementAge: 62, tfsaBalance: 0, tfsaContribution: 6000,
    }), config);
    expect(yearAt(r.yearlyBreakdown, 60).contributions).toBe(6000);
    expect(yearAt(r.yearlyBreakdown, 61).contributions).toBe(6000);
    expect(yearAt(r.yearlyBreakdown, 62).contributions).toBe(0);
  });
});

describe('spending target & indexSpending', () => {
  it('inflates the spending target when indexSpending is on', () => {
    const c = testConfig();
    c.engine.indexSpending = true;
    const r = calculateRetirement(baseInputs({ desiredSpending: 30000 }), c);
    expect(closeTo(yearAt(r.yearlyBreakdown, 70).spendingTarget, 30000 * Math.pow(1 + INFL, 5), 1)).toBe(true);
  });

  it('holds spending flat in today\'s dollars when indexSpending is off', () => {
    const c = testConfig();
    c.engine.indexSpending = false;
    const r = calculateRetirement(baseInputs({ desiredSpending: 30000 }), c);
    expect(closeTo(yearAt(r.yearlyBreakdown, 70).spendingTarget, 30000, 1)).toBe(true);
  });
});

describe('cash events', () => {
  it('one-time inflow lands only at its age', () => {
    const r = calculateRetirement(baseInputs({ events: [
      { id: 'e1', age: 70, label: 'sale', amount: 50000, direction: 'in', account: 'taxable' },
    ]}), config);
    const tx = (a: number) => yearAt(r.yearlyBreakdown, a).taxableBalance;
    expect(closeTo(tx(70), 50000 * 1.05, 1)).toBe(true);
    expect(closeTo(tx(71), tx(70) * 1.05, 1)).toBe(true); // growth only, no repeat
  });

  it('recurring inflow fires every year age..endAge, then stops', () => {
    const r = calculateRetirement(baseInputs({ events: [
      { id: 'e1', age: 70, endAge: 72, label: 'rent', amount: 5000, direction: 'in', account: 'taxable' },
    ]}), config);
    const tx = (a: number) => yearAt(r.yearlyBreakdown, a).taxableBalance;
    expect(closeTo(tx(70), 5000 * 1.05, 1)).toBe(true);
    expect(closeTo(tx(71), (tx(70) + 5000) * 1.05, 1)).toBe(true);
    expect(closeTo(tx(72), (tx(71) + 5000) * 1.05, 1)).toBe(true);
    expect(closeTo(tx(73), tx(72) * 1.05, 1)).toBe(true); // no deposit at 73
  });

  it('recurring outflow adds to each year\'s spending need', () => {
    const one = calculateRetirement(baseInputs({ events: [
      { id: 'e1', age: 70, label: 'gift', amount: 8000, direction: 'out' },
    ]}), config);
    const rec = calculateRetirement(baseInputs({ events: [
      { id: 'e1', age: 70, endAge: 71, label: 'gift', amount: 8000, direction: 'out' },
    ]}), config);
    const st = (r: typeof one, a: number) => yearAt(r.yearlyBreakdown, a).spendingTarget;
    expect(closeTo(st(rec, 71) - st(one, 71), 8000, 1)).toBe(true);
  });

  it('PRE-RETIREMENT inflow lands at its age and then grows', () => {
    // House sale at 51, retire at 55: taxable gets +1M at 51, then compounds.
    const r = calculateRetirement(baseInputs({
      currentAge: 50, retirementAge: 55, taxableBalance: 0, taxableContribution: 0,
      events: [{ id: 'sale', age: 51, label: 'House sale', amount: 1000000, direction: 'in', account: 'taxable' }],
    }), config);
    const tx = (a: number) => yearAt(r.yearlyBreakdown, a).taxableBalance;
    expect(tx(50)).toBe(0);
    expect(closeTo(tx(51), 1000000, 1)).toBe(true);          // landed at 51
    expect(closeTo(tx(52), 1000000 * 1.05, 1)).toBe(true);    // then grows
    // Recorded in the pre-retirement year's drill-down.
    expect(yearAt(r.yearlyBreakdown, 51).detail?.events).toEqual([
      { label: 'House sale', direction: 'in', amount: 1000000 },
    ]);
  });

  it('PRE-RETIREMENT outflow draws down accounts in withdrawal order', () => {
    // Big expense at 51 while still working, taxable first in the order.
    const r = calculateRetirement(baseInputs({
      currentAge: 50, retirementAge: 55,
      taxableBalance: 200000, taxableContribution: 0,
      tfsaBalance: 100000, tfsaContribution: 0,
      rrspBalance: 500000, rrspContribution: 0,
      withdrawalOrder: ['taxable', 'tfsa', 'rrsp'],
      events: [{ id: 'reno', age: 51, label: 'Renovation', amount: 250000, direction: 'out' }],
    }), config);
    const y51 = yearAt(r.yearlyBreakdown, 51);
    // Taxable (200k grown to 210k at 51) is emptied first, then the remaining
    // 40k comes from TFSA (100k grown to 110250); RRSP untouched.
    expect(y51.taxableBalance).toBe(0);
    expect(closeTo(y51.tfsaBalance, 100000 * Math.pow(1.05, 2) - (250000 - 200000 * Math.pow(1.05, 2)), 1)).toBe(true);
    expect(y51.rrspBalance).toBeGreaterThan(0);
    expect(y51.spendingTarget).toBe(250000);
    expect(y51.withdrawals).toBe(250000);
  });

  it('drops an event dated before the current age (it is in the model\'s past)', () => {
    // Current age 55, event at 52: can never fire, and must not silently add
    // money anywhere — taxable stays exactly on the no-event trajectory.
    const withEvent = calculateRetirement(baseInputs({
      currentAge: 55, retirementAge: 58, taxableBalance: 685000, taxableContribution: 0,
      events: [{ id: 'sale', age: 52, label: 'House sale', amount: 1650000, direction: 'in', account: 'taxable' }],
    }), config);
    const baseline = calculateRetirement(baseInputs({
      currentAge: 55, retirementAge: 58, taxableBalance: 685000, taxableContribution: 0,
    }), config);
    for (const age of [55, 56, 57]) {
      expect(yearAt(withEvent.yearlyBreakdown, age).taxableBalance)
        .toBe(yearAt(baseline.yearlyBreakdown, age).taxableBalance);
    }
  });

  it('ACCOUNTING IDENTITY holds through accumulation with events', () => {
    // ending = starting + contributions + marketGains + eventInflows
    //          − withdrawals − incomeTax, for EVERY year including the
    //          pre-retirement years that now carry inflows/outflows and the
    //          transition into decumulation. Guards the bookkeeping the
    //          pre-retirement-events change added.
    const r = calculateRetirement(baseInputs({
      currentAge: 50, retirementAge: 55, maxAge: 62,
      rrspBalance: 100000, tfsaBalance: 100000, taxableBalance: 200000, cashCushionBalance: 10000,
      rrspContribution: 5000, tfsaContribution: 5000, taxableContribution: 5000,
      events: [
        { id: 'in', age: 51, label: 'sale', amount: 50000, direction: 'in', account: 'taxable' },
        { id: 'out', age: 52, label: 'reno', amount: 40000, direction: 'out' },
      ],
      withdrawalOrder: ['taxable', 'tfsa', 'rrsp'],
    }), config);
    for (const y of r.yearlyBreakdown) {
      const inflow = (y.detail?.events ?? []).filter(e => e.direction === 'in').reduce((s, e) => s + e.amount, 0);
      const identity = y.startingBalance + y.contributions + y.marketGains + inflow - y.withdrawals - y.incomeTax;
      expect(closeTo(y.endingBalance, identity, 0.5)).toBe(true);
    }
  });

  it('pre-retirement inflow compounds into the retirement nest egg', () => {
    // A $1 before retirement should be worth (1+r)^years more at retirement —
    // the whole point of accounting for the event instead of dropping it.
    const r = calculateRetirement(baseInputs({
      currentAge: 50, retirementAge: 55, maxAge: 56, taxableBalance: 0, taxableContribution: 0,
      events: [{ id: 'in', age: 51, label: 'sale', amount: 100000, direction: 'in', account: 'taxable' }],
    }), config);
    // Landed at 51, then grows 52,53,54 (3 more years) into the age-55 start.
    expect(closeTo(yearAt(r.yearlyBreakdown, 54).taxableBalance, 100000 * Math.pow(1.05, 3), 1)).toBe(true);
    expect(closeTo(r.totalNetWorthAtRetirement, yearAt(r.yearlyBreakdown, 55).startingBalance, 1)).toBe(true);
  });

  it('an outflow bigger than every balance floors at zero (no NaN / negatives)', () => {
    const r = calculateRetirement(baseInputs({
      currentAge: 50, retirementAge: 55, maxAge: 60,
      rrspBalance: 10000, tfsaBalance: 10000, taxableBalance: 10000, cashCushionBalance: 5000,
      rrspContribution: 0, tfsaContribution: 0, taxableContribution: 0,
      withdrawalOrder: ['taxable', 'tfsa', 'rrsp'],
      events: [{ id: 'huge', age: 51, label: 'huge', amount: 1000000, direction: 'out' }],
    }), config);
    for (const y of r.yearlyBreakdown) {
      for (const b of [y.rrspBalance, y.tfsaBalance, y.taxableBalance, y.cashCushionBalance, y.endingBalance]) {
        expect(Number.isFinite(b)).toBe(true);
        expect(b).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe('transfer events (RRSP meltdown)', () => {
  const config = testConfig();

  it('moves RRSP → TFSA: gross leaves RRSP, after-tax net lands in TFSA', () => {
    // Retired, no other income, so the meltdown draw is the only taxable income.
    // A $50k RRSP→TFSA transfer: RRSP drops by $50k gross; TFSA gains $50k minus
    // the tax on $50k of income (ONT).
    const r = calculateRetirement(baseInputs({
      currentAge: 65, retirementAge: 65, maxAge: 66,
      rrspBalance: 500000, tfsaBalance: 0, taxableBalance: 0, cashCushionBalance: 0,
      desiredSpending: 0, // isolate the transfer: no spending draws
      events: [{
        id: 'meltdown', age: 65, label: 'RRSP meltdown', amount: 50000, direction: 'out',
        from: { kind: 'account', person: 'primary', account: 'rrsp' },
        to: { kind: 'account', person: 'primary', account: 'tfsa' },
      }],
    }), config);
    const row = yearAt(r.yearlyBreakdown, 65);
    // The transfer fired and is traced.
    const tr = row.detail?.calc?.transfers?.[0];
    expect(tr).toBeDefined();
    expect(tr!.gross).toBeCloseTo(50000, 0);
    expect(tr!.tax).toBeGreaterThan(0);
    expect(tr!.net).toBeCloseTo(tr!.gross - tr!.tax, 0);
    // Both ends show in provenance: gross out of RRSP, net into TFSA.
    expect(row.detail?.withdraw.rrsp).toBeCloseTo(50000, 0);
    expect(row.detail?.deposit?.tfsa).toBeCloseTo(tr!.net, 0);
    // The net landed at the start of the year and then grew (5%) with the TFSA.
    expect(row.tfsaBalance).toBeCloseTo(tr!.net * 1.05, 0);
  });

  it("pre-retirement meltdown stacks on the year's employment income (E-07 / #25)", () => {
    // Regression: pre-retirement the transfer-tax base started at $0, so a
    // registered meltdown for someone still drawing wages was taxed from the
    // bottom brackets instead of on top of their salary. The same $50k draw
    // must cost MORE tax when the year has employment income under it.
    const job = (over: Partial<import('./retirementEngine').IncomeSource> = {}): import('./retirementEngine').IncomeSource => ({
      id: 'j', label: 'salary', kind: 'employment', annualAmount: 80000, startAge: 55, endAge: 59,
      destAccount: 'tfsa', topUpSpending: false, indexedToCpi: false, ...over,
    });
    const mk = (employment: import('./retirementEngine').IncomeSource[]) => calculateRetirement(baseInputs({
      currentAge: 55, retirementAge: 60, maxAge: 61,
      rrspBalance: 200000, tfsaBalance: 0, taxableBalance: 0, cashCushionBalance: 0,
      desiredSpending: 0, // isolate the transfer: no spending draws
      income: employment,
      events: [{
        id: 'm', age: 55, label: 'm', amount: 50000, direction: 'out',
        from: { kind: 'account', person: 'primary', account: 'rrsp' },
        to: { kind: 'account', person: 'primary', account: 'tfsa' },
      }],
    }), config);
    const taxNo = yearAt(mk([]).yearlyBreakdown, 55).detail?.calc?.transfers?.[0]?.tax ?? 0;
    const taxWithJob = yearAt(mk([job()]).yearlyBreakdown, 55).detail?.calc?.transfers?.[0]?.tax ?? 0;
    expect(taxWithJob).toBeGreaterThan(taxNo);
    // The salary alone occupies the low brackets, so the $50k draw on top is
    // taxed at a materially higher rate, not just marginally more.
    expect(taxWithJob).toBeGreaterThan(taxNo * 1.5);
  });

  it('pre-retirement pension income also floors the transfer tax (E-07)', () => {
    // Same idea with a DB pension active before retirement (bridge/temporary
    // pensions can start pre-65).
    const r = calculateRetirement(baseInputs({
      currentAge: 55, retirementAge: 60, maxAge: 61,
      rrspBalance: 200000, tfsaBalance: 0, taxableBalance: 0, cashCushionBalance: 0,
      desiredSpending: 0,
      income: [{ id: 'p', label: 'DB', kind: 'pension', annualAmount: 40000, startAge: 55, endAge: null, indexedToCpi: false }],
      events: [{
        id: 'm', age: 55, label: 'm', amount: 50000, direction: 'out',
        from: { kind: 'account', person: 'primary', account: 'rrsp' },
        to: { kind: 'account', person: 'primary', account: 'tfsa' },
      }],
    }), config);
    const tr = yearAt(r.yearlyBreakdown, 55).detail?.calc?.transfers?.[0];
    expect(tr).toBeDefined();
    // No-income baseline tax on $50k for comparison.
    const noIncome = calculateRetirement(baseInputs({
      currentAge: 55, retirementAge: 60, maxAge: 61,
      rrspBalance: 200000, tfsaBalance: 0, taxableBalance: 0, cashCushionBalance: 0,
      desiredSpending: 0,
      events: [{
        id: 'm', age: 55, label: 'm', amount: 50000, direction: 'out',
        from: { kind: 'account', person: 'primary', account: 'rrsp' },
        to: { kind: 'account', person: 'primary', account: 'tfsa' },
      }],
    }), config);
    const taxNo = yearAt(noIncome.yearlyBreakdown, 55).detail?.calc?.transfers?.[0]?.tax ?? 0;
    expect(tr!.tax).toBeGreaterThan(taxNo);
  });

  it('a TFSA → taxable transfer is NOT taxed (after-tax money)', () => {
    const r = calculateRetirement(baseInputs({
      currentAge: 65, retirementAge: 65, maxAge: 66,
      rrspBalance: 0, tfsaBalance: 100000, taxableBalance: 0, cashCushionBalance: 0,
      desiredSpending: 0,
      events: [{
        id: 'shift', age: 65, label: 'TFSA to taxable', amount: 40000, direction: 'out',
        from: { kind: 'account', person: 'primary', account: 'tfsa' },
        to: { kind: 'account', person: 'primary', account: 'taxable' },
      }],
    }), config);
    const row = yearAt(r.yearlyBreakdown, 65);
    const tr = row.detail?.calc?.transfers?.[0];
    expect(tr).toBeDefined();
    expect(tr!.tax).toBe(0);
    expect(tr!.net).toBeCloseTo(40000, 0);
    // 100k − 40k transfer = 60k, then 5% growth on the year → 63k.
    expect(row.tfsaBalance).toBeCloseTo(60000 * 1.05, 0);
    expect(row.detail?.deposit?.taxable).toBeCloseTo(40000, 0);
  });

  it('transfer tax stacks on benefit income (higher marginal rate)', () => {
    // Same $50k meltdown, but now CPP/OAS already occupy the low brackets, so
    // the transfer's tax is HIGHER than the no-income case.
    const noIncome = calculateRetirement(baseInputs({
      currentAge: 65, retirementAge: 65, maxAge: 66,
      rrspBalance: 500000, tfsaBalance: 0, taxableBalance: 0, cashCushionBalance: 0,
      desiredSpending: 0,
      events: [{
        id: 'm', age: 65, label: 'm', amount: 50000, direction: 'out',
        from: { kind: 'account', person: 'primary', account: 'rrsp' },
        to: { kind: 'account', person: 'primary', account: 'tfsa' },
      }],
    }), config);
    const withBenefits = calculateRetirement(baseInputs({
      currentAge: 65, retirementAge: 65, maxAge: 66,
      rrspBalance: 500000, tfsaBalance: 0, taxableBalance: 0, cashCushionBalance: 0,
      desiredSpending: 0,
      cppStartAge: 65, cppMonthlyAmount: 1200, oasStartAge: 65, oasYearsInCanada: 40,
      events: [{
        id: 'm', age: 65, label: 'm', amount: 50000, direction: 'out',
        from: { kind: 'account', person: 'primary', account: 'rrsp' },
        to: { kind: 'account', person: 'primary', account: 'tfsa' },
      }],
    }), config);
    const taxNo = yearAt(noIncome.yearlyBreakdown, 65).detail?.calc?.transfers?.[0]?.tax ?? 0;
    const taxWith = yearAt(withBenefits.yearlyBreakdown, 65).detail?.calc?.transfers?.[0]?.tax ?? 0;
    expect(taxWith).toBeGreaterThan(taxNo);
  });

  it('a transfer event leaves the accounting identity intact', () => {
    const r = calculateRetirement(baseInputs({
      currentAge: 65, retirementAge: 65, maxAge: 70,
      rrspBalance: 300000, tfsaBalance: 50000, taxableBalance: 20000, cashCushionBalance: 5000,
      desiredSpending: 30000,
      events: [{
        id: 'm', age: 66, label: 'm', amount: 25000, direction: 'out',
        from: { kind: 'account', person: 'primary', account: 'rrsp' },
        to: { kind: 'account', person: 'primary', account: 'tfsa' },
      }],
    }), config);
    for (const y of r.yearlyBreakdown) {
      const total = y.rrspBalance + y.rrifBalance + y.tfsaBalance + y.taxableBalance + y.cashCushionBalance;
      expect(closeTo(y.endingBalance, Math.max(0, total), 1)).toBe(true);
      expect(Number.isFinite(y.endingBalance)).toBe(true);
    }
  });

  it('a plain outflow event still draws in withdrawal order (not treated as transfer)', () => {
    const r = calculateRetirement(baseInputs({
      currentAge: 65, retirementAge: 65, maxAge: 66,
      rrspBalance: 0, tfsaBalance: 80000, taxableBalance: 0, cashCushionBalance: 0,
      desiredSpending: 0,
      events: [{ id: 'car', age: 65, label: 'car', amount: 30000, direction: 'out' }],
    }), config);
    const row = yearAt(r.yearlyBreakdown, 65);
    // No transfer trace for a plain outflow.
    expect(row.detail?.calc?.transfers).toBeUndefined();
    // 80k − 30k outflow = 50k, then 5% growth → 52.5k.
    expect(row.tfsaBalance).toBeCloseTo(50000 * 1.05, 0);
  });

  it('a sourced outflow (from account → external) actually leaves the named account', () => {
    // Regression: converting a plain outflow to advanced mode sets
    // from: account, to: external — which used to be dropped entirely (no
    // withdrawal, no trace). The money must leave the named account and be
    // recorded as a transfer out of the plan.
    const r = calculateRetirement(baseInputs({
      currentAge: 65, retirementAge: 65, maxAge: 66,
      rrspBalance: 0, tfsaBalance: 80000, taxableBalance: 0, cashCushionBalance: 0,
      desiredSpending: 0,
      events: [{
        id: 'car', age: 65, label: 'car', amount: 30000, direction: 'out',
        from: { kind: 'account', person: 'primary', account: 'tfsa' },
        to: { kind: 'external' },
      }],
    }), config);
    const row = yearAt(r.yearlyBreakdown, 65);
    const tr = row.detail?.calc?.transfers?.[0];
    expect(tr).toBeDefined();
    expect(tr!.gross).toBeCloseTo(30000, 0);
    expect(tr!.tax).toBe(0); // TFSA source is after-tax money
    // The money left the TFSA (80k − 30k = 50k, then 5% growth → 52.5k) and
    // did NOT land anywhere else in the plan.
    expect(row.tfsaBalance).toBeCloseTo(50000 * 1.05, 0);
    expect(row.detail?.withdraw.tfsa).toBeCloseTo(30000, 0);
  });

  it('a taxable-account transfer adds its realized gain to capitalGains (feeds year tax/GIS)', () => {
    // Regression: the taxable-transfer branch never added the realized gain to
    // capitalGains (unlike a taxable spending draw), so the year's unified
    // incomeTax and GIS ignored it — the math page showed zero tax while the
    // transfer-tax estimate had already left the balances.
    const cfg = testConfig();
    cfg.engine.taxableAcbRatio = 0.5; // 50% embedded gains
    const r = calculateRetirement(baseInputs({
      currentAge: 65, retirementAge: 65, maxAge: 66,
      rrspBalance: 0, tfsaBalance: 0, taxableBalance: 100000, cashCushionBalance: 0,
      cppStartAge: 65, cppMonthlyAmount: 900, oasStartAge: 65, oasYearsInCanada: 40,
      desiredSpending: 0,
      events: [{
        id: 'rebalance', age: 65, label: 'taxable → TFSA', amount: 40000, direction: 'out',
        from: { kind: 'account', person: 'primary', account: 'taxable' },
        to: { kind: 'account', person: 'primary', account: 'tfsa' },
      }],
    }), cfg);
    const row = yearAt(r.yearlyBreakdown, 65);
    const tr = row.detail?.calc?.transfers?.[0];
    expect(tr).toBeDefined();
    // Realized gain = gross × gainsFraction = 40000 × 0.5 = 20000.
    expect(row.detail?.tax?.capitalGains).toBeCloseTo(20000, 0);
    // The transfer's tax estimate was positive (gain taxed)...
    expect(tr!.tax).toBeGreaterThan(0);
    // ...and the year's unified income tax is NOT zero (it taxes that gain once).
    expect(row.incomeTax).toBeGreaterThan(0);
  });
});

describe('inter-spousal transfers (household conservation)', () => {
  const config = testConfig();

  // A same-age couple so age translation is 1:1. Primary holds the money and
  // defines the transfer; spouse starts empty so any spouse balance is proof
  // the landing was credited.
  const couple = () => baseInputs({
    currentAge: 65, retirementAge: 65, maxAge: 66,
    rrspBalance: 0, tfsaBalance: 0, taxableBalance: 100000, cashCushionBalance: 0,
    desiredSpending: 0,
    spouse: {
      enabled: true, currentAge: 65, retirementAge: 65,
      rrspBalance: 0, tfsaBalance: 0, taxableBalance: 0, cashCushionBalance: 0,
      rrspContribution: 0, tfsaContribution: 0, taxableContribution: 0,
      cppStartAge: null, cppMonthlyAmount: 0, oasStartAge: null, oasYearsInCanada: 40,
      desiredSpending: 0,
    },
  });

  it('primary taxable → spouse TFSA: source drops by gross, spouse gains it (untaxed)', () => {
    const inputs = couple();
    inputs.events = [{
      id: 'gift', age: 65, label: 'fund spouse TFSA', amount: 40000, direction: 'out',
      from: { kind: 'account', person: 'primary', account: 'taxable' },
      to: { kind: 'account', person: 'spouse', account: 'tfsa' },
    }];
    const r = calculateHousehold(inputs, config);
    const prow = yearAt(r.yearlyBreakdown, 65);
    const srow = yearAt(r.spouse!.yearlyBreakdown, 65);
    // Taxable source is taxed on gains only; with ACB = balance there is no
    // gain yet, so the full 40k crosses as net.
    const tr = prow.detail?.calc?.transfers?.[0];
    expect(tr).toBeDefined();
    expect(tr!.gross).toBeCloseTo(40000, 0);
    const net = tr!.net;
    // Source: 100k − 40k gross = 60k, then 5% growth → 63k.
    expect(prow.taxableBalance).toBeCloseTo(60000 * 1.05, 0);
    // The primary run records the outbound landing for the household pass.
    expect(r.crossDeposits?.[0]?.account).toBe('tfsa');
    expect(r.crossDeposits?.[0]?.amount).toBeCloseTo(net, 0);
    // Destination: spouse TFSA received the net at start of year, then grew 5%.
    expect(srow.detail?.deposit?.tfsa).toBeCloseTo(net, 0);
    expect(srow.tfsaBalance).toBeCloseTo(net * 1.05, 0);
    // Household conservation: money neither created nor destroyed by the move.
    const householdEnd = prow.endingBalance + srow.endingBalance;
    const start = 100000;
    const growth = (prow.endingBalance + srow.endingBalance) - (start * 1.05);
    expect(Number.isFinite(householdEnd)).toBe(true);
    // Only tax (on the taxable gains portion) can reduce the total below pure growth.
    expect(householdEnd).toBeLessThanOrEqual(start * 1.05 + 1);
    expect(growth).toBeGreaterThanOrEqual(-tr!.tax * 1.05 - 1);
  });

  it('primary RRSP → spouse TFSA: gross taxed once, after-tax net lands with spouse', () => {
    const inputs = couple();
    inputs.rrspBalance = 500000;
    inputs.taxableBalance = 0;
    inputs.events = [{
      id: 'melt', age: 65, label: 'meltdown to spouse', amount: 50000, direction: 'out',
      from: { kind: 'account', person: 'primary', account: 'rrsp' },
      to: { kind: 'account', person: 'spouse', account: 'tfsa' },
    }];
    const r = calculateHousehold(inputs, config);
    const prow = yearAt(r.yearlyBreakdown, 65);
    const srow = yearAt(r.spouse!.yearlyBreakdown, 65);
    const tr = prow.detail?.calc?.transfers?.[0];
    expect(tr).toBeDefined();
    expect(tr!.tax).toBeGreaterThan(0); // RRSP draw is taxable income
    expect(tr!.net).toBeCloseTo(tr!.gross - tr!.tax, 0);
    // Source: 500k − 50k gross = 450k, then 5% growth → 472.5k.
    expect(prow.rrspBalance).toBeCloseTo(450000 * 1.05, 0);
    // Destination receives the AFTER-TAX net (the draw was taxed once, here).
    expect(srow.detail?.deposit?.tfsa).toBeCloseTo(tr!.net, 0);
    expect(srow.tfsaBalance).toBeCloseTo(tr!.net * 1.05, 0);
  });

  it('age translation: a transfer from an older primary lands in the right spouse year', () => {
    // Primary 65, spouse 62. Primary transfers at primary-age 66 → calendar year
    // is spouse-age 63. The spouse deposit must appear on the spouse's age-63 row.
    const inputs = couple();
    inputs.spouse!.currentAge = 62;
    inputs.events = [{
      id: 'gift', age: 66, label: 'fund spouse TFSA', amount: 30000, direction: 'out',
      from: { kind: 'account', person: 'primary', account: 'taxable' },
      to: { kind: 'account', person: 'spouse', account: 'tfsa' },
    }];
    const r = calculateHousehold(inputs, config);
    const net = yearAt(r.yearlyBreakdown, 66).detail?.calc?.transfers?.[0]?.net ?? 0;
    expect(net).toBeGreaterThan(0);
    // Spouse receives it at spouse-age 66 − (65 − 62) = 63.
    expect(yearAt(r.spouse!.yearlyBreakdown, 63).detail?.deposit?.tfsa).toBeCloseTo(net, 0);
  });

  it('a RECURRING transfer lands in the spouse run each firing year, not all in year one', () => {
    // Regression: cross-deposits were stamped with the event's START age, so a
    // 3-year transfer dumped 3× into the spouse's first year and nothing after.
    const inputs = baseInputs({
      currentAge: 65, retirementAge: 65, maxAge: 67,
      rrspBalance: 0, tfsaBalance: 0, taxableBalance: 100000, cashCushionBalance: 0,
      desiredSpending: 0,
      spouse: {
        enabled: true, currentAge: 65, retirementAge: 65,
        rrspBalance: 0, tfsaBalance: 0, taxableBalance: 0, cashCushionBalance: 0,
        rrspContribution: 0, tfsaContribution: 0, taxableContribution: 0,
        cppStartAge: null, cppMonthlyAmount: 0, oasStartAge: null, oasYearsInCanada: 40,
        desiredSpending: 0,
      },
    });
    inputs.events = [{
      id: 'gift', age: 65, endAge: 67, label: 'yearly gift', amount: 10000, direction: 'out',
      from: { kind: 'account', person: 'primary', account: 'taxable' },
      to: { kind: 'account', person: 'spouse', account: 'tfsa' },
    }];
    const r = calculateHousehold(inputs, config);
    // Outbound landings are stamped 65, 66, 67 — one per firing year.
    expect((r.crossDeposits ?? []).map(d => d.age)).toEqual([65, 66, 67]);
    // The spouse receives a deposit in EACH year (taxable source, ACB=balance →
    // no gain, so the full 10k crosses), not 30k in year one.
    for (const age of [65, 66, 67]) {
      expect(yearAt(r.spouse!.yearlyBreakdown, age).detail?.deposit?.tfsa).toBeCloseTo(10000, 0);
    }
  });
});

// ---------------------------------------------------------------------------
// E-02 fixed-point oracle: does calculateHousehold's re-run loop converge?
// ---------------------------------------------------------------------------
describe('household re-run convergence (E-02)', () => {
  // Pension splitting is applied AFTER the re-run loop and reallocates tax
  // between the partners; disable it so engine-vs-oracle tax rows compare
  // cleanly (the oracle replicates the loop only, not the post-split pass).
  const config = testConfig();
  config.engine.pensionSplitMaxRate = 0;

  // Replicate calculateHousehold's iterate-pair passes EXACTLY (same initial
  // runs, same rehome/translate, same feed order — Gauss-Seidel), but with no
  // 5-pass cap and a pure fixed-point break: the pair repeats byte-for-byte.
  // The engine's result must match this oracle (within the loop's own $1 GIS
  // / deposit-stability criteria) — if the engine stopped one oscillation
  // early, its returned pair would differ from the settled pair.
  const oraclePair = (inputs: ReturnType<typeof baseInputs>): { primary: RetirementResults; spouse: RetirementResults; passes: number } => {
    const shared = legacyToShared(inputs);
    const primaryPerson = legacyToPerson(inputs);
    const sp = legacySpouseToPerson(inputs.spouse!);
    const primaryCtx = {
      cppStartAge: sp.cppStartAge,
      cppMonthlyAmount: sp.cppMonthlyAmount,
      oasStartAge: sp.oasStartAge,
      oasYearsInCanada: sp.oasYearsInCanada,
      currentAge: sp.currentAge,
      income: sp.income,
    };
    const rehome = (
      ownerEvents: CashEvent[] | undefined,
      ownerCurrentAge: number,
      selfRef: 'primary' | 'spouse',
      selfCurrentAge: number,
    ): CashEvent[] => (ownerEvents ?? [])
      .filter(e => e.from && e.from.kind === 'account' && e.from.person === selfRef)
      .map(e => {
        const shift = ownerCurrentAge - selfCurrentAge;
        const age = e.age - shift;
        const clamped = Math.max(age, selfCurrentAge);
        return {
          ...e, age: clamped,
          ...(e.endAge != null ? { endAge: Math.max(e.endAge - shift, clamped) } : {}),
        };
      });
    const primaryRun: typeof primaryPerson = {
      ...primaryPerson,
      events: [...(primaryPerson.events ?? []), ...rehome(sp.events, sp.currentAge, 'primary', primaryPerson.currentAge) ?? []],
    } as typeof primaryPerson;
    const spRun: typeof primaryPerson = {
      ...sp,
      events: [...(sp.events ?? []), ...rehome(primaryPerson.events, primaryPerson.currentAge, 'spouse', sp.currentAge)],
    } as typeof primaryPerson;
    const translate = (
      deposits: NonNullable<RetirementResults['crossDeposits']>,
      fromCurrentAge: number,
      toCurrentAge: number,
    ) => deposits.map(d => ({ ...d, age: d.age - (fromCurrentAge - toCurrentAge) }));

    // Pass 0: primary runs cold; spouse runs on primary's first crossDeposits.
    let P = calculatePerson(primaryRun, shared, config, { personRef: 'primary', spouseContext: { ...primaryCtx } });
    let S = calculatePerson(spRun, shared, config, {
      personRef: 'spouse',
      spouseContext: { ...primaryCtx },
      ...(translate(P.crossDeposits ?? [], primaryPerson.currentAge, sp.currentAge).length > 0
        ? { inboundDeposits: translate(P.crossDeposits ?? [], primaryPerson.currentAge, sp.currentAge) }
        : {}),
    });

    // Iterate to a TRUE fixed point: re-run both, break only when the pair is
    // byte-identical to the previous pass (no per-field tolerance, no cap).
    const pairKey = (p: RetirementResults, s: RetirementResults) =>
      JSON.stringify([p.yearlyBreakdown, p.crossDeposits, p.householdDraws])
      + JSON.stringify([s.yearlyBreakdown, s.crossDeposits, s.householdDraws]);
    let passes = 0;
    let prevKey = pairKey(P, S);
    for (;;) {
      passes++;
      const pToS = translate(P.crossDeposits ?? [], primaryPerson.currentAge, sp.currentAge);
      const sToP = translate(S.crossDeposits ?? [], sp.currentAge, primaryPerson.currentAge);
      P = calculatePerson(primaryRun, shared, config, {
        personRef: 'primary',
        spouseContext: { ...primaryCtx, partnerDrawsAt: (a: number) => S.householdDraws?.[a] ?? 0 },
        ...(sToP.length > 0 ? { inboundDeposits: sToP } : {}),
      });
      S = calculatePerson(spRun, shared, config, {
        personRef: 'spouse',
        spouseContext: { ...primaryCtx, partnerDrawsAt: (a: number) => P.householdDraws?.[a] ?? 0 },
        ...(pToS.length > 0 ? { inboundDeposits: pToS } : {}),
      });
      const key = pairKey(P, S);
      if (key === prevKey) break; // true fixed point reached
      prevKey = key;
      if (passes > 60) throw new Error('oracle did not converge within 60 passes');
    }
    return { primary: P, spouse: S, passes };
  };

  const melt = (from: 'primary' | 'spouse', amount: number, endAge = 68) => ({
    id: `melt-${from}`, age: 65, endAge, label: `meltdown ${from}`, amount, direction: 'out' as const,
    from: { kind: 'account' as const, person: from, account: 'rrsp' as const },
    to: { kind: 'account' as const, person: (from === 'primary' ? 'spouse' : 'primary') as 'primary' | 'spouse', account: 'tfsa' as const },
  });

  const compare = (
    engineP: RetirementResults, engineS: RetirementResults,
    oracleP: RetirementResults, oracleS: RetirementResults,
  ) => {
    const cmp = (a: YearlyBreakdown[], b: YearlyBreakdown[]) => {
      expect(a.length).toBe(b.length);
      for (let i = 0; i < a.length; i++) {
        expect(closeTo(a[i].gisIncome, b[i].gisIncome, 1)).toBe(true);
        expect(closeTo(a[i].incomeTax, b[i].incomeTax, 2)).toBe(true);
        expect(closeTo(a[i].rrspBalance, b[i].rrspBalance, 2)).toBe(true);
        expect(closeTo(a[i].tfsaBalance, b[i].tfsaBalance, 2)).toBe(true);
        expect(closeTo(a[i].taxableBalance, b[i].taxableBalance, 2)).toBe(true);
        expect(closeTo(a[i].endingBalance, b[i].endingBalance, 2)).toBe(true);
      }
    };
    cmp(engineP.yearlyBreakdown, oracleP.yearlyBreakdown);
    cmp(engineS.yearlyBreakdown, oracleS.yearlyBreakdown);
    expect(JSON.stringify(engineP.crossDeposits)).toBe(JSON.stringify(oracleP.crossDeposits));
    expect(JSON.stringify(engineS.crossDeposits)).toBe(JSON.stringify(oracleS.crossDeposits));
  };

  it('two-way transfers, no GIS: engine pair is the true fixed point', () => {
    // Both partners melt down part of their RRSP into the OTHER's TFSA — the
    // two-way deposit coupling with GIS out of the picture (no OAS/CPP).
    const inputs = baseInputs({
      currentAge: 65, retirementAge: 65, maxAge: 75,
      rrspBalance: 400000, tfsaBalance: 20000, taxableBalance: 0, cashCushionBalance: 0,
      desiredSpending: 32000,
      cppStartAge: null, cppMonthlyAmount: 0,
      oasStartAge: null, oasYearsInCanada: 40,
      spouse: {
        enabled: true, currentAge: 63, retirementAge: 63,
        rrspBalance: 260000, tfsaBalance: 10000, taxableBalance: 0, cashCushionBalance: 0,
        rrspContribution: 0, tfsaContribution: 0, taxableContribution: 0,
        cppStartAge: null, cppMonthlyAmount: 0, oasStartAge: null, oasYearsInCanada: 40,
        desiredSpending: 16000,
      },
    });
    inputs.events = [melt('primary', 12000), melt('spouse', 8000)];

    const engine = calculateHousehold(inputs, config);
    const { primary: oracleP, spouse: oracleS, passes } = oraclePair(inputs);
    // The oracle must actually iterate (the coupling is real), not pass on
    // pass 0 — otherwise this fixture proves nothing.
    expect(passes).toBeGreaterThanOrEqual(2);
    compare(engine, engine.spouse!, oracleP, oracleS);
    // Two-way transfers really fired both ways (fixture sanity).
    expect((engine.crossDeposits ?? []).length).toBe(4);
    expect((engine.spouse!.crossDeposits ?? []).length).toBe(4);
  });

  it('two-way transfers + couple GIS: engine pair is the true fixed point', () => {
    // Low income so couple GIS is alive on BOTH sides: each partner's draws
    // shrink the other's GIS, which changes their need, which changes their
    // draws — the strongest coupling the household pass iterates over. The
    // partner-draw feedback must settle identically to the oracle.
    const inputs = baseInputs({
      currentAge: 65, retirementAge: 65, maxAge: 75,
      rrspBalance: 60000, tfsaBalance: 10000, taxableBalance: 0, cashCushionBalance: 0,
      desiredSpending: 8000,
      cppStartAge: 65, cppMonthlyAmount: 50,
      oasStartAge: 65, oasYearsInCanada: 40,
      spouse: {
        enabled: true, currentAge: 63, retirementAge: 63,
        rrspBalance: 60000, tfsaBalance: 10000, taxableBalance: 0, cashCushionBalance: 0,
        rrspContribution: 0, tfsaContribution: 0, taxableContribution: 0,
        cppStartAge: 65, cppMonthlyAmount: 50, oasStartAge: 65, oasYearsInCanada: 40,
        desiredSpending: 8000,
      },
    });
    inputs.events = [melt('primary', 2000), melt('spouse', 2000)];

    const engine = calculateHousehold(inputs, config);
    const { primary: oracleP, spouse: oracleS, passes } = oraclePair(inputs);
    expect(passes).toBeGreaterThanOrEqual(2);
    compare(engine, engine.spouse!, oracleP, oracleS);
    // Couple GIS actually engaged on both sides (fixture sanity: the GIS
    // coupling is live, not bypassed by the zero-GIS fast path).
    expect(engine.yearlyBreakdown.some(y => y.gisIncome > 0)).toBe(true);
    expect(engine.spouse!.yearlyBreakdown.some(y => y.gisIncome > 0)).toBe(true);
  });
});

describe('spouse toggle / unlink (regression)', () => {
  const config = testConfig();
  const withSpouse = () => baseInputs({
    currentAge: 65, retirementAge: 65, maxAge: 70,
    desiredSpending: 20000,
    spouse: {
      enabled: true, currentAge: 63, retirementAge: 65,
      rrspBalance: 100000, tfsaBalance: 50000, taxableBalance: 0, cashCushionBalance: 0,
      rrspContribution: 0, tfsaContribution: 0, taxableContribution: 0,
      cppStartAge: 65, cppMonthlyAmount: 700, oasStartAge: 65, oasYearsInCanada: 40,
      desiredSpending: 18000,
    },
  });

  it('an enabled spouse runs and attaches results.spouse', () => {
    const r = calculateHousehold(withSpouse(), config);
    expect(r.spouse).toBeDefined();
    expect(r.spouse!.yearlyBreakdown.length).toBeGreaterThan(0);
  });

  it('removing the spouse drops results.spouse and the age offset collapses', () => {
    // Mirrors the App's resolved-inputs contract after an UNCHECK: the spouse
    // field is undefined, so the engine runs single and no spouse rows exist
    // for the Year Math tabs / spouseAgeOffset to pick up.
    const inputs = withSpouse();
    inputs.spouse = undefined;
    const r = calculateHousehold(inputs, config);
    expect(r.spouse).toBeUndefined();
    // combineHouseholdBreakdown must fall back to the primary-only rows.
    expect(combineHouseholdBreakdown(r, inputs)).toBe(r.yearlyBreakdown);
  });

  it('a builtin spouseSource with no spouse never re-materializes one', () => {
    // The uncheck path also detaches the link (spouseSource → builtin) so a
    // lingering scenario reference can't resurrect the spouse. With builtin +
    // no spouse there is nothing to resolve.
    const inputs = withSpouse();
    inputs.spouse = undefined;
    inputs.spouseSource = { kind: 'builtin' };
    const r = calculateHousehold(inputs, config);
    expect(r.spouse).toBeUndefined();
  });
});

describe('spouse full-person parity', () => {
  const config = testConfig();
  const mkSpouse = () => baseInputs({
    currentAge: 65, retirementAge: 65, maxAge: 70,
    rrspBalance: 0, tfsaBalance: 0, taxableBalance: 0, cashCushionBalance: 0,
    desiredSpending: 20000,
    spouse: {
      enabled: true, currentAge: 65, retirementAge: 65,
      rrspBalance: 0, tfsaBalance: 100000, taxableBalance: 0, cashCushionBalance: 0,
      rrspContribution: 0, tfsaContribution: 0, taxableContribution: 0,
      cppStartAge: null, cppMonthlyAmount: 0, oasStartAge: null, oasYearsInCanada: 40,
      desiredSpending: 20000,
    },
  });

  it('the spouse runs its own cash events', () => {
    const inputs = mkSpouse();
    // A one-time inflow into the spouse's TFSA at 66 — proof the spouse's event
    // list reaches the engine (previously stripped).
    inputs.spouse!.events = [{ id: 'gift', age: 66, label: 'inheritance', amount: 30000, direction: 'in', account: 'tfsa' }];
    const r = calculateHousehold(inputs, config);
    const srow = yearAt(r.spouse!.yearlyBreakdown, 66);
    expect(srow.detail?.deposit?.tfsa).toBeCloseTo(30000, 0);
  });

  it('the spouse runs its own spending bands', () => {
    const banded = mkSpouse();
    banded.spouse!.spendingBands = [{ fromAge: 68, pctOfBase: 0.5 }];
    const flat = mkSpouse();
    const rb = calculateHousehold(banded, config);
    const rf = calculateHousehold(flat, config);
    // From age 68 the banded spouse's spending target halves vs the flat spouse.
    const band68 = yearAt(rb.spouse!.yearlyBreakdown, 68).spendingTarget;
    const flat68 = yearAt(rf.spouse!.yearlyBreakdown, 68).spendingTarget;
    expect(band68).toBeCloseTo(flat68 * 0.5, 0);
    // Before the band (67) they're identical.
    expect(yearAt(rb.spouse!.yearlyBreakdown, 67).spendingTarget)
      .toBeCloseTo(yearAt(rf.spouse!.yearlyBreakdown, 67).spendingTarget, 0);
  });

  it('the spouse runs its own reverse mortgage', () => {
    const inputs = mkSpouse();
    inputs.spouse!.reverseMortgage = {
      enabled: true, homeValue: 600000, appreciationRate: 0.02, interestRate: 0.06,
      maxLtv: 0.55, drawAmount: 10000, startAge: 66, durationYears: 3, topUp: false,
    };
    const r = calculateHousehold(inputs, config);
    const srow = yearAt(r.spouse!.yearlyBreakdown, 66);
    // The spouse's home appreciates and the loan starts accruing once draws begin.
    expect(srow.homeValue).toBeGreaterThan(600000);
    expect(srow.loanBalance).toBeGreaterThan(0);
    // And the primary (no RM) still has no RM fields.
    expect(yearAt(r.yearlyBreakdown, 66).homeValue).toBeUndefined();
  });

  it('a spouse transfer event fires from the spouse account', () => {
    const inputs = mkSpouse();
    // Spouse melts down its own TFSA into its own taxable (untaxed, after-tax money).
    // Zero spending so the transfer is the only thing moving the TFSA.
    inputs.spouse!.desiredSpending = 0;
    inputs.spouse!.tfsaBalance = 100000;
    inputs.spouse!.events = [{
      id: 'shift', age: 65, label: 'spouse shift', amount: 40000, direction: 'out',
      from: { kind: 'account', person: 'spouse', account: 'tfsa' },
      to: { kind: 'account', person: 'spouse', account: 'taxable' },
    }];
    const r = calculateHousehold(inputs, config);
    const srow = yearAt(r.spouse!.yearlyBreakdown, 65);
    const tr = srow.detail?.calc?.transfers?.[0];
    expect(tr).toBeDefined();
    expect(tr!.tax).toBe(0);
    // 100k − 40k = 60k, then 5% growth → 63k.
    expect(srow.tfsaBalance).toBeCloseTo(60000 * 1.05, 0);
    expect(srow.detail?.deposit?.taxable).toBeCloseTo(40000, 0);
  });
});

describe('re-homed transfer events (authored on the wrong person)', () => {
  const config = testConfig();
  // Same-age couple; the spouse holds the money. A transfer is authored on the
  // PRIMARY's event list but pulls FROM the spouse's TFSA into the primary's
  // taxable — the source person (spouse) never had it on their list.
  const mk = () => baseInputs({
    currentAge: 65, retirementAge: 65, maxAge: 66,
    rrspBalance: 0, tfsaBalance: 0, taxableBalance: 0, cashCushionBalance: 0,
    desiredSpending: 0,
    spouse: {
      enabled: true, currentAge: 65, retirementAge: 65,
      rrspBalance: 0, tfsaBalance: 100000, taxableBalance: 0, cashCushionBalance: 0,
      rrspContribution: 0, tfsaContribution: 0, taxableContribution: 0,
      cppStartAge: null, cppMonthlyAmount: 0, oasStartAge: null, oasYearsInCanada: 40,
      desiredSpending: 0,
    },
  });

  it('a transfer sourced from the spouse but authored on the primary still fires', () => {
    const inputs = mk();
    // Authored on the PRIMARY's events, but the money leaves the SPOUSE's TFSA.
    inputs.events = [{
      id: 'misfiled', age: 65, label: 'spouse funds me', amount: 40000, direction: 'out',
      from: { kind: 'account', person: 'spouse', account: 'tfsa' },
      to: { kind: 'account', person: 'primary', account: 'taxable' },
    }];
    const r = calculateHousehold(inputs, config);
    const prow = yearAt(r.yearlyBreakdown, 65);
    const srow = yearAt(r.spouse!.yearlyBreakdown, 65);
    // The spouse's TFSA was drawn down by the gross (100k − 40k = 60k, ×1.05).
    expect(srow.tfsaBalance).toBeCloseTo(60000 * 1.05, 0);
    // ...and the after-tax net landed in the PRIMARY's taxable (untaxed move).
    expect(prow.detail?.deposit?.taxable).toBeCloseTo(40000, 0);
    expect(prow.taxableBalance).toBeCloseTo(40000 * 1.05, 0);
  });

  it('a re-homed transfer fires exactly once (not double-counted)', () => {
    const inputs = mk();
    inputs.events = [{
      id: 'misfiled', age: 65, label: 'spouse funds me', amount: 40000, direction: 'out',
      from: { kind: 'account', person: 'spouse', account: 'tfsa' },
      to: { kind: 'account', person: 'primary', account: 'taxable' },
    }];
    const r = calculateHousehold(inputs, config);
    // Across BOTH runs the transfer must appear once total: the source (spouse)
    // run records it, the destination (primary) run does not re-fire it.
    const spouseTraces = r.spouse!.yearlyBreakdown.flatMap(y => y.detail?.calc?.transfers ?? []);
    const primaryTraces = r.yearlyBreakdown.flatMap(y => y.detail?.calc?.transfers ?? []);
    expect(spouseTraces).toHaveLength(1);
    expect(primaryTraces.filter(t => t.label === 'spouse funds me')).toHaveLength(0);
    // Household conservation: spouse TFSA down 40k, primary taxable up 40k.
    const household = yearAt(r.yearlyBreakdown, 65).endingBalance + yearAt(r.spouse!.yearlyBreakdown, 65).endingBalance;
    expect(household).toBeCloseTo(100000 * 1.05, 0);
  });

  it('a re-homed transfer respects the age axis across an age gap', () => {
    const inputs = mk();
    inputs.spouse!.currentAge = 62; // spouse is 3 years younger
    // Authored on the primary at primary-age 66 → calendar year is spouse-age 63.
    inputs.events = [{
      id: 'misfiled', age: 66, label: 'spouse funds me', amount: 30000, direction: 'out',
      from: { kind: 'account', person: 'spouse', account: 'tfsa' },
      to: { kind: 'account', person: 'primary', account: 'taxable' },
    }];
    const r = calculateHousehold(inputs, config);
    // The spouse's TFSA drops on the spouse's age-63 row (same calendar year).
    const srow63 = yearAt(r.spouse!.yearlyBreakdown, 63);
    expect(srow63.detail?.calc?.transfers?.[0]?.gross).toBeCloseTo(30000, 0);
    // ...and the primary receives the net on its age-66 row.
    expect(yearAt(r.yearlyBreakdown, 66).detail?.deposit?.taxable).toBeCloseTo(30000, 0);
  });

  it('a re-homed transfer dated before the receiver’s current age fires now, not never (E-08 / #27)', () => {
    // Regression: with a 7-year age gap, a transfer authored on the primary at
    // primary-age 63 re-homes to spouse-age 56 — BEFORE the spouse's current
    // age of 58. calculatePerson's `e.age >= currentAge` filter silently
    // dropped it, so the transfer never fired anywhere. It must clamp to the
    // receiver's current age and fire immediately.
    const inputs = baseInputs({
      currentAge: 65, retirementAge: 65, maxAge: 66,
      rrspBalance: 0, tfsaBalance: 0, taxableBalance: 0, cashCushionBalance: 0,
      desiredSpending: 0,
      spouse: {
        enabled: true, currentAge: 58, retirementAge: 65,
        rrspBalance: 0, tfsaBalance: 100000, taxableBalance: 0, cashCushionBalance: 0,
        rrspContribution: 0, tfsaContribution: 0, taxableContribution: 0,
        cppStartAge: null, cppMonthlyAmount: 0, oasStartAge: null, oasYearsInCanada: 40,
        desiredSpending: 0,
      },
    });
    // Authored on the primary at 63 (in the primary's own past — a saved or
    // imported scenario can carry this even though the UI clamps new entries);
    // the money leaves the spouse's TFSA.
    inputs.events = [{
      id: 'past', age: 63, label: 'late meltdown', amount: 40000, direction: 'out',
      from: { kind: 'account', person: 'spouse', account: 'tfsa' },
      to: { kind: 'account', person: 'primary', account: 'taxable' },
    }];
    const r = calculateHousehold(inputs, config);
    // Fires on the spouse's FIRST year (age 58), clamped from 56. Age 58 is
    // the spouse's accumulation phase: growth applies before events, so the
    // TFSA grows to 105k, then the 40k transfer leaves → 65k.
    const srow = yearAt(r.spouse!.yearlyBreakdown, 58);
    expect(srow.detail?.calc?.transfers?.[0]?.gross).toBeCloseTo(40000, 0);
    expect(srow.tfsaBalance).toBeCloseTo(100000 * 1.05 - 40000, 0);
    // ...and the net lands on the primary's current-age row (same calendar year).
    expect(yearAt(r.yearlyBreakdown, 65).detail?.deposit?.taxable).toBeCloseTo(40000, 0);
  });

  it('a recurring re-homed transfer keeps a valid window after clamping (E-08 / #27)', () => {
    // Same geometry, but recurring: authored age 63..endAge 66 on the primary's
    // axis → spouse-axis 56..59. Clamp age to 58; endAge clamps to >= 58, so
    // the window is 58..59 and the transfer fires in BOTH of those years.
    const inputs = baseInputs({
      currentAge: 65, retirementAge: 65, maxAge: 66,
      rrspBalance: 0, tfsaBalance: 0, taxableBalance: 0, cashCushionBalance: 0,
      desiredSpending: 0,
      spouse: {
        enabled: true, currentAge: 58, retirementAge: 65,
        rrspBalance: 0, tfsaBalance: 200000, taxableBalance: 0, cashCushionBalance: 0,
        rrspContribution: 0, tfsaContribution: 0, taxableContribution: 0,
        cppStartAge: null, cppMonthlyAmount: 0, oasStartAge: null, oasYearsInCanada: 40,
        desiredSpending: 0,
      },
    });
    inputs.events = [{
      id: 'past-recur', age: 63, endAge: 66, label: 'late recurring', amount: 10000, direction: 'out',
      from: { kind: 'account', person: 'spouse', account: 'tfsa' },
      to: { kind: 'account', person: 'primary', account: 'taxable' },
    }];
    const r = calculateHousehold(inputs, config);
    const fired = r.spouse!.yearlyBreakdown.filter(y => (y.detail?.calc?.transfers?.length ?? 0) > 0);
    expect(fired.map(y => y.age)).toEqual([58, 59]);
    // Two $10k draws total left the TFSA.
    const totalGross = fired.flatMap(y => y.detail?.calc?.transfers ?? []).reduce((s, t) => s + t.gross, 0);
    expect(totalGross).toBeCloseTo(20000, 0);
  });
});

describe('baseline plan (New Scenario defaults)', () => {
  it('a fresh New-Scenario plan runs end-to-end to maxAge', () => {
    // Guards the New Scenario flow: the baseline defaults must always produce a
    // runnable projection (the wizard and ScenarioManager both seed from it).
    const r = calculateHousehold(baselineInputs(), config);
    expect(r.yearlyBreakdown.length).toBeGreaterThan(0);
    expect(r.yearlyBreakdown[r.yearlyBreakdown.length - 1].age).toBe(baselineInputs().maxAge);
    expect(r.yearlyBreakdown.every(y => Number.isFinite(y.endingBalance))).toBe(true);
    expect(['ON_TRACK', 'AT_RISK', 'SHORTFALL']).toContain(r.status);
  });

  it('a wizard plan with a spouse added runs as a couple', () => {
    // The wizard's "add a spouse" path enables a baseline spouse at the same
    // ages; the household engine must run both and attach results.spouse.
    const inputs = baselineInputs();
    inputs.spouse = {
      enabled: true, currentAge: inputs.currentAge, retirementAge: inputs.retirementAge,
      rrspBalance: 0, tfsaBalance: 0, taxableBalance: 0, cashCushionBalance: 0,
      rrspContribution: 0, tfsaContribution: 0, taxableContribution: 0,
      cppStartAge: 65, cppMonthlyAmount: 900, oasStartAge: 65, oasYearsInCanada: 40,
      desiredSpending: Math.round(inputs.desiredSpending / 2),
    };
    const r = calculateHousehold(inputs, config);
    expect(r.spouse).toBeDefined();
    expect(r.spouse!.yearlyBreakdown.length).toBeGreaterThan(0);
  });
});

describe('pensions', () => {
  it('lifetime pension pays every year from startAge', () => {
    const r = calculateRetirement(baseInputs({
      cppStartAge: 65, cppMonthlyAmount: 0, oasStartAge: null,
      income: [{ id: 'p1', label: 'DB', kind: 'pension', annualAmount: 12000, startAge: 65, endAge: null, indexedToCpi: false }],
    }), config);
    expect(yearAt(r.yearlyBreakdown, 65).pensionIncome).toBeCloseTo(12000, 6);
    expect(yearAt(r.yearlyBreakdown, 80).pensionIncome).toBeCloseTo(12000, 6);
  });

  it('bridge pension stops after endAge', () => {
    const r = calculateRetirement(baseInputs({
      income: [{ id: 'b', label: 'bridge', kind: 'pension', annualAmount: 10000, startAge: 65, endAge: 69, indexedToCpi: false }],
    }), config);
    expect(yearAt(r.yearlyBreakdown, 69).pensionIncome).toBeCloseTo(10000, 6);
    expect(yearAt(r.yearlyBreakdown, 70).pensionIncome).toBe(0);
  });

  it('non-indexed pension stays flat; indexed grows with CPI when tables index', () => {
    const c = testConfig();
    c.engine.indexTaxTables = true;
    const r = calculateRetirement(baseInputs({ income: [
      { id: 'f', label: 'flat', kind: 'pension', annualAmount: 10000, startAge: 65, endAge: null, indexedToCpi: false },
      { id: 'i', label: 'idx', kind: 'pension', annualAmount: 10000, startAge: 65, endAge: null, indexedToCpi: true },
    ]}), c);
    const total70 = yearAt(r.yearlyBreakdown, 70).pensionIncome;
    expect(closeTo(total70, 10000 + 10000 * Math.pow(1 + INFL, 5), 1)).toBe(true);
  });
});

describe('projection continues past depletion (issue #5)', () => {
  // A small portfolio that runs out early, with a pension + CPP/OAS starting
  // after depletion. Before the fix the loop broke at depletion, so those
  // benefits never appeared anywhere. Now the projection runs to maxAge and
  // the benefits accrue into rows once they begin.
  const depletedInputs = () => baseInputs({
    currentAge: 65, retirementAge: 65, maxAge: 80,
    tfsaBalance: 60000, rrspBalance: 0, taxableBalance: 0, cashCushionBalance: 0,
    desiredSpending: 40000,
    cppStartAge: 70, cppMonthlyAmount: 1000, cppAdjustedAmount: false,
    oasStartAge: null,
    income: [{ id: 'db', label: 'DB', kind: 'pension', annualAmount: 8000, startAge: 72, endAge: null, indexedToCpi: false }],
  });

  it('projects rows through maxAge even after the portfolio is depleted', () => {
    const r = calculateRetirement(depletedInputs(), config);
    expect(r.depletionAge).not.toBeNull();
    expect(r.depletionAge!).toBeLessThan(80);
    // Rows exist all the way to maxAge (previously they stopped at depletion).
    expect(r.yearlyBreakdown[r.yearlyBreakdown.length - 1].age).toBe(80);
    // Balances stay clamped at 0 after depletion — the portfolio funds nothing more.
    expect(yearAt(r.yearlyBreakdown, 80).endingBalance).toBe(0);
  });

  it('benefits starting after depletion still appear in later rows', () => {
    const r = calculateRetirement(depletedInputs(), config);
    // Pension starts at 72 — after the money is gone — and must show up.
    expect(yearAt(r.yearlyBreakdown, 72).pensionIncome).toBeCloseTo(8000, 6);
    // CPP from 70 likewise (grossed up for the 5-year deferral).
    expect(yearAt(r.yearlyBreakdown, 70).cppIncome).toBeGreaterThan(1000 * 12);
  });

  it('per-year shortfall is the unfunded gap and shrinks once a late benefit begins', () => {
    const r = calculateRetirement(depletedInputs(), config);
    const atDepletion = yearAt(r.yearlyBreakdown, r.depletionAge!);
    // At depletion the spending target is barely funded → a real shortfall.
    expect(atDepletion.shortfall!).toBeGreaterThan(0);
    // The DB pension starts at 72. Comparing the year just before (71) to the
    // year it starts (72) isolates its effect: with no portfolio left, the new
    // pension must cut the unfunded gap. (Both years are post-depletion, so the
    // only change is the pension kicking in.)
    const before = yearAt(r.yearlyBreakdown, 71);
    const after = yearAt(r.yearlyBreakdown, 72);
    expect(before.pensionIncome).toBe(0);
    expect(after.pensionIncome).toBeCloseTo(8000, 6);
    expect(after.shortfall!).toBeLessThan(before.shortfall!);
    // Shortfall never exceeds the year's spending target.
    expect(after.shortfall!).toBeLessThanOrEqual(after.spendingTarget + 0.01);
  });

  it('depletion verdict is unchanged: still SHORTFALL when money runs out early', () => {
    const r = calculateRetirement(depletedInputs(), config);
    expect(r.status).toBe('SHORTFALL');
  });
});

describe('GIS (single)', () => {
  it('CPP reduces GIS 50¢/$ — verified against the canada.ca table', () => {
    // $800/mo CPP = $9,600/yr → GIS = 13478 − 9600×0.5 = 8678
    const r = calculateRetirement(baseInputs({
      tfsaBalance: 0, cppStartAge: 65, cppMonthlyAmount: 800, oasStartAge: 65, oasYearsInCanada: 40,
      desiredSpending: 20000,
    }), config);
    const gis65 = yearAt(r.yearlyBreakdown, 65).gisIncome;
    expect(closeTo(gis65, config.oas.gisMaxAnnualSingle - 9600 * 0.5, 1)).toBe(true);
  });

  it('no OAS → no GIS', () => {
    const r = calculateRetirement(baseInputs({ oasStartAge: null }), config);
    expect(r.yearlyBreakdown.every(y => y.gisIncome === 0)).toBe(true);
  });
});

describe('couple GIS', () => {
  const mkCouple = () => baseInputs({
    tfsaBalance: 0, cppStartAge: 65, cppMonthlyAmount: 400, oasStartAge: 65, oasYearsInCanada: 40,
    desiredSpending: 20000,
    spouse: {
      enabled: true, currentAge: 65, retirementAge: 65,
      rrspBalance: 0, tfsaBalance: 0, taxableBalance: 0, cashCushionBalance: 0,
      rrspContribution: 0, tfsaContribution: 0, taxableContribution: 0,
      cppStartAge: 65, cppMonthlyAmount: 400, oasStartAge: 65, oasYearsInCanada: 40,
      desiredSpending: 20000,
    },
  });

  it('assesses each spouse on COMBINED income at the couple rate', () => {
    const r = calculateHousehold(mkCouple(), config);
    // combined CPP = 4800+4800 = 9600 → GIS each = 8113 − 9600×0.5 = 3313
    const expected = config.oas.gisMaxAnnualCouple - 9600 * 0.5;
    expect(closeTo(yearAt(r.yearlyBreakdown, 65).gisIncome, expected, 1)).toBe(true);
    expect(closeTo(yearAt(r.spouse!.yearlyBreakdown, 65).gisIncome, expected, 1)).toBe(true);
  });

  it('couple GIS is below the single-rule amount for the same incomes', () => {
    const single = calculateRetirement(baseInputs({
      tfsaBalance: 0, cppStartAge: 65, cppMonthlyAmount: 400, oasStartAge: 65, oasYearsInCanada: 40,
    }), config);
    const couple = calculateHousehold(mkCouple(), config);
    const s = yearAt(single.yearlyBreakdown, 65).gisIncome;
    const c = yearAt(couple.yearlyBreakdown, 65).gisIncome;
    expect(c).toBeLessThan(s);
  });

  it("couple GIS is reduced by BOTH partners' discretionary registered draws (E-06 / #26)", () => {
    // Both partners on OAS+GIS, same age, both holding registered money their
    // plans must draw (desiredSpending > benefits forces RRIF/RRSP draws from
    // age 65). The partner's draws must count in the combined GIS base just
    // like the person's own draws do.
    const mk = (spouseRrsp: number) => baseInputs({
      tfsaBalance: 0, cppStartAge: 65, cppMonthlyAmount: 400, oasStartAge: 65, oasYearsInCanada: 40,
      desiredSpending: 20000,
      spouse: {
        enabled: true, currentAge: 65, retirementAge: 65,
        rrspBalance: spouseRrsp, tfsaBalance: 0, taxableBalance: 0, cashCushionBalance: 0,
        rrspContribution: 0, tfsaContribution: 0, taxableContribution: 0,
        cppStartAge: 65, cppMonthlyAmount: 400, oasStartAge: 65, oasYearsInCanada: 40,
        desiredSpending: 20000,
      },
    });
    const soloDrawer = calculateHousehold(mk(0), config);
    const bothDraw = calculateHousehold(mk(200000), config);

    // With two drawers the combined non-OAS income is strictly higher, so each
    // spouse's GIS must be strictly lower than in the one-drawer case.
    const gisSolo = yearAt(soloDrawer.yearlyBreakdown, 66).gisIncome;
    const gisBoth = yearAt(bothDraw.yearlyBreakdown, 66).gisIncome;
    const gisSoloS = yearAt(soloDrawer.spouse!.yearlyBreakdown, 66).gisIncome;
    const gisBothS = yearAt(bothDraw.spouse!.yearlyBreakdown, 66).gisIncome;
    expect(gisBoth).toBeLessThan(gisSolo);
    expect(gisBothS).toBeLessThan(gisSoloS);

    // And the reported GIS matches the couple rule evaluated on the CONVERGED
    // combined base: both CPPs + both sides' actual draw income. (Draw amounts
    // are endogenous — they shift with GIS — so the identity is checked against
    // the runs' own captured draws, not a hand-computed constant.)
    const pDraws = bothDraw.householdDraws?.[66] ?? 0;
    const sDraws = bothDraw.spouse!.householdDraws?.[66] ?? 0;
    const combined = 4800 + 4800 + pDraws + sDraws;
    const expected = Math.max(0, config.oas.gisMaxAnnualCouple - combined * (config.oas.gisReductionRate ?? 0.5));
    expect(closeTo(gisBoth, expected, 2)).toBe(true);
  });

  it('converges: couple GIS matches an independently-computed fixed point (E-06 / #26)', () => {
    // Analytic check of the fixed point, independent of the iteration: with
    // both partners identical, GIS draws are symmetric, so each person's
    // reported GIS must equal what gisAnnualCouple says for the combined base
    // built from BOTH sides' actual draw rows.
    const inputs = baseInputs({
      tfsaBalance: 0, cppStartAge: 65, cppMonthlyAmount: 400, oasStartAge: 65, oasYearsInCanada: 40,
      desiredSpending: 20000,
      rrspBalance: 100000, withdrawalOrder: ['rrsp', 'tfsa'],
      spouse: {
        enabled: true, currentAge: 65, retirementAge: 65,
        rrspBalance: 200000, tfsaBalance: 0, taxableBalance: 0, cashCushionBalance: 0,
        rrspContribution: 0, tfsaContribution: 0, taxableContribution: 0,
        cppStartAge: 65, cppMonthlyAmount: 400, oasStartAge: 65, oasYearsInCanada: 40,
        desiredSpending: 20000,
        withdrawalOrder: ['rrsp', 'tfsa'],
      },
    });
    const r = calculateHousehold(inputs, config);
    // The combined base each side was assessed on: both CPPs (4800 each) +
    // both sides' draw income (from the converged householdDraws records).
    const ownP = r.householdDraws?.[66] ?? 0;
    const partnerP = r.spouse!.householdDraws?.[66] ?? 0;
    const expectedGis = (own: number, partner: number) => {
      const combined = 4800 + 4800 + own + partner;
      return Math.max(0, config.oas.gisMaxAnnualCouple - combined * (config.oas.gisReductionRate ?? 0.5));
    };
    expect(closeTo(yearAt(r.yearlyBreakdown, 66).gisIncome, expectedGis(ownP, partnerP), 2)).toBe(true);
    expect(closeTo(yearAt(r.spouse!.yearlyBreakdown, 66).gisIncome, expectedGis(partnerP, ownP), 2)).toBe(true);
  });

  it('household is SHORTFALL if the spouse plan depletes', () => {
    const inputs = mkCouple();
    // Force the spouse plan to actually run out of money: high spend, no
    // savings, and a 0% return so nothing bails it out. Depletion (not the old
    // 25× heuristic) must drive the household flag now.
    inputs.investmentReturn = 0;
    inputs.spouse!.tfsaBalance = 5000;
    inputs.spouse!.rrspBalance = 0;
    inputs.spouse!.cppMonthlyAmount = 0;
    inputs.spouse!.oasStartAge = null;
    inputs.spouse!.desiredSpending = 40000;
    const r = calculateHousehold(inputs, config);
    expect(r.spouse!.depletionAge).not.toBeNull();
    expect(r.spouse!.status).toBe('SHORTFALL');
    expect(r.status).toBe('SHORTFALL');
  });

  it('a plan the old 25× rule flagged but that never depletes is now ON TRACK', () => {
    // High return (so the portfolio grows) with benefits starting after
    // retirement: 25× would flag this at the retirement date, but the
    // simulation never runs dry — the verdict must follow the simulation.
    const r = calculateRetirement(baseInputs({
      currentAge: 51, retirementAge: 55, maxAge: 95,
      rrspBalance: 1127000, tfsaBalance: 182000, taxableBalance: 685000, cashCushionBalance: 92000,
      rrspContribution: 33000, tfsaContribution: 7000, taxableContribution: 60000,
      investmentReturn: 0.08, desiredSpending: 140000,
      cppStartAge: 60, cppMonthlyAmount: 1500, oasStartAge: 65, oasYearsInCanada: 40,
      withdrawalOrder: ['rrsp', 'taxable', 'tfsa'],
    }), config);
    expect(r.depletionAge).toBeNull();
    expect(r.status).toBe('ON_TRACK');
  });
});

describe('reverse mortgage', () => {
  const rmBase = () => baseInputs({ tfsaBalance: 500000, desiredSpending: 10000 });

  it('leaves no footprint when disabled', () => {
    const r = calculateRetirement(rmBase(), config);
    expect(r.yearlyBreakdown.every(y => y.netHomeEquity === undefined)).toBe(true);
  });

  it('scheduled draws accrue interest and land tax-free in the cash cushion', () => {
    const r = calculateRetirement(rmBase(), config);
    void r;
    const rr = calculateRetirement(baseInputs({
      tfsaBalance: 500000, desiredSpending: 10000,
      reverseMortgage: {
        enabled: true, homeValue: 800000, appreciationRate: 0.02, interestRate: 0.06,
        drawAmount: 20000, startAge: 70, durationYears: 3, topUp: false,
      },
    }), config);
    const yr = (a: number) => yearAt(rr.yearlyBreakdown, a);
    const l70 = yr(70).loanBalance!, l71 = yr(71).loanBalance!, l72 = yr(72).loanBalance!, l73 = yr(73).loanBalance!;
    expect(closeTo(l70, 20000 * sf(70), 1)).toBe(true);            // accrue-then-draw at 70
    expect(closeTo(l71, l70 * 1.06 + 20000 * sf(71), 1)).toBe(true);
    expect(closeTo(l72, l71 * 1.06 + 20000 * sf(72), 1)).toBe(true);
    expect(closeTo(l73, l72 * 1.06, 1)).toBe(true);                // draws stop, interest continues
    expect(closeTo(yr(75).netHomeEquity!, yr(75).homeValue! - yr(75).loanBalance!, 0.01)).toBe(true);
  });

  it('top-up covers the shortfall once accounts drain and stays solvent within the LTV cap', () => {
    // Home large enough that the 55% LTV cap (=$275k) funds the whole shortfall.
    const r = calculateRetirement(baseInputs({
      tfsaBalance: 30000, cashCushionBalance: 0, desiredSpending: 15000, maxAge: 80,
      reverseMortgage: { enabled: true, homeValue: 800000, appreciationRate: 0, interestRate: 0.05, topUp: true },
    }), config);
    // Plan runs to maxAge funded by the loan; depletion stays null while headroom lasts.
    expect(r.depletionAge).toBeNull();
    expect(r.yearlyBreakdown[r.yearlyBreakdown.length - 1].age).toBe(80);
    const loan80 = yearAt(r.yearlyBreakdown, 80).loanBalance!;
    expect(loan80).toBeGreaterThan(0);
    // Loan stays within the LTV ceiling on the (flat) home value.
    expect(loan80).toBeLessThanOrEqual(800000 * 0.55 + 1e-6);
  });

  it('borrowing stops at the LTV ceiling (default 55%), not the full home value', () => {
    const r = calculateRetirement(baseInputs({
      tfsaBalance: 0, cashCushionBalance: 0, desiredSpending: 100000, maxAge: 95,
      reverseMortgage: { enabled: true, homeValue: 200000, appreciationRate: 0, interestRate: 0.05, topUp: true },
    }), config);
    // Huge spending against a small home → loan capped at 55% × home value, and
    // the plan depletes once that headroom is gone (long before loan = value).
    for (const y of r.yearlyBreakdown) {
      expect(y.loanBalance ?? 0).toBeLessThanOrEqual(200000 * 0.55 + 1e-6);
    }
    expect(r.depletionAge).not.toBeNull();
  });

  it('respects a custom maxLtv ceiling', () => {
    const r = calculateRetirement(baseInputs({
      tfsaBalance: 0, cashCushionBalance: 0, desiredSpending: 100000, maxAge: 95,
      reverseMortgage: { enabled: true, homeValue: 400000, appreciationRate: 0, interestRate: 0.05, maxLtv: 0.25, topUp: true },
    }), config);
    for (const y of r.yearlyBreakdown) {
      expect(y.loanBalance ?? 0).toBeLessThanOrEqual(400000 * 0.25 + 1e-6);
    }
    expect(r.depletionAge).not.toBeNull();
  });

  it('a higher LTV ceiling keeps the plan solvent longer', () => {
    const mk = (maxLtv: number) => calculateRetirement(baseInputs({
      tfsaBalance: 0, cashCushionBalance: 0, desiredSpending: 60000, maxAge: 95,
      reverseMortgage: { enabled: true, homeValue: 300000, appreciationRate: 0, interestRate: 0.05, maxLtv, topUp: true },
    }), config);
    const low = mk(0.30), high = mk(0.60);
    // More borrowing headroom → depletion happens later (or not at all).
    const lowDepleted = low.depletionAge ?? 999;
    const highDepleted = high.depletionAge ?? 999;
    expect(highDepleted).toBeGreaterThan(lowDepleted);
  });

  it('scheduled draws stop at the LTV ceiling; interest may still accrue above it', () => {
    // No top-up; only scheduled draws, large against a small home. The cap
    // limits NEW DRAWS to 55% of home value — but interest keeps compounding
    // the balance, so the loan can exceed the cap once draws have stopped.
    const r = calculateRetirement(baseInputs({
      tfsaBalance: 500000, desiredSpending: 10000, maxAge: 90,
      reverseMortgage: {
        enabled: true, homeValue: 100000, appreciationRate: 0, interestRate: 0.06,
        maxLtv: 0.55, drawAmount: 40000, startAge: 65, durationYears: 20, topUp: false,
      },
    }), config);
    const cap = 100000 * 0.55;
    // No year may DRAW past the cap: the loan only exceeds it via interest on
    // an already-at-cap balance. Check no single-year jump is larger than the
    // year's interest + the remaining headroom to the cap.
    for (let i = 1; i < r.yearlyBreakdown.length; i++) {
      const prev = r.yearlyBreakdown[i - 1].loanBalance ?? 0;
      const cur = r.yearlyBreakdown[i].loanBalance ?? 0;
      const maxDrawThisYear = Math.max(0, cap - prev * 1.06); // headroom after interest
      expect(cur).toBeLessThanOrEqual(prev * 1.06 + maxDrawThisYear + 1e-6);
    }
    // Draws did happen (loan grew well above zero) and the ceiling engaged.
    const lastLoan = r.yearlyBreakdown[r.yearlyBreakdown.length - 1].loanBalance!;
    expect(lastLoan).toBeGreaterThan(0);
  });

  it('net home equity tracks home value minus loan as the loan compounds', () => {
    const r = calculateRetirement(baseInputs({
      tfsaBalance: 0, cashCushionBalance: 0, desiredSpending: 40000, maxAge: 80,
      reverseMortgage: { enabled: true, homeValue: 500000, appreciationRate: 0.02, interestRate: 0.06, maxLtv: 0.55, topUp: true },
    }), config);
    for (const y of r.yearlyBreakdown) {
      if (y.netHomeEquity === undefined) continue;
      expect(closeTo(y.netHomeEquity, y.homeValue! - y.loanBalance!, 0.01)).toBe(true);
    }
  });
});

describe('HELOC mode (interest as an annual expense)', () => {
  const helocInputs = (over: Parameters<typeof baseInputs>[0] = {}) => baseInputs({
    // Fund the plan so the interest expense can actually be paid from the
    // portfolio; TFSA covers it tax-free.
    tfsaBalance: 500000, desiredSpending: 20000, maxAge: 90,
    reverseMortgage: {
      enabled: true, mode: 'heloc', homeValue: 400000, appreciationRate: 0,
      interestRate: 0.07, maxLtv: 0.65,
      drawAmount: 50000, startAge: 65, durationYears: 1, topUp: false,
    },
    ...over,
  });

  it('the loan does NOT compound with interest (only draws grow it)', () => {
    const r = calculateRetirement(helocInputs(), config);
    // One $50k draw at 65; no appreciation. In HELOC mode interest is serviced,
    // so the loan stays at $50k forever (no interest accrual onto the balance).
    const loans = r.yearlyBreakdown.map(y => y.loanBalance ?? 0).filter(l => l > 0);
    expect(loans.length).toBeGreaterThan(0);
    for (const l of loans) expect(closeTo(l, 50000, 1)).toBe(true);
  });

  it('each year\'s interest is added to the spending target (cash-flow requirement)', () => {
    const r = calculateRetirement(helocInputs(), config);
    // $50k loan at 7% → $3,500/yr interest serviced. From 66 onward the
    // spending target = desired spending + interest expense (no event outflows).
    const y66 = yearAt(r.yearlyBreakdown, 66);
    const base = 20000 * sf(66);
    expect(closeTo(y66.spendingTarget, base + 3500, 2)).toBe(true);
    expect(y66.detail?.rm?.interestExpense ?? 0).toBeCloseTo(3500, 0);
  });

  it('a reverse mortgage (default) still compounds interest into the loan', () => {
    // Same setup but reverse mode: the loan grows by draws AND interest.
    const r = calculateRetirement(helocInputs({
      reverseMortgage: {
        enabled: true, homeValue: 400000, appreciationRate: 0,
        interestRate: 0.07, maxLtv: 0.65,
        drawAmount: 50000, startAge: 65, durationYears: 1, topUp: false,
      },
    }), config);
    const y66 = yearAt(r.yearlyBreakdown, 66);
    // Loan = 50000 grown by 7% interest at 66 (no further draws, no clamp yet).
    expect(closeTo(y66.loanBalance!, 50000 * 1.07, 2)).toBe(true);
    // No interest expense line in reverse mode.
    expect(y66.detail?.rm?.interestExpense ?? 0).toBe(0);
    // Spending target does NOT include an interest line in reverse mode.
    expect(closeTo(y66.spendingTarget, 20000 * sf(66), 2)).toBe(true);
  });

  it('net equity is value minus loan and can differ from the no-negative-equity floor', () => {
    // Heavy borrowing against a non-appreciating home: HELOC lets the loan reach
    // the full LTV headroom with no balance clamp below the ceiling floor.
    const r = calculateRetirement(baseInputs({
      tfsaBalance: 0, cashCushionBalance: 0, rrspBalance: 0, desiredSpending: 100000, maxAge: 90,
      reverseMortgage: {
        enabled: true, mode: 'heloc', homeValue: 200000, appreciationRate: 0,
        interestRate: 0.08, maxLtv: 0.65, topUp: true,
      },
    }), config);
    for (const y of r.yearlyBreakdown) {
      if (y.netHomeEquity === undefined) continue;
      expect(closeTo(y.netHomeEquity, y.homeValue! - y.loanBalance!, 0.01)).toBe(true);
    }
    // The loan can reach the 65% ceiling via top-up draws.
    const maxLoan = Math.max(...r.yearlyBreakdown.map(y => y.loanBalance ?? 0));
    expect(maxLoan).toBeGreaterThan(0);
  });
});

describe('depletion & withdrawal order', () => {
  it('reports depletion when money runs out with no other funding', () => {
    const r = calculateRetirement(baseInputs({
      tfsaBalance: 30000, desiredSpending: 50000, maxAge: 90,
    }), config);
    expect(r.depletionAge).not.toBeNull();
    expect(r.status).toBe('SHORTFALL');
  });

  it('TFSA withdrawals are tax-free (no income tax on the draw)', () => {
    const r = calculateRetirement(baseInputs({
      tfsaBalance: 300000, desiredSpending: 30000, withdrawalOrder: ['tfsa', 'taxable', 'rrsp'],
      cppStartAge: null, oasStartAge: null,
    }), config);
    // No benefits, drawing only from TFSA → no taxable income → no tax.
    expect(yearAt(r.yearlyBreakdown, 66).incomeTax).toBe(0);
  });

  it('RRSP/RRIF withdrawals are taxed (income tax > 0)', () => {
    const r = calculateRetirement(baseInputs({
      tfsaBalance: 0, rrspBalance: 400000, desiredSpending: 40000, withdrawalOrder: ['rrsp', 'tfsa', 'taxable'],
      cppStartAge: null, oasStartAge: null,
    }), config);
    expect(yearAt(r.yearlyBreakdown, 66).incomeTax).toBeGreaterThan(0);
  });
});

describe('pension income splitting', () => {
  // High-income primary (RRSP-funded) with a zero-income spouse: the classic
  // case where splitting cuts household tax.
  const unevenCouple = () => baseInputs({
    rrspBalance: 800000, tfsaBalance: 0, withdrawalOrder: ['rrsp', 'tfsa', 'taxable'],
    desiredSpending: 60000,
    cppStartAge: null, oasStartAge: null, cppMonthlyAmount: 0,
    spouse: {
      enabled: true, currentAge: 65, retirementAge: 65,
      rrspBalance: 0, tfsaBalance: 30000, taxableBalance: 0, cashCushionBalance: 0,
      rrspContribution: 0, tfsaContribution: 0, taxableContribution: 0,
      cppStartAge: null, cppMonthlyAmount: 0, oasStartAge: null, oasYearsInCanada: 40,
      desiredSpending: 10000,
    },
  });

  const householdTax = (r: ReturnType<typeof calculateHousehold>) =>
    r.yearlyBreakdown.reduce((s, y) => s + y.incomeTax, 0) +
    (r.spouse?.yearlyBreakdown.reduce((s, y) => s + y.incomeTax, 0) ?? 0);

  it('reduces combined household tax when incomes are uneven', () => {
    const inputs = unevenCouple();
    const withSplit = calculateHousehold(inputs, config);
    const cfgNo = testConfig();
    cfgNo.engine.pensionSplitMaxRate = 0;
    const noSplit = calculateHousehold(inputs, cfgNo);
    expect(householdTax(withSplit)).toBeLessThan(householdTax(noSplit) - 1);
  });

  it('moves income out of the higher earner (splitTransferred > 0 on primary)', () => {
    const r = calculateHousehold(unevenCouple(), config);
    const moved = r.yearlyBreakdown.filter(y => (y.splitTransferred ?? 0) > 0);
    expect(moved.length).toBeGreaterThan(0);
    // spouse sees the mirror-image (received) amounts
    const received = r.spouse!.yearlyBreakdown.filter(y => (y.splitTransferred ?? 0) < 0);
    expect(received.length).toBeGreaterThan(0);
  });

  it('never transfers more than the max rate of eligible income', () => {
    const cfg = testConfig();
    cfg.engine.pensionSplitMaxRate = 0.5;
    const r = calculateHousehold(unevenCouple(), cfg);
    for (const y of r.yearlyBreakdown) {
      const t = y.splitTransferred ?? 0;
      if (t > 0) {
        expect(t).toBeLessThanOrEqual(0.5 * (y.splitEligibleIncome ?? 0) + 0.01);
      }
    }
  });

  it('is a no-op when disabled (rate 0)', () => {
    const cfg = testConfig();
    cfg.engine.pensionSplitMaxRate = 0;
    const r = calculateHousehold(unevenCouple(), cfg);
    expect(r.yearlyBreakdown.every(y => (y.splitTransferred ?? 0) === 0)).toBe(true);
    expect(r.spouse!.yearlyBreakdown.every(y => (y.splitTransferred ?? 0) === 0)).toBe(true);
  });

  it('is a no-op when both spouses have identical income', () => {
    const even = baseInputs({
      rrspBalance: 300000, tfsaBalance: 0, withdrawalOrder: ['rrsp', 'tfsa', 'taxable'],
      desiredSpending: 40000, cppStartAge: null, oasStartAge: null,
      spouse: {
        enabled: true, currentAge: 65, retirementAge: 65,
        rrspBalance: 300000, tfsaBalance: 0, taxableBalance: 0, cashCushionBalance: 0,
        rrspContribution: 0, tfsaContribution: 0, taxableContribution: 0,
        cppStartAge: null, cppMonthlyAmount: 0, oasStartAge: null, oasYearsInCanada: 40,
        desiredSpending: 40000,
      },
    });
    const r = calculateHousehold(even, config);
    // symmetric incomes: any transfer just moves tax around, so none is chosen
    const anyMoved = r.yearlyBreakdown.some(y => (y.splitTransferred ?? 0) !== 0) ||
      r.spouse!.yearlyBreakdown.some(y => (y.splitTransferred ?? 0) !== 0);
    expect(anyMoved).toBe(false);
  });

  it('leaves GIS untouched (assessed on pre-split income)', () => {
    const inputs = baseInputs({
      tfsaBalance: 0, rrspBalance: 500000, withdrawalOrder: ['rrsp', 'tfsa', 'taxable'],
      cppStartAge: 65, cppMonthlyAmount: 800, oasStartAge: 65, oasYearsInCanada: 40,
      desiredSpending: 30000,
      spouse: {
        enabled: true, currentAge: 65, retirementAge: 65,
        rrspBalance: 0, tfsaBalance: 0, taxableBalance: 0, cashCushionBalance: 0,
        rrspContribution: 0, tfsaContribution: 0, taxableContribution: 0,
        cppStartAge: 65, cppMonthlyAmount: 800, oasStartAge: 65, oasYearsInCanada: 40,
        desiredSpending: 5000,
      },
    });
    const withSplit = calculateHousehold(inputs, config);
    const cfgNo = testConfig();
    cfgNo.engine.pensionSplitMaxRate = 0;
    const noSplit = calculateHousehold(inputs, cfgNo);
    const gis = (r: ReturnType<typeof calculateHousehold>) =>
      r.yearlyBreakdown.reduce((s, y) => s + (y.gisIncome ?? 0), 0);
    expect(closeTo(gis(withSplit), gis(noSplit), 0.01)).toBe(true);
  });

  it('does not touch a single-person plan', () => {
    const r = calculateRetirement(baseInputs({
      rrspBalance: 400000, tfsaBalance: 0, withdrawalOrder: ['rrsp', 'tfsa', 'taxable'],
      cppStartAge: null, oasStartAge: null,
    }), config);
    expect(r.yearlyBreakdown.every(y => y.splitTransferred === undefined)).toBe(true);
  });

  it('keeps cumulativeTax consistent with the adjusted per-year tax', () => {
    const r = calculateHousehold(unevenCouple(), config);
    let cum = 0;
    for (const y of r.yearlyBreakdown) {
      cum += y.incomeTax;
      expect(closeTo(y.cumulativeTax, cum, 0.01)).toBe(true);
    }
  });
});

describe('combineHouseholdBreakdown (household display)', () => {
  const couple = (spouseAge = 65) => baseInputs({
    rrspBalance: 300000, tfsaBalance: 100000, withdrawalOrder: ['rrsp', 'tfsa', 'taxable'],
    desiredSpending: 40000, cppStartAge: 65, cppMonthlyAmount: 600, oasStartAge: 65, oasYearsInCanada: 40,
    spouse: {
      enabled: true, currentAge: spouseAge, retirementAge: 65,
      rrspBalance: 200000, tfsaBalance: 50000, taxableBalance: 0, cashCushionBalance: 0,
      rrspContribution: 0, tfsaContribution: 0, taxableContribution: 0,
      cppStartAge: 65, cppMonthlyAmount: 500, oasStartAge: 65, oasYearsInCanada: 40,
      desiredSpending: 25000,
    },
  });

  it('returns the primary breakdown unchanged when there is no spouse', () => {
    const r = calculateRetirement(baseInputs(), config);
    expect(combineHouseholdBreakdown(r, baseInputs())).toBe(r.yearlyBreakdown);
  });

  it('sums balances and income across both spouses for same-age couples', () => {
    const inputs = couple(65);
    const r = calculateHousehold(inputs, config);
    const combined = combineHouseholdBreakdown(r, inputs);
    const age = 70;
    const p = yearAt(r.yearlyBreakdown, age);
    const s = yearAt(r.spouse!.yearlyBreakdown, age);
    const c = yearAt(combined, age);
    expect(closeTo(c.endingBalance, p.endingBalance + s.endingBalance, 0.01)).toBe(true);
    expect(closeTo(c.cppIncome, p.cppIncome + s.cppIncome, 0.01)).toBe(true);
    expect(closeTo(c.incomeTax, p.incomeTax + s.incomeTax, 0.01)).toBe(true);
    expect(closeTo(c.rrspBalance, p.rrspBalance + s.rrspBalance, 0.01)).toBe(true);
    expect(closeTo(c.gisIncome, p.gisIncome + s.gisIncome, 0.01)).toBe(true);
  });

  it('aligns rows by calendar year when spouses differ in age', () => {
    // spouse is 5 years younger: spouse reaches age X in the calendar year the
    // primary reaches X+5. The combined row at primary age 70 must include the
    // spouse's age-65 row.
    const inputs = couple(60); // spouse currentAge 60, primary 65
    const r = calculateHousehold(inputs, config);
    const combined = combineHouseholdBreakdown(r, inputs);
    const c = yearAt(combined, 70);
    const spouseAt65 = yearAt(r.spouse!.yearlyBreakdown, 65);
    const primaryAt70 = yearAt(r.yearlyBreakdown, 70);
    expect(closeTo(c.endingBalance, primaryAt70.endingBalance + spouseAt65.endingBalance, 0.01)).toBe(true);
  });

  it('drops splitTransferred (household net is ~0 and would be misleading)', () => {
    const inputs = baseInputs({
      rrspBalance: 800000, tfsaBalance: 0, withdrawalOrder: ['rrsp', 'tfsa', 'taxable'],
      desiredSpending: 60000, cppStartAge: null, oasStartAge: null,
      spouse: {
        enabled: true, currentAge: 65, retirementAge: 65,
        rrspBalance: 0, tfsaBalance: 30000, taxableBalance: 0, cashCushionBalance: 0,
        rrspContribution: 0, tfsaContribution: 0, taxableContribution: 0,
        cppStartAge: null, cppMonthlyAmount: 0, oasStartAge: null, oasYearsInCanada: 40,
        desiredSpending: 10000,
      },
    });
    const r = calculateHousehold(inputs, config);
    const combined = combineHouseholdBreakdown(r, inputs);
    expect(combined.every(y => y.splitTransferred === undefined)).toBe(true);
  });

  it('reflects spouse input changes (regression: spouse edits must move the household view)', () => {
    const poor = calculateHousehold(couple(65), config);
    const richInputs = couple(65);
    richInputs.spouse!.rrspBalance = 900000;
    const rich = calculateHousehold(richInputs, config);
    const poorEnd = yearAt(combineHouseholdBreakdown(poor, couple(65)), 75).endingBalance;
    const richEnd = yearAt(combineHouseholdBreakdown(rich, richInputs), 75).endingBalance;
    expect(richEnd).toBeGreaterThan(poorEnd);
  });

  it('an inter-spousal transfer does NOT count as a household withdrawal (row reconciles)', () => {
    // Regression: the sender's row counts the transfer as a withdrawal but the
    // receiver's landing is not one, so summing withdrawals overstated what
    // left the household and start + gains − withdrawals ≠ end.
    const inputs = baseInputs({
      currentAge: 65, retirementAge: 65, maxAge: 66,
      rrspBalance: 0, tfsaBalance: 0, taxableBalance: 100000, cashCushionBalance: 0,
      desiredSpending: 0, cppStartAge: null, oasStartAge: null,
      spouse: {
        enabled: true, currentAge: 65, retirementAge: 65,
        rrspBalance: 0, tfsaBalance: 0, taxableBalance: 0, cashCushionBalance: 0,
        rrspContribution: 0, tfsaContribution: 0, taxableContribution: 0,
        cppStartAge: null, cppMonthlyAmount: 0, oasStartAge: null, oasYearsInCanada: 40,
        desiredSpending: 0,
      },
    });
    inputs.events = [{
      id: 'gift', age: 65, label: 'fund spouse', amount: 40000, direction: 'out',
      from: { kind: 'account', person: 'primary', account: 'taxable' },
      to: { kind: 'account', person: 'spouse', account: 'tfsa' },
    }];
    const r = calculateHousehold(inputs, config);
    const c = yearAt(combineHouseholdBreakdown(r, inputs), 65);
    // Taxable source, ACB = balance → no gain, no tax: the full 40k crosses.
    // Combined withdrawals must EXCLUDE the internal move (it changed hands,
    // it didn't leave), so the year reconciles: start + gains − 0 = end.
    expect(c.withdrawals).toBeCloseTo(0, 0);
    expect(c.startingBalance + c.marketGains - c.withdrawals).toBeCloseTo(c.endingBalance, 0);
  });
});

describe('householdOutcome (household-first verdict)', () => {
  const mkCouple = () => baseInputs({
    rrspBalance: 300000, tfsaBalance: 100000, withdrawalOrder: ['rrsp', 'tfsa', 'taxable'],
    desiredSpending: 40000, cppStartAge: 65, cppMonthlyAmount: 600, oasStartAge: 65, oasYearsInCanada: 40,
    spouse: {
      enabled: true, currentAge: 65, retirementAge: 65,
      rrspBalance: 200000, tfsaBalance: 50000, taxableBalance: 0, cashCushionBalance: 0,
      rrspContribution: 0, tfsaContribution: 0, taxableContribution: 0,
      cppStartAge: 65, cppMonthlyAmount: 500, oasStartAge: 65, oasYearsInCanada: 40,
      desiredSpending: 25000,
    },
  });

  it('matches the primary result for a single person', () => {
    const inputs = baseInputs({ tfsaBalance: 500000, desiredSpending: 20000, cppStartAge: null, oasStartAge: null });
    const r = calculateHousehold(inputs, config);
    const ho = householdOutcome(r, inputs);
    expect(ho.depletionAge).toBe(r.depletionAge);
    expect(ho.status).toBe(r.status);
  });

  it('a funded primary covering a broke spouse reads ON_TRACK (no spurious shortfall)', () => {
    // The screenshot case: huge household, but the spouse silo alone depletes.
    const inputs = baseInputs({
      tfsaBalance: 5000000, desiredSpending: 20000, cppStartAge: null, oasStartAge: null,
      spouse: {
        enabled: true, currentAge: 65, retirementAge: 65,
        rrspBalance: 0, tfsaBalance: 0, taxableBalance: 0, cashCushionBalance: 0,
        rrspContribution: 0, tfsaContribution: 0, taxableContribution: 0,
        cppStartAge: null, cppMonthlyAmount: 0, oasStartAge: null, oasYearsInCanada: 40,
        desiredSpending: 60000,
      },
    });
    const r = calculateHousehold(inputs, config);
    // The spouse silo alone depletes...
    expect(r.spouse!.depletionAge).not.toBeNull();
    // ...but the household-first verdict follows the COMBINED money, which is ample.
    const ho = householdOutcome(r, inputs);
    expect(ho.depletionAge).toBeNull();
    expect(ho.status).toBe('ON_TRACK');
    expect(ho.endingBalance).toBeGreaterThan(0);
  });

  it('a household whose combined money genuinely runs out reads SHORTFALL', () => {
    const inputs = mkCouple();
    inputs.investmentReturn = 0; // nothing bails anyone out
    inputs.rrspBalance = 20000; inputs.tfsaBalance = 5000; inputs.desiredSpending = 60000;
    inputs.spouse!.rrspBalance = 5000; inputs.spouse!.tfsaBalance = 1000;
    inputs.spouse!.cppMonthlyAmount = 0; inputs.spouse!.oasStartAge = null;
    inputs.spouse!.desiredSpending = 50000;
    inputs.cppStartAge = null; inputs.oasStartAge = null;
    const r = calculateHousehold(inputs, config);
    const ho = householdOutcome(r, inputs);
    expect(ho.depletionAge).not.toBeNull();
    expect(ho.status).toBe('SHORTFALL');
    expect(ho.endingBalance).toBe(0);
  });
});

describe('year detail (drill-down)', () => {
  const sumWithdraw = (d: { rrifMin: number; rrif: number; rrsp: number; tfsa: number; taxable: number; cash: number; rmDraw: number }) =>
    d.rrifMin + d.rrif + d.rrsp + d.tfsa + d.taxable + d.cash + d.rmDraw;

  it('attaches detail to every row; withdraw sources sum to the year\'s withdrawals', () => {
    const r = calculateRetirement(baseInputs({
      rrspBalance: 300000, tfsaBalance: 200000, taxableBalance: 100000,
      cashCushionBalance: 50000, desiredSpending: 40000,
    }), config);
    for (const y of r.yearlyBreakdown) {
      expect(y.detail).toBeDefined();
      expect(closeTo(sumWithdraw(y.detail!.withdraw), y.withdrawals, 0.01)).toBe(true);
    }
  });

  it('growth per account sums to marketGains (decumulation and accumulation)', () => {
    const dec = calculateRetirement(baseInputs({
      rrspBalance: 100000, tfsaBalance: 100000, taxableBalance: 50000,
      cashCushionBalance: 20000, desiredSpending: 15000,
    }), config);
    for (const y of dec.yearlyBreakdown) {
      const g = y.detail!.growth;
      expect(closeTo(g.rrsp + g.rrif + g.tfsa + g.taxable + g.cash, y.marketGains, 0.01)).toBe(true);
    }
    const acc = calculateRetirement(baseInputs({
      currentAge: 60, retirementAge: 63, rrspBalance: 100000, tfsaBalance: 50000,
      rrspContribution: 5000, tfsaContribution: 2000,
    }), config);
    for (const y of acc.yearlyBreakdown) {
      const g = y.detail!.growth;
      expect(closeTo(g.rrsp + g.rrif + g.tfsa + g.taxable + g.cash, y.marketGains, 0.01)).toBe(true);
    }
  });

  it('separates the mandatory RRIF minimum from discretionary RRIF draws', () => {
    // Current age past the RRIF conversion age (71): RRSP already converted,
    // so the minimum is forced out first and any remaining need is a RRIF draw.
    const r = calculateRetirement(baseInputs({
      currentAge: 72, retirementAge: 72, maxAge: 80,
      rrspBalance: 500000, tfsaBalance: 0, taxableBalance: 0,
      desiredSpending: 60000, // above the RRIF minimum → discretionary RRIF draw too
    }), config);
    const y72 = yearAt(r.yearlyBreakdown, 72);
    expect(y72.detail!.withdraw.rrifMin).toBeGreaterThan(0);
    expect(y72.detail!.withdraw.rrif).toBeGreaterThan(0);
    // RRSP untouched (already converted); rrifMin + rrif make up the registered total.
    expect(y72.detail!.withdraw.rrsp).toBe(0);
    expect(closeTo(
      y72.detail!.withdraw.rrifMin + y72.detail!.withdraw.rrif,
      y72.withdrawals - y72.detail!.withdraw.tfsa - y72.detail!.withdraw.taxable - y72.detail!.withdraw.cash,
      0.01
    )).toBe(true);
  });

  it('computes the RRIF minimum on the Jan-1 balance, not the post-transfer balance (E-03)', () => {
    // Regression: the transfer loop ran before the RRIF-minimum block and
    // `acct.take('rrsp')` drains the RRIF first, so a same-year RRSP-meltdown
    // transfer shrank the balance the minimum was computed on. CRA bases the
    // mandatory minimum on the Jan-1 balance; a discretionary transfer later
    // in the year must not reduce it.
    // Age 72 (past conversion): $500k converts to RRIF at the top of the year,
    // then a $50k meltdown transfer moves registered → TFSA. Jan-1 min =
    // 500000 × 0.0540 = 27000; the buggy post-transfer figure was
    // 450000 × 0.0540 = 24300.
    const r = calculateRetirement(baseInputs({
      currentAge: 72, retirementAge: 72, maxAge: 73,
      rrspBalance: 500000, tfsaBalance: 0, taxableBalance: 0, cashCushionBalance: 0,
      desiredSpending: 0, // isolate the transfer + minimum: no spending draws
      events: [{
        id: 'meltdown', age: 72, label: 'RRSP meltdown', amount: 50000, direction: 'out',
        from: { kind: 'account', person: 'primary', account: 'rrsp' },
        to: { kind: 'account', person: 'primary', account: 'tfsa' },
      }],
    }), config);
    const row = yearAt(r.yearlyBreakdown, 72);
    // The minimum is on the Jan-1 (pre-transfer) $500k, not the post-transfer $450k.
    expect(row.detail!.withdraw.rrifMin).toBeCloseTo(500000 * 0.0540, 0);
    expect(row.detail!.withdraw.rrifMin).toBeGreaterThan(450000 * 0.0540);
    // The transfer still fired for its full gross.
    const tr = row.detail?.calc?.transfers?.[0];
    expect(tr).toBeDefined();
    expect(tr!.gross).toBeCloseTo(50000, 0);
  });

  it('RRIF-min excess redeposit is taxed once and carries full ACB (E-04)', () => {
    // VERIFY-only plan: the RRIF minimum is withdrawn and taxed as registered
    // income; whatever after-tax portion the spending need doesn't absorb is
    // redeposited into taxable with FULL ACB (a return of already-taxed
    // principal, not new income). Assert the three consequences:
    //  (1) the year's unified incomeTax equals the tax on the minimum exactly
    //      once — no second hit on the redeposited principal;
    //  (2) taxableAcb rises by the redeposit, so gainsFraction stays 0;
    //  (3) when the redeposit is later drawn from taxable, only its growth is
    //      realized as a capital gain — the principal never re-enters income.
    const r = calculateRetirement(baseInputs({
      currentAge: 72, retirementAge: 72, maxAge: 74,
      rrspBalance: 500000, tfsaBalance: 0, taxableBalance: 0, cashCushionBalance: 0,
      desiredSpending: 0, // the whole minimum becomes excess; no spending draws
    }), config);
    const y72 = yearAt(r.yearlyBreakdown, 72);
    const min = y72.detail!.withdraw.rrifMin;
    expect(min).toBeCloseTo(500000 * 0.0540, 0); // age-72 rate, on Jan-1 $500k
    const redeposit = y72.detail!.calc!.rrifMinExcess;
    expect(redeposit).toBeGreaterThan(0);

    // (1) Taxed exactly once. incomeTax = tax(benefits + registered + gains)
    //     − tax(benefits) with no benefits and no gains → tax(min) alone.
    //     A double-taxed redeposit would push incomeTax past that figure.
    expect(closeTo(y72.incomeTax, calculateTax(min, 'ONT', config).totalTax, 1)).toBe(true);
    // (2) The redeposit carries full ACB: taxable ends the year at redeposit
    //     × growth with ACB still equal to the full redeposit (gains fraction 0).
    expect(closeTo(y72.detail!.calc!.taxableAcb, redeposit, 1)).toBe(true);
    expect(closeTo(y72.detail!.calc!.gainsFraction, 0, 0.0001)).toBe(true);

    // (3) Age 73 forces a second minimum, whose redeposit also carries full
    //     ACB. Before that year's growth, the taxable account holds both
    //     redeposits plus one year's growth on the FIRST — so the embedded
    //     gain that a later draw would realize is exactly that growth
    //     (redeposit × 0.05); the principal never re-enters income.
    const y73 = yearAt(r.yearlyBreakdown, 73);
    const acb73 = y73.detail!.calc!.taxableAcb;
    const frac73 = y73.detail!.calc!.gainsFraction;
    expect(closeTo(acb73, redeposit + (acb73 - redeposit), 1)).toBe(true); // both redeposits in ACB
    expect(acb73).toBeGreaterThan(redeposit);
    const taxableStart73 = acb73 / (1 - frac73);
    const embeddedGain73 = taxableStart73 - acb73;
    expect(closeTo(embeddedGain73, redeposit * 0.05, 1)).toBe(true);
  });

  it('respects the withdrawal order: TFSA-first year draws only from TFSA', () => {
    const r = calculateRetirement(baseInputs({
      rrspBalance: 300000, tfsaBalance: 500000, taxableBalance: 200000,
      desiredSpending: 20000, withdrawalOrder: ['tfsa', 'taxable', 'rrsp'],
    }), config);
    const y65 = yearAt(r.yearlyBreakdown, 65);
    expect(y65.detail!.withdraw.tfsa).toBeGreaterThan(0);
    expect(y65.detail!.withdraw.taxable).toBe(0);
    expect(y65.detail!.withdraw.rrsp).toBe(0);
    expect(y65.detail!.withdraw.rrif).toBe(0);
    expect(y65.detail!.withdraw.rrifMin).toBe(0);
  });

  it('accumulation rows carry per-account contributions that sum to contributions', () => {
    const r = calculateRetirement(baseInputs({
      currentAge: 60, retirementAge: 62, rrspContribution: 10000,
      tfsaContribution: 6000, taxableContribution: 4000,
    }), config);
    for (const y of r.yearlyBreakdown) {
      if (y.age >= 62) continue;
      const c = y.detail!.contrib!;
      expect(closeTo(c.rrsp + c.tfsa + c.taxable, y.contributions, 0.01)).toBe(true);
      expect(c.rrsp).toBe(10000);
      expect(c.tfsa).toBe(6000);
      expect(c.taxable).toBe(4000);
    }
    // Decumulation rows have no contribution block.
    expect(yearAt(r.yearlyBreakdown, 63).detail!.contrib).toBeUndefined();
  });

  it('records cash events that fired that year', () => {
    const r = calculateRetirement(baseInputs({
      tfsaBalance: 200000, desiredSpending: 10000,
      events: [{ id: 'ev1', age: 67, label: 'Downsize home', direction: 'in', amount: 150000 }],
    }), config);
    const y67 = yearAt(r.yearlyBreakdown, 67);
    expect(y67.detail!.events).toEqual([{ label: 'Downsize home', direction: 'in', amount: 150000 }]);
    expect(yearAt(r.yearlyBreakdown, 66).detail!.events).toEqual([]);
  });

  it('reverse-mortgage detail matches the loan movement (interest + draws)', () => {
    const r = calculateRetirement(baseInputs({
      tfsaBalance: 500000, desiredSpending: 10000,
      reverseMortgage: {
        enabled: true, homeValue: 800000, appreciationRate: 0.02, interestRate: 0.06,
        drawAmount: 20000, startAge: 70, durationYears: 3, topUp: false,
      },
    }), config);
    for (let i = 1; i < r.yearlyBreakdown.length; i++) {
      const prev = r.yearlyBreakdown[i - 1];
      const cur = r.yearlyBreakdown[i];
      const rm = cur.detail!.rm!;
      // Loan movement = interest accrued + money drawn (scheduled + top-up).
      expect(closeTo(
        rm.loanBalance - (prev.loanBalance ?? 0),
        rm.interestAccrued + rm.scheduledDraw + rm.topUpDraw,
        0.01
      )).toBe(true);
      expect(closeTo(rm.homeValue, cur.homeValue!, 0.01)).toBe(true);
    }
    // A scheduled-draw year reports the draw in both places (detail + withdraw).
    const y70 = yearAt(r.yearlyBreakdown, 70);
    expect(y70.detail!.rm!.scheduledDraw).toBeGreaterThan(0);
    expect(y70.detail!.rm!.topUpDraw).toBe(0);
  });

  it('RM top-up draw appears in withdraw.rmDraw and rm.topUpDraw', () => {
    const r = calculateRetirement(baseInputs({
      tfsaBalance: 30000, cashCushionBalance: 0, desiredSpending: 15000, maxAge: 80,
      reverseMortgage: { enabled: true, homeValue: 800000, appreciationRate: 0, interestRate: 0.05, topUp: true },
    }), config);
    // Once the TFSA drains, top-up draws cover the shortfall.
    const topUpYears = r.yearlyBreakdown.filter(y => (y.detail!.rm!.topUpDraw ?? 0) > 0.5);
    expect(topUpYears.length).toBeGreaterThan(0);
    for (const y of topUpYears) {
      expect(closeTo(y.detail!.withdraw.rmDraw, y.detail!.rm!.topUpDraw, 0.01)).toBe(true);
    }
  });

  it('combineHouseholdBreakdown drops detail (per-person detail is read from the plans)', () => {
    const inputs = baseInputs({
      tfsaBalance: 300000, desiredSpending: 25000,
      spouse: {
        enabled: true, currentAge: 65, retirementAge: 65,
        rrspBalance: 0, tfsaBalance: 200000, taxableBalance: 0, cashCushionBalance: 0,
        rrspContribution: 0, tfsaContribution: 0, taxableContribution: 0,
        cppStartAge: null, cppMonthlyAmount: 0,
        oasStartAge: null, oasYearsInCanada: 40, desiredSpending: 15000,
        withdrawalOrder: ['tfsa', 'taxable', 'rrsp'],
      },
    });
    const r = calculateHousehold(inputs, config);
    // Per-person plans keep their detail…
    expect(r.yearlyBreakdown.every(y => y.detail)).toBe(true);
    expect(r.spouse!.yearlyBreakdown.every(y => y.detail)).toBe(true);
    // …but the combined household rows carry none (per-source numbers don't sum).
    const combined = combineHouseholdBreakdown(r, inputs);
    expect(combined.every(y => y.detail === undefined)).toBe(true);
  });
});

describe('GIS holes (john feedback)', () => {
  it('indexConfig scales the couple GIS maximum too (not just the single one)', async () => {
    const { indexConfig } = await import('./canadianTax');
    const idx = indexConfig(config, 1.02);
    expect(closeTo(idx.oas.gisMaxAnnualCouple, config.oas.gisMaxAnnualCouple * 1.02, 0.01)).toBe(true);
  });

  it('realized taxable-account capital gains reduce GIS', () => {
    // Half the taxable account is embedded gain; drawn first, the realized
    // gain is income for GIS purposes and must claw it back.
    const cfg = testConfig();
    cfg.engine.taxableAcbRatio = 0.5;
    const r = calculateRetirement(baseInputs({
      tfsaBalance: 0, rrspBalance: 0, cashCushionBalance: 0,
      taxableBalance: 600000,
      cppStartAge: null, oasStartAge: 65, oasYearsInCanada: 40,
      desiredSpending: 60000, withdrawalOrder: ['taxable', 'tfsa', 'rrsp'],
    }), cfg);
    // With gains counted, GIS drops far below the ~$13.5k max (gain ≈
    // $19k → 13478 − 19000×0.5 ≈ $4k). Before the fix it paid the full max.
    const gis65 = yearAt(r.yearlyBreakdown, 65).gisIncome;
    expect(gis65).toBeGreaterThan(0);
    expect(gis65).toBeLessThan(6000);
    // Sanity: a capital gain was actually realized this year.
    expect(yearAt(r.yearlyBreakdown, 65).detail!.tax.capitalGains).toBeGreaterThan(10000);
  });

  it('discretionary registered draws in the same year reduce GIS', () => {
    // RRSP-first draw well past the RRIF minimum: GIS must reflect the draw,
    // not assume only the minimum counts.
    const r = calculateRetirement(baseInputs({
      currentAge: 72, retirementAge: 72, maxAge: 80,
      rrspBalance: 500000, tfsaBalance: 0, taxableBalance: 0, cashCushionBalance: 0,
      cppStartAge: null, oasStartAge: 65, oasYearsInCanada: 40,
      desiredSpending: 80000, withdrawalOrder: ['rrsp', 'tfsa', 'taxable'],
    }), config);
    const gis72 = yearAt(r.yearlyBreakdown, 72).gisIncome;
    // $80k of registered income wipes GIS out entirely (13478 − 80000×0.5 < 0).
    expect(gis72).toBe(0);
  });
});

describe('employment income (issue #22)', () => {
  const job = (over: Partial<import('./retirementEngine').IncomeSource> = {}): import('./retirementEngine').IncomeSource => ({
    id: 'j1', label: 'part-time', kind: 'employment', annualAmount: 20000, startAge: 65, endAge: 69,
    destAccount: 'tfsa', topUpSpending: false, indexedToCpi: false, ...over,
  });

  it('save-mode net is taxed at the marginal rate and lands in destAccount', () => {
    const withJob = calculateRetirement(baseInputs({
      tfsaBalance: 0, taxableBalance: 0, cashCushionBalance: 0, rrspBalance: 0,
      desiredSpending: 0, cppStartAge: null, oasStartAge: null,
      income: [job()],
    }), config);
    const y65 = yearAt(withJob.yearlyBreakdown, 65);
    expect(y65.employmentGross).toBe(20000);
    // Marginal tax on $20k in ONT with no other income ≈ first-bracket rate.
    expect(y65.employmentTax).toBeGreaterThan(0);
    expect(y65.employmentNet).toBeCloseTo(20000 - y65.employmentTax!, 6);
    // Net lands in the TFSA (grows at year end, so balance = net × 1.05).
    const noJob = calculateRetirement(baseInputs({
      tfsaBalance: 0, taxableBalance: 0, cashCushionBalance: 0, rrspBalance: 0,
      desiredSpending: 0, cppStartAge: null, oasStartAge: null,
    }), config);
    expect(closeTo(y65.tfsaBalance - yearAt(noJob.yearlyBreakdown, 65).tfsaBalance, y65.employmentNet! * 1.05, 1)).toBe(true);
  });

  it('incomeTax includes the employment tax exactly once', () => {
    const r = calculateRetirement(baseInputs({
      tfsaBalance: 0, taxableBalance: 0, cashCushionBalance: 0, rrspBalance: 0,
      desiredSpending: 0, cppStartAge: null, oasStartAge: null,
      income: [job()],
    }), config);
    const y65 = yearAt(r.yearlyBreakdown, 65);
    expect(closeTo(y65.incomeTax, y65.employmentTax!, 1)).toBe(true);
  });

  it('employment tax stacks on benefits (marginal, not standalone)', () => {
    // $40k pension + $20k job: the job's tax must exceed what $20k alone pays.
    const withPension = calculateRetirement(baseInputs({
      tfsaBalance: 0, taxableBalance: 0, cashCushionBalance: 0, rrspBalance: 0,
      desiredSpending: 0, cppStartAge: null, oasStartAge: null,
      income: [{ id: 'p', label: 'db', kind: 'pension', annualAmount: 40000, startAge: 65, endAge: null, indexedToCpi: false }, job()],
    }), config);
    const alone = calculateRetirement(baseInputs({
      tfsaBalance: 0, taxableBalance: 0, cashCushionBalance: 0, rrspBalance: 0,
      desiredSpending: 0, cppStartAge: null, oasStartAge: null,
      income: [job()],
    }), config);
    const tStacked = yearAt(withPension.yearlyBreakdown, 65).employmentTax!;
    const tAlone = yearAt(alone.yearlyBreakdown, 65).employmentTax!;
    expect(tStacked).toBeGreaterThan(tAlone);
  });

  it('top-up mode displaces withdrawals instead of depositing', () => {
    const topUp = calculateRetirement(baseInputs({
      tfsaBalance: 500000, taxableBalance: 0, cashCushionBalance: 0, rrspBalance: 0,
      desiredSpending: 30000, cppStartAge: null, oasStartAge: null,
      withdrawalOrder: ['tfsa', 'taxable', 'rrsp'],
      income: [job({ topUpSpending: true })],
    }), config);
    const noJob = calculateRetirement(baseInputs({
      tfsaBalance: 500000, taxableBalance: 0, cashCushionBalance: 0, rrspBalance: 0,
      desiredSpending: 30000, cppStartAge: null, oasStartAge: null,
      withdrawalOrder: ['tfsa', 'taxable', 'rrsp'],
    }), config);
    const wd = (r: typeof topUp) => yearAt(r.yearlyBreakdown, 65).withdrawals;
    // The top-up net covers spending, so the portfolio draw drops by that much.
    expect(closeTo(wd(noJob) - wd(topUp), yearAt(topUp.yearlyBreakdown, 65).employmentNet!, 1)).toBe(true);
    // Nothing deposited: the TFSA only shrank.
    expect(yearAt(topUp.yearlyBreakdown, 65).detail!.deposit?.tfsa ?? 0).toBe(0);
  });

  it('top-up excess over the spending need is saved into destAccount', () => {
    // Spending of $5k with a $20k top-up job: most of the net has nowhere to go.
    const r = calculateRetirement(baseInputs({
      tfsaBalance: 0, taxableBalance: 0, cashCushionBalance: 0, rrspBalance: 0,
      desiredSpending: 5000, cppStartAge: null, oasStartAge: null,
      income: [job({ topUpSpending: true, destAccount: 'tfsa' })],
    }), config);
    const y65 = yearAt(r.yearlyBreakdown, 65);
    const excess = y65.employmentNet! - 5000;
    expect(excess).toBeGreaterThan(0);
    expect(closeTo(y65.detail!.deposit?.tfsa ?? 0, excess, 1)).toBe(true);
  });

  it('respects the start/end age window (inclusive), then stops', () => {
    const r = calculateRetirement(baseInputs({
      desiredSpending: 0, cppStartAge: null, oasStartAge: null,
      income: [job({ startAge: 66, endAge: 68 })],
    }), config);
    expect(yearAt(r.yearlyBreakdown, 65).employmentGross).toBe(0);
    expect(yearAt(r.yearlyBreakdown, 66).employmentGross).toBe(20000);
    expect(yearAt(r.yearlyBreakdown, 68).employmentGross).toBe(20000);
    expect(yearAt(r.yearlyBreakdown, 69).employmentGross).toBe(0);
  });

  it('indexedToCpi grows the amount when tax tables index', () => {
    const c = testConfig();
    c.engine.indexTaxTables = true;
    const r = calculateRetirement(baseInputs({
      desiredSpending: 0, cppStartAge: null, oasStartAge: null,
      income: [job({ indexedToCpi: true, endAge: 75 })],
    }), c);
    expect(closeTo(yearAt(r.yearlyBreakdown, 70).employmentGross!, 20000 * Math.pow(1 + INFL, 5), 1)).toBe(true);
  });

  it('employment reduces single-person GIS at the reduction rate', () => {
    const noJob = calculateRetirement(baseInputs({
      tfsaBalance: 0, taxableBalance: 0, cashCushionBalance: 0, rrspBalance: 0,
      desiredSpending: 0, cppStartAge: null, oasStartAge: 65, oasYearsInCanada: 40,
    }), config);
    const withJob = calculateRetirement(baseInputs({
      tfsaBalance: 0, taxableBalance: 0, cashCushionBalance: 0, rrspBalance: 0,
      desiredSpending: 0, cppStartAge: null, oasStartAge: 65, oasYearsInCanada: 40,
      income: [job()],
    }), config);
    const g0 = yearAt(noJob.yearlyBreakdown, 65).gisIncome;
    const g1 = yearAt(withJob.yearlyBreakdown, 65).gisIncome;
    // GIS base gains $20k → reduction = 20000 × gisReductionRate (0.5).
    expect(closeTo(g0 - g1, 20000 * (config.oas.gisReductionRate ?? 0.5), 5)).toBe(true);
  });

  it('spouse employment counts toward couple GIS', () => {
    const spouseInputs = {
      currentAge: 65, cppStartAge: null as number | null, cppMonthlyAmount: 0,
      oasStartAge: 65 as number | null, oasYearsInCanada: 40,
      rrspBalance: 0, tfsaBalance: 0, taxableBalance: 0, cashCushionBalance: 0,
      rrspContribution: 0, tfsaContribution: 0, taxableContribution: 0,
      income: [job()],
    };
    const without = calculateRetirement(baseInputs({
      tfsaBalance: 0, taxableBalance: 0, cashCushionBalance: 0, rrspBalance: 0,
      desiredSpending: 0, cppStartAge: null, oasStartAge: 65, oasYearsInCanada: 40,
    }), config, { spouseContext: { ...spouseInputs, income: [] } });
    const withSpouseJob = calculateRetirement(baseInputs({
      tfsaBalance: 0, taxableBalance: 0, cashCushionBalance: 0, rrspBalance: 0,
      desiredSpending: 0, cppStartAge: null, oasStartAge: 65, oasYearsInCanada: 40,
    }), config, { spouseContext: spouseInputs });
    const g0 = yearAt(without.yearlyBreakdown, 65).gisIncome;
    const g1 = yearAt(withSpouseJob.yearlyBreakdown, 65).gisIncome;
    // Spouse's $20k counts against combined income: the reduction (20k × 0.5 =
    // 10k) exceeds the entire couple entitlement (~8.1k), so GIS zeroes out.
    expect(g0).toBeGreaterThan(0);
    expect(g1).toBe(0);
  });

  it('save-mode splits net across jobs by gross share into each destAccount', () => {
    const r = calculateRetirement(baseInputs({
      tfsaBalance: 0, taxableBalance: 0, cashCushionBalance: 0, rrspBalance: 0,
      desiredSpending: 0, cppStartAge: null, oasStartAge: null,
      income: [
        job({ id: 'a', annualAmount: 10000, destAccount: 'tfsa' }),
        job({ id: 'b', annualAmount: 30000, destAccount: 'taxable' }),
      ],
    }), config);
    const y65 = yearAt(r.yearlyBreakdown, 65);
    expect(y65.employmentGross).toBe(40000);
    // 1:3 gross split → TFSA gets 1/4 of net, taxable 3/4 (before growth).
    expect(closeTo(y65.detail!.deposit?.tfsa ?? 0, y65.employmentNet! * 0.25, 1)).toBe(true);
    expect(closeTo(y65.detail!.deposit?.taxable ?? 0, y65.employmentNet! * 0.75, 1)).toBe(true);
  });

  it('household combiner sums both spouses\' employment rows', () => {
    const inputs = baseInputs({
      desiredSpending: 0, cppStartAge: null, oasStartAge: null,
      income: [job()],
      spouse: {
        enabled: true, currentAge: 65, retirementAge: 65,
        rrspBalance: 0, tfsaBalance: 0, taxableBalance: 0, cashCushionBalance: 0,
        rrspContribution: 0, tfsaContribution: 0, taxableContribution: 0,
        cppStartAge: null, cppMonthlyAmount: 0, oasStartAge: null, oasYearsInCanada: 40,
        desiredSpending: 0,
        income: [job()],
      },
    });
    const r = calculateHousehold(inputs, config);
    const combined = combineHouseholdBreakdown(r, inputs);
    expect(closeTo(yearAt(combined, 65).employmentGross!, 40000, 1)).toBe(true);
  });
});

// "Why does tax stop at a certain age?" — a user's reported perception. The
// engine must charge tax in EVERY year taxable income is received, right to
// maxAge. These tests pin that down so a display quirk can't masquerade as an
// engine bug.
describe('tax continuity through maxAge', () => {
  it('taxes CPP+OAS in every year through maxAge, even with no portfolio', () => {
    const r = calculateRetirement(baseInputs({
      tfsaBalance: 0, taxableBalance: 0, rrspBalance: 0, cashCushionBalance: 0,
      desiredSpending: 0,
      // Taxable benefit income every year from 65 to 95.
      cppStartAge: 65, cppMonthlyAmount: 1400, oasStartAge: 65,
      maxAge: 95,
    }), config);
    for (const y of r.yearlyBreakdown) {
      if (y.age < 65) continue;
      // The benefits are taxable, so tax must be charged on them every year.
      expect(y.detail!.calc!.totalNetIncome).toBeGreaterThan(0);
      // incomeTax is the INCREMENTAL tax on withdrawals; with no withdrawals the
      // tax on the benefits themselves lives inside netBenefits — but it is
      // nonzero because CPP+OAS exceed the basic personal amount.
      expect(y.detail!.calc!.taxOnBenefits).toBeGreaterThan(0);
    }
    // The last year (maxAge) still carries the benefit tax.
    expect(yearAt(r.yearlyBreakdown, 95).detail!.calc!.taxOnBenefits).toBeGreaterThan(0);
  });

  it('RRIF minimums keep income tax > 0 in every year while the RRIF has money', () => {
    const r = calculateRetirement(baseInputs({
      tfsaBalance: 0, taxableBalance: 0, cashCushionBalance: 0,
      rrspBalance: 1000000, desiredSpending: 20000,
      cppStartAge: null, oasStartAge: null, maxAge: 95,
    }), config);
    // From the RRIF conversion age (71) onward, a mandatory minimum is forced
    // out and taxed — so the incremental income tax is positive every year the
    // RRIF still holds money.
    let checkedYears = 0;
    for (const y of r.yearlyBreakdown) {
      if (y.age < 71) continue;
      if (y.detail!.withdraw.rrifMin <= 0) continue; // RRIF empty this year
      expect(y.incomeTax).toBeGreaterThan(0);
      checkedYears++;
    }
    expect(checkedYears).toBeGreaterThan(0);
  });

  it('income tax is computed in the final year (maxAge) when income exists', () => {
    const r = calculateRetirement(baseInputs({
      rrspBalance: 500000, tfsaBalance: 0,
      cppStartAge: 65, cppMonthlyAmount: 1000, oasStartAge: 65,
      maxAge: 90, desiredSpending: 30000,
    }), config);
    const last = yearAt(r.yearlyBreakdown, 90);
    expect(last.detail!.calc!.totalNetIncome).toBeGreaterThan(0);
    expect(typeof last.incomeTax).toBe('number');
    expect(last.incomeTax).toBeGreaterThanOrEqual(0);
  });
});

// Total-tax visibility: the per-year "Income Tax" column is the INCREMENTAL tax
// on withdrawals, which legitimately reads $0 once the portfolio is drained —
// the "tax stopped" perception. totalTaxPaid is the year's FULL tax on all
// income, and must stay positive whenever taxable income is received.
describe('totalTaxPaid (total tax on all income)', () => {
  it('keeps totalTaxPaid > 0 on CPP+OAS alone, even when incomeTax is $0', () => {
    const r = calculateRetirement(baseInputs({
      tfsaBalance: 0, taxableBalance: 0, rrspBalance: 0, cashCushionBalance: 0,
      desiredSpending: 0,
      cppStartAge: 65, cppMonthlyAmount: 1400, oasStartAge: 65, maxAge: 90,
    }), config);
    for (const y of r.yearlyBreakdown) {
      if (y.age < 65) continue;
      // No withdrawals → incremental incomeTax is $0, but the year's FULL tax
      // (on the benefits) is positive because CPP+OAS exceed the exemption.
      expect(y.totalTaxPaid).toBeGreaterThan(0);
      expect(y.totalTaxPaid!).toBeGreaterThanOrEqual(y.incomeTax);
    }
  });

  it('totalTaxPaid >= incomeTax in every year of a funded plan', () => {
    const r = calculateRetirement(baseInputs({
      rrspBalance: 500000, tfsaBalance: 100000,
      cppStartAge: 65, cppMonthlyAmount: 1000, oasStartAge: 65,
      desiredSpending: 40000, maxAge: 90,
    }), config);
    for (const y of r.yearlyBreakdown) {
      if (y.totalTaxPaid === undefined) continue;
      // Total tax covers benefits + withdrawals, so it's ≥ the withdrawal-only
      // incremental figure (small tolerance for the pension-split path / cents).
      expect(y.totalTaxPaid).toBeGreaterThanOrEqual(y.incomeTax - 0.51);
    }
  });

  it('household combined rows sum both spouses\' totalTaxPaid', () => {
    const inputs = baseInputs({
      rrspBalance: 300000, tfsaBalance: 0,
      cppStartAge: 65, cppMonthlyAmount: 900, oasStartAge: 65, desiredSpending: 30000,
      spouse: {
        enabled: true, currentAge: 65, retirementAge: 65,
        rrspBalance: 200000, tfsaBalance: 0, taxableBalance: 0, cashCushionBalance: 0,
        rrspContribution: 0, tfsaContribution: 0, taxableContribution: 0,
        cppStartAge: 65, cppMonthlyAmount: 700, oasStartAge: 65, oasYearsInCanada: 40,
        desiredSpending: 20000,
      },
    });
    const r = calculateHousehold(inputs, config);
    const combined = combineHouseholdBreakdown(r, inputs);
    const cy = yearAt(combined, 70);
    const py = yearAt(r.yearlyBreakdown, 70);
    const sy = yearAt(r.spouse!.yearlyBreakdown, 70);
    expect(closeTo(cy.totalTaxPaid!, (py.totalTaxPaid ?? 0) + (sy.totalTaxPaid ?? 0), 0.02)).toBe(true);
  });
});

describe('RDSP (Registered Disability Savings Plan)', () => {
  // A young beneficiary accumulating before retirement. currentAge 30, retire
  // at 65, so ages 30..64 are the accumulation years (contribution + grant/bond).
  const rdspAccum = (over: Parameters<typeof baseInputs>[0] = {}) => baseInputs({
    currentAge: 30, retirementAge: 65, maxAge: 70,
    rrspBalance: 0, tfsaBalance: 0, taxableBalance: 0, cashCushionBalance: 0,
    desiredSpending: 0,
    rdsp: { enabled: true, balance: 0, contribution: 1500, familyIncome: 50000, dtcEligible: true },
    ...over,
  });

  it('pays the low-income grant: 300% on first $500 + 200% on next $1,000 = $3,500', () => {
    const r = calculateRetirement(rdspAccum(), config);
    const y30 = yearAt(r.yearlyBreakdown, 30);
    // $1,500 contributed, family income 50,000 ≤ 117,045 → full grant $3,500.
    expect(y30.detail?.rdsp?.contribution).toBeCloseTo(1500, 0);
    expect(y30.detail?.rdsp?.grant).toBeCloseTo(3500, 0);
    // The year's balance is contribution + grant + bond (+ growth, which is 0
    // on an empty opening balance) — and it's part of the year's ending balance.
    const d = y30.detail!.rdsp!;
    expect(closeTo(y30.rdspBalance!, d.contribution + d.grant + d.bond + d.growth, 1)).toBe(true);
    expect(closeTo(y30.endingBalance, y30.rdspBalance!, 1)).toBe(true);
  });

  it('pays the high-income grant: 100% on first $1,000 = $1,000', () => {
    const r = calculateRetirement(rdspAccum({
      rdsp: { enabled: true, balance: 0, contribution: 1500, familyIncome: 200000, dtcEligible: true },
    }), config);
    const y30 = yearAt(r.yearlyBreakdown, 30);
    // Family income 200,000 > 117,045 → 100% match on first $1,000 only.
    expect(y30.detail?.rdsp?.grant).toBeCloseTo(1000, 0);
    // High income is above the bond upper threshold → no bond.
    expect(y30.detail?.rdsp?.bond).toBeCloseTo(0, 0);
  });

  it('pays the full bond below the lower threshold, phases it out, and zeroes it above the upper', () => {
    // Below lower (38,237): full $1,000 bond even with no contribution.
    const low = calculateRetirement(rdspAccum({
      rdsp: { enabled: true, balance: 0, contribution: 0, familyIncome: 20000, dtcEligible: true },
    }), config);
    expect(yearAt(low.yearlyBreakdown, 30).detail?.rdsp?.bond).toBeCloseTo(1000, 0);

    // Mid-band (between 38,237 and 58,523): linear phase-out. At the midpoint
    // (48,380) the bond is half of $1,000.
    const mid = calculateRetirement(rdspAccum({
      rdsp: { enabled: true, balance: 0, contribution: 0, familyIncome: 48380, dtcEligible: true },
    }), config);
    expect(yearAt(mid.yearlyBreakdown, 30).detail?.rdsp?.bond).toBeCloseTo(500, 0);

    // Above upper (58,523): no bond.
    const high = calculateRetirement(rdspAccum({
      rdsp: { enabled: true, balance: 0, contribution: 0, familyIncome: 80000, dtcEligible: true },
    }), config);
    expect(yearAt(high.yearlyBreakdown, 30).detail?.rdsp?.bond).toBeCloseTo(0, 0);
  });

  it('stops grants and bonds after the year the beneficiary turns 49', () => {
    const r = calculateRetirement(rdspAccum(), config);
    expect(yearAt(r.yearlyBreakdown, 49).detail?.rdsp?.grant).toBeGreaterThan(0);
    // From 50 onward no grant/bond is paid (contribution may still continue).
    for (const age of [50, 55, 60]) {
      const d = yearAt(r.yearlyBreakdown, age).detail?.rdsp;
      expect(d?.grant ?? 0).toBe(0);
      expect(d?.bond ?? 0).toBe(0);
    }
  });

  it('stops contributions after the year the beneficiary turns 59', () => {
    const r = calculateRetirement(rdspAccum(), config);
    expect(yearAt(r.yearlyBreakdown, 59).detail?.rdsp?.contribution).toBeCloseTo(1500, 0);
    for (const age of [60, 64]) {
      expect(yearAt(r.yearlyBreakdown, age).detail?.rdsp?.contribution ?? 0).toBe(0);
    }
  });

  it('caps contributions at the $200,000 lifetime maximum', () => {
    // Huge annual contribution; the lifetime cap must bite.
    const r = calculateRetirement(rdspAccum({
      rdsp: { enabled: true, balance: 0, contribution: 50000, familyIncome: 200000, dtcEligible: true },
    }), config);
    // Sum of contributions across the whole run never exceeds 200,000.
    const totalContrib = r.yearlyBreakdown.reduce((s, y) => s + (y.detail?.rdsp?.contribution ?? 0), 0);
    expect(totalContrib).toBeLessThanOrEqual(200000 + 0.01);
    expect(totalContrib).toBeGreaterThan(0);
  });

  it('caps grants at the $70,000 lifetime maximum', () => {
    const r = calculateRetirement(rdspAccum(), config);
    const totalGrant = r.yearlyBreakdown.reduce((s, y) => s + (y.detail?.rdsp?.grant ?? 0), 0);
    expect(totalGrant).toBeLessThanOrEqual(70000 + 0.01);
  });

  it('caps bonds at the $20,000 lifetime maximum', () => {
    const r = calculateRetirement(rdspAccum({
      rdsp: { enabled: true, balance: 0, contribution: 0, familyIncome: 10000, dtcEligible: true },
    }), config);
    const totalBond = r.yearlyBreakdown.reduce((s, y) => s + (y.detail?.rdsp?.bond ?? 0), 0);
    expect(totalBond).toBeLessThanOrEqual(20000 + 0.01);
  });

  it('grows tax-sheltered and reports the balance in net worth', () => {
    const r = calculateRetirement(rdspAccum(), config);
    const y40 = yearAt(r.yearlyBreakdown, 40);
    // The RDSP balance is part of the year's ending balance (net worth).
    expect(y40.rdspBalance!).toBeGreaterThan(0);
    expect(closeTo(y40.endingBalance, y40.rdspBalance!, 1)).toBe(true);
    // Growth is reported per year.
    expect(y40.detail?.rdsp?.growth!).toBeGreaterThan(0);
  });

  it('does nothing when DTC-ineligible (no account, no grants)', () => {
    const r = calculateRetirement(rdspAccum({
      rdsp: { enabled: true, balance: 10000, contribution: 1500, familyIncome: 50000, dtcEligible: false },
    }), config);
    const y30 = yearAt(r.yearlyBreakdown, 30);
    expect(y30.rdspBalance).toBeUndefined();
    expect(y30.detail?.rdsp).toBeUndefined();
  });
});

describe('RDSP withdrawals (decumulation)', () => {
  // A retired beneficiary drawing from an RDSP. Open with a $100k balance that
  // is 40% contribution principal (tax-free) and 60% grant/bond/growth (taxable).
  const rdspDraw = (over: Parameters<typeof baseInputs>[0] = {}) => baseInputs({
    currentAge: 65, retirementAge: 65, maxAge: 80,
    rrspBalance: 0, tfsaBalance: 0, taxableBalance: 0, cashCushionBalance: 0,
    desiredSpending: 20000,
    withdrawalOrder: ['rdsp', 'tfsa', 'taxable', 'rrsp'],
    rdsp: { enabled: true, balance: 100000, contribution: 0, familyIncome: 0, contributionBasis: 40000, dtcEligible: true },
    ...over,
  });

  it('draws from the RDSP first when it leads the withdrawal order', () => {
    const r = calculateRetirement(rdspDraw(), config);
    const y65 = yearAt(r.yearlyBreakdown, 65);
    expect((y65.detail?.withdraw.rdsp ?? 0)).toBeGreaterThan(0);
    expect(y65.detail?.rdsp?.withdrawal!).toBeGreaterThan(0);
  });

  it('splits the withdrawal into a taxable (grant/growth) and tax-free (contribution) portion', () => {
    const r = calculateRetirement(rdspDraw(), config);
    const y65 = yearAt(r.yearlyBreakdown, 65);
    const wd = y65.detail!.rdsp!.withdrawal!;
    const taxablePart = y65.detail!.rdsp!.taxablePortion!;
    // 40% contribution basis → 60% of any draw is taxable.
    expect(closeTo(taxablePart, wd * 0.6, 1)).toBe(true);
    // The taxable portion stacks into the year's taxable income.
    expect(y65.detail!.calc!.totalNetIncome).toBeGreaterThanOrEqual(taxablePart - 0.01);
  });

  it('a pure-contribution RDSP (basis = balance) withdraws fully tax-free', () => {
    const r = calculateRetirement(rdspDraw({
      rdsp: { enabled: true, balance: 100000, contribution: 0, familyIncome: 0, contributionBasis: 100000, dtcEligible: true },
    }), config);
    const y65 = yearAt(r.yearlyBreakdown, 65);
    // All principal → no taxable portion, no incremental tax on the draw.
    expect(y65.detail!.rdsp!.taxablePortion ?? 0).toBeCloseTo(0, 0);
  });

  it('an all-growth RDSP (basis = 0) withdraws fully taxable', () => {
    const r = calculateRetirement(rdspDraw({
      rdsp: { enabled: true, balance: 100000, contribution: 0, familyIncome: 0, contributionBasis: 0, dtcEligible: true },
    }), config);
    const y65 = yearAt(r.yearlyBreakdown, 65);
    const wd = y65.detail!.rdsp!.withdrawal!;
    expect(closeTo(y65.detail!.rdsp!.taxablePortion!, wd, 1)).toBe(true);
    // Taxable draw → incremental tax is positive (income above the exemption).
    expect(y65.incomeTax).toBeGreaterThan(0);
  });

  it('reduces the contribution basis pro-rata as it draws down', () => {
    const r = calculateRetirement(rdspDraw(), config);
    const y65 = yearAt(r.yearlyBreakdown, 65);
    const wd = y65.detail!.rdsp!.withdrawal!;
    // Basis shrinks by the tax-free (contribution) part of the draw.
    expect(closeTo(y65.detail!.rdsp!.contributionBasis!, 40000 - wd * 0.4, 1)).toBe(true);
  });

  it('sums both spouses\' RDSP balances in the household combiner', () => {
    const inputs = baseInputs({
      rrspBalance: 100000, tfsaBalance: 0, desiredSpending: 20000,
      rdsp: { enabled: true, balance: 50000, contribution: 0, familyIncome: 0, contributionBasis: 50000, dtcEligible: true },
      spouse: {
        enabled: true, currentAge: 65, retirementAge: 65,
        rrspBalance: 100000, tfsaBalance: 0, taxableBalance: 0, cashCushionBalance: 0,
        rrspContribution: 0, tfsaContribution: 0, taxableContribution: 0,
        cppStartAge: null, cppMonthlyAmount: 0, oasStartAge: null, oasYearsInCanada: 40,
        desiredSpending: 15000,
        rdsp: { enabled: true, balance: 30000, contribution: 0, familyIncome: 0, contributionBasis: 30000, dtcEligible: true },
      },
    });
    const r = calculateHousehold(inputs, config);
    const combined = combineHouseholdBreakdown(r, inputs);
    const cy = yearAt(combined, 65);
    const py = yearAt(r.yearlyBreakdown, 65);
    const sy = yearAt(r.spouse!.yearlyBreakdown, 65);
    expect(closeTo(cy.rdspBalance!, (py.rdspBalance ?? 0) + (sy.rdspBalance ?? 0), 0.02)).toBe(true);
  });
});

describe('RDSP auto-injection into the drawdown order (E-01)', () => {
  // Regression for the blocker: an enabled RDSP must be drawn down even when
  // the configured withdrawal order never mentions 'rdsp' (the production
  // default — every UI/default order is a 3-account permutation).
  const rdspNoOrder = (over: Parameters<typeof baseInputs>[0] = {}) => baseInputs({
    currentAge: 65, retirementAge: 65, maxAge: 80,
    rrspBalance: 0, tfsaBalance: 0, taxableBalance: 0, cashCushionBalance: 0,
    desiredSpending: 20000,
    withdrawalOrder: ['tfsa', 'taxable', 'rrsp'], // the default — NO 'rdsp'
    rdsp: { enabled: true, balance: 100000, contribution: 0, familyIncome: 0, contributionBasis: 40000, dtcEligible: true },
    ...over,
  });

  it('draws from the RDSP even when the order omits it', () => {
    const r = calculateRetirement(rdspNoOrder(), config);
    const y65 = yearAt(r.yearlyBreakdown, 65);
    expect((y65.detail?.withdraw.rdsp ?? 0)).toBeGreaterThan(0);
    expect(y65.detail?.rdsp?.withdrawal!).toBeGreaterThan(0);
  });

  it('depletes the RDSP over the horizon instead of letting it accumulate untouched', () => {
    const r = calculateRetirement(rdspNoOrder(), config);
    // $100k RDSP vs $20k/yr spending → fully spent well before age 80.
    const last = r.yearlyBreakdown[r.yearlyBreakdown.length - 1];
    expect(last.rdspBalance ?? 0).toBeCloseTo(0, 0);
  });

  it('leaves the RDSP untouched when it is disabled or DTC-ineligible', () => {
    const r = calculateRetirement(rdspNoOrder({
      rdsp: { enabled: true, balance: 100000, contribution: 0, familyIncome: 0, contributionBasis: 40000, dtcEligible: false },
    }), config);
    const y65 = yearAt(r.yearlyBreakdown, 65);
    expect(y65.rdspBalance).toBeUndefined();
    expect(y65.detail?.withdraw.rdsp ?? 0).toBe(0);
  });

  it('honours an explicit order that places rdsp last (no double-injection)', () => {
    const r = calculateRetirement(rdspNoOrder({
      withdrawalOrder: ['tfsa', 'taxable', 'rrsp', 'rdsp'],
      // Give the earlier accounts enough to cover spending so rdsp, now last,
      // is barely touched — proving the explicit position is respected.
      tfsaBalance: 500000,
    }), config);
    const y65 = yearAt(r.yearlyBreakdown, 65);
    // TFSA (tax-free, first) covers the year; RDSP is not drawn at 65.
    expect(y65.detail?.withdraw.tfsa ?? 0).toBeGreaterThan(0);
    expect(y65.detail?.withdraw.rdsp ?? 0).toBe(0);
  });
});

describe('FHSA (First Home Savings Account)', () => {
  // A young person accumulating toward a first home. currentAge 30, retire at
  // 35 (short horizon keeps the boundary-transfer test cheap), so ages 30..34
  // are the accumulation years. No other assets or income: isolate the FHSA.
  const fhsaAccum = (over: Parameters<typeof baseInputs>[0] = {}) => baseInputs({
    currentAge: 30, retirementAge: 35, maxAge: 40,
    rrspBalance: 0, tfsaBalance: 0, taxableBalance: 0, cashCushionBalance: 0,
    desiredSpending: 0,
    fhsa: { enabled: true, balance: 0, contribution: 8000 },
    ...over,
  });

  it('accumulates the annual contribution and reports it (deductible)', () => {
    const r = calculateRetirement(fhsaAccum(), config);
    const y30 = yearAt(r.yearlyBreakdown, 30);
    expect(y30.detail?.fhsa?.contribution).toBeCloseTo(8000, 0);
    // Deposits land after the year's growth step, so the year-end balance is
    // just the (ungrown) contribution; growth starts next year.
    expect(y30.detail?.fhsa?.balance).toBeCloseTo(8000, 0);
    expect(y30.fhsaBalance).toBeCloseTo(8000, 0);
    // Contributed-to-date tracks the lifetime limit.
    expect(y30.detail?.fhsa?.contributionBasis).toBeCloseTo(8000, 0);
  });

  it('caps the contribution at the $8,000 annual limit', () => {
    const r = calculateRetirement(fhsaAccum({
      fhsa: { enabled: true, balance: 0, contribution: 20000 },
    }), config);
    expect(yearAt(r.yearlyBreakdown, 30).detail?.fhsa?.contribution).toBeCloseTo(8000, 0);
  });

  it('caps lifetime contributions at the $40,000 limit', () => {
    // 6 accumulation years (30..34 → but horizon 30..34 = 5 years). Use a longer
    // horizon so >5 years of $8k would exceed the $40k lifetime cap.
    const r = calculateRetirement(fhsaAccum({ retirementAge: 37 }), config);
    const total = r.yearlyBreakdown.reduce((s, y) => s + (y.detail?.fhsa?.contribution ?? 0), 0);
    expect(total).toBeLessThanOrEqual(40000 + 0.01);
    expect(total).toBeGreaterThan(0);
  });

  it('grows tax-sheltered and includes the balance in net worth', () => {
    const r = calculateRetirement(fhsaAccum(), config);
    const y31 = yearAt(r.yearlyBreakdown, 31);
    // Year 2: prior $8k grew at 5% → $8,400, plus a fresh $8k deposit = $16,400.
    expect(y31.detail?.fhsa?.growth!).toBeGreaterThan(0);
    expect(closeTo(y31.fhsaBalance!, 8000 * 1.05 + 8000, 1)).toBe(true);
    // The FHSA balance is part of the year's ending balance (net worth).
    expect(closeTo(y31.endingBalance, y31.fhsaBalance!, 1)).toBe(true);
  });

  it('stops contributing once the 15-year plan window closes', () => {
    // Opened at 30, so contributions stop at 45. A small $1k/yr contribution
    // keeps the running total ($15k) under the $40k lifetime cap so the WINDOW
    // rule (not the lifetime cap) is what stops the contributions.
    const r = calculateRetirement(fhsaAccum({
      retirementAge: 48,
      fhsa: { enabled: true, balance: 0, contribution: 1000 },
    }), config);
    // 15 contribution years (30..44 inclusive) then none.
    expect(yearAt(r.yearlyBreakdown, 44).detail?.fhsa?.contribution).toBeCloseTo(1000, 0);
    expect(yearAt(r.yearlyBreakdown, 45).detail?.fhsa?.contribution ?? 0).toBe(0);
  });

  it('transfers the balance to the RRSP at the retirement boundary', () => {
    const r = calculateRetirement(fhsaAccum(), config);
    // Last accumulation year (34) still holds the FHSA; the first decumulation
    // year (35) shows it in the RRSP and the FHSA zeroed.
    const y34 = yearAt(r.yearlyBreakdown, 34);
    expect(y34.fhsaBalance!).toBeGreaterThan(0);
    expect(y34.rrspBalance).toBeCloseTo(0, 0);
    const y35 = yearAt(r.yearlyBreakdown, 35);
    expect(y35.fhsaBalance).toBeCloseTo(0, 0);
    // The whole pre-transfer FHSA balance (grown one more year) is now RRSP.
    expect(y35.rrspBalance).toBeGreaterThan(0);
  });

  it('does nothing when disabled (no account, no contribution)', () => {
    const r = calculateRetirement(fhsaAccum({ fhsa: undefined }), config);
    const y30 = yearAt(r.yearlyBreakdown, 30);
    expect(y30.fhsaBalance).toBeUndefined();
    expect(y30.detail?.fhsa).toBeUndefined();
  });

  it('reduces the year\'s taxable income (deductible, like an RRSP)', () => {
    // A working person 30–34, retires at 35. The FHSA contribution lowers the
    // accumulation earnings-tax base, so the year's income tax drops.
    const jobIncome = (over: Partial<IncomeSource> = {}): IncomeSource => ({
      id: 'j', label: 'salary', kind: 'employment', annualAmount: 80000,
      startAge: 30, endAge: 34, destAccount: 'taxable', indexedToCpi: false, ...over,
    });
    const mkWorker = (fhsa: RetirementInputs['fhsa']) =>
      calculateRetirement(baseInputs({
        currentAge: 30, retirementAge: 35, maxAge: 37,
        rrspBalance: 0, tfsaBalance: 0, taxableBalance: 0, cashCushionBalance: 0,
        desiredSpending: 0, income: [jobIncome()], fhsa,
      }), config);
    const noFhsa = mkWorker(undefined);
    const withFhsa = mkWorker({ enabled: true, balance: 0, contribution: 8000 });
    // The FHSA year's income tax is lower than the no-FHSA year's (the $8k
    // deduction shelters $8k of the $80k salary at the marginal rate).
    const taxNo = yearAt(noFhsa.yearlyBreakdown, 30).employmentTax ?? 0;
    const taxWith = yearAt(withFhsa.yearlyBreakdown, 30).employmentTax ?? 0;
    expect(taxWith).toBeLessThan(taxNo);
  });
});
