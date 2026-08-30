import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AppDatabase } from '../data/db';
import { attachPrefKv, detachPrefKv, prefKV, reconcilePrefKv } from './prefKv';

// The import half of issue #20: applying a backup's preferences must update
// BOTH homes, or the next reconcile (which trusts the durable store copy)
// would silently revert the import on the following open.

vi.useFakeTimers();

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

async function flushSave(): Promise<void> {
  await vi.advanceTimersByTimeAsync(350);
}

describe('backup import of UI preferences', () => {
  it('writing an imported payload through prefKV keeps store and mirror agreeing', async () => {
    // Live state: the user has their own prefs.
    const db = await AppDatabase.open();
    attachPrefKv(db);
    prefKV().setItem('wealthconsole_panel_state', '{"print_opts":{"includeTimeline":false}}');
    await flushSave();

    // Import: the handler writes the backup's payload through the facade —
    // the exact path App.handleImportFull uses for sel.prefs.
    prefKV().setItem('wealthconsole_panel_state', '{"print_opts":{"includeTimeline":true}}');

    // Both homes now carry the imported payload…
    expect(storage.get('wealthconsole_panel_state')).toBe('{"print_opts":{"includeTimeline":true}}');
    expect(db.getKv('wealthconsole_panel_state')).toBe('{"print_opts":{"includeTimeline":true}}');
    // …so a reconcile (next app open) finds them agreeing, not reverting.
    expect(reconcilePrefKv()).toBe(false);
    expect(storage.get('wealthconsole_panel_state')).toBe('{"print_opts":{"includeTimeline":true}}');

    detachPrefKv();
    db.close();
  });

  it('a mirror-only import (the old approach) WOULD be reverted by reconcile — the regression this guards', async () => {
    // Documents why the import must go through prefKV: mirror-only writes
    // lose to the durable store row at the next open.
    const db = await AppDatabase.open();
    db.setKv('wealthconsole_panel_state', '{"old":true}');
    attachPrefKv(db);
    storage.set('wealthconsole_panel_state', '{"imported":true}'); // mirror-only write
    reconcilePrefKv();
    expect(storage.get('wealthconsole_panel_state')).toBe('{"old":true}'); // import silently lost
    db.close();
  });
});
