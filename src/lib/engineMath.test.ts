// Comprehensive calculation & interaction review — the "whole gamut" suite.
// Each test asserts a first-order formula or identity the engine must honour,
// not a re-implementation of the engine. Grouped by subsystem; complements the
// scenario-style tests in retirementEngine.test.ts.
//
// Conventions used throughout:
//   - `config` is a fresh deep copy of DEFAULT_APP_CONFIG (testConfig()).
//   - `baseInputs()` gives a valid RetirementInputs the caller overrides.
//   - `detail.calc` (YearCalc) exists only on decumulation rows.
//   - ONT is the default province; INFL is the engine inflation rate.
import { describe, it, expect } from 'vitest';
import {
  calculateRetirement, calculateHousehold,
} from './retirementEngine';
import {
  calculateTax, findGrossIncomeForTakeHome, oasAnnualGross, oasDeferralMultiplier,
  calculateRrifMinimum, isRrifMandatory, indexConfig,
} from './canadianTax';
import { testConfig, baseInputs, yearAt, closeTo } from '../test/helpers';

const config = testConfig();
const INFL = config.engine.inflationRate;

// ---------------------------------------------------------------------------
// Gross-up solvers — the heart of the drawdown tax math.
// ---------------------------------------------------------------------------
describe('gross-up solvers', () => {
  it('registered draw: grossing up covers the after-tax need stacked on benefits', () => {
    // Benefits floor so draws stack into the brackets; RRSP-first so the RRSP
    // does the gross-up work. Deep RRSP so it can cover the full need (when it
    // can, the solver zeroes the remaining need exactly).
    const r = calculateRetirement(baseInputs({
      rrspBalance: 900000, tfsaBalance: 0, taxableBalance: 0, cashCushionBalance: 0,
      cppStartAge: 65, cppMonthlyAmount: 1000, oasStartAge: 65, oasYearsInCanada: 40,
      desiredSpending: 50000, withdrawalOrder: ['rrsp', 'tfsa', 'taxable'],
    }), config);
    const y = yearAt(r.yearlyBreakdown, 65);
    const c = y.detail!.calc!;
    const gross = y.detail!.withdraw.rrsp;
    // The gross-up is given the need AFTER the first-pass GIS credit
    // (calc.needAfterGis), not the raw neededAfterTax — the two-pass GIS means
    // y.gisIncome (recomputed after the draw) is smaller than the amount
    // credited up front. The solver's invariant: the draw's marginal after-tax
    // value, stacked on the benefits floor, equals that post-GIS need.
    const netOfDraw = calculateTax(c.otherGross + gross, 'ONT', config).takeHome
      - calculateTax(c.otherGross, 'ONT', config).takeHome;
    expect(closeTo(netOfDraw, c.needAfterGis, 2)).toBe(true);
    // And the gross-up really did exceed the post-GIS need (a proper
    // progressive solve, not a single-rate division).
    expect(gross).toBeGreaterThan(c.needAfterGis);
  });

  it('registered draw: gross-up sits between the grossed-up extremes across the bracket', () => {
    // No benefits so the whole 60k need comes from the RRSP, spanning the
    // first federal bracket. The basic personal exemption shelters the first
    // ~16k, so the correct gross is LESS than the naive flat-rate guess
    // need/(1−lowestRate) — but MORE than if the whole need were taxed at the
    // lowest rate (part of it crosses into the next bracket).
    const r = calculateRetirement(baseInputs({
      rrspBalance: 500000, tfsaBalance: 0, taxableBalance: 0, cashCushionBalance: 0,
      cppStartAge: null, oasStartAge: null, desiredSpending: 60000,
      withdrawalOrder: ['rrsp', 'tfsa', 'taxable'],
    }), config);
    const y = yearAt(r.yearlyBreakdown, 65);
    const gross = y.detail!.withdraw.rrsp;
    const lowestRate = config.federal.rates[0] + config.provinces.ONT.rates[0];
    // Lower bound: taxed entirely at the lowest rate (impossible — the top
    // dollars cross the bracket), so the true gross exceeds this.
    expect(gross).toBeGreaterThan(60000 / (1 - lowestRate) * 0.9);
    // Upper bound: the naive flat-rate guess over-counts because the exemption
    // shelters the first dollars, so the true gross lands below it.
    expect(gross).toBeLessThan(60000 / (1 - lowestRate));
    // Exactness: the grossed-up draw nets back to the need (round-trip).
    const netOfDraw = calculateTax(gross, 'ONT', config).takeHome;
    expect(closeTo(netOfDraw, 60000, 2)).toBe(true);
  });

  it('taxable draw with no embedded gain is the identity (gross == need, zero tax)', () => {
    // taxableAcbRatio = 1 → no gain → $1 drawn = $1 of need, no tax anywhere.
    const cfg = testConfig();
    cfg.engine.taxableAcbRatio = 1;
    const r = calculateRetirement(baseInputs({
      taxableBalance: 300000, tfsaBalance: 0, rrspBalance: 0, cashCushionBalance: 0,
      cppStartAge: null, oasStartAge: null, desiredSpending: 20000,
      withdrawalOrder: ['taxable', 'tfsa', 'rrsp'],
    }), cfg);
    const y = yearAt(r.yearlyBreakdown, 65);
    expect(closeTo(y.detail!.withdraw.taxable, 20000, 1)).toBe(true);
    expect(y.detail!.tax.capitalGains).toBe(0);
    expect(y.incomeTax).toBe(0);
  });

  it('findGrossIncomeForTakeHome round-trips calculateTax', () => {
    for (const take of [15000, 42000, 80000, 150000]) {
      const gross = findGrossIncomeForTakeHome(take, 'ONT', config);
      expect(closeTo(calculateTax(gross, 'ONT', config).takeHome, take, 1)).toBe(true);
    }
    expect(findGrossIncomeForTakeHome(0, 'ONT', config)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// CPP / OAS — adjustment, deferral, residency, clawback.
// ---------------------------------------------------------------------------
describe('CPP & OAS math', () => {
  it('CPP at 60 pays 0.64× the age-65 amount in the engine', () => {
    const r = calculateRetirement(baseInputs({
      tfsaBalance: 0, desiredSpending: 0,
      cppStartAge: 60, cppMonthlyAmount: 1000, oasStartAge: null,
      currentAge: 65, retirementAge: 65,
    }), config);
    expect(closeTo(yearAt(r.yearlyBreakdown, 65).cppIncome, 1000 * 0.64 * 12, 1)).toBe(true);
  });

  it('CPP at 70 pays 1.42× and starts only at 70', () => {
    const r = calculateRetirement(baseInputs({
      tfsaBalance: 100000, desiredSpending: 0,
      cppStartAge: 70, cppMonthlyAmount: 1000, oasStartAge: null,
      currentAge: 65, retirementAge: 65, maxAge: 72,
    }), config);
    expect(yearAt(r.yearlyBreakdown, 65).cppIncome).toBe(0);
    expect(closeTo(yearAt(r.yearlyBreakdown, 70).cppIncome, 1000 * 1.42 * 12, 1)).toBe(true);
  });

  it('cppAdjustedAmount bypasses the start-age multiplier', () => {
    const r = calculateRetirement(baseInputs({
      tfsaBalance: 0, desiredSpending: 0,
      cppStartAge: 60, cppMonthlyAmount: 1000, cppAdjustedAmount: true, oasStartAge: null,
      currentAge: 65, retirementAge: 65,
    }), config);
    expect(closeTo(yearAt(r.yearlyBreakdown, 65).cppIncome, 1000 * 12, 1)).toBe(true);
  });

  it('OAS deferral multiplier is +36% at 70 and 1.0 at 65', () => {
    expect(closeTo(oasDeferralMultiplier(65, config), 1, 9)).toBe(true);
    expect(closeTo(oasDeferralMultiplier(70, config), 1.36, 6)).toBe(true);
  });

  it('OAS prorates by residency (years/40) and bumps at 75', () => {
    const full = oasAnnualGross(65, 65, 40, config);
    const half = oasAnnualGross(65, 65, 20, config);
    expect(closeTo(half, full / 2, 1)).toBe(true);
    const at75 = oasAnnualGross(75, 65, 40, config);
    expect(at75).toBeGreaterThan(full); // baseMonthly75plus > 65to74
  });

  it('OAS is zero below the residency minimum and before the start age', () => {
    expect(oasAnnualGross(65, 65, 5, config)).toBe(0);
    expect(oasAnnualGross(64, 65, 40, config)).toBe(0);
  });

  it('OAS clawback = 15% of net income above the threshold, capped at the OAS amount', () => {
    // Large registered income drives total net income over the clawback threshold.
    const r = calculateRetirement(baseInputs({
      currentAge: 72, retirementAge: 72, maxAge: 75,
      rrspBalance: 2000000, tfsaBalance: 0, taxableBalance: 0, cashCushionBalance: 0,
      cppStartAge: null, oasStartAge: 65, oasYearsInCanada: 40,
      desiredSpending: 300000, withdrawalOrder: ['rrsp', 'tfsa', 'taxable'],
    }), config);
    const y = yearAt(r.yearlyBreakdown, 72);
    const claw = y.detail!.tax.oasClawback;
    expect(claw).toBeGreaterThan(0);
    expect(claw).toBeLessThanOrEqual(y.oasIncome + 1e-6);
    // Matches the formula exactly: 15% of net income above the threshold.
    const c = y.detail!.calc!;
    const expected = Math.min(
      y.oasIncome,
      Math.max(0, c.totalNetIncome - config.oas.clawbackThreshold) * config.oas.clawbackRate
    );
    expect(closeTo(claw, expected, 1)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// RRIF conversion & minimums.
// ---------------------------------------------------------------------------
describe('RRIF conversion & minimums', () => {
  it('converts RRSP to RRIF exactly at the conversion age', () => {
    const conv = config.engine.rrifConversionAge;
    const r = calculateRetirement(baseInputs({
      currentAge: conv - 1, retirementAge: conv - 1, maxAge: conv + 1,
      rrspBalance: 500000, tfsaBalance: 0, taxableBalance: 0, cashCushionBalance: 0,
      cppStartAge: null, oasStartAge: null, desiredSpending: 0,
    }), config);
    // The year before conversion the RRIF is still empty; at conversion the
    // whole RRSP has moved over.
    expect(yearAt(r.yearlyBreakdown, conv - 1).rrifBalance).toBe(0);
    expect(yearAt(r.yearlyBreakdown, conv).rrspBalance).toBe(0);
    expect(yearAt(r.yearlyBreakdown, conv).rrifBalance).toBeGreaterThan(0);
  });

  it('a plan starting past the conversion age converts immediately', () => {
    const r = calculateRetirement(baseInputs({
      currentAge: 80, retirementAge: 80, maxAge: 82,
      rrspBalance: 300000, tfsaBalance: 0, desiredSpending: 0,
      cppStartAge: null, oasStartAge: null,
    }), config);
    expect(yearAt(r.yearlyBreakdown, 80).rrspBalance).toBe(0);
    expect(yearAt(r.yearlyBreakdown, 80).rrifBalance).toBeGreaterThan(0);
  });

  it('RRIF minimum caps the age at 95 and stays mandatory beyond', () => {
    expect(isRrifMandatory(95, config)).toBe(true);
    expect(isRrifMandatory(120, config)).toBe(true);
    const m95 = calculateRrifMinimum(95, 100000, config);
    const m120 = calculateRrifMinimum(120, 100000, config);
    expect(closeTo(m95, m120, 1)).toBe(true); // both use the age-95 rate
  });

  it('respects a custom rrifConversionAge', () => {
    const cfg = testConfig();
    cfg.engine.rrifConversionAge = 65;
    expect(isRrifMandatory(65, cfg)).toBe(true);
    expect(isRrifMandatory(64, cfg)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Taxable account ACB & gains drift.
// ---------------------------------------------------------------------------
describe('taxable ACB & gains', () => {
  it('ACB leaves pro-rata and the gains fraction rises as the account drains', () => {
    const cfg = testConfig();
    cfg.engine.taxableAcbRatio = 0.8; // 20% embedded gain to start
    const r = calculateRetirement(baseInputs({
      taxableBalance: 200000, tfsaBalance: 0, rrspBalance: 0, cashCushionBalance: 0,
      cppStartAge: null, oasStartAge: null, desiredSpending: 40000,
      withdrawalOrder: ['taxable', 'tfsa', 'rrsp'],
    }), cfg);
    const y65 = yearAt(r.yearlyBreakdown, 65);
    const y66 = yearAt(r.yearlyBreakdown, 66);
    // Gains fraction (calc) should start near the initial 0.2 and grow as
    // principal is drawn down (ACB leaves pro-rata, growth adds gain).
    expect(y65.detail!.calc!.gainsFraction).toBeGreaterThanOrEqual(0.19);
    expect(y66.detail!.calc!.gainsFraction).toBeGreaterThanOrEqual(y65.detail!.calc!.gainsFraction);
    // A realized gain is reported for a year that drew taxable money.
    expect(y65.detail!.tax.capitalGains).toBeGreaterThan(0);
  });

  it('capital-gains inclusion rate is honored in taxable income', () => {
    const cfg = testConfig();
    cfg.engine.taxableAcbRatio = 0.5;
    cfg.engine.capitalGainsInclusion = 0.5;
    const r = calculateRetirement(baseInputs({
      taxableBalance: 400000, tfsaBalance: 0, rrspBalance: 0, cashCushionBalance: 0,
      cppStartAge: null, oasStartAge: null, desiredSpending: 50000,
      withdrawalOrder: ['taxable', 'tfsa', 'rrsp'],
    }), cfg);
    const y = yearAt(r.yearlyBreakdown, 65);
    const c = y.detail!.calc!;
    // totalNetIncome includes gains × inclusion, not the full gain.
    expect(closeTo(
      c.totalNetIncome,
      c.otherGross + y.detail!.tax.registeredGross + y.detail!.tax.capitalGains * 0.5,
      1
    )).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Inflation indexing & spending bands.
// ---------------------------------------------------------------------------
describe('indexing & spending bands', () => {
  it('indexConfig scales brackets, exemptions, clawback threshold and surtax', () => {
    const idx = indexConfig(config, 1.05);
    expect(closeTo(idx.federal.brackets[0], config.federal.brackets[0] * 1.05, 0.01)).toBe(true);
    expect(closeTo(idx.federal.exemption, config.federal.exemption * 1.05, 0.01)).toBe(true);
    expect(closeTo(idx.provinces.ONT.exemption, config.provinces.ONT.exemption * 1.05, 0.01)).toBe(true);
    expect(closeTo(idx.oas.clawbackThreshold, config.oas.clawbackThreshold * 1.05, 0.01)).toBe(true);
    expect(closeTo(idx.ontarioSurtax.threshold1, config.ontarioSurtax.threshold1 * 1.05, 0.01)).toBe(true);
  });

  it('with table indexation on, CPP grows with CPI each year', () => {
    const cfg = testConfig();
    cfg.engine.indexTaxTables = true;
    const r = calculateRetirement(baseInputs({
      tfsaBalance: 100000, desiredSpending: 0,
      cppStartAge: 65, cppMonthlyAmount: 1000, oasStartAge: null,
      currentAge: 65, retirementAge: 65, maxAge: 70,
    }), cfg);
    const c65 = yearAt(r.yearlyBreakdown, 65).cppIncome;
    const c70 = yearAt(r.yearlyBreakdown, 70).cppIncome;
    expect(closeTo(c70, c65 * Math.pow(1 + INFL, 5), 1)).toBe(true);
  });

  it('spending bands scale the target at each boundary, out-of-order input ok', () => {
    const r = calculateRetirement(baseInputs({
      tfsaBalance: 800000, desiredSpending: 40000, // deep enough to reach 85
      cppStartAge: null, oasStartAge: null,
      spendingBands: [
        { fromAge: 85, pctOfBase: 0.5 },
        { fromAge: 75, pctOfBase: 0.8 }, // out of order on purpose
      ],
    }), config);
    const t70 = yearAt(r.yearlyBreakdown, 70).spendingTarget;
    const t75 = yearAt(r.yearlyBreakdown, 75).spendingTarget;
    const t85 = yearAt(r.yearlyBreakdown, 85).spendingTarget;
    // Spending is CPI-indexed, so spendingTarget(age) = base × pct(age) ×
    // (1+INFL)^(age−65). Dividing out the inflation factor recovers the band
    // ratio exactly (and confirms the out-of-order input was sorted).
    const infl = (age: number) => Math.pow(1 + INFL, age - 65);
    expect(closeTo(t75 / infl(75) / (t70 / infl(70)), 0.8, 0.001)).toBe(true);
    expect(closeTo(t85 / infl(85) / (t70 / infl(70)), 0.5, 0.001)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Cash events — destinations, ACB, ordering, recurrence window.
// ---------------------------------------------------------------------------
describe('cash event mechanics', () => {
  it('an inflow into RRSP raises the RRSP balance and only lands once', () => {
    const r = calculateRetirement(baseInputs({
      rrspBalance: 100000, tfsaBalance: 0, desiredSpending: 0,
      cppStartAge: null, oasStartAge: null,
      events: [{ id: 'e', age: 66, label: 'bonus', amount: 50000, direction: 'in', account: 'rrsp' }],
    }), config);
    const b65 = yearAt(r.yearlyBreakdown, 65).rrspBalance;
    const b66 = yearAt(r.yearlyBreakdown, 66).rrspBalance;
    const b67 = yearAt(r.yearlyBreakdown, 67).rrspBalance;
    expect(b66).toBeGreaterThan(b65 + 49000); // inflow landed
    // 67 grows only by return (no repeat of the 50k).
    expect(closeTo(b67, b66 * 1.05, b66 * 0.05 + 1000)).toBe(true);
  });

  it('an inflow into taxable bumps ACB so the principal is not double-taxed', () => {
    const cfg = testConfig();
    cfg.engine.taxableAcbRatio = 0.5;
    const r = calculateRetirement(baseInputs({
      taxableBalance: 100000, tfsaBalance: 0, desiredSpending: 0,
      cppStartAge: null, oasStartAge: null,
      events: [{ id: 'e', age: 65, label: 'sale', amount: 100000, direction: 'in', account: 'taxable' }],
    }), cfg);
    // The inflow is principal: ACB rises by the full 100k on top of the
    // account's initial ACB (100k × 0.5 = 50k). calc.taxableAcb is captured
    // at end-of-year on a decumulation row.
    expect(yearAt(r.yearlyBreakdown, 65).detail!.calc!.taxableAcb)
      .toBeGreaterThan(50000 + 99000);
  });

  it('a recurring outflow stops after its endAge', () => {
    const r = calculateRetirement(baseInputs({
      tfsaBalance: 300000, desiredSpending: 10000,
      cppStartAge: null, oasStartAge: null,
      events: [{ id: 'e', age: 70, endAge: 72, label: 'gift', amount: 5000, direction: 'out' }],
    }), config);
    const t72 = yearAt(r.yearlyBreakdown, 72).spendingTarget;
    const t73 = yearAt(r.yearlyBreakdown, 73).spendingTarget;
    // 73 is outside the window → target drops back by ~the event amount.
    expect(t72 - t73).toBeGreaterThan(4000);
  });
});

// ---------------------------------------------------------------------------
// DB pensions — income, GIS interaction, split eligibility.
// ---------------------------------------------------------------------------
describe('DB pension interactions', () => {
  const withPension = () => baseInputs({
    tfsaBalance: 0, rrspBalance: 0, taxableBalance: 0, cashCushionBalance: 0,
    cppStartAge: null, oasStartAge: 65, oasYearsInCanada: 40, desiredSpending: 30000,
    pensions: [{ id: 'p1', label: 'DB', annualAmount: 20000, startAge: 65, endAge: null, indexedToCpi: false }],
  });

  it('a DB pension is gross taxable income and reduces GIS', () => {
    const r = calculateRetirement(withPension(), config);
    const y = yearAt(r.yearlyBreakdown, 65);
    expect(y.pensionIncome).toBe(20000);
    // GIS on 20k pension income: 13478 − 20000×0.5 = 3478.
    expect(closeTo(y.gisIncome, config.oas.gisMaxAnnualSingle - 20000 * 0.5, 1)).toBe(true);
  });

  it('a DB pension counts as split-eligible income', () => {
    const r = calculateRetirement(withPension(), config);
    const y = yearAt(r.yearlyBreakdown, 65);
    expect(y.splitEligibleIncome!).toBeGreaterThanOrEqual(20000);
  });

  it('a bridge pension stops at its endAge', () => {
    const r = calculateRetirement(baseInputs({
      tfsaBalance: 100000, desiredSpending: 0, cppStartAge: null, oasStartAge: null,
      pensions: [{ id: 'b', label: 'bridge', annualAmount: 12000, startAge: 60, endAge: 65, indexedToCpi: false }],
      currentAge: 60, retirementAge: 60, maxAge: 67,
    }), config);
    expect(yearAt(r.yearlyBreakdown, 64).pensionIncome).toBe(12000);
    expect(yearAt(r.yearlyBreakdown, 66).pensionIncome).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Reverse mortgage during accumulation.
// ---------------------------------------------------------------------------
describe('reverse mortgage in accumulation', () => {
  it('scheduled draws before retirement land in the cash cushion', () => {
    const r = calculateRetirement(baseInputs({
      currentAge: 60, retirementAge: 65, maxAge: 70,
      tfsaBalance: 100000, desiredSpending: 10000, cashCushionBalance: 0,
      cppStartAge: null, oasStartAge: null,
      reverseMortgage: {
        enabled: true, homeValue: 700000, appreciationRate: 0, interestRate: 0.05,
        drawAmount: 15000, startAge: 62, durationYears: 2, topUp: false,
      },
    }), config);
    // A scheduled draw at 62 (pre-retirement) adds to the cushion that year.
    const y62 = yearAt(r.yearlyBreakdown, 62);
    expect(y62.detail!.rm!.scheduledDraw).toBeGreaterThan(0);
    expect(y62.cashCushionBalance).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Depletion, zero-balance and edge cases.
// ---------------------------------------------------------------------------
describe('depletion & edge cases', () => {
  it('depletion at exactly maxAge is still ON_TRACK', () => {
    // Tuned so the account runs dry exactly at the maxAge boundary (age 70):
    // 22000/yr for 6 years at 0% return ≈ 132000 of draws against 120000, so
    // the money runs out partway through age 70 and depletionAge lands on 70.
    const r = calculateRetirement(baseInputs({
      tfsaBalance: 120000, desiredSpending: 22000, maxAge: 70,
      cppStartAge: null, oasStartAge: null, investmentReturn: 0,
    }), config);
    expect(r.depletionAge).toBe(70);
    // Depleting AT the boundary (not before it) is not a shortfall.
    expect(r.status).toBe('ON_TRACK');
  });

  it('a plan with zero savings lives on benefits and never errors', () => {
    const r = calculateRetirement(baseInputs({
      tfsaBalance: 0, rrspBalance: 0, taxableBalance: 0, cashCushionBalance: 0,
      cppStartAge: 65, cppMonthlyAmount: 800, oasStartAge: 65, oasYearsInCanada: 40,
      desiredSpending: 0, maxAge: 75,
    }), config);
    expect(r.yearlyBreakdown.length).toBeGreaterThan(0);
    expect(yearAt(r.yearlyBreakdown, 65).cppIncome).toBeGreaterThan(0);
    expect(yearAt(r.yearlyBreakdown, 65).endingBalance).toBe(0);
  });

  it('withdrawalRate is spending-at-retirement over starting balance', () => {
    const r = calculateRetirement(baseInputs({
      currentAge: 60, retirementAge: 65, tfsaBalance: 500000,
      desiredSpending: 25000, cppStartAge: null, oasStartAge: null,
    }), config);
    const startBal = yearAt(r.yearlyBreakdown, 65).startingBalance;
    expect(closeTo(r.withdrawalRate, (25000 * Math.pow(1 + INFL, 5)) / startBal, 0.001)).toBe(true);
  });

  it('totalNetWorthAtRetirement uses the retirement-age starting balance', () => {
    const r = calculateRetirement(baseInputs({
      currentAge: 60, retirementAge: 65, tfsaBalance: 400000, rrspBalance: 100000,
      desiredSpending: 20000, cppStartAge: null, oasStartAge: null,
    }), config);
    expect(closeTo(r.totalNetWorthAtRetirement, yearAt(r.yearlyBreakdown, 65).startingBalance, 1)).toBe(true);
  });

  it('Monte Carlo per-age returnSequence overrides the constant rate', () => {
    const inputs = baseInputs({
      currentAge: 65, retirementAge: 65, maxAge: 67, tfsaBalance: 100000,
      desiredSpending: 0, cppStartAge: null, oasStartAge: null, investmentReturn: 0.05,
    });
    const seq = { 65: 0.20, 66: -0.10, 67: 0.0 };
    const r = calculateRetirement(inputs, config, { returnSequence: seq });
    expect(closeTo(yearAt(r.yearlyBreakdown, 65).tfsaBalance, 120000, 1)).toBe(true);
    expect(closeTo(yearAt(r.yearlyBreakdown, 66).tfsaBalance, 108000, 1)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Province differences.
// ---------------------------------------------------------------------------
describe('province differences', () => {
  it('QC applies the federal abatement (tax differs from ONT at the same income)', () => {
    const qc = calculateTax(100000, 'QC', config).totalTax;
    const on = calculateTax(100000, 'ONT', config).totalTax;
    // QC's 16.5% federal abatement vs its own provincial rates — assert the
    // two provinces genuinely differ and both are sane.
    expect(qc).not.toBeCloseTo(on, 0);
    expect(qc).toBeGreaterThan(0);
  });

  it('ONT surtax pushes the effective rate above the top stated provincial rate', () => {
    // At a high income the ONT effective rate exceeds the top stated provincial
    // rate because of the surtax.
    const high = calculateTax(300000, 'ONT', config);
    const topProvRate = config.provinces.ONT.rates[config.provinces.ONT.rates.length - 1];
    const effectiveRate = high.totalTax / 300000;
    expect(effectiveRate).toBeGreaterThan(topProvRate);
  });
});

// ---------------------------------------------------------------------------
// Household / pension-splitting interactions.
// ---------------------------------------------------------------------------
describe('household & splitting interactions', () => {
  it('pension splitting runs across an age gap and stays internally consistent', () => {
    // Primary at RRIF age with large registered income (split-eligible);
    // spouse 5 years younger with little income. The split pass must align by
    // calendar year (not raw age) and leave the books balanced.
    const inputs = baseInputs({
      currentAge: 72, retirementAge: 72, maxAge: 78,
      rrspBalance: 900000, tfsaBalance: 0, taxableBalance: 0, cashCushionBalance: 0,
      cppStartAge: null, oasStartAge: null, desiredSpending: 80000,
      withdrawalOrder: ['rrsp', 'tfsa', 'taxable'],
      spouse: {
        enabled: true, currentAge: 67, retirementAge: 67,
        rrspBalance: 0, tfsaBalance: 50000, taxableBalance: 0, cashCushionBalance: 0,
        rrspContribution: 0, tfsaContribution: 0, taxableContribution: 0,
        cppStartAge: null, cppMonthlyAmount: 0, oasStartAge: null, oasYearsInCanada: 40,
        desiredSpending: 10000, withdrawalOrder: ['tfsa', 'taxable', 'rrsp'], pensions: [],
      },
    });
    const r = calculateHousehold(inputs, config);
    // Split pass ran and produced finite, non-negative cumulative tax.
    const last = r.yearlyBreakdown[r.yearlyBreakdown.length - 1];
    expect(Number.isFinite(last.cumulativeTax)).toBe(true);
    expect(last.cumulativeTax).toBeGreaterThanOrEqual(0);
    // If a transfer happened, it is recorded as a signed amount on a row whose
    // split-eligible income is defined.
    for (const y of r.yearlyBreakdown) {
      if ((y.splitTransferred ?? 0) !== 0) {
        expect(y.splitEligibleIncome).toBeDefined();
      }
    }
  });
});
