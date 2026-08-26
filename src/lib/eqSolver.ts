// EQ readout solve — the off-main-thread Monte Carlo behind the ideation
// surface. Controls are constrained by per-control CROPS (handled synchronously
// on the main thread — see eqConstraints.clampToBand), so this worker only
// computes the plan's success-rate READOUT and the XY pad's success-rate GRID
// (which the pad renders as a smooth red→green gradient).
//
// All rates are scored against ONE seeded batch of futures so the readout and
// the grid agree and stay stable while the user drags (regenerating futures per
// candidate would make the rate noisy and the shading jump around).
//
// The grid holds a success RATE per node (not a boolean) so the UI can
// interpolate a smooth gradient between sampled points. Rows are scored and
// streamed CENTER-OUT from the current point (what the user is looking at
// first), so the gradient fills in live.
import { generateSequences, simulate } from './monteCarlo';
import type { RetirementInputs } from './retirementEngine';
import type { AppConfig } from './appConfig';
import { AXES, withAxis, axisValue, type EqAxis } from './eqConstraints';

// 300 trajectories per node keeps a 90% rate within ±3.4% (95% CI) — plenty for
// shading a 9×9 gradient, and ~40% cheaper per node than 500. The readout uses
// the same batch so it stays consistent with the shading under the dot.
export const EQ_RUNS = 300;
export const EQ_SEED = 0xE0;
const GRID = 9;
/** Youngest start age we generate sequences for — covers every grid column. */
const GRID_MIN_AGE = 40;

export interface EqSolveRequest {
  inputs: RetirementInputs;
  config: AppConfig;
  /** XY pad axes to shade (null = no grid). */
  pad: { x: EqAxis; y: EqAxis } | null;
  /**
   * The [min,max] each pad axis is RENDERED over (the axis, grown to fit an
   * out-of-range point). The grid samples exactly this range so a node lands
   * under the point it's drawn beneath. Defaults to the full axis when absent.
   */
  ranges?: { x: { min: number; max: number }; y: { min: number; max: number } };
}

export interface EqSolveResult {
  successRate: number;
  /** Row-major success-rate grid, GRID×GRID, bottom-up in y (row 0 = lowest y). */
  grid: number[] | null;
  gridMeta: { x: EqAxis; y: EqAxis; size: number } | null;
}

/** A partially-computed grid row, streamed as it finishes. */
export interface EqRowProgress {
  /** Grid row index (0 = lowest y). */
  row: number;
  /** The G success-rate cells for this row. */
  cells: number[];
}

/** The shared batch of futures every candidate is scored against. */
function makeSequences(inputs: RetirementInputs): Record<number, number>[] {
  return generateSequences(
    EQ_RUNS, Math.min(inputs.currentAge, GRID_MIN_AGE), inputs.maxAge,
    inputs.investmentReturn, inputs.returnVolatility, EQ_SEED,
  );
}

/** The center-out row order for a pad (nearest the current y first). */
function rowOrder(yR: { min: number; max: number }, curY: number, G: number): number[] {
  const yFrac = (curY - yR.min) / (yR.max - yR.min);
  const centerRow = Math.round(Math.min(1, Math.max(0, yFrac)) * (G - 1));
  const order: number[] = [];
  for (let d = 0; d < G; d++) {
    const up = centerRow + d;
    const down = centerRow - d;
    if (up < G && !order.includes(up)) order.push(up);
    if (down >= 0 && !order.includes(down)) order.push(down);
  }
  return order;
}

/** Score one grid row (G nodes across x at grid-row `gy`). */
function solveRow(
  inputs: RetirementInputs,
  x: EqAxis, y: EqAxis,
  xR: { min: number; max: number }, yR: { min: number; max: number },
  gy: number, G: number,
  rateOf: (cand: RetirementInputs) => number,
): number[] {
  const yv = yR.min + (yR.max - yR.min) * (gy / (G - 1));
  const cells = new Array<number>(G);
  for (let gx = 0; gx < G; gx++) {
    const xv = xR.min + (xR.max - xR.min) * (gx / (G - 1));
    cells[gx] = rateOf(withAxis(withAxis(inputs, x, xv), y, yv));
  }
  return cells;
}

/**
 * Compute a SUBSET of grid rows (in `order` sequence) — one shard of the full
 * grid for a parallel worker. Returns only the rows it was asked for; the
 * caller stitches shards together by row index. The readout (`successRate`) is
 * left to the coordinator (shard workers return 0 there; only row cells matter).
 */
export function solveEqRows(
  request: EqSolveRequest,
  order: number[],
  onRow?: (progress: EqRowProgress) => void,
): EqSolveResult {
  const { inputs, config, pad } = request;
  if (!pad) return { successRate: 0, grid: null, gridMeta: null };
  const sequences = makeSequences(inputs);
  const rateOf = (cand: RetirementInputs) => simulate(cand, config, sequences).successRate;
  const xR = request.ranges?.x ?? { min: AXES[pad.x].min, max: AXES[pad.x].max };
  const yR = request.ranges?.y ?? { min: AXES[pad.y].min, max: AXES[pad.y].max };
  const G = GRID;
  const grid = new Array<number>(G * G).fill(0);
  for (const gy of order) {
    const cells = solveRow(inputs, pad.x, pad.y, xR, yR, gy, G, rateOf);
    for (let gx = 0; gx < G; gx++) grid[gy * G + gx] = cells[gx];
    onRow?.({ row: gy, cells });
  }
  return { successRate: 0, grid, gridMeta: { x: pad.x, y: pad.y, size: G } };
}

/** The row-shards a parallel pool should run: center-out order round-robined
 *  across `shards` workers so the region around the point is spread across all
 *  of them (every worker gets some near rows → near region shades first). */
export function shardRows(request: EqSolveRequest, shards: number): number[][] {
  const { pad } = request;
  if (!pad || shards < 1) return [];
  const yR = request.ranges?.y ?? { min: AXES[pad.y].min, max: AXES[pad.y].max };
  const order = rowOrder(yR, axisValue(request.inputs, pad.y), GRID);
  const out: number[][] = Array.from({ length: Math.min(shards, order.length) }, () => []);
  order.forEach((gy, i) => out[i % out.length].push(gy));
  return out;
}

/** The plan's success-rate readout (scored against the same shared batch). */
export function solveEqReadout(request: EqSolveRequest): number {
  const sequences = makeSequences(request.inputs);
  return simulate(request.inputs, request.config, sequences).successRate;
}

// ---------------------------------------------------------------------------
// Parallel pool protocol — a coordinator shards the grid rows across N workers
// (solveEqRows) and stitches row messages back into a full grid.
// ---------------------------------------------------------------------------

/** Message a pool worker receives: which rows of which request to compute. */
export interface EqShardRequest {
  request: EqSolveRequest;
  rows: number[];
}

/** Message a pool worker sends back. */
export type EqShardResponse =
  | { type: 'row'; row: number; cells: number[] }
  | { type: 'done'; ok: true }
  | { type: 'done'; ok: false; error: string };

/**
 * Full solve: the readout + the (optionally streamed) success-rate grid.
 * `onRow` is called with each finished row, in center-out order (nearest the
 * current point first), so a caller can render partial progress.
 */
export function solveEq(
  request: EqSolveRequest,
  onRow?: (progress: EqRowProgress) => void,
): EqSolveResult {
  const { inputs, pad } = request;

  // ONE batch of futures serves the readout AND every grid node (sharing it
  // keeps them consistent and avoids a second batch). Generated once from the
  // youngest retirement age on the pad so each candidate simulates only its own
  // horizon (currentAge → maxAge) — a candidate retiring at 70 runs 20 years,
  // not 55. That alone cuts most of the per-node cost on long horizons.
  const successRate = solveEqReadout(request);

  if (!pad) return { successRate, grid: null, gridMeta: null };

  // Sample over the RENDERED ranges (grown to fit an out-of-range point), so
  // the gradient lines up with what's drawn. Default to the full axis.
  const yR = request.ranges?.y ?? { min: AXES[pad.y].min, max: AXES[pad.y].max };
  const order = rowOrder(yR, axisValue(inputs, pad.y), GRID);
  const part = solveEqRows(request, order, onRow);
  return { successRate, grid: part.grid, gridMeta: part.gridMeta };
}
