// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { createElement } from 'react';
import { baseInputs, testConfig } from '../../packages/engine-core/test/helpers';
import { CompareCard } from './CompareCard';
import type { Scenario } from '@retired/engine-core/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const config = testConfig();
const mk = (id: string, name: string, spend: number): Scenario => ({
  id, name,
  inputs: baseInputs({ currentAge: 50, retirementAge: 62, maxAge: 95, desiredSpending: spend, tfsaBalance: 400000, rrspBalance: 300000 }),
});

describe('CompareCard legend ↔ table', () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('plans that arrive after first paint still get a table row', () => {
    const first = [mk('a', 'Retire Together', 60000), mk('b', 'Pierre', 90000)];
    const later = [...first, mk('c', 'Lean', 40000), mk('d', 'Coast', 50000)];
    act(() => { root.render(createElement(CompareCard, { scenarios: first, activeScenarioId: 'a', config })); });
    expect(container.textContent).toContain('Retire Together');
    expect(container.textContent).toContain('Pierre');
    act(() => { root.render(createElement(CompareCard, { scenarios: later, activeScenarioId: 'a', config })); });
    const tableNames = [...container.querySelectorAll('tbody span.font-medium')].map(el => el.textContent);
    expect(tableNames).toEqual(['Retire Together', 'Pierre', 'Lean', 'Coast']);
  });

  it('legend click hides the line and the row; click again restores both', () => {
    const scenarios = [mk('a', 'Retire Together', 60000), mk('b', 'Pierre', 90000)];
    act(() => { root.render(createElement(CompareCard, { scenarios, activeScenarioId: 'a', config })); });
    const lineCount = () => [...container.querySelectorAll('path')].filter(p => p.getAttribute('fill') === 'none').length;
    expect(lineCount()).toBe(2);

    const pierreBtn = [...container.querySelectorAll('button')].find(b => b.textContent?.includes('Pierre'));
    expect(pierreBtn).toBeTruthy();
    act(() => { pierreBtn!.click(); });

    const tableNames = [...container.querySelectorAll('tbody span.font-medium')].map(el => el.textContent);
    expect(tableNames).toEqual(['Retire Together']);
    expect(lineCount()).toBe(1);
    expect(pierreBtn!.className).toContain('line-through');

    act(() => { pierreBtn!.click(); });
    const restored = [...container.querySelectorAll('tbody span.font-medium')].map(el => el.textContent);
    expect(restored).toEqual(['Retire Together', 'Pierre']);
    expect(lineCount()).toBe(2);
    expect(pierreBtn!.className).not.toContain('line-through');
  });
});
