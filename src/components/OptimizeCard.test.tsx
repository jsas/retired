// @vitest-environment node
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { baseInputs, testConfig } from '../../packages/engine-core/test/helpers';
import { runStrategies } from '@retired/engine-core/strategies';
import { StrategyExplorer } from './OptimizeCard';

const config = testConfig();
const inputs = baseInputs({
  currentAge: 64, retirementAge: 65, maxAge: 90,
  rrspBalance: 200000, tfsaBalance: 200000, taxableBalance: 0,
  cppStartAge: 65, cppMonthlyAmount: 400, oasStartAge: 65, oasYearsInCanada: 40,
  desiredSpending: 26000, income: [],
});

describe('StrategyExplorer', () => {
  it('defaults to only the variants that add money, with Current plan always listed', () => {
    const report = runStrategies(inputs, config);
    const winners = report.strategies.filter(s => s.deltaSpending > 0);
    expect(winners.length).toBeGreaterThan(0);
    expect(report.strategies.length).toBeGreaterThan(winners.length);

    const html = renderToStaticMarkup(
      createElement(StrategyExplorer, { inputs, config, onApply: () => {} }),
    );
    expect(html).toContain('Only show things that add money');
    expect(html).toContain('Current plan');
    expect(html).toMatch(/type="checkbox"/);
    expect(html).toMatch(/\schecked[=/\s>]/);
    for (const s of winners) expect(html, s.name).toContain(s.name);
    // One Apply button per winning row (Current plan has none). Suggested
    // actions above the table may still name a loser, so don't assert names
    // are absent from the whole card.
    expect((html.match(/hover:border-slate-900 hover:text-slate-900/g) ?? []).length).toBe(winners.length);
  });
});
