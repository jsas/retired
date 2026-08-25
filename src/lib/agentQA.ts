// Paste-based "Ask an AI" question prompts.
//
// Unlike agentIngest.ts (which tunes INPUTS via a strict JSON patch), this
// builds a self-contained QUESTION prompt: the current plan inputs plus a
// compact digest of the COMPUTED results (verdict, depletion, balances by
// age, income mix, first shortfall) so the model can answer from the real
// numbers instead of re-deriving them. The user copies the prompt, pastes it
// into any AI, and reads the prose answer — the app stays serverless,
// free and private. Nothing is ingested back.

import type { RetirementInputs, RetirementResults, YearlyBreakdown } from './retirementEngine';
import type { MonteCarloResults } from './monteCarlo';

export interface QAPreset {
  id: string;
  title: string;   // short selector label
  blurb: string;   // one-line hint shown under the selector
  question: string;
}

export const QA_PRESETS: QAPreset[] = [
  {
    id: 'on-track',
    title: 'Am I on track? Top 3 levers',
    blurb: 'Verdict plus the highest-impact changes, ranked.',
    question:
      'Given my computed projection below, am I on track to fund my retirement to my max age? ' +
      'Identify the three highest-impact levers to improve the outcome (for example spending level, ' +
      'retirement age, CPP/OAS start ages, withdrawal order, or savings rate), ranked by expected effect, ' +
      'and explain the reasoning behind each in a sentence or two.',
  },
  {
    id: 'cpp-oas-timing',
    title: 'When to take CPP & OAS',
    blurb: 'The 60/65/70 trade-offs against this plan.',
    question:
      'Based on my plan and projection, recommend when I should start CPP (any age 60–70) and OAS ' +
      '(65–70), and explain why. Weigh the early-CPP reduction (0.6%/month before 65) and the deferral ' +
      'bonuses (CPP +0.7%/month, OAS +0.6%/month, both to 70) against my portfolio draw, my tax bracket ' +
      'by year, any OAS clawback, and how long my money needs to last.',
  },
  {
    id: 'withdrawal-order',
    title: 'Explain my withdrawal order',
    blurb: 'Why this sequence, and would another cut lifetime tax?',
    question:
      'Explain the withdrawal order in my plan (the sequence I draw from RRSP/RRIF, TFSA, taxable and ' +
      'cash) and whether a different order would reduce my lifetime tax or improve the outcome. Consider ' +
      'that RRSP/RRIF draws are fully taxable and claw back GIS, TFSA withdrawals are tax-free, and taxable ' +
      'withdrawals only trigger capital gains on the growth portion.',
  },
  {
    id: 'clawback-gis',
    title: 'OAS clawback & GIS exposure',
    blurb: 'Which years am I hit, and what can I do about it?',
    question:
      'Analyse my exposure to the OAS clawback and to losing the Guaranteed Income Supplement. Identify ' +
      'the years or income ranges where my net income pushes past the clawback threshold or erodes GIS, ' +
      'explain what is driving it (RRIF minimums, large RRSP draws, pensions), and suggest realistic ways ' +
      'to reduce the impact (for example drawing RRSP earlier, or using TFSA instead).',
  },
  {
    id: 'biggest-risks',
    title: 'Biggest risks in this plan',
    blurb: 'Sequence-of-returns, longevity, inflation, concentration.',
    question:
      'What are the biggest risks in this retirement plan? Consider sequence-of-returns risk in the early ' +
      'drawdown years, longevity risk if I live past my max age, inflation eroding a fixed spending target, ' +
      'and any concentration in a single account type or in home equity. For each material risk, rate how ' +
      'exposed this particular plan is and name one concrete mitigation.',
  },
];

const money = (v: number) =>
  new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 }).format(v);

// Compact one-line digest of a projection year.
function yearLine(r: YearlyBreakdown): string {
  return (
    `age ${r.age}: start ${money(r.startingBalance)} -> end ${money(r.endingBalance)}, ` +
    `withdrawn ${money(r.withdrawals)}, tax ${money(r.incomeTax)}, ` +
    `income cpp ${money(r.cppIncome)} oas ${money(r.oasIncome)} gis ${money(r.gisIncome)}` +
    (r.pensionIncome > 0 ? ` pension ${money(r.pensionIncome)}` : '') +
    (r.netHomeEquity !== undefined ? `, homeEq ${money(r.netHomeEquity)}` : '')
  );
}

// A compact digest of one person's projection: verdict + milestone ages.
function planDigest(label: string, results: RetirementResults, maxAge: number): string {
  const rows = results.yearlyBreakdown;
  const lines: string[] = [];
  lines.push(
    `${label}: status ${results.status.replace('_', ' ')}, wealth at retirement ` +
    `${money(results.totalNetWorthAtRetirement)}, withdrawal rate ${(results.withdrawalRate * 100).toFixed(1)}%, ` +
    (results.depletionAge != null
      ? `portfolio DEPLETES at age ${results.depletionAge}`
      : `funded to age ${maxAge}+`),
  );
  const first = rows[0];
  const mid = rows[Math.floor(rows.length / 2)];
  const last = rows[rows.length - 1];
  const depl = results.depletionAge != null ? rows.find(r => r.age === results.depletionAge) : undefined;
  lines.push('  ' + [first, mid, depl, last]
    .filter((r): r is YearlyBreakdown => !!r)
    .filter((r, i, a) => a.indexOf(r) === i) // dedupe overlapping picks
    .map(yearLine)
    .join('\n  '));
  return lines.join('\n');
}

export interface QAContext {
  results: RetirementResults;
  mcResults?: MonteCarloResults | null;
}

/**
 * Build a self-contained question prompt: a framing instruction, the plan
 * inputs, a digest of the computed results (and optional Monte Carlo), then
 * the question. `customQuestion` overrides the preset text when provided.
 */
export function buildQAPrompt(
  inputs: RetirementInputs,
  ctx: QAContext,
  preset: QAPreset,
  customQuestion?: string,
): string {
  const question = (customQuestion?.trim() || preset.question).trim();

  const digests: string[] = [
    planDigest(inputs.spouse?.enabled ? 'You' : 'Plan', ctx.results, inputs.maxAge),
  ];
  if (ctx.results.spouse) {
    digests.push(planDigest('Spouse', ctx.results.spouse, inputs.maxAge));
  }

  let mc = '';
  if (ctx.mcResults) {
    mc =
      `\nMONTE CARLO (${ctx.mcResults.runs} runs, ${(ctx.mcResults.volatility * 100).toFixed(1)}% volatility):\n` +
      `  success rate ${(ctx.mcResults.successRate * 100).toFixed(1)}%, ` +
      `median final balance ${money(ctx.mcResults.medianFinalBalance)}\n`;
  }

  return `You are a Canadian retirement-planning analyst. Answer the question at the end using ONLY the plan and the computed projection below — do not re-derive the numbers, and give general educational analysis, not personalized financial advice.

PLAN INPUTS (JSON):
${JSON.stringify(inputs, null, 2)}

COMPUTED PROJECTION (summary):
${digests.join('\n')}
${mc}
QUESTION:
${question}

Answer in clear prose with short paragraphs or bullet points where helpful. Reference specific ages and dollar figures from the projection where they support the answer.`;
}
