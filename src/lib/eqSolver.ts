// EQ readout solve — the off-main-thread Monte Carlo behind the ideation
// surface. Controls are constrained by per-control BANDS (handled synchronously
// on the main thread — see eqConstraints.clampToBand), so this worker only
// computes the plan's success-rate READOUT and the XY pad's feasibility
// shading (the region where the plan meets a reference success rate).
//
// All rates are scored against ONE seeded batch of futures so the readout and
// the grid agree and stay stable while the user drags (regenerating futures
// per candidate would make the rate noisy and the shading jump around).
import { generateSequences, simulate } from './monteCarlo';
import type { RetirementInputs } from './retirementEngine';
import type { AppConfig } from './appConfig';
import { AXES, withAxis, type EqAxis } from './eqConstraints';

export const EQ_RUNS = 500;
export const EQ_SEED = 0xE0;
const GRID = 9;
/** Reference success rate for the pad's feasibility shading. */
export const GRID_TARGET_RATE = 0.9;

export interface EqSolveRequest {
  inputs: RetirementInputs;
  config: AppConfig;
  /** XY pad axes to shade (null = no grid). */
  pad: { x: EqAxis; y: EqAxis } | null;
}

export interface EqSolveResult {
  successRate: number;
  /** Row-major grid, GRID×GRID, bottom-up in y (row 0 = lowest y). */
  grid: boolean[] | null;
  gridMeta: { x: EqAxis; y: EqAxis; size: number } | null;
}

export function solveEq(request: EqSolveRequest): EqSolveResult {
  const { inputs, config, pad } = request;

  const sequences = generateSequences(
    EQ_RUNS, inputs.currentAge, inputs.maxAge, inputs.investmentReturn, inputs.returnVolatility, EQ_SEED,
  );
  const rateOf = (cand: RetirementInputs) => simulate(cand, config, sequences).successRate;

  const successRate = rateOf(inputs);

  let grid: boolean[] | null = null;
  let gridMeta: EqSolveResult['gridMeta'] = null;
  if (pad) {
    const xSpec = AXES[pad.x];
    const ySpec = AXES[pad.y];
    grid = [];
    for (let gy = 0; gy < GRID; gy++) {
      for (let gx = 0; gx < GRID; gx++) {
        const x = xSpec.min + (xSpec.max - xSpec.min) * (gx / (GRID - 1));
        const y = ySpec.min + (ySpec.max - ySpec.min) * (gy / (GRID - 1));
        const cand = withAxis(withAxis(inputs, pad.x, x), pad.y, y);
        grid.push(rateOf(cand) >= GRID_TARGET_RATE);
      }
    }
    gridMeta = { x: pad.x, y: pad.y, size: GRID };
  }

  return { successRate, grid, gridMeta };
}
