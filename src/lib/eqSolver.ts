// EQ readout solve — the off-main-thread Monte Carlo behind the ideation
// surface. Controls are constrained by per-control BANDS (handled synchronously
// on the main thread — see eqConstraints.clampToBand), so this worker only
// computes the plan's success-rate READOUT and the XY pad's feasibility
// shading (the region where the plan meets a reference success rate).
//
// All rates are scored against ONE seeded batch of futures so the readout and
// the grid agree and stay stable while the user drags (regenerating futures
// per candidate would make the rate noisy and the shading jump around).
//
// Two optimizations:
//
//  1. Monotonic row solve. Along any grid ROW (y-axis held), the success rate
//     is monotonic in x (retireAge↑ → rate↑), and along any COLUMN it's
//     monotonic in y (spending↑ → rate↓). So instead of scoring all G×G cells
//     we binary-search the BOUNDARY column per row (≈log2 G evals/row) and fill
//     the rest from the known direction. A 9×9 grid needs ~36 sims instead of
//     81 — and larger grids get cheaper relative to brute force.
//
//  2. Center-out streaming. Rows are solved starting at the row nearest the
//     current point (what the user is looking at) and working outward, and each
//     finished row is streamed to the UI so the shading fills in live instead
//     of appearing all at once.
import { generateSequences, simulate } from './monteCarlo';
import type { RetirementInputs } from './retirementEngine';
import type { AppConfig } from './appConfig';
import { AXES, withAxis, axisValue, type EqAxis } from './eqConstraints';

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
  /** Success-rate goal the grid shades against (defaults to GRID_TARGET_RATE). */
  targetRate?: number;
}

export interface EqSolveResult {
  successRate: number;
  /** Row-major grid, GRID×GRID, bottom-up in y (row 0 = lowest y). */
  grid: boolean[] | null;
  gridMeta: { x: EqAxis; y: EqAxis; size: number } | null;
}

/** A partially-computed grid row, streamed as it finishes. */
export interface EqRowProgress {
  /** Grid row index (0 = lowest y). */
  row: number;
  /** The G boolean cells for this row. */
  cells: boolean[];
}

/**
 * Solve one grid ROW: for the row's fixed y, find the boundary column where the
 * success rate crosses GRID_TARGET_RATE, then fill the whole row from the
 * x-axis direction. Returns the G cells (index 0 = lowest x).
 *
 * Monotonicity: rate is non-decreasing in x for an increasingRate x-axis
 * (retirement age), so feasibility is a contiguous suffix [boundary..G-1];
 * for a decreasingRate x-axis it's a prefix [0..boundary]. One binary search
 * per row finds the edge.
 */
function solveRow(
  rateOf: (cand: RetirementInputs) => number,
  inputs: RetirementInputs,
  xAxis: EqAxis,
  yAxis: EqAxis,
  y: number,
  target: number,
): boolean[] {
  const xSpec = AXES[xAxis];
  const G = GRID;
  const xAt = (gx: number) => xSpec.min + (xSpec.max - xSpec.min) * (gx / (G - 1));
  const ok = (gx: number) => rateOf(withAxis(withAxis(inputs, yAxis, y), xAxis, xAt(gx))) >= target;

  const cells = new Array<boolean>(G);
  if (xSpec.increasingRate) {
    // Feasible is the RIGHT end. If even the last column fails → whole row infeasible.
    if (!ok(G - 1)) return cells.fill(false);
    // If the first column passes → whole row feasible.
    if (ok(0)) return cells.fill(true);
    // Binary search the first feasible column.
    let lo = 0, hi = G - 1; // ok(lo)=false, ok(hi)=true
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (ok(mid)) hi = mid; else lo = mid;
    }
    for (let gx = 0; gx < G; gx++) cells[gx] = gx >= hi;
    return cells;
  }
  // Decreasing-rate x-axis: feasible is the LEFT end.
  if (!ok(0)) return cells.fill(false);
  if (ok(G - 1)) return cells.fill(true);
  let lo = 0, hi = G - 1; // ok(lo)=true, ok(hi)=false
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (ok(mid)) lo = mid; else hi = mid;
  }
  for (let gx = 0; gx < G; gx++) cells[gx] = gx <= lo;
  return cells;
}

/**
 * Full solve: the readout + the (optionally streamed) feasibility grid.
 * `onRow` is called with each finished row, in center-out order (nearest the
 * current point first), so a caller can render partial progress.
 */
export function solveEq(
  request: EqSolveRequest,
  onRow?: (progress: EqRowProgress) => void,
): EqSolveResult {
  const { inputs, config, pad, targetRate } = request;
  const target = targetRate ?? GRID_TARGET_RATE;

  const sequences = generateSequences(
    EQ_RUNS, inputs.currentAge, inputs.maxAge, inputs.investmentReturn, inputs.returnVolatility, EQ_SEED,
  );
  const rateOf = (cand: RetirementInputs) => simulate(cand, config, sequences).successRate;

  const successRate = rateOf(inputs);

  let grid: boolean[] | null = null;
  let gridMeta: EqSolveResult['gridMeta'] = null;
  if (pad) {
    const ySpec = AXES[pad.y];
    const G = GRID;
    grid = new Array<boolean>(G * G).fill(false);

    // Row order: nearest the current y first, then alternating outward, so the
    // region around the user's point shades in first.
    const curY = axisValue(inputs, pad.y);
    const yFrac = (curY - ySpec.min) / (ySpec.max - ySpec.min);
    const centerRow = Math.round(yFrac * (G - 1));
    const order: number[] = [];
    for (let d = 0; d < G; d++) {
      const up = centerRow + d;
      const down = centerRow - d;
      if (up < G && !order.includes(up)) order.push(up);
      if (down >= 0 && !order.includes(down)) order.push(down);
    }

    for (const gy of order) {
      const y = ySpec.min + (ySpec.max - ySpec.min) * (gy / (G - 1));
      const cells = solveRow(rateOf, inputs, pad.x, pad.y, y, target);
      for (let gx = 0; gx < G; gx++) grid[gy * G + gx] = cells[gx];
      onRow?.({ row: gy, cells });
    }
    gridMeta = { x: pad.x, y: pad.y, size: G };
  }

  return { successRate, grid, gridMeta };
}
