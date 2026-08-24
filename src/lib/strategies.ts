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

import { calculateRetirement } from './retirementEngine';
import type { RetirementInputs, RetirementResults, WithdrawalAccount } from './retirementEngine';
import type { AppConfig } from './appConfig';

export interface StrategyResult {
  id: string;
  name: string;
  description: string;
  patch: Partial<RetirementInputs>;
  survived: boolean;
  depletionAge: number | null;
  endingBalance: number;
  lifetimeTax: number;
  sustainableSpending: number;
  deltaSpending: number; // vs baseline sustainable spending
}

export interface StrategyReport {
  baseline: StrategyResult;
  strategies: StrategyResult[]; // sorted best-first by sustainableSpending
  best: StrategyResult;
  suggestedActions: string[];
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
// Binary search on desiredSpending; spending is floored at 0.
function sustainableSpending(inputs: RetirementInputs, config: AppConfig): number {
  const survives = (spend: number) =>
    calculateRetirement({ ...inputs, desiredSpending: spend }, config).depletionAge === null;
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
}

function buildStrategies(inputs: RetirementInputs): StrategySpec[] {
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
    });
  }
  for (const age of [65, 70] as const) {
    if (age === oasNow) continue;
    specs.push({
      id: `oas-${age}`,
      name: `Take OAS at ${age}`,
      description: age > 65 ? `Defer OAS to 70 (+${Math.round((age - 65) * 12 * 0.6)}% bonus).` : `Start OAS at 65.`,
      patch: { oasStartAge: age },
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
    });
  }
  // Combined flagship: CPP 70 + OAS 70 + a tax-efficient order.
  if (cppNow !== 70 || oasNow !== 70) {
    specs.push({
      id: 'defer-all-70',
      name: 'Defer CPP & OAS to 70',
      description: 'Max out both government benefits; bridge the gap from the portfolio.',
      patch: { cppStartAge: 70, oasStartAge: 70 },
    });
  }
  return specs;
}

function runOne(inputs: RetirementInputs, config: AppConfig, spec: StrategySpec): StrategyResult {
  const merged: RetirementInputs = { ...inputs, ...spec.patch };
  const r: RetirementResults = calculateRetirement(merged, config);
  const last = r.yearlyBreakdown[r.yearlyBreakdown.length - 1];
  const lifetimeTax = r.yearlyBreakdown.reduce((s, y) => s + (y.incomeTax ?? 0), 0);
  const sustainable = sustainableSpending(merged, config);
  return {
    id: spec.id,
    name: spec.name,
    description: spec.description,
    patch: spec.patch,
    survived: r.depletionAge === null,
    depletionAge: r.depletionAge,
    endingBalance: last?.endingBalance ?? 0,
    lifetimeTax,
    sustainableSpending: sustainable,
    deltaSpending: 0, // filled by caller
  };
}

export function runStrategies(inputs: RetirementInputs, config: AppConfig): StrategyReport {
  const baseline = runOne(inputs, config, {
    id: 'baseline', name: 'Current plan', description: 'Your settings as entered.', patch: {},
  });

  const strategies = buildStrategies(inputs).map(spec => runOne(inputs, config, spec));
  for (const s of strategies) s.deltaSpending = s.sustainableSpending - baseline.sustainableSpending;
  baseline.deltaSpending = 0;

  strategies.sort((a, b) =>
    b.sustainableSpending - a.sustainableSpending ||
    a.lifetimeTax - b.lifetimeTax ||
    b.endingBalance - a.endingBalance
  );

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

  return { baseline, strategies, best, suggestedActions };
}
