import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AppStore } from './store';
import { DB_STORAGE_KEY } from './db';
import { baseInputs } from '../test/helpers';
import { DEFAULT_APP_CONFIG, type AppConfig } from '../lib/appConfig';
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
    expect(state.configLoadWarning).toBeUndefined();
  });

  it('flags a hand-corrupted config instead of silently resetting it (#19)', async () => {
    // Seed a store with a config, then corrupt it wholesale — validateAppConfig
    // returns null and the app would fall back to defaults with no signal, so
    // the user's custom tax tables would silently vanish (issue #19).
    const { store } = await AppStore.open(customDefaults);
    store.persist({
      scenarios: customDefaults(), activeScenarioId: 'seed-1',
      config: { completely: { wrong: { shape: true } } } as unknown as AppConfig,
    });

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { state } = await AppStore.open(customDefaults);
      // Falls back to null (the app's defaults take over)…
      expect(state.config).toBeNull();
      // …but LOUDLY: a console.error naming what failed…
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(String(errorSpy.mock.calls[0][0])).toMatch(/failed validation and was reset/);
      expect(String(errorSpy.mock.calls[0].join(' '))).toContain('completely'); // raw keys surfaced
      // …and a user-facing warning string for the UI to banner.
      expect(state.configLoadWarning).toMatch(/reset to defaults/);
              expect(state.configLoadWarning).toMatch(/custom tax tables/);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('does not warn when the config validates (back-fill stays silent)', async () => {
    // A config that validates — including one relying on newer-field
    // back-fill — must load without the #19 warning; only wholesale-invalid
    // blobs are the bug.
    const { store } = await AppStore.open(customDefaults);
    store.persist({ scenarios: customDefaults(), activeScenarioId: 'seed-1', config: DEFAULT_APP_CONFIG });

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { state } = await AppStore.open(customDefaults);
      expect(state.config?.general.promptToSaveOnSwitch).toBe(true);
      expect(state.configLoadWarning).toBeUndefined();
      expect(errorSpy).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
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

  it('exportBytes reflects the most recent persist, not stale bytes (U-01)', async () => {
    // The export handler seeds its throwaway DB from store.exportBytes() — the
    // live in-memory state — not from OPFS/localStorage. This test proves the
    // bytes are current: persist a change, export immediately, and the fresh
    // database must contain the edit (not the pre-persist state).
    const { store } = await AppStore.open(customDefaults);
    store.persist({ scenarios: customDefaults(), activeScenarioId: 'seed-1', config: DEFAULT_APP_CONFIG });

    // Make a change and persist it synchronously (as the persist effect does).
    const edited = [{ id: 'seed-1', name: 'Edited just now', inputs: baseInputs({ desiredSpending: 99999 }) }];
    store.persist({ scenarios: edited, activeScenarioId: 'seed-1' });

    // Export immediately — no waiting for OPFS to flush.
    const bytes = store.exportBytes();
    const { AppDatabase } = await import('./db');
    const db = await AppDatabase.open(bytes);
    expect(db.loadScenarios()[0].name).toBe('Edited just now');
    expect(db.loadScenarios()[0].inputs.desiredSpending).toBe(99999);
    db.close();
  });

  it('reports a save failure through onSaveOutcome (U-02)', async () => {
    // persist() is synchronous and the OPFS write resolves later, so a failed
    // durable write can't be a return value — the store exposes it through the
    // outcome channel the UI's banner subscribes to.
    const { store } = await AppStore.open(customDefaults);
    const outcomes: Array<unknown | null> = [];
    const unsub = store.onSaveOutcome(err => outcomes.push(err));

    // Force the OPFS-backed path with a backend whose write fails.
    const failingBackend = { read: () => Promise.resolve(null), write: () => Promise.reject(new Error('OPFS down')) };
    (store as unknown as { db: { backend: unknown } }).db.backend = failingBackend;

    store.persist({ scenarios: customDefaults(), activeScenarioId: 'seed-1' });
    await new Promise(r => setTimeout(r, 0)); // let the rejected write land

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]).toBeInstanceOf(Error);
    unsub();
  });

  it('reports a durable-write success through onSaveOutcome, clearing a prior failure (U-02)', async () => {
    const { store } = await AppStore.open(customDefaults);
    const outcomes: Array<unknown | null> = [];
    store.onSaveOutcome(err => outcomes.push(err));

    // Fail once...
    const backend: { read: () => Promise<null>; write: () => Promise<void> } = {
      read: () => Promise.resolve(null),
      write: () => Promise.reject(new Error('OPFS down')),
    };
    (store as unknown as { db: { backend: unknown } }).db.backend = backend;
    store.persist({ scenarios: customDefaults(), activeScenarioId: 'seed-1' });
    await new Promise(r => setTimeout(r, 0));

    // ...then recover: the next persist's durable write reports success (null),
    // which the UI uses to clear its "changes may not be saved" banner.
    backend.write = () => Promise.resolve();
    store.persist({ scenarios: customDefaults(), activeScenarioId: 'seed-1' });
    await new Promise(r => setTimeout(r, 0));

    expect(outcomes).toHaveLength(2);
    expect(outcomes[0]).toBeInstanceOf(Error);
    expect(outcomes[1]).toBeNull();
  });

  it('reports localStorage-only save failures through onSaveOutcome (U-02)', async () => {
    // No OPFS backend: localStorage is the only mirror, so its failure IS the
    // save failing — the banner must show for quota/storage errors too.
    const { store } = await AppStore.open(customDefaults);
    const outcomes: Array<unknown | null> = [];
    store.onSaveOutcome(err => outcomes.push(err));

    const original = localStorage.setItem;
    localStorage.setItem = () => { throw new Error('quota exceeded'); };
    try {
      store.persist({ scenarios: customDefaults(), activeScenarioId: 'seed-1' });
    } finally {
      localStorage.setItem = original;
    }

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]).toBeInstanceOf(Error);
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

  it('a fresh session never re-mints a revision id the history already used (D-05)', async () => {
    // revSeq is module-global and resets to 0 on every page load; a second
    // session that mints its first revision in the same millisecond as an
    // earlier session would otherwise re-emit a byte-identical id, and
    // pushRevision treats "same id" as "same row" — silently OVERWRITING that
    // history entry. seedRevSeq must lift the counter past the loaded history.
    // Pin the clock so both sessions mint in the same millisecond and the
    // suffix alone decides the id.
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    try {
      // Session one starts from a fresh module registry, exactly like a
      // browser load: revSeq begins at 0 and it mints suffixes 0, 1, 2.
      vi.resetModules();
      const { AppStore: FreshAppStore } = await import('./store');
      const { store, state } = await FreshAppStore.open(customDefaults);
      const sid = state.activeScenarioId;
      for (const spend of [11111, 22222]) {
        store.persist({
          scenarios: [{ id: sid, name: 'S', inputs: baseInputs({ desiredSpending: spend }) }],
          activeScenarioId: sid,
        });
      }
      const firstSessionIds = store.allRevisions().map(r => r.id);
      expect(firstSessionIds.length).toBe(3); // seed + two changes, all in one ms

      // Session two: another fresh registry over the SAME persisted bytes.
      vi.resetModules();
      const { AppStore: FreshAppStore2 } = await import('./store');
      const { store: store2 } = await FreshAppStore2.open(customDefaults);
      store2.persist({
        scenarios: [{ id: sid, name: 'S', inputs: baseInputs({ desiredSpending: 33333 }) }],
        activeScenarioId: sid,
      });
      const ids = store2.allRevisions().map(r => r.id);
      // Nothing was overwritten: the history gained exactly one row (a
      // collision would REPLACE the oldest row — same id = same slot to
      // pushRevision — leaving the count flat and its inputs clobbered)…
      expect(ids.length).toBe(firstSessionIds.length + 1);
      for (const id of firstSessionIds) expect(ids).toContain(id);
      // …and session one's seed revision still holds the seed inputs, not
      // session two's 33333 overwrite.
      const seedRow = store2.allRevisions().find(r => r.id === firstSessionIds[0])!;
      expect(seedRow.inputs.desiredSpending).toBe(baseInputs().desiredSpending);
    } finally {
      vi.restoreAllMocks();
      vi.resetModules();
    }
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
