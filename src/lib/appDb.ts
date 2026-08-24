import type { AppConfig } from './appConfig';
import { validateAppConfig, saveAppConfig } from './appConfig';
import { saveScenarioState, migrateInputs, type Scenario } from './scenarioStorage';

/**
 * Whole-app database: scenarios + active scenario + engine configuration in
 * a single JSON document for import/export.
 */
export interface AppDb {
  version: number;
  exportedAt: string;
  scenarios: Scenario[];
  activeScenarioId: string;
  config: AppConfig;
}

export const APP_DB_VERSION = 1;

export function buildAppDb(scenarios: Scenario[], activeScenarioId: string, config: AppConfig): AppDb {
  return {
    version: APP_DB_VERSION,
    exportedAt: new Date().toISOString(),
    scenarios,
    activeScenarioId,
    config
  };
}

export function exportAppDb(scenarios: Scenario[], activeScenarioId: string, config: AppConfig): void {
  const db = buildAppDb(scenarios, activeScenarioId, config);
  const blob = new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `wealthconsole-db-${new Date().toISOString().split('T')[0]}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export type ImportResult =
  | { ok: true; db: AppDb }
  | { ok: false; error: string };

export function parseAppDb(json: string): ImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { ok: false, error: 'File is not valid JSON.' };
  }

  const db = parsed as Partial<AppDb>;
  if (!db || typeof db !== 'object') {
    return { ok: false, error: 'File does not contain a RE: tired database.' };
  }

  if (!Array.isArray(db.scenarios) || db.scenarios.length === 0) {
    return { ok: false, error: 'Database has no scenarios.' };
  }
  const scenariosValid = db.scenarios.every(
    s => s && typeof s.id === 'string' && typeof s.name === 'string' && s.inputs && typeof s.inputs === 'object'
  );
  if (!scenariosValid) {
    return { ok: false, error: 'One or more scenarios are malformed.' };
  }

  const config = validateAppConfig(db.config);
  if (!config) {
    return { ok: false, error: 'Engine configuration in the file is invalid.' };
  }

  const activeScenarioId = db.scenarios.some(s => s.id === db.activeScenarioId)
    ? (db.activeScenarioId as string)
    : db.scenarios[0].id;

  return {
    ok: true,
    db: {
      version: typeof db.version === 'number' ? db.version : APP_DB_VERSION,
      exportedAt: typeof db.exportedAt === 'string' ? db.exportedAt : '',
      scenarios: (db.scenarios as Scenario[]).map(s => ({ ...s, inputs: migrateInputs(s.inputs) })),
      activeScenarioId,
      config
    }
  };
}

/** Persist an imported database into both localStorage stores. */
export function persistAppDb(db: AppDb): void {
  saveScenarioState(db.scenarios, db.activeScenarioId);
  saveAppConfig(db.config);
}
