// Deterministic strategy explorer.
//
// Given the current inputs, run the plan under a battery of named strategy
// variants and rank each against the baseline. Pure functions over the engine —
// same inputs always produce the same report, no randomness and no AI.
//
// A "strategy" perturbs one or more decision levers (CPP/OAS start age,
// withdrawal order, retirement age, contribution split). Each is scored on:
//   - survived: does the money last to max age?
//   - endingBalance: total portfolio at max age
//   - lifetimeTax: cumulative tax paid over the plan
//   - sustainableSpending: the highest flat yearly after-tax spending that
//     survives to max age (binary-searched per strategy)
// Ranked primarily on sustainableSpending (a lifestyle measure), with tax and
// ending balance shown for context.

import { calculateHousehold, householdOutcome } from './retirementEngine';
import type { RetirementInputs, RetirementResults, WithdrawalAccount, EmploymentIncome } from './retirementEngine';
import type { AppConfig } from './appConfig';

export interface StrategyResult {
  id: string;
  name: string;
  description: string;
  patch: Partial<RetirementInputs>;
  /** Lever family this variant belongs to, so callers can scope the explorer
   *  ("just CPP/OAS timing"). The defer-both flagship counts as cpp AND oas. */
  categories: StrategyCategory[];
  survived: boolean;
  depletionAge: number | null;
  endingBalance: number;
  lifetimeTax: number;
  lifetimeGis: number; // cumulative GIS received over the plan
  sustainableSpending: number;
  deltaSpending: number; // vs baseline sustainable spending
}

export type StrategyCategory =
  | 'cpp' | 'oas' | 'withdrawal_order' | 'reverse_mortgage' | 'work';

export interface StrategyFilter {
  /** Keep only variants in these lever families. */
  categories?: StrategyCategory[];
  /** Cap the returned variant list (best first, after ranking). */
  maxVariants?: number;
}

export interface StrategyReport {
  baseline: StrategyResult;
  strategies: StrategyResult[]; // sorted best-first by sustainableSpending
  best: StrategyResult;
  suggestedActions: string[];
  /** What to present to the caller: `strategies` unless maxVariants capped it.
   *  Kept separate so the OptimizeCard (unfiltered) and the agent tool (capped)
  *   share one report shape. */
  shown: StrategyResult[];
  /** How many variants were built before filtering/capping (for a note). */
  filteredFrom: number;
}

const ORDERINGS: WithdrawalAccount[][] = [
  ['tfsa', 'taxable', 'rrsp'],
  ['tfsa', 'rrsp', 'taxable'],
  ['taxable', 'tfsa', 'rrsp'],
  ['taxable', 'rrsp', 'tfsa'],
  ['rrsp', 'tfsa', 'taxable'],
  ['rrsp', 'taxable', 'tfsa'],
];

const orderLabel = (o: WithdrawalAccount[]) =>
  o.map(a => (a === 'tfsa' ? 'TFSA' : a === 'taxable' ? 'Taxable' : 'RRSP')).join(' → ');

// Highest flat after-tax yearly spending (today's $) that survives to maxAge.
// Binary search on desiredSpending; spending is floored at 0. Survival is the
// household-first verdict (combined money exhausted with an unfunded shortfall)
// — the raw primary-only depletionAge would call a couple "failed" because the
// primary's own silo ran dry while the household was fine.
function sustainableSpending(inputs: RetirementInputs, config: AppConfig): number {
  const survives = (spend: number) =>
    householdOutcome(calculateHousehold({ ...inputs, desiredSpending: spend }, config), inputs).depletionAge === null;
  if (!survives(0)) return 0; // runs out even at zero spending (huge fixed events)
  let lo = 0, hi = 500000;
  // Expand hi until it fails (caps runaway plans) or we hit an absolute ceiling.
  let guard = 0;
  while (survives(hi) && hi < 5000000 && guard++ < 40) hi *= 1.5;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (survives(mid)) lo = mid; else hi = mid;
  }
  return Math.round(lo);
}

interface StrategySpec {
  id: string;
  name: string;
  description: string;
  patch: Partial<RetirementInputs>;
  categories: StrategyCategory[];
}

function buildStrategies(inputs: RetirementInputs, config: AppConfig): StrategySpec[] {
  const specs: StrategySpec[] = [];
  const cppNow = inputs.cppStartAge ?? 65;
  const oasNow = inputs.oasStartAge ?? 65;

  for (const age of [60, 65, 70] as const) {
    if (age === cppNow) continue;
    specs.push({
      id: `cpp-${age}`,
      name: `Take CPP at ${age}`,
      description: age < 65
        ? `Start CPP early at ${age} (reduced ${Math.round((65 - age) * 12 * 0.6)}%).`
        : `Defer CPP to ${age} (+${Math.round((age - 65) * 12 * 0.7)}% bonus).`,
      patch: { cppStartAge: age },
      categories: ['cpp'],
    });
  }
  for (const age of [65, 70] as const) {
    if (age === oasNow) continue;
    specs.push({
      id: `oas-${age}`,
      name: `Take OAS at ${age}`,
      description: age > 65 ? `Defer OAS to 70 (+${Math.round((age - 65) * 12 * 0.6)}% bonus).` : `Start OAS at 65.`,
      patch: { oasStartAge: age },
      categories: ['oas'],
    });
  }
  const currentOrder = (inputs.withdrawalOrder ?? ['tfsa', 'taxable', 'rrsp']).join(',');
  for (const order of ORDERINGS) {
    if (order.join(',') === currentOrder) continue;
    specs.push({
      id: `order-${order.join('-')}`,
      name: `Withdraw ${orderLabel(order)}`,
      description: 'Change the account drawdown sequence.',
      patch: { withdrawalOrder: order },
      categories: ['withdrawal_order'],
    });
  }
  // Combined flagship: CPP 70 + OAS 70 + a tax-efficient order. Categorized as
  // both cpp and oas so filtering to either lever family still surfaces it.
  if (cppNow !== 70 || oasNow !== 70) {
    specs.push({
      id: 'defer-all-70',
      name: 'Defer CPP & OAS to 70',
      description: 'Max out both government benefits; bridge the gap from the portfolio.',
      patch: { cppStartAge: 70, oasStartAge: 70 },
      categories: ['cpp', 'oas'],
    });
  }

  // Reverse-mortgage timing. RM cash is tax-free and lands in the cash cushion,
  // and cash is the last-resort draw — so every scheduled RM dollar displaces a
  // portfolio withdrawal and leaves registered/TFSA money compounding longer.
  // Drawing EARLY can therefore beat drawing late even though interest accrues
  // longer, which is exactly the trade-off worth surfacing. Only meaningful when
  // there is a home value to borrow against; we never invent equity.
  const rm = inputs.reverseMortgage;
  const rmHome = rm?.homeValue ?? 0;
  if (rmHome > 0) {
    const baseRm = {
      enabled: true,
      homeValue: rmHome,
      appreciationRate: rm?.appreciationRate ?? 0.02,
      interestRate: rm?.interestRate ?? 0.065,
      maxLtv: rm?.maxLtv ?? 0.55,
    };
    const currentStart = rm?.enabled ? (rm.startAge ?? null) : null;
    const currentDraw = rm?.enabled ? (rm.drawAmount ?? 0) : 0;
    for (const startAge of [inputs.retirementAge, inputs.retirementAge + 5, inputs.retirementAge + 10]) {
      if (startAge >= inputs.maxAge) continue;
      for (const frac of [0.2, 0.4]) {
        const draw = Math.round(inputs.desiredSpending * frac / 500) * 500;
        if (draw <= 0) continue;
        if (currentStart === startAge && Math.abs(currentDraw - draw) < 1) continue;
        specs.push({
          id: `rm-${startAge}-${draw}`,
          name: `Reverse mortgage ${Math.round(frac * 100)}% from age ${startAge}`,
          description: `Draw $${draw.toLocaleString()}/yr (tax-free, CPI-indexed) from ${startAge} onward; portfolio draws shrink by the same amount and keep compounding. Loan interest accrues against the home.`,
          patch: { reverseMortgage: { ...baseRm, drawAmount: draw, startAge, topUp: rm?.topUp ?? false } },
          categories: ['reverse_mortgage'],
        });
      }
    }
    if (rm?.enabled && !rm.topUp) {
      specs.push({
        id: 'rm-topup',
        name: 'Add RM top-up backstop',
        description: 'After every account is drained, borrow just enough each year to cover the remaining spending need — an insurance layer, not new spending money.',
        patch: { reverseMortgage: { ...rm, topUp: true } },
        categories: ['reverse_mortgage'],
      });
    }
  }

  // Part-time work: a stint of earned income in the early retirement years.
  // Top-up mode means the after-tax pay displaces portfolio withdrawals dollar
  // for dollar, so the savings keep compounding. Earned income stacks for tax
  // (and counts for OAS clawback / GIS), which is exactly the trade-off worth
  // surfacing. Fixed rows plus, when the plan runs a shortfall, a gap-targeted
  // stint sized to the first depleted window.
  const existingJobs = inputs.employment ?? [];
  const retire = inputs.retirementAge;
  // Save to taxable by default: the app doesn't track TFSA/RRSP room yet
  // (issue #24), so a registered destination could silently over-contribute.
  const mkJob = (id: string, label: string, amount: number, startAge: number, endAge: number): EmploymentIncome => ({
    id, label, annualAmount: amount, startAge, endAge,
    destAccount: 'taxable', topUpSpending: true, indexedToCpi: false,
  });
  const addJob = (specId: string, name: string, description: string, job: EmploymentIncome) => {
    // Skip if an identical stint is already in the plan.
    if (existingJobs.some(e => e.annualAmount === job.annualAmount && e.startAge === job.startAge && e.endAge === job.endAge)) return;
    specs.push({ id: specId, name, description, patch: { employment: [...existingJobs, job] }, categories: ['work'] });
  };
  if (retire + 5 <= inputs.maxAge) {
    addJob(
      `work-10k-${retire}-${retire + 5}`,
      `Part-time work $10k/yr to ${retire + 5}`,
      `Earn $10,000/yr from ${retire} to ${retire + 5}. After tax it tops up spending first, so portfolio draws shrink and keep compounding.`,
      mkJob('opt-work-10k', 'Part-time work', 10000, retire, retire + 5),
    );
  }
  if (retire + 10 <= inputs.maxAge) {
    addJob(
      `work-20k-${retire}-${retire + 10}`,
      `Part-time work $20k/yr to ${retire + 10}`,
      `Earn $20,000/yr from ${retire} to ${retire + 10}. Bigger bridge: the after-tax pay displaces withdrawals through the early years.`,
      mkJob('opt-work-20k', 'Part-time work', 20000, retire, retire + 10),
    );
  }
  // Gap-targeted: if the current plan depletes, size a stint to the first
  // shortfall window (cap at the window length and a sane annual amount).
  {
    const r = calculateHousehold(inputs, config);
    const gap = r.yearlyBreakdown.filter(y => (y.shortfall ?? 0) > 0.5);
    if (gap.length > 0) {
      const start = gap[0].age;
      // Contiguous window from the first shortfall year.
      let end = start;
      while (end + 1 <= inputs.maxAge && gap.some(y => y.age === end + 1)) end++;
      const worst = Math.max(...gap.map(y => y.shortfall ?? 0));
      // Gross up the worst shortfall for tax (~30% marginal) so the NET covers it.
      const amount = Math.min(60000, Math.ceil((worst / 0.7) / 1000) * 1000);
      if (amount > 0 && start <= end) {
        addJob(
          `work-gap-${start}-${end}`,
          `Work to cover the shortfall (${start}–${end})`,
          `The plan runs short from age ${start}. Earning about $${amount.toLocaleString()}/yr through ${end} (≈$${Math.round(amount * 0.7).toLocaleString()} after tax) covers the worst gap year (${Math.round(worst).toLocaleString()}).`,
          mkJob('opt-work-gap', 'Work to cover the gap', amount, start, end),
        );
      }
    }
  }
  return specs;
}

function runOne(inputs: RetirementInputs, config: AppConfig, spec: StrategySpec): StrategyResult {
  const merged: RetirementInputs = { ...inputs, ...spec.patch };
  const r: RetirementResults = calculateHousehold(merged, config);
  const lifetimeTax = r.yearlyBreakdown.reduce((s, y) => s + (y.incomeTax ?? 0), 0);
  const lifetimeGis = r.yearlyBreakdown.reduce((s, y) => s + (y.gisIncome ?? 0), 0);
  const sustainable = sustainableSpending(merged, config);
  // Household-first verdict (combined money + shortfall), matching the Monte
  // Carlo screen and the dashboard — not the primary's own depletionAge.
  const ho = householdOutcome(r, inputs);
  return {
    id: spec.id,
    name: spec.name,
    description: spec.description,
    patch: spec.patch,
    categories: spec.categories,
    survived: ho.depletionAge === null,
    depletionAge: ho.depletionAge,
    endingBalance: ho.endingBalance,
    lifetimeTax,
    lifetimeGis,
    sustainableSpending: sustainable,
    deltaSpending: 0, // filled by caller
  };
}

/** Validate and apply the caller's filter. Unknown categories throw (not skip)
 *  — a silent empty result would read as "no levers help" when the caller
 *  really misspelled 'cpp'. */
function applyFilter(specs: StrategySpec[], filter?: StrategyFilter): { specs: StrategySpec[]; built: number } {
  if (!filter || (filter.categories == null && filter.maxVariants == null)) {
    return { specs, built: specs.length };
  }
  let list = specs;
  if (filter.categories) {
    const allowed = new Set(filter.categories);
    list = list.filter(s => s.categories.some(c => allowed.has(c)));
  }
  return { specs: list, built: specs.length };
}

export function runStrategies(inputs: RetirementInputs, config: AppConfig, filter?: StrategyFilter): StrategyReport {
  if (filter?.categories) {
    const KNOWN: StrategyCategory[] = ['cpp', 'oas', 'withdrawal_order', 'reverse_mortgage', 'work'];
    const unknown = filter.categories.filter(c => !KNOWN.includes(c));
    if (unknown.length) {
      throw new Error(`Unknown strategy categor${unknown.length > 1 ? 'ies' : 'y'}: ${unknown.join(', ')}. Known: ${KNOWN.join(', ')}.`);
    }
  }
  const baseline = runOne(inputs, config, {
    id: 'baseline', name: 'Current plan', description: 'Your settings as entered.', patch: {}, categories: [],
  });

  const allSpecs = buildStrategies(inputs, config);
  const built = allSpecs.length;
  const kept = applyFilter(allSpecs, filter).specs;
  // Cap AFTER the full pipeline's own ranking order is applied below — maxVariants
  // means "best N", so it must slice the ranked list, not the build list.
  const strategies = kept.map(spec => runOne(inputs, config, spec));
  for (const s of strategies) s.deltaSpending = s.sustainableSpending - baseline.sustainableSpending;
  baseline.deltaSpending = 0;

  strategies.sort((a, b) =>
    b.sustainableSpending - a.sustainableSpending ||
    a.lifetimeTax - b.lifetimeTax ||
    b.endingBalance - a.endingBalance
  );

  // Cap the ranked list last: "maxVariants" is best-N, not first-N built. The
  // report still carries the FULL ranked list in `strategies` (callers like the
  // OptimizeCard render everything); the cap only affects what the agent tool
  // prints, so it's applied there via `shown`.
  const shown = filter?.maxVariants != null && filter.maxVariants >= 0
    ? strategies.slice(0, filter.maxVariants)
    : strategies;

  const best = strategies[0] ?? baseline;

  // Human-readable suggestions from the top-ranked levers.
  const suggestedActions: string[] = [];
  const top = strategies.filter(s => s.deltaSpending > 500).slice(0, 4);
  if (top.length === 0) {
    suggestedActions.push('Your current settings are already near the best of the strategies tested.');
  } else {
    for (const s of top) {
      suggestedActions.push(
        `${s.name}: supports ~$${Math.round(s.deltaSpending).toLocaleString()}/yr more spending than your current plan.`
      );
    }
  }
  const bestTax = [...strategies].sort((a, b) => a.lifetimeTax - b.lifetimeTax)[0];
  if (bestTax && bestTax.lifetimeTax < baseline.lifetimeTax - 1000) {
    suggestedActions.push(
      `Lowest-tax option: ${bestTax.name} (about $${Math.round(baseline.lifetimeTax - bestTax.lifetimeTax).toLocaleString()} less lifetime tax).`
    );
  }
  const bestGis = [...strategies].sort((a, b) => b.lifetimeGis - a.lifetimeGis)[0];
  if (bestGis && bestGis.lifetimeGis > baseline.lifetimeGis + 1000) {
    suggestedActions.push(
      `Most GIS preserved: ${bestGis.name} (about $${Math.round(bestGis.lifetimeGis - baseline.lifetimeGis).toLocaleString()} more lifetime GIS).`
    );
  }

  return { baseline, strategies, best, suggestedActions, shown, filteredFrom: built };
}
