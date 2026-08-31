// Agent prompt generation + structured-result ingestion.
//
// buildAgentPrompt() renders a self-contained text prompt describing the
// current plan, the engine's levers and constraints, and a strict JSON output
// schema. The user pastes that prompt to an external AI, then pastes the AI's
// JSON reply into the app. parseAgentResult() validates it defensively and
// turns it into a safe RetirementInputs patch — unknown fields are reported
// and ignored, out-of-range numbers are clamped or rejected with reasons.

import type { RetirementInputs, WithdrawalAccount } from '@retired/engine-core/retirementEngine';

export interface IngestResult {
  ok: boolean;
  patch?: Partial<RetirementInputs>;
  applied: string[];   // human-readable list of accepted changes
  warnings: string[];  // fields ignored / clamped, with reasons
  error?: string;      // fatal: nothing applied
}

const VALID_ACCOUNTS: WithdrawalAccount[] = ['tfsa', 'taxable', 'rrsp', 'rdsp'];

// The editable levers we let an agent suggest. Maps JSON key -> applier with
// range validation. Each returns the applied value or throws a reason string.
const FIELDS: Record<string, (v: unknown, cur: RetirementInputs) => number | string | boolean | WithdrawalAccount[]> = {
  retirementAge: (v) => numIn(v, 45, 75, 'retirementAge'),
  cppStartAge: (v) => numIn(v, 60, 70, 'cppStartAge'),
  cppMonthlyAmount: (v) => numIn(v, 0, 5000, 'cppMonthlyAmount'),
  oasStartAge: (v) => numIn(v, 65, 70, 'oasStartAge'),
  desiredSpending: (v) => numIn(v, 0, 10000000, 'desiredSpending'),
  rrspContribution: (v) => numIn(v, 0, 1000000, 'rrspContribution'),
  tfsaContribution: (v) => numIn(v, 0, 1000000, 'tfsaContribution'),
  taxableContribution: (v) => numIn(v, 0, 1000000, 'taxableContribution'),
  investmentReturn: (v) => numIn(v, -0.2, 0.3, 'investmentReturn'),
  returnVolatility: (v) => numIn(v, 0, 0.6, 'returnVolatility'),
  withdrawalOrder: (v) => {
    if (!Array.isArray(v)) throw 'withdrawalOrder must be an array';
    const order = v.map(String) as WithdrawalAccount[];
    // 3 or 4 distinct accounts drawn from the valid set (RDSP included — the
    // schema and engine both accept it; the order need not contain every
    // account, but each may appear at most once).
    const okShape =
      order.length >= 3 &&
      order.length <= 4 &&
      new Set(order).size === order.length &&
      order.every(a => VALID_ACCOUNTS.includes(a));
    if (!okShape) throw 'withdrawalOrder must be 3–4 distinct accounts from ["tfsa","taxable","rrsp","rdsp"]';
    return order;
  },
};

function numIn(v: unknown, min: number, max: number, name: string): number {
  const n = typeof v === 'string' ? parseFloat(v) : (typeof v === 'number' ? v : NaN);
  if (!isFinite(n)) throw `${name} must be a number (got ${JSON.stringify(v)})`;
  if (n < min || n > max) throw `${name} ${n} out of range [${min}, ${max}]`;
  return n;
}

export function buildAgentPrompt(inputs: RetirementInputs): string {
  const schemaExample = {
    retirementAge: 65,
    cppStartAge: 70,
    cppMonthlyAmount: 1200,
    oasStartAge: 70,
    desiredSpending: 60000,
    rrspContribution: 15000,
    tfsaContribution: 7000,
    taxableContribution: 0,
    investmentReturn: 0.06,
    returnVolatility: 0.15,
    withdrawalOrder: ['tfsa', 'taxable', 'rrsp'],
  };
  return `You are a Canadian retirement-planning advisor. Given the plan below, suggest an improved set of inputs and reply with ONLY a JSON object (no prose, no code fences).

CURRENT PLAN (JSON):
${JSON.stringify(inputs, null, 2)}

RULES:
- Reply with a single JSON object containing only the fields you want to change, chosen from: ${Object.keys(FIELDS).join(', ')}.
- investmentReturn and returnVolatility are decimals (0.06 = 6%). Ages are integers. withdrawalOrder is 3–4 distinct accounts from ["tfsa","taxable","rrsp","rdsp"].
- Constraints: retirementAge 45-75, cppStartAge 60-70, oasStartAge 65-70, non-negative dollar amounts.
- CPP at 65 is cppMonthlyAmount; the engine applies -0.6%/month before 65 and +0.7%/month after (cap 70). OAS deferral adds 0.6%/month to 70.
- Do not invent new fields. If unsure, omit the field.

EXAMPLE OUTPUT (illustrative only):
${JSON.stringify(schemaExample, null, 2)}`;
}

export function parseAgentResult(text: string, current: RetirementInputs): IngestResult {
  const applied: string[] = [];
  const warnings: string[] = [];

  let cleaned = text.trim();
  // Strip markdown code fences if the model wrapped the JSON.
  const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) cleaned = fence[1].trim();
  // Grab the outermost JSON object if there's surrounding prose.
  const first = cleaned.indexOf('{');
  const last = cleaned.lastIndexOf('}');
  if (first === -1 || last === -1 || last <= first) {
    return { ok: false, applied, warnings, error: 'No JSON object found in the pasted text.' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned.slice(first, last + 1));
  } catch (e) {
    return { ok: false, applied, warnings, error: `Invalid JSON: ${(e as Error).message}` };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, applied, warnings, error: 'Pasted JSON is not an object of fields.' };
  }

  const patch: Partial<RetirementInputs> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    const applier = FIELDS[key];
    if (!applier) {
      warnings.push(`Ignored unknown field "${key}".`);
      continue;
    }
    try {
      const validated = applier(value, current);
      (patch as Record<string, unknown>)[key] = validated;
      applied.push(`${key} = ${Array.isArray(validated) ? validated.join(' → ') : validated}`);
    } catch (reason) {
      warnings.push(`Rejected ${key}: ${reason}`);
    }
  }

  if (applied.length === 0) {
    return { ok: false, applied, warnings, error: 'No valid fields to apply.' };
  }
  return { ok: true, patch, applied, warnings };
}
