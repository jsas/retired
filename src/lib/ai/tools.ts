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
import type { RetirementInputs, RetirementResults, YearlyBreakdown } from '../retirementEngine';
import { calculateHousehold, householdOutcome } from '../retirementEngine';
import type { AppConfig } from '../appConfig';
import { runStrategies, type StrategyFilter } from '../strategies';
import { solveSustainableSpending } from '../spendingSolver';
import { runMonteCarlo } from '../monteCarlo';
import {
  retirementInputsSchema, spouseSchema, pensionSchema, employmentIncomeSchema,
  cashEventSchema, reverseMortgageSchema, rdspSchema,
} from '../../data/schemas';
import { buildRevertPlan, encodeRevertPatch, type PlanCheckpoint } from './checkpoints';
import { MemoryStore } from '../memory/store';
import type { AgentToolCall, ToolSpec } from './providers';

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

const setScenarioValueArgs = z.object({
  field: z.string().min(1)
    .describe('Top-level RetirementInputs field name (e.g. desiredSpending, retirementAge, rrspBalance, cppStartAge).'),
  value: z.unknown()
    .describe('The proposed new value. Must satisfy the scenario schema (numbers as numbers; nullable ages may be null).'),
  rationale: z.string().optional()
    .describe('One sentence on why this change helps — shown to the user on the confirm card.'),
});

const proposePatchArgs = z.object({
  changes: z.record(z.string(), z.unknown())
    .describe('A batch of top-level RetirementInputs fields to change at once (e.g. {"cppStartAge":70,"oasStartAge":70}). Each is validated; invalid entries are rejected, not proposed.'),
  rationale: z.string().optional()
    .describe('One sentence on why this batch helps — shown on the confirm card.'),
});

const proposeSpouseArgs = z.object({
  changes: z.record(z.string(), z.unknown())
    .describe('Spouse fields to set. Use {"enabled":true,...} to add a spouse (fill the key fields), or {"enabled":false} to remove. Any SpouseInputs scalar field is allowed.'),
  rationale: z.string().optional(),
});

const proposePensionArgs = pensionSchema
  .omit({ id: true })
  .extend({ rationale: z.string().optional() })
  .describe('A DB/bridge pension to add. Set endAge to a number for a bridge (pays through that age); null for lifetime.');

const proposeEmploymentArgs = employmentIncomeSchema
  .omit({ id: true })
  .extend({ rationale: z.string().optional() })
  .describe('Semi-/post-retirement work income to add.');

const proposeSpendingBandsArgs = z.object({
  bands: z.array(z.object({ fromAge: z.number(), pctOfBase: z.number() }))
    .describe('Spending phases: pctOfBase (fraction of desiredSpending, e.g. 1, 0.85, 0.7) applying fromAge until the next band. Replaces the whole set.'),
  rationale: z.string().optional(),
});

const proposeCashEventArgs = cashEventSchema
  .omit({ id: true })
  .extend({ rationale: z.string().optional() })
  .describe('A one-time or recurring cash event (inflow to an account, or outflow adding to spending). Set endAge to repeat yearly through that age.');

const proposeReverseMortgageArgs = z.object({
  changes: reverseMortgageSchema.partial()
    .describe('Reverse-mortgage fields to set. Use {"enabled":true,...} to turn it on (homeValue, interestRate, draws/top-up), {"enabled":false} to turn it off.'),
  rationale: z.string().optional(),
});

const proposeRdspArgs = z.object({
  changes: rdspSchema.partial()
    .describe('RDSP fields to set. Use {"enabled":true,...} to turn it on (balance, contribution, familyIncome, dtcEligible), {"enabled":false} to turn it off.'),
  rationale: z.string().optional(),
});

const proposeRevertArgs = z.object({
  checkpoint: z.string().optional()
    .describe('Which checkpoint to revert to: its label, or omit for the most recent one. Labels come from the change cards the user approved ("Add pension").'),
  rationale: z.string().optional(),
});

const manageCashEventArgs = z.object({
  action: z.enum(['update', 'remove']),
  target: z.string().min(1)
    .describe('Which cash event: its id, or its label if unique (e.g. "Downsize").'),
  changes: z.record(z.string(), z.unknown()).optional()
    .describe('For update: the cash-event fields to change (age, amount, direction, endAge, account, label). Missing fields keep their current values.'),
  rationale: z.string().optional(),
});

const managePensionArgs = z.object({
  action: z.enum(['update', 'remove']),
  target: z.string().min(1)
    .describe('Which pension: its id, or its label if unique (e.g. "Work DB").'),
  changes: z.record(z.string(), z.unknown()).optional()
    .describe('For update: the pension fields to change (annualAmount, startAge, endAge, indexedToCpi, label). endAge must be a number or explicit null.'),
  rationale: z.string().optional(),
});

const runStrategiesArgs = z.object({
  categories: z.array(z.enum(['cpp', 'oas', 'withdrawal_order', 'reverse_mortgage', 'work'])).optional()
    .describe('Scope the explorer to specific lever families (e.g. ["cpp","oas"] for benefit timing only). Omit for all.'),
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
  withDetails: z.boolean().default(false)
    .describe('true = include the key numbers of each plan (ages, balances, spending, benefits) so you can compare saved plans without opening them. Omit/false for a compact list.'),
});

const TOOL_SCHEMAS = {
  get_scenario: getScenarioArgs,
  run_projection: runProjectionArgs,
  compare_scenarios: compareScenariosArgs,
  run_strategies: runStrategiesArgs,
  solve_spending: solveSpendingArgs,
  run_monte_carlo: runMonteCarloArgs,
  get_schedule: getScheduleArgs,
  set_scenario_value: setScenarioValueArgs,
  propose_patch: proposePatchArgs,
  propose_spouse: proposeSpouseArgs,
  propose_pension: proposePensionArgs,
  propose_employment: proposeEmploymentArgs,
  propose_spending_bands: proposeSpendingBandsArgs,
  propose_cash_event: proposeCashEventArgs,
  propose_reverse_mortgage: proposeReverseMortgageArgs,
  propose_rdsp: proposeRdspArgs,
  propose_revert: proposeRevertArgs,
  manage_cash_event: manageCashEventArgs,
  manage_pension: managePensionArgs,
  remember: rememberArgs,
  recall: recallArgs,
  open_scenario: openScenarioArgs,
  save_scenario_as: saveScenarioAsArgs,
  list_scenarios: listScenariosArgs,
} as const;

export type AgentToolName = keyof typeof TOOL_SCHEMAS;

export function isAgentToolName(name: string): name is AgentToolName {
  return name in TOOL_SCHEMAS;
}

/** Top-level scalar fields the agent may propose changing (via set_scenario_value
 *  or propose_patch). Structural blocks (spouse, events, pensions, employment,
 *  spendingBands, reverseMortgage) go through their own propose_* tools. */
export const EDITABLE_FIELDS = new Set([
  'currentAge', 'retirementAge', 'maxAge',
  'rrspBalance', 'tfsaBalance', 'taxableBalance', 'cashCushionBalance',
  'rrspContribution', 'tfsaContribution', 'taxableContribution',
  'investmentReturn', 'returnVolatility',
  'provinceCode',
  'cppStartAge', 'cppMonthlyAmount', 'oasStartAge', 'oasYearsInCanada',
  'desiredSpending', 'withdrawalOrder',
]);

/** Structural top-level keys that are refused in flat override patches — they
 *  have dedicated propose_* tools with element-level validation. */
const STRUCTURAL_FIELDS = new Set([
  'spouse', 'spouseSource', 'events', 'pensions', 'employment', 'spendingBands', 'reverseMortgage', 'rdsp',
]);

// ---------------------------------------------------------------------------
// Tool specs advertised to providers (Zod → JSON Schema)
// ---------------------------------------------------------------------------

export function toolSpecs(): ToolSpec[] {
  const spec = (name: string, description: string, schema: z.ZodType): ToolSpec => ({
    name,
    description,
    jsonSchema: z.toJSONSchema(schema) as Record<string, unknown>,
  });
  return [
    spec('get_scenario',
      'Read the current retirement scenario (plan inputs: ages, balances, contributions, benefits, spending, withdrawal order, spouse, pensions, employment, reverse mortgage).',
      getScenarioArgs),
    spec('run_projection',
      'Run the engine on the current plan (optionally with overrides) and return the verdict: funded/depleted, key ages, tax, and a compact year digest.',
      runProjectionArgs),
    spec('compare_scenarios',
      'Compare the current plan against one or more variants (up to 4) defined by flat override patches, and return all outcomes plus deltas vs current. Use for "retire at 60 vs 65 vs 70?".',
      compareScenariosArgs),
    spec('run_strategies',
      'Run the deterministic strategy explorer: rank named lever variants (CPP/OAS timing, withdrawal order, retirement age) against the current plan by sustainable spending, tax, and GIS. Optionally scope with categories/maxVariants. Use for "what levers help most?" steering.',
      runStrategiesArgs),
    spec('solve_spending',
      'Invert the verdict: find the most the user can spend per year (after tax) for a target Monte Carlo success rate. Accepts overrides for what-if solving. Use for "how much can I safely spend?"',
      solveSpendingArgs),
    spec('run_monte_carlo',
      'Run the Monte Carlo simulation on the current plan (optionally with overrides) and return the success rate, median final balance, and depletion spread across market futures.',
      runMonteCarloArgs),
    spec('get_schedule',
      'Return the year-by-year projection table (balances, withdrawals, tax, CPP/OAS/GIS, pension, employment, reverse mortgage) for an age range. Use stride to cover a whole horizon in one call.',
      getScheduleArgs),
    spec('set_scenario_value',
      'PROPOSE changing one plan input. Nothing is applied until the user confirms; it appears as a reviewable card. For top-level scalar levers only.',
      setScenarioValueArgs),
    spec('propose_patch',
      'PROPOSE changing several top-level scalar fields at once (e.g. CPP+OAS timing). One confirm card. For structural blocks use the dedicated propose_* tools.',
      proposePatchArgs),
    spec('propose_spouse',
      'PROPOSE adding a spouse/partner (or editing spouse fields, or removing). The spouse is a second plan combined for household totals. User confirms.',
      proposeSpouseArgs),
    spec('propose_pension',
      'PROPOSE adding a DB/bridge pension (taxable income stacked with CPP/OAS). User confirms.',
      proposePensionArgs),
    spec('propose_employment',
      'PROPOSE adding semi-/post-retirement work income. User confirms.',
      proposeEmploymentArgs),
    spec('propose_spending_bands',
      'PROPOSE replacing the spending phases (go-go/slow-go/no-go as % of base spending by age). User confirms.',
      proposeSpendingBandsArgs),
    spec('propose_cash_event',
      'PROPOSE adding a one-time or recurring cash event (inflow to an account, or outflow adding to spending). User confirms.',
      proposeCashEventArgs),
    spec('propose_reverse_mortgage',
      'PROPOSE enabling/configuring (or disabling) a reverse mortgage on the home. User confirms.',
      proposeReverseMortgageArgs),
    spec('propose_rdsp',
      'PROPOSE enabling/configuring (or disabling) an RDSP (Registered Disability Savings Plan). Models CDSG grants, CDSB bonds, tax-sheltered growth, and taxable-fraction withdrawals. User confirms.',
      proposeRdspArgs),
    spec('propose_revert',
      'PROPOSE rolling the plan back to a checkpoint — an automatic snapshot taken just before a previously-approved change landed. Use when an experiment did not pan out ("that made it worse, undo it"). User confirms.',
      proposeRevertArgs),
    spec('manage_cash_event',
      'PROPOSE updating or REMOVING an existing cash event (by id or unique label). User confirms. Use propose_cash_event to add a new one.',
      manageCashEventArgs),
    spec('manage_pension',
      'PROPOSE updating or REMOVING an existing pension (by id or unique label). User confirms. Use propose_pension to add a new one.',
      managePensionArgs),
    spec('remember',
      'Save a durable fact to memory for later conversations — about THIS plan (scope "scenario": a decision the user made, a figure they quoted, a constraint like "cannot touch the RRSP") or about the user themselves (scope "global": preferences, life plans). ONLY when clearly important; never for numbers already in the plan or in computed results. When the fact uses a specific term a future question might generalize (oranges → fruit), pass those category words as keywords so the fact can be found again.',
      rememberArgs),
    spec('recall',
      'Search what you remember (facts saved in earlier conversations). Matching is by KEYWORD — query with the words a category would be filed under ("fruit", "pension", "city"), not a full sentence. If nothing matches, the closest memories are returned anyway; use them before telling the user you don\'t know. Omit the query to list the most important current memories — do this at the START of a conversation to ground yourself.',
      recallArgs),
    spec('open_scenario',
      'Switch to another SAVED scenario (by id or name). Use when the user wants to look at / work on a different plan. Unsaved edits in the current plan are saved first, so nothing is lost.',
      openScenarioArgs),
    spec('save_scenario_as',
      'Snapshot the CURRENT plan as a new saved scenario with a name, and make it active. Use when the user wants to keep a variant alongside the original (e.g. "keep this as its own plan") — the original stays untouched.',
      saveScenarioAsArgs),
    spec('list_scenarios',
      'List every SAVED scenario: names, ids, and which one is active. With withDetails, also return each plan\'s key numbers (ages, balances, spending, CPP/OAS) so you can compare saved plans without switching. Use whenever the user asks what plans exist or which to open.',
      listScenariosArgs),
  ];
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
   *  and 'off'-mode callers can omit it — open_scenario then errors. */
  onOpenScenario?: (id: string) => void;
  /** Snapshot the current live inputs as a new named scenario; returns its id.
   *  Optional for the same reason — save_scenario_as then errors. */
  onSaveScenarioAs?: (name: string) => string;
}

export type ToolOutcome =
  | { kind: 'result'; content: string }
  | {
      kind: 'mutation';
      /** The proposed change as a partial inputs patch (merged over the plan
       *  on approval). Always present — structural proposals put their block
       *  here; single-field ones put { [field]: value }. */
      patch: Partial<RetirementInputs>;
      /** Short label for the card ("Set CPP start age", "Add spouse"). */
      label: string;
      /** Human-readable preview lines shown on the confirm card. */
      preview: Record<string, unknown>;
      rationale?: string;
      /** Revert proposals encode absent-at-checkpoint fields with a sentinel
       *  (JSON can't carry undefined); the UI must decode before applying. */
      revert?: true;
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
 *  (set_scenario_value, propose_patch, flat overrides). */
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
  const parsed = schema.safeParse(call.args ?? {});
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
    case 'set_scenario_value':
      return proposeSet(ctx, parsed.data as z.infer<typeof setScenarioValueArgs>);
    case 'propose_patch':
      return proposePatch(ctx, parsed.data as z.infer<typeof proposePatchArgs>);
    case 'propose_spouse':
      return proposeSpouse(ctx, parsed.data as z.infer<typeof proposeSpouseArgs>);
    case 'propose_pension':
      return proposeElement(ctx, 'pensions', pensionSchema, parsed.data, 'pension');
    case 'propose_employment':
      return proposeElement(ctx, 'employment', employmentIncomeSchema, parsed.data, 'employment income');
    case 'propose_spending_bands':
      return proposeSpendingBands(ctx, parsed.data as z.infer<typeof proposeSpendingBandsArgs>);
    case 'propose_cash_event':
      return proposeElement(ctx, 'events', cashEventSchema, parsed.data, 'cash event');
    case 'propose_reverse_mortgage':
      return proposeReverseMortgage(ctx, parsed.data as z.infer<typeof proposeReverseMortgageArgs>);
    case 'propose_rdsp':
      return proposeRdsp(ctx, parsed.data as z.infer<typeof proposeRdspArgs>);
    case 'propose_revert':
      return proposeRevert(ctx, parsed.data as z.infer<typeof proposeRevertArgs>);
    case 'manage_cash_event':
      return manageElement(ctx, 'events', cashEventSchema, parsed.data as z.infer<typeof manageCashEventArgs>, 'cash event');
    case 'manage_pension':
      return manageElement(ctx, 'pensions', pensionSchema, parsed.data as z.infer<typeof managePensionArgs>, 'pension');
    case 'remember':
      return rememberTool(ctx, parsed.data as z.infer<typeof rememberArgs>);
    case 'recall':
      return recallTool(ctx, parsed.data as z.infer<typeof recallArgs>);
    case 'open_scenario':
      return openScenarioTool(ctx, parsed.data as z.infer<typeof openScenarioArgs>);
    case 'save_scenario_as':
      return saveScenarioAsTool(ctx, parsed.data as z.infer<typeof saveScenarioAsArgs>);
    case 'list_scenarios':
      return listScenariosTool(ctx, parsed.data as z.infer<typeof listScenariosArgs>);
  }
}

// ---------------------------------------------------------------------------
// Individual tools
// ---------------------------------------------------------------------------

function describeScenario(ctx: ToolContext, section: z.infer<typeof sectionSchema>): string {
  const i = ctx.inputs;
  const lines: string[] = [`Scenario "${ctx.scenarioName}" (of ${ctx.scenarioList.length} saved).`];

  const summary = {
    currentAge: i.currentAge, retirementAge: i.retirementAge, maxAge: i.maxAge,
    province: i.provinceCode,
    hasSpouse: i.spouse?.enabled === true,
    desiredSpending: i.desiredSpending,
    investmentReturn: i.investmentReturn, returnVolatility: i.returnVolatility,
  };
  const accounts = {
    rrsp: i.rrspBalance, tfsa: i.tfsaBalance, taxable: i.taxableBalance,
    cashCushion: i.cashCushionBalance,
    contributionsPerYear: { rrsp: i.rrspContribution, tfsa: i.tfsaContribution, taxable: i.taxableContribution },
    ...(i.rdsp?.enabled ? {
      rdsp: {
        balance: i.rdsp.balance, contribution: i.rdsp.contribution,
        familyIncome: i.rdsp.familyIncome, dtcEligible: i.rdsp.dtcEligible,
      },
    } : {}),
    withdrawalOrder: i.withdrawalOrder,
  };
  const benefits = {
    cpp: i.cppStartAge == null ? 'not taken'
      : `${money(i.cppMonthlyAmount)}/mo from age ${i.cppStartAge}${i.cppAdjustedAmount ? ' (already adjusted)' : ''}`,
    oas: i.oasStartAge == null ? 'not taken'
      : `from age ${i.oasStartAge}, ${i.oasYearsInCanada} years in Canada`,
    pensions: (i.pensions ?? []).map(p =>
      `${p.label}: ${money(p.annualAmount)}/yr from ${p.startAge}${p.endAge != null ? ` to ${p.endAge}` : ''}${p.indexedToCpi ? ' (indexed)' : ''}`),
  };
  const spending = {
    desiredSpending: i.desiredSpending,
    bands: (i.spendingBands ?? []).map(b => `${(b.pctOfBase * 100).toFixed(0)}% from age ${b.fromAge}`),
    events: (i.events ?? []).map(e => `${e.label}: ${money(e.amount)} ${e.direction} at age ${e.age}${e.endAge != null ? `–${e.endAge}` : ''}`),
  };
  const spouse = i.spouse?.enabled ? {
    currentAge: i.spouse.currentAge, retirementAge: i.spouse.retirementAge,
    rrsp: i.spouse.rrspBalance, tfsa: i.spouse.tfsaBalance, taxable: i.spouse.taxableBalance,
    cpp: i.spouse.cppStartAge == null ? 'not taken' : `${money(i.spouse.cppMonthlyAmount)}/mo from ${i.spouse.cppStartAge}`,
    oasStartAge: i.spouse.oasStartAge, desiredSpending: i.spouse.desiredSpending,
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
 *  events, pensions…) are refused here — overrides are for scalar levers. */
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
  const ho = householdOutcome(results, inputs);
  const lines = [
    `${label}: ${ho.status === 'ON_TRACK' ? 'ON TRACK' : 'SHORTFALL'} — ` +
    (ho.depletionAge != null
      ? `household portfolio depletes at age ${ho.depletionAge}`
      : `household funded to age ${inputs.maxAge}+`),
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

function proposeSet(
  ctx: ToolContext,
  args: { field: string; value: unknown; rationale?: string },
): ToolOutcome {
  const { field, value } = args;
  if (!EDITABLE_FIELDS.has(field)) {
    const known = [...EDITABLE_FIELDS].join(', ');
    return { kind: 'error', content: `"${field}" is not changeable through the agent. Changeable scalar fields: ${known}. Structural blocks use their propose_* tool.` };
  }
  const shape = retirementInputsSchema.shape as Record<string, z.ZodType>;
  const res = safeParseTolerant(shape[field], value);
  if (!res.success) {
    return { kind: 'error', content: `Invalid value for ${field}: ${zodIssues(res.error)}` };
  }
  const currentValue = (ctx.inputs as unknown as Record<string, unknown>)[field];
  return {
    kind: 'mutation',
    patch: { [field]: res.data } as Partial<RetirementInputs>,
    label: `Set ${field}`,
    rationale: args.rationale,
    preview: { field, from: currentValue, to: res.data },
  };
}

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

/** Add/edit/remove the spouse. Edits merge over the existing spouse block. */
function proposeSpouse(
  ctx: ToolContext,
  args: { changes: Record<string, unknown>; rationale?: string },
): ToolOutcome {
  const existing = ctx.inputs.spouse;
  const merged = { ...(existing ?? {}), ...args.changes };
  const res = spouseSchema.safeParse(merged);
  if (!res.success) {
    const missing = res.error.issues.map(i => i.path.join('.')).filter(Boolean);
    return {
      kind: 'error',
      content: `Invalid spouse data: ${zodIssues(res.error)}.` +
        (!existing && args.changes.enabled !== false
          ? ' To ADD a spouse you must supply the full block (currentAge, retirementAge, balances, contributions, cpp/oas, desiredSpending).'
          : '') +
        (missing.length ? ` Missing/invalid: ${missing.join(', ')}.` : ''),
    };
  }
  const enabling = args.changes.enabled === true && !existing?.enabled;
  const disabling = args.changes.enabled === false;
  return {
    kind: 'mutation',
    patch: { spouse: res.data },
    label: disabling ? 'Remove spouse' : enabling ? 'Add spouse/partner' : 'Update spouse',
    rationale: args.rationale,
    preview: { spouse: res.data },
  };
}

/** Shared helper for the append-to-array structural tools (pension, employment,
 *  cash event). Validates the element (minus its id), generates an id, and
 *  proposes the array with the new element appended. */
function proposeElement(
  ctx: ToolContext,
  key: 'pensions' | 'employment' | 'events',
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
  _ctx: ToolContext,
  args: { bands: Array<{ fromAge: number; pctOfBase: number }>; rationale?: string },
): ToolOutcome {
  const band = z.object({ fromAge: z.number(), pctOfBase: z.number().min(0).max(3) });
  const res = z.array(band).safeParse(args.bands);
  if (!res.success) {
    return { kind: 'error', content: `Invalid spending bands: ${zodIssues(res.error)}` };
  }
  const sorted = [...res.data].sort((a, b) => a.fromAge - b.fromAge);
  return {
    kind: 'mutation',
    patch: { spendingBands: sorted },
    label: 'Set spending phases',
    rationale: args.rationale,
    preview: { bands: sorted.map(b => `${(b.pctOfBase * 100).toFixed(0)}% from age ${b.fromAge}`) },
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

/** Shared helper for manage_cash_event / manage_pension: update (merge fields
 *  over the matched element, re-validated) or remove. Target matches by exact
 *  id first, then by unique case-insensitive label. */
function manageElement(
  ctx: ToolContext,
  key: 'events' | 'pensions',
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

/** open_scenario: switch the active scenario (the sidebar-switch path). A
 *  navigation, not a plan mutation — no confirm card — but the caller must
 *  announce the switch so the model/user stay oriented. Resolves by id first,
 *  then by unique case-insensitive name; unsaved edits are the caller's
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

/** save_scenario_as: snapshot the CURRENT live inputs as a new named scenario
 *  and make it active (so later agent edits land on the copy). A direct write
 *  (no confirm card): it ADDS a scenario and touches no existing one. */
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
function listScenariosTool(ctx: ToolContext, args: z.infer<typeof listScenariosArgs>): ToolOutcome {
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
      return `age ${r.age}: start ${money(r.startingBalance)} → end ${money(r.endingBalance)}, ` +
        `withdrew ${money(r.withdrawals)}, tax ${money(r.incomeTax)}, ` +
        `cpp ${money(r.cppIncome)} oas ${money(r.oasIncome)} gis ${money(r.gisIncome)} pension ${money(r.pensionIncome)}` +
        emp + rm + ((r.shortfall ?? 0) > 0 ? `, SHORT ${money(r.shortfall ?? 0)}` : '');
    };
    const strideNote = stride > 1 && rows.length < inRange.length
      ? [`(showing every ${stride}nd/rd/th year of ${inRange.length} in range ${from}–${to}; the final year is always included)`]
      : [];
    return { kind: 'result', content: [...notes, ...strideNote, ...rows.map(fmtRow)].join('\n') };
  } catch (err) {
    return { kind: 'error', content: `Engine failed to run: ${err instanceof Error ? err.message : String(err)}` };
  }
}
