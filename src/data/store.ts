import type { Scenario } from '../lib/scenarioStorage';
import type { AppConfig } from '../lib/appConfig';
import type { RetirementInputs } from '../lib/retirementEngine';
import { validateAppConfig } from '../lib/appConfig';
import { AppDatabase, DB_STORAGE_KEY } from './db';
import type { AppDbDoc } from './schemas';
import { MemoryStore } from '../lib/memory/store';
import { SqliteMemoryAdapter } from '../lib/memory/sqliteAdapter';
import {
  SqliteRevisionStore, inputsChanged, pushRevision,
  type ScenarioRevision,
} from '../lib/scenarioRevisions';

/**
 * The data layer the UI talks to: one opened SQLite store holding scenarios,
 * the active selection and the engine config, mirrored to localStorage.
 *
 * Bootstrap order on first run with an empty store:
 *   1. legacy split keys ('wealthconsole_scenarios' / 'wealthconsole_config')
 *      — imported, then left in place (harmless; the SQL store wins from
 *      then on, and a user can still roll back to an older build);
 *   2. nothing → the caller seeds the first-run examples.
 */

const LEGACY_SCENARIOS_KEY = 'wealthconsole_scenarios';
const LEGACY_CONFIG_KEY = 'wealthconsole_config';

/** Revision-id sequence — Date.now() alone can collide within one ms. */
let revSeq = 0;

export interface AppState {
  scenarios: Scenario[];
  activeScenarioId: string;
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
  private revisions: ScenarioRevision[] = [];
  private constructor(db: AppDatabase) {
    this.db = db;
  }

  static async open(buildDefaults: () => Scenario[]): Promise<{ store: AppStore; state: AppState }> {
    const db = await AppDatabase.open();
    const store = new AppStore(db);
    store.revisionStore = new SqliteRevisionStore(db);
    store.revisions = store.revisionStore.loadAll();

    let scenarios = db.loadScenarios();
    let configRaw = db.loadConfig();
    let activeScenarioId = db.loadActiveScenarioId();

    // First run on this store: try importing the legacy split-key format.
    if (scenarios.length === 0) {
      const legacy = importLegacyKeys();
      if (legacy) {
        scenarios = legacy.scenarios;
        activeScenarioId = legacy.activeScenarioId;
        configRaw ??= legacy.configRaw;
        // Record BEFORE saving so the (empty) DB rows are the diff baseline —
        // the import becomes revision #1.
        store.recordRevisions(scenarios);
        db.saveScenarios(scenarios);
        if (activeScenarioId) db.saveActiveScenarioId(activeScenarioId);
        if (configRaw) db.saveConfig(configRaw);
        db.save();
      }
    }

    // Still nothing — brand-new user: seed the first-run examples.
    if (scenarios.length === 0) {
      scenarios = buildDefaults();
      activeScenarioId = scenarios[0].id;
      store.recordRevisions(scenarios); // seed = the first revision
      db.saveScenarios(scenarios);
      db.saveActiveScenarioId(activeScenarioId);
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
    const resolvedActive = activeScenarioId && scenarios.some(s => s.id === activeScenarioId)
      ? activeScenarioId
      : scenarios[0].id;

    return { store, state: { scenarios, activeScenarioId: resolvedActive, config, configLoadWarning } };
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

  persist(state: { scenarios?: Scenario[]; activeScenarioId?: string; config?: AppConfig; skipRevisions?: boolean }): boolean {
    let wroteRevisions = false;
    if (state.scenarios) {
      if (!state.skipRevisions) wroteRevisions = this.recordRevisions(state.scenarios);
      this.db.saveScenarios(state.scenarios);
    }
    if (state.activeScenarioId != null) this.db.saveActiveScenarioId(state.activeScenarioId);
    if (state.config) this.db.saveConfig(state.config);
    this.db.save();
    return wroteRevisions;
  }

  /** Snapshot the saved inputs of every scenario whose contents changed since
   *  the LAST SAVE (newest revision last; capped per scenario at MAX_REVISIONS
   *  via pushRevision). The comparison baseline is the scenarios table's
   *  current rows — read BEFORE this persist overwrites them — not the newest
   *  revision: a rollback rewinds the live plan while history stays put, and
   *  the next real save must diff against what was actually saved last, or a
   *  rollback would fabricate duplicate entries forever after. Renames and
   *  no-op saves don't spam the history; deleted scenarios' revisions are
   *  pruned alongside. Returns whether anything was written, so the UI knows
   *  to refresh its history view (the store's internal list isn't reactive). */
  private recordRevisions(scenarios: Scenario[]): boolean {
    if (!this.revisionStore) return false;
    const previous = new Map(
      this.db.loadScenarios().map(s => [s.id, s.inputs]),
    );
    const keptIds = new Set(scenarios.map(s => s.id));
    let next = this.revisions.filter(r => keptIds.has(r.scenarioId));
    let added = false;
    for (const s of scenarios) {
      const before = previous.get(s.id);
      if (before && !inputsChanged(before, s.inputs)) continue;
      next = pushRevision(next, {
        id: `rev-${Date.now().toString(36)}-${(revSeq++).toString(36)}`,
        scenarioId: s.id,
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

  /** The whole revision history (all scenarios), newest last. The UI groups
   *  it by scenarioId. */
  allRevisions(): ScenarioRevision[] {
    return this.revisions;
  }

  /** Time-travel rollback: restore the target revision's inputs (a deep copy —
   *  callers own their state) and DELETE every revision newer than it. History
   *  rewinds to that point rather than branching — the user asked for revert
   *  to mean "go back and drop what came after", not "keep both timelines".
   *  The target itself survives as the new newest entry. Returns null when the
   *  revision doesn't exist (or belongs to another scenario). */
  rollbackRevision(scenarioId: string, revisionId: string): RetirementInputs | null {
    const target = this.revisions.find(r => r.id === revisionId && r.scenarioId === scenarioId);
    if (!target) return null;
    // Drop everything strictly newer: same-scenario revisions after the
    // target in (at, id) order. Two revisions can share a millisecond, so
    // id breaks the tie — ids are generated in creation order.
    const kept = this.revisions.filter(r =>
      r.scenarioId !== scenarioId
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

  /** Agent memory — scenario + global records in the same SQL store, so they
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

/** Read the pre-SQLite split localStorage keys, if they exist. */
function importLegacyKeys(): { scenarios: Scenario[]; activeScenarioId: string; configRaw: unknown } | null {
  try {
    const raw = localStorage.getItem(LEGACY_SCENARIOS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const scenarios: Scenario[] | undefined = Array.isArray(parsed) ? parsed : parsed?.scenarios;
    if (!Array.isArray(scenarios) || scenarios.length === 0) return null;
    const activeScenarioId: string | undefined = parsed?.activeScenarioId;
    const configRaw = (() => {
      try {
        const c = localStorage.getItem(LEGACY_CONFIG_KEY);
        return c ? JSON.parse(c) : null;
      } catch {
        return null;
      }
    })();
    return {
      scenarios,
      activeScenarioId: activeScenarioId && scenarios.some(s => s.id === activeScenarioId)
        ? activeScenarioId
        : scenarios[0].id,
      configRaw,
    };
  } catch {
    return null;
  }
}
