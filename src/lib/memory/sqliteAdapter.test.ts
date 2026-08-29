// Tests for the SQLite-backed memory adapter: round-trips records through a
// real AppDatabase (in-memory wasm), verifies LIKE-escaping, and proves the
// table rides the database export (a backup carries memories).
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
  it('round-trips records through the database', async () => {
    const db = await AppDatabase.open();
    const adapter = new SqliteMemoryAdapter(db);
    adapter.put({
      id: 'm1', scope: 'scenario', scopeKey: 'plan-a', text: 'Spouse pension pays $1,200/mo',
      createdAt: 1000, lastAccessedAt: 2000, importance: 0.7, accessCount: 3,
    });
    const all = adapter.all();
    expect(all.length).toBe(1);
    expect(all[0]).toMatchObject({
      id: 'm1', scope: 'scenario', scopeKey: 'plan-a',
      text: 'Spouse pension pays $1,200/mo', importance: 0.7, accessCount: 3,
    });
    // put() again with the same id replaces, not duplicates.
    adapter.put({ ...all[0]!, importance: 0.9 });
    expect(adapter.all().length).toBe(1);
    expect(adapter.all()[0]!.importance).toBe(0.9);
  });

  it('deletes by id and tolerates deleting unknown ids', async () => {
    const db = await AppDatabase.open();
    const adapter = new SqliteMemoryAdapter(db);
    adapter.put({ id: 'm1', scope: 'global', scopeKey: '', text: 'x', createdAt: 1, lastAccessedAt: 1, importance: 0.5, accessCount: 0 });
    adapter.delete('m1');
    adapter.delete('nope');
    expect(adapter.all()).toEqual([]);
  });

  it('searchText matches literal substrings and escapes LIKE wildcards', async () => {
    const db = await AppDatabase.open();
    const adapter = new SqliteMemoryAdapter(db);
    adapter.put({ id: 'a', scope: 'global', scopeKey: '', text: 'Home value is 100% of equity', createdAt: 1, lastAccessedAt: 1, importance: 0.5, accessCount: 0 });
    adapter.put({ id: 'b', scope: 'global', scopeKey: '', text: 'Retirement age 100 plan', createdAt: 2, lastAccessedAt: 2, importance: 0.5, accessCount: 0 });
    // '%' in the query is a LITERAL percent sign, not a wildcard: only the
    // record containing "100%" matches.
    const hits = adapter.searchText('100%');
    expect(hits.map(h => h.id)).toEqual(['a']);
    // Case-insensitive literal match still works.
    expect(adapter.searchText('home value').map(h => h.id)).toEqual(['a']);
  });

  it('memories survive a database export/import (backups carry them)', async () => {
    const db = await AppDatabase.open();
    const store = new MemoryStore(new SqliteMemoryAdapter(db));
    store.write({ scope: 'global', text: 'User is 62 and wants plain language', importance: 0.8 });
    const bytes = db.exportBytes();
    const reopened = await AppDatabase.open(bytes);
    const store2 = new MemoryStore(new SqliteMemoryAdapter(reopened));
    expect(store2.list().map(m => m.text)).toEqual(['User is 62 and wants plain language']);
  });

  it('the full store pipeline works over SQLite: write, recall, evict', async () => {
    const db = await AppDatabase.open();
    const store = new MemoryStore(new SqliteMemoryAdapter(db));
    store.write({ scope: 'scenario', scopeKey: 'p1', text: 'Downsizing the house at 70', importance: 0.9 });
    store.write({ scope: 'global', text: 'User prefers email updates', importance: 0.3 });
    const hits = store.recall('downsiz', { scopeKey: 'p1' });
    expect(hits.length).toBe(1);
    expect(hits[0]!.text).toContain('Downsizing');
    expect(hits[0]!.accessCount).toBe(1); // recall stamped the access
  });
});
