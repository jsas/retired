import { describe, expect, it } from 'vitest';
import type { Scenario } from '@retired/engine-core/types';
import { baseInputs } from '../../packages/engine-core/test/helpers';
import { mergeOnOpen } from './storeMerge';

const plan = (id: string, spending: number): Scenario => ({
  id,
  name: `Plan ${id}`,
  inputs: baseInputs({ desiredSpending: spending }),
});

const live = (over: Partial<Parameters<typeof mergeOnOpen>[1]> = {}) => ({
  scenarios: [plan('seed-a', 1000), plan('seed-b', 2000)],
  activeId: 'seed-a',
  inputs: baseInputs({ desiredSpending: 1000 }),
  dirty: false,
  ...over,
});

describe('mergeOnOpen', () => {
  it('adopts the stored plans and the stored active plan when nothing is mid-edit', () => {
    const stored = { scenarios: [plan('mine-1', 60000), plan('mine-2', 40000)], activeScenarioId: 'mine-2' };
    const merged = mergeOnOpen(stored, live());

    expect(merged.scenarios.map(s => s.id)).toEqual(['mine-1', 'mine-2']);
    expect(merged.activeScenarioId).toBe('mine-2');
    expect(merged.inputs.desiredSpending).toBe(40000);
    expect(merged.dirty).toBe(false);
  });

  it('hands back a copy of the inputs, never the store object itself', () => {
    const stored = { scenarios: [plan('mine-1', 60000)], activeScenarioId: 'mine-1' };
    const merged = mergeOnOpen(stored, live());

    merged.inputs.desiredSpending = 1;
    expect(stored.scenarios[0].inputs.desiredSpending).toBe(60000);
  });

  it('falls back to the first stored plan when the stored active id is stale', () => {
    const stored = { scenarios: [plan('mine-1', 60000)], activeScenarioId: 'deleted-plan' };
    const merged = mergeOnOpen(stored, live());

    expect(merged.activeScenarioId).toBe('mine-1');
    expect(merged.inputs.desiredSpending).toBe(60000);
  });

  it('keeps an in-flight edit and every stored plan instead of choosing one', () => {
    // The tab rendered the stored list, then the user edited `mine-1` while the
    // store was still opening.
    const stored = { scenarios: [plan('mine-1', 60000), plan('mine-2', 40000)], activeScenarioId: 'mine-1' };
    const merged = mergeOnOpen(stored, live({
      scenarios: [plan('mine-1', 60000), plan('mine-2', 40000)],
      activeId: 'mine-1',
      inputs: baseInputs({ desiredSpending: 51000 }),
      dirty: true,
    }));

    expect(merged.scenarios.map(s => s.id)).toEqual(['mine-1', 'mine-2']);
    expect(merged.scenarios.find(s => s.id === 'mine-1')?.inputs.desiredSpending).toBe(51000);
    // The other plan is untouched, straight from the store.
    expect(merged.scenarios.find(s => s.id === 'mine-2')?.inputs.desiredSpending).toBe(40000);
    expect(merged.activeScenarioId).toBe('mine-1');
    expect(merged.dirty).toBe(true);
  });

  it('keeps an edit made on a plan the store has never seen', () => {
    // A plan created after boot (share link, import) isn't in the stored rows
    // yet; adopting the store must not drop it.
    const stored = { scenarios: [plan('mine-1', 60000)], activeScenarioId: 'mine-1' };
    const merged = mergeOnOpen(stored, live({
      scenarios: [plan('mine-1', 60000), plan('imported-9', 3000)],
      activeId: 'imported-9',
      inputs: baseInputs({ desiredSpending: 3500 }),
      dirty: true,
    }));

    expect(merged.scenarios.map(s => s.id)).toEqual(['mine-1', 'imported-9']);
    expect(merged.scenarios[1].inputs.desiredSpending).toBe(3500);
    expect(merged.activeScenarioId).toBe('imported-9');
  });

  it('keeps the screen when the store returns nothing', () => {
    const merged = mergeOnOpen({ scenarios: [], activeScenarioId: 'seed-a' }, live({ dirty: true }));

    expect(merged.scenarios.map(s => s.id)).toEqual(['seed-a', 'seed-b']);
    expect(merged.activeScenarioId).toBe('seed-a');
    expect(merged.dirty).toBe(true);
  });
});
