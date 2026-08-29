// Tests for the SQLite-backed memory adapter: round-trips records (including
// keywords) through a real AppDatabase (in-memory wasm), upgrades legacy
// databases that predate the keywords column, and proves the table rides the
// database export (a backup carries memories).
import { describe, it, expect, beforeEach } from 'vitest';
import { AppDatabase } from '../../data/db';
import { SqliteMemoryAdapter } from './sqliteAdapter';
import { MemoryStore } from './store';

// Tests run in Node — give the mirror a localStorage to write to.
const storage = new Map<string, string>();
(globalThis as Record<string, unknown>).localStorage = {
  getItem: (k: string) => storage.get(k) ?? null,
  setItem: (k: string, v: string) => { storage.set(k, v); },
  removeItem: (k: string) => { storage.delete(k); },
  clear: () => storage.clear(),
};

beforeEach(() => {
  localStorage.clear();
});

describe('SqliteMemoryAdapter', () => {
  it('round-trips records (including keywords) through the database', async () => {
    const db = await AppDatabase.open();
    const adapter = new SqliteMemoryAdapter(db);
    adapter.put({
      id: 'm1', scope: 'scenario', scopeKey: 'plan-a', text: 'Spouse pension pays $1,200/mo',
      keywords: ['pension', 'income'],
      createdAt: 1000, lastAccessedAt: 2000, importance: 0.7, accessCount: 3,
    });
    const all = adapter.all();
    expect(all.length).toBe(1);
    expect(all[0]).toMatchObject({
      id: 'm1', scope: 'scenario', scopeKey: 'plan-a',
      text: 'Spouse pension pays $1,200/mo', keywords: ['pension', 'income'],
      importance: 0.7, accessCount: 3,
    });
    // put() again with the same id replaces, not duplicates.
    adapter.put({ ...all[0]!, importance: 0.9, keywords: ['pension', 'cpp'] });
    expect(adapter.all().length).toBe(1);
    expect(adapter.all()[0]!.importance).toBe(0.9);
    expect(adapter.all()[0]!.keywords).toEqual(['pension', 'cpp']);
    // A record with no keywords round-trips as an empty list, not garbage.
    adapter.put({ ...all[0]!, id: 'm2', keywords: undefined });
    expect(adapter.all().find(r => r.id === 'm2')!.keywords).toEqual([]);
  });

  it('deletes by id and tolerates deleting unknown ids', async () => {
    const db = await AppDatabase.open();
    const adapter = new SqliteMemoryAdapter(db);
    adapter.put({ id: 'm1', scope: 'global', scopeKey: '', text: 'x', createdAt: 1, lastAccessedAt: 1, importance: 0.5, accessCount: 0 });
    adapter.delete('m1');
    adapter.delete('nope');
    expect(adapter.all()).toEqual([]);
  });

  it('upgrades a legacy database that predates the keywords column', async () => {
    const db = await AppDatabase.open();
    // Build the OLD-shape table by hand (no keywords column) and put a row in.
    db.withTransaction(() => {
      db.run('DROP TABLE IF EXISTS memories');
      db.run(`CREATE TABLE memories (
        id TEXT PRIMARY KEY, scope TEXT NOT NULL, scope_key TEXT NOT NULL,
        text TEXT NOT NULL, created_at INTEGER NOT NULL,
        last_accessed_at INTEGER NOT NULL, importance REAL NOT NULL,
        access_count INTEGER NOT NULL
      )`);
      db.run(
        `INSERT INTO memories (id, scope, scope_key, text, created_at, last_accessed_at, importance, access_count)
         VALUES ('legacy', 'global', '', 'Old memory from before keywords', 1, 1, 0.5, 0)`);
    });
    // Opening over the legacy table adds the column instead of failing.
    const adapter = new SqliteMemoryAdapter(db);
    const legacyRows = adapter.all();
    expect(legacyRows.length).toBe(1);
    expect(legacyRows[0]!.keywords).toEqual([]); // DEFAULT '' → empty list
    // New writes (with keywords) coexist with the legacy row.
    adapter.put({
      id: 'new', scope: 'global', scopeKey: '', text: 'New memory',
      keywords: ['fruit'], createdAt: 2, lastAccessedAt: 2, importance: 0.5, accessCount: 0,
    });
    expect(adapter.all().find(r => r.id === 'new')!.keywords).toEqual(['fruit']);
    // And the store still finds the legacy row by its text-derived keywords.
    const store = new MemoryStore(adapter);
    expect(store.recall('memory').map(m => m.id)).toEqual(['legacy']);
  });

  it('memories survive a database export/import (backups carry them)', async () => {
    const db = await AppDatabase.open();
    const store = new MemoryStore(new SqliteMemoryAdapter(db));
    store.write({ scope: 'global', text: 'User is 62 and wants plain language', importance: 0.8, keywords: ['communication'] });
    const bytes = db.exportBytes();
    const reopened = await AppDatabase.open(bytes);
    const store2 = new MemoryStore(new SqliteMemoryAdapter(reopened));
    expect(store2.list().map(m => m.text)).toEqual(['User is 62 and wants plain language']);
    // Auto-extracted words from the text plus the supplied hypernym.
    expect(store2.list()[0]!.keywords).toEqual(['user', '62', 'wants', 'plain', 'language', 'communication']);
  });

  it('the full store pipeline works over SQLite: write with keywords, recall, evict', async () => {
    const db = await AppDatabase.open();
    const store = new MemoryStore(new SqliteMemoryAdapter(db));
    store.write({ scope: 'scenario', scopeKey: 'p1', text: 'Downsizing the house at 70', importance: 0.9 });
    store.write({ scope: 'global', text: 'User likes oranges.', keywords: ['fruit', 'food'], importance: 0.3 });
    // Keyword match through the persisted layer: "fruit" → the oranges fact.
    const fruit = store.recall('fruit', { scopeKey: 'p1' });
    expect(fruit.length).toBe(1);
    expect(fruit[0]!.text).toBe('User likes oranges.');
    const hits = store.recall('downsiz', { scopeKey: 'p1' });
    expect(hits.length).toBe(1);
    expect(hits[0]!.text).toContain('Downsizing');
    expect(hits[0]!.accessCount).toBe(1); // recall stamped the access
  });
});
