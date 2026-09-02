import type { Plan } from '@retired/engine-core/types';
import type { AppConfig } from '@retired/engine-core/appConfig';
import type { RetirementInputs } from '@retired/engine-core/retirementEngine';
import { validateAppConfig } from '@retired/engine-core/appConfig';
import { AppDatabase, DB_STORAGE_KEY } from './db';
import { attachPrefKv, reconcilePrefKv } from '../lib/prefKv';
import type { AppDbDoc } from './schemas';
import { MemoryStore } from '@retired/mcp-tools/memoryStore';
import { SqliteMemoryAdapter } from '../lib/memory/sqliteAdapter';
import {
  SqliteRevisionStore, inputsChanged, pushRevision,
  type PlanRevision,
} from '../lib/planRevisions';

/**
 * The data layer the UI talks to: one opened SQLite store holding plans,
 * the active selection and the engine config, mirrored to localStorage.
 *
 * Bootstrap order on first run with an empty store: nothing → the caller seeds
 * the first-run examples. The SQL store is the single source of truth; there is
 * no legacy import path (issue #21).
 */

/** Revision-id sequence — Date.now() alone can collide within one ms. Seeded
 *  from the loaded history on every open (see seedRevSeq) so a fresh session
 *  never re-mints a suffix an earlier session already used (issue D-05). */
let revSeq = 0;

/** Advance revSeq past every `rev-<ts>-<n>` suffix already in the loaded
 *  history. Ids are `rev-<base36 ms>-<base36 seq>`; the timestamp halves differ
 *  across sessions in practice, but two sessions opened in the same millisecond
 *  (or one whose clock moved back) could re-emit an identical pair — so the
 *  counter restarts beyond the highest suffix any surviving revision used. */
function seedRevSeq(revisions: Array<{ id: string }>): void {
  let max = 0;
  for (const r of revisions) {
    const m = /^rev-[0-9a-z]+-([0-9a-z]+)$/.exec(r.id);
    if (m) {
      const n = parseInt(m[1], 36);
      if (Number.isFinite(n) && n > max) max = n;
    }
  }
  revSeq = Math.max(revSeq, max + 1);
}

export interface AppState {
  plans: Plan[];
  activePlanId: string;
  config: AppConfig | null;
  /** Set when a stored config existed but failed wholesale validation and was
   *  replaced by defaults (issue #19). Absent when the config loaded cleanly
   *  (or there was never one) — the UI can banner this so the user knows their
   *  custom tax tables didn't survive the load. */
  configLoadWarning?: string;
}

export class AppStore {
  private db: AppDatabase;
  private memoryStore: MemoryStore | null = null;
  private revisionStore: SqliteRevisionStore | null = null;
  private revisions: PlanRevision[] = [];
  private constructor(db: AppDatabase) {
    this.db = db;
  }

  static async open(buildDefaults: () => Plan[]): Promise<{ store: AppStore; state: AppState }> {
    const db = await AppDatabase.open();
    const store = new AppStore(db);
    // Issue #20: the UI-preference facade writes into this store's kv table
    // from here on. Reconcile first — mirror-only blobs (pre-#20 localStorage
    // keys, or a pref set while the wasm was still loading) migrate INTO the
    // store; store-only blobs (an imported backup's prefs) surface to the
    // mirror that first paint reads.
    attachPrefKv(db);
    if (reconcilePrefKv()) db.save();
    store.revisionStore = new SqliteRevisionStore(db);
    store.revisions = store.revisionStore.loadAll();
    seedRevSeq(store.revisions); // D-05: never re-mint a suffix the history already used

    let plans = db.loadScenarios();
    let configRaw = db.loadConfig();
    let activePlanId = db.loadActiveScenarioId();

    // Brand-new user: seed the first-run examples.
    if (plans.length === 0) {
      plans = buildDefaults();
      activePlanId = plans[0].id;
      store.recordRevisions(plans); // seed = the first revision
      db.saveScenarios(plans);
      db.saveActiveScenarioId(activePlanId);
      db.save();
    }

    // Corrupted/invalid stored config: we fall back to defaults. Make it loud —
    // silently resetting the user's custom tax tables would lose real edits
    // (issue #19). Only the wholesale-invalid case warns; a config that
    // validates but is missing newer fields is back-filled by
    // validateAppConfig on purpose and stays silent.
    let config: AppConfig | null = null;
    let configLoadWarning: string | undefined;
    if (configRaw) {
      config = validateAppConfig(configRaw);
      if (!config) {
        const shape = configRaw && typeof configRaw === 'object'
          ? `keys [${Object.keys(configRaw as object).join(', ')}]`
          : typeof configRaw;
        configLoadWarning =
          'Your saved engine settings could not be read and were reset to defaults. '
          + 'Any custom tax tables or engine settings need to be re-entered (or restored from a backup).';
        console.error(
          '[RE:tired] Stored config failed validation and was reset to defaults.',
          `Raw payload: ${shape}, length ${JSON.stringify(configRaw).length} chars.`,
        );
      }
    }
    const resolvedActive = activePlanId && plans.some(s => s.id === activePlanId)
      ? activePlanId
      : plans[0].id;

    return { store, state: { plans, activePlanId: resolvedActive, config, configLoadWarning } };
  }

  /** True when the SQL store is already mirrored locally (sync checks for
   *  the legacy loaders that stay synchronous). */
  static hasLocalData(): boolean {
    try {
      return localStorage.getItem(DB_STORAGE_KEY) != null;
    } catch {
      return false;
    }
  }

  /** Subscribe to durable-save outcomes: listener(err) when a mirror write
   *  fails (OPFS down, or localStorage full when it's the only mirror),
   *  listener(null) when a durable write lands. persist() is synchronous and
   *  the OPFS write resolves later, so the caller can't learn the outcome from
   *  the return value — the UI uses this to show and clear a "changes may not
   *  be saved" banner (issue U-02). Returns an unsubscribe function. */
  onSaveOutcome(listener: (err: unknown | null) => void): () => void {
    return this.db.onSaveOutcome(listener);
  }

  persist(state: { plans?: Plan[]; activePlanId?: string; config?: AppConfig; skipRevisions?: boolean }): boolean {
    let wroteRevisions = false;
    if (state.plans) {
      if (!state.skipRevisions) wroteRevisions = this.recordRevisions(state.plans);
      this.db.saveScenarios(state.plans);
    }
    if (state.activePlanId != null) this.db.saveActiveScenarioId(state.activePlanId);
    if (state.config) this.db.saveConfig(state.config);
    this.db.save();
    return wroteRevisions;
  }

  /** Snapshot the saved inputs of every plan whose contents changed since
   *  the LAST SAVE (newest revision last; capped per plan at MAX_REVISIONS
   *  via pushRevision). The comparison baseline is the plans table's
   *  current rows — read BEFORE this persist overwrites them — not the newest
   *  revision: a rollback rewinds the live plan while history stays put, and
   *  the next real save must diff against what was actually saved last, or a
   *  rollback would fabricate duplicate entries forever after. Renames and
   *  no-op saves don't spam the history; deleted plans' revisions are
   *  pruned alongside. Returns whether anything was written, so the UI knows
   *  to refresh its history view (the store's internal list isn't reactive). */
  private recordRevisions(plans: Plan[]): boolean {
    if (!this.revisionStore) return false;
    const previous = new Map(
      this.db.loadScenarios().map(s => [s.id, s.inputs]),
    );
    const keptIds = new Set(plans.map(s => s.id));
    let next = this.revisions.filter(r => keptIds.has(r.planId));
    let added = false;
    for (const s of plans) {
      const before = previous.get(s.id);
      if (before && !inputsChanged(before, s.inputs)) continue;
      next = pushRevision(next, {
        id: `rev-${Date.now().toString(36)}-${(revSeq++).toString(36)}`,
        planId: s.id,
        at: Date.now(),
        source: 'save',
        inputs: JSON.parse(JSON.stringify(s.inputs)),
      });
      added = true;
    }
    if (!added && next.length === this.revisions.length) return false;
    this.revisions = next;
    this.revisionStore.saveAll(next);
    return true;
  }

  /** The whole revision history (all plans), newest last. The UI groups
   *  it by planId. */
  allRevisions(): PlanRevision[] {
    return this.revisions;
  }

  /** Time-travel rollback: restore the target revision's inputs (a deep copy —
   *  callers own their state) and DELETE every revision newer than it. History
   *  rewinds to that point rather than branching — the user asked for revert
   *  to mean "go back and drop what came after", not "keep both timelines".
   *  The target itself survives as the new newest entry. Returns null when the
   *  revision doesn't exist (or belongs to another plan). */
  rollbackRevision(planId: string, revisionId: string): RetirementInputs | null {
    const target = this.revisions.find(r => r.id === revisionId && r.planId === planId);
    if (!target) return null;
    // Drop everything strictly newer: same-plan revisions after the
    // target in (at, id) order. Two revisions can share a millisecond, so
    // id breaks the tie — ids are generated in creation order.
    const kept = this.revisions.filter(r =>
      r.planId !== planId
      || r.at < target.at
      || (r.at === target.at && r.id <= target.id));
    if (kept.length !== this.revisions.length) {
      this.revisions = kept;
      this.revisionStore?.saveAll(kept);
      this.db.save();
    }
    return JSON.parse(JSON.stringify(target.inputs)) as RetirementInputs;
  }

  exportBytes(): Uint8Array {
    return this.db.exportBytes();
  }

  /** Agent memory — plan + global records in the same SQL store, so they
   *  export/import with the rest of the app. Built lazily; shared per store.
   *  The persist hook mirrors every write to localStorage/OPFS. */
  get memory(): MemoryStore {
    this.memoryStore ??= new MemoryStore(
      new SqliteMemoryAdapter(this.db, () => this.db.save()),
    );
    return this.memoryStore;
  }

  loadDoc(doc: AppDbDoc): void {
    this.db.loadDoc(doc);
    this.db.save();
  }
}
