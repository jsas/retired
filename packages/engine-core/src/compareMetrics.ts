// Pure plan-comparison metrics: run a set of saved plans through the
// engine (with the current config) and extract the four verdict-card numbers,
// plus a signed diff of each against a chosen baseline. Kept separate from the
// UI so the verdict-derivation and diff logic is unit-testable.
import { calculateHousehold, householdOutcome, type RetirementResults, type RetirementInputs } from './retirementEngine';
import { resolveSpouseSource, toHousehold } from './householdTypes';
import type { Plan } from './types';
import type { AppConfig } from './appConfig';

/** The verdict metrics for one plan, flattened across spouses like MetricCards. */
export interface PlanMetrics {
  id: string;
  name: string;
  isCouple: boolean;
  /** Household (you + spouse) investable wealth at retirement. */
  householdWorth: number;
  /** Earliest age anyone's money runs out; null = never (funded to max age). */
  depletionAge: number | null;
  /** Primary plan's initial withdrawal rate (0..1). */
  withdrawalRate: number;
  status: 'ON_TRACK' | 'SHORTFALL';
}

/** A signed difference between a plan's metric and the baseline's. */
export interface MetricDiff {
  /** plan value − baseline value, in the metric's native unit ($ / years / 0..1). */
  delta: number;
  /** true when the diff direction is an improvement (or there is no change). */
  better: boolean;
  /** true when the two values are equal within display tolerance. */
  neutral: boolean;
}

export interface PlanComparison {
  metrics: PlanMetrics;
  /** Diff vs the baseline plan; undefined for the baseline itself. */
  diff?: {
    householdWorth: MetricDiff;
    depletionAge: MetricDiff;
    withdrawalRate: MetricDiff;
  };
}

/** Extract the flattened verdict metrics from a computed result. The verdict
 *  (depletion age + status) is household-first: when the COMBINED money runs
 *  out, not when either partner's silo does. */
export function metricsFromResults(id: string, name: string, results: RetirementResults, inputs?: RetirementInputs): PlanMetrics {
  const spouse = results.spouse;
  const ho = inputs ? householdOutcome(results, toHousehold(inputs)) : undefined;
  return {
    id,
    name,
    isCouple: !!spouse,
    householdWorth: results.totalNetWorthAtRetirement + (spouse?.totalNetWorthAtRetirement ?? 0),
    depletionAge: ho ? ho.depletionAge : results.depletionAge,
    withdrawalRate: results.withdrawalRate,
    status: ho ? ho.status : results.status,
  };
}

/** Run one plan's inputs through the engine and extract its metrics. A
 *  plan that LINKS its spouse to another saved plan is resolved against the
 *  same plan list first, so the comparison uses the linked plan's person —
 *  not the stale embedded spouse the link replaced. */
export function computePlanMetrics(
  plan: Plan,
  config: AppConfig,
  plans?: Array<{ id: string; inputs: RetirementInputs }>,
): PlanMetrics {
  let inputs = plan.inputs;
  if (plans && inputs.spouseSource?.kind === 'plan' && inputs.spouse?.enabled) {
    const res = resolveSpouseSource(inputs, plans, plan.id);
    if (res.spouse) inputs = { ...inputs, spouse: res.spouse };
  }
  const results = calculateHousehold(inputs, config);
  return metricsFromResults(plan.id, plan.name, results, inputs);
}

// Display tolerances: below these a diff reads as "no change".
const MONEY_TOL = 1;      // dollars
const AGE_TOL = 1e-9;     // years (integer ages)
const RATE_TOL = 1e-6;    // withdrawal-rate fraction

function moneyDiff(delta: number): MetricDiff {
  const neutral = Math.abs(delta) <= MONEY_TOL;
  return { delta, better: neutral || delta > 0, neutral };
}

function ageDiff(delta: number): MetricDiff {
  const neutral = Math.abs(delta) <= AGE_TOL;
  // Depleting later is better.
  return { delta, better: neutral || delta > 0, neutral };
}

function rateDiff(delta: number): MetricDiff {
  const neutral = Math.abs(delta) <= RATE_TOL;
  // A lower initial withdrawal rate is better (more sustainable).
  return { delta, better: neutral || delta < 0, neutral };
}

/**
 * Compare a set of plans against a baseline. `plans` and `baselineId`
 * are assumed already validated by the caller (the UI offers checkboxes and a
 * baseline picker, so by construction the baseline is one of the plans).
 * Returns one entry per plan, in input order; the baseline has no `diff`.
 */
export function comparePlans(
  plans: Plan[],
  baselineId: string,
  config: AppConfig,
): PlanComparison[] {
  // Pass the full list so a plan whose spouse is linked to another saved
  // plan resolves that link before computing (same as the projection does).
  const all = plans.map(s => computePlanMetrics(s, config, plans));
  const baseline = all.find(m => m.id === baselineId);

  return all.map(metrics => {
    if (!baseline || metrics.id === baseline.id) return { metrics };
    return {
      metrics,
      diff: {
        householdWorth: moneyDiff(metrics.householdWorth - baseline.householdWorth),
        depletionAge: depletionDiff(metrics.depletionAge, baseline.depletionAge),
        withdrawalRate: rateDiff(metrics.withdrawalRate - baseline.withdrawalRate),
      },
    };
  });
}

/**
 * Depletion-age diff needs null handling: `null` means "never runs out", which
 * is the best possible outcome and can't be subtracted numerically. We map it
 * to a sentinel above any real age so the ordering still works, and flag the
 * exact-equal case as neutral.
 */
function depletionDiff(a: number | null, b: number | null): MetricDiff {
  if (a === null && b === null) return { delta: 0, better: true, neutral: true };
  // "Never" outranks any finite age: treat null as +infinity for the sign.
  if (a === null) return { delta: Number.POSITIVE_INFINITY, better: true, neutral: false };
  if (b === null) return { delta: Number.NEGATIVE_INFINITY, better: false, neutral: false };
  return ageDiff(a - b);
}
