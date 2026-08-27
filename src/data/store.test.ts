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
