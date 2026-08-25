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
