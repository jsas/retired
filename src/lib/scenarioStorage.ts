import type { RetirementInputs } from './retirementEngine';

export interface Scenario {
  id: string;
  name: string;
  inputs: RetirementInputs;
}

interface ScenarioState {
  scenarios: Scenario[];
  activeScenarioId: string;
}

const STORAGE_KEY = 'wealthconsole_scenarios';
const SCHEMA_VERSION = 2;

/** Fill in inputs fields added after a scenario was saved. */
export function migrateInputs(inputs: object): RetirementInputs {
  return migrateRecord(inputs as Record<string, unknown>);
}

function migrateRecord(inputs: Record<string, unknown>): RetirementInputs {
  const migrated = { ...inputs };

  // v1 → v2: single annualContribution split per account (it used to all go
  // into the TFSA, so preserve that behaviour).
  if (typeof migrated.annualContribution === 'number' && typeof migrated.tfsaContribution !== 'number') {
    migrated.rrspContribution = 0;
    migrated.tfsaContribution = migrated.annualContribution;
    migrated.taxableContribution = 0;
  }
  delete migrated.annualContribution;

  if (typeof migrated.returnVolatility !== 'number') {
    migrated.returnVolatility = 0.15;
  }

  // v2 → v3: the CPP adjustment calculator treats cppMonthlyAmount as the
  // age-65 amount. Existing scenarios entered an already-adjusted amount, so
  // flag them to preserve their behaviour (no double adjustment).
  if (typeof migrated.cppAdjustedAmount !== 'boolean') {
    migrated.cppAdjustedAmount = true;
  }

  // Pensions added later — back-fill an empty list for pre-existing scenarios.
  if (!Array.isArray(migrated.pensions)) {
    migrated.pensions = [];
  }
  const sp = migrated.spouse as Record<string, unknown> | undefined;
  if (sp && typeof sp === 'object' && !Array.isArray(sp.pensions)) {
    sp.pensions = [];
  }

  return migrated as unknown as RetirementInputs;
}

export function saveScenarioState(scenarios: Scenario[], activeScenarioId: string): void {
  try {
    const payload = {
      version: SCHEMA_VERSION,
      scenarios,
      activeScenarioId,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch (err) {
    // Storage full or unavailable — fail silently, app continues in-memory
    console.warn('Failed to persist scenarios to localStorage:', err);
  }
}

export function loadScenarioState(): ScenarioState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw);

    // Version-tolerant: accept payload object or bare legacy array
    const scenarios: Scenario[] | undefined = Array.isArray(parsed)
      ? parsed
      : parsed?.scenarios;
    const activeScenarioId: string | undefined = parsed?.activeScenarioId;

    if (!Array.isArray(scenarios) || scenarios.length === 0) return null;

    // Basic shape validation — every scenario needs id, name, inputs
    const valid = scenarios.every(
      s => s && typeof s.id === 'string' && typeof s.name === 'string' && s.inputs && typeof s.inputs === 'object'
    );
    if (!valid) return null;

    // Ensure active id still exists in the loaded scenarios
    const resolvedActiveId = scenarios.some(s => s.id === activeScenarioId)
      ? (activeScenarioId as string)
      : scenarios[0].id;

    return {
      scenarios: scenarios.map(s => ({ ...s, inputs: migrateInputs(s.inputs) })),
      activeScenarioId: resolvedActiveId
    };
  } catch {
    return null;
  }
}

export function clearScenarioState(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
