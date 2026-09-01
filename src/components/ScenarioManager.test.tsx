// @vitest-environment node
// The Plans page's scenario list, rebuilt in the f7 design: no inner page
// heading (BetaPage owns it), no rounded blue button/cards — one hairline
// list where the active plan reads by weight and its blue dot.
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { baseInputs } from '../../packages/engine-core/test/helpers';
import { ScenarioManager } from './ScenarioManager';

const mk = (id: string, name: string) => ({ id, name, inputs: baseInputs(), createdAt: '', updatedAt: '' });
const noop = () => {};

function render(props: Partial<Parameters<typeof ScenarioManager>[0]> = {}) {
  return renderToStaticMarkup(createElement(ScenarioManager, {
    scenarios: [mk('a', 'Base plan'), mk('b', 'Retire later')],
    activeScenarioId: 'a',
    onScenariosChange: noop,
    revisions: [],
    onRollback: noop,
    onSelectScenario: noop,
    onCreateScenario: noop,
    ...props,
  }));
}

describe('ScenarioManager (beta design)', () => {
  it('renders no inner page heading — BetaPage owns the title', () => {
    const html = render();
    expect(html).not.toContain('Manage Scenarios');
    expect(html).not.toContain('text-lg font-bold');
    // the list and its quiet explainer remain
    expect(html).toContain('Base plan');
    expect(html).toContain('Retire later');
    expect(html).toContain('Click a scenario to load it');
  });

  it('marks the active plan with the square blue dot and weight — no card, no ring', () => {
    const html = render();
    expect(html).toContain('Active — the dashboard shows this plan');
    expect(html).not.toContain('ring-1');          // old focus-ring card
    expect(html).not.toContain('rounded');         // flat/square rule
    expect(html).not.toContain('bg-blue-600');     // old New Scenario button
    expect(html).toContain('bg-slate-900');        // the ink primary button
  });

  it('keeps the quiet word actions per row', () => {
    const html = render();
    for (const action of ['History', 'Duplicate', 'Rename', 'Delete']) {
      expect(html, action).toContain(action);
    }
  });
});
