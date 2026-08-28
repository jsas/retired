import { describe, it, expect } from 'vitest';
import { runStrategies } from './strategies';
import { testConfig, baseInputs } from '../test/helpers';

const config = testConfig();

// Lower-income retiree with a meaningful RRSP: withdrawal order and CPP/OAS
// timing move lifetime GIS a lot, so the metric must discriminate.
const gisSensitive = () => baseInputs({
  currentAge: 64, retirementAge: 65, maxAge: 90,
  rrspBalance: 200000, tfsaBalance: 200000, taxableBalance: 0,
  cppStartAge: 65, cppMonthlyAmount: 400, oasStartAge: 65, oasYearsInCanada: 40,
  desiredSpending: 26000, pensions: [],
});

describe('runStrategies', () => {
  it('always includes the current plan as the baseline', () => {
    const report = runStrategies(gisSensitive(), config);
    expect(report.baseline.id).toBe('baseline');
    expect(report.baseline.lifetimeTax).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(report.baseline.lifetimeGis)).toBe(true);
  });

  it('explores the six withdrawal orders (minus the current one)', () => {
    const report = runStrategies(gisSensitive(), config);
    const orders = report.strategies.filter(s => s.id.startsWith('order-'));
    expect(orders.length).toBe(5); // 6 permutations − current order
  });

  it('lifetime GIS varies by withdrawal order (the metric discriminates)', () => {
    const report = runStrategies(gisSensitive(), config);
    const orders = report.strategies.filter(s => s.id.startsWith('order-'));
    const gisValues = new Set(orders.map(o => Math.round(o.lifetimeGis)));
    expect(gisValues.size).toBeGreaterThan(1);
  });

  it('draw order changes lifetime GIS (income counted in-year, not deferred)', () => {
    // With GIS assessed on in-year income (the fix), a strategy that draws
    // taxable income during OAS years claws GIS back immediately — so order
    // matters, and drawing the RRSP down alongside OAS (rrsp-first here) does
    // NOT beat sheltering it behind TFSA-first on this fixture. The point of
    // the metric is that it discriminates; the direction follows the math.
    const report = runStrategies(gisSensitive(), config);
    const orders = report.strategies.filter(s => s.id.startsWith('order-'));
    const rrspFirst = orders.filter(o => o.id.startsWith('order-rrsp'));
    const tfsaFirst = orders.filter(o => o.id.startsWith('order-tfsa'));
    const bestRrsp = Math.max(...rrspFirst.map(o => o.lifetimeGis));
    const bestTfsa = Math.max(...tfsaFirst.map(o => o.lifetimeGis));
    expect(bestTfsa).toBeGreaterThan(bestRrsp);
  });

  it('sustainable spending is non-negative and delta is measured vs baseline', () => {
    const report = runStrategies(gisSensitive(), config);
    expect(report.baseline.sustainableSpending).toBeGreaterThanOrEqual(0);
    for (const s of report.strategies) {
      expect(s.deltaSpending).toBeCloseTo(s.sustainableSpending - report.baseline.sustainableSpending, 6);
    }
  });

  it('suggests a most-GIS-preserved option when one beats the baseline by >$1k', () => {
    const report = runStrategies(gisSensitive(), config);
    const bestGis = Math.max(...report.strategies.map(s => s.lifetimeGis));
    const mentions = report.suggestedActions.some(a => a.includes('Most GIS preserved'));
    expect(mentions).toBe(bestGis > report.baseline.lifetimeGis + 1000);
  });
});

// Homeowner with home equity recorded but RM not yet enabled: the optimizer
// should explore turning it on at several start ages and draw sizes.
const rmHomeowner = () => baseInputs({
  currentAge: 65, retirementAge: 65, maxAge: 95,
  rrspBalance: 0, tfsaBalance: 150000, taxableBalance: 0,
  cppStartAge: 65, cppMonthlyAmount: 700, oasStartAge: 65, oasYearsInCanada: 40,
  desiredSpending: 40000, pensions: [],
  reverseMortgage: { enabled: false, homeValue: 700000, appreciationRate: 0.02, interestRate: 0.065, maxLtv: 0.55 },
});

describe('runStrategies — reverse mortgage timing', () => {
  it('explores RM start ages and draw sizes when a home value is recorded', () => {
    const report = runStrategies(rmHomeowner(), config);
    const rmStrats = report.strategies.filter(s => s.id.startsWith('rm-'));
    // startAge ∈ {65, 70, 75} × two draw sizes; all are inside the horizon.
    expect(rmStrats.length).toBe(6);
    expect(new Set(rmStrats.map(s => s.patch.reverseMortgage?.startAge))).toEqual(new Set([65, 70, 75]));
    expect(rmStrats.every(s => (s.patch.reverseMortgage?.drawAmount ?? 0) > 0)).toBe(true);
    expect(rmStrats.every(s => s.patch.reverseMortgage?.enabled)).toBe(true);
  });

  it('skips RM variants entirely when no home value is recorded (never invents equity)', () => {
    const report = runStrategies(gisSensitive(), config); // no reverseMortgage at all
    expect(report.strategies.filter(s => s.id.startsWith('rm-')).length).toBe(0);
  });

  it('RM variants can beat the no-RM baseline on sustainable spending', () => {
    const report = runStrategies(rmHomeowner(), config);
    const rmStrats = report.strategies.filter(s => s.id.startsWith('rm-'));
    expect(Math.max(...rmStrats.map(s => s.sustainableSpending)))
      .toBeGreaterThan(report.baseline.sustainableSpending);
  });

  it('suggests an RM strategy in plain language when one beats the baseline by >$500', () => {
    const report = runStrategies(rmHomeowner(), config);
    const rmStrats = report.strategies.filter(s => s.id.startsWith('rm-'));
    const best = Math.max(...rmStrats.map(s => s.deltaSpending));
    const mentions = report.suggestedActions.some(a => a.includes('Reverse mortgage'));
    expect(mentions).toBe(best > 500);
  });

  it('offers the top-up backstop when RM is enabled without top-up', () => {
    const inputs = rmHomeowner();
    inputs.reverseMortgage = { ...inputs.reverseMortgage!, enabled: true, drawAmount: 8000, startAge: 70, topUp: false };
    const report = runStrategies(inputs, config);
    expect(report.strategies.some(s => s.id === 'rm-topup' && s.patch.reverseMortgage?.topUp === true)).toBe(true);
  });

  it('does not duplicate the RM setup the user already runs', () => {
    const inputs = rmHomeowner();
    inputs.reverseMortgage = { ...inputs.reverseMortgage!, enabled: true, drawAmount: 16000, startAge: 65, topUp: true };
    const report = runStrategies(inputs, config);
    expect(report.strategies.filter(s => s.id === 'rm-65-16000').length).toBe(0);
    expect(report.strategies.filter(s => s.id === 'rm-topup').length).toBe(0); // already on
  });
});

describe('work strategies (employment, issue #22)', () => {
  // A modest plan with clear early-retirement withdrawal pressure.
  const worker = () => baseInputs({
    currentAge: 65, retirementAge: 65, maxAge: 90,
    rrspBalance: 300000, tfsaBalance: 100000, taxableBalance: 0,
    cppStartAge: 70, cppMonthlyAmount: 800, oasStartAge: 70, oasYearsInCanada: 40,
    desiredSpending: 40000, pensions: [],
  });

  it('offers fixed part-time work variants', () => {
    const report = runStrategies(worker(), config);
    const jobs = report.strategies.filter(s => s.id.startsWith('work-') && !s.id.startsWith('work-gap'));
    expect(jobs.length).toBeGreaterThanOrEqual(2);
    // Each adds an employment row on top of the existing (empty) list.
    for (const j of jobs) {
      expect(Array.isArray(j.patch.employment)).toBe(true);
      expect(j.patch.employment!.length).toBe(1);
      expect(j.patch.employment![0].topUpSpending).toBe(true);
    }
  });

  it('a work stint supports at least as much spending as the baseline', () => {
    const report = runStrategies(worker(), config);
    const jobs = report.strategies.filter(s => s.id.startsWith('work-10k'));
    expect(jobs.length).toBe(1);
    expect(jobs[0].sustainableSpending).toBeGreaterThanOrEqual(report.baseline.sustainableSpending);
  });

  it('suggested work stints save to taxable (no room tracking yet, issue #24)', () => {
    const report = runStrategies(worker(), config);
    const jobs = report.strategies.filter(s => s.id.startsWith('work-'));
    expect(jobs.length).toBeGreaterThan(0);
    for (const j of jobs) {
      expect(j.patch.employment![0].destAccount).toBe('taxable');
    }
  });

  it('skips a fixed variant already in the plan', () => {
    const inputs = worker();
    inputs.employment = [{
      id: 'mine', label: 'my job', annualAmount: 10000, startAge: 65, endAge: 70,
      destAccount: 'tfsa', topUpSpending: true, indexedToCpi: false,
    }];
    const report = runStrategies(inputs, config);
    expect(report.strategies.filter(s => s.id === 'work-10k-65-70').length).toBe(0);
  });

  it('adds a gap-targeted stint when the plan runs a shortfall', () => {
    const inputs = worker();
    inputs.desiredSpending = 90000; // far beyond the portfolio → depletes
    const report = runStrategies(inputs, config);
    const gap = report.strategies.filter(s => s.id.startsWith('work-gap'));
    expect(gap.length).toBe(1);
    const job = gap[0].patch.employment![0];
    expect(job.topUpSpending).toBe(true);
    expect(job.annualAmount).toBeGreaterThan(0);
    expect(job.startAge).toBeLessThanOrEqual(job.endAge);
  });

  it('no gap-targeted stint when the plan is healthy', () => {
    const inputs = worker();
    inputs.desiredSpending = 10000; // comfortably funded → never depletes
    const report = runStrategies(inputs, config);
    expect(report.strategies.filter(s => s.id.startsWith('work-gap')).length).toBe(0);
  });
});
