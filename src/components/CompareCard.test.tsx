// @vitest-environment node
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { baseInputs, testConfig } from '../../packages/engine-core/test/helpers';
import { CompareCard } from './CompareCard';

const config = testConfig();
const mk = (id: string, name: string, spend: number) => ({
  id, name, createdAt: '', updatedAt: '',
  inputs: baseInputs({ currentAge: 50, retirementAge: 62, maxAge: 95, desiredSpending: spend, tfsaBalance: 400000, rrspBalance: 300000 }),
});
const scenarios = [mk('a', 'Retire Together', 60000), mk('b', 'Pierre', 90000), mk('c', 'Lean', 40000)];

describe('CompareCard', () => {
  it('draws one timeline with a line and legend entry per scenario — no cap', () => {
    const html = renderToStaticMarkup(
      createElement(CompareCard, { scenarios, activeScenarioId: 'a', config }),
    );
    // All three scenarios on the timeline (no "pick up to 3").
    for (const name of ['Retire Together', 'Pierre', 'Lean']) expect(html, name).toContain(name);
    // The legend + the numbers table.
    expect(html).toContain('toggle lines in the legend');
    for (const col of ['Wealth at retirement', 'Depletion age', 'Withdrawal rate', 'Lifetime tax', 'Ending balance']) {
      expect(html, col).toContain(col);
    }
  });

  it('has no baseline-dot ritual or max-compare cap', () => {
    const html = renderToStaticMarkup(
      createElement(CompareCard, { scenarios, activeScenarioId: 'a', config }),
    );
    expect(html).not.toContain('Set as baseline');
    expect(html).not.toContain('of 3 scenarios');
  });

  it('says so when there is nothing to compare', () => {
    const html = renderToStaticMarkup(
      createElement(CompareCard, { scenarios: [], activeScenarioId: '', config }),
    );
    expect(html).toContain('Save a couple of scenarios first');
  });
});
