// App persistence schemas. The PORTABLE shapes (plan inputs, spouse, accounts,
// income, events, debts, benefits, engine config) live in @retired/mcp-tools so
// the web app and the MCP server validate against the same definitions — this
// module re-exports them and adds the app-only whole-database document schema
// plus its input migration, which depend on the app's migrator.

import { z } from 'zod';
import { scenarioSchema, appConfigSchema } from '@retired/mcp-tools/schemas';
import { migrateInputs } from './migrations';

export {
  retirementInputsSchema, scenarioSchema, appConfigSchema,
  cashEventSchema, incomeSourceSchema, spendingBandSchema, reverseMortgageSchema,
  spouseSchema, rdspSchema, fhsaSchema, debtSchema,
} from '@retired/mcp-tools/schemas';

// ---------------------------------------------------------------------------
// The whole-app database document (one row in the SQLite store / one JSON file)
// ---------------------------------------------------------------------------

export const appDbDocSchema = z.object({
  version: z.number(),
  scenarios: z.array(scenarioSchema).min(1),
  activeScenarioId: z.string(),
  config: appConfigSchema,
});

export type AppDbDoc = z.infer<typeof appDbDocSchema>;

/**
 * Parse an untrusted persisted payload into the app database document.
 * Legacy payloads (pre-schema fields, bare scenario arrays) are run through
 * the input migrator first so one code path handles both. Returns null when
 * the payload can't be made to fit — callers fall back to defaults.
 */
export function parseAppDbDoc(raw: unknown): AppDbDoc | null {
  if (!raw || typeof raw !== 'object') return null;
  const candidate = raw as Record<string, unknown>;
  // Migrate each scenario's inputs first (fills fields added by later
  // versions), then validate the result strictly.
  if (Array.isArray(candidate.scenarios)) {
    for (const s of candidate.scenarios) {
      if (s && typeof s === 'object' && 'inputs' in s) {
        (s as { inputs: unknown }).inputs = migrateInputs((s as { inputs: object }).inputs);
      }
    }
  }
  const result = appDbDocSchema.safeParse(candidate);
  if (!result.success) return null;
  // An active id that no longer exists falls back to the first scenario.
  if (!result.data.scenarios.some(s => s.id === result.data.activeScenarioId)) {
    result.data.activeScenarioId = result.data.scenarios[0].id;
  }
  return result.data;
}
