// The steering surface: a goals-level equalizer over the plan. Each control is
// a double-slider that sets an allowed band (min–max); the control's value
// thumb stays inside its band. The XY pad lets you drag retirement-age ×
// spending together, shaded by where the plan meets a reference success rate.
//
// Bands are enforced synchronously (clampToBand). The success-rate readout and
// the pad's feasibility shading come from the EQ worker (runEqSolver), scored
// against one seeded batch of futures so they stay stable while dragging.
import { useEffect, useRef } from 'react';
import { Sliders, Loader2 } from 'lucide-react';
import type { RetirementResults, RetirementInputs, YearlyBreakdown } from '../lib/retirementEngine';
import { TimelineChart } from './TimelineChart';
import type { AppConfig } from '../lib/appConfig';
import {
  AXES, axisValue, withAxis, clampToBand, normalizeBand, effectiveRange, deterministicOutcome, isLimited,
  renderRange, INT_AXES,
  type EqAxis, type Band,
} from '../lib/eqConstraints';

const fmtMoney = (v: number) =>
  new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 }).format(v);

/** Readout + shading handed down from App (from the EQ worker). */
export interface EqSolvedState {
  successRate: number | null;
  /** Row-major success-rate grid (bottom-up in y); null until first solve. */
  grid: number[] | null;
  gridSize: number;
  solving: boolean;
}

export type Bands = Record<EqAxis, Band>;

export interface EqPageProps {
  inputs: RetirementInputs;
  config: AppConfig;
  onChange: (inputs: RetirementInputs) => void;
  bands: Bands;
  onBandsChange: (b: Bands) => void;
  solved: EqSolvedState;
  /** Live projection to show under the controls as a visual aid (optional). */
  projection?: { results: RetirementResults; breakdown: YearlyBreakdown[] };
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
  const n = normalizeBand(axis, band); // the crop [min,max]
  const limited = isLimited(axis, band);

  // The range actually RENDERED: the axis, floored at the plan's logical min
  // (retirement ≥ current age, savings ≥ locked RRSP+TFSA) and grown in
  // whole-axis steps when the value exceeds the axis max.
  const range = renderRange(axis, value, inputs);
  const span = range.max - range.min;

  const trackRef = useRef<HTMLDivElement>(null);

  // The value knob moves inside the crop [n.min, n.max].
  const setValue = (raw: number) => onChange(withAxis(inputs, axis, clampToBand(axis, band, raw)));

  // Drag a crop edge. The edge can't cross the opposite edge. The value only
  // moves when the crop actually EXCLUDES it (the edge swept past it) — it is
  // NOT dragged along on every edge move, so the knob stays put while you fence.
  // Edges may ride the grown range (past the base axis max) while it's grown.
  const setEdge = (edge: 'min' | 'max', raw: number) => {
    const clamped = Math.min(range.max, Math.max(range.min, raw));
    const snapped = INT_AXES.has(axis) ? Math.round(clamped) : clamped;
    const bounded = edge === 'min' ? Math.min(snapped, n.max) : Math.max(snapped, n.min);
    const next = normalizeBand(axis, { ...n, [edge]: bounded });
    onBand(next);
    if (value < next.min || value > next.max) {
      onChange(withAxis(inputs, axis, clampToBand(axis, next, value)));
    }
  };

  // The value knob is a CUSTOM pointer-dragged control, not a third range
  // input — stacking three native inputs breaks the middle one's hit-area (the
  // edge inputs paint over it and steal its pointer events). Dragging maps the
  // pointer's x to an axis value, clamped into the crop.
  const onValuePointer = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const track = trackRef.current;
    if (!track) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const rect = track.getBoundingClientRect();
      const f = Math.min(1, Math.max(0, (ev.clientX - rect.left) / rect.width));
      setValue(range.min + f * span);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // Track fractions for the crop highlight (the selected region between edges).
  // Clamped into [0,1]: a persisted crop edge past the grown range pins to the
  // track end rather than rendering out of bounds.
  const loF = Math.min(1, Math.max(0, (n.min - range.min) / span));
  const hiF = Math.min(1, Math.max(0, (n.max - range.min) / span));
  const valF = Math.min(1, Math.max(0, (value - range.min) / span));

  return (
    <div className={`bg-white border rounded p-2.5 ${limited ? 'border-blue-300' : 'border-slate-200'}`}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[11px] font-semibold text-slate-700">{spec.label}</span>
        <span className="text-sm font-semibold text-slate-900">{spec.format(value)}</span>
      </div>

      {/* One track: two native edge thumbs + a custom value knob on top. */}
      <div ref={trackRef} className="relative h-6">
        {/* base track */}
        <div className="absolute top-1/2 -translate-y-1/2 left-0 right-0 h-1.5 rounded bg-slate-200" />
        {/* selected crop region */}
        <div
          className="absolute top-1/2 -translate-y-1/2 h-1.5 rounded bg-blue-200"
          style={{ left: `${loF * 100}%`, width: `${(hiF - loF) * 100}%` }}
        />
        {/* min crop edge (native thumb, small) */}
        <input
          type="range" aria-label={`${spec.label} minimum`}
          min={spec.min} max={spec.max} step={spec.step} value={n.min}
          onChange={e => setEdge('min', Number(e.target.value))}
          className="absolute inset-0 w-full appearance-none bg-transparent pointer-events-none band-thumb"
        />
        {/* max crop edge (native thumb, small) */}
        <input
          type="range" aria-label={`${spec.label} maximum`}
          min={spec.min} max={spec.max} step={spec.step} value={n.max}
          onChange={e => setEdge('max', Number(e.target.value))}
          className="absolute inset-0 w-full appearance-none bg-transparent pointer-events-none band-thumb"
        />
        {/* value knob — custom drag, rendered above the edges so it's grabbable */}
        <div
          role="slider"
          aria-label={spec.label}
          aria-valuemin={n.min} aria-valuemax={n.max} aria-valuenow={value}
          tabIndex={0}
          onPointerDown={onValuePointer}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); setValue(value - spec.step); }
            if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); setValue(value + spec.step); }
          }}
          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-4 h-4 rounded-full bg-blue-600 border-2 border-white shadow cursor-grab active:cursor-grabbing touch-none"
          style={{ left: `${valF * 100}%` }}
        />
      </div>

      <div className="flex items-center justify-between text-[10px] text-slate-500 mt-0.5">
        <span>at least <span className="font-medium text-slate-700">{spec.format(n.min)}</span></span>
        <span>at most <span className="font-medium text-slate-700">{spec.format(n.max)}</span></span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// XY pad — drag the handle to move both axes at once; each clamps into its
// band. When an axis is limited, the allowed rectangle shows with DRAGGABLE
// corners: grab a corner to resize that axis's band (or both, diagonally).
// The plane is shaded by where the plan meets a reference success rate.
// ---------------------------------------------------------------------------
function XyPad({ xAxis, yAxis, xLabel, yLabel, inputs, bands, onBandsChange, solved, onChange }: {
  xAxis: EqAxis;
  yAxis: EqAxis;
  xLabel: string;
  yLabel: string;
  inputs: RetirementInputs;
  bands: Bands;
  onBandsChange: (b: Bands) => void;
  solved: EqSolvedState;
  onChange: (inputs: RetirementInputs) => void;
}) {
  const xSpec = AXES[xAxis];
  const ySpec = AXES[yAxis];
  const G = solved.gridSize;
  const point = { x: axisValue(inputs, xAxis), y: axisValue(inputs, yAxis) };
  // RENDERED axis ranges grow to fit the point; the crop (allowed rectangle)
  // frames it too, so both always render in-bounds.
  const xView = renderRange(xAxis, point.x, inputs);
  const yView = renderRange(yAxis, point.y, inputs);
  const xRange = effectiveRange(xAxis, bands[xAxis]);
  const yRange = effectiveRange(yAxis, bands[yAxis]);

  const apply = (raw: { x: number; y: number }) => {
    const x = clampToBand(xAxis, bands[xAxis], raw.x);
    const y = clampToBand(yAxis, bands[yAxis], raw.y);
    onChange(withAxis(withAxis(inputs, xAxis, x), yAxis, y));
  };

  // Fractions are clamped into [0,1] — the grown view always contains the point
  // and the framing crop, but a stale crop edge can't push the rect off-screen.
  const toFracX = (x: number) => Math.min(1, Math.max(0, (x - xView.min) / (xView.max - xView.min)));
  const toFracY = (y: number) => Math.min(1, Math.max(0, 1 - (y - yView.min) / (yView.max - yView.min)));

  // Pointer position → axis values.
  const fromPointer = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const fx = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const fy = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
    return {
      x: xView.min + fx * (xView.max - xView.min),
      y: yView.min + (1 - fy) * (yView.max - yView.min),
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
    const next = normalizeBand(axis, { ...band, [side]: raw });
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
      if (xSide) setBandEdge(xAxis, xSide, xView.min + fx * (xView.max - xView.min));
      if (ySide) setBandEdge(yAxis, ySide, yView.min + (1 - fy) * (yView.max - yView.min));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const xLimited = isLimited(xAxis, bands[xAxis]);
  const yLimited = isLimited(yAxis, bands[yAxis]);
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
        {/* smooth success-rate gradient (bilinear-interpolated between nodes) */}
        {solved.grid && <GradientCanvas grid={solved.grid} size={G} />}

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

        <span className="absolute left-1 bottom-0.5 text-[9px] text-slate-400">{xSpec.format(xView.min)}</span>
        <span className="absolute right-1 bottom-0.5 text-[9px] text-slate-400">{xSpec.format(xView.max)}</span>
        <span className="absolute left-1 top-0.5 text-[9px] text-slate-400">{ySpec.format(yView.max)}</span>
        <span className="absolute left-1 bottom-4 text-[9px] text-slate-400">{ySpec.format(yView.min)}</span>

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

        {/* corner spinner while the grid re-solves */}
        {solved.solving && (
          <Loader2 size={14} className="absolute right-1.5 top-1.5 animate-spin text-blue-500" aria-label="recalculating" />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// GradientCanvas — renders the success-rate grid as a SMOOTH red→yellow→green
// gradient. Each pixel bilinearly interpolates the rate of the four surrounding
// grid nodes, then maps that rate to a color. This is the elegant version of
// per-cell tinting: continuous instead of blocky, and it tolerates the rare
// non-monotonic wobble in the grid. One canvas redraw per grid update.
// ---------------------------------------------------------------------------

// Success-rate reference where the gradient crosses from red to green.
const GRADIENT_TARGET = 0.9;

/** Map a success rate (0..1) to an [r,g,b] color: red below target → yellow at
 *  target → green above. Slightly saturated for readability. */
function rateColor(rate: number): [number, number, number] {
  // Anchors: deep red (0%), amber-yellow (target), rich green (100%).
  const RED: [number, number, number] = [220, 60, 54];
  const YELLOW: [number, number, number] = [233, 196, 72];
  const GREEN: [number, number, number] = [34, 158, 92];
  const lerp = (a: [number, number, number], b: [number, number, number], t: number): [number, number, number] => [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
  if (rate <= GRADIENT_TARGET) {
    // 0 → target maps red → yellow.
    const t = Math.min(1, Math.max(0, rate / GRADIENT_TARGET));
    return lerp(RED, YELLOW, t);
  }
  // target → 1 maps yellow → green.
  const t = Math.min(1, Math.max(0, (rate - GRADIENT_TARGET) / (1 - GRADIENT_TARGET)));
  return lerp(YELLOW, GREEN, t);
}

function GradientCanvas({ grid, size }: { grid: number[]; size: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const W = canvas.width;
    const H = canvas.height;
    const img = ctx.createImageData(W, H);
    const G = size;
    // Bilinear sample of the grid at fractional node coords (fx, fy in [0, G-1]).
    const sample = (fx: number, fy: number) => {
      const x0 = Math.min(G - 1, Math.max(0, Math.floor(fx)));
      const y0 = Math.min(G - 1, Math.max(0, Math.floor(fy)));
      const x1 = Math.min(G - 1, x0 + 1);
      const y1 = Math.min(G - 1, y0 + 1);
      const tx = Math.min(1, Math.max(0, fx - x0));
      const ty = Math.min(1, Math.max(0, fy - y0));
      const v00 = grid[y0 * G + x0], v10 = grid[y0 * G + x1];
      const v01 = grid[y1 * G + x0], v11 = grid[y1 * G + x1];
      const top = v00 + (v10 - v00) * tx;
      const bot = v01 + (v11 - v01) * tx;
      return top + (bot - top) * ty;
    };
    for (let py = 0; py < H; py++) {
      // Screen y is top-down; grid row 0 is the LOWEST y (bottom-up). Flip.
      const fy = (1 - py / (H - 1)) * (G - 1);
      for (let px = 0; px < W; px++) {
        const fx = (px / (W - 1)) * (G - 1);
        const [r, g, b] = rateColor(sample(fx, fy));
        const i = (py * W + px) * 4;
        img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }, [grid, size]);

  return <canvas ref={ref} width={220} height={160} className="absolute inset-0 w-full h-full" aria-hidden />;
}

// ---------------------------------------------------------------------------
// ReadoutCard — a pure readout of a live plan outcome (not a knob, no goals).
// `tone` tints it: good=emerald, warn=amber, bad=red, neutral=plain.
// ---------------------------------------------------------------------------
function ReadoutCard({ label, value, tone, solving }: {
  label: string;
  value: string;
  tone: 'good' | 'warn' | 'bad' | 'neutral';
  solving?: boolean;
}) {
  const tint = tone === 'good' ? 'border-emerald-300 bg-emerald-50/40'
    : tone === 'warn' ? 'border-amber-300 bg-amber-50/40'
    : tone === 'bad' ? 'border-red-300 bg-red-50/40'
    : 'border-slate-200 bg-white';
  const valueColor = tone === 'good' ? 'text-emerald-700'
    : tone === 'warn' ? 'text-amber-700'
    : tone === 'bad' ? 'text-red-700'
    : 'text-slate-900';

  return (
    <div className={`border rounded px-2.5 py-1.5 ${tint}`}>
      <div className="text-[9px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className={`flex items-center gap-1 text-[13px] font-semibold ${valueColor}`}>
        {solving && <Loader2 size={12} className="animate-spin text-blue-500" aria-label="calculating" />}
        {value}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------
export function EqPage({ inputs, config, onChange, bands, onBandsChange, solved, projection }: EqPageProps) {
  const o = deterministicOutcome(inputs, config);
  const setBand = (axis: EqAxis) => (b: Band) => onBandsChange({ ...bands, [axis]: b });

  // The crop frames the value: if the plan value lands OUTSIDE a control's crop
  // (typed in the sidebar, dragged on the projection timeline, …), extend that
  // crop's edge to include it. One batched update, only when something is
  // actually out of frame — so no render loop.
  useEffect(() => {
    let changed = false;
    const next = { ...bands };
    for (const axis of Object.keys(AXES) as EqAxis[]) {
      const value = axisValue(inputs, axis);
      const band = bands[axis];
      const range = renderRange(axis, value, inputs);
      // Extend ONLY the edge the value actually crosses, clamped to the rendered
      // range — not normalizeBand(both edges), which would clamp a below-floor
      // crop min back up to the axis min and undo the plan's logical floor
      // (e.g. savings floor = locked RRSP+TFSA, retirement ≥ current age).
      let { min, max } = band;
      const round = (v: number) => INT_AXES.has(axis) ? Math.round(v) : v;
      const inRange = (v: number) => Math.min(range.max, Math.max(range.min, round(v)));
      if (value > max) max = inRange(value);
      else if (value < min) min = inRange(value);
      // A crop edge left BELOW the rendered floor (e.g. a fraction-persisted
      // crop saved before the range grew a floor) would render the whole track
      // selected and mis-frame the value. The value sits at the floor (it did
      // NOT cross it), so reset that edge up to the floor.
      if (min < range.min && value <= range.min) min = range.min;
      if (min !== band.min || max !== band.max) {
        next[axis] = { min, max };
        changed = true;
      }
    }
    if (changed) onBandsChange(next);
  }, [inputs, bands, onBandsChange]);

  return (
    <div className="max-w-4xl">
      <div className="flex items-center gap-2 mb-1">
        <Sliders size={18} className="text-blue-600" />
        <h2 className="text-lg font-bold text-slate-900">Steer the plan</h2>
      </div>
      <p className="text-xs text-slate-500 mb-3 leading-snug max-w-2xl">
        Push the sliders or drag the pad to explore your plan — the readouts update live.
        Drag a slider's edges to crop its range (at least / at most) while you adjust the rest.
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
          <RangeFader axis="oasStartAge" inputs={inputs} band={bands.oasStartAge} onBand={setBand('oasStartAge')} onChange={onChange} />
        </div>
        <div className="space-y-3">
          <XyPad
            xAxis="retirementAge" yAxis="desiredSpending"
            xLabel="Retirement age" yLabel="spending"
            inputs={inputs} bands={bands} onBandsChange={onBandsChange}
            solved={solved} onChange={onChange}
          />
          {/* live outcome readouts — pure readouts, no goals/steppers */}
          <div className="grid grid-cols-2 gap-2">
            <ReadoutCard label="Status" value={o.status === 'ON_TRACK' ? 'On track' : 'Shortfall'} tone={o.status === 'ON_TRACK' ? 'good' : 'bad'} />
            <ReadoutCard label="Money lasts to" value={`${o.depletionAge ?? inputs.maxAge}${o.depletionAge === null ? '+' : ''}`} tone={o.depletionAge === null ? 'good' : 'bad'} />
            <ReadoutCard
              label="Success rate"
              value={solved.successRate == null ? '—' : `${(solved.successRate * 100).toFixed(0)}%`}
              solving={solved.solving}
              tone={solved.successRate == null ? 'neutral' : solved.successRate >= 0.9 ? 'good' : solved.successRate >= 0.75 ? 'warn' : 'bad'}
            />
            <ReadoutCard label="Left at end" value={fmtMoney(o.endingBalance)} tone={o.endingBalance > 0 ? 'good' : 'neutral'} />
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
