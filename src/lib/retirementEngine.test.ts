import { describe, it, expect } from 'vitest';
import { calculateRetirement, calculateHousehold, combineHouseholdBreakdown, householdOutcome } from './retirementEngine';
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
      desiredSpending: 0, pensions: [],
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
});

describe('pensions', () => {
  it('lifetime pension pays every year from startAge', () => {
    const r = calculateRetirement(baseInputs({
      cppStartAge: 65, cppMonthlyAmount: 0, oasStartAge: null,
      pensions: [{ id: 'p1', label: 'DB', annualAmount: 12000, startAge: 65, endAge: null, indexedToCpi: false }],
    }), config);
    expect(yearAt(r.yearlyBreakdown, 65).pensionIncome).toBeCloseTo(12000, 6);
    expect(yearAt(r.yearlyBreakdown, 80).pensionIncome).toBeCloseTo(12000, 6);
  });

  it('bridge pension stops after endAge', () => {
    const r = calculateRetirement(baseInputs({
      pensions: [{ id: 'b', label: 'bridge', annualAmount: 10000, startAge: 65, endAge: 69, indexedToCpi: false }],
    }), config);
    expect(yearAt(r.yearlyBreakdown, 69).pensionIncome).toBeCloseTo(10000, 6);
    expect(yearAt(r.yearlyBreakdown, 70).pensionIncome).toBe(0);
  });

  it('non-indexed pension stays flat; indexed grows with CPI when tables index', () => {
    const c = testConfig();
    c.engine.indexTaxTables = true;
    const r = calculateRetirement(baseInputs({ pensions: [
      { id: 'f', label: 'flat', annualAmount: 10000, startAge: 65, endAge: null, indexedToCpi: false },
      { id: 'i', label: 'idx', annualAmount: 10000, startAge: 65, endAge: null, indexedToCpi: true },
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
    pensions: [{ id: 'db', label: 'DB', annualAmount: 8000, startAge: 72, endAge: null, indexedToCpi: false }],
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
      desiredSpending: 20000, pensions: [],
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
      desiredSpending: 10000, pensions: [],
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
        desiredSpending: 40000, pensions: [],
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
        desiredSpending: 5000, pensions: [],
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
      desiredSpending: 25000, pensions: [],
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
        desiredSpending: 10000, pensions: [],
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
      desiredSpending: 25000, pensions: [],
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
        desiredSpending: 60000, pensions: [],
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
        withdrawalOrder: ['tfsa', 'taxable', 'rrsp'], pensions: [],
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
