import { describe, it, expect, beforeEach } from 'vitest';
import {
  DEFAULT_PRINT_OPTIONS, loadPrintOptions, savePrintOptions,
} from './printOptions';
import { AppDatabase } from '../data/db';
import { attachPrefKv, detachPrefKv } from './prefKv';

// Tests run in Node — give the pref facade a mirror to work with.
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

describe('print options persistence', () => {
  it('returns the defaults when nothing is stored', () => {
    expect(loadPrintOptions()).toEqual(DEFAULT_PRINT_OPTIONS);
  });

  it('round-trips saved options', () => {
    savePrintOptions({ includeTimeline: true, includeMonteCarlo: false, includeMilestones: false, includeDetailedTable: true });
    expect(loadPrintOptions()).toEqual({ includeTimeline: true, includeMonteCarlo: false, includeMilestones: false, includeDetailedTable: true });
  });

  it('writes to the store kv when attached, not just the mirror (#20)', async () => {
    const db = await AppDatabase.open();
    attachPrefKv(db);
    savePrintOptions({ includeTimeline: true, includeMonteCarlo: true, includeMilestones: false, includeDetailedTable: true });
    const stored = JSON.parse(db.getKv('wealthconsole_panel_state')!);
    expect(stored.print_opts).toEqual({ includeTimeline: true, includeMonteCarlo: true, includeMilestones: false, includeDetailedTable: true });
    detachPrefKv();
    db.close();
  });

  it('shares the panel-state blob with the other pref writers without clobbering', async () => {
    // CollapsiblePanel/welcome/print/export all read-modify-write the same
    // key; a save must preserve siblings' entries.
    storage.set('wealthconsole_panel_state', JSON.stringify({ welcome_dismissed: true, 'panel:hero': false }));
    savePrintOptions({ ...DEFAULT_PRINT_OPTIONS, includeTimeline: true });
    const state = JSON.parse(storage.get('wealthconsole_panel_state')!);
    expect(state.welcome_dismissed).toBe(true);
    expect(state['panel:hero']).toBe(false);
    expect(state.print_opts.includeTimeline).toBe(true);
  });

  it('tolerates a corrupt blob and returns defaults', () => {
    storage.set('wealthconsole_panel_state', '{not json');
    expect(loadPrintOptions()).toEqual(DEFAULT_PRINT_OPTIONS);
  });
});
