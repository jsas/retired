// EQ readout solve — the Monte Carlo behind the Dashboard's Success-rate
// card. Controls are constrained by per-control CROPS (handled synchronously
// on the main thread — see eqConstraints.clampToBand), so this module only
// computes the plan's success-rate READOUT at the current point.
//
// Rates are scored against ONE seeded batch of futures so the readout stays
// stable while the user drags (regenerating futures per candidate would make
// the number noisy and jittery).
//
// The XY pad's 9×9 success-rate GRID used to live here too, shaded by a
// worker pool; the pad was removed as redundant with the contour map and the
// faders, and the grid solver went with it.
import { generateSequences, simulate } from './monteCarlo';
import type { RetirementInputs } from './retirementEngine';
import type { AppConfig } from './appConfig';

// 300 trajectories keeps a 90% rate within ±3.4% (95% CI) — plenty for a
// live readout, and ~40% cheaper per solve than 500.
export const EQ_RUNS = 300;
export const EQ_SEED = 0xE0;
/** Youngest start age we generate sequences for, so the batch stays the same
 *  no matter where on the age axes the plan sits. */
const SEQ_MIN_AGE = 40;

/** The shared batch of futures the readout is scored against. */
function makeSequences(inputs: RetirementInputs): Record<number, number>[] {
  return generateSequences(
    EQ_RUNS, Math.min(inputs.currentAge, SEQ_MIN_AGE), inputs.maxAge,
    inputs.investmentReturn, inputs.returnVolatility, EQ_SEED,
  );
}

/** The plan's success-rate readout, scored against the shared seeded batch. */
export function solveEqReadout(inputs: RetirementInputs, config: AppConfig): number {
  return simulate(inputs, config, makeSequences(inputs)).successRate;
}
