// The agent's tool surface: a small, typed API the model uses to READ the
// current scenario, RUN the engine against it, and PROPOSE changes.
//
// Every argument shape is a Zod schema — the same source of truth the data
// layer uses — so a hallucinated field name or out-of-range number is rejected
// before it touches anything. The JSON-Schema view of each schema is what gets
// advertised to the provider.
//
// Mutations never apply themselves: `set_scenario_value` returns a proposed
// patch and the UI requires the user to confirm it (confirm-before-apply).

import { z } from 'zod';
import type { RetirementInputs, RetirementResults } from '../retirementEngine';
import { calculateHousehold } from '../retirementEngine';
import type { AppConfig } from '../appConfig';
import { retirementInputsSchema } from '../../data/schemas';
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

const TOOL_SCHEMAS = {
  get_scenario: getScenarioArgs,
  run_projection: runProjectionArgs,
  compare_scenarios: compareScenariosArgs,
  set_scenario_value: setScenarioValueArgs,
} as const;

export type AgentToolName = keyof typeof TOOL_SCHEMAS;

export function isAgentToolName(name: string): name is AgentToolName {
  return name in TOOL_SCHEMAS;
}

/** Fields the agent may propose changing. Mirrors (and supersedes) the old
 *  paste-based agentIngest allow-list: plan levers, not structural internals
 *  like spouse blocks or event arrays, which stay user-driven for now. */
export const EDITABLE_FIELDS = new Set([
  'currentAge', 'retirementAge', 'maxAge',
  'rrspBalance', 'tfsaBalance', 'taxableBalance', 'cashCushionBalance',
  'rrspContribution', 'tfsaContribution', 'taxableContribution',
  'investmentReturn', 'returnVolatility',
  'provinceCode',
  'cppStartAge', 'cppMonthlyAmount', 'oasStartAge', 'oasYearsInCanada',
  'desiredSpending', 'withdrawalOrder',
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
      'Read the current retirement scenario (the plan inputs: ages, account balances, contributions, benefits, spending, withdrawal order, spouse).',
      getScenarioArgs),
    spec('run_projection',
      'Run the retirement engine on the current plan (optionally with overrides) and return the computed verdict: funded/depleted, key ages, tax, and a compact year digest.',
      runProjectionArgs),
    spec('compare_scenarios',
      'Run the engine twice — the current plan and a variant defined by overrides — and return both outcomes plus the deltas.',
      compareScenariosArgs),
    spec('set_scenario_value',
      'PROPOSE changing one plan input. Nothing is applied until the user confirms; the change appears to them as a reviewable card. Only for top-level plan levers.',
      setScenarioValueArgs),
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
  | { kind: 'mutation'; field: string; value: unknown; rationale?: string; preview: Record<string, unknown> }
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
    case 'set_scenario_value':
      return proposeSet(ctx, parsed.data as z.infer<typeof setScenarioValueArgs>);
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
    if (key === 'spouse' || key === 'spouseSource' || key === 'events' || key === 'pensions'
      || key === 'employment' || key === 'spendingBands' || key === 'reverseMortgage') {
      rejected.push(`${key}: structural field — not changeable through this tool`);
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
    return { kind: 'error', content: `"${field}" is not changeable through the agent. Changeable fields: ${known}.` };
  }
  const shape = retirementInputsSchema.shape as Record<string, z.ZodType>;
  const res = shape[field].safeParse(value);
  if (!res.success) {
    return { kind: 'error', content: `Invalid value for ${field}: ${zodIssues(res.error)}` };
  }
  const currentValue = (ctx.inputs as unknown as Record<string, unknown>)[field];
  return {
    kind: 'mutation',
    field,
    value: res.data,
    rationale: args.rationale,
    preview: { field, from: currentValue, to: res.data },
  };
}
