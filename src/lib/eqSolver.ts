// EQ constraint solve — the heavy, off-main-thread computation behind the
// ideation surface. Given the current inputs, the pinned goal, and which axes
// need clamps/grids, it returns everything the page needs to draw:
//
//   successRate — live success rate of the current inputs (for the verdict).
//   bounds      — per-axis HARD clamp boundary (where the pin starts to bite).
//   grid        — XY-pad feasibility shading (coarse cells, true = feasible).
//
// All success rates are scored against ONE seeded batch of futures so the
// boundary, the grid, and the verdict agree with each other and stay stable
// while the user drags (regenerating futures per candidate would make the
// rate noisy and the boundary jump around).
import { generateSequences, simulate } from './monteCarlo';
import type { RetirementInputs } from './retirementEngine';
import type { AppConfig } from './appConfig';
import {
  AXES, withAxis, findBoundary, pinSatisfied,
  type EqAxis, type EqPin, type BoundaryResult,
} from './eqConstraints';

export const EQ_RUNS = 500;
export const EQ_SEED = 0xE0;
const GRID = 9;

export interface EqSolveRequest {
  inputs: RetirementInputs;
  config: AppConfig;
  pin: EqPin;
  /** Axes to compute a clamp boundary for (the faders). */
  boundAxes: EqAxis[];
  /** XY pad axes to shade (null = no grid). */
  pad: { x: EqAxis; y: EqAxis } | null;
}

export interface EqSolveResult {
  successRate: number;
  bounds: Partial<Record<EqAxis, BoundaryResult>>;
  /** Row-major grid, GRID×GRID, bottom-up in y (row 0 = lowest y). */
  grid: boolean[] | null;
  gridMeta: { x: EqAxis; y: EqAxis; size: number } | null;
}

export function solveEq(request: EqSolveRequest): EqSolveResult {
  const { inputs, config, pin, boundAxes, pad } = request;

  const sequences = generateSequences(
    EQ_RUNS, inputs.currentAge, inputs.maxAge, inputs.investmentReturn, inputs.returnVolatility, EQ_SEED,
  );
  const scorer = (cand: RetirementInputs) => simulate(cand, config, sequences).successRate;

  const successRate = scorer(inputs);

  const bounds: Partial<Record<EqAxis, BoundaryResult>> = {};
  if (pin.enabled) {
    for (const axis of boundAxes) {
      bounds[axis] = findBoundary(pin, inputs, config, axis, scorer);
    }
  }

  let grid: boolean[] | null = null;
  let gridMeta: EqSolveResult['gridMeta'] = null;
  if (pin.enabled && pad) {
    const xSpec = AXES[pad.x];
    const ySpec = AXES[pad.y];
    grid = [];
    for (let gy = 0; gy < GRID; gy++) {
      for (let gx = 0; gx < GRID; gx++) {
        const x = xSpec.min + (xSpec.max - xSpec.min) * (gx / (GRID - 1));
        const y = ySpec.min + (ySpec.max - ySpec.min) * (gy / (GRID - 1));
        const cand = withAxis(withAxis(inputs, pad.x, x), pad.y, y);
        grid.push(pinSatisfied(pin, cand, config, scorer));
      }
    }
    gridMeta = { x: pad.x, y: pad.y, size: GRID };
  }

  return { successRate, bounds, grid, gridMeta };
}
