import { describe, it, expect, beforeEach } from 'vitest';
import {
  MAX_REVISIONS, pushRevision, inputsChanged, diffRevisions, planRollback,
  SqliteRevisionStore,
} from './scenarioRevisions';
import { AppDatabase } from '../data/db';
import { baseInputs } from '../test/helpers';
import type { ScenarioRevision } from './scenarioRevisions';
import type { RetirementInputs } from './retirementEngine';

// Tests run in Node — give the OPFS-less mirror a localStorage to write to.
const storage = new Map<string, string>();
(globalThis as Record<string, unknown>).localStorage = {
  getItem: (k: string) => storage.get(k) ?? null,
  setItem: (k: string, v: string) => { storage.set(k, v); },
  removeItem: (k: string) => { storage.delete(k); },
  clear: () => storage.clear(),
};

let seq = 0;
const rev = (scenarioId: string, inputs: RetirementInputs, at = 1000 + seq): ScenarioRevision => ({
  id: `rev-${++seq}`,
  scenarioId,
  at,
  source: 'save',
  inputs,
});

beforeEach(() => {
  localStorage.clear();
  seq = 0;
});

describe('pushRevision (rolling cap)', () => {
  it('appends and keeps every revision under the cap', () => {
    let list: ScenarioRevision[] = [];
    for (let i = 0; i < 10; i++) list = pushRevision(list, rev('a', baseInputs({ desiredSpending: 1000 + i })));
    expect(list).toHaveLength(10);
    expect(list[0].at).toBeLessThan(list[9].at); // newest last
  });

  it('drops the OLDEST revision when the cap is exceeded', () => {
    let list: ScenarioRevision[] = [];
    for (let i = 0; i < MAX_REVISIONS + 5; i++) list = pushRevision(list, rev('a', baseInputs({ desiredSpending: 1000 + i })));
    expect(list).toHaveLength(MAX_REVISIONS);
    // First 5 were dropped: the oldest surviving revision is #6.
    expect(list[0].id).toBe('rev-6');
    expect(list.at(-1)?.id).toBe(`rev-${MAX_REVISIONS + 5}`);
  });

  it('caps per scenario independently', () => {
    let list: ScenarioRevision[] = [];
    for (let i = 0; i < MAX_REVISIONS + 1; i++) list = pushRevision(list, rev('a', baseInputs()));
    list = pushRevision(list, rev('b', baseInputs()));
    expect(list.filter(r => r.scenarioId === 'a')).toHaveLength(MAX_REVISIONS);
    expect(list.filter(r => r.scenarioId === 'b')).toHaveLength(1);
  });

  it('replaces in place when the id already exists', () => {
    let list = [rev('a', baseInputs())];
    const again = { ...list[0], inputs: baseInputs({ desiredSpending: 99 }) };
    list = pushRevision(list, again);
    expect(list).toHaveLength(1);
    expect(list[0].inputs.desiredSpending).toBe(99);
  });
});

describe('inputsChanged', () => {
  it('detects a real change and ignores a deep-equal copy', () => {
    const a = baseInputs();
    expect(inputsChanged(a, JSON.parse(JSON.stringify(a)))).toBe(false);
    expect(inputsChanged(a, baseInputs({ desiredSpending: 1 }))).toBe(true);
  });

  it('treats shape drift (absent vs empty array) as NO change', () => {
    // A newer build's migration adds `events: []` where older snapshots
    // omitted the key — that must not read as a change.
    const withEmpty = baseInputs() as RetirementInputs;
    (withEmpty as unknown as Record<string, unknown>).events = [];
    expect(inputsChanged(baseInputs(), withEmpty)).toBe(false);
    expect(diffRevisions(baseInputs(), withEmpty)).toEqual([]);
  });
});

describe('diffRevisions / planRollback', () => {
  it('reports each changed top-level field with from/to', () => {
    const diffs = diffRevisions(
      baseInputs({ desiredSpending: 50000, retirementAge: 65 }),
      baseInputs({ desiredSpending: 48000, retirementAge: 65 }),
    );
    expect(diffs).toHaveLength(1);
    expect(diffs[0]).toEqual({ field: 'desiredSpending', from: 50000, to: 48000 });
  });

  it('returns [] for identical plans', () => {
    const a = baseInputs();
    expect(diffRevisions(a, JSON.parse(JSON.stringify(a)))).toEqual([]);
  });

  it('planRollback finds the revision and diffs it against the current plan', () => {
    const list = [rev('a', baseInputs({ desiredSpending: 30000 }))];
    const plan = planRollback(list, 'rev-1', baseInputs({ desiredSpending: 50000 }));
    expect(plan?.revision.id).toBe('rev-1');
    expect(plan?.diffs.map(d => d.field)).toContain('desiredSpending');
    expect(planRollback(list, 'nope', baseInputs())).toBeNull();
  });
});

describe('SqliteRevisionStore', () => {
  it('round-trips revisions through the database bytes', async () => {
    const db = await AppDatabase.open();
    const store = new SqliteRevisionStore(db);
    store.saveAll([
      rev('a', baseInputs({ desiredSpending: 40000 })),
      rev('a', baseInputs({ desiredSpending: 42000 })),
      rev('b', baseInputs({ currentAge: 70 })),
    ]);
    const bytes = db.exportBytes();
    db.close();

    const reopened = await AppDatabase.open(bytes);
    const store2 = new SqliteRevisionStore(reopened);
    const loaded = store2.loadAll();
    expect(loaded).toHaveLength(3);
    expect(loaded.map(r => r.scenarioId)).toEqual(['a', 'a', 'b']);
    expect(loaded[1].inputs.desiredSpending).toBe(42000);
    reopened.close();
  });

  it('saveAll replaces the whole set', async () => {
    const db = await AppDatabase.open();
    const store = new SqliteRevisionStore(db);
    store.saveAll([rev('a', baseInputs())]);
    store.saveAll([rev('b', baseInputs())]);
    expect(store.loadAll().map(r => r.scenarioId)).toEqual(['b']);
    db.close();
  });
});
