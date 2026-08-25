import { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import { PencilLine } from 'lucide-react';
import type { RetirementInputs, RetirementResults, CashEvent } from '../lib/retirementEngine';

interface TimelineChartProps {
  inputs: RetirementInputs;
  results: RetirementResults;
  config: { engine: { inflationRate: number } };
  onChange: (inputs: RetirementInputs) => void;
}

const W = 900;
const H = 300;
const PAD = { top: 18, right: 16, bottom: 26, left: 60 };
const SPEND_H = 84; // spending panel height below the main chart
const GAP = 12;
const TOTAL_H = H + GAP + SPEND_H + PAD.bottom;

function formatMoney(v: number): string {
  if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `$${Math.round(v / 1_000)}k`;
  return `$${Math.round(v)}`;
}

type DragTarget =
  | { kind: 'retirement' }
  | { kind: 'spending' }            // base desired-spending level
  | { kind: 'band'; index: number } // a spending-band level
  | { kind: 'event'; id: string };  // a one-time event (age + amount)

/**
 * Interactive projection timeline. Drag handles write back into the inputs:
 *  - the dashed retirement marker moves retirementAge (horizontal)
 *  - the green spending handles adjust desiredSpending / spendingBands (vertical)
 *  - event diamonds move in age (horizontal) and amount (vertical)
 * Edits flow through the normal onChange path — they re-simulate live and
 * stay unsaved until the top-bar Save, like any sidebar edit.
 */
export function TimelineChart({ inputs, results, config, onChange }: TimelineChartProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<DragTarget | null>(null);
  const [hover, setHover] = useState<string | null>(null);

  const rows = results.yearlyBreakdown;
  const minAge = inputs.currentAge;
  const maxAge = rows.length > 0 ? rows[rows.length - 1].age : inputs.maxAge;
  const span = Math.max(1, maxAge - minAge);

  const x = (age: number) => PAD.left + ((age - minAge) / span) * (W - PAD.left - PAD.right);
  const ageAtX = (px: number) => minAge + ((px - PAD.left) / (W - PAD.left - PAD.right)) * span;

  // Reverse mortgage: rows carry home equity once it's active. The balance
  // line (investable accounts) can legitimately fall to $0 while the plan
  // stays afloat on home equity, so overlay net home equity to show that.
  const hasRm = rows.some(r => r.netHomeEquity != null);

  const maxBal = Math.max(
    1,
    ...rows.map(r => r.endingBalance),
    ...rows.map(r => r.startingBalance),
    ...(hasRm ? rows.map(r => r.netHomeEquity ?? 0) : []),
  );
  const y = (v: number) => PAD.top + (1 - v / maxBal) * (H - PAD.top - PAD.bottom);

  // Spending panel geometry (its own scale).
  const spendTop = H + GAP;
  const maxSpend = Math.max(1, ...rows.map(r => r.spendingTarget));
  const ys = (v: number) => spendTop + (1 - v / maxSpend) * (SPEND_H - 14);
  const spendAtY = (py: number) => (1 - (py - spendTop) / (SPEND_H - 14)) * maxSpend;

  const inflation = Math.max(0, config.engine.inflationRate ?? 0);
  // Deflate a nominal amount at `age` back to today's dollars (inputs are
  // stored in today's dollars; the chart shows nominal-of-that-year values).
  const deflate = (nominal: number, age: number) =>
    nominal / Math.pow(1 + inflation, Math.max(0, age - inputs.currentAge));

  const bands = Array.isArray(inputs.spendingBands)
    ? [...inputs.spendingBands].sort((a, b) => a.fromAge - b.fromAge)
    : [];
  const events = Array.isArray(inputs.events) ? inputs.events : [];

  const balancePath = useMemo(() =>
    rows.map((r, i) => `${i === 0 ? 'M' : 'L'}${x(r.age).toFixed(1)},${y(r.startingBalance).toFixed(1)}`).join(' '),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, maxBal, minAge, span]);

  const spendPath = useMemo(() =>
    rows.map((r, i) => `${i === 0 ? 'M' : 'L'}${x(r.age).toFixed(1)},${ys(r.spendingTarget).toFixed(1)}`).join(' '),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, maxSpend, minAge, span]);

  const equityPath = useMemo(() =>
    hasRm
      ? rows.map((r, i) => `${i === 0 ? 'M' : 'L'}${x(r.age).toFixed(1)},${y(r.netHomeEquity ?? 0).toFixed(1)}`).join(' ')
      : '',
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, hasRm, maxBal, minAge, span]);

  const svgPoint = (e: MouseEvent | React.MouseEvent) => {
    const rect = svgRef.current!.getBoundingClientRect();
    return {
      px: ((e.clientX - rect.left) / rect.width) * W,
      py: ((e.clientY - rect.top) / rect.height) * TOTAL_H
    };
  };

  const applyDrag = useCallback((e: MouseEvent | React.MouseEvent) => {
    if (!drag) return;
    const { px, py } = svgPoint(e);

    if (drag.kind === 'retirement') {
      const age = Math.round(Math.min(inputs.maxAge - 1, Math.max(inputs.currentAge + 1, ageAtX(px))));
      if (age !== inputs.retirementAge) onChange({ ...inputs, retirementAge: age });
      return;
    }

    if (drag.kind === 'spending') {
      // Nominal level at the retirement year → deflate to today's dollars.
      const nominal = Math.max(0, spendAtY(py));
      const today = deflate(nominal, inputs.retirementAge);
      const rounded = Math.round(today / 500) * 500;
      if (rounded !== inputs.desiredSpending && rounded >= 0) {
        onChange({ ...inputs, desiredSpending: rounded });
      }
      return;
    }

    if (drag.kind === 'band') {
      const band = bands[drag.index];
      if (!band) return;
      const nominal = Math.max(0, spendAtY(py));
      const today = deflate(nominal, band.fromAge);
      const pct = inputs.desiredSpending > 0 ? Math.min(2, today / inputs.desiredSpending) : 1;
      const rounded = Math.round(pct * 100) / 100;
      if (rounded !== band.pctOfBase) {
        onChange({ ...inputs, spendingBands: bands.map((b, i) => (i === drag.index ? { ...b, pctOfBase: rounded } : b)) });
      }
      return;
    }

    if (drag.kind === 'event') {
      const age = Math.round(Math.min(inputs.maxAge, Math.max(inputs.currentAge, ageAtX(px))));
      const nominal = Math.max(0, spendAtY(py));
      const today = deflate(nominal, age);
      const rounded = Math.round(today / 1000) * 1000;
      onChange({
        ...inputs,
        events: events.map(ev => (ev.id === (drag as { kind: 'event'; id: string }).id
          ? { ...ev, age, amount: rounded }
          : ev))
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag, inputs, bands, events, minAge, span, maxSpend]);

  // Window-level listeners so a drag continues outside the SVG.
  useEffect(() => {
    if (!drag) return;
    const move = (e: MouseEvent) => applyDrag(e);
    const up = () => setDrag(null);
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
  }, [drag, applyDrag]);

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map(f => f * maxBal);
  const xTicks: number[] = [];
  const step = Math.max(1, Math.round(span / 12));
  for (let a = minAge; a <= maxAge; a += step) xTicks.push(a);

  // Base spending level shown at retirement (nominal, including inflation).
  const retRow = rows.find(r => r.age === inputs.retirementAge);
  const baseEventOut = events.filter(ev => ev.direction === 'out' && ev.age === inputs.retirementAge).reduce((s, ev) => s + ev.amount, 0);
  const baseSpendLevel = retRow ? Math.max(0, retRow.spendingTarget - baseEventOut) : 0;

  const handleProps = (id: string, target: DragTarget) => ({
    className: `cursor-ns-resize ${hover === id || (drag && JSON.stringify(drag) === JSON.stringify(target)) ? 'opacity-100' : 'opacity-70'} hover:opacity-100`,
    onMouseEnter: () => setHover(id),
    onMouseLeave: () => setHover(null),
    onMouseDown: (e: React.MouseEvent) => { e.preventDefault(); setDrag(target); }
  });

  return (
    <div className="bg-white border border-slate-200 rounded overflow-hidden mb-6">
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-100">
        <div className="flex items-center gap-2 text-xs font-semibold text-slate-700">
          <PencilLine size={13} className="text-blue-600" />
          Projection Timeline
          <span className="font-normal text-slate-500">
            — drag the retirement line, spending handles, and event diamonds; edits re-simulate live
          </span>
        </div>
        <div className="flex items-center gap-3 text-[10px] text-slate-500">
          <span className="inline-flex items-center gap-1">
            <span className="inline-block w-4 h-0.5 bg-blue-700" /> portfolio
          </span>
          {hasRm && (
            <span className="inline-flex items-center gap-1" title="Net home equity: home value minus the reverse-mortgage loan. The plan stays afloat on this even after investable accounts reach $0.">
              <span className="inline-block w-4 h-0 border-t-2 border-dashed border-amber-600" /> net home equity
            </span>
          )}
          <span className="inline-flex items-center gap-1">
            <span className="inline-block w-4 h-0.5 bg-emerald-600" /> spend
          </span>
        </div>
      </div>
      <div className="p-2">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${TOTAL_H}`}
          className="w-full select-none"
          onMouseMove={e => { if (drag) applyDrag(e); }}
        >
          {/* Y gridlines */}
          {yTicks.map((t, i) => (
            <g key={i}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} stroke="#e2e8f0" strokeWidth="1" />
              <text x={PAD.left - 6} y={y(t) + 3} textAnchor="end" fontSize="10" fill="#64748b">{formatMoney(t)}</text>
            </g>
          ))}
          {xTicks.map(a => (
            <text key={a} x={x(a)} y={H - 6} textAnchor="middle" fontSize="10" fill="#64748b">{a}</text>
          ))}

          {/* Balance line */}
          <path d={balancePath} fill="none" stroke="#1d4ed8" strokeWidth="2" />

          {/* Net home equity (reverse mortgage) — the plan stays afloat on
              equity even after investable accounts hit $0 */}
          {hasRm && (
            <path d={equityPath} fill="none" stroke="#d97706" strokeWidth="1.75" strokeDasharray="6 3" />
          )}

          {/* Retirement marker (drag horizontally) */}
          <line
            x1={x(inputs.retirementAge)} x2={x(inputs.retirementAge)}
            y1={PAD.top} y2={H - PAD.bottom}
            stroke="#f59e0b" strokeWidth="2" strokeDasharray="5 3"
            className="cursor-ew-resize"
            onMouseDown={e => { e.preventDefault(); setDrag({ kind: 'retirement' }); }}
          />
          <rect
            x={x(inputs.retirementAge) - 14} y={PAD.top - 2} width="28" height="12" rx="3"
            fill="#f59e0b" className="cursor-ew-resize"
            onMouseDown={e => { e.preventDefault(); setDrag({ kind: 'retirement' }); }}
          />
          <text x={x(inputs.retirementAge)} y={PAD.top + 7} textAnchor="middle" fontSize="8" fill="#fff" className="pointer-events-none">
            {inputs.retirementAge}
          </text>

          {/* Spending panel */}
          <text x={PAD.left - 6} y={spendTop + 8} textAnchor="end" fontSize="9" fill="#64748b">spend</text>
          <path d={spendPath} fill="none" stroke="#059669" strokeWidth="1.5" />

          {/* Base spending handle (drag vertically) */}
          {retRow && (
            <g {...handleProps('spend', { kind: 'spending' })}>
              <circle cx={x(inputs.retirementAge)} cy={ys(baseSpendLevel)} r="6" fill="#059669" stroke="#fff" strokeWidth="1.5" />
              <title>Desired spending: {formatMoney(inputs.desiredSpending)} (today's $) — drag to adjust</title>
            </g>
          )}

          {/* Spending-band handles (drag vertically) */}
          {bands.map((b, i) => {
            const row = rows.find(r => r.age >= b.fromAge);
            if (!row) return null;
            return (
              <g key={i} {...handleProps(`band-${i}`, { kind: 'band', index: i })}>
                <rect x={x(b.fromAge) - 5} y={ys(row.spendingTarget) - 5} width="10" height="10" rx="2"
                  fill="#10b981" stroke="#fff" strokeWidth="1.5" />
                <title>From age {b.fromAge}: {Math.round(b.pctOfBase * 100)}% of spending — drag to adjust</title>
              </g>
            );
          })}

          {/* Event diamonds (drag both axes) */}
          {events.map((ev: CashEvent) => {
            const nominal = ev.amount * Math.pow(1 + inflation, Math.max(0, ev.age - inputs.currentAge));
            return (
              <g key={ev.id} {...handleProps(ev.id, { kind: 'event', id: ev.id })} style={{ cursor: 'move' }}>
                <rect
                  x={x(ev.age) - 5} y={ys(Math.min(maxSpend, nominal)) - 5} width="10" height="10"
                  transform={`rotate(45 ${x(ev.age)} ${ys(Math.min(maxSpend, nominal))})`}
                  fill={ev.direction === 'in' ? '#0ea5e9' : '#ef4444'} stroke="#fff" strokeWidth="1.5"
                />
                <title>{ev.label}: {ev.direction === 'in' ? '+' : '−'}{formatMoney(ev.amount)} at age {ev.age} — drag to move/resize</title>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
