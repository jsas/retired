// Solver mode — invert the Monte Carlo verdict.
//
// Instead of "given my spending, what's my success rate?", this answers
// "given a target success rate, what's the most I can spend?". It binary-
// searches desiredSpending, scoring each candidate by its Monte Carlo success
// rate until it lands on the spending level that reproduces the target.
//
// Monotonicity is what makes the search converge: more spending can never
// increase the success rate. To make that TRUE in practice (not just in
// expectation) every candidate is scored against the SAME pre-generated set
// of market futures (one seeded RNG) — so successRate(spending) is a
// deterministic, non-increasing step function and the binary search is exact.
// The solved value is therefore the max spending for THIS batch of futures;
// re-running with a fresh seed gives a nearby (slightly different) answer, so
// the UI presents it as approximate and validates it with a fresh run.

import {
  generateSequences,
  simulate,
  type SimulationSummary,
} from './monteCarlo';
import type { RetirementInputs } from './retirementEngine';
import type { AppConfig } from './appConfig';

export interface SolverRequest {
  inputs: RetirementInputs;
  config: AppConfig;
  /** Target success rate as a fraction 0..1 (e.g. 0.9 = 90%). */
  targetSuccessRate: number;
  /** Market futures to simulate per candidate. More = smoother, slower. */
  runs?: number;
  volatility: number;
  /** Seed for the shared futures batch (default: fixed, reproducible). */
  seed?: number;
  /** Search resolution in dollars of yearly spending (default 250). */
  toleranceDollars?: number;
  /** Max binary-search iterations (default 40 — plenty for $1 resolution). */
  maxIterations?: number;
}

export interface SolverResult {
  targetSuccessRate: number;
  /** Max yearly after-tax spending (today's $) meeting the target. */
  spending: number;
  /** Success rate at the solved spending (≥ target, within tolerance). */
  achievedSuccessRate: number;
  /** Success rate one tolerance step above the solved spending (< target). */
  nextStepSuccessRate: number | null;
  iterations: number;
  runs: number;
  feasible: boolean;      // false if even $0 spending misses the target
  unconstrained: boolean; // true if the target holds at the search ceiling
  ceiling: number;        // the search ceiling used (for context)
}

const DEFAULT_RUNS = 500;
const DEFAULT_SEED = 0xC0FFEE;
const DEFAULT_TOLERANCE = 250; // $250/yr resolution
const ABSOLUTE_CEILING = 5_000_000;
const START_CEILING = 500_000;

export function solveSustainableSpending(request: SolverRequest): SolverResult {
  const {
    inputs, config, targetSuccessRate, volatility,
    runs = DEFAULT_RUNS,
    seed = DEFAULT_SEED,
    toleranceDollars = DEFAULT_TOLERANCE,
    maxIterations = 40,
  } = request;
  const target = Math.min(0.999, Math.max(0, targetSuccessRate));

  // One batch of market futures, reused for every candidate so the success
  // rate is a deterministic function of spending alone.
  const sequences = generateSequences(
    runs, inputs.currentAge, inputs.maxAge, inputs.investmentReturn, volatility, seed,
  );
  const rateAt = (spend: number): SimulationSummary =>
    simulate({ ...inputs, desiredSpending: spend }, config, sequences);

  // Feasibility: if even zero spending misses the target (huge fixed costs),
  // there is no sustainable level.
  const atZero = rateAt(0);
  if (atZero.successRate < target) {
    return {
      targetSuccessRate: target, spending: 0,
      achievedSuccessRate: atZero.successRate, nextStepSuccessRate: null,
      iterations: 0, runs, feasible: false, unconstrained: false, ceiling: 0,
    };
  }

  // Find a ceiling that fails the target (expanding from START_CEILING),
  // unless the plan clears the target even at the absolute ceiling.
  let hi = START_CEILING;
  let hiRate = rateAt(hi);
  let guard = 0;
  while (hiRate.successRate >= target && hi < ABSOLUTE_CEILING && guard++ < 20) {
    hi = Math.min(ABSOLUTE_CEILING, Math.round(hi * 1.5));
    hiRate = rateAt(hi);
  }
  if (hiRate.successRate >= target) {
    // Target holds even at the absolute ceiling — the bound is unconstrained.
    return {
      targetSuccessRate: target, spending: hi,
      achievedSuccessRate: hiRate.successRate, nextStepSuccessRate: null,
      iterations: 0, runs, feasible: true, unconstrained: true, ceiling: hi,
    };
  }

  // Binary search the largest spending whose success rate >= target.
  // Invariant: rateAt(lo) >= target, rateAt(hi) < target.
  let lo = 0;
  let iterations = 0;
  while (hi - lo > toleranceDollars && iterations < maxIterations) {
    const mid = (lo + hi) / 2;
    if (rateAt(mid).successRate >= target) lo = mid; else hi = mid;
    iterations++;
  }

  const spending = Math.floor(lo / 100) * 100; // round down to a tidy $100
  const achieved = rateAt(spending);
  const next = rateAt(spending + toleranceDollars);
  return {
    targetSuccessRate: target,
    spending,
    achievedSuccessRate: achieved.successRate,
    nextStepSuccessRate: next.successRate,
    iterations, runs,
    feasible: true, unconstrained: false, ceiling: hi,
  };
}
