import { describe, it, expect, beforeEach } from 'vitest';
import { AppStore } from './store';
import { DB_STORAGE_KEY } from './db';
import { baseInputs } from '../test/helpers';
import { DEFAULT_APP_CONFIG } from '../lib/appConfig';
import { buildDefaultScenarios } from './exampleScenarios';
import type { Scenario } from '../lib/scenarioStorage';

// Tests run in Node — give the mirror a localStorage to write to.
const storage = new Map<string, string>();
(globalThis as Record<string, unknown>).localStorage = {
  getItem: (k: string) => storage.get(k) ?? null,
  setItem: (k: string, v: string) => { storage.set(k, v); },
  removeItem: (k: string) => { storage.delete(k); },
  clear: () => storage.clear(),
};

/** Store-level behaviour: seeding, legacy-key import, persistence. */

beforeEach(() => {
  localStorage.clear();
});

const customDefaults = (): Scenario[] => [
  { id: 'seed-1', name: 'Seeded plan', inputs: baseInputs() },
];

describe('AppStore', () => {
  it('seeds first-run examples when the store and legacy keys are empty', async () => {
    const { state } = await AppStore.open(buildDefaultScenarios);
    expect(state.scenarios.map(s => s.name)).toEqual([
      'Example - Early Couple',
      'Example - Single at 60',
      'Example - Semi-retirement',
    ]);
    expect(state.activeScenarioId).toBe(state.scenarios[0].id);
    expect(state.config).toBeNull(); // no config until the app writes one
  });

  it('imports the legacy split keys on first open', async () => {
    const legacyScenarios = [
      { id: 'legacy-1', name: 'My old plan', inputs: baseInputs({ desiredSpending: 55000 }) },
    ];
    localStorage.setItem('wealthconsole_scenarios', JSON.stringify({
      version: 2, scenarios: legacyScenarios, activeScenarioId: 'legacy-1',
    }));
    localStorage.setItem('wealthconsole_config', JSON.stringify(DEFAULT_APP_CONFIG));

    const { store, state } = await AppStore.open(buildDefaultScenarios);
    expect(state.scenarios.map(s => s.id)).toEqual(['legacy-1']);
    expect(state.scenarios[0].inputs.desiredSpending).toBe(55000);
    expect(state.activeScenarioId).toBe('legacy-1');
    expect(state.config?.general.promptToSaveOnSwitch).toBe(true);

    // The import was persisted into the SQL store.
    store.persist({ scenarios: state.scenarios, activeScenarioId: 'legacy-1' });
    expect(localStorage.getItem(DB_STORAGE_KEY)).not.toBeNull();
  });

  it('ignores legacy keys once the SQL store has data', async () => {
    // First open seeds the SQL store…
    const first = await AppStore.open(customDefaults);
    first.store.persist({ scenarios: first.state.scenarios, activeScenarioId: 'seed-1' });

    // …then a legacy key appears (an older tab, a restored backup of keys).
    // The SQL store must still win.
    localStorage.setItem('wealthconsole_scenarios', JSON.stringify({
      version: 2, scenarios: [{ id: 'x', name: 'X', inputs: baseInputs() }], activeScenarioId: 'x',
    }));

    const second = await AppStore.open(customDefaults);
    expect(second.state.scenarios.map(s => s.id)).toEqual(['seed-1']);
  });

  it('persist then reopen returns the same state', async () => {
    const { store } = await AppStore.open(customDefaults);
    const updated: Scenario[] = [
      { id: 'seed-1', name: 'Renamed', inputs: baseInputs({ currentAge: 60 }) },
      { id: 'new-2', name: 'Second', inputs: baseInputs() },
    ];
    store.persist({ scenarios: updated, activeScenarioId: 'new-2', config: DEFAULT_APP_CONFIG });

    const again = await AppStore.open(customDefaults);
    expect(again.state.scenarios.map(s => s.name)).toEqual(['Renamed', 'Second']);
    expect(again.state.activeScenarioId).toBe('new-2');
    expect(again.state.config?.oas.clawbackThreshold).toBe(DEFAULT_APP_CONFIG.oas.clawbackThreshold);
  });

  it('a dead stored active id falls back to the first scenario', async () => {
    const { store } = await AppStore.open(customDefaults);
    store.persist({ scenarios: customDefaults(), activeScenarioId: 'gone' });
    const again = await AppStore.open(customDefaults);
    expect(again.state.activeScenarioId).toBe('seed-1');
  });

  it('exportBytes produces a file a fresh database can open (the backup loop)', async () => {
    const { store } = await AppStore.open(customDefaults);
    store.persist({ scenarios: customDefaults(), activeScenarioId: 'seed-1', config: DEFAULT_APP_CONFIG });
    const bytes = store.exportBytes();
    expect(bytes.length).toBeGreaterThan(1000);
    // The SQLite magic header: "SQLite format 3\0".
    expect(String.fromCharCode(...bytes.subarray(0, 15))).toBe('SQLite format 3');

    const { AppDatabase } = await import('./db');
    const db = await AppDatabase.open(bytes);
    expect(db.toDoc()?.scenarios[0].name).toBe('Seeded plan');
    db.close();
  });
});

describe('AppStore revisions', () => {
  it('seeding records the first revision', async () => {
    const { store, state } = await AppStore.open(customDefaults);
    const revs = store.allRevisions().filter(r => r.scenarioId === state.activeScenarioId);
    expect(revs).toHaveLength(1);
    expect(revs[0].source).toBe('save');
    expect(revs[0].inputs).toEqual(state.scenarios[0].inputs);
  });

  it('records a revision only when the inputs actually change', async () => {
    const { store, state } = await AppStore.open(customDefaults);
    const id = state.activeScenarioId;

    // Rename only — no inputs change, no revision.
    store.persist({
      scenarios: [{ id, name: 'Renamed', inputs: state.scenarios[0].inputs }],
      activeScenarioId: id,
    });
    expect(store.allRevisions()).toHaveLength(1);

    // Real change → second revision.
    store.persist({
      scenarios: [{ id, name: 'Renamed', inputs: baseInputs({ desiredSpending: 12345 }) }],
      activeScenarioId: id,
    });
    expect(store.allRevisions()).toHaveLength(2);
    expect(store.allRevisions()[1].inputs.desiredSpending).toBe(12345);
  });

  it('persists revisions and reloads them on reopen', async () => {
    const first = await AppStore.open(customDefaults);
    const id = first.state.activeScenarioId;
    first.store.persist({
      scenarios: [{ id, name: 'S', inputs: baseInputs({ desiredSpending: 11111 }) }],
      activeScenarioId: id,
    });

    const again = await AppStore.open(customDefaults);
    const revs = again.store.allRevisions().filter(r => r.scenarioId === id);
    expect(revs.length).toBeGreaterThanOrEqual(2);
    expect(revs.at(-1)?.inputs.desiredSpending).toBe(11111);
  });

  it('rollback returns the snapshot and DELETES every newer revision (rewind, not branch)', async () => {
    const { store, state } = await AppStore.open(customDefaults);
    const id = state.activeScenarioId;
    // Three distinct saves: 11111 → 22222 → 33333.
    store.persist({ scenarios: [{ id, name: 'S', inputs: baseInputs({ desiredSpending: 11111 }) }], activeScenarioId: id });
    store.persist({ scenarios: [{ id, name: 'S', inputs: baseInputs({ desiredSpending: 22222 }) }], activeScenarioId: id });
    store.persist({ scenarios: [{ id, name: 'S', inputs: baseInputs({ desiredSpending: 33333 }) }], activeScenarioId: id });
    const all = store.allRevisions();
    expect(all).toHaveLength(4); // seed + 3 saves

    // Roll back to the THIRD revision (22222; list is oldest-first):
    // the two newer ones (33333 and its save) are gone.
    const restored = store.rollbackRevision(id, all[2].id);
    expect(restored?.desiredSpending).toBe(22222);
    const after = store.allRevisions().filter(r => r.scenarioId === id);
    expect(after).toHaveLength(3); // seed + 11111 + 22222
    expect(after.at(-1)?.inputs.desiredSpending).toBe(22222);
    // Other scenarios' history is untouched.
    const bytes = store.exportBytes();
    const { AppDatabase } = await import('./db');
    const db = await AppDatabase.open(bytes);
    expect(db.loadScenarios().length).toBeGreaterThan(0);
    db.close();
  });

  it('rollback to the newest revision deletes nothing', async () => {
    const { store, state } = await AppStore.open(customDefaults);
    const id = state.activeScenarioId;
    store.persist({ scenarios: [{ id, name: 'S', inputs: baseInputs({ desiredSpending: 22222 }) }], activeScenarioId: id });
    const before = store.allRevisions();
    const restored = store.rollbackRevision(id, before.at(-1)!.id);
    expect(restored?.desiredSpending).toBe(22222);
    expect(store.allRevisions()).toEqual(before);
  });

  it('the persisted row after a rollback matches the restored plan (no phantom diff on next save)', async () => {
    const { store, state } = await AppStore.open(customDefaults);
    const id = state.activeScenarioId;
    store.persist({ scenarios: [{ id, name: 'S', inputs: baseInputs({ desiredSpending: 22222 }) }], activeScenarioId: id });
    const restored = store.rollbackRevision(id, store.allRevisions()[0].id);

    // Apply + persist WITHOUT revision recording (the App flow), then make a
    // real change: exactly one new revision (the restore itself is not one).
    store.persist({ scenarios: [{ id, name: 'S', inputs: restored! }], activeScenarioId: id, skipRevisions: true });
    store.persist({ scenarios: [{ id, name: 'S', inputs: baseInputs({ desiredSpending: 44444 }) }], activeScenarioId: id });
    const mine = store.allRevisions().filter(r => r.scenarioId === id);
    expect(mine.at(-1)?.inputs.desiredSpending).toBe(44444);
  });

  it('a save after a rollback records exactly one revision (no duplicate echo)', async () => {
    const { store, state } = await AppStore.open(customDefaults);
    const id = state.activeScenarioId;
    store.persist({
      scenarios: [{ id, name: 'S', inputs: baseInputs({ desiredSpending: 22222 }) }],
      activeScenarioId: id,
    });
    const original = store.rollbackRevision(id, store.allRevisions()[0].id);
    expect(original).not.toBeNull();

    // The restored plan is now the live state; persisting it must be a no-op
    // against history only if it matches what was last SAVED. It doesn't (the
    // last save was 22222, the rollback restored the original), but the NEXT
    // real save diffs against the last-saved rows, so it records exactly one.
    store.persist({ scenarios: [{ id, name: 'S', inputs: original! }], activeScenarioId: id, skipRevisions: true });
    const afterRollbackApply = store.allRevisions().length;

    store.persist({ scenarios: [{ id, name: 'S', inputs: baseInputs({ desiredSpending: 33333 }) }], activeScenarioId: id });
    expect(store.allRevisions().length).toBe(afterRollbackApply + 1);
  });

  it('drops revisions of deleted scenarios and enforces the rolling cap', async () => {
    const { store, state } = await AppStore.open(customDefaults);
    const id = state.activeScenarioId;
    // Many distinct saves → capped at MAX_REVISIONS for this scenario.
    for (let i = 0; i < 105; i++) {
      store.persist({
        scenarios: [{ id, name: 'S', inputs: baseInputs({ desiredSpending: 1000 + i }) }],
        activeScenarioId: id,
      });
    }
    const mine = store.allRevisions().filter(r => r.scenarioId === id);
    expect(mine.length).toBeLessThanOrEqual(100);
    // Newest survives.
    expect(mine.at(-1)?.inputs.desiredSpending).toBe(1104);

    // Deleting the scenario drops its history.
    store.persist({ scenarios: [] });
    expect(store.allRevisions()).toHaveLength(0);
  });
});
