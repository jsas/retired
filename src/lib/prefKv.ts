// UI-preference storage facade (issue #20).
//
// The user's UI choices — collapsed panels, print/export options, welcome
// dismissal, EQ steering crops — are plan-adjacent state that used to live in
// raw localStorage keys (issue D-03): invisible to the .sqlite backup, so a
// restored backup lost them. This module gives every pref blob ONE home and
// ONE backup path, mirroring how the AI chats/settings payloads travel:
//
//   durable home    the store's `kv` table (one row per pref key) — captured
//                   by every full-backup export/import automatically, because
//                   it's just a kv row in the same database file
//   mirror          localStorage under the SAME key names — the store opens
//                   asynchronously (the wasm binary must load first) while
//                   prefs are read synchronously at first paint
//                   (isWelcomeDismissed() in App's initial state, panel
//                   initializers on mount), so the mirror is what first paint
//                   reads before the store's authoritative copy arrives
//
// Writers call prefKV() and get a localStorage-shaped backend; the facade
// write-throughs to both, then debounces one db.save() so a panel toggle or an
// EQ drag frame doesn't serialize the whole database per keystroke. On open,
// AppStore calls attachPrefKv(db) + reconcilePrefKv(), which copies each key
// INTO the store from whichever side is newer-or-only (fill-only in both
// directions — neither side's non-empty payload is ever overwritten by the
// other's) and then refreshes the mirror from the store, so an imported backup
// propagates to the synchronously-read mirror before the next reload.

import type { AppDatabase } from '../data/db';

/** The pref keys, in one place. These are BOTH the kv-table row names and the
 *  legacy localStorage key names — matching the AI-payload precedent, where a
 *  backup's kv row uses the same key the payload occupied in localStorage, so
 *  old backups and old code stay interoperable. */
export const PREF_KEYS = [
  'wealthconsole_panel_state', // collapsed panels + print options + export options + welcome dismissal
  'wealthconsole_eq',          // EQ steering crops (axis-fraction scalars)
] as const;

export type PrefKey = (typeof PREF_KEYS)[number];

/** The localStorage-shaped surface the pref modules program against. */
export interface KV {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

interface WindowWithPrefs {
  __prefKv?: {
    db: AppDatabase | null;
    timer: ReturnType<typeof setTimeout> | null;
  };
}

/** Module-level connection state. Hangs off window in the browser so every
 *  bundle instance shares it (the same reason the AI store passes `kv`
 *  explicitly); in tests it lives on the module. */
const state: NonNullable<WindowWithPrefs['__prefKv']> = (() => {
  try {
    if (typeof window !== 'undefined') {
      (window as WindowWithPrefs).__prefKv ??= { db: null, timer: null };
      return (window as WindowWithPrefs).__prefKv!;
    }
  } catch { /* no window (tests / SSR) — fall through */ }
  return { db: null, timer: null };
})();

/** True once attachPrefKv() has wired the store in. Before that (first paint,
 *  tests) prefKV() degrades to the plain mirror: prefs read and write
 *  localStorage exactly as before this module existed. */
export function prefKvAttached(): boolean {
  return state.db !== null;
}

/** Wire the opened store in. Called by AppStore.open(); idempotent. */
export function attachPrefKv(db: AppDatabase): void {
  state.db = db;
}

/** Forget the store (worktree tests that open multiple stores in sequence). */
export function detachPrefKv(): void {
  state.db = null;
  if (state.timer !== null) {
    clearTimeout(state.timer);
    state.timer = null;
  }
}

/** One debounced save — every pref write in a burst coalesces into a single
 *  db.export() + OPFS/localStorage mirror. A module-scope timer (not per-key)
 *  is the point: the expensive part is serializing the WHOLE database, and
 *  pref writes routinely come in bursts (a drag frame, the mount effect of N
 *  panels each saving once). */
function scheduleSave(): void {
  if (state.db === null) return;
  if (state.timer !== null) clearTimeout(state.timer);
  state.timer = setTimeout(() => {
    state.timer = null;
    try {
      state.db!.save();
    } catch (err) {
      console.warn('Failed to persist UI preferences to the store:', err);
    }
  }, 300);
}

/** The backend the pref modules use. Writes go to the store's kv row AND the
 *  localStorage mirror (same key), then schedule one debounced save; reads
 *  hit the mirror — synchronously available at first paint. With no store
 *  attached yet (or storage unavailable) it degrades to plain localStorage
 *  behaviour, which is what the pre-#20 modules did. */
export function prefKV(): KV {
  return {
    getItem(k: string): string | null {
      try {
        return localStorage.getItem(k);
      } catch {
        return null;
      }
    },
    setItem(k: string, v: string): void {
      try {
        localStorage.setItem(k, v);
      } catch { /* mirror full/blocked — the store copy below still lands */ }
      if (state.db !== null) {
        try {
          state.db.setKv(k, v);
          scheduleSave();
        } catch (err) {
          console.warn('Failed to persist UI preference to the store:', err);
        }
      }
    },
  };
}

/** Copy one key's value between a plain object of raw kv values and the
 *  mirror. Used by the reconcile below and by the backup import in App. */
function mirrorGet(k: PrefKey): string | null {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}

function mirrorSet(k: PrefKey, v: string): void {
  try {
    localStorage.setItem(k, v);
  } catch { /* mirror full/blocked — the store copy still landed */ }
}

/**
 * Reconcile the store's pref rows with the localStorage mirror after open.
 *
 * Fill-only in BOTH directions, per key:
 *   mirror only   → copied into the store (a pref set before the store
 *                   finished opening, or left by an older build that never
 *                   had the kv rows — the one-time migration from #20's
 *                   raw-localStorage era)
 *   store only    → copied to the mirror (a payload that arrived via backup
 *                   import into the store, or a mirror the user's browser
 *                   evicted)
 *   both          → left alone (they were written as a pair by prefKV();
 *                   picking a "newer" winner would need timestamps that the
 *                   legacy blobs don't have, and a divergent pair can only
 *                   exist across a failed mirror write — where the store copy
 *                   is the durable one and syncing the mirror to it is right,
 *                   so the store wins for the mirror refresh, but the store's
 *                   own value is never clobbered)
 *
 * The mirror refresh at the end is what makes an imported backup's prefs show
 * up without a reload: import writes the kv rows, and the next reconcile
 * (next open) or the import handler's own mirror write surfaces them. Returns
 * whether anything changed, so the caller can decide to save.
 */
export function reconcilePrefKv(): boolean {
  const db = state.db;
  if (db === null) return false;
  let changed = false;
  for (const k of PREF_KEYS) {
    const inStore = db.getKv(k);
    const inMirror = mirrorGet(k);
    if (inStore === null && inMirror !== null) {
      db.setKv(k, inMirror); // migration / pre-open write → into the store
      changed = true;
    } else if (inStore !== null && inMirror === null) {
      mirrorSet(k, inStore); // backup-imported / evicted mirror → surface it
      changed = true;
    } else if (inStore !== null && inMirror !== null && inStore !== inMirror) {
      // Divergent pair: the store is the durable home (the mirror write may
      // have failed under quota), so re-derive the mirror from it. The
      // store's own row is left untouched.
      mirrorSet(k, inStore);
    }
  }
  return changed;
}
