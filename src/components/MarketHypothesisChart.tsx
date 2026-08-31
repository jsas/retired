import { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import { TrendingUp, Plus, Trash2, X } from 'lucide-react';
import type { RetirementInputs, MarketPeriod } from '@retired/engine-core/retirementEngine';
import { buildReturnSequence, buildVolatilitySequence } from '@retired/engine-core/marketPeriods';

interface MarketHypothesisChartProps {
  inputs: RetirementInputs;
  onChange: (inputs: RetirementInputs) => void;
}

const W = 900;
const H = 240;
const PAD = { top: 18, right: 56, bottom: 26, left: 48 };

// The vertical range each axis maps to. Return can go deep negative (a crash);
// volatility is a standard deviation, so it's floored at 0.
const RET_MIN = -0.30, RET_MAX = 0.20;   // -30% .. +20%
const VOL_MIN = 0, VOL_MAX = 0.40;       // 0 .. 40%

let uid = 0;
const newId = () => `mp-${Date.now().toString(36)}-${(uid++).toString(36)}`;

/** Round to a stable step so drags settle on clean values (0.1% return, 0.5% vol). */
const roundRet = (v: number) => Math.round(v * 1000) / 1000;
const roundVol = (v: number) => Math.round(v * 200) / 200;

type DragTarget = { id: string; field: 'return' | 'volatility' };

/**
 * Interactive market-hypothesis editor (issue #138). Two overlaid curves on one
 * age axis: the expected-return line (left axis, blue) and the volatility line
 * (right axis, amber). The user shapes a market regime — a crash, a boom, a
 * choppy stretch — by placing and dragging anchors:
 *
 *  - DOUBLE-CLICK (or double-tap) anywhere adds an anchor at that age, seeded
 *    with the curve's current value there so the line doesn't jump.
 *  - DRAG an anchor vertically to change its value, horizontally to change age.
 *    A return anchor moves the return line; a volatility anchor (shown only
 *    when the point carries a σ) moves the volatility line.
 *  - CLICK an anchor to select it: an editor strip opens with numeric fields
 *    and a delete button.
 *
 * Edits flow through onChange → marketPeriods, re-simulating live. The engine
 * interpolates linearly between anchors and falls back to the flat
 * investmentReturn / returnVolatility outside the outermost anchors.
 */
export function MarketHypothesisChart({ inputs, onChange }: MarketHypothesisChartProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<DragTarget | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const minAge = inputs.currentAge;
  const maxAge = inputs.maxAge;
  const span = Math.max(1, maxAge - minAge);

  const periods = useMemo(
    () => (Array.isArray(inputs.marketPeriods) ? [...inputs.marketPeriods].sort((a, b) => a.age - b.age) : []),
    [inputs.marketPeriods],
  );
  const selected = periods.find(p => p.id === selectedId) ?? null;

  // Axis mappers. Return reads the LEFT axis, volatility the RIGHT (its own
  // scale so a 20% σ and a 5% return are both readable).
  const x = (age: number) => PAD.left + ((age - minAge) / span) * (W - PAD.left - PAD.right);
  const ageAtX = (px: number) => minAge + ((px - PAD.left) / (W - PAD.left - PAD.right)) * span;
  const yRet = (v: number) => PAD.top + (1 - (v - RET_MIN) / (RET_MAX - RET_MIN)) * (H - PAD.top - PAD.bottom);
  const retAtY = (py: number) => RET_MIN + (1 - (py - PAD.top) / (H - PAD.top - PAD.bottom)) * (RET_MAX - RET_MIN);
  const yVol = (v: number) => PAD.top + (1 - (v - VOL_MIN) / (VOL_MAX - VOL_MIN)) * (H - PAD.top - PAD.bottom);
  const volAtY = (py: number) => VOL_MIN + (1 - (py - PAD.top) / (H - PAD.top - PAD.bottom)) * (VOL_MAX - VOL_MIN);

  // The full per-age curves, so the drawn lines reflect exactly what the engine
  // computes (interpolation + clamped-end fallback to the constants). Age 0 is
  // outside [currentAge, maxAge], so ask the builder for the visible window.
  const retSeq = useMemo(
    () => buildReturnSequence(periods, minAge, maxAge, inputs.investmentReturn),
    [periods, minAge, maxAge, inputs.investmentReturn],
  );
  const volSeq = useMemo(
    () => buildVolatilitySequence(periods, minAge, maxAge, inputs.returnVolatility ?? 0),
    [periods, minAge, maxAge, inputs.returnVolatility],
  );

  const ages: number[] = [];
  for (let a = minAge; a <= maxAge; a++) ages.push(a);
  const linePath = (seq: Record<number, number>, yOf: (v: number) => number) =>
    ages.map((a, i) => `${i === 0 ? 'M' : 'L'}${x(a).toFixed(1)},${yOf(seq[a]).toFixed(1)}`).join(' ');

  const write = (next: MarketPeriod[]) => onChange({ ...inputs, marketPeriods: next });

  const updatePoint = (id: string, patch: Partial<MarketPeriod>) =>
    write(periods.map(p => (p.id === id ? { ...p, ...patch } : p)));

  const removePoint = (id: string) => {
    write(periods.filter(p => p.id !== id));
    if (selectedId === id) setSelectedId(null);
  };

  // Add an anchor at `age`. Seeded with the curve's CURRENT value at that age
  // (and the current σ) so the line is continuous through the new point —
  // dropping it at a default would kink the curve the user was looking at.
  const addPoint = (ageRaw: number) => {
    const age = Math.round(Math.min(maxAge, Math.max(minAge, ageRaw)));
    if (periods.some(p => p.age === age)) return; // one anchor per age
    const ret = retSeq?.[age] ?? inputs.investmentReturn;
    const vol = volSeq?.[age] ?? (inputs.returnVolatility ?? 0);
    const pt: MarketPeriod = { id: newId(), age, return: roundRet(ret), volatility: roundVol(vol) };
    write([...periods, pt]);
    setSelectedId(pt.id);
  };

  const svgPoint = (e: { clientX: number; clientY: number }) => {
    const rect = svgRef.current!.getBoundingClientRect();
    return {
      px: ((e.clientX - rect.left) / rect.width) * W,
      py: ((e.clientY - rect.top) / rect.height) * H,
    };
  };

  const applyDrag = useCallback((e: { clientX: number; clientY: number }) => {
    if (!drag) return;
    const { px, py } = svgPoint(e);
    const age = Math.round(Math.min(maxAge, Math.max(minAge, ageAtX(px))));
    if (drag.field === 'return') {
      updatePoint(drag.id, { age, return: roundRet(Math.min(RET_MAX, Math.max(RET_MIN, retAtY(py)))) });
    } else {
      updatePoint(drag.id, { age, volatility: roundVol(Math.min(VOL_MAX, Math.max(VOL_MIN, volAtY(py)))) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag, inputs, periods, minAge, maxAge, span]);

  // Window-level listeners so a drag continues outside the SVG (pointer events
  // unify mouse + touch; setPointerCapture keeps the gesture on the window).
  useEffect(() => {
    if (!drag) return;
    const move = (e: PointerEvent) => applyDrag(e);
    const up = () => setDrag(null);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [drag, applyDrag]);

  // Grid ticks.
  const xTicks: number[] = [];
  const step = Math.max(1, Math.round(span / 12));
  for (let a = minAge; a <= maxAge; a += step) xTicks.push(a);
  const retTicks = [RET_MIN, -0.15, 0, 0.05, 0.10, RET_MAX];
  const volTicks = [0, 0.10, 0.20, 0.30, VOL_MAX];

  const pct = (v: number, digits = 1) => `${(v * 100).toFixed(digits)}%`;

  const anchorProps = (p: MarketPeriod, field: 'return' | 'volatility') => ({
    className: `cursor-grab active:cursor-grabbing ${selectedId === p.id ? 'opacity-100' : 'opacity-90'}`,
    onPointerDown: (e: React.PointerEvent) => { e.preventDefault(); setDrag({ id: p.id, field }); setSelectedId(p.id); },
    onClick: (e: React.MouseEvent) => { e.stopPropagation(); setSelectedId(p.id); },
  });

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <TrendingUp size={16} className="text-blue-600" />
          <h3 className="text-sm font-semibold text-slate-800">Market Hypothesis</h3>
          <span className="text-[11px] text-slate-500">
            {periods.length === 0 ? 'flat (constant return)' : `${periods.length} anchor${periods.length === 1 ? '' : 's'}`}
          </span>
        </div>
        {periods.length > 0 && (
          <button
            onClick={() => { write([]); setSelectedId(null); }}
            className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-slate-500 hover:text-red-600 hover:bg-red-50 rounded"
            title="Clear every anchor (back to a flat constant return)"
          >
            <X size={12} /> Clear
          </button>
        )}
      </div>

      <p className="text-[11px] text-slate-500 mb-2 leading-snug">
        Double-click the chart to drop an anchor at that age; drag it up/down for the return,
        sideways for the age. The projection follows the blue line; the amber line is the
        volatility Monte Carlo samples around. Outside the outermost anchors the flat
        Expected Return / Volatility from the sidebar hold.
      </p>

      {/* Chart */}
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full select-none touch-none"
        onDoubleClick={e => { const { px } = svgPoint(e); addPoint(ageAtX(px)); }}
        onClick={() => setSelectedId(null)}
      >
        {/* zero line (return) */}
        <line x1={PAD.left} x2={W - PAD.right} y1={yRet(0)} y2={yRet(0)} stroke="#cbd5e1" strokeWidth="1" />
        {/* Y gridlines + LEFT axis labels (return) */}
        {retTicks.map(t => (
          <g key={`r${t}`}>
            <line x1={PAD.left} x2={W - PAD.right} y1={yRet(t)} y2={yRet(t)} stroke="#eef2f7" strokeWidth="1" />
            <text x={PAD.left - 6} y={yRet(t) + 3} textAnchor="end" fontSize="10" fill="#3b82f6">{pct(t, 0)}</text>
          </g>
        ))}
        {/* RIGHT axis labels (volatility) */}
        {volTicks.map(t => (
          <text key={`v${t}`} x={W - PAD.right + 6} y={yVol(t) + 3} textAnchor="start" fontSize="10" fill="#d97706">{pct(t, 0)}</text>
        ))}
        {/* X axis labels */}
        {xTicks.map(a => (
          <text key={a} x={x(a)} y={H - 8} textAnchor="middle" fontSize="10" fill="#64748b">{a}</text>
        ))}

        {/* Volatility curve (amber, drawn under the return line) */}
        {volSeq && periods.some(p => p.volatility != null) && (
          <path d={linePath(volSeq, yVol)} fill="none" stroke="#f59e0b" strokeWidth="1.5" strokeDasharray="1 0" opacity="0.7" />
        )}

        {/* Return curve (blue) */}
        {retSeq && <path d={linePath(retSeq, yRet)} fill="none" stroke="#1d4ed8" strokeWidth="2" />}

        {/* Volatility anchors (squares) */}
        {periods.filter(p => p.volatility != null).map(p => (
          <rect
            key={`vol-${p.id}`}
            x={x(p.age) - 4.5} y={yVol(p.volatility!) - 4.5} width="9" height="9"
            fill={selectedId === p.id ? '#b45309' : '#f59e0b'} stroke="#fff" strokeWidth="1.5"
            {...anchorProps(p, 'volatility')}
          />
        ))}

        {/* Return anchors (circles) */}
        {periods.map(p => (
          <circle
            key={`ret-${p.id}`}
            cx={x(p.age)} cy={yRet(p.return)} r={selectedId === p.id ? 6 : 5}
            fill={selectedId === p.id ? '#1e40af' : '#3b82f6'} stroke="#fff" strokeWidth="1.5"
            {...anchorProps(p, 'return')}
          />
        ))}
      </svg>

      {/* Legend */}
      <div className="flex items-center gap-4 mt-1 text-[11px] text-slate-600">
        <span className="flex items-center gap-1.5"><span className="w-4 h-0.5 bg-blue-700 inline-block" /> expected return</span>
        <span className="flex items-center gap-1.5"><span className="w-4 h-0.5 bg-amber-500 inline-block" /> volatility (Monte Carlo σ)</span>
        <span className="flex items-center gap-1.5 text-slate-400"><Plus size={11} /> double-click to add</span>
      </div>

      {/* Selected-point editor */}
      {selected && (
        <div className="mt-3 flex flex-wrap items-end gap-3 rounded border border-slate-200 bg-slate-50 p-3">
          <div>
            <label className="block text-[10px] text-slate-500 mb-0.5">Age</label>
            <input
              type="number" value={selected.age} min={minAge} max={maxAge}
              onChange={e => updatePoint(selected.id, { age: Math.round(Math.min(maxAge, Math.max(minAge, parseInt(e.target.value, 10) || minAge))) })}
              className="w-20 px-2 py-1 text-xs border border-slate-300 rounded bg-white"
            />
          </div>
          <div>
            <label className="block text-[10px] text-slate-500 mb-0.5">Return (%)</label>
            <input
              type="number" step="0.1" value={+(selected.return * 100).toFixed(2)}
              onChange={e => updatePoint(selected.id, { return: (parseFloat(e.target.value) || 0) / 100 })}
              className="w-24 px-2 py-1 text-xs border border-slate-300 rounded bg-white"
            />
          </div>
          <div>
            <label className="block text-[10px] text-slate-500 mb-0.5">Volatility (%)</label>
            <input
              type="number" step="0.5" min="0" value={+((selected.volatility ?? 0) * 100).toFixed(2)}
              onChange={e => updatePoint(selected.id, { volatility: Math.max(0, (parseFloat(e.target.value) || 0) / 100) })}
              className="w-24 px-2 py-1 text-xs border border-slate-300 rounded bg-white"
            />
          </div>
          <button
            onClick={() => removePoint(selected.id)}
            className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-red-600 bg-red-50 border border-red-200 rounded hover:bg-red-100"
          >
            <Trash2 size={12} /> Delete anchor
          </button>
        </div>
      )}
    </div>
  );
}
