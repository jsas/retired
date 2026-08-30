import { describe, it, expect, beforeEach, vi } from 'vitest';

// The facade debounces its store saves; fake timers make the debounce
// deterministic (advance 350ms past the 300ms window to flush it).
vi.useFakeTimers();
import {
  attachPrefKv, detachPrefKv, prefKV, prefKvAttached, reconcilePrefKv,
} from './prefKv';
import { AppDatabase } from '../data/db';

// Tests run in Node — provide the localStorage the facade mirrors through.
const storage = new Map<string, string>();
beforeEach(() => {
  storage.clear();
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => { storage.set(k, v); },
    removeItem: (k: string) => { storage.delete(k); },
    clear: () => storage.clear(),
  };
});

// Each test opens a real in-memory store (the wasm loads once per suite) and
// detaches it after, so attach/detach cycles in one file stay isolated.
let db: AppDatabase;

/** Flush the facade's debounced save (the 300ms debounce is too slow for a
 *  test; the timer handle isn't exported, so advance fake timers). */
async function flushSave(): Promise<void> {
  await vi.advanceTimersByTimeAsync(350);
}

describe('prefKv facade', () => {
  beforeEach(async () => {
    db = await AppDatabase.open();
    detachPrefKv();
  });

  it('degrades to plain localStorage before a store is attached', () => {
    expect(prefKvAttached()).toBe(false);
    prefKV().setItem('wealthconsole_panel_state', '{"a":1}');
    expect(storage.get('wealthconsole_panel_state')).toBe('{"a":1}');
    expect(db.getKv('wealthconsole_panel_state')).toBeNull(); // nothing reached the store
    expect(prefKV().getItem('wealthconsole_panel_state')).toBe('{"a":1}');
  });

  it('write-throughs to both the store kv row and the mirror', async () => {
    attachPrefKv(db);
    prefKV().setItem('wealthconsole_eq', '{"bandsFrac":{}}');
    expect(storage.get('wealthconsole_eq')).toBe('{"bandsFrac":{}}');
    expect(db.getKv('wealthconsole_eq')).toBe('{"bandsFrac":{}}');
    await flushSave();
  });

  it('coalesces a burst of pref writes into one db.save()', async () => {
    attachPrefKv(db);
    const saveSpy = vi.spyOn(db, 'save');
    for (let i = 0; i < 5; i++) prefKV().setItem('wealthconsole_panel_state', `{"v":${i}}`);
    expect(saveSpy).not.toHaveBeenCalled(); // debounced, not per write
    await flushSave();
    expect(saveSpy).toHaveBeenCalledTimes(1);
    saveSpy.mockRestore();
  });

  it('survives a reopened store: the kv row round-trips through export bytes', async () => {
    attachPrefKv(db);
    prefKV().setItem('wealthconsole_panel_state', '{"open":false}');
    await flushSave();
    const bytes = db.exportBytes();
    db.close();

    const reopened = await AppDatabase.open(bytes);
    expect(reopened.getKv('wealthconsole_panel_state')).toBe('{"open":false}');
    reopened.close();
  });

  describe('reconcilePrefKv', () => {
    it('migrates a mirror-only key into the store (the #20 raw-localStorage era)', async () => {
      storage.set('wealthconsole_eq', '{"bandsFrac":{"x":{"lo":0.2,"hi":0.8}}}');
      attachPrefKv(db);
      expect(reconcilePrefKv()).toBe(true);
      expect(db.getKv('wealthconsole_eq')).toBe('{"bandsFrac":{"x":{"lo":0.2,"hi":0.8}}}');
    });

    it('surfaces a store-only key to the mirror (backup import / evicted mirror)', () => {
      db.setKv('wealthconsole_panel_state', '{"open":true}');
      attachPrefKv(db);
      expect(reconcilePrefKv()).toBe(true);
      expect(storage.get('wealthconsole_panel_state')).toBe('{"open":true}');
    });

    it('leaves an agreeing pair untouched', () => {
      storage.set('wealthconsole_eq', 'same');
      db.setKv('wealthconsole_eq', 'same');
      attachPrefKv(db);
      expect(reconcilePrefKv()).toBe(false);
    });

    it('re-derives a divergent mirror from the durable store copy', () => {
      db.setKv('wealthconsole_eq', 'from-store');
      storage.set('wealthconsole_eq', 'from-mirror');
      attachPrefKv(db);
      reconcilePrefKv();
      // The store row (durable home) wins; the mirror follows it.
      expect(db.getKv('wealthconsole_eq')).toBe('from-store');
      expect(storage.get('wealthconsole_eq')).toBe('from-store');
    });

    it('touches only the known pref keys', () => {
      storage.set('wealthconsole_scenarios', 'legacy-scenarios');
      storage.set('some_other_key', 'untouched');
      db.setKv('config', '{}');
      attachPrefKv(db);
      expect(reconcilePrefKv()).toBe(false);
      expect(storage.get('wealthconsole_scenarios')).toBe('legacy-scenarios');
      expect(storage.get('some_other_key')).toBe('untouched');
      expect(db.getKv('config')).toBe('{}');
    });
  });

  it('detachPrefKv clears the connection and cancels a pending save', async () => {
    attachPrefKv(db);
    const saveSpy = vi.spyOn(db, 'save');
    prefKV().setItem('wealthconsole_eq', '{"x":1}');
    detachPrefKv();
    await flushSave();
    expect(saveSpy).not.toHaveBeenCalled(); // cancelled with the connection
    saveSpy.mockRestore();
  });
});
