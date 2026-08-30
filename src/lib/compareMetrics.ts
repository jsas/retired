// Pure scenario-comparison metrics: run a set of saved scenarios through the
// engine (with the current config) and extract the four verdict-card numbers,
// plus a signed diff of each against a chosen baseline. Kept separate from the
// UI so the verdict-derivation and diff logic is unit-testable.
import { calculateHousehold, householdOutcome, type RetirementResults, type RetirementInputs } from './retirementEngine';
import { resolveSpouseSource } from './householdTypes';
import type { Scenario } from './types';
import type { AppConfig } from './appConfig';

/** The verdict metrics for one scenario, flattened across spouses like MetricCards. */
export interface ScenarioMetrics {
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

/** A signed difference between a scenario's metric and the baseline's. */
export interface MetricDiff {
  /** scenario value − baseline value, in the metric's native unit ($ / years / 0..1). */
  delta: number;
  /** true when the diff direction is an improvement (or there is no change). */
  better: boolean;
  /** true when the two values are equal within display tolerance. */
  neutral: boolean;
}

export interface ScenarioComparison {
  metrics: ScenarioMetrics;
  /** Diff vs the baseline scenario; undefined for the baseline itself. */
  diff?: {
    householdWorth: MetricDiff;
    depletionAge: MetricDiff;
    withdrawalRate: MetricDiff;
  };
}

/** Extract the flattened verdict metrics from a computed result. The verdict
 *  (depletion age + status) is household-first: when the COMBINED money runs
 *  out, not when either partner's silo does. */
export function metricsFromResults(id: string, name: string, results: RetirementResults, inputs?: RetirementInputs): ScenarioMetrics {
  const spouse = results.spouse;
  const ho = inputs ? householdOutcome(results, inputs) : undefined;
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

/** Run one scenario's inputs through the engine and extract its metrics. A
 *  scenario that LINKS its spouse to another saved plan is resolved against the
 *  same scenario list first, so the comparison uses the linked plan's person —
 *  not the stale embedded spouse the link replaced. */
export function computeScenarioMetrics(
  scenario: Scenario,
  config: AppConfig,
  scenarios?: Array<{ id: string; inputs: RetirementInputs }>,
): ScenarioMetrics {
  let inputs = scenario.inputs;
  if (scenarios && inputs.spouseSource?.kind === 'scenario' && inputs.spouse?.enabled) {
    const res = resolveSpouseSource(inputs, scenarios, scenario.id);
    if (res.spouse) inputs = { ...inputs, spouse: res.spouse };
  }
  const results = calculateHousehold(inputs, config);
  return metricsFromResults(scenario.id, scenario.name, results, inputs);
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
 * Compare a set of scenarios against a baseline. `scenarios` and `baselineId`
 * are assumed already validated by the caller (the UI offers checkboxes and a
 * baseline picker, so by construction the baseline is one of the scenarios).
 * Returns one entry per scenario, in input order; the baseline has no `diff`.
 */
export function compareScenarios(
  scenarios: Scenario[],
  baselineId: string,
  config: AppConfig,
): ScenarioComparison[] {
  // Pass the full list so a scenario whose spouse is linked to another saved
  // plan resolves that link before computing (same as the projection does).
  const all = scenarios.map(s => computeScenarioMetrics(s, config, scenarios));
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
