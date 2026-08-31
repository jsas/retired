import { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import { PencilLine } from 'lucide-react';
import type { RetirementInputs, RetirementResults, CashEvent, MarketPeriod } from '@retired/engine-core/retirementEngine';
import { buildReturnSequence, buildVolatilitySequence } from '@retired/engine-core/marketPeriods';

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
const MKT_H = 84;   // market-hypothesis panel height below the spending panel
const GAP = 12;
const TOTAL_H = H + GAP + SPEND_H + GAP + MKT_H + PAD.bottom;

// The market panel's vertical ranges. Return can go deep negative (a crash);
// volatility is a standard deviation, floored at 0.
const RET_MIN = -0.30, RET_MAX = 0.20;
const VOL_MIN = 0, VOL_MAX = 0.40;

// Round drags to stable steps so points settle on clean values (0.1% return, 0.5% σ).
const roundRet = (v: number) => Math.round(v * 1000) / 1000;
const roundVol = (v: number) => Math.round(v * 200) / 200;

let mpSeq = 0;
const newMarketPeriodId = () => `mp-${Date.now().toString(36)}-${(mpSeq++).toString(36)}`;

function formatMoney(v: number): string {
  if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `$${Math.round(v / 1_000)}k`;
  return `$${Math.round(v)}`;
}

type DragTarget =
  | { kind: 'retirement' }
  | { kind: 'spending' }            // base desired-spending level
  | { kind: 'band'; index: number } // a spending-band level
  | { kind: 'event'; id: string }   // a one-time event (age + amount)
  | { kind: 'mkt'; id: string; field: 'return' | 'volatility' }; // a market-hypothesis anchor (age + value)

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
  // The selected market anchor (for the floating delete affordance).
  const [selectedMkt, setSelectedMkt] = useState<string | null>(null);

  const rows = results.yearlyBreakdown;
  const minAge = inputs.currentAge;
  const maxAge = rows.length > 0 ? rows[rows.length - 1].age : inputs.maxAge;
  const span = Math.max(1, maxAge - minAge);

  const x = (age: number) => PAD.left + ((age - minAge) / span) * (W - PAD.left - PAD.right);
  const ageAtX = (px: number) => minAge + ((px - PAD.left) / (W - PAD.left - PAD.right)) * span;

  // Reverse mortgage: rows carry home equity once it's active. With RM on, the
  // headline number is TOTAL cash — investable portfolio + net home equity —
  // since the plan draws on both; the portfolio and equity components show as
  // secondary lines so the split stays visible.
  const hasRm = rows.some(r => r.netHomeEquity != null);
  const totalCash = (r: (typeof rows)[number]) => r.startingBalance + (hasRm ? (r.netHomeEquity ?? 0) : 0);

  const maxBal = Math.max(
    1,
    ...rows.map(r => r.endingBalance),
    ...rows.map(r => r.startingBalance),
    ...(hasRm ? rows.map(totalCash) : []),
  );
  const y = (v: number) => PAD.top + (1 - v / maxBal) * (H - PAD.top - PAD.bottom);

  // Spending panel geometry (its own scale).
  const spendTop = H + GAP;
  const maxSpend = Math.max(1, ...rows.map(r => r.spendingTarget));
  const ys = (v: number) => spendTop + (1 - v / maxSpend) * (SPEND_H - 14);
  const spendAtY = (py: number) => (1 - (py - spendTop) / (SPEND_H - 14)) * maxSpend;

  // Market-hypothesis panel geometry (issue #138), its own scales: return on
  // the left, volatility on the right. Sits below the spending panel.
  const mktTop = spendTop + SPEND_H + GAP;
  const ymRet = (v: number) => mktTop + (1 - (v - RET_MIN) / (RET_MAX - RET_MIN)) * (MKT_H - 14);
  const retAtY = (py: number) => RET_MIN + (1 - (py - mktTop) / (MKT_H - 14)) * (RET_MAX - RET_MIN);
  const ymVol = (v: number) => mktTop + (1 - (v - VOL_MIN) / (VOL_MAX - VOL_MIN)) * (MKT_H - 14);
  const volAtY = (py: number) => VOL_MIN + (1 - (py - mktTop) / (MKT_H - 14)) * (VOL_MAX - VOL_MIN);

  // The plan's market-hypothesis anchors and the per-age curves the engine
  // computes from them (linear interpolation, clamped to the flat constants
  // outside the outermost anchors). Drawing the resolved curve keeps the chart
  // honest with the engine. Empty = the flat constants every year.
  const marketPeriods = useMemo(
    () => (Array.isArray(inputs.marketPeriods) ? [...inputs.marketPeriods].sort((a, b) => a.age - b.age) : []),
    [inputs.marketPeriods],
  );
  const retSeq = useMemo(
    () => buildReturnSequence(marketPeriods, minAge, maxAge, inputs.investmentReturn),
    [marketPeriods, minAge, maxAge, inputs.investmentReturn],
  );
  const volSeq = useMemo(
    () => buildVolatilitySequence(marketPeriods, minAge, maxAge, inputs.returnVolatility ?? 0),
    [marketPeriods, minAge, maxAge, inputs.returnVolatility],
  );
  // Fallback to the flat constants when there are no anchors (build* return
  // undefined then), so the strip always draws the current assumption.
  const effRetSeq = useMemo(() => {
    if (retSeq) return retSeq;
    const seq: Record<number, number> = {};
    for (let a = minAge; a <= maxAge; a++) seq[a] = inputs.investmentReturn;
    return seq;
  }, [retSeq, minAge, maxAge, inputs.investmentReturn]);
  const effVolSeq = useMemo(() => {
    if (volSeq) return volSeq;
    const seq: Record<number, number> = {};
    const v = inputs.returnVolatility ?? 0;
    for (let a = minAge; a <= maxAge; a++) seq[a] = v;
    return seq;
  }, [volSeq, minAge, maxAge, inputs.returnVolatility]);

  const inflation = Math.max(0, config.engine.inflationRate ?? 0);
  // Deflate a nominal amount at `age` back to today's dollars (inputs are
  // stored in today's dollars; the chart shows nominal-of-that-year values).
  const deflate = (nominal: number, age: number) =>
    nominal / Math.pow(1 + inflation, Math.max(0, age - inputs.currentAge));
  // Inverse: today's dollars → nominal at `age`. (Event amounts are stored
  // nominal, so they are NOT inflated — see the spending-target note below.)
  const inflate = (today: number, age: number) =>
    today * Math.pow(1 + inflation, Math.max(0, age - inputs.currentAge));

  const bands = Array.isArray(inputs.spendingBands)
    ? [...inputs.spendingBands].sort((a, b) => a.fromAge - b.fromAge)
    : [];
  const events = Array.isArray(inputs.events) ? inputs.events : [];

  // Main line: total cash (portfolio + net home equity when RM is on).
  const totalCashPath = useMemo(() =>
    rows.map((r, i) => `${i === 0 ? 'M' : 'L'}${x(r.age).toFixed(1)},${y(totalCash(r)).toFixed(1)}`).join(' '),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, hasRm, maxBal, minAge, span]);

  // Portfolio-only component (secondary when RM is on).
  const balancePath = useMemo(() =>
    rows.map((r, i) => `${i === 0 ? 'M' : 'L'}${x(r.age).toFixed(1)},${y(r.startingBalance).toFixed(1)}`).join(' '),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, maxBal, minAge, span]);

  const spendPath = useMemo(() =>
    rows.map((r, i) => `${i === 0 ? 'M' : 'L'}${x(r.age).toFixed(1)},${ys(r.spendingTarget).toFixed(1)}`).join(' '),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, maxSpend, minAge, span]);

  // Market-hypothesis lines (per-age curves over every age in the window).
  const mktAges = useMemo(() => {
    const a: number[] = [];
    for (let age = minAge; age <= maxAge; age++) a.push(age);
    return a;
  }, [minAge, maxAge]);
  const mktRetPath = useMemo(() =>
    mktAges.map((a, i) => `${i === 0 ? 'M' : 'L'}${x(a).toFixed(1)},${ymRet(effRetSeq[a]).toFixed(1)}`).join(' '),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mktAges, effRetSeq, minAge, span]);
  const mktVolPath = useMemo(() =>
    mktAges.map((a, i) => `${i === 0 ? 'M' : 'L'}${x(a).toFixed(1)},${ymVol(effVolSeq[a]).toFixed(1)}`).join(' '),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mktAges, effVolSeq, minAge, span]);

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
      // The dragged Y is a nominal base-spending level at the band's age. The %
      // is (nominal ÷ base nominal at that age) — deflate both to the SAME age
      // (band.fromAge) so the inflation factor cancels, instead of dividing a
      // fromAge-deflated level by today's-dollar desiredSpending (U-08).
      const nominal = Math.max(0, spendAtY(py));
      const baseNominal = inflate(inputs.desiredSpending, band.fromAge);
      const pct = baseNominal > 0 ? Math.min(2, nominal / baseNominal) : 1;
      const rounded = Math.round(pct * 100) / 100;
      if (rounded !== band.pctOfBase) {
        onChange({ ...inputs, spendingBands: bands.map((b, i) => (i === drag.index ? { ...b, pctOfBase: rounded } : b)) });
      }
      return;
    }

    if (drag.kind === 'event') {
      const age = Math.round(Math.min(inputs.maxAge, Math.max(inputs.currentAge, ageAtX(px))));
      // Event amounts are stored NOMINAL (the dollars of that year — confirmed:
      // engine adds them to spendingTarget uninflated), so the dragged Y maps to
      // the amount directly, no deflate (the old code deflated, shrinking the
      // written amount by the inflation factor — U-08/U-10).
      const nominal = Math.max(0, spendAtY(py));
      const rounded = Math.round(nominal / 1000) * 1000;
      onChange({
        ...inputs,
        events: events.map(ev => (ev.id === (drag as { kind: 'event'; id: string }).id
          ? { ...ev, age, amount: rounded }
          : ev))
      });
      return;
    }

    if (drag.kind === 'mkt') {
      // Market-hypothesis anchor: drag horizontally for age, vertically for the
      // value of the field this handle controls (return or volatility). The
      // other field on the anchor is left untouched.
      const age = Math.round(Math.min(inputs.maxAge, Math.max(inputs.currentAge, ageAtX(px))));
      const next = marketPeriods.map(p => {
        if (p.id !== drag.id) return p;
        if (drag.field === 'return') {
          return { ...p, age, return: roundRet(Math.min(RET_MAX, Math.max(RET_MIN, retAtY(py)))) };
        }
        return { ...p, age, volatility: roundVol(Math.min(VOL_MAX, Math.max(VOL_MIN, volAtY(py)))) };
      });
      onChange({ ...inputs, marketPeriods: next });
      return;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag, inputs, bands, events, marketPeriods, minAge, span, maxSpend]);

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

  // Add a market anchor at `age`, seeded with the curve's CURRENT value there
  // so the line is continuous through the new point (no kink). One anchor per
  // age — a double-click on an existing anchor's age is a no-op.
  const addMarketPeriod = (ageRaw: number) => {
    const age = Math.round(Math.min(inputs.maxAge, Math.max(inputs.currentAge, ageRaw)));
    if (marketPeriods.some(p => p.age === age)) return;
    const pt: MarketPeriod = {
      id: newMarketPeriodId(),
      age,
      return: roundRet(effRetSeq[age] ?? inputs.investmentReturn),
      volatility: roundVol(effVolSeq[age] ?? (inputs.returnVolatility ?? 0)),
    };
    onChange({ ...inputs, marketPeriods: [...marketPeriods, pt] });
    setSelectedMkt(pt.id);
  };

  const removeMarketPeriod = (id: string) => {
    onChange({ ...inputs, marketPeriods: marketPeriods.filter(p => p.id !== id) });
    if (selectedMkt === id) setSelectedMkt(null);
  };

  // Double-click adds a market anchor ONLY when it lands in the market strip —
  // the main balance panel and spending panel keep their existing behaviours.
  const handleDoubleClick = (e: React.MouseEvent) => {
    const { px, py } = svgPoint(e);
    if (py >= mktTop && py <= mktTop + MKT_H && px >= PAD.left && px <= W - PAD.right) {
      addMarketPeriod(ageAtX(px));
    }
  };

  const selectedPeriod = marketPeriods.find(p => p.id === selectedMkt) ?? null;

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map(f => f * maxBal);
  const xTicks: number[] = [];
  const step = Math.max(1, Math.round(span / 12));
  for (let a = minAge; a <= maxAge; a += step) xTicks.push(a);

  // The engine's spendingTarget at an age is (base spending × band %, inflated
  // from today's dollars) + (nominal event outflows) + (RM interest). To place or
  // read a spending handle we need the BASE component (no events, no RM), which is
  // also what `desiredSpending × pctOfBase` inflates to. Computing it analytically
  // keeps the handle's drawn height and its drag-write on the same footing (U-08/
  // U-09) — reading the height off `row.spendingTarget` would fold events/RM in.
  const nominalBaseAt = (age: number): number => {
    let pct = 1;
    for (const b of bands) {
      if (age >= b.fromAge) pct = b.pctOfBase;
      else break;
    }
    return inflate(inputs.desiredSpending, age) * pct;
  };

  // Base spending level shown at retirement (nominal, including inflation).
  const retRow = rows.find(r => r.age === inputs.retirementAge);
  const baseSpendLevel = retRow ? nominalBaseAt(inputs.retirementAge) : 0;

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
            — drag the retirement line, spending handles, and event diamonds; double-click the market strip to add a trend anchor; edits re-simulate live
          </span>
        </div>
        <div className="flex items-center gap-3 text-[10px] text-slate-500">
          <span className="inline-flex items-center gap-1" title={hasRm ? 'Total cash: investable portfolio + net home equity. The plan draws on both.' : 'Investable portfolio balance.'}>
            <span className="inline-block w-4 h-1 bg-blue-700 rounded-sm" /> {hasRm ? 'total cash' : 'portfolio'}
          </span>
          {hasRm && (
            <>
              <span className="inline-flex items-center gap-1" title="Investable accounts only (a component of total cash).">
                <span className="inline-block w-4 h-0.5 bg-blue-400" /> portfolio
              </span>
              <span className="inline-flex items-center gap-1" title="Net home equity: home value minus the reverse-mortgage loan. The plan stays afloat on this even after investable accounts reach $0.">
                <span className="inline-block w-4 h-0 border-t-2 border-dashed border-amber-600" /> net home equity
              </span>
            </>
          )}
          <span className="inline-flex items-center gap-1">
            <span className="inline-block w-4 h-0.5 bg-emerald-600" /> spend
          </span>
          <span className="inline-flex items-center gap-1" title="Market hypothesis: the per-age expected return the projection follows. Double-click the market strip to add an anchor; drag up/down for return, sideways for age.">
            <span className="inline-block w-4 h-0.5 bg-violet-600" /> return
          </span>
          <span className="inline-flex items-center gap-1" title="Market hypothesis: the per-age volatility Monte Carlo samples around.">
            <span className="inline-block w-4 h-0 border-t-2 border-dashed border-amber-500" /> volatility
          </span>
        </div>
      </div>
      <div className="p-2">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${TOTAL_H}`}
          className="w-full select-none"
          onMouseMove={e => { if (drag) applyDrag(e); }}
          onDoubleClick={handleDoubleClick}
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

          {/* Main line: total cash (portfolio + net home equity when RM is on) */}
          <path d={totalCashPath} fill="none" stroke="#1d4ed8" strokeWidth="2.5" />

          {hasRm && (
            <>
              {/* Portfolio-only component */}
              <path d={balancePath} fill="none" stroke="#60a5fa" strokeWidth="1.5" />
              {/* Net home equity component */}
              <path d={equityPath} fill="none" stroke="#d97706" strokeWidth="1.5" strokeDasharray="6 3" />
            </>
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
            // Place the handle at the analytic base-spending level for the band's
            // age (no events/RM folded in), matching what the drag writes (U-08).
            if (b.fromAge < minAge || b.fromAge > maxAge) return null;
            return (
              <g key={i} {...handleProps(`band-${i}`, { kind: 'band', index: i })}>
                <rect x={x(b.fromAge) - 5} y={ys(nominalBaseAt(b.fromAge)) - 5} width="10" height="10" rx="2"
                  fill="#10b981" stroke="#fff" strokeWidth="1.5" />
                <title>From age {b.fromAge}: {Math.round(b.pctOfBase * 100)}% of spending — drag to adjust</title>
              </g>
            );
          })}

          {/* Event diamonds (drag both axes) */}
          {events.map((ev: CashEvent) => {
            // Event amounts are already nominal dollars of that year (no inflate).
            const nominal = ev.amount;
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

          {/* Market-hypothesis panel (issue #138): the per-age return curve the
              projection follows (violet) and the volatility curve Monte Carlo
              samples (amber dashed). Double-click the strip to add an anchor;
              drag an anchor vertically for its value, horizontally for its age. */}
          <text x={PAD.left - 6} y={mktTop + 8} textAnchor="end" fontSize="9" fill="#64748b">market</text>
          {/* zero-return reference line */}
          <line x1={PAD.left} x2={W - PAD.right} y1={ymRet(0)} y2={ymRet(0)} stroke="#e2e8f0" strokeWidth="1" />
          <text x={PAD.left - 6} y={ymRet(0) + 3} textAnchor="end" fontSize="8" fill="#a78bfa">0%</text>
          <path d={mktVolPath} fill="none" stroke="#f59e0b" strokeWidth="1.5" strokeDasharray="5 3" />
          <path d={mktRetPath} fill="none" stroke="#7c3aed" strokeWidth="2" />

          {/* Volatility anchors (squares, amber) — only for anchors carrying a σ */}
          {marketPeriods.filter(p => p.volatility != null).map(p => (
            <rect
              key={`mvol-${p.id}`}
              x={x(p.age) - 4.5} y={ymVol(p.volatility!) - 4.5} width="9" height="9" rx="1"
              fill={selectedMkt === p.id ? '#b45309' : '#f59e0b'} stroke="#fff" strokeWidth="1.5"
              className="cursor-move hover:opacity-100"
              opacity={selectedMkt === p.id ? 1 : 0.85}
              onMouseEnter={() => setHover(`mvol-${p.id}`)}
              onMouseLeave={() => setHover(null)}
              onMouseDown={e => { e.preventDefault(); setDrag({ kind: 'mkt', id: p.id, field: 'volatility' }); }}
              onClick={e => { e.stopPropagation(); setSelectedMkt(p.id); }}
            >
              <title>Age {p.age}: σ {(p.volatility! * 100).toFixed(1)}% — drag to adjust; click to select</title>
            </rect>
          ))}

          {/* Return anchors (circles, violet) */}
          {marketPeriods.map(p => (
            <circle
              key={`mret-${p.id}`}
              cx={x(p.age)} cy={ymRet(p.return)} r={selectedMkt === p.id ? 6 : 5}
              fill={selectedMkt === p.id ? '#5b21b6' : '#7c3aed'} stroke="#fff" strokeWidth="1.5"
              className="cursor-move hover:opacity-100"
              opacity={selectedMkt === p.id ? 1 : 0.9}
              onMouseEnter={() => setHover(`mret-${p.id}`)}
              onMouseLeave={() => setHover(null)}
              onMouseDown={e => { e.preventDefault(); setDrag({ kind: 'mkt', id: p.id, field: 'return' }); }}
              onClick={e => { e.stopPropagation(); setSelectedMkt(p.id); }}
            >
              <title>Age {p.age}: {(p.return * 100).toFixed(1)}% — drag to adjust; click to select</title>
            </circle>
          ))}

          {/* Delete affordance for the selected anchor */}
          {selectedPeriod && (
            <g
              className="cursor-pointer"
              onClick={e => { e.stopPropagation(); removeMarketPeriod(selectedPeriod.id); }}
            >
              <rect
                x={x(selectedPeriod.age) + 8} y={ymRet(selectedPeriod.return) - 22}
                width="16" height="16" rx="3" fill="#ef4444"
              />
              <text x={x(selectedPeriod.age) + 16} y={ymRet(selectedPeriod.return) - 10} textAnchor="middle" fontSize="11" fill="#fff" className="pointer-events-none">×</text>
              <title>Delete this anchor</title>
            </g>
          )}
        </svg>
      </div>
    </div>
  );
}
