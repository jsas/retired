// The steering surface: a goals-level equalizer over the plan. Each control is
// a double-slider that sets an allowed band (min–max); the control's value
// thumb stays inside its band. The XY pad lets you drag retirement-age ×
// spending together, shaded by where the plan meets a reference success rate.
//
// Bands are enforced synchronously (clampToBand). The success-rate readout and
// the pad's feasibility shading come from the EQ worker (runEqSolver), scored
// against one seeded batch of futures so they stay stable while dragging.
import { Sliders, Loader2 } from 'lucide-react';
import type { RetirementInputs } from '../lib/retirementEngine';
import type { AppConfig } from '../lib/appConfig';
import {
  AXES, axisValue, withAxis, clampToBand, normalizeBand, effectiveRange, deterministicOutcome,
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

export interface EqPageProps {
  inputs: RetirementInputs;
  config: AppConfig;
  onChange: (inputs: RetirementInputs) => void;
  bands: Bands;
  onBandsChange: (b: Bands) => void;
  solved: EqSolvedState;
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

  // Move a band edge; keep it ordered and inside the axis, and pull the value
  // into the new band if the edge swept past it.
  const setEdge = (edge: 'min' | 'max', raw: number) => {
    const next = normalizeBand(axis, { ...n, [edge]: raw });
    onBand(next);
    onChange(withAxis(inputs, axis, clampToBand(axis, next, value)));
  };

  // Band highlight as fractions of the full axis for the track overlay.
  const loF = (range.min - spec.min) / (spec.max - spec.min);
  const hiF = (range.max - spec.min) / (spec.max - spec.min);

  return (
    <div className={`bg-white border rounded p-3 ${band.enabled ? 'border-blue-300' : 'border-slate-200'}`}>
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold text-slate-700">{spec.label}</span>
          <button
            onClick={() => onBand({ ...n, enabled: !band.enabled })}
            title={band.enabled ? 'Remove the limit' : 'Limit this control to a range'}
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
              onChange={e => setEdge('min', Math.min(Number(e.target.value), n.max))}
              className="absolute inset-0 w-full appearance-none bg-transparent pointer-events-none band-thumb"
            />
            {/* max edge */}
            <input
              type="range" aria-label="maximum"
              min={spec.min} max={spec.max} step={spec.step} value={n.max}
              onChange={e => setEdge('max', Math.max(Number(e.target.value), n.min))}
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
// XY pad — retirement age (x) × annual spending (y). Drag the handle; both
// axes clamp into their bands. The plane is shaded by where the plan meets a
// reference success rate (from the worker grid).
// ---------------------------------------------------------------------------
function XyPad({ inputs, bands, solved, onChange }: {
  inputs: RetirementInputs;
  bands: Bands;
  solved: EqSolvedState;
  onChange: (inputs: RetirementInputs) => void;
}) {
  const xSpec = AXES.retirementAge;
  const ySpec = AXES.desiredSpending;
  const G = solved.gridSize;
  const xRange = effectiveRange('retirementAge', bands.retirementAge);
  const yRange = effectiveRange('desiredSpending', bands.desiredSpending);
  const point = { x: inputs.retirementAge, y: inputs.desiredSpending };

  const apply = (raw: { x: number; y: number }) => {
    const x = clampToBand('retirementAge', bands.retirementAge, raw.x);
    const y = clampToBand('desiredSpending', bands.desiredSpending, raw.y);
    onChange(withAxis(withAxis(inputs, 'retirementAge', x), 'desiredSpending', y));
  };

  const toFracX = (x: number) => (x - xSpec.min) / (xSpec.max - xSpec.min);
  const toFracY = (y: number) => 1 - (y - ySpec.min) / (ySpec.max - ySpec.min);

  const onDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.buttons !== 1 && e.type !== 'pointerdown') return;
    const rect = e.currentTarget.getBoundingClientRect();
    const fx = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const fy = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
    apply({
      x: xSpec.min + fx * (xSpec.max - xSpec.min),
      y: ySpec.min + (1 - fy) * (ySpec.max - ySpec.min),
    });
  };

  // The allowed rectangle as an overlay (when either axis is limited).
  const anyLimit = bands.retirementAge.enabled || bands.desiredSpending.enabled;

  return (
    <div className="bg-white border border-slate-200 rounded p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] font-semibold text-slate-700">Retirement age × spending</span>
        <span className="text-xs font-semibold text-slate-900">
          {Math.round(point.x)} · {fmtMoney(point.y)}
        </span>
      </div>

      <div
        className="relative w-full h-56 rounded bg-slate-50 border border-slate-200 overflow-hidden cursor-crosshair touch-none select-none"
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

        <span className="absolute left-1 bottom-0.5 text-[9px] text-slate-400">retire {xSpec.min}</span>
        <span className="absolute right-1 bottom-0.5 text-[9px] text-slate-400">retire {xSpec.max}</span>
        <span className="absolute left-1 top-0.5 text-[9px] text-slate-400">{fmtMoney(ySpec.max)}</span>
        <span className="absolute left-1 bottom-4 text-[9px] text-slate-400">{fmtMoney(ySpec.min)}</span>

        <div
          className="absolute w-4 h-4 -ml-2 -mt-2 rounded-full border-2 border-white bg-blue-600 shadow"
          style={{ left: `${toFracX(point.x) * 100}%`, top: `${toFracY(point.y) * 100}%` }}
        />
      </div>

      <div className="text-[10px] text-slate-400 mt-1">
        drag to explore the trade-off — the shaded region meets a 90% success rate
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------
export function EqPage({ inputs, config, onChange, bands, onBandsChange, solved }: EqPageProps) {
  const o = deterministicOutcome(inputs, config);
  const setBand = (axis: EqAxis) => (b: Band) => onBandsChange({ ...bands, [axis]: b });

  return (
    <div className="max-w-4xl">
      <div className="flex items-center gap-2 mb-1">
        <Sliders size={18} className="text-blue-600" />
        <h2 className="text-lg font-bold text-slate-900">Steer the plan</h2>
        <span className="text-[10px] uppercase tracking-wider text-slate-400 border border-slate-200 rounded px-1.5 py-0.5">experimental</span>
      </div>
      <p className="text-xs text-slate-500 mb-4 leading-snug max-w-2xl">
        Push the sliders or drag the pad to explore your plan — the readouts update live.
        Use <strong>limit</strong> on any control to hold it within a range (at least / at most)
        while you adjust the rest.
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start mb-4">
        <div className="space-y-3">
          <RangeFader axis="desiredSpending" inputs={inputs} band={bands.desiredSpending} onBand={setBand('desiredSpending')} onChange={onChange} />
          <RangeFader axis="retirementAge" inputs={inputs} band={bands.retirementAge} onBand={setBand('retirementAge')} onChange={onChange} />
          <RangeFader axis="investmentReturn" inputs={inputs} band={bands.investmentReturn} onBand={setBand('investmentReturn')} onChange={onChange} />
        </div>
        <XyPad inputs={inputs} bands={bands} solved={solved} onChange={onChange} />
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white border border-slate-200 rounded p-3">
          <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-0.5">Status</div>
          <div className={`text-sm font-semibold ${o.status === 'ON_TRACK' ? 'text-emerald-600' : 'text-amber-600'}`}>
            {o.status.replace('_', ' ')}
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded p-3">
          <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-0.5">Money lasts to</div>
          <div className="text-sm font-semibold text-slate-900">{o.depletionAge ?? `${inputs.maxAge}+`}</div>
        </div>
        <div className="bg-white border border-slate-200 rounded p-3">
          <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-0.5">Success rate</div>
          <div className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
            {solved.solving && <Loader2 size={13} className="animate-spin text-blue-500" aria-label="calculating" />}
            {solved.successRate == null ? (solved.solving ? '' : '—') : `${(solved.successRate * 100).toFixed(0)}%`}
          </div>
        </div>
      </div>
    </div>
  );
}
