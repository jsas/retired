// EQ — the ideation equalizer. A meta-level goals surface above the form:
// steer the plan with faders (1-D) and an XY pad (2-D), pin an outcome
// constraint, and the other controls respect the pin. HARD pins clamp the
// control's range / slide the dragged point along the constraint boundary;
// SOFT pins let you drag anywhere but flag the breach.
//
// All Monte Carlo scoring happens off-thread in the EQ worker (runEqSolver);
// this component is pure rendering + local drag state. The worker returns the
// live success rate, the per-axis HARD clamp boundaries, and the XY-pad
// feasibility grid, all scored against one seeded batch of futures so they
// agree. Dragging a control only re-derives the deterministic verdict
// instantly; the worker re-solve is debounced by the caller.
import { Sliders, Lock, Unlock, Crosshair, AlertTriangle } from 'lucide-react';
import type { RetirementInputs } from '../lib/retirementEngine';
import type { AppConfig } from '../lib/appConfig';
import {
  AXES, axisValue, withAxis, clampToBoundary, slidePoint, deterministicOutcome,
  type EqAxis, type EqPin, type PinMode, type PadPoint, type BoundaryResult,
} from '../lib/eqConstraints';

const fmtMoney = (v: number) =>
  new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 }).format(v);

/** The solved constraint state handed down from App (from the EQ worker). */
export interface EqSolvedState {
  successRate: number | null;
  bounds: Partial<Record<EqAxis, BoundaryResult>>;
  grid: boolean[] | null;
  gridSize: number;
  solving: boolean;
}

export interface EqPageProps {
  inputs: RetirementInputs;
  config: AppConfig;
  onChange: (inputs: RetirementInputs) => void;
  pin: EqPin;
  onPinChange: (p: EqPin) => void;
  mode: PinMode;
  onModeChange: (m: PinMode) => void;
  solved: EqSolvedState;
}

// ---------------------------------------------------------------------------
// Pin bar — set the success-rate goal and toggle it on/off.
// ---------------------------------------------------------------------------
function PinBar({ pin, onChange, successRate, solving }: {
  pin: EqPin; onChange: (p: EqPin) => void; successRate: number | null; solving: boolean;
}) {
  return (
    <div className="bg-white border border-slate-200 rounded p-3 mb-4">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <div className="flex items-center gap-2">
          <Crosshair size={14} className="text-blue-600" />
          <span className="text-xs font-semibold text-slate-800">Pin a goal</span>
        </div>

        <label className="flex items-center gap-2 text-xs text-slate-600">
          <input
            type="checkbox"
            checked={pin.enabled}
            onChange={e => onChange({ ...pin, enabled: e.target.checked })}
            className="accent-blue-600"
          />
          Success rate at least
        </label>

        <div className="flex items-center gap-2 flex-1 min-w-[12rem] max-w-xs">
          <input
            type="range" min={50} max={99} step={1}
            value={Math.round(pin.value * 100)}
            disabled={!pin.enabled}
            onChange={e => onChange({ ...pin, value: Math.min(0.99, Math.max(0.5, Number(e.target.value) / 100)) })}
            className="flex-1 accent-blue-600 disabled:opacity-40"
          />
          <span className="text-sm font-semibold text-slate-900 w-12 text-right">
            {Math.round(pin.value * 100)}%
          </span>
        </div>

        <div className="text-[11px] text-slate-500 ml-auto">
          {pin.enabled
            ? successRate == null
              ? (solving ? 'solving…' : '—')
              : <>current <span className={`font-semibold ${successRate >= pin.value ? 'text-emerald-600' : 'text-red-600'}`}>{(successRate * 100).toFixed(0)}%</span></>
            : 'pin off — controls move freely'}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Fader — a 1-D ratchet slider for one scalar axis, with hard/soft pin mode.
// ---------------------------------------------------------------------------
function Fader({ axis, inputs, config, pin, mode, bound, successRate, onChange }: {
  axis: EqAxis;
  inputs: RetirementInputs;
  config: AppConfig;
  pin: EqPin;
  mode: PinMode;
  bound?: BoundaryResult;
  successRate: number | null;
  onChange: (inputs: RetirementInputs) => void;
}) {
  const spec = AXES[axis];
  const value = axisValue(inputs, axis);

  // SOFT violation: the current value breaches the pin. Uses the live success
  // rate for the successRate pin, the deterministic outcome otherwise.
  const violated = pin.enabled && mode === 'soft' && successRate != null && successRate < pin.value;

  const apply = (raw: number) => {
    let v = raw;
    if (pin.enabled && mode === 'hard' && bound) {
      v = clampToBoundary(axis, raw, bound);
    }
    onChange(withAxis(inputs, axis, v));
  };

  // A HARD pin narrows the slider's range so the thumb physically stops. The
  // range edge includes the current value so the thumb never sits outside its
  // own track before the worker re-solve catches up.
  const hard = pin.enabled && mode === 'hard' && bound && bound.kind !== 'unconstrained';
  const effMin = hard && spec.increasingRate ? Math.min(bound!.value, value) : spec.min;
  const effMax = hard && !spec.increasingRate ? Math.max(bound!.value, value) : spec.max;

  return (
    <div className={`bg-white border rounded p-3 ${violated ? 'border-red-300 ring-1 ring-red-200' : 'border-slate-200'}`}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[11px] font-semibold text-slate-700">{spec.label}</span>
        <span className={`text-sm font-semibold ${violated ? 'text-red-600' : 'text-slate-900'}`}>{spec.format(value)}</span>
      </div>
      <input
        type="range" min={effMin} max={effMax} step={spec.step} value={value}
        onChange={e => apply(Number(e.target.value))}
        className={`w-full ${violated ? 'accent-red-500' : 'accent-blue-600'}`}
      />
      <div className="flex items-center justify-between text-[10px] text-slate-400 mt-0.5">
        <span>{spec.format(effMin)}</span>
        {violated && (
          <span className="flex items-center gap-0.5 text-red-600 font-medium">
            <AlertTriangle size={9} /> breaks the pin
          </span>
        )}
        {!violated && hard && bound!.kind === 'bounded' && (
          <span className="text-slate-400">limit {spec.format(bound!.value)}</span>
        )}
        <span>{spec.format(effMax)}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// XY pad — retirement age (x) × annual spending (y). Drag the handle; a HARD
// pin slides it along the boundary, a SOFT pin flags the breach. The plane is
// shaded by feasibility from the worker grid.
// ---------------------------------------------------------------------------
function XyPad({ inputs, config, pin, mode, solved, onChange }: {
  inputs: RetirementInputs;
  config: AppConfig;
  pin: EqPin;
  mode: PinMode;
  solved: EqSolvedState;
  onChange: (inputs: RetirementInputs) => void;
}) {
  const xSpec = AXES.retirementAge;
  const ySpec = AXES.desiredSpending;
  const point: PadPoint = { x: inputs.retirementAge, y: inputs.desiredSpending };
  const G = solved.gridSize;

  const violated = pin.enabled && mode === 'soft' && solved.successRate != null && solved.successRate < pin.value;

  const apply = (raw: PadPoint) => {
    let next = raw;
    if (pin.enabled && mode === 'hard') {
      next = slidePoint(
        raw,
        'retirementAge',
        'desiredSpending',
        () => solved.bounds.retirementAge ?? { value: xSpec.max, kind: 'unconstrained' },
        () => solved.bounds.desiredSpending ?? { value: ySpec.max, kind: 'unconstrained' },
      );
    }
    onChange(withAxis(withAxis(inputs, 'retirementAge', next.x), 'desiredSpending', next.y));
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

  return (
    <div className={`bg-white border rounded p-3 ${violated ? 'border-red-300 ring-1 ring-red-200' : 'border-slate-200'}`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] font-semibold text-slate-700">Retirement age × spending</span>
        <span className={`text-xs font-semibold ${violated ? 'text-red-600' : 'text-slate-900'}`}>
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
              const cell = solved.grid![(G - 1 - gy) * G + gx]; // grid row 0 = low spend (bottom)
              return <div key={i} className={cell ? 'bg-emerald-100/50' : 'bg-red-100/40'} />;
            })}
          </div>
        )}

        <span className="absolute left-1 bottom-0.5 text-[9px] text-slate-400">retire {xSpec.min}</span>
        <span className="absolute right-1 bottom-0.5 text-[9px] text-slate-400">retire {xSpec.max}</span>
        <span className="absolute left-1 top-0.5 text-[9px] text-slate-400">{fmtMoney(ySpec.max)}</span>
        <span className="absolute left-1 bottom-4 text-[9px] text-slate-400">{fmtMoney(ySpec.min)}</span>

        <div
          className={`absolute w-4 h-4 -ml-2 -mt-2 rounded-full border-2 shadow ${violated ? 'bg-red-500 border-white' : 'bg-blue-600 border-white'}`}
          style={{ left: `${toFracX(point.x) * 100}%`, top: `${toFracY(point.y) * 100}%` }}
        />
      </div>

      <div className="flex items-center justify-between text-[10px] text-slate-400 mt-1">
        <span>drag to explore the retire-age × spending trade-off</span>
        {violated && (
          <span className="flex items-center gap-0.5 text-red-600 font-medium">
            <AlertTriangle size={9} /> breaks the pin
          </span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------
export function EqPage({ inputs, config, onChange, pin, onPinChange, mode, onModeChange, solved }: EqPageProps) {
  return (
    <div className="max-w-4xl">
      <div className="flex items-center gap-2 mb-1">
        <Sliders size={18} className="text-blue-600" />
        <h2 className="text-lg font-bold text-slate-900">EQ — steer the plan</h2>
        <span className="text-[10px] uppercase tracking-wider text-slate-400 border border-slate-200 rounded px-1.5 py-0.5">experimental</span>
      </div>
      <p className="text-xs text-slate-500 mb-4 leading-snug max-w-2xl">
        An ideation surface over your plan. Push the faders or drag the pad to explore; the verdict
        updates live. Pin a success-rate goal and choose whether each control is <strong>hard</strong>
        (clamped to the goal) or <strong>soft</strong> (free to drag, flagged when it breaks the goal).
      </p>

      <PinBar pin={pin} onChange={onPinChange} successRate={solved.successRate} solving={solved.solving} />

      <div className="flex items-center gap-2 mb-4">
        <span className="text-[11px] text-slate-500">Pin mode:</span>
        <div className="flex rounded border border-slate-200 overflow-hidden">
          {(['hard', 'soft'] as const).map(m => (
            <button
              key={m}
              onClick={() => onModeChange(m)}
              className={`flex items-center gap-1 px-3 py-1 text-xs font-medium ${mode === m ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
              title={m === 'hard' ? 'Controls clamp to the pinned goal' : 'Controls move freely; breaches are flagged'}
            >
              {m === 'hard' ? <Lock size={11} /> : <Unlock size={11} />}
              {m === 'hard' ? 'Hard (clamp)' : 'Soft (warn)'}
            </button>
          ))}
        </div>
        {solved.solving && <span className="text-[11px] text-slate-400">solving the goal…</span>}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start mb-4">
        <div className="space-y-3">
          <Fader axis="desiredSpending" inputs={inputs} config={config} pin={pin} mode={mode} bound={solved.bounds.desiredSpending} successRate={solved.successRate} onChange={onChange} />
          <Fader axis="retirementAge" inputs={inputs} config={config} pin={pin} mode={mode} bound={solved.bounds.retirementAge} successRate={solved.successRate} onChange={onChange} />
          <Fader axis="investmentReturn" inputs={inputs} config={config} pin={pin} mode={mode} bound={solved.bounds.investmentReturn} successRate={solved.successRate} onChange={onChange} />
        </div>
        <XyPad inputs={inputs} config={config} pin={pin} mode={mode} solved={solved} onChange={onChange} />
      </div>

      <div className="grid grid-cols-3 gap-3">
        <VerdictCard inputs={inputs} config={config} successRate={solved.successRate} solving={solved.solving} />
      </div>
    </div>
  );
}

// Live verdict readout: deterministic status/depletion (instant) + the
// worker's success rate.
function VerdictCard({ inputs, config, successRate, solving }: {
  inputs: RetirementInputs; config: AppConfig; successRate: number | null; solving: boolean;
}) {
  const o = deterministicOutcome(inputs, config);
  return (
    <>
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
        <div className="text-sm font-semibold text-slate-900">
          {successRate == null ? (solving ? '…' : '—') : `${(successRate * 100).toFixed(0)}%`}
        </div>
      </div>
    </>
  );
}
