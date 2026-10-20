// The agent's tool surface: a typed API the model uses to READ the current
// scenario, RUN the engine against it, and PROPOSE changes.
//
// Every argument shape is a Zod schema — the same source of truth the data
// layer uses — so a hallucinated field name or out-of-range number is rejected
// before it touches anything. The JSON-Schema view of each schema is what gets
// advertised to the provider.
//
// Reads are pure (get_scenario, run_projection, compare_scenarios, the
// strategies/solver/monte-carlo backends, get_schedule). Mutations never apply
// themselves: every propose_* tool returns a proposed PATCH and the UI requires
// the user to confirm it (confirm-before-apply). There is no path from model
// output to plan state that bypasses that card.

import { z } from 'zod';
import type { RetirementInputs, RetirementResults, YearlyBreakdown } from '@retired/engine-core/retirementEngine';
import { calculateHousehold, householdOutcome } from '@retired/engine-core/retirementEngine';
import { looksLikeUnsetPlan } from '@retired/engine-core/exampleScenarios';
import { toHousehold, baselineSpouse, personPlanFromSpouse } from '@retired/engine-core/householdTypes';
import type { AppConfig } from '@retired/engine-core/appConfig';
import { runStrategies, type StrategyFilter } from '@retired/engine-core/strategies';
import { solveSustainableSpending } from '@retired/engine-core/spendingSolver';
import { runMonteCarlo } from '@retired/engine-core/monteCarlo';
import {
  retirementInputsSchema, spouseSchema, incomeSourceSchema,
  cashEventSchema, reverseMortgageSchema, rdspSchema, fhsaSchema, debtSchema, givingStreamSchema,
} from './schemas';
import { buildRevertPlan, encodeRevertPatch, type PlanCheckpoint } from './checkpoints';
import { MemoryStore } from './memoryStore';
import type { AgentToolCall, ToolSpec } from './toolTypes';
import {
  NAV_CATALOG, rankPages, hashForEntry, canonicalView, pageForView, searchablePages,
  type NavEntry, type View,
} from './navigation';

// ---------------------------------------------------------------------------
// Tool argument schemas
// ---------------------------------------------------------------------------

const sectionSchema = z.enum(['full', 'summary', 'accounts', 'benefits', 'spending', 'spouse']);

const getScenarioArgs = z.object({
  section: sectionSchema.default('full')
    .describe('Which slice of the plan to return. Use summary/accounts/benefits/spending/spouse to save tokens; full returns everything.'),
});

const runProjectionArgs = z.object({
  overrides: z.record(z.string(), z.unknown()).optional()
    .describe('Optional flat patch of top-level RetirementInputs fields to apply to a COPY of the plan before running (what-if). Validated against the scenario schema; invalid entries are reported, not applied.'),
});

const compareScenariosArgs = z.object({
  overrides: z.record(z.string(), z.unknown()).optional()
    .describe('Flat patch of top-level RetirementInputs fields defining ONE variant to compare against the current plan. Use variants for several.'),
  variants: z.array(z.object({
    label: z.string().optional().describe('Short name shown for this variant (e.g. "Retire at 60").'),
    overrides: z.record(z.string(), z.unknown())
      .describe('Flat patch of top-level RetirementInputs fields defining this variant.'),
  })).max(4).optional()
    .describe('Up to 4 variants compared in ONE call (e.g. three retirement ages). Current plan is always included as the baseline. Takes precedence over the singular overrides.'),
});

/** Models often skip the `changes` wrapper and pass currentAge / rrspBalance
 *  at the top level. MCP validates the advertised schema before
 *  executeToolCall, so `changes` cannot be required — wrap leftover keys
 *  here so either shape reaches proposePlan. */
function wrapPlanChanges(raw: unknown): { changes: Record<string, unknown>; rationale?: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { changes: {} };
  const obj = raw as Record<string, unknown>;
  const rationale = typeof obj.rationale === 'string' ? obj.rationale : undefined;
  if (obj.changes != null && typeof obj.changes === 'object' && !Array.isArray(obj.changes)) {
    return { changes: obj.changes as Record<string, unknown>, rationale };
  }
  const { rationale: _r, changes: _c, ...rest } = obj;
  return { changes: rest, rationale };
}

const proposePlanArgs = z.object({
  changes: z.record(z.string(), z.unknown()).optional()
    .describe('Plan numbers the user just gave: currentAge, retirementAge, desiredSpending, rrspBalance, tfsaBalance, taxableBalance, cashCushionBalance, contributions, provinceCode, cpp/oas, etc. Scalars only. Prefer this wrapper; bare top-level fields also work. Call this immediately — do not recap the numbers in prose.'),
  rationale: z.string().optional()
    .describe('One sentence on the card (e.g. "Start the plan with the numbers you gave").'),
}).passthrough();

const proposeSpouseArgs = z.object({
  scenarioId: z.string().optional()
    .describe('Id of an existing saved plan to link as the partner. Preferred when the partner already has a plan.'),
  enabled: z.boolean().optional()
    .describe('false unlinks the partner (this plan becomes single). true with changes mints a new partner plan and links it.'),
  name: z.string().optional()
    .describe('Name for a newly created partner plan (default "Partner").'),
  changes: z.record(z.string(), z.unknown()).optional()
    .describe('Person fields for a NEW partner plan (currentAge, retirementAge, balances, contributions, cpp/oas, desiredSpending). Ignored when scenarioId is set. Use {"enabled":false} or enabled:false to unlink.'),
  rationale: z.string().optional(),
});

const manageIncomeArgs = z.object({
  action: z.enum(['add', 'update', 'remove']),
  target: z.string().min(1).optional()
    .describe('For update/remove: the income source id, or its label if unique (e.g. "Work DB").'),
  changes: z.record(z.string(), z.unknown()).optional()
    .describe('For update: the income-source fields to change. For add: also accepted — fields here merge under any top-level ones.'),
  rationale: z.string().optional(),
}).passthrough();

const proposeSpendingBandsArgs = z.object({
  bands: z.array(z.object({ fromAge: z.number(), pctOfBase: z.number() }))
    .describe('Spending phases: pctOfBase (fraction of desiredSpending, e.g. 1, 0.85, 0.7) applying fromAge until the next band. Replaces the whole set.'),
  rationale: z.string().optional(),
});

// Market hypothesis (issue #138). Each anchor sets the expected return at an
// age; volatility is optional (absent = the plan's flat returnVolatility holds).
const marketPeriodSchema = z.object({
  age: z.number().describe('The age this anchor applies at.'),
  return: z.number().describe('Expected annual return (decimal, e.g. -0.30 for a 30% crash, 0.07 for 7% growth). May be negative.'),
  volatility: z.number().min(0).optional().describe('Annual return standard deviation at this age (decimal, e.g. 0.25). Omit to keep the plan\'s flat volatility.'),
});

const proposeMarketPeriodsArgs = z.object({
  periods: z.array(marketPeriodSchema)
    .describe('Market-hypothesis anchors, any order. The engine sorts by age and interpolates linearly between them; outside the outermost anchors the flat investmentReturn/returnVolatility hold. The projection follows the return curve; volatility shapes Monte Carlo only. Empty array clears the hypothesis (back to flat constants). Replaces the whole set.'),
  rationale: z.string().optional(),
});

const proposeRevertArgs = z.object({
  checkpoint: z.string().optional()
    .describe('Which checkpoint to revert to: its label, or omit for the most recent one. Labels come from the change cards the user approved ("Add pension").'),
  rationale: z.string().optional(),
});

const manageCashEventArgs = z.object({
  action: z.enum(['add', 'update', 'remove']),
  target: z.string().min(1).optional()
    .describe('For update/remove: the cash event id, or its label if unique (e.g. "Downsize").'),
  changes: z.record(z.string(), z.unknown()).optional()
    .describe('For update: the cash-event fields to change. For add: also accepted — fields here merge under any top-level ones.'),
  rationale: z.string().optional(),
}).passthrough();

const manageDebtArgs = z.object({
  action: z.enum(['add', 'update', 'remove']),
  target: z.string().min(1).optional()
    .describe('For update/remove: the debt id, or its label if unique (e.g. "Mortgage").'),
  changes: z.record(z.string(), z.unknown()).optional()
    .describe('For update: the debt fields to change. For add: also accepted — fields here merge under any top-level ones.'),
  rationale: z.string().optional(),
}).passthrough();

const manageGivingArgs = z.object({
  action: z.enum(['add', 'update', 'remove']),
  target: z.string().min(1).optional()
    .describe('For update/remove: the giving stream id, or its label if unique (e.g. "Parish").'),
  // #194: the add fields declared explicitly — models (and the schema JSON
  // they see) otherwise guess at pct/basis, which only pct-mode streams
  // need. Fixed-mode adds are just {label, mode:'fixed', amount, fromAge}.
  label: z.string().optional().describe('For add: the stream name, e.g. "Food Bank".'),
  mode: z.enum(['pct', 'fixed']).optional().describe('For add: "fixed" = amount $/yr (default); "pct" = pct of income.'),
  amount: z.number().optional().describe('For add, mode "fixed": dollars per year (today\'s dollars).'),
  pct: z.number().optional().describe('For add, mode "pct": percentage points of income (10 = 10%).'),
  basis: z.enum(['gross', 'net']).optional().describe('For add, mode "pct" only: which income the % rides on.'),
  fromAge: z.number().optional().describe('For add: first giving age (inclusive).'),
  toAge: z.number().nullable().optional().describe('For add: last giving age; null/omit = for life.'),
  changes: z.record(z.string(), z.unknown()).optional()
    .describe('For update: the giving-stream fields to change. For add: also accepted — fields here merge under any top-level ones.'),
  rationale: z.string().optional(),
}).passthrough();

const proposeAccountArgs = z.object({
  kind: z.enum(['rm', 'reverse_mortgage', 'rdsp', 'fhsa'])
    .describe('Which special account: rm (reverse mortgage), rdsp, or fhsa.'),
  changes: z.record(z.string(), z.unknown())
    .describe('Fields to set. {"enabled":true,...} to turn it on, {"enabled":false} to turn it off. Reverse mortgage needs homeValue, appreciationRate, interestRate (and optionally draws or top-up). RDSP needs balance, contribution, familyIncome, dtcEligible. FHSA needs balance and contribution.'),
  rationale: z.string().optional(),
});


const runStrategiesArgs = z.object({
  categories: z.array(z.enum(['cpp', 'oas', 'pension_timing', 'withdrawal_order', 'reverse_mortgage', 'work'])).optional()
    .describe('Scope the explorer to specific lever families (e.g. ["cpp","oas"] for benefit timing only, ["pension_timing"] for employer-pension start ages). Omit for all.'),
  maxVariants: z.number().int().min(1).max(50).optional()
    .describe('Cap the number of variants returned (best first).'),
}).describe('Optional filters; call with {} for the full exploration.');

const solveSpendingArgs = z.object({
  targetSuccessRate: z.number().min(0.5).max(0.99).default(0.9)
    .describe('Target Monte Carlo success rate as a fraction, e.g. 0.9 = 90% chance the money lasts to max age.'),
  runs: z.number().int().min(50).max(2000).default(500)
    .describe('Market futures to simulate per candidate. More = smoother, slower.'),
  overrides: z.record(z.string(), z.unknown()).optional()
    .describe('Optional flat patch of top-level scalar fields to apply to a COPY of the plan before solving (what-if: solve under different assumptions).'),
});

const runMonteCarloArgs = z.object({
  runs: z.number().int().min(50).max(2000).default(500),
  volatility: z.number().min(0).max(0.5).optional()
    .describe('Annual return standard deviation. Defaults to the plan\'s returnVolatility.'),
  overrides: z.record(z.string(), z.unknown()).optional()
    .describe('Optional flat patch of top-level scalar fields to apply to a COPY of the plan before simulating (what-if: success rate under different assumptions).'),
});

const getScheduleArgs = z.object({
  fromAge: z.number().optional().describe('First age to include (default: currentAge).'),
  toAge: z.number().optional().describe('Last age to include (default: maxAge). Keep ranges small to save tokens.'),
  stride: z.number().int().min(1).max(20).optional()
    .describe('Return every Nth year (e.g. 5 covers a whole horizon in one call). The LAST year in range is always included.'),
  overrides: z.record(z.string(), z.unknown()).optional(),
});

const rememberArgs = z.object({
  text: z.string().min(1).max(500)
    .describe('The fact to remember, one or two self-contained sentences (e.g. "Spouse\'s DB pension pays $1,200/mo from 65" — never "it pays that").'),
  scope: z.enum(['scenario', 'global']).default('scenario')
    .describe('scenario = about this plan (shown in chats on this scenario). global = about the USER, travels across plans (e.g. "wants to retire to Nova Scotia").'),
  importance: z.number().min(0).max(1).default(0.5)
    .describe('0..1: how important this fact is. Reserve 0.9+ for decisions and constraints ("user refuses to touch RRSP"), 0.3 for color.'),
  keywords: z.array(z.string().min(1)).max(12).optional()
    .describe('Category words a future question might use that are NOT in the text itself — the hypernyms of what the fact is about (text "likes oranges" → ["fruit", "food", "preference"]; "wants to retire to Nova Scotia" → ["location", "province", "move"]). The fact\'s own words are indexed automatically; only add what a later query would say differently.'),
  rationale: z.string().optional(),
});

const recallArgs = z.object({
  query: z.string().optional()
    .describe('Search words — single keywords work best (they match by word, not phrase; "fruit" finds "likes oranges" if it was saved with that keyword). Omit for the top-ranked memories outright.'),
  limit: z.number().int().min(1).max(20).default(6),
});

const openScenarioArgs = z.object({
  scenarioId: z.string().min(1).optional()
    .describe('Id of the saved scenario to open (from the ids given in your context).'),
  name: z.string().min(1).optional()
    .describe('Alternatively, the scenario NAME — matched case-insensitively; must be unambiguous.'),
}).refine(v => v.scenarioId != null || v.name != null, { message: 'Give scenarioId or name.' })
  .refine(v => v.scenarioId == null || v.name == null, { message: 'Give scenarioId or name, not both.' });

const saveScenarioAsArgs = z.object({
  name: z.string().min(1).max(80)
    .describe('Name for the new scenario (e.g. "Downsized at 65"). Duplicates are allowed.'),
});

const listScenariosArgs = z.object({
  action: z.enum(['list', 'open', 'save_as']).optional().default('list')
    .describe('list = enumerate saved plans. open = switch to one (give scenarioId or name). save_as = snapshot the current plan under a new name and open the copy.'),
  withDetails: z.boolean().default(false)
    .describe('For list: true = include the key numbers of each plan (ages, balances, spending, benefits) so you can compare saved plans without opening them. Omit/false for a compact list.'),
  scenarioId: z.string().min(1).optional()
    .describe('For open: id of the saved scenario (from the ids given in your context).'),
  name: z.string().min(1).max(80).optional()
    .describe('For open: the scenario NAME (case-insensitive, must be unique). For save_as: the name of the new copy.'),
}).superRefine((v, ctx) => {
  if (v.action === 'open' && v.scenarioId == null && v.name == null) {
    ctx.addIssue({ code: 'custom', message: 'open requires scenarioId or name.' });
  }
  if (v.action === 'open' && v.scenarioId != null && v.name != null) {
    ctx.addIssue({ code: 'custom', message: 'Give scenarioId or name, not both.' });
  }
  if (v.action === 'save_as' && (v.name == null || v.name.trim() === '')) {
    ctx.addIssue({ code: 'custom', message: 'save_as requires a name.' });
  }
});

// Navigation: plain-words page lookup (find_page; empty query = site map) and the
// page-switch proposal (propose_navigate). The lookups are pure reads; the
// proposal is a confirm card, not a plan mutation (empty patch, no
// checkpoint). The model counting on a find_page for "where" is trained by
// the same catalog the sitemap artifacts emit.
const findPageArgs = z.object({
  query: z.string().optional()
    .describe('Words to match (e.g. "tfsa room", "monte carlo", "tax table"). Omit or pass empty to return the full site map.'),
});

const proposeNavigateArgs = z.object({
  view: z.string().min(1)
    .describe('View id, from find_page (e.g. "projection", "optimizer", "monte-carlo"). Do not confuse route names with view ids; the resolver normalizes for you.'),
  label: z.string().min(1)
    .describe('Confirm-card label, e.g. "Open the Monte Carlo page".'),
  rationale: z.string().optional(),
});

// Exported so the fine-tuning spike's eval gate (training/) can validate args
// against the same Zod schemas the executor enforces — the executor itself is
// the only runtime consumer.
export const TOOL_SCHEMAS = {
  get_scenario: getScenarioArgs,
  run_projection: runProjectionArgs,
  compare_scenarios: compareScenariosArgs,
  run_strategies: runStrategiesArgs,
  solve_spending: solveSpendingArgs,
  run_monte_carlo: runMonteCarloArgs,
  get_schedule: getScheduleArgs,
  propose_plan: proposePlanArgs,
  propose_spouse: proposeSpouseArgs,
  propose_spending_bands: proposeSpendingBandsArgs,
  propose_market_periods: proposeMarketPeriodsArgs,
  propose_account: proposeAccountArgs,
  propose_revert: proposeRevertArgs,
  manage_cash_event: manageCashEventArgs,
  manage_income: manageIncomeArgs,
  manage_debt: manageDebtArgs,
  manage_giving: manageGivingArgs,
  remember: rememberArgs,
  recall: recallArgs,
  list_scenarios: listScenariosArgs,
  find_page: findPageArgs,
  propose_navigate: proposeNavigateArgs,
} as const;

export type AgentToolName = keyof typeof TOOL_SCHEMAS;

export function isAgentToolName(name: string): name is AgentToolName {
  return name in TOOL_SCHEMAS;
}

/** Top-level scalar fields the agent may propose changing via propose_plan.
 *  Structural blocks (spouse, events, income, spendingBands, reverseMortgage,
 *  rdsp, fhsa, debts) go through manage_* / propose_account / propose_spouse. */
export const EDITABLE_FIELDS = new Set([
  'currentAge', 'retirementAge', 'maxAge',
  'rrspBalance', 'tfsaBalance', 'taxableBalance', 'cashCushionBalance',
  'rrspContribution', 'tfsaContribution', 'taxableContribution',
  // Contribution room (issue #24): a number turns room-tracking on; null clears
  // it back to unlimited (no enforcement).
  'tfsaRoom', 'rrspRoom',
  'investmentReturn', 'returnVolatility',
  'provinceCode',
  'cppStartAge', 'cppMonthlyAmount', 'oasStartAge', 'oasYearsInCanada',
  'desiredSpending', 'withdrawalOrder',
]);

/** Structural top-level keys that are refused in flat override patches — they
 *  have dedicated propose_* tools with element-level validation. */
const STRUCTURAL_FIELDS = new Set([
  'spouse', 'spouseSource', 'events', 'income', 'spendingBands', 'reverseMortgage', 'rdsp', 'fhsa', 'debts', 'marketPeriods', 'giving',
]);

// ---------------------------------------------------------------------------
// Tool catalog: name → description + zod schema (single source of truth)
// ---------------------------------------------------------------------------

/** One catalog entry: the description both the LLM and the MCP server
 *  advertise, and the zod schema that validates the arguments. */
export interface ToolCatalogEntry {
  description: string;
  schema: z.ZodType;
}

/** The advertised tool surface as data. `toolSpecs()` renders this for LLM
 *  providers (zod → JSON Schema); the MCP server (`@retired/mcp-server`)
 *  registers every entry with the official SDK — so both consumers see the
 *  same names, descriptions, and argument shapes from one definition. */
export const TOOL_CATALOG: Record<AgentToolName, ToolCatalogEntry> = {
  get_scenario: { description: 'Read the current retirement scenario (plan inputs: ages, balances, contributions, benefits, spending, charitable giving, withdrawal order, spouse, income sources, reverse mortgage).', schema: getScenarioArgs },
  run_projection: { description: 'Run the engine on the current plan (optionally with overrides) and return the verdict: funded/depleted, key ages, tax, and a compact year digest.', schema: runProjectionArgs },
  compare_scenarios: { description: 'Compare the current plan against one or more variants (up to 4) defined by flat override patches, and return all outcomes plus deltas vs current. Use for "retire at 60 vs 65 vs 70?".', schema: compareScenariosArgs },
  run_strategies: { description: 'Run the deterministic strategy explorer: rank named lever variants (CPP/OAS timing, employer-pension start ages, withdrawal order, reverse mortgage, part-time work) against the current plan by sustainable spending, tax, and GIS. Optionally scope with categories/maxVariants. Use for "what levers help most?" steering.', schema: runStrategiesArgs },
  solve_spending: { description: 'Invert the verdict: find the most the user can spend per year (after tax) for a target Monte Carlo success rate. Accepts overrides for what-if solving. Use for "how much can I safely spend?"', schema: solveSpendingArgs },
  run_monte_carlo: { description: 'Run the Monte Carlo simulation on the current plan (optionally with overrides) and return the success rate, median final balance, and depletion spread across market futures.', schema: runMonteCarloArgs },
  get_schedule: { description: 'Return the year-by-year projection table (balances, withdrawals, tax, CPP/OAS/GIS, pension, employment, reverse mortgage) for an age range. Use stride to cover a whole horizon in one call.', schema: getScheduleArgs },
  propose_plan: { description: 'PROPOSE a batch of plan numbers as ONE confirm card. Args: { "changes": { currentAge, retirementAge, desiredSpending, rrspBalance, ... } }. Bare top-level fields also work. Call this as soon as the user gives ages, spending, balances, province, CPP/OAS, or contributions — even on a brand-new plan. Do NOT recap the numbers in prose first; the card IS the recap. Scalars only. Spouse, income, debts, events, and special accounts use their own tools.', schema: proposePlanArgs },
  propose_spouse: { description: 'PROPOSE linking a partner (another saved plan), creating a new partner plan then linking it, or unlinking. Partner numbers live on that plan, not inline. User confirms.', schema: proposeSpouseArgs },
  propose_spending_bands: { description: 'PROPOSE replacing the spending phases (go-go/slow-go/no-go as % of base spending by age; dollar amounts are desiredSpending × pctOfBase). User confirms.', schema: proposeSpendingBandsArgs },
  propose_market_periods: { description: 'PROPOSE setting a market hypothesis: per-age expected-return (and optional volatility) anchors the engine interpolates between, so you can model a crash, boom, or choppy stretch instead of one constant return. The projection follows the return curve; volatility shapes Monte Carlo only. Pass an empty array to clear the hypothesis (back to flat constants). User confirms.', schema: proposeMarketPeriodsArgs },
  manage_income: { description: 'PROPOSE adding, updating, or removing an income source (pension, employment, self-employment, or rental). action "add" takes the source fields (endAge a number or explicit null). action "update"/"remove" take target (id or unique label). User confirms.', schema: manageIncomeArgs },
  manage_cash_event: { description: 'PROPOSE adding, updating, or removing a cash event (inflow to an account, or outflow adding to spending). action "add" takes the event fields. action "update"/"remove" take target (id or unique label). User confirms.', schema: manageCashEventArgs },
  manage_debt: { description: 'PROPOSE adding, updating, or removing a debt (mortgage or consumer: credit card, loan, line of credit). The balance compounds at its interest rate; the monthly payment is funded from spending until paid off. action "add" takes the debt fields. action "update"/"remove" take target (id or unique label). User confirms.', schema: manageDebtArgs },
  manage_giving: { description: 'PROPOSE adding, updating, or removing a charitable giving stream (household-level; all receipts pool into ONE donation tax credit). mode "fixed" (the default): amount dollars/yr (NOT indexed for inflation) — a fixed add is just {label, mode:"fixed", amount, fromAge}; pct/basis are pct-mode-only and auto-filled. mode "pct": pct of income in percentage points (10 = 10%), basis "gross" (pre-tax income stack) or "net" (after-tax). fromAge/toAge window (toAge null or omitted = for life). The credit follows CRA rules: 14% on the first $200, 29%/33% above, per-province rates, 75%-of-income claim cap, non-refundable. action "add" takes the stream fields (top level, or inside changes). action "update"/"remove" take target (id or unique label). User confirms.', schema: manageGivingArgs },
  propose_account: { description: 'PROPOSE enabling/configuring (or disabling) a special account: kind "rm" (reverse mortgage), "rdsp", or "fhsa". Pass changes with the fields to set; {"enabled":false} turns it off. User confirms.', schema: proposeAccountArgs },
  propose_revert: { description: 'PROPOSE rolling the plan back to a checkpoint — an automatic snapshot taken just before a previously-approved change landed. Use when an experiment did not pan out ("that made it worse, undo it"). User confirms.', schema: proposeRevertArgs },
  remember: { description: 'Save a durable fact to memory for later conversations — about THIS plan (scope "scenario": a decision the user made, a figure they quoted, a constraint like "cannot touch the RRSP") or about the user themselves (scope "global": preferences, life plans). ONLY when clearly important; never for numbers already in the plan or in computed results. When the fact uses a specific term a future question might generalize (oranges → fruit), pass those category words as keywords so the fact can be found again.', schema: rememberArgs },
  recall: { description: 'Search what you remember (facts saved in earlier conversations). Matching is by KEYWORD — query with the words a category would be filed under ("fruit", "pension", "city"), not a full sentence. If nothing matches, the closest memories are returned anyway; use them before telling the user you don\'t know. Omit the query to list the most important current memories — do this at the START of a conversation to ground yourself.', schema: recallArgs },
  list_scenarios: { description: 'Saved scenarios. action "list" (default) enumerates names/ids and which is active; withDetails adds each plan\'s key numbers. action "open" switches to another saved plan (scenarioId or name). action "save_as" snapshots the current plan under a new name and opens the copy.', schema: listScenariosArgs },
  find_page: { description: 'Search the site\'s page map by any words a user would type ("tfsa room", "monte carlo", "tax table"). Returns the ranked matches, each with route/hash one can share, plus the current page flagged as "you are already here". Omit query (or pass empty) for the full site map. Use whenever the user asks WHERE something lives or what pages exist.', schema: findPageArgs },
  propose_navigate: { description: 'PROPOSE switching the app to a named view (UI-level navigation — not a plan mutation). Resolves page words to their view — "steering" → dashboard, "monte carlo" → montecarlo, "solver" → solver — name it from find_page. Shows a confirm card with the destination; on approval the app opens it. When unbound (no UI in this host) returns the #/hash so the model can share the link instead.', schema: proposeNavigateArgs },
};

/** Tool specs advertised to providers: the catalog rendered as JSON Schema. */
export function toolSpecs(): ToolSpec[] {
  return Object.entries(TOOL_CATALOG).map(([name, entry]) => ({
    name,
    description: entry.description,
    jsonSchema: z.toJSONSchema(entry.schema) as Record<string, unknown>,
  }));
}

// ---------------------------------------------------------------------------
// Execution context + results
// ---------------------------------------------------------------------------

export interface ToolContext {
  /** The plan exactly as the user sees it in the sidebar (resolved inputs). */
  inputs: RetirementInputs;
  config: AppConfig;
  scenarioName: string;
  /** Names/ids of other saved scenarios, for orientation. */
  scenarioList: Array<{ id: string; name: string }>;
  /** Which of scenarioList is currently open (list_scenarios marks it).
   *  Optional so tests and 'off'-mode callers can omit it — the marker is
   *  then simply absent from the listing. */
  activeScenarioId?: string;
  /** Full inputs for an arbitrary saved scenario by id (list_scenarios'
   *  withDetails for non-active plans). Optional — callers that don't supply
   *  it get compact lines for the other scenarios instead of numbers. */
  scenarioInputsById?: (id: string) => RetirementInputs | undefined;
  /** Automatic checkpoints (snapshots taken before each approved change),
   *  newest last, for propose_revert. Optional so tests and 'off'-mode callers
   *  can omit it — revert then simply reports that no checkpoints exist. */
  checkpoints?: PlanCheckpoint[];
  /** The agent memory store (scoped + global memories). Optional so tests and
   *  'off'-mode callers can omit it — remember/recall then report that memory
   *  is unavailable. `scenarioId` keys scenario-scoped memories. */
  memory?: MemoryStore;
  memoryScenarioId?: string;
  /** Open another saved scenario (the sidebar-switch path). Optional so tests
   *  and 'off'-mode callers can omit it — list_scenarios action "open" then errors. */
  onOpenScenario?: (id: string) => void;
  /** Snapshot the current live inputs as a new named scenario; returns its id.
   *  Optional for the same reason — list_scenarios action "save_as" then errors. */
  onSaveScenarioAs?: (name: string) => string;
  /** The view the chat-session of a user is visiting now (for the ambient
   *  system prompt "current page" line and find_page's "already here" tag).
   *  Optional: tests / MCP-server-host callers omit it, and the prompt line
   *  simply goes absent (as it does in 'off'-mode). */
  currentView?: View;
  /** True when the host renders a UI the user can move (confirm cards route
   *  via propose_navigate). When absent (MCP hosts without a page, plain
   *  tests), propose_navigate returns the #/hash for the model to share —
   *  there's no view to switch. The flag only GATES the card; switching
   *  itself happens in the host after the user approves (see MutationProposal). */
  canNavigate?: boolean;
  /** Assistant language (Canadian English / French). Optional — hosts that
   *  omit it get English replies. UI chrome stays English either way. */
  locale?: 'en-CA' | 'fr-CA';
}

export type ToolOutcome =
  | { kind: 'result'; content: string }
  | {
      kind: 'mutation';
      /** The proposed change as a partial inputs patch (merged over the plan
       *  on approval). Always present — structural proposals put their block
       *  here; single-field ones put { [field]: value }. UI-only mutations
       *  (propose_navigate) carry an empty patch and use `navigate` instead. */
      patch: Partial<RetirementInputs>;
      /** Set on page-navigation proposals: the view to open on approval. The
       *  UI routes it (host setView) instead of merging a plan patch, and no
       *  checkpoint is recorded — the plan never changed. */
      navigate?: View;
      /** Short label for the card ("Set CPP start age", "Add spouse"). */
      label: string;
      /** Human-readable preview lines shown on the confirm card. */
      preview: Record<string, unknown>;
      rationale?: string;
      /** Revert proposals encode absent-at-checkpoint fields with a sentinel
       *  (JSON can't carry undefined); the UI must decode before applying. */
      revert?: true;
      /** Mint a partner plan on approval, then link this plan to it. The host
       *  patch is empty — create-and-link is the side effect, applied by the
       *  host after the user confirms (never at propose time). */
      createPartner?: { name: string; inputs: RetirementInputs };
    }
  | { kind: 'error'; content: string };

const money = (v: number) =>
  new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 }).format(v);

function zodIssues(error: z.ZodError): string {
  return error.issues.map(i => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
}

/** Tolerate stringified scalars from the model ("65", "null", "true"): parse
 *  as-given first, and only if the schema rejects a STRING, retry with the
 *  obvious scalar forms coerced. Raw-first ordering means legitimate string
 *  fields (labels, province codes) are never mangled — coercion only rescues
 *  values the schema already rejected. Used on the top-level scalar paths
 *  (propose_plan, flat overrides). */
function safeParseTolerant(schema: z.ZodType, value: unknown) {
  const raw = schema.safeParse(value);
  if (raw.success || typeof value !== 'string') return raw;
  return schema.safeParse(coerceScalar(value));
}

/** The coercion side of safeParseTolerant: a numeric string becomes a number,
 *  "null"/"true"/"false" become their scalars; anything else passes through
 *  untouched so the retry fails the same way the raw attempt did. */
function coerceScalar(value: string): unknown {
  const s = value.trim();
  if (/^-?(?:\d+\.?\d*|\.\d+)$/.test(s)) return Number(s);
  const lower = s.toLowerCase();
  if (lower === 'null') return null;
  if (lower === 'true') return true;
  if (lower === 'false') return false;
  return value;
}

// ---------------------------------------------------------------------------
// Executor
// ---------------------------------------------------------------------------

/**
 * Validate and run one tool call against the context. Pure (the engine runs
 * in-memory); the ONLY outcome with side effects is the 'mutation' proposal,
 * which the caller turns into a user-confirm card.
 */
export function executeToolCall(ctx: ToolContext, call: AgentToolCall): ToolOutcome {
  if (!isAgentToolName(call.name)) {
    return { kind: 'error', content: `Unknown tool "${call.name}". Available: ${Object.keys(TOOL_SCHEMAS).join(', ')}.` };
  }
  const schema = TOOL_SCHEMAS[call.name];
  const rawArgs = call.name === 'propose_plan' ? wrapPlanChanges(call.args ?? {}) : (call.args ?? {});
  const parsed = schema.safeParse(rawArgs);
  if (!parsed.success) {
    return { kind: 'error', content: `Invalid arguments for ${call.name}: ${zodIssues(parsed.error)}` };
  }

  switch (call.name) {
    case 'get_scenario':
      return { kind: 'result', content: describeScenario(ctx, (parsed.data as z.infer<typeof getScenarioArgs>).section) };
    case 'run_projection':
      return runProjection(ctx, (parsed.data as z.infer<typeof runProjectionArgs>).overrides);
    case 'compare_scenarios':
      return compareScenarios(ctx, parsed.data as z.infer<typeof compareScenariosArgs>);
    case 'run_strategies':
      return runStrategiesTool(ctx, parsed.data as z.infer<typeof runStrategiesArgs>);
    case 'solve_spending':
      return solveSpendingTool(ctx, parsed.data as z.infer<typeof solveSpendingArgs>);
    case 'run_monte_carlo':
      return runMonteCarloTool(ctx, parsed.data as z.infer<typeof runMonteCarloArgs>);
    case 'get_schedule':
      return getScheduleTool(ctx, parsed.data as z.infer<typeof getScheduleArgs>);
    case 'propose_plan':
      return proposePlan(ctx, wrapPlanChanges(parsed.data));
    case 'propose_spouse':
      return proposeSpouse(ctx, parsed.data as z.infer<typeof proposeSpouseArgs>);
    case 'propose_spending_bands':
      return proposeSpendingBands(ctx, parsed.data as z.infer<typeof proposeSpendingBandsArgs>);
    case 'propose_market_periods':
      return proposeMarketPeriods(ctx, parsed.data as z.infer<typeof proposeMarketPeriodsArgs>);
    case 'propose_account':
      return proposeAccount(ctx, parsed.data as z.infer<typeof proposeAccountArgs>);
    case 'propose_revert':
      return proposeRevert(ctx, parsed.data as z.infer<typeof proposeRevertArgs>);
    case 'manage_cash_event':
      return manageArray(ctx, 'events', cashEventSchema, parsed.data as Record<string, unknown>, 'cash event');
    case 'manage_income':
      return manageArray(ctx, 'income', incomeSourceSchema, parsed.data as Record<string, unknown>, 'income source');
    case 'manage_debt':
      return manageArray(ctx, 'debts', debtSchema, parsed.data as Record<string, unknown>, 'debt');
    case 'manage_giving':
      return manageArray(ctx, 'giving', givingStreamSchema, parsed.data as Record<string, unknown>, 'giving stream');
    case 'remember':
      return rememberTool(ctx, parsed.data as z.infer<typeof rememberArgs>);
    case 'recall':
      return recallTool(ctx, parsed.data as z.infer<typeof recallArgs>);
    case 'list_scenarios':
      return listScenariosTool(ctx, parsed.data as z.infer<typeof listScenariosArgs>);
    case 'find_page':
      return findPageTool(ctx, parsed.data as z.infer<typeof findPageArgs>);
    case 'propose_navigate':
      return proposeNavigateTool(ctx, parsed.data as z.infer<typeof proposeNavigateArgs>);
  }
}

// ---------------------------------------------------------------------------
// Individual tools
// ---------------------------------------------------------------------------

function describeScenario(ctx: ToolContext, section: z.infer<typeof sectionSchema>): string {
  const i = ctx.inputs;
  const lines: string[] = [`Scenario "${ctx.scenarioName}" (of ${ctx.scenarioList.length} saved).`];
  if (looksLikeUnsetPlan(i)) {
    lines.push(
      'SETUP: this plan is an unfilled starter (all account balances $0). Ages, spending, and province here are placeholders — interview the user rather than treating them as given. If they say fill the rest / use defaults, call propose_plan this turn with remaining starter defaults — do not only say you will.',
    );
  }

  const summary = {
    currentAge: i.currentAge, retirementAge: i.retirementAge, maxAge: i.maxAge,
    province: i.provinceCode,
    hasSpouse: i.spouse?.enabled === true,
    desiredSpending: i.desiredSpending,
    investmentReturn: i.investmentReturn, returnVolatility: i.returnVolatility,
    // Market hypothesis (issue #138): shown only when anchors exist, so the
    // agent knows the projection/MC follow a curve, not the flat constants.
    ...((i.marketPeriods?.length ?? 0) > 0 ? {
      marketHypothesis: (i.marketPeriods ?? []).map(p =>
        `age ${p.age}: ${(p.return * 100).toFixed(1)}%${p.volatility != null ? ` (σ ${(p.volatility * 100).toFixed(1)}%)` : ''}`),
    } : {}),
  };
  const accounts = {
    rrsp: i.rrspBalance, tfsa: i.tfsaBalance, taxable: i.taxableBalance,
    cashCushion: i.cashCushionBalance,
    contributionsPerYear: { rrsp: i.rrspContribution, tfsa: i.tfsaContribution, taxable: i.taxableContribution },
    // Contribution room (issue #24): shown only when tracking is on (a number),
    // so the agent knows deposits are being capped. Absent/null = unlimited.
    ...((i.tfsaRoom != null || i.rrspRoom != null) ? {
      contributionRoom: {
        ...(i.tfsaRoom != null ? { tfsa: i.tfsaRoom } : { tfsa: 'unlimited' }),
        ...(i.rrspRoom != null ? { rrsp: i.rrspRoom } : { rrsp: 'unlimited' }),
        note: 'deposits are capped at remaining room; excess spills to non-registered',
      },
    } : {}),
    ...(i.rdsp?.enabled ? {
      rdsp: {
        balance: i.rdsp.balance, contribution: i.rdsp.contribution,
        familyIncome: i.rdsp.familyIncome, dtcEligible: i.rdsp.dtcEligible,
      },
    } : {}),
    ...(i.fhsa?.enabled ? {
      fhsa: {
        balance: i.fhsa.balance, contribution: i.fhsa.contribution,
        contributionBasis: i.fhsa.contributionBasis, openAge: i.fhsa.openAge,
      },
    } : {}),
    withdrawalOrder: i.withdrawalOrder,
  };
  const describeIncome = (list: RetirementInputs['income']) =>
    (list ?? []).map(s =>
      `${s.label} [${s.kind}]: ${money(s.annualAmount)}/yr from ${s.startAge}${s.endAge != null ? ` to ${s.endAge}` : ''}${s.indexedToCpi ? ' (indexed)' : ''}`);
  const describeDebts = (list: RetirementInputs['debts']) =>
    (list ?? []).map(d =>
      `${d.label} [${d.kind}]: ${money(d.balance)} at ${(d.interestRate * 100).toFixed(2)}%, ${money(d.monthlyPayment)}/mo` +
      `${d.startAge != null ? ` from ${d.startAge}` : ''}${d.endAge != null ? ` to ${d.endAge}` : ''} (funded from spending)`);
  const benefits = {
    cpp: i.cppStartAge == null ? 'not taken'
      : `${money(i.cppMonthlyAmount)}/mo from age ${i.cppStartAge}${i.cppAdjustedAmount ? ' (already adjusted)' : ''}`,
    oas: i.oasStartAge == null ? 'not taken'
      : `from age ${i.oasStartAge}, ${i.oasYearsInCanada} years in Canada`,
    income: describeIncome(i.income),
  };
  const spending = {
    desiredSpending: i.desiredSpending,
    bands: (i.spendingBands ?? []).map(b =>
      `${(b.pctOfBase * 100).toFixed(0)}% (${money(i.desiredSpending * b.pctOfBase)}/yr) from age ${b.fromAge}`),
    events: (i.events ?? []).map(e => `${e.label}: ${money(e.amount)} ${e.direction} at age ${e.age}${e.endAge != null ? `–${e.endAge}` : ''}`),
    debts: describeDebts(i.debts),
    giving: (i.giving ?? []).map(g => g.mode === 'fixed'
      ? `${g.label}: ${money(g.amount)}/yr from ${g.fromAge}${g.toAge != null ? ` to ${g.toAge}` : ''} (household, pooled credit)`
      : `${g.label}: ${g.pct}% of ${g.basis} income from ${g.fromAge}${g.toAge != null ? ` to ${g.toAge}` : ''} (household, pooled credit)`),
  };
  const spouse = i.spouse?.enabled ? {
    currentAge: i.spouse.currentAge, retirementAge: i.spouse.retirementAge,
    rrsp: i.spouse.rrspBalance, tfsa: i.spouse.tfsaBalance, taxable: i.spouse.taxableBalance,
    cpp: i.spouse.cppStartAge == null ? 'not taken' : `${money(i.spouse.cppMonthlyAmount)}/mo from ${i.spouse.cppStartAge}`,
    oasStartAge: i.spouse.oasStartAge, desiredSpending: i.spouse.desiredSpending,
    income: describeIncome(i.spouse.income),
    debts: describeDebts(i.spouse.debts),
  } : 'none (single plan)';

  const emit = (title: string, value: unknown) => {
    lines.push(`${title}:\n${JSON.stringify(value, null, 2)}`);
  };

  switch (section) {
    case 'summary': emit('SUMMARY', summary); break;
    case 'accounts': emit('ACCOUNTS', accounts); break;
    case 'benefits': emit('BENEFITS', benefits); break;
    case 'spending': emit('SPENDING', spending); break;
    case 'spouse': emit('SPOUSE', spouse); break;
    case 'full':
      emit('SUMMARY', summary);
      emit('ACCOUNTS', accounts);
      emit('BENEFITS', benefits);
      emit('SPENDING', spending);
      emit('SPOUSE', spouse);
      emit('FULL INPUTS JSON', i);
      break;
  }
  return lines.join('\n');
}

/** Validate a flat overrides patch against the input schema; returns the
 *  applied patch plus human-readable rejections. Structural fields (spouse,
 *  events, income…) are refused here — overrides are for scalar levers. */
function validateOverrides(
  overrides: Record<string, unknown>,
): { patch: Partial<RetirementInputs>; rejected: string[] } {
  const patch: Partial<RetirementInputs> = {};
  const rejected: string[] = [];
  const shape = retirementInputsSchema.shape;
  for (const [key, value] of Object.entries(overrides)) {
    if (!(key in shape)) { rejected.push(`${key}: unknown field`); continue; }
    if (STRUCTURAL_FIELDS.has(key)) {
      rejected.push(`${key}: structural field — use its propose_* tool`);
      continue;
    }
    const res = safeParseTolerant((shape as Record<string, z.ZodType>)[key], value);
    if (!res.success) {
      rejected.push(`${key}: ${res.error.issues[0]?.message ?? 'invalid value'}`);
      continue;
    }
    (patch as Record<string, unknown>)[key] = res.data;
  }
  return { patch, rejected };
}

/** The compact verdict block returned for any engine run. Deliberately small:
 *  the model gets decision-grade numbers, not the whole schedule. */
function summarizeResults(label: string, inputs: RetirementInputs, results: RetirementResults): string {
  const rows = results.yearlyBreakdown;
  const last = rows[rows.length - 1];
  const lifetimeTax = last?.cumulativeTax ?? 0;
  const firstShortfall = rows.find(r => (r.shortfall ?? 0) > 0);
  // Household-first verdict (issue A-03): for a couple the headline must be the
  // COMBINED outcome — the primary's own silo can deplete while the funded
  // partner covers the gap (and vice-versa). Matches the dashboard and the
  // Monte Carlo screen (#33), which both use householdOutcome. The per-person
  // lines below stay as secondary detail.
  const ho = householdOutcome(results, toHousehold(inputs));
  const lines = [
    `${label}: ${ho.status === 'ON_TRACK' ? 'ON TRACK' : 'SHORTFALL'} — ` +
    (ho.depletionAge != null
      ? `household portfolio depletes at age ${ho.depletionAge}`
      : `household funded to age ${inputs.maxAge}+`),
    `  Re:score ${ho.depletionAge == null ? 100 : Math.min(100, Math.max(0, Math.round((ho.depletionAge / inputs.maxAge) * 100)))}/100`,
    `  net worth at retirement ${money(results.totalNetWorthAtRetirement)}, ` +
    `withdrawal rate ${(results.withdrawalRate * 100).toFixed(1)}%, ` +
    `lifetime tax ${money(lifetimeTax)}, ending balance ${money(last?.endingBalance ?? 0)}`,
  ];
  if (firstShortfall) {
    lines.push(`  first unfunded spending gap at age ${firstShortfall.age} (${money(firstShortfall.shortfall ?? 0)} short that year)`);
  }
  if (results.spouse) {
    lines.push(
      `  per-person (detail): you ${results.status === 'ON_TRACK' ? 'on track' : `deplete at ${results.depletionAge}`}, ` +
      `spouse ${results.spouse.status === 'ON_TRACK' ? 'on track' : `depletes at ${results.spouse.depletionAge}`}, ` +
      `spouse ending ${money(results.spouse.yearlyBreakdown.at(-1)?.endingBalance ?? 0)}`,
    );
  }
  // Milestone years so the model can reference specifics without the full table.
  const milestones = [rows[0], rows[Math.floor(rows.length / 2)], last]
    .filter((r, idx, a) => r && a.indexOf(r) === idx);
  for (const r of milestones) {
    lines.push(
      `  age ${r.age}: start ${money(r.startingBalance)} → end ${money(r.endingBalance)}, ` +
      `withdrew ${money(r.withdrawals)}, tax ${money(r.incomeTax)}, ` +
      `benefits cpp ${money(r.cppIncome)} oas ${money(r.oasIncome)} gis ${money(r.gisIncome)}`,
    );
  }
  const givingTotal = rows.reduce((a, r) => a + (r.giving ?? 0), 0);
  if (givingTotal > 0) {
    const creditTotal = rows.reduce((a, r) => a + (r.donationCredit ?? 0), 0);
    lines.push(`  charitable giving ${money(givingTotal)} lifetime, donation tax credit ${money(creditTotal)} (pooled household credit)`);
  }
  return lines.join('\n');
}

function runProjection(ctx: ToolContext, overrides?: Record<string, unknown>): ToolOutcome {
  let inputs = ctx.inputs;
  const notes: string[] = [];
  if (overrides && Object.keys(overrides).length > 0) {
    const { patch, rejected } = validateOverrides(overrides);
    if (rejected.length) notes.push(`Ignored invalid overrides: ${rejected.join('; ')}`);
    inputs = { ...ctx.inputs, ...patch };
  }
  try {
    const results = calculateHousehold(inputs, ctx.config);
    const head = overrides && Object.keys(overrides).length
      ? 'Projection WITH overrides (what-if; plan unchanged)'
      : 'Projection of the current plan';
    const body = summarizeResults('Result', inputs, results);
    return { kind: 'result', content: [head, ...notes, body].join('\n') };
  } catch (err) {
    return { kind: 'error', content: `Engine failed to run: ${err instanceof Error ? err.message : String(err)}` };
  }
}

function compareScenarios(ctx: ToolContext, args: z.infer<typeof compareScenariosArgs>): ToolOutcome {
  // The singular form stays valid (back-compat); variants win when both arrive.
  const variants: Array<{ label: string; overrides: Record<string, unknown> }> = args.variants?.length
    ? args.variants.map((v, i) => ({ label: v.label ?? `Variant ${i + 1}`, overrides: v.overrides }))
    : args.overrides
      ? [{ label: 'VARIANT', overrides: args.overrides }]
      : [];
  if (variants.length === 0) {
    return { kind: 'error', content: 'No variants to compare. Pass overrides (one variant) or variants (up to 4).' };
  }

  const validated = variants.map(v => ({ ...v, ...validateOverrides(v.overrides) }));
  const usable = validated.filter(v => Object.keys(v.patch).length > 0);
  if (usable.length === 0) {
    return { kind: 'error', content: `No valid overrides in any variant. ${validated.map(v => v.rejected.join('; ')).filter(Boolean).join(' | ') || 'All patches were empty.'}` };
  }

  try {
    const base = calculateHousehold(ctx.inputs, ctx.config);
    const lines: string[] = [
      `Comparing ${usable.length} variant${usable.length > 1 ? 's' : ''} against the current plan.`,
    ];
    for (const v of validated) {
      if (Object.keys(v.patch).length === 0) {
        lines.push(`Skipped variant "${v.label}" — no valid overrides (${v.rejected.join('; ')}).`);
      }
    }
    // One verdict line per plan (current first), then deltas per variant.
    lines.push(summarizeResults('CURRENT plan', ctx.inputs, base));
    const variantRuns = usable.map(v => ({
      label: v.label,
      overrides: v.patch,
      inputs: { ...ctx.inputs, ...v.patch } as RetirementInputs,
      results: calculateHousehold({ ...ctx.inputs, ...v.patch } as RetirementInputs, ctx.config),
      notes: v.rejected.length ? ` (ignored invalid: ${v.rejected.join('; ')})` : '',
    }));
    for (const r of variantRuns) {
      lines.push(summarizeResults(`VARIANT "${r.label}" ${JSON.stringify(r.overrides)}${r.notes}`, r.inputs, r.results));
    }
    lines.push('DELTAS (variant − current):');
    for (const r of variantRuns) {
      lines.push(
        `  ${r.label}: ending balance ${delta(end(base), end(r.results))}, ` +
        `lifetime tax ${delta(lifeTax(base), lifeTax(r.results))}, ` +
        `depletion: ${fmtDepl(base)} → ${fmtDepl(r.results)}`,
      );
    }
    return { kind: 'result', content: lines.join('\n') };
  } catch (err) {
    return { kind: 'error', content: `Engine failed to run: ${err instanceof Error ? err.message : String(err)}` };
  }
}

const end = (r: RetirementResults) => r.yearlyBreakdown.at(-1)?.endingBalance ?? 0;
const lifeTax = (r: RetirementResults) => r.yearlyBreakdown.at(-1)?.cumulativeTax ?? 0;
const fmtDepl = (r: RetirementResults) => (r.depletionAge != null ? `depletes ${r.depletionAge}` : 'funded to max age');
const delta = (a: number, b: number) => {
  const d = b - a;
  return `${d >= 0 ? '+' : '−'}${money(Math.abs(d))}`;
};

/** Batch of scalar top-level changes validated together; one confirm card. */
function proposePatch(
  ctx: ToolContext,
  args: { changes: Record<string, unknown>; rationale?: string },
): ToolOutcome {
  const patch: Partial<RetirementInputs> = {};
  const rejected: string[] = [];
  const preview: Record<string, unknown> = {};
  const shape = retirementInputsSchema.shape as Record<string, z.ZodType>;
  for (const [field, value] of Object.entries(args.changes)) {
    if (!EDITABLE_FIELDS.has(field)) {
      rejected.push(`${field}: not a changeable scalar field${STRUCTURAL_FIELDS.has(field) ? ' (use its propose_* tool)' : ''}`);
      continue;
    }
    const res = safeParseTolerant(shape[field], value);
    if (!res.success) { rejected.push(`${field}: ${res.error.issues[0]?.message ?? 'invalid'}`); continue; }
    (patch as Record<string, unknown>)[field] = res.data;
    preview[field] = { from: (ctx.inputs as unknown as Record<string, unknown>)[field], to: res.data };
  }
  if (Object.keys(patch).length === 0) {
    return { kind: 'error', content: `No valid changes in the batch. ${rejected.join('; ')}` };
  }
  const note = rejected.length ? ` (skipped invalid: ${rejected.join('; ')})` : '';
  return {
    kind: 'mutation',
    patch,
    label: `Update ${Object.keys(patch).join(', ')}`,
    rationale: (args.rationale ?? '') + note,
    preview,
  };
}

/** Friendlier card label so a first-plan dump of age/retirement/spending
 *  shows as "Update plan", not a field list. */
function proposePlan(
  ctx: ToolContext,
  args: { changes: Record<string, unknown>; rationale?: string },
): ToolOutcome {
  if (!args.changes || Object.keys(args.changes).length === 0) {
    return {
      kind: 'error',
      content: 'propose_plan needs numbers. Pass changes: { currentAge, retirementAge, desiredSpending, rrspBalance, tfsaBalance, taxableBalance, cashCushionBalance, provinceCode, ... } — or the same fields at the top level. Do not call this empty.',
    };
  }
  const out = proposePatch(ctx, args);
  if (out.kind !== 'mutation') return out;
  const keys = Object.keys(out.patch);
  return { ...out, label: keys.length >= 2 ? 'Update plan' : `Set ${keys[0]}` };
}

/** Link, unlink, or mint a partner plan. Partner numbers never live inline. */
function proposeSpouse(
  ctx: ToolContext,
  args: { scenarioId?: string; enabled?: boolean; name?: string; changes?: Record<string, unknown>; rationale?: string },
): ToolOutcome {
  const unlink = args.enabled === false || args.changes?.enabled === false;
  if (unlink) {
    // JSON drops `undefined`, so encode removals with the revert sentinel —
    // the UI decodes before applying, same as propose_revert.
    return {
      kind: 'mutation',
      patch: encodeRevertPatch({ spouse: undefined, spouseSource: undefined }),
      revert: true,
      label: 'Unlink spouse',
      rationale: args.rationale,
      preview: { spouseSource: null },
    };
  }
  if (args.scenarioId) {
    const found = ctx.scenarioList.find(s => s.id === args.scenarioId);
    if (!found) {
      return { kind: 'error', content: `No saved plan with id "${args.scenarioId}".` };
    }
    if (ctx.activeScenarioId && args.scenarioId === ctx.activeScenarioId) {
      return { kind: 'error', content: 'A plan cannot be its own spouse.' };
    }
    return {
      kind: 'mutation',
      patch: encodeRevertPatch({ spouse: undefined, spouseSource: { kind: 'scenario', scenarioId: args.scenarioId } }),
      revert: true,
      label: `Link spouse: ${found.name}`,
      rationale: args.rationale,
      preview: { spouseSource: { kind: 'scenario', scenarioId: args.scenarioId }, name: found.name },
    };
  }
  if (!args.changes && args.enabled !== true) {
    return {
      kind: 'error',
      content: 'To add a partner, pass scenarioId of an existing plan, or changes with their numbers (and enabled:true). Pass enabled:false to unlink.',
    };
  }
  const raw = { ...(args.changes ?? {}) };
  delete raw.enabled;
  const merged = { ...baselineSpouse(ctx.inputs), ...raw, enabled: true };
  const res = spouseSchema.safeParse(merged);
  if (!res.success) {
    return {
      kind: 'error',
      content: `Invalid spouse data: ${zodIssues(res.error)}. Pass person fields (currentAge, retirementAge, balances, contributions, cpp/oas, desiredSpending) or scenarioId of an existing plan.`,
    };
  }
  const partnerInputs = personPlanFromSpouse(res.data, ctx.inputs);
  const name = (args.name ?? '').trim() || 'Partner';
  return {
    kind: 'mutation',
    patch: {},
    createPartner: { name, inputs: partnerInputs },
    label: `Add spouse/partner as "${name}"`,
    rationale: args.rationale,
    preview: { name, currentAge: partnerInputs.currentAge, desiredSpending: partnerInputs.desiredSpending },
  };
}

/** Enable/configure/disable a reverse mortgage, RDSP, or FHSA. */
function proposeAccount(
  ctx: ToolContext,
  args: z.infer<typeof proposeAccountArgs>,
): ToolOutcome {
  const kind = args.kind === 'reverse_mortgage' ? 'rm' : args.kind;
  const payload = { changes: args.changes, rationale: args.rationale };
  if (kind === 'rm') return proposeReverseMortgage(ctx, payload);
  if (kind === 'rdsp') return proposeRdsp(ctx, payload);
  return proposeFhsa(ctx, payload);
}

/** Shared helper for the append-to-array structural tools (income source,
 *  cash event). Validates the element (minus its id), generates an id, and
 *  proposes the array with the new element appended. */
function proposeElement(
  ctx: ToolContext,
  key: 'income' | 'events' | 'debts' | 'giving',
  schema: z.ZodType,
  rawArgs: unknown,
  noun: string,
): ToolOutcome {
  const args = (rawArgs ?? {}) as Record<string, unknown>;
  const rationale = typeof args.rationale === 'string' ? args.rationale : undefined;
  const { rationale: _r, ...element } = args;
  const res = schema.safeParse({ ...element, id: newId(key) });
  if (!res.success) {
    return { kind: 'error', content: `Invalid ${noun}: ${zodIssues(res.error)}` };
  }
  const current = (ctx.inputs[key] as unknown[] | undefined) ?? [];
  const next = [...current, res.data];
  return {
    kind: 'mutation',
    patch: { [key]: next } as Partial<RetirementInputs>,
    label: `Add ${noun}${typeof (res.data as { label?: string }).label === 'string' ? ` "${(res.data as { label?: string }).label}"` : ''}`,
    rationale,
    preview: { add: res.data, count: next.length },
  };
}

/** Replace the whole spending-band set. */
function proposeSpendingBands(
  ctx: ToolContext,
  args: { bands: Array<{ fromAge: number; pctOfBase: number }>; rationale?: string },
): ToolOutcome {
  const band = z.object({ fromAge: z.number(), pctOfBase: z.number().min(0).max(3) });
  const res = z.array(band).safeParse(args.bands);
  if (!res.success) {
    return { kind: 'error', content: `Invalid spending bands: ${zodIssues(res.error)}` };
  }
  const sorted = [...res.data].sort((a, b) => a.fromAge - b.fromAge);
  const base = ctx.inputs.desiredSpending;
  return {
    kind: 'mutation',
    patch: { spendingBands: sorted },
    label: 'Set spending phases',
    rationale: args.rationale,
    preview: { bands: sorted.map(b =>
      `${(b.pctOfBase * 100).toFixed(0)}% (${money(base * b.pctOfBase)}/yr) from age ${b.fromAge}`) },
  };
}

/** Replace the whole market-hypothesis set (issue #138). The engine needs a
 *  stable id per anchor (the UI keys drag targets by it); the caller supplies
 *  only age/return/volatility, so we mint ids here. Empty array = clear. */
function proposeMarketPeriods(
  _ctx: ToolContext,
  args: { periods: Array<{ age: number; return: number; volatility?: number }>; rationale?: string },
): ToolOutcome {
  const res = z.array(marketPeriodSchema).safeParse(args.periods);
  if (!res.success) {
    return { kind: 'error', content: `Invalid market periods: ${zodIssues(res.error)}` };
  }
  const sorted = [...res.data].sort((a, b) => a.age - b.age);
  const withIds = sorted.map((p, i) => ({ id: `mp-${i}-${p.age}`, ...p }));
  return {
    kind: 'mutation',
    patch: { marketPeriods: withIds },
    label: withIds.length > 0 ? `Set market hypothesis (${withIds.length} anchors)` : 'Clear market hypothesis',
    rationale: args.rationale,
    preview: {
      periods: withIds.map(p =>
        `age ${p.age}: ${(p.return * 100).toFixed(1)}%${p.volatility != null ? ` (σ ${(p.volatility * 100).toFixed(1)}%)` : ''}`),
    },
  };
}

/** Enable/configure/disable the reverse mortgage. */
function proposeReverseMortgage(
  ctx: ToolContext,
  args: { changes: Record<string, unknown>; rationale?: string },
): ToolOutcome {
  const existing = ctx.inputs.reverseMortgage;
  const merged = { ...(existing ?? {}), ...args.changes };
  const res = reverseMortgageSchema.safeParse(merged);
  if (!res.success) {
    return {
      kind: 'error',
      content: `Invalid reverse mortgage: ${zodIssues(res.error)}.` +
        (!existing && args.changes.enabled !== false
          ? ' To ENABLE it you must supply homeValue, appreciationRate, and interestRate (and optionally draws or top-up).'
          : ''),
    };
  }
  const enabling = args.changes.enabled === true && !existing?.enabled;
  const disabling = args.changes.enabled === false;
  return {
    kind: 'mutation',
    patch: { reverseMortgage: res.data },
    label: disabling ? 'Disable reverse mortgage' : enabling ? 'Enable reverse mortgage' : 'Update reverse mortgage',
    rationale: args.rationale,
    preview: { reverseMortgage: res.data },
  };
}

/** Enable/configure/disable the RDSP. Follows the same merge-then-validate
 *  pattern as the reverse mortgage: partial changes over the existing block,
 *  full schema re-validation, one confirm card. */
function proposeRdsp(
  ctx: ToolContext,
  args: { changes: Record<string, unknown>; rationale?: string },
): ToolOutcome {
  const existing = ctx.inputs.rdsp;
  const merged = { ...(existing ?? {}), ...args.changes };
  const res = rdspSchema.safeParse(merged);
  if (!res.success) {
    return {
      kind: 'error',
      content: `Invalid RDSP: ${zodIssues(res.error)}.` +
        (!existing && args.changes.enabled !== false
          ? ' To ENABLE it you must supply balance, contribution, familyIncome, and dtcEligible.'
          : ''),
    };
  }
  const enabling = args.changes.enabled === true && !existing?.enabled;
  const disabling = args.changes.enabled === false;
  return {
    kind: 'mutation',
    patch: { rdsp: res.data },
    label: disabling ? 'Disable RDSP' : enabling ? 'Enable RDSP' : 'Update RDSP',
    rationale: args.rationale,
    preview: { rdsp: res.data },
  };
}

/** Enable/configure/disable the FHSA. Same merge-then-validate pattern as the
 *  RDSP: partial changes over the existing block, full schema re-validation,
 *  one confirm card. */
function proposeFhsa(
  ctx: ToolContext,
  args: { changes: Record<string, unknown>; rationale?: string },
): ToolOutcome {
  const existing = ctx.inputs.fhsa;
  const merged = { ...(existing ?? {}), ...args.changes };
  const res = fhsaSchema.safeParse(merged);
  if (!res.success) {
    return {
      kind: 'error',
      content: `Invalid FHSA: ${zodIssues(res.error)}.` +
        (!existing && args.changes.enabled !== false
          ? ' To ENABLE it you must supply balance and contribution.'
          : ''),
    };
  }
  const enabling = args.changes.enabled === true && !existing?.enabled;
  const disabling = args.changes.enabled === false;
  return {
    kind: 'mutation',
    patch: { fhsa: res.data },
    label: disabling ? 'Disable FHSA' : enabling ? 'Enable FHSA' : 'Update FHSA',
    rationale: args.rationale,
    preview: { fhsa: res.data },
  };
}

let idSeq = 0;
const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(++idSeq).toString(36)}`;

// ---------------------------------------------------------------------------
// Revert + element management
// ---------------------------------------------------------------------------

/** Propose rolling the plan back to a checkpoint. The patch is DIFF-based
 *  (checkpoint vs live) so only fields the checkpoint disagrees with move;
 *  manual edits since the change are visible on the card, not silently
 *  clobbered. Nothing applies without the user's confirmation. */
function proposeRevert(ctx: ToolContext, args: z.infer<typeof proposeRevertArgs>): ToolOutcome {
  const checkpoints = ctx.checkpoints ?? [];
  if (checkpoints.length === 0) {
    return {
      kind: 'error',
      content: 'There is nothing to revert: no checkpoints exist yet. Checkpoints are captured automatically each time the user approves one of your changes.',
    };
  }
  const wanted = args.checkpoint?.trim().toLowerCase();
  let target: PlanCheckpoint | undefined;
  if (wanted) {
    target = checkpoints.find(c => c.id.toLowerCase() === wanted)
      ?? checkpoints.filter(c => c.label.toLowerCase() === wanted)[0];
    if (!target) {
      const known = [...checkpoints].reverse().map(c => `"${c.label}" (${new Date(c.at).toLocaleDateString('en-CA')})`).join(', ');
      return { kind: 'error', content: `No checkpoint matches "${args.checkpoint}". Recent checkpoints: ${known}. Omit the argument to revert to the most recent.` };
    }
  } else {
    target = checkpoints[checkpoints.length - 1];
  }
  const plan = buildRevertPlan(ctx.inputs, target);
  if (plan.changed === 0) {
    return { kind: 'error', content: `The plan already matches checkpoint "${target.label}" — nothing to revert.` };
  }
  return {
    kind: 'mutation',
    // Encode undefined-valued removals so the persisted patch keeps them (the
    // UI decodes them back before applying).
    patch: encodeRevertPatch(plan.patch) as Partial<RetirementInputs>,
    label: `Revert to before "${target.label}"`,
    rationale: args.rationale,
    preview: plan.preview,
    revert: true,
  };
}

/** manage_* dispatcher: action "add" appends a new element; update/remove
 *  go through manageElement. Strips `action` so it never lands in the schema.
 *  #194: "add" also accepts the element fields inside `changes` (models
 *  reach for it naturally) — top-level fields win, changes fill in. */
function manageArray(
  ctx: ToolContext,
  key: 'events' | 'income' | 'debts' | 'giving',
  schema: z.ZodType,
  data: Record<string, unknown>,
  noun: string,
): ToolOutcome {
  if (data.action === 'add') {
    const { action: _a, target: _t, changes, ...rest } = data;
    const element = typeof changes === 'object' && changes !== null && !Array.isArray(changes)
      ? { ...(changes as Record<string, unknown>), ...rest }
      : rest;
    return proposeElement(ctx, key, schema, element, noun);
  }
  const target = typeof data.target === 'string' ? data.target : '';
  if (!target) {
    return { kind: 'error', content: `${noun} ${data.action} requires "target" (id or unique label).` };
  }
  return manageElement(ctx, key, schema, {
    action: data.action as 'update' | 'remove',
    target,
    changes: data.changes as Record<string, unknown> | undefined,
    rationale: typeof data.rationale === 'string' ? data.rationale : undefined,
  }, noun);
}

/** Shared helper for manage_cash_event / manage_income / manage_debt: update
 *  (merge fields over the matched element, re-validated) or remove. Target
 *  matches by exact id first, then by unique case-insensitive label. */
function manageElement(
  ctx: ToolContext,
  key: 'events' | 'income' | 'debts' | 'giving',
  schema: z.ZodType,
  args: { action: 'update' | 'remove'; target: string; changes?: Record<string, unknown>; rationale?: string },
  noun: string,
): ToolOutcome {
  const current = (ctx.inputs[key] as unknown[] | undefined) ?? [];
  if (current.length === 0) {
    return { kind: 'error', content: `There are no ${noun}s in the plan to ${args.action}.` };
  }
  const wanted = args.target.trim().toLowerCase();
  const byId = current.filter(e => typeof (e as { id?: unknown }).id === 'string' && ((e as { id: string }).id.toLowerCase() === wanted));
  const byLabel = current.filter(e => typeof (e as { label?: unknown }).label === 'string' && ((e as { label: string }).label.toLowerCase() === wanted));
  const matches = byId.length > 0 ? byId : byLabel;
  if (matches.length === 0) {
    const known = current.map(e => `"${(e as { label?: string }).label ?? (e as { id: string }).id}"`).join(', ');
    return { kind: 'error', content: `No ${noun} matches "${args.target}". Existing: ${known || '(none)'}.` };
  }
  if (matches.length > 1) {
    const ids = matches.map(e => (e as { id: string }).id).join(', ');
    return { kind: 'error', content: `"${args.target}" matches ${matches.length} ${noun}s (ids: ${ids}). Use an id to pick one.` };
  }
  const existing = matches[0] as Record<string, unknown>;
  const existingId = existing.id as string;

  if (args.action === 'remove') {
    const next = current.filter(e => (e as { id: string }).id !== existingId);
    return {
      kind: 'mutation',
      patch: { [key]: next } as Partial<RetirementInputs>,
      label: `Remove ${noun} "${existing.label ?? existingId}"`,
      rationale: args.rationale,
      preview: { removes: existing, remaining: next.length },
    };
  }

  // Update: merge the changed fields over the existing element and re-validate
  // the whole element against its schema (never trust the patch alone).
  const changes = args.changes ?? {};
  if (Object.keys(changes).length === 0) {
    return { kind: 'error', content: `Update requested for ${noun} "${existing.label ?? existingId}" but no fields were given in "changes".` };
  }
  const { id: _ignored, ...rest } = changes; // id is immutable
  const merged = { ...existing, ...rest, id: existingId };
  const res = schema.safeParse(merged);
  if (!res.success) {
    return { kind: 'error', content: `Invalid ${noun} update: ${zodIssues(res.error)}` };
  }
  const next = current.map(e => ((e as { id: string }).id === existingId ? res.data : e));
  return {
    kind: 'mutation',
    patch: { [key]: next } as Partial<RetirementInputs>,
    label: `Update ${noun} "${(res.data as { label?: string }).label ?? existingId}"`,
    rationale: args.rationale,
    preview: { changes: rest, result: res.data },
  };
}

// ---------------------------------------------------------------------------
// Memory tools (agent's long-term recall, scoped to the plan and the user)
// ---------------------------------------------------------------------------

/** remember: store a fact for later chats. Writes are DIRECT (no confirm
 *  card): memory never changes the plan or its numbers — it's the assistant's
 *  own notebook, bounded by the store's caps and prunable by the user. */
function rememberTool(ctx: ToolContext, args: z.infer<typeof rememberArgs>): ToolOutcome {
  if (!ctx.memory) {
    return { kind: 'result', content: 'Memory is unavailable in this session — the fact was not saved.' };
  }
  const rec = ctx.memory.write({
    scope: args.scope,
    scopeKey: ctx.memoryScenarioId ?? '',
    text: args.text,
    importance: args.importance,
    keywords: args.keywords,
  });
  if (!rec) {
    return { kind: 'result', content: 'Memory is full of higher-ranked items; this fact was not saved. Tell the user they can ask you to forget something less important.' };
  }
  return {
    kind: 'result',
    content: `Remembered (${args.scope}): "${rec.text}".`,
  };
}

/** recall: search memory by keyword (ranked by relevance, then importance ×
 *  recency) or list the top-ranked memories with no query. A query that
 *  matches nothing is NOT a dead end: the top-ranked memories come back as
 *  "closest" so the model can answer from what it does know instead of
 *  claiming ignorance. Returns text + scope so the model can cite where a
 *  fact came from. */
function recallTool(ctx: ToolContext, args: z.infer<typeof recallArgs>): ToolOutcome {
  if (!ctx.memory) {
    return { kind: 'result', content: 'Memory is unavailable in this session.' };
  }
  const scopeOpts = { scopeKey: ctx.memoryScenarioId ?? '' };
  let hits = ctx.memory.recall(args.query ?? '', { limit: args.limit, ...scopeOpts });
  let header: string | null = null;
  if (hits.length === 0 && args.query) {
    // Fallback, not failure: hand back what IS remembered (top-ranked) so
    // the model can still answer — labelled so it knows these didn't match.
    hits = ctx.memory.recall('', { limit: 3, ...scopeOpts });
    header = hits.length
      ? `Nothing in memory matches "${args.query}". Closest memories:`
      : `Nothing in memory matches "${args.query}", and memory is empty.`;
  } else if (hits.length === 0) {
    return { kind: 'result', content: 'Memory is empty.' };
  }
  const lines = hits.map(m =>
    `- [${m.scope}] ${m.text} (importance ${m.importance.toFixed(2)}, accessed ${m.accessCount}×)`);
  return { kind: 'result', content: header ? `${header}\n${lines.join('\n')}` : lines.join('\n') };
}

/** list_scenarios action=open: switch the active scenario (the sidebar-switch
 *  path). A navigation, not a plan mutation — no confirm card — but the caller
 *  must announce the switch so the model/user stay oriented. Resolves by id
 *  first, then by unique case-insensitive name; unsaved edits are the caller's
 *  concern (App's onOpenScenario runs the same save-on-switch flow the
 *  sidebar uses). */
function openScenarioTool(ctx: ToolContext, args: z.infer<typeof openScenarioArgs>): ToolOutcome {
  if (!ctx.onOpenScenario) {
    return { kind: 'error', content: 'Scenario switching is unavailable in this session.' };
  }
  const list = ctx.scenarioList;
  let target = args.scenarioId != null ? list.find(s => s.id === args.scenarioId) : undefined;
  if (!target && args.name != null) {
    const q = args.name.trim().toLowerCase();
    const matches = list.filter(s => s.name.trim().toLowerCase() === q);
    if (matches.length === 1) target = matches[0];
    else if (matches.length > 1) {
      return { kind: 'error', content: `"${args.name}" matches ${matches.length} scenarios (${matches.map(m => `"${m.name}"`).join(', ')}). Give the scenarioId instead.` };
    }
  }
  if (!target) {
    return { kind: 'error', content: `No saved scenario matches ${args.scenarioId != null ? `id "${args.scenarioId}"` : `"${args.name}"`}. Known scenarios: ${list.map(s => `"${s.name}" (${s.id})`).join(', ') || 'none'}.` };
  }
  ctx.onOpenScenario(target.id);
  return { kind: 'result', content: `Opened scenario "${target.name}". The plan inputs, and any numbers you compute from now on, refer to it.` };
}

/** list_scenarios action=save_as: snapshot the CURRENT live inputs as a new
 *  named scenario and make it active (so later agent edits land on the copy).
 *  A direct write (no confirm card): it ADDS a scenario and touches no
 *  existing one. */
function saveScenarioAsTool(ctx: ToolContext, args: z.infer<typeof saveScenarioAsArgs>): ToolOutcome {
  if (!ctx.onSaveScenarioAs) {
    return { kind: 'error', content: 'Saving scenarios is unavailable in this session.' };
  }
  const name = args.name.trim();
  if (!name) {
    return { kind: 'error', content: 'Scenario name cannot be empty.' };
  }
  ctx.onSaveScenarioAs(name);
  return { kind: 'result', content: `Saved the current plan as scenario "${name}" and opened it. The previous plan is unchanged and still in the list.` };
}

/** list_scenarios: enumerate the saved plans. Compact by default (one line per
 *  scenario, active marked); withDetails adds each plan's key numbers so the
 *  model can compare saved plans without opening them. A pure read. */
// ---------------------------------------------------------------------------
// Navigation: find_page / propose_navigate
// ---------------------------------------------------------------------------

/** Resolve a name to its catalog entry (view id, route, title, or keyword).
 *  Returns null instead of guessing-then-erroring. The whole catalog is
 *  searched — a folded legacy name ("details") resolves so the tool can
 *  redirect it to its destination rather than reject a request the UI can
 *  satisfy. */
function resolveNavView(name: string | View): NavEntry | null {
  const q = name.toLowerCase().trim();
  const found = NAV_CATALOG.find((e) =>
    e.viewId.toLowerCase() === q ||
    e.route.toLowerCase() === q ||
    e.title.toLowerCase() === q ||
    e.keywords.some((k) => k.toLowerCase() === q));
  return found ?? null;
}

/** Follow `foldedInto` to the page the UI actually shows. */
function destinationEntry(entry: NavEntry): NavEntry {
  return entry.foldedInto ? pageForView(entry.foldedInto) ?? entry : entry;
}

/** find_page: ranked search over the reachable page map. Pure read;
 *  idempotent-friendly (it's one catalog the user will reach the same way). */
function findPageTool(ctx: ToolContext, args: z.infer<typeof findPageArgs>): ToolOutcome {
  const query = args.query?.trim() ?? '';
  if (query === '') return getSitemapTool();
  const ranked = rankPages(query, ctx.currentView);
  if (ranked.length === 0) {
    return { kind: 'result', content: `No page matches "${query}". Omit the query for the whole map.` };
  }
  const here = ctx.currentView != null ? canonicalView(ctx.currentView) : null;
  const lines = ranked.slice(0, 5).map((e, i) => {
    const isHere = here != null && e.viewId === here;
    return `${i + 1}. ${e.title} ${isHere ? '(you are already here) ' : ''}— ${hashForEntry(e)} — ${e.description}`;
  });
  return { kind: 'result', content: `Matches for "${args.query}":\n${lines.join('\n')}` };
}

/** find_page with an empty query: the page map a user can reach,
 *  machine-readable. Folded legacy pages are left out — the map should read
 *  as the site, not as the view union. Pure read; idempotent — it's the same
 *  list regardless of state. */
function getSitemapTool(): ToolOutcome {
  const lines = searchablePages().map((e, i) =>
    `${i + 1}. ${e.title} (view ${e.viewId}) — ${hashForEntry(e)} — ${e.description}`);
  return { kind: 'result', content: `The site map:\n${lines.join('\n')}` };
}

/** propose_navigate: PROPOSE a UI page switch as a confirm card (unlike a
 *  direct navigate, which would yank the user out of this chat mid-answer).
 *  Unbound hosts return the #/hash (not an error) — the model can share the
 *  destination as a link instead of actioning it. A folded legacy view is
 *  redirected to the page the UI shows (details → Plans), so the card
 *  always opens a real destination. */
function proposeNavigateTool(ctx: ToolContext, args: z.infer<typeof proposeNavigateArgs>): ToolOutcome {
  const found = resolveNavView(args.view);
  if (!found) {
    const routes = searchablePages().map((e) => e.viewId).join(', ');
    return { kind: 'error', content: `Unknown view "${args.view}". Give a view id from find_page (${routes}).` };
  }
  const entry = destinationEntry(found);
  if (!ctx.canNavigate) {
    return { kind: 'result', content: `To open "${entry.title}", share: ${hashForEntry(entry)} (view ${entry.viewId}).` };
  }
  // UI-only proposal: an empty plan patch + a `navigate` destination. The UI
  // routes on approval (and skips the checkpoint, since the plan never
  // changed) — the confirm card is the whole point: the user sees WHERE
  // before the app moves them there.
  return {
    kind: 'mutation',
    patch: {},
    navigate: entry.viewId,
    label: args.label,
    preview: { Page: entry.title, Route: hashForEntry(entry) },
    rationale: args.rationale,
  };
}

function listScenariosTool(ctx: ToolContext, args: z.infer<typeof listScenariosArgs>): ToolOutcome {
  if (args.action === 'open') {
    return openScenarioTool(ctx, { scenarioId: args.scenarioId, name: args.name });
  }
  if (args.action === 'save_as') {
    return saveScenarioAsTool(ctx, { name: args.name ?? '' });
  }
  const list = ctx.scenarioList;
  if (list.length === 0) {
    return { kind: 'result', content: 'There are no saved scenarios yet.' };
  }
  const activeId = ctx.activeScenarioId;
  const lines: string[] = [`${list.length} saved scenario${list.length === 1 ? '' : 's'}:`];
  for (const s of list) {
    const isActive = s.id === activeId;
    if (!args.withDetails) {
      lines.push(`- ${s.name}${isActive ? ' (ACTIVE — currently open)' : ''} [id: ${s.id}]`);
      continue;
    }
    const inputs = s.id === activeId
      ? ctx.inputs
      : ctx.scenarioInputsById?.(s.id);
    const head = `- ${s.name}${isActive ? ' (ACTIVE — currently open)' : ''} [id: ${s.id}]`;
    if (!inputs) {
      // Not the active plan and the caller supplied no detail source: fall
      // back to the compact line rather than fabricate numbers.
      lines.push(head);
      continue;
    }
    lines.push(
      `${head}: ages ${inputs.currentAge}→${inputs.retirementAge} (max ${inputs.maxAge}), ` +
      `spending ${money(inputs.desiredSpending)}/yr, ` +
      `RRSP ${money(inputs.rrspBalance)}, TFSA ${money(inputs.tfsaBalance)}, taxable ${money(inputs.taxableBalance)}, ` +
      `CPP ${inputs.cppStartAge == null ? 'not taken' : `from ${inputs.cppStartAge}`}, ` +
      `OAS ${inputs.oasStartAge == null ? 'not taken' : `from ${inputs.oasStartAge}`}, ` +
      `${inputs.spouse?.enabled ? 'spouse enabled' : 'single'}`,
    );
  }
  return { kind: 'result', content: lines.join('\n') };
}

// ---------------------------------------------------------------------------
// Read backends (pure; no confirmation)
// ---------------------------------------------------------------------------

function runStrategiesTool(ctx: ToolContext, filter?: StrategyFilter): ToolOutcome {
  try {
    const report = runStrategies(ctx.inputs, ctx.config, filter);
    const row = (s: { name: string; survived: boolean; sustainableSpending: number; deltaSpending: number; lifetimeTax: number; lifetimeGis: number; endingBalance: number; depletionAge: number | null }) =>
      `  ${s.name}: ${s.survived ? 'survives' : `depletes ${s.depletionAge}`}, ` +
      `sustainable spending ${money(s.sustainableSpending)}/yr (${s.deltaSpending >= 0 ? '+' : '−'}${money(Math.abs(s.deltaSpending))} vs current), ` +
      `tax ${money(s.lifetimeTax)}, GIS ${money(s.lifetimeGis)}, ending ${money(s.endingBalance)}`;
    const lines = [
      `CURRENT plan: sustainable spending ${money(report.baseline.sustainableSpending)}/yr.`,
      'Strategies (best first):',
      ...report.shown.map(row),
      ...(report.shown.length < report.filteredFrom
        ? [`(${report.filteredFrom - report.shown.length} variants hidden by filters; raise maxVariants or drop categories to see more.)`]
        : []),
      'Suggested levers:',
      ...report.suggestedActions.map(a => `  - ${a}`),
    ];
    return { kind: 'result', content: lines.join('\n') };
  } catch (err) {
    return { kind: 'error', content: `Strategy explorer failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

function solveSpendingTool(ctx: ToolContext, args: z.infer<typeof solveSpendingArgs>): ToolOutcome {
  let inputs = ctx.inputs;
  const notes: string[] = [];
  if (args.overrides && Object.keys(args.overrides).length > 0) {
    const { patch, rejected } = validateOverrides(args.overrides);
    if (rejected.length) notes.push(`Ignored invalid overrides: ${rejected.join('; ')}`);
    inputs = { ...ctx.inputs, ...patch };
  }
  try {
    const result = solveSustainableSpending({
      inputs,
      config: ctx.config,
      targetSuccessRate: args.targetSuccessRate,
      runs: args.runs,
      volatility: inputs.returnVolatility,
    });
    const lines = [
      `Max sustainable after-tax spending for a ${(args.targetSuccessRate * 100).toFixed(0)}% success rate: ${money(result.spending)}/yr (today's $).`,
      ...notes,
      `  achieved success rate ${(result.achievedSuccessRate * 100).toFixed(1)}% over ${result.runs} futures` +
        (result.nextStepSuccessRate != null ? `; one step up drops to ${(result.nextStepSuccessRate * 100).toFixed(1)}%.` : '.'),
    ];
    if (!result.feasible) lines.push('  Even $0 spending misses the target — the plan\'s fixed obligations exceed its resources.');
    if (result.unconstrained) lines.push('  The target holds at the search ceiling — spending is effectively unconstrained by the portfolio.');
    const current = ctx.inputs.desiredSpending;
    lines.push(`  Current desiredSpending is ${money(current)}/yr (${result.spending >= current ? `${money(result.spending - current)}/yr of headroom` : `${money(current - result.spending)}/yr above the safe level`}).`);
    return { kind: 'result', content: lines.join('\n') };
  } catch (err) {
    return { kind: 'error', content: `Spending solver failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

function runMonteCarloTool(ctx: ToolContext, args: z.infer<typeof runMonteCarloArgs>): ToolOutcome {
  let inputs = ctx.inputs;
  const notes: string[] = [];
  if (args.overrides && Object.keys(args.overrides).length > 0) {
    const { patch, rejected } = validateOverrides(args.overrides);
    if (rejected.length) notes.push(`Ignored invalid overrides: ${rejected.join('; ')}`);
    inputs = { ...ctx.inputs, ...patch };
  }
  try {
    const volatility = args.volatility ?? inputs.returnVolatility;
    const result = runMonteCarlo({
      inputs, config: ctx.config,
      runs: args.runs, volatility, seed: 0xC0FFEE,
    });
    const head = notes.length || (args.overrides && Object.keys(args.overrides).length)
      ? `Monte Carlo WITH overrides (what-if; plan unchanged)`
      : 'Monte Carlo of the current plan';
    const lines = [
      `${head} (${result.runs} futures, ${(volatility * 100).toFixed(0)}% volatility): success rate ${(result.successRate * 100).toFixed(1)}% (money lasts to age ${inputs.maxAge}).`,
      ...notes,
      `  median final balance ${money(result.medianFinalBalance)}.`,
    ];
    if (result.depletionHistogram.length) {
      const ages = result.depletionHistogram.map(d => d.age);
      lines.push(`  failures deplete between ages ${Math.min(...ages)} and ${Math.max(...ages)}.`);
    }
    return { kind: 'result', content: lines.join('\n') };
  } catch (err) {
    return { kind: 'error', content: `Monte Carlo failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

function getScheduleTool(ctx: ToolContext, args: z.infer<typeof getScheduleArgs>): ToolOutcome {
  let inputs = ctx.inputs;
  const notes: string[] = [];
  if (args.overrides && Object.keys(args.overrides).length > 0) {
    const { patch, rejected } = validateOverrides(args.overrides);
    if (rejected.length) notes.push(`Ignored invalid overrides: ${rejected.join('; ')}`);
    inputs = { ...ctx.inputs, ...patch };
  }
  try {
    const results = calculateHousehold(inputs, ctx.config);
    const from = args.fromAge ?? ctx.inputs.currentAge;
    const to = args.toAge ?? ctx.inputs.maxAge;
    const inRange = results.yearlyBreakdown.filter(r => r.age >= from && r.age <= to);
    if (inRange.length === 0) {
      return { kind: 'error', content: `No years in range ${from}–${to}.` };
    }
    // Stride N returns every Nth year — but ALWAYS keeps the last year in
    // range, so a horizon-wide view still shows where the plan ends up.
    const stride = args.stride ?? 1;
    const lastAge = inRange[inRange.length - 1].age;
    const rows = stride > 1
      ? inRange.filter((r, i) => i % stride === 0 || r.age === lastAge)
      : inRange;
    const fmtRow = (r: YearlyBreakdown) => {
      const rm = r.loanBalance != null ? `, RM loan ${money(r.loanBalance)} / equity ${money(r.netHomeEquity ?? 0)}` : '';
      const emp = (r.employmentGross ?? 0) > 0 ? `, work net ${money(r.employmentNet ?? 0)}` : '';
      // Contribution room left at year end (issue #24), when tracking is on.
      const room = r.detail?.roomRemaining;
      const roomStr = room
        ? `, room left [tfsa ${room.tfsa != null ? money(room.tfsa) : '∞'} rrsp ${room.rrsp != null ? money(room.rrsp) : '∞'}]`
        : '';
      const over = (r.detail?.overflow?.tfsa ?? 0) > 0 || (r.detail?.overflow?.rrsp ?? 0) > 0
        ? `, OVER-LIMIT spill ${money((r.detail?.overflow?.tfsa ?? 0) + (r.detail?.overflow?.rrsp ?? 0))}`
        : '';
      return `age ${r.age}: start ${money(r.startingBalance)} → end ${money(r.endingBalance)}, ` +
        `withdrew ${money(r.withdrawals)}, tax ${money(r.incomeTax)}, ` +
        `cpp ${money(r.cppIncome)} oas ${money(r.oasIncome)} gis ${money(r.gisIncome)} pension ${money(r.pensionIncome)}` +
        emp + rm + roomStr + over + ((r.shortfall ?? 0) > 0 ? `, SHORT ${money(r.shortfall ?? 0)}` : '');
    };
    const strideNote = stride > 1 && rows.length < inRange.length
      ? [`(showing every ${stride}nd/rd/th year of ${inRange.length} in range ${from}–${to}; the final year is always included)`]
      : [];
    return { kind: 'result', content: [...notes, ...strideNote, ...rows.map(fmtRow)].join('\n') };
  } catch (err) {
    return { kind: 'error', content: `Engine failed to run: ${err instanceof Error ? err.message : String(err)}` };
  }
}
