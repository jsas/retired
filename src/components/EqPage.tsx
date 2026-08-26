// The steering surface: a goals-level equalizer over the plan. Each control is
// a double-slider that sets an allowed band (min–max); the control's value
// thumb stays inside its band. The XY pad lets you drag retirement-age ×
// spending together, shaded by where the plan meets a reference success rate.
//
// Bands are enforced synchronously (clampToBand). The success-rate readout and
// the pad's feasibility shading come from the EQ worker (runEqSolver), scored
// against one seeded batch of futures so they stay stable while dragging.
import { Sliders, Loader2 } from 'lucide-react';
import type { ProjectionResults, RetirementInputs, YearlyBreakdown } from '../lib/retirementEngine';
import { TimelineChart } from './TimelineChart';
import type { AppConfig } from '../lib/appConfig';
import {
  AXES, axisValue, withAxis, clampToBand, normalizeBand, effectiveRange, deterministicOutcome, fullBand,
  type EqAxis, type Band,
} from '../lib/eqConstraints';

const fmtMoney = (v: number) =>
  new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 }).format(v);

/** Readout + shading handed down from App (from the EQ worker). */
export interface EqSolvedState {
  successRate: number | null;
  grid: boolean[] | null;
  gridSize: number;
  solving: boolean;
}

export type Bands = Record<EqAxis, Band>;

/** Every control starts unconstrained (band disabled = full axis range). */
export function defaultBands(): Bands {
  return {
    desiredSpending: fullBand('desiredSpending'),
    retirementAge: fullBand('retirementAge'),
    investmentReturn: fullBand('investmentReturn'),
    maxAge: fullBand('maxAge'),
    annualSavings: fullBand('annualSavings'),
    returnVolatility: fullBand('returnVolatility'),
    cppStartAge: fullBand('cppStartAge'),
  };
}

// ---------------------------------------------------------------------------
// Outcome goals — targets on the plan's RESULT (not a control). When enabled a
// goal tints its readout green (met) / red (missed); the success-rate goal also
// sets the pad's shading threshold, so the green region is exactly "meets my goal".
// ---------------------------------------------------------------------------
export interface EqGoals {
  /** Money must stay funded to at least this age. */
  moneyLastsAge: { value: number; enabled: boolean };
  /** Success rate must reach at least this fraction (0..1). */
  successRate: { value: number; enabled: boolean };
  /** Leave at least this much at the end (deterministic ending balance). */
  legacyFloor: { value: number; enabled: boolean };
}

export function defaultGoals(): EqGoals {
  return {
    moneyLastsAge: { value: 90, enabled: false },
    successRate: { value: 0.9, enabled: false },
    legacyFloor: { value: 0, enabled: false },
  };
}

export interface EqPageProps {
  inputs: RetirementInputs;
  config: AppConfig;
  onChange: (inputs: RetirementInputs) => void;
  bands: Bands;
  onBandsChange: (b: Bands) => void;
  goals: EqGoals;
  onGoalsChange: (g: EqGoals) => void;
  solved: EqSolvedState;
  /** Live projection to show under the controls as a visual aid (optional). */
  projection?: { results: ProjectionResults; breakdown: YearlyBreakdown[] };
}

// ---------------------------------------------------------------------------
// RangeFader — a double-slider: two thumbs set the allowed band (min–max), the
// control's value thumb moves within the band. Toggle the band on/off to pin
// the control or let it roam the full axis.
// ---------------------------------------------------------------------------
function RangeFader({ axis, inputs, band, onBand, onChange }: {
  axis: EqAxis;
  inputs: RetirementInputs;
  band: Band;
  onBand: (b: Band) => void;
  onChange: (inputs: RetirementInputs) => void;
}) {
  const spec = AXES[axis];
  const value = axisValue(inputs, axis);
  const range = effectiveRange(axis, band);
  const n = normalizeBand(axis, band);

  const setValue = (raw: number) => onChange(withAxis(inputs, axis, clampToBand(axis, band, raw)));

  // Engaging "limit" starts the band at the middle of the axis (20% in from
  // each end) — a visible, useful range — and pulls the value inside it. The
  // user then tightens or widens with the min/max thumbs. (Starting from the
  // full-axis band made "limit" a no-op.)
  const toggleLimit = () => {
    if (band.enabled) {
      onBand({ ...n, enabled: false });
    } else {
      const span = spec.max - spec.min;
      const next = normalizeBand(axis, {
        min: spec.min + span * 0.2,
        max: spec.max - span * 0.2,
        enabled: true,
      });
      onBand(next);
      onChange(withAxis(inputs, axis, clampToBand(axis, next, value)));
    }
  };

  // Move a band edge; keep it ordered and inside the axis, and pull the value
  // into the new band if the edge swept past it. (The band can collapse to a
  // single point if the user drags the edges together — that's a hard pin.)
  const setEdge = (edge: 'min' | 'max', raw: number) => {
    const clamped = edge === 'min' ? Math.min(raw, n.max) : Math.max(raw, n.min);
    const next = normalizeBand(axis, { ...n, [edge]: clamped });
    onBand(next);
    onChange(withAxis(inputs, axis, clampToBand(axis, next, value)));
  };

  // Band highlight as fractions of the full axis for the track overlay.
  const loF = (range.min - spec.min) / (spec.max - spec.min);
  const hiF = (range.max - spec.min) / (spec.max - spec.min);

  return (
    <div className={`bg-white border rounded p-2.5 ${band.enabled ? 'border-blue-300' : 'border-slate-200'}`}>
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold text-slate-700">{spec.label}</span>
          <button
            onClick={toggleLimit}
            title={band.enabled ? 'Remove the limit — this control can move freely' : 'Limit this control to a range (starts at the middle of the scale; drag the edges below)'}
            className={`text-[10px] px-1.5 py-0.5 rounded border ${band.enabled ? 'border-blue-500 text-blue-700 bg-blue-50' : 'border-slate-300 text-slate-500 hover:bg-slate-50'}`}
          >
            {band.enabled ? 'limited' : 'limit'}
          </button>
        </div>
        <span className="text-sm font-semibold text-slate-900">{spec.format(value)}</span>
      </div>

      {/* value thumb (clamped into the band) */}
      <input
        type="range"
        min={range.min} max={range.max} step={spec.step} value={value}
        onChange={e => setValue(Number(e.target.value))}
        className="w-full accent-blue-600"
      />

      {/* band edges (only when limited) */}
      {band.enabled && (
        <div className="mt-1.5 pt-1.5 border-t border-slate-100">
          <div className="relative h-5">
            {/* band highlight */}
            <div
              className="absolute top-1/2 -translate-y-1/2 h-1.5 rounded bg-blue-200"
              style={{ left: `${loF * 100}%`, width: `${(hiF - loF) * 100}%` }}
            />
            {/* min edge */}
            <input
              type="range" aria-label="minimum"
              min={spec.min} max={spec.max} step={spec.step} value={n.min}
              onChange={e => setEdge('min', Number(e.target.value))}
              className="absolute inset-0 w-full appearance-none bg-transparent pointer-events-none band-thumb"
            />
            {/* max edge */}
            <input
              type="range" aria-label="maximum"
              min={spec.min} max={spec.max} step={spec.step} value={n.max}
              onChange={e => setEdge('max', Number(e.target.value))}
              className="absolute inset-0 w-full appearance-none bg-transparent pointer-events-none band-thumb"
            />
          </div>
          <div className="flex items-center justify-between text-[10px] text-slate-500 mt-0.5">
            <span>at least <span className="font-medium text-slate-700">{spec.format(n.min)}</span></span>
            <span>at most <span className="font-medium text-slate-700">{spec.format(n.max)}</span></span>
          </div>
        </div>
      )}

      {!band.enabled && (
        <div className="flex items-center justify-between text-[10px] text-slate-400 mt-0.5">
          <span>{spec.format(spec.min)}</span>
          <span>{spec.format(spec.max)}</span>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// XY pad — drag the handle to move both axes at once; each clamps into its
// band. When an axis is limited, the allowed rectangle shows with DRAGGABLE
// corners: grab a corner to resize that axis's band (or both, diagonally).
// The plane is shaded by where the plan meets a reference success rate.
// ---------------------------------------------------------------------------
function XyPad({ xAxis, yAxis, xLabel, yLabel, inputs, bands, onBandsChange, solved, onChange, targetRate }: {
  xAxis: EqAxis;
  yAxis: EqAxis;
  xLabel: string;
  yLabel: string;
  inputs: RetirementInputs;
  bands: Bands;
  onBandsChange: (b: Bands) => void;
  solved: EqSolvedState;
  onChange: (inputs: RetirementInputs) => void;
  /** Success-rate threshold the shading represents (for the caption). */
  targetRate: number;
}) {
  const xSpec = AXES[xAxis];
  const ySpec = AXES[yAxis];
  const G = solved.gridSize;
  const xRange = effectiveRange(xAxis, bands[xAxis]);
  const yRange = effectiveRange(yAxis, bands[yAxis]);
  const point = { x: axisValue(inputs, xAxis), y: axisValue(inputs, yAxis) };

  const apply = (raw: { x: number; y: number }) => {
    const x = clampToBand(xAxis, bands[xAxis], raw.x);
    const y = clampToBand(yAxis, bands[yAxis], raw.y);
    onChange(withAxis(withAxis(inputs, xAxis, x), yAxis, y));
  };

  const toFracX = (x: number) => (x - xSpec.min) / (xSpec.max - xSpec.min);
  const toFracY = (y: number) => 1 - (y - ySpec.min) / (ySpec.max - ySpec.min);

  // Pointer position → axis values.
  const fromPointer = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const fx = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const fy = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
    return {
      x: xSpec.min + fx * (xSpec.max - xSpec.min),
      y: ySpec.min + (1 - fy) * (ySpec.max - ySpec.min),
    };
  };

  // Move the point (background drag).
  const onDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.buttons !== 1 && e.type !== 'pointerdown') return;
    apply(fromPointer(e));
  };

  // Resize the band rectangle from a corner. minSide = drags the min edge
  // (left/bottom); maxSide = drags the max edge (right/top). The dragged value
  // may cross the opposite edge — normalizeBand re-orders, so you can sweep a
  // corner across the box to flip which edge you're holding.
  const setBandEdge = (axis: EqAxis, side: 'min' | 'max', raw: number) => {
    const band = bands[axis];
    const next = normalizeBand(axis, { ...band, [side]: raw, enabled: true });
    onBandsChange({ ...bands, [axis]: next });
  };

  const cornerDrag = (xSide: 'min' | 'max' | null, ySide: 'min' | 'max' | null) => (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const pad = (e.currentTarget as HTMLElement).parentElement as HTMLElement;
    const move = (ev: PointerEvent) => {
      const rect = pad.getBoundingClientRect();
      const fx = Math.min(1, Math.max(0, (ev.clientX - rect.left) / rect.width));
      const fy = Math.min(1, Math.max(0, (ev.clientY - rect.top) / rect.height));
      if (xSide) setBandEdge(xAxis, xSide, xSpec.min + fx * (xSpec.max - xSpec.min));
      if (ySide) setBandEdge(yAxis, ySide, ySpec.min + (1 - fy) * (ySpec.max - ySpec.min));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const xLimited = bands[xAxis].enabled;
  const yLimited = bands[yAxis].enabled;
  const anyLimit = xLimited || yLimited;

  // Corner handles sit on the band rectangle's corners. A corner only controls
  // the axes that are limited (an unlimited axis has no edge to grab).
  const corners: Array<{ xSide: 'min' | 'max' | null; ySide: 'min' | 'max' | null; cx: number; cy: number }> = [];
  if (anyLimit) {
    const xs: Array<'min' | 'max' | null> = xLimited ? ['min', 'max'] : [null];
    const ys: Array<'min' | 'max' | null> = yLimited ? ['min', 'max'] : [null];
    for (const xSide of xs) {
      for (const ySide of ys) {
        const cx = xSide === null ? toFracX(point.x) : toFracX(xSide === 'min' ? xRange.min : xRange.max);
        const cy = ySide === null ? toFracY(point.y) : toFracY(ySide === 'min' ? yRange.min : yRange.max);
        corners.push({ xSide, ySide, cx, cy });
      }
    }
  }

  return (
    <div className="bg-white border border-slate-200 rounded p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] font-semibold text-slate-700">{xLabel} × {yLabel}</span>
        <span className="text-xs font-semibold text-slate-900">
          {xSpec.format(point.x)} · {ySpec.format(point.y)}
        </span>
      </div>

      <div
        className="relative w-full h-48 rounded bg-slate-50 border border-slate-200 overflow-hidden cursor-crosshair touch-none select-none"
        onPointerDown={onDrag}
        onPointerMove={onDrag}
      >
        {solved.grid && (
          <div className="absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${G},1fr)`, gridTemplateRows: `repeat(${G},1fr)` }}>
            {Array.from({ length: G * G }).map((_, i) => {
              const gx = i % G;
              const gy = Math.floor(i / G);
              const cell = solved.grid![(G - 1 - gy) * G + gx];
              return <div key={i} className={cell ? 'bg-emerald-100/50' : 'bg-red-100/40'} />;
            })}
          </div>
        )}

        {/* allowed rectangle */}
        {anyLimit && (
          <div
            className="absolute border-2 border-blue-400/60 bg-blue-100/10 pointer-events-none"
            style={{
              left: `${toFracX(xRange.min) * 100}%`,
              top: `${toFracY(yRange.max) * 100}%`,
              width: `${(toFracX(xRange.max) - toFracX(xRange.min)) * 100}%`,
              height: `${(toFracY(yRange.min) - toFracY(yRange.max)) * 100}%`,
            }}
          />
        )}

        <span className="absolute left-1 bottom-0.5 text-[9px] text-slate-400">{xSpec.format(xSpec.min)}</span>
        <span className="absolute right-1 bottom-0.5 text-[9px] text-slate-400">{xSpec.format(xSpec.max)}</span>
        <span className="absolute left-1 top-0.5 text-[9px] text-slate-400">{ySpec.format(ySpec.max)}</span>
        <span className="absolute left-1 bottom-4 text-[9px] text-slate-400">{ySpec.format(ySpec.min)}</span>

        {/* corner resize handles (draggable) */}
        {corners.map((c, i) => (
          <div
            key={i}
            onPointerDown={cornerDrag(c.xSide, c.ySide)}
            className="absolute w-3.5 h-3.5 -ml-[7px] -mt-[7px] rounded-sm border-2 border-white bg-blue-500 shadow cursor-nwse-resize hover:bg-blue-600"
            style={{ left: `${c.cx * 100}%`, top: `${c.cy * 100}%` }}
            title="Drag to resize the allowed range"
          />
        ))}

        <div
          className="absolute w-4 h-4 -ml-2 -mt-2 rounded-full border-2 border-white bg-blue-600 shadow pointer-events-none"
          style={{ left: `${toFracX(point.x) * 100}%`, top: `${toFracY(point.y) * 100}%` }}
        />
      </div>

      <div className="text-[10px] text-slate-400 mt-1">
        drag to explore the trade-off — the shaded region meets a {Math.round(targetRate * 100)}% success rate{anyLimit ? ' · drag a corner to resize the range' : ''}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// GoalCard — a READOUT (not a knob). It shows a live outcome; an optional goal
// tints it green (met) / red (missed). The target is edited with small − / +
// steppers, not a slider, so the card is never confused for an input.
// ---------------------------------------------------------------------------
function GoalCard({ label, value, suffix, met, solving, goal, onToggle, onValue, min, max, step, format, alwaysColored }: {
  label: string;
  value: string;
  suffix?: string;
  met: boolean;
  solving?: boolean;
  goal?: { value: number; enabled: boolean };
  onToggle?: () => void;
  onValue?: (v: number) => void;
  min?: number; max?: number; step?: number;
  format?: (v: number) => string;
  alwaysColored?: boolean;
}) {
  const active = alwaysColored || (goal?.enabled ?? false);
  const tint = !active
    ? 'border-slate-200 bg-white'
    : met ? 'border-emerald-300 bg-emerald-50/40' : 'border-red-300 bg-red-50/40';
  const valueColor = !active ? 'text-slate-900' : met ? 'text-emerald-700' : 'text-red-700';

  const canStep = goal?.enabled && onValue && format && min != null && max != null && step != null;
  const bump = (dir: 1 | -1) => {
    if (!goal || !onValue || min == null || max == null || step == null) return;
    onValue(Math.min(max, Math.max(min, goal.value + dir * step)));
  };

  return (
    <div className={`border rounded px-2.5 py-1.5 ${tint}`}>
      <div className="flex items-center justify-between">
        <div className="text-[9px] uppercase tracking-wider text-slate-500">{label}</div>
        {goal && onToggle && (
          <button
            type="button"
            onClick={onToggle}
            title={goal.enabled ? 'Remove this goal' : 'Set a goal — the card turns green/red, and a success goal re-shades the pad'}
            className={`text-[9px] px-1 rounded border ${goal.enabled ? 'border-blue-500 text-blue-700 bg-blue-50' : 'border-slate-300 text-slate-400 hover:bg-slate-50'}`}
          >
            {goal.enabled ? 'on' : 'goal'}
          </button>
        )}
      </div>
      <div className={`flex items-center gap-1 text-[13px] font-semibold ${valueColor}`}>
        {solving && <Loader2 size={12} className="animate-spin text-blue-500" aria-label="calculating" />}
        {value}{suffix ?? ''}
      </div>
      {canStep && (
        <div className="mt-0.5 flex items-center gap-1 text-[10px] text-slate-500">
          <span>at least</span>
          <button
            type="button" aria-label="lower goal"
            onClick={() => bump(-1)}
            className="w-4 h-4 leading-none rounded border border-slate-300 text-slate-500 hover:bg-slate-100"
          >−</button>
          <span className="font-medium text-slate-700 tabular-nums">{format(goal.value)}</span>
          <button
            type="button" aria-label="raise goal"
            onClick={() => bump(1)}
            className="w-4 h-4 leading-none rounded border border-slate-300 text-slate-500 hover:bg-slate-100"
          >+</button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------
export function EqPage({ inputs, config, onChange, bands, onBandsChange, goals, onGoalsChange, solved, projection }: EqPageProps) {
  const o = deterministicOutcome(inputs, config);
  const setBand = (axis: EqAxis) => (b: Band) => onBandsChange({ ...bands, [axis]: b });

  return (
    <div className="max-w-4xl">
      <div className="flex items-center gap-2 mb-1">
        <Sliders size={18} className="text-blue-600" />
        <h2 className="text-lg font-bold text-slate-900">Steer the plan</h2>
        <span className="text-[10px] uppercase tracking-wider text-slate-400 border border-slate-200 rounded px-1.5 py-0.5">experimental</span>
      </div>
      <p className="text-xs text-slate-500 mb-3 leading-snug max-w-2xl">
        Push the sliders or drag the pad to explore your plan — the readouts update live.
        Use <strong>limit</strong> on any control to hold it within a range (at least / at most)
        while you adjust the rest.
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 items-start mb-3">
        {/* sliders flow 1→2→3 columns so more fit above the fold */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <RangeFader axis="desiredSpending" inputs={inputs} band={bands.desiredSpending} onBand={setBand('desiredSpending')} onChange={onChange} />
          <RangeFader axis="retirementAge" inputs={inputs} band={bands.retirementAge} onBand={setBand('retirementAge')} onChange={onChange} />
          <RangeFader axis="investmentReturn" inputs={inputs} band={bands.investmentReturn} onBand={setBand('investmentReturn')} onChange={onChange} />
          <RangeFader axis="annualSavings" inputs={inputs} band={bands.annualSavings} onBand={setBand('annualSavings')} onChange={onChange} />
          <RangeFader axis="maxAge" inputs={inputs} band={bands.maxAge} onBand={setBand('maxAge')} onChange={onChange} />
          <RangeFader axis="returnVolatility" inputs={inputs} band={bands.returnVolatility} onBand={setBand('returnVolatility')} onChange={onChange} />
          <RangeFader axis="cppStartAge" inputs={inputs} band={bands.cppStartAge} onBand={setBand('cppStartAge')} onChange={onChange} />
        </div>
        <div className="space-y-3">
          <XyPad
            xAxis="retirementAge" yAxis="desiredSpending"
            xLabel="Retirement age" yLabel="spending"
            inputs={inputs} bands={bands} onBandsChange={onBandsChange}
            solved={solved} onChange={onChange}
            targetRate={goals.successRate.enabled ? goals.successRate.value : 0.9}
          />
          {/* goal readouts — tint green when the goal is met, red when missed */}
          <div className="grid grid-cols-2 gap-2">
            <GoalCard
              label="Status"
              value={o.status === 'ON_TRACK' ? 'On track' : 'Shortfall'}
              met={o.status === 'ON_TRACK'}
              alwaysColored
            />
            <GoalCard
              label="Money lasts to"
              value={`${o.depletionAge ?? inputs.maxAge}`}
              goal={goals.moneyLastsAge}
              onToggle={() => onGoalsChange({ ...goals, moneyLastsAge: { ...goals.moneyLastsAge, enabled: !goals.moneyLastsAge.enabled } })}
              onValue={(v) => onGoalsChange({ ...goals, moneyLastsAge: { value: v, enabled: true } })}
              met={o.depletionAge === null || o.depletionAge >= goals.moneyLastsAge.value}
              min={inputs.retirementAge} max={inputs.maxAge} step={1}
              format={(v) => `${Math.round(v)}`}
              suffix={o.depletionAge === null ? '+' : ''}
            />
            <GoalCard
              label="Success rate"
              value={solved.successRate == null ? '—' : `${(solved.successRate * 100).toFixed(0)}%`}
              solving={solved.solving}
              goal={goals.successRate}
              onToggle={() => onGoalsChange({ ...goals, successRate: { ...goals.successRate, enabled: !goals.successRate.enabled } })}
              onValue={(v) => onGoalsChange({ ...goals, successRate: { value: v, enabled: true } })}
              met={solved.successRate != null && solved.successRate >= goals.successRate.value - 1e-9}
              min={0.5} max={1} step={0.05}
              format={(v) => `${Math.round(v * 100)}%`}
            />
            <GoalCard
              label="Left at end"
              value={fmtMoney(o.endingBalance)}
              goal={goals.legacyFloor}
              onToggle={() => onGoalsChange({ ...goals, legacyFloor: { ...goals.legacyFloor, enabled: !goals.legacyFloor.enabled } })}
              onValue={(v) => onGoalsChange({ ...goals, legacyFloor: { value: v, enabled: true } })}
              met={o.endingBalance >= goals.legacyFloor.value}
              min={0} max={1000000} step={10000}
              format={fmtMoney}
            />
          </div>
        </div>
      </div>

      {/* Live projection under the controls — the visual aid while steering. */}
      {projection && (
        <div className="mt-3 bg-white border border-slate-200 rounded p-3">
          <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-2">Projection timeline</div>
          <TimelineChart
            inputs={inputs}
            results={{ ...projection.results, yearlyBreakdown: projection.breakdown }}
            config={config}
            onChange={onChange}
          />
        </div>
      )}
    </div>
  );
}
