import type { Scenario } from '../lib/scenarioStorage';
import type { AppConfig } from '../lib/appConfig';
import { validateAppConfig } from '../lib/appConfig';
import { AppDatabase, DB_STORAGE_KEY } from './db';
import type { AppDbDoc } from './schemas';
import { MemoryStore } from '../lib/memory/store';
import { SqliteMemoryAdapter } from '../lib/memory/sqliteAdapter';

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

export interface AppState {
  scenarios: Scenario[];
  activeScenarioId: string;
  config: AppConfig | null;
}

export class AppStore {
  private db: AppDatabase;
  private memoryStore: MemoryStore | null = null;
  private constructor(db: AppDatabase) {
    this.db = db;
  }

  static async open(buildDefaults: () => Scenario[]): Promise<{ store: AppStore; state: AppState }> {
    const db = await AppDatabase.open();
    const store = new AppStore(db);

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
      db.saveScenarios(scenarios);
      db.saveActiveScenarioId(activeScenarioId);
      db.save();
    }

    const config = configRaw ? validateAppConfig(configRaw) : null;
    const resolvedActive = activeScenarioId && scenarios.some(s => s.id === activeScenarioId)
      ? activeScenarioId
      : scenarios[0].id;

    return { store, state: { scenarios, activeScenarioId: resolvedActive, config } };
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

  persist(state: { scenarios?: Scenario[]; activeScenarioId?: string; config?: AppConfig }): void {
    if (state.scenarios) this.db.saveScenarios(state.scenarios);
    if (state.activeScenarioId != null) this.db.saveActiveScenarioId(state.activeScenarioId);
    if (state.config) this.db.saveConfig(state.config);
    this.db.save();
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
