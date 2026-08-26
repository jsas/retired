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

export type EqAxis =
  | 'desiredSpending'
  | 'retirementAge'
  | 'investmentReturn'
  | 'maxAge'
  | 'annualSavings'
  | 'returnVolatility'
  | 'cppStartAge'
  | 'oasStartAge';

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
    min: 0, max: 1000000, step: 1000,
    increasingRate: false,
    format: money,
  },
  retirementAge: {
    key: 'retirementAge', label: 'Retirement age',
    min: 40, max: 75, step: 1, // min becomes the plan's current age (see renderRange)
    increasingRate: true, // retiring later = fewer years to fund = safer
    format: (v) => `${Math.round(v)}`,
  },
  investmentReturn: {
    key: 'investmentReturn', label: 'Expected return',
    min: 0, max: 0.20, step: 0.0025,
    increasingRate: true,
    format: (v) => `${(v * 100).toFixed(1)}%`,
  },
  maxAge: {
    key: 'maxAge', label: 'Plan to age',
    min: 70, max: 105, step: 1,
    increasingRate: false, // a longer horizon = more years to fund = riskier
    format: (v) => `${Math.round(v)}`,
  },
  annualSavings: {
    key: 'annualSavings', label: 'Annual savings',
    // Floor is the plan's locked RRSP+TFSA (see renderRange); ceiling $500k.
    min: 0, max: 500000, step: 1000,
    increasingRate: true,
    format: money,
  },
  returnVolatility: {
    key: 'returnVolatility', label: 'Return volatility',
    min: 0, max: 0.30, step: 0.005,
    increasingRate: false, // more volatility = fatter tails = lower success
    format: (v) => `${(v * 100).toFixed(0)}%`,
  },
  cppStartAge: {
    key: 'cppStartAge', label: 'CPP start age',
    min: 60, max: 70, step: 1,
    // More monthly income → better success once it starts, but a later start
    // also means more bridge years to fund. Treated as rate-increasing: the
    // 42% deferral boost dominates the extra bridge years in practice.
    increasingRate: true,
    format: (v) => `${Math.round(v)}`,
  },
  oasStartAge: {
    key: 'oasStartAge', label: 'OAS start age',
    min: 65, max: 70, step: 1, // OAS can be deferred to 70 (no early option)
    increasingRate: true,     // +0.6%/month deferral boost dominates the bridge years
    format: (v) => `${Math.round(v)}`,
  },
};

// Axes that hold integer values (snapped in withAxis/normalizeBand/clampToBand).
export const INT_AXES: ReadonlySet<EqAxis> = new Set(['retirementAge', 'maxAge', 'cppStartAge', 'oasStartAge']);

// Derived/virtual axes that don't map 1:1 onto a RetirementInputs field.
// annualSavings = total pre-retirement contributions across the three accounts;
// writes go to the taxable account only (no contribution limit to collide with).
const ANNUAL_SAVINGS_FIELDS = ['rrspContribution', 'tfsaContribution', 'taxableContribution'] as const;

/** Read an axis value from inputs. */
export function axisValue(inputs: RetirementInputs, axis: EqAxis): number {
  if (axis === 'annualSavings') {
    return ANNUAL_SAVINGS_FIELDS.reduce((sum, f) => sum + inputs[f], 0);
  }
  if (axis === 'cppStartAge') return inputs.cppStartAge ?? 65;
  if (axis === 'oasStartAge') return inputs.oasStartAge ?? 65;
  return inputs[axis];
}

/** Return inputs with one axis set (integer axes are rounded). */
export function withAxis(inputs: RetirementInputs, axis: EqAxis, value: number): RetirementInputs {
  const v = INT_AXES.has(axis) ? Math.round(value) : value;
  if (axis === 'annualSavings') {
    // Registered contributions (RRSP+TFSA) are LOCKED — this slider only moves
    // the taxable account on top of them. The axis floor is rrsp+tfsa (taxable
    // = 0); raising the value adds the difference to taxable, which has no
    // contribution limit to collide with.
    const locked = inputs.rrspContribution + inputs.tfsaContribution;
    const taxable = Math.max(0, Math.round(v - locked));
    return { ...inputs, taxableContribution: taxable };
  }
  if (axis === 'cppStartAge') return { ...inputs, cppStartAge: v };
  if (axis === 'oasStartAge') return { ...inputs, oasStartAge: v };
  return { ...inputs, [axis]: v };
}

// ---------------------------------------------------------------------------
// Bands — per-control allowed range (the "crop" constraint)
// ---------------------------------------------------------------------------

/**
 * A per-control allowed range [min,max] — a "crop" of the axis. The control's
 * value must stay inside; the edges are clamped to the axis's hard limits and
 * ordered (min ≤ max). There is no enable flag: a crop narrower than the full
 * axis is active by definition, and a crop spanning the whole axis is the
 * unconstrained state. That keeps the UI to a single triple-slider (min ·
 * value · max) with no toggle.
 */
export interface Band {
  min: number;
  max: number;
}

/** The full axis range — the unconstrained crop. */
export function fullBand(axis: EqAxis): Band {
  const s = AXES[axis];
  return { min: s.min, max: s.max };
}

/** True when the crop is narrower than the whole axis (i.e. actually limiting). */
export function isLimited(axis: EqAxis, band: Band): boolean {
  const s = AXES[axis];
  const n = normalizeBand(axis, band);
  return n.min > s.min || n.max < s.max;
}

/** Normalize a band: clamp edges to the axis limits, order them, snap to step. */
export function normalizeBand(axis: EqAxis, band: Band): Band {
  const s = AXES[axis];
  const snap = (v: number) => {
    const clamped = Math.min(s.max, Math.max(s.min, v));
    return INT_AXES.has(axis) ? Math.round(clamped) : clamped;
  };
  let lo = snap(band.min);
  let hi = snap(band.max);
  if (lo > hi) [lo, hi] = [hi, lo];
  return { min: lo, max: hi };
}

/** The effective [min,max] a control may take: the normalized crop. */
export function effectiveRange(axis: EqAxis, band: Band | undefined): { min: number; max: number } {
  const s = AXES[axis];
  if (!band) return { min: s.min, max: s.max };
  const n = normalizeBand(axis, band);
  return { min: n.min, max: n.max };
}

/** Clamp a proposed value into the control's allowed range (band-aware). */
export function clampToBand(axis: EqAxis, band: Band | undefined, proposed: number): number {
  const { min, max } = effectiveRange(axis, band);
  const v = Math.min(max, Math.max(min, proposed));
  return INT_AXES.has(axis) ? Math.round(v) : v;
}

/** A concrete [min,max] rendering range for a control (defaults to the axis spec). */
export interface AxisRange { min: number; max: number }

/**
 * The range a control should RENDER. Starts from the axis range, then adapts to
 * the plan (`inputs`):
 *
 *  - Floor: some axes have a logical floor above the axis's generic min —
 *    retirement age can't be below the plan's CURRENT age; annual savings can't
 *    go below the locked RRSP+TFSA contributions (the slider only adds taxable).
 *  - Ceiling: when the plan value exceeds the axis max (spending typed above
 *    the cap), the range GROWS in whole-axis steps until it fits, so the value
 *    knob and crop always render in-bounds.
 *
 * Crops are stored as axis fractions (eqStorage), so when a range adapts, a
 * saved crop re-scales with it — "the middle 60%" still means the middle 60%
 * of whatever is shown. Values are decoupled from ranges, so ranges are free
 * to adapt.
 */
export function renderRange(axis: EqAxis, value: number, inputs?: RetirementInputs): AxisRange {
  const s = AXES[axis];
  let min = s.min;
  if (inputs) {
    if (axis === 'retirementAge') min = Math.max(s.min, Math.round(inputs.currentAge));
    else if (axis === 'annualSavings') min = Math.max(s.min, inputs.rrspContribution + inputs.tfsaContribution);
  }
  if (value <= s.max) return { min, max: Math.max(s.max, min) };
  const base = s.max - s.min;
  const multiples = Math.ceil((value - s.max) / base);
  return { min, max: s.max + multiples * base };
}

/**
 * A crop with its edges EXTENDED to include the given value (no-op when the
 * value is already inside). The crop is a fence around what you consider
 * acceptable — so when the plan value moves past an edge (typed elsewhere,
 * dragged on the timeline, …), the fence moves with it rather than leaving the
 * value outside its own limits. Extends only toward the value: a value past
 * `max` raises `max`, a value below `min` lowers `min`; the crop never shrinks
 * and never inverts.
 */
export function bandWithValue(axis: EqAxis, band: Band, value: number): Band {
  const n = normalizeBand(axis, band);
  if (value > n.max) return normalizeBand(axis, { min: n.min, max: value });
  if (value < n.min) return normalizeBand(axis, { min: value, max: n.max });
  return n;
}

/**
 * Keep the plan's ages internally consistent when CURRENT AGE changes. The
 * engine runs an accumulation phase from currentAge → retirementAge, so a
 * retirement age below the current age is invalid (no saving years). When the
 * user edits current age, clamp the dependent ages so the plan always makes
 * sense:
 *
 *   retirementAge ≥ currentAge   (can't retire before now)
 *   maxAge        ≥ retirementAge (the plan must reach at least retirement)
 *   cppStartAge / oasStartAge     clamped into their eligible windows
 *
 * Only out-of-range fields are touched; valid ones pass through unchanged.
 */
export function consistentAges<T extends RetirementInputs>(inputs: T): T {
  const cur = Math.round(inputs.currentAge);
  const retirementAge = Math.max(cur, Math.round(inputs.retirementAge));
  const maxAge = Math.max(retirementAge, Math.round(inputs.maxAge));
  const clampWindow = (v: number | null, lo: number, hi: number) =>
    v == null ? v : Math.min(hi, Math.max(lo, Math.round(v)));
  const cppStartAge = clampWindow(inputs.cppStartAge, AXES.cppStartAge.min, AXES.cppStartAge.max);
  const oasStartAge = clampWindow(inputs.oasStartAge, AXES.oasStartAge.min, AXES.oasStartAge.max);
  if (
    retirementAge === inputs.retirementAge && maxAge === inputs.maxAge &&
    cppStartAge === inputs.cppStartAge && oasStartAge === inputs.oasStartAge
  ) {
    return inputs;
  }
  return { ...inputs, retirementAge, maxAge, cppStartAge, oasStartAge };
}

/** The result of reconciling a control to a sane state. */
export interface ReconciledControl {
  /** The value, held inside the crop. */
  value: number;
  /** The crop, edges ordered and clamped into the rendered range, framing the value. */
  band: Band;
  /** The range the control renders over (floored/grown for the plan). */
  range: AxisRange;
}

/**
 * RECONCILER — drive one control to a sane state from whatever persisted/
 * edited mess it was in. The invariants it restores, in order:
 *
 *   1. range   = the axis floored/grown for the plan (retirement ≥ current age,
 *                savings ≥ locked RRSP+TFSA, grows past a too-big value).
 *   2. value   = the axis value clamped INTO that range (so an out-of-range
 *                plan value is first brought onto the track).
 *   3. crop    = edges ordered, snapped, and clamped into the range — so a stale
 *                edge persisted outside the track is dropped to the range edge
 *                (this is what frees a knob that was stuck against a min edge
 *                sitting to its right).
 *   4. framing = the crop is widened to CONTAIN the value (never inverted).
 *
 * After reconcile, `range.min ≤ crop.min ≤ value ≤ crop.max ≤ range.max` always
 * holds, so the knob renders inside its crop and can drag to both edges.
 */
export function reconcileControl(axis: EqAxis, inputs: RetirementInputs, band: Band): ReconciledControl {
  const round = (v: number) => (INT_AXES.has(axis) ? Math.round(v) : v);
  const raw = axisValue(inputs, axis);
  const range = renderRange(axis, raw, inputs);
  const clampR = (v: number) => Math.min(range.max, Math.max(range.min, round(v)));
  // (2) value into the range.
  const value = clampR(raw);
  // (3) crop edges ordered + clamped into the range.
  let lo = clampR(Math.min(band.min, band.max));
  let hi = clampR(Math.max(band.min, band.max));
  // (4) frame the value.
  if (value < lo) lo = value;
  if (value > hi) hi = value;
  return { value, band: { min: lo, max: hi }, range };
}

// ---------------------------------------------------------------------------
// Deterministic outcome (drives the readout cards)
// ---------------------------------------------------------------------------

/** Deterministic outcome of one plan run (no Monte Carlo). */
export interface DeterministicOutcome {
  /** Age the money runs out; null = funded to max age. */
  depletionAge: number | null;
  /** Ending balance at max age (0 if depleted). */
  endingBalance: number;
  status: 'ON_TRACK' | 'SHORTFALL';
}

/** Run the deterministic engine once and reduce to the readout-relevant outcome. */
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
