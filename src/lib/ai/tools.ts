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
import { calculateHousehold } from '../retirementEngine';
import type { AppConfig } from '../appConfig';
import { runStrategies } from '../strategies';
import { solveSustainableSpending } from '../spendingSolver';
import { runMonteCarlo } from '../monteCarlo';
import {
  retirementInputsSchema, spouseSchema, pensionSchema, employmentIncomeSchema,
  cashEventSchema, reverseMortgageSchema,
} from '../../data/schemas';
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
  overrides: z.record(z.string(), z.unknown())
    .describe('Flat patch of top-level RetirementInputs fields defining the variant to compare against the current plan.'),
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

const runStrategiesArgs = z.object({}).describe('No arguments.');

const solveSpendingArgs = z.object({
  targetSuccessRate: z.number().min(0.5).max(0.99).default(0.9)
    .describe('Target Monte Carlo success rate as a fraction, e.g. 0.9 = 90% chance the money lasts to max age.'),
  runs: z.number().int().min(50).max(2000).default(500)
    .describe('Market futures to simulate per candidate. More = smoother, slower.'),
});

const runMonteCarloArgs = z.object({
  runs: z.number().int().min(50).max(2000).default(500),
  volatility: z.number().min(0).max(0.5).optional()
    .describe('Annual return standard deviation. Defaults to the plan\'s returnVolatility.'),
});

const getScheduleArgs = z.object({
  fromAge: z.number().optional().describe('First age to include (default: currentAge).'),
  toAge: z.number().optional().describe('Last age to include (default: maxAge). Keep ranges small to save tokens.'),
  overrides: z.record(z.string(), z.unknown()).optional(),
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
  'spouse', 'spouseSource', 'events', 'pensions', 'employment', 'spendingBands', 'reverseMortgage',
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
      'Run the engine twice — current plan and a variant defined by overrides — and return both outcomes plus the deltas.',
      compareScenariosArgs),
    spec('run_strategies',
      'Run the deterministic strategy explorer: rank named lever variants (CPP/OAS timing, withdrawal order, retirement age) against the current plan by sustainable spending, tax, and GIS. Use for "what levers help most?" steering.',
      runStrategiesArgs),
    spec('solve_spending',
      'Invert the verdict: find the most the user can spend per year (after tax) for a target Monte Carlo success rate. Use for "how much can I safely spend?"',
      solveSpendingArgs),
    spec('run_monte_carlo',
      'Run the Monte Carlo simulation on the current plan and return the success rate, median final balance, and depletion spread across market futures.',
      runMonteCarloArgs),
    spec('get_schedule',
      'Return the year-by-year projection table (balances, withdrawals, tax, CPP/OAS/GIS, pension, employment, reverse mortgage) for an age range. Keep the range small.',
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
    }
  | { kind: 'error'; content: string };

const money = (v: number) =>
  new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 }).format(v);

function zodIssues(error: z.ZodError): string {
  return error.issues.map(i => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
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
      return compareScenarios(ctx, (parsed.data as z.infer<typeof compareScenariosArgs>).overrides);
    case 'run_strategies':
      return runStrategiesTool(ctx);
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
    const res = (shape as Record<string, z.ZodType>)[key].safeParse(value);
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
  const lines = [
    `${label}: ${results.status === 'ON_TRACK' ? 'ON TRACK' : 'SHORTFALL'} — ` +
    (results.depletionAge != null
      ? `portfolio depletes at age ${results.depletionAge}`
      : `funded to age ${inputs.maxAge}+`),
    `  net worth at retirement ${money(results.totalNetWorthAtRetirement)}, ` +
    `withdrawal rate ${(results.withdrawalRate * 100).toFixed(1)}%, ` +
    `lifetime tax ${money(lifetimeTax)}, ending balance ${money(last?.endingBalance ?? 0)}`,
  ];
  if (firstShortfall) {
    lines.push(`  first unfunded spending gap at age ${firstShortfall.age} (${money(firstShortfall.shortfall ?? 0)} short that year)`);
  }
  if (results.spouse) {
    lines.push(
      `  spouse: ${results.spouse.status === 'ON_TRACK' ? 'on track' : `depletes at ${results.spouse.depletionAge}`}, ` +
      `ending ${money(results.spouse.yearlyBreakdown.at(-1)?.endingBalance ?? 0)}`,
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

function compareScenarios(ctx: ToolContext, overrides: Record<string, unknown>): ToolOutcome {
  const { patch, rejected } = validateOverrides(overrides);
  if (Object.keys(patch).length === 0) {
    return { kind: 'error', content: `No valid overrides to compare. ${rejected.join('; ') || 'Patch was empty.'}` };
  }
  try {
    const base = calculateHousehold(ctx.inputs, ctx.config);
    const variantInputs = { ...ctx.inputs, ...patch };
    const variant = calculateHousehold(variantInputs, ctx.config);
    const delta = (a: number, b: number) => {
      const d = b - a;
      return `${d >= 0 ? '+' : '−'}${money(Math.abs(d))}`;
    };
    const lines = [
      `Variant overrides: ${JSON.stringify(patch)}`,
      ...(rejected.length ? [`Ignored invalid overrides: ${rejected.join('; ')}`] : []),
      summarizeResults('CURRENT plan', ctx.inputs, base),
      summarizeResults('VARIANT', variantInputs, variant),
      'DELTAS (variant − current):',
      `  ending balance ${delta(end(base), end(variant))}`,
      `  lifetime tax ${delta(lifeTax(base), lifeTax(variant))}`,
      `  depletion: ${fmtDepl(base)} → ${fmtDepl(variant)}`,
    ];
    return { kind: 'result', content: lines.join('\n') };
  } catch (err) {
    return { kind: 'error', content: `Engine failed to run: ${err instanceof Error ? err.message : String(err)}` };
  }
}

const end = (r: RetirementResults) => r.yearlyBreakdown.at(-1)?.endingBalance ?? 0;
const lifeTax = (r: RetirementResults) => r.yearlyBreakdown.at(-1)?.cumulativeTax ?? 0;
const fmtDepl = (r: RetirementResults) => (r.depletionAge != null ? `depletes ${r.depletionAge}` : 'funded to max age');

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
  const res = shape[field].safeParse(value);
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
    const res = shape[field].safeParse(value);
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

let idSeq = 0;
const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(++idSeq).toString(36)}`;

// ---------------------------------------------------------------------------
// Read backends (pure; no confirmation)
// ---------------------------------------------------------------------------

function runStrategiesTool(ctx: ToolContext): ToolOutcome {
  try {
    const report = runStrategies(ctx.inputs, ctx.config);
    const row = (s: { name: string; survived: boolean; sustainableSpending: number; deltaSpending: number; lifetimeTax: number; lifetimeGis: number; endingBalance: number; depletionAge: number | null }) =>
      `  ${s.name}: ${s.survived ? 'survives' : `depletes ${s.depletionAge}`}, ` +
      `sustainable spending ${money(s.sustainableSpending)}/yr (${s.deltaSpending >= 0 ? '+' : '−'}${money(Math.abs(s.deltaSpending))} vs current), ` +
      `tax ${money(s.lifetimeTax)}, GIS ${money(s.lifetimeGis)}, ending ${money(s.endingBalance)}`;
    const lines = [
      `CURRENT plan: sustainable spending ${money(report.baseline.sustainableSpending)}/yr.`,
      'Strategies (best first):',
      ...report.strategies.map(row),
      'Suggested levers:',
      ...report.suggestedActions.map(a => `  - ${a}`),
    ];
    return { kind: 'result', content: lines.join('\n') };
  } catch (err) {
    return { kind: 'error', content: `Strategy explorer failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

function solveSpendingTool(ctx: ToolContext, args: z.infer<typeof solveSpendingArgs>): ToolOutcome {
  try {
    const result = solveSustainableSpending({
      inputs: ctx.inputs,
      config: ctx.config,
      targetSuccessRate: args.targetSuccessRate,
      runs: args.runs,
      volatility: ctx.inputs.returnVolatility,
    });
    const lines = [
      `Max sustainable after-tax spending for a ${(args.targetSuccessRate * 100).toFixed(0)}% success rate: ${money(result.spending)}/yr (today's $).`,
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
  try {
    const volatility = args.volatility ?? ctx.inputs.returnVolatility;
    const result = runMonteCarlo({
      inputs: ctx.inputs, config: ctx.config,
      runs: args.runs, volatility, seed: 0xC0FFEE,
    });
    const lines = [
      `Monte Carlo (${result.runs} futures, ${(volatility * 100).toFixed(0)}% volatility): success rate ${(result.successRate * 100).toFixed(1)}% (money lasts to age ${ctx.inputs.maxAge}).`,
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
    const rows = results.yearlyBreakdown.filter(r => r.age >= from && r.age <= to);
    if (rows.length === 0) {
      return { kind: 'error', content: `No years in range ${from}–${to}.` };
    }
    const fmtRow = (r: YearlyBreakdown) => {
      const rm = r.loanBalance != null ? `, RM loan ${money(r.loanBalance)} / equity ${money(r.netHomeEquity ?? 0)}` : '';
      const emp = (r.employmentGross ?? 0) > 0 ? `, work net ${money(r.employmentNet ?? 0)}` : '';
      return `age ${r.age}: start ${money(r.startingBalance)} → end ${money(r.endingBalance)}, ` +
        `withdrew ${money(r.withdrawals)}, tax ${money(r.incomeTax)}, ` +
        `cpp ${money(r.cppIncome)} oas ${money(r.oasIncome)} gis ${money(r.gisIncome)} pension ${money(r.pensionIncome)}` +
        emp + rm + ((r.shortfall ?? 0) > 0 ? `, SHORT ${money(r.shortfall ?? 0)}` : '');
    };
    return { kind: 'result', content: [...notes, ...rows.map(fmtRow)].join('\n') };
  } catch (err) {
    return { kind: 'error', content: `Engine failed to run: ${err instanceof Error ? err.message : String(err)}` };
  }
}
