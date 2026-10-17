// @vitest-environment node
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { baseInputs, testConfig } from '../../packages/engine-core/test/helpers';
import { CompareCard } from './CompareCard';
import type { Scenario } from '@retired/engine-core/types';

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

  it('keeps every scenario in the legend (hiding a line must leave a click target to restore it)', () => {
    const html = renderToStaticMarkup(
      createElement(CompareCard, { scenarios, activeScenarioId: 'a', config }),
    );
    // Each name is a legend button AND a table cell — the legend is built from
    // the full series list, not the currently-visible subset. Filtering that
    // list would remove the only control that could turn a hidden line back on.
    for (const name of ['Retire Together', 'Pierre', 'Lean']) {
      expect((html.match(new RegExp(name, 'g')) ?? []).length, name).toBeGreaterThanOrEqual(2);
    }
    expect(html).toMatch(/<button[^>]*>[\s\S]*Retire Together/);
  });

  it('lists every scenario in the table (hide is opt-out, so a later-loaded plan still has a row)', () => {
    // The old opt-in Set was frozen at first paint: a refresh that first
    // rendered 2 plans then hydrated the rest left the table at 2 while the
    // legend drew all of them. Opt-out empty = every current id is on.
    const html = renderToStaticMarkup(
      createElement(CompareCard, { scenarios, activeScenarioId: 'a', config }),
    );
    const tableNames = html.match(/font-medium text-slate-900">([^<]+)/g) ?? [];
    expect(tableNames.join(' ')).toContain('Retire Together');
    expect(tableNames.join(' ')).toContain('Pierre');
    expect(tableNames.join(' ')).toContain('Lean');
  });

  it('labels a linked-spouse plan as a household and offers a compare-only spouse toggle', () => {
    const partner: Scenario = {
      id: 'partner', name: 'Pat',
      inputs: baseInputs({ currentAge: 48, retirementAge: 62, maxAge: 95, tfsaBalance: 200000, desiredSpending: 30000 }),
    };
    const host: Scenario = {
      id: 'host', name: 'Early Couple',
      inputs: {
        ...baseInputs({ currentAge: 50, retirementAge: 62, maxAge: 95, tfsaBalance: 400000, rrspBalance: 300000, desiredSpending: 60000 }),
        spouseSource: { kind: 'scenario', scenarioId: 'partner' },
      },
    };
    const html = renderToStaticMarkup(
      createElement(CompareCard, { scenarios: [host, partner], activeScenarioId: 'host', config }),
    );
    expect(html).toContain('household · Pat');
    expect(html).toContain('hide spouse');
    expect(html).toContain('household chip');
    expect(html).toContain('single');
    expect(host.inputs.spouse).toBeUndefined();
    expect(host.inputs.spouseSource).toEqual({ kind: 'scenario', scenarioId: 'partner' });
  });
});
