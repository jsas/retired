// Spending-contour terrain for the f7 "map" — the ground the plan stands on.
//
// The map plots retirement age (x) against yearly spending (y) and shades where
// the plan holds. The boundary line is the curve where the plan stops holding;
// below it the money lasts past the plan-to age, above it the money runs out
// early. This module computes that terrain from the REAL engine
// (`calculateHousehold`), so the map shows the same answer as the verdict hero.
//
// The terrain depends on everything EXCEPT the two axes — retire age and
// spending move the dot, not the ground. So `buildTerrain` takes the full plan
// plus the axis ranges, runs the engine only to find boundary spendings, and
// returns smooth SVG path geometry the component renders without re-simulating.
//
// Ported from the winning mock (ux-proposals/finalists/f7-final-app.html) onto
// the engine; all predicates and band ordering match the mock's semantics.
// Pure and unit-tested (contour.test.ts) — no DOM, no React.

import { calculateHousehold, type RetirementInputs, type RetirementResults } from './retirementEngine';
import type { AppConfig } from './appConfig';

/** The result the predicates read — just the verdict bits the bands need. */
export interface Verdict {
  depletionAge: number | null;
  status: 'ON_TRACK' | 'SHORTFALL';
}

/** A single engine sample at (retireAge, spending). */
export type Sample = (retireAge: number, spending: number) => Verdict;

/** Axis window for the map. Spending y runs top (high) → bottom (low). */
export interface TerrainWindow {
  ageMin: number;      // x left  (retire age)
  ageMax: number;      // x right
  spendTop: number;    // y top    (highest spending shown)
  spendBottom: number; // y bottom (lowest spending shown)
}

/** Tunables for the boundary search + smoothing. */
export interface TerrainOptions {
  cols?: number;        // boundary samples across x (default 80)
  bisect?: number;      // bisection iterations per column (default 14)
  borderYears?: number; // amber band = depletion within this of maxAge (default 6)
  cushion?: number;     // deep band = lasts this far past maxAge (default 5)
}

export interface TerrainBands {
  /** Spending where status flips ON_TRACK→SHORTFALL, per column (age order). */
  green: number[];
  /** Green OR borderline (depletion within borderYears of maxAge). */
  amber: number[];
  /** Comfortably past the plan (depletion null or > maxAge + cushion). */
  deep: number[];
}

const DEFAULTS = { cols: 80, bisect: 14, borderYears: 6, cushion: 5 };

function toVerdict(r: RetirementResults): Verdict {
  return { depletionAge: r.depletionAge, status: r.status };
}

/** Make the engine sampler for a plan: vary only retireAge + desiredSpending. */
export function makeSample(
  inputs: RetirementInputs,
  config: AppConfig,
): Sample {
  return (retireAge, spending) =>
    toVerdict(calculateHousehold({ ...inputs, retirementAge: retireAge, desiredSpending: spending }, config));
}

// --- predicates -------------------------------------------------------------
// Each takes a verdict and the plan-to age; returns true when the plan "holds"
// at that band's threshold. They mirror the mock exactly.

export function predGreen(v: Verdict): boolean {
  return v.status === 'ON_TRACK';
}

export function predAmber(v: Verdict, maxAge: number, borderYears = DEFAULTS.borderYears): boolean {
  return v.status === 'ON_TRACK' ||
    (v.depletionAge != null && (maxAge - v.depletionAge) <= borderYears);
}

export function predDeep(v: Verdict, maxAge: number, cushion = DEFAULTS.cushion): boolean {
  return v.depletionAge == null || v.depletionAge > maxAge + cushion;
}

/**
 * For one retire-age column, find the spending where `pred` flips from true
 * (low spending) to false (high spending) by bisection. Clamped to the window:
 * returns spendTop if it holds even at the top, spendBottom if it fails even at
 * the bottom (the band then runs off that edge of the map).
 */
export function boundarySpend(
  retireAge: number,
  pred: (v: Verdict) => boolean,
  sample: Sample,
  win: TerrainWindow,
  bisect = DEFAULTS.bisect,
): number {
  const { spendTop, spendBottom } = win;
  if (pred(sample(retireAge, spendTop))) return spendTop;      // holds at the top
  if (!pred(sample(retireAge, spendBottom))) return spendBottom; // fails at the bottom
  let lo = spendBottom; // pred true here
  let hi = spendTop;    // pred false here
  for (let k = 0; k < bisect; k++) {
    const mid = (lo + hi) / 2;
    if (pred(sample(retireAge, mid))) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/** A chain of boundary spendings, one per column, across the age window. */
export function boundaryChain(
  pred: (v: Verdict) => boolean,
  sample: Sample,
  win: TerrainWindow,
  cols = DEFAULTS.cols,
  bisect = DEFAULTS.bisect,
): number[] {
  const out: number[] = [];
  for (let i = 0; i <= cols; i++) {
    const age = win.ageMin + (win.ageMax - win.ageMin) * (i / cols);
    out.push(boundarySpend(age, pred, sample, win, bisect));
  }
  return out;
}

/**
 * Compute all three bands and keep their ordering honest: the amber boundary
 * never sits below green, the deep boundary never above it. (In spending terms
 * with top=high: amber ≥ green ≥ deep per column.)
 */
export function buildBands(
  inputs: RetirementInputs,
  config: AppConfig,
  win: TerrainWindow,
  opts: TerrainOptions = {},
): TerrainBands {
  const { cols, bisect, borderYears, cushion } = { ...DEFAULTS, ...opts };
  const sample = makeSample(inputs, config);
  const maxAge = inputs.maxAge;

  const green = boundaryChain(v => predGreen(v), sample, win, cols, bisect);
  let amber = boundaryChain(v => predAmber(v, maxAge, borderYears), sample, win, cols, bisect);
  let deep = boundaryChain(v => predDeep(v, maxAge, cushion), sample, win, cols, bisect);

  amber = amber.map((a, i) => Math.max(a, green[i])); // amber never below green
  deep = deep.map((d, i) => Math.min(d, green[i]));   // deep never above green
  return { green, amber, deep };
}

// --- axis mapping -----------------------------------------------------------
// The component owns the SVG plot box; these map data → plot fraction (0..1)
// so the lib stays DOM-free. y is a fraction from the TOP of the plot.

export function xFrac(age: number, win: TerrainWindow): number {
  return (age - win.ageMin) / (win.ageMax - win.ageMin);
}

export function yFrac(spend: number, win: TerrainWindow): number {
  return (win.spendTop - spend) / (win.spendTop - win.spendBottom);
}

export function ageAtFrac(f: number, win: TerrainWindow): number {
  return win.ageMin + f * (win.ageMax - win.ageMin);
}

export function spendAtFrac(f: number, win: TerrainWindow): number {
  return win.spendTop - f * (win.spendTop - win.spendBottom);
}

// --- smoothing --------------------------------------------------------------
// Catmull-Rom chain → a single smooth cubic-bezier SVG path in plot-box pixel
// coords. Control points are clamped so the curve never overshoots the frame —
// this is what makes the bands read as a topographic map rather than steps.

export interface PlotBox { left: number; right: number; top: number; bottom: number }

export function smoothPath(
  spendings: number[],
  win: TerrainWindow,
  box: PlotBox,
): string {
  const W = box.right - box.left;
  const H = box.bottom - box.top;
  const clampY = (y: number) => Math.min(box.bottom, Math.max(box.top, y));
  const px = spendings.map((_, i) => box.left + (i / (spendings.length - 1)) * W);
  const py = spendings.map(s => box.top + yFrac(s, win) * H);

  let d = `M ${px[0].toFixed(1)} ${clampY(py[0]).toFixed(1)}`;
  for (let i = 0; i < px.length - 1; i++) {
    const p0 = Math.max(0, i - 1), p1 = i, p2 = i + 1, p3 = Math.min(px.length - 1, i + 2);
    const c1x = px[p1] + (px[p2] - px[p0]) / 6, c1y = py[p1] + (py[p2] - py[p0]) / 6;
    const c2x = px[p2] - (px[p3] - px[p1]) / 6, c2y = py[p2] - (py[p3] - py[p1]) / 6;
    d += ` C ${c1x.toFixed(1)} ${clampY(c1y).toFixed(1)}, ${c2x.toFixed(1)} ${clampY(c2y).toFixed(1)}, ${px[p2].toFixed(1)} ${clampY(py[p2]).toFixed(1)}`;
  }
  return d;
}

/** A cache key for the terrain: everything that changes the ground, not the dot. */
export function terrainKey(inputs: RetirementInputs): string {
  return JSON.stringify([
    inputs.investmentReturn, inputs.returnVolatility, inputs.maxAge, inputs.currentAge,
    inputs.rrspBalance, inputs.tfsaBalance, inputs.taxableBalance, inputs.cashCushionBalance,
    inputs.rrspContribution, inputs.tfsaContribution, inputs.taxableContribution,
    inputs.cppStartAge, inputs.cppMonthlyAmount, inputs.oasStartAge, inputs.oasYearsInCanada,
    inputs.provinceCode, inputs.spouse != null, (inputs.income ?? []).length,
    (inputs.events ?? []).length, inputs.withdrawalOrder?.join(','),
  ]);
}
