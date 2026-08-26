// EQ surface constraint core — the pure logic behind the ideation equalizer.
//
// A control axis (spending, retirement age, expected return, ...) is a scalar
// the user drags. A PIN is a constraint on an outcome — "success rate ≥ 90%",
// "money lasts to 95", "leave ≥ $100k". Each control is HARD or SOFT relative
// to the pin:
//
//   HARD  — the control may not be dragged into a violating region. Its range
//           clamps at the boundary, and an XY drag slides along it.
//   SOFT  — draggable anywhere, but a point in violation is flagged.
//
// The whole module is pure and synchronous given a `score` function, so the
// search/clamp/feasibility logic is unit-testable without Monte Carlo. The MC
// success-rate scoring is supplied by the caller (main thread pre-generates a
// seeded batch of futures, or a worker), keeping this file engine-agnostic.
//
// Why monotonicity matters: every axis moves the success rate in ONE
// direction — spending↑ → rate↓, retireAge↑ → rate↑ (fewer years to fund),
// return↑ → rate↑. A monotonic score means the feasible region is a half-line
// per axis, so the boundary is found by binary search and "slide along the
// boundary" is well-defined.

import { calculateHousehold, type RetirementInputs } from './retirementEngine';
import type { AppConfig } from './appConfig';

// ---------------------------------------------------------------------------
// Control axes
// ---------------------------------------------------------------------------

export type EqAxis = 'desiredSpending' | 'retirementAge' | 'investmentReturn';

export interface AxisSpec {
  key: EqAxis;
  label: string;
  min: number;
  max: number;
  /** Drag increment per step. */
  step: number;
  /** Does raising the value raise the success rate? (spending is false.) */
  increasingRate: boolean;
  format: (v: number) => string;
}

const money = (v: number) =>
  new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 }).format(v);

export const AXES: Record<EqAxis, AxisSpec> = {
  desiredSpending: {
    key: 'desiredSpending', label: 'Annual spending',
    min: 0, max: 250000, step: 1000,
    increasingRate: false,
    format: money,
  },
  retirementAge: {
    key: 'retirementAge', label: 'Retirement age',
    min: 40, max: 75, step: 1,
    increasingRate: true, // retiring later = fewer years to fund = safer
    format: (v) => `${Math.round(v)}`,
  },
  investmentReturn: {
    key: 'investmentReturn', label: 'Expected return',
    min: 0, max: 0.12, step: 0.0025,
    increasingRate: true,
    format: (v) => `${(v * 100).toFixed(1)}%`,
  },
};

/** Read an axis value from inputs. */
export function axisValue(inputs: RetirementInputs, axis: EqAxis): number {
  return inputs[axis];
}

/** Return inputs with one axis set (retirementAge is an integer). */
export function withAxis(inputs: RetirementInputs, axis: EqAxis, value: number): RetirementInputs {
  const v = axis === 'retirementAge' ? Math.round(value) : value;
  return { ...inputs, [axis]: v };
}

// ---------------------------------------------------------------------------
// Bands — per-control allowed range (the double-slider constraint)
// ---------------------------------------------------------------------------

/**
 * A per-control allowed range. The control's value must stay inside [min,max];
 * the band edges are themselves clamped to the axis's hard limits and ordered
 * (min ≤ max). This is the "pin each control to at least / at most" model: a
 * band with min > the axis floor is an "at least" pin, max < the axis ceiling
 * is an "at most" pin, and both together are a range.
 */
export interface Band {
  min: number;
  max: number;
  /** When false the band is ignored (control moves across the whole axis). */
  enabled: boolean;
}

/** The full axis range as an (unconstraining) disabled band. */
export function fullBand(axis: EqAxis): Band {
  const s = AXES[axis];
  return { min: s.min, max: s.max, enabled: false };
}

/** Normalize a band: clamp edges to the axis limits, order them, snap to step. */
export function normalizeBand(axis: EqAxis, band: Band): Band {
  const s = AXES[axis];
  const snap = (v: number) => {
    const clamped = Math.min(s.max, Math.max(s.min, v));
    return axis === 'retirementAge' ? Math.round(clamped) : clamped;
  };
  let lo = snap(band.min);
  let hi = snap(band.max);
  if (lo > hi) [lo, hi] = [hi, lo];
  return { min: lo, max: hi, enabled: band.enabled };
}

/** The effective [min,max] a control may take: the band if enabled, else the axis range. */
export function effectiveRange(axis: EqAxis, band: Band | undefined): { min: number; max: number } {
  const s = AXES[axis];
  if (!band || !band.enabled) return { min: s.min, max: s.max };
  const n = normalizeBand(axis, band);
  return { min: n.min, max: n.max };
}

/** Clamp a proposed value into the control's allowed range (band-aware). */
export function clampToBand(axis: EqAxis, band: Band | undefined, proposed: number): number {
  const { min, max } = effectiveRange(axis, band);
  const v = Math.min(max, Math.max(min, proposed));
  return axis === 'retirementAge' ? Math.round(v) : v;
}

// ---------------------------------------------------------------------------
// Pins (outcome constraints)
// ---------------------------------------------------------------------------

export type PinKind = 'successRate' | 'fundedToAge' | 'legacyFloor';

export interface EqPin {
  kind: PinKind;
  /** successRate: 0..1. fundedToAge: an age. legacyFloor: dollars. */
  value: number;
  enabled: boolean;
}

/** Deterministic outcome of one plan run (no Monte Carlo). */
export interface DeterministicOutcome {
  /** Age the money runs out; null = funded to max age. */
  depletionAge: number | null;
  /** Ending balance at max age (0 if depleted). */
  endingBalance: number;
  status: 'ON_TRACK' | 'SHORTFALL';
}

/** Run the deterministic engine once and reduce to the pin-relevant outcome. */
export function deterministicOutcome(inputs: RetirementInputs, config: AppConfig): DeterministicOutcome {
  const r = calculateHousehold(inputs, config);
  const last = r.yearlyBreakdown[r.yearlyBreakdown.length - 1];
  const depleted = r.depletionAge !== null;
  return {
    depletionAge: r.depletionAge,
    endingBalance: depleted ? 0 : Math.max(0, last?.endingBalance ?? 0),
    status: r.status,
  };
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/**
 * A scoring function maps inputs → success rate 0..1 for the successRate pin.
 * The caller supplies this (a seeded Monte Carlo batch, or a deterministic
 * proxy in tests). It MUST be monotonic in each axis for the search to hold.
 */
export type SuccessScorer = (inputs: RetirementInputs) => number;

/**
 * Evaluate whether a pin is satisfied. `score` is required only for the
 * successRate pin; deterministic pins ignore it.
 */
export function pinSatisfied(
  pin: EqPin,
  inputs: RetirementInputs,
  config: AppConfig,
  score?: SuccessScorer,
): boolean {
  switch (pin.kind) {
    case 'successRate': {
      if (!score) return true; // no scorer wired → treat as satisfied (no constraint)
      return score(inputs) >= pin.value - 1e-9;
    }
    case 'fundedToAge': {
      const o = deterministicOutcome(inputs, config);
      // Satisfied when there's no depletion, or depletion happens at/after the target age.
      return o.depletionAge === null || o.depletionAge >= pin.value;
    }
    case 'legacyFloor': {
      const o = deterministicOutcome(inputs, config);
      return o.endingBalance >= pin.value;
    }
  }
}

// ---------------------------------------------------------------------------
// Boundary search (the clamp)
// ---------------------------------------------------------------------------

export interface BoundaryResult {
  /** The boundary value on this axis: the most extreme value still satisfying the pin. */
  value: number;
  /** True if a finite boundary was found within [min,max]; false if the whole range satisfies (unconstrained) or nothing does (infeasible). */
  kind: 'bounded' | 'unconstrained' | 'infeasible';
}

/**
 * Find the boundary value on `axis` beyond which `pin` is violated. Because
 * the score is monotonic in the axis, the feasible set is a contiguous
 * sub-range of [min,max]:
 *
 *   increasingRate axis → feasible is [min, boundary]  (boundary is the max OK value)
 *   decreasingRate axis → feasible is [boundary, max]  (boundary is the min OK value)
 *
 * The returned `value` is the edge of the feasible region. Clamping a dragged
 * value to the feasible side is what makes a HARD pin bite.
 */
export function findBoundary(
  pin: EqPin,
  inputs: RetirementInputs,
  config: AppConfig,
  axis: EqAxis,
  score?: SuccessScorer,
  tolerance?: number,
): BoundaryResult {
  const spec = AXES[axis];
  const tol = tolerance ?? spec.step;
  const ok = (v: number) => pinSatisfied(pin, withAxis(inputs, axis, v), config, score);

  const okAtMin = ok(spec.min);
  const okAtMax = ok(spec.max);

  // Feasible side depends on which way the axis moves the score.
  if (spec.increasingRate) {
    // Feasible is the UPPER end. If even max fails → infeasible. If min passes → whole range OK.
    if (!okAtMax) return { value: spec.max, kind: 'infeasible' };
    if (okAtMin) return { value: spec.min, kind: 'unconstrained' };
    // Binary search the smallest value that satisfies (boundary = lower edge of feasible).
    let lo = spec.min, hi = spec.max; // ok(lo)=false, ok(hi)=true
    while (hi - lo > tol) {
      const mid = (lo + hi) / 2;
      if (ok(mid)) hi = mid; else lo = mid;
    }
    return { value: hi, kind: 'bounded' };
  }

  // Decreasing-rate axis (spending): feasible is the LOWER end. If even min fails → infeasible.
  if (!okAtMin) return { value: spec.min, kind: 'infeasible' };
  if (okAtMax) return { value: spec.max, kind: 'unconstrained' };
  // Binary search the largest value that satisfies (boundary = upper edge of feasible).
  let lo = spec.min, hi = spec.max; // ok(lo)=true, ok(hi)=false
  while (hi - lo > tol) {
    const mid = (lo + hi) / 2;
    if (ok(mid)) lo = mid; else hi = mid;
  }
  return { value: lo, kind: 'bounded' };
}

/**
 * Clamp a proposed axis value to the feasible region for a HARD pin. For a
 * bounded boundary this snaps the value to the nearest feasible side; for
 * unconstrained it returns the value unchanged; for infeasible it returns the
 * boundary (the least-bad value) so the control rests at the edge.
 */
export function clampToBoundary(
  axis: EqAxis,
  proposed: number,
  boundary: BoundaryResult,
): number {
  const spec = AXES[axis];
  const v = Math.min(spec.max, Math.max(spec.min, proposed));
  if (boundary.kind === 'unconstrained') return v;
  if (spec.increasingRate) {
    // Feasible is [boundary, max].
    return Math.max(boundary.value, v);
  }
  // Feasible is [min, boundary].
  return Math.min(boundary.value, v);
}

// ---------------------------------------------------------------------------
// XY pad: feasibility of a point + boundary slide
// ---------------------------------------------------------------------------

/** A point on a 2-axis pad. */
export interface PadPoint {
  x: number;
  y: number;
}

/**
 * Slide a proposed point back into the feasible region for a HARD pin, one
 * axis at a time (x first, then y re-solved given the clamped x). This is the
 * "drag slides along the boundary" behaviour: you can move freely until you
 * hit the constraint edge, then the point tracks it.
 *
 * `solveAxis` finds the boundary on one axis with the OTHER axis held at a
 * given value — supplied by the caller so the pad controls solve order.
 */
export function slidePoint(
  proposed: PadPoint,
  xAxis: EqAxis,
  yAxis: EqAxis,
  solveX: (yHeld: number) => BoundaryResult,
  solveY: (xHeld: number) => BoundaryResult,
): PadPoint {
  const x = clampToBoundary(xAxis, proposed.x, solveX(proposed.y));
  const y = clampToBoundary(yAxis, proposed.y, solveY(x));
  return { x, y };
}

// ---------------------------------------------------------------------------
// Hard/soft classification
// ---------------------------------------------------------------------------

export type PinMode = 'hard' | 'soft';

/**
 * For a SOFT pin a control may be dragged anywhere; this reports whether the
 * resulting point is in violation (so the UI can flag it). For a HARD pin the
 * value should already have been clamped, so this is used only to show the
 * at-the-boundary state.
 */
export function isViolation(
  pin: EqPin,
  inputs: RetirementInputs,
  config: AppConfig,
  score?: SuccessScorer,
): boolean {
  return !pinSatisfied(pin, inputs, config, score);
}
