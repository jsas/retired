import { describe, it, expect, beforeEach } from 'vitest';
import { AppDatabase, DB_STORAGE_KEY } from './db';
import { baseInputs } from '../test/helpers';
import { DEFAULT_APP_CONFIG } from '../lib/appConfig';
import type { Scenario } from '../lib/scenarioStorage';

// Tests run in Node — give the mirror a localStorage to write to.
const storage = new Map<string, string>();
(globalThis as Record<string, unknown>).localStorage = {
  getItem: (k: string) => storage.get(k) ?? null,
  setItem: (k: string, v: string) => { storage.set(k, v); },
  removeItem: (k: string) => { storage.delete(k); },
  clear: () => storage.clear(),
};

/**
 * The SQLite store is where every plan lives — these tests open real in-memory
 * databases (the wasm loads once per suite) and round-trip data through the
 * same code paths the UI uses, including the localStorage mirror and the
 * legacy split-key import.
 */

const scenarios = (): Scenario[] => [
  { id: 'a', name: 'Plan A', inputs: baseInputs({ currentAge: 50, desiredSpending: 48000 }) },
  {
    id: 'b', name: 'Plan B', inputs: baseInputs({
      currentAge: 58,
      spouse: {
        enabled: true, currentAge: 56, retirementAge: 62,
        rrspBalance: 100000, tfsaBalance: 20000, taxableBalance: 0, cashCushionBalance: 0,
        rrspContribution: 0, tfsaContribution: 0, taxableContribution: 0,
        cppStartAge: 65, cppMonthlyAmount: 800, oasStartAge: 65, oasYearsInCanada: 40,
        desiredSpending: 20000,
      },
    })
  },
];

beforeEach(() => {
  localStorage.clear();
});

describe('AppDatabase', () => {
  it('round-trips scenarios, the active id and the config through export bytes', async () => {
    const db = await AppDatabase.open();
    const list = scenarios();
    db.saveScenarios(list);
    db.saveActiveScenarioId('b');
    db.saveConfig(DEFAULT_APP_CONFIG);
    const bytes = db.exportBytes();
    db.close();

    const reopened = await AppDatabase.open(bytes);
    const loaded = reopened.loadScenarios();
    expect(loaded.map(s => s.id)).toEqual(['a', 'b']);
    expect(loaded[1].inputs.spouse?.enabled).toBe(true);
    expect(loaded[1].inputs.spouse?.rrspBalance).toBe(100000);
    expect(reopened.loadActiveScenarioId()).toBe('b');
    expect(reopened.loadConfig()).toBeTruthy();
    reopened.close();
  });

  it('mirrors to localStorage on save and re-opens from it', async () => {
    const db = await AppDatabase.open();
    db.saveScenarios(scenarios());
    db.saveActiveScenarioId('a');
    db.save();
    db.close();

    const reopened = await AppDatabase.open();
    expect(reopened.loadScenarios().map(s => s.name)).toEqual(['Plan A', 'Plan B']);
    expect(reopened.loadActiveScenarioId()).toBe('a');
    reopened.close();
  });

  it('keeps row order stable (insertion order) across saves', async () => {
    const db = await AppDatabase.open();
    db.saveScenarios(scenarios());
    // Re-save in a different order — the store must reflect the new order,
    // since the UI writes the scenario list as a set.
    const reversed = scenarios().reverse();
    db.saveScenarios(reversed);
    expect(db.loadScenarios().map(s => s.id)).toEqual(['b', 'a']);
    db.close();
  });

  it('toDoc validates the whole store; loadDoc replaces it', async () => {
    const db = await AppDatabase.open();
    db.saveScenarios(scenarios());
    db.saveActiveScenarioId('a');
    db.saveConfig(DEFAULT_APP_CONFIG);
    const doc = db.toDoc();
    expect(doc).not.toBeNull();
    expect(doc!.scenarios).toHaveLength(2);

    // Write the doc into a fresh store.
    const other = await AppDatabase.open();
    other.loadDoc(doc!);
    expect(other.loadScenarios().map(s => s.id)).toEqual(['a', 'b']);
    expect(other.toDoc()!.activeScenarioId).toBe('a');
    other.close();
    db.close();
  });

  it('migrates stale scenario inputs on read (fields added later appear)', async () => {
    const db = await AppDatabase.open();
    const stale = scenarios();
    // Simulate a row written before spouseSource existed.
    delete (stale[0].inputs as Partial<typeof stale[0]['inputs']>).spouseSource;
    db.saveScenarios(stale);
    const loaded = db.loadScenarios();
    expect(loaded[0].inputs.spouseSource).toEqual({ kind: 'builtin' });
    db.close();
  });

  it('carries raw kv values (AI chats/settings) in the backup bytes', async () => {
    const db = await AppDatabase.open();
    db.saveScenarios(scenarios());
    db.saveConfig(DEFAULT_APP_CONFIG);
    db.setKv('retirement_ai_chats', JSON.stringify({ threads: [{ id: 't1' }], activeThreadId: 't1' }));
    db.setKv('retirement_ai_settings', JSON.stringify({ connections: [], activeConnectionId: null, prompts: [] }));
    const bytes = db.exportBytes();
    db.close();

    const reopened = await AppDatabase.open(bytes);
    expect(JSON.parse(reopened.getKv('retirement_ai_chats')!)).toEqual({
      threads: [{ id: 't1' }], activeThreadId: 't1',
    });
    expect(reopened.getKv('retirement_ai_settings')).toBeTruthy();
    reopened.close();
  });

  it('deleteKv strips an AI payload from a backup that excludes it', async () => {
    const db = await AppDatabase.open();
    db.saveScenarios(scenarios());
    db.saveConfig(DEFAULT_APP_CONFIG);
    db.setKv('retirement_ai_settings', JSON.stringify({ connections: [{ apiKey: 'secret' }] }));
    db.deleteKv('retirement_ai_settings');
    const bytes = db.exportBytes();
    db.close();

    const reopened = await AppDatabase.open(bytes);
    expect(reopened.getKv('retirement_ai_settings')).toBeNull();
    reopened.close();
  });

  it('getKv returns null for a key that was never written', async () => {
    const db = await AppDatabase.open();
    expect(db.getKv('retirement_ai_chats')).toBeNull();
    db.close();
  });

  it('salvageableContents reports config when a scenario-less store still has one', async () => {
    // The truncated-backup shape: meta + kv survived, scenarios did not.
    const db = await AppDatabase.open();
    db.saveScenarios(scenarios());
    db.saveConfig(DEFAULT_APP_CONFIG);
    const bytes = db.exportBytes();
    db.close();

    const reopened = await AppDatabase.open(bytes);
    reopened.saveScenarios([]); // scenarios wiped, config left behind
    const salvage = reopened.salvageableContents();
    expect(salvage?.kind).toBe('config');
    if (salvage?.kind === 'config') expect(salvage.config).toEqual(DEFAULT_APP_CONFIG);
    reopened.close();
  });

  it('salvageableContents reports ai-only when only AI payloads remain', async () => {
    const db = await AppDatabase.open();
    db.setKv('retirement_ai_chats', JSON.stringify({ threads: [], activeThreadId: null }));
    const salvage = db.salvageableContents();
    expect(salvage?.kind).toBe('ai-only');
    db.close();
  });

  it('salvageableContents returns null for a full store and for a foreign database', async () => {
    const full = await AppDatabase.open();
    full.saveScenarios(scenarios());
    full.saveConfig(DEFAULT_APP_CONFIG);
    expect(full.salvageableContents()).toBeNull(); // toDoc handles full stores
    full.close();

    const foreign = await AppDatabase.open();
    expect(foreign.salvageableContents()).toBeNull(); // fresh/empty: nothing of ours
    foreign.close();
  });

  it('a failed OPFS write never leaves localStorage newer than OPFS (D-01 / #18)', async () => {
    // Regression test for the silent one-session rollback: OPFS write fails,
    // localStorage mirror succeeds → next load prefers OPFS and rolls back.
    // After the fix, save() only mirrors to localStorage AFTER the OPFS write
    // succeeds, so the pair can never diverge.
    const db = await AppDatabase.open();
    // Node has no OPFS, so the backend is null — attach a fake one whose write
    // always rejects, then observe what save() does with the localStorage mirror.
    const fakeBackend = {
      write: () => Promise.reject(new Error('OPFS write failed (forced)')),
      read: () => Promise.resolve(null),
      clear: () => Promise.resolve(),
    };
    (db as unknown as { backend: typeof fakeBackend | null }).backend = fakeBackend;
    db.saveScenarios(scenarios());
    db.save(); // OPFS rejects → localStorage must NOT receive a newer mirror
    // Flush the microtask queue so the .then() chain has a chance to run.
    await new Promise(r => setTimeout(r, 0));
    expect(localStorage.getItem(DB_STORAGE_KEY)).toBeNull();
    db.close();
  });

  it('a successful OPFS write still mirrors to localStorage (D-01 / #18)', async () => {
    // The complement: when OPFS succeeds, localStorage gets the mirror.
    const db = await AppDatabase.open();
    const fakeBackend = {
      write: () => Promise.resolve(),
      read: () => Promise.resolve(null),
      clear: () => Promise.resolve(),
    };
    (db as unknown as { backend: typeof fakeBackend | null }).backend = fakeBackend;
    db.saveScenarios(scenarios());
    db.save();
    await new Promise(r => setTimeout(r, 0));
    expect(localStorage.getItem(DB_STORAGE_KEY)).not.toBeNull();
    db.close();
  });
});
