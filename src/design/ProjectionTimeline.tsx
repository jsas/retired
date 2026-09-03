/**
 * ProjectionTimeline — money over age, in the design language. A soft balance
 * area-fill above a clean axis with hairline ticks and token colours — the same
 * look as the dashboard's "Your life on one line" — abstracted so any surface
 * (dashboard, steering, Compare) draws it instead of forking its own SVG.
 *
 * It takes one or more balance series (one line/area each) with a toggleable
 * legend, optional auxiliary overlay lines (spend, market/portfolio components,
 * home equity), optional labelled pins (retirement, depletion, "you"), and —
 * when wired to the plan (BetaApp) — three interactive layers ported from the
 * old site's TimelineChart (restyled, same math):
 *   - the spend strip: the plan's nominal spending target, base handle draggable
 *   - event diamonds: one-time/recurring cash events, draggable age + amount
 *   - the market strip: the market-hypothesis anchors (return circles, volatility
 *     squares) — double-click to drop an anchor, drag to move, × to delete
 * Interactive layers appear only when their callbacks are provided (draggable
 * prop), so read-only surfaces (Compare, print, steering) are untouched.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { INK, FAINT, HAIRLINE, RED_DOT, AMBER_DOT } from './tokens';

export interface TimelineSeries {
  id: string;
  label: string;
  /** Line colour (a design token). Defaults cycle a small palette. */
  color?: string;
  /** Balance by age — the line. */
  points: { age: number; value: number }[];
  /** Fill the area under the line (default: only when it's the sole series). */
  area?: boolean;
}

/** An auxiliary line overlaid on the same age axis — the spending target, a
 *  market/portfolio component, net home equity. Toggles in the legend. */
export interface OverlayLine {
  id: string;
  label: string;
  color: string;
  points: { age: number; value: number }[];
  /** 'dashed' for secondary/component lines (e.g. net home equity). */
  dash?: boolean;
}

export interface TimelinePin {
  age: number;
  label: string;
  color?: string;
  /** Where the label sits relative to the axis. */
  place?: 'above' | 'below';
  /** Anchor for the label text. */
  anchor?: 'start' | 'middle' | 'end';
}

/** One cash event rendered as a draggable diamond in the spend strip. */
export interface TimelineEvent {
  id: string;
  age: number;
  /** Always positive; `direction` decides the sign. NOMINAL dollars of that year. */
  amount: number;
  direction: 'in' | 'out';
  label: string;
}

/** One market-hypothesis anchor rendered in the market strip. */
export interface TimelineMarketAnchor {
  id: string;
  age: number;
  return: number;
  volatility?: number;
}

const PALETTE = ['#1d4ed8', '#059669', '#d97706', '#be123c', '#7c3aed', '#0e7490'];

const W = 1000, H = 190;
const AXIS = 118;           // y of the baseline the area sits on
const LL = 34, LR = 978;    // plot left/right
const AREA_TOP = 18;        // tallest the area rises above the axis
// The spend + market strips hang BELOW the balance axis (each with a gap).
const STRIP_GAP = 16;
const STRIP_H = 44;         // visible strip height (hairline box)
const SPEND_TOP = H + STRIP_GAP;
const SPEND_AXIS = SPEND_TOP + STRIP_H;       // bottom of the spend strip
const MKT_TOP = SPEND_AXIS + STRIP_GAP;
const MKT_AXIS = MKT_TOP + STRIP_H;           // bottom of the market strip
const TOTAL_H = MKT_AXIS + 4;                 // full viewBox height (strips on)

function fmtAxis(v: number): string {
  if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `$${Math.round(v / 1_000)}k`;
  return `$${Math.round(v)}`;
}

export function ProjectionTimeline({
  series,
  overlays = [],
  pins = [],
  marker,
  onToggleSeries,
  // Interactive layers (all optional — read-only surfaces pass none):
  spend,
  events = [],
  onEventChange,
  anchors = [],
  onAnchorsChange,
  onSpendChange,
}: {
  series: TimelineSeries[];
  /** Extra lines on the same axis — spend, market components, home equity. */
  overlays?: OverlayLine[];
  /** Labelled pins on the axis (you / work ends / money runs out). */
  pins?: TimelinePin[];
  /** A retirement marker. 'line' = dashed rule, 'dot' = square on the axis,
   *  omitted = none. (Use `pins` for a labelled marker instead.) */
  marker?: { age: number; style?: 'line' | 'dot' };
  /** Legend entries toggle when provided. */
  onToggleSeries?: (id: string) => void;
  /** The spend strip: the plan's nominal spending target by age. Renders the
   *  green spend line + the draggable base-spending handle at retirement. */
  spend?: { points: { age: number; value: number }[]; baseSpend?: number };
  /** Cash events — diamonds in the spend strip, draggable age + amount. */
  events?: TimelineEvent[];
  onEventChange?: (ev: TimelineEvent) => void;
  /** Market-hypothesis anchors — the market strip under the spend strip. */
  anchors?: TimelineMarketAnchor[];
  /** Anchor edits: moves update in place (same id), adds append, deletes are
   *  absent from the list the × returns. */
  onAnchorsChange?: (next: TimelineMarketAnchor[]) => void;
  /** Called with today's-dollar spending when the base handle drags. */
  onSpendChange?: (todayDollars: number) => void;
}) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const isOn = (id: string) => !hidden.has(id);
  const toggle = (id: string) => {
    setHidden(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    onToggleSeries?.(id);
  };

  const visibleSeries = series.filter(s => s.points.length > 0 && isOn(s.id));
  const visibleOverlays = overlays.filter(o => o.points.length > 0 && isOn(o.id));
  const allLines = [
    ...series.map((s, i) => ({ id: s.id, label: s.label, color: s.color ?? PALETTE[i % PALETTE.length] })),
    ...overlays.map(o => ({ id: o.id, label: o.label, color: o.color })),
  ];

  const { minAge, maxAge, maxVal } = useMemo(() => {
    const on = [...visibleSeries, ...visibleOverlays];
    const ages = on.flatMap(s => s.points.map(p => p.age));
    const vals = on.flatMap(s => s.points.map(p => p.value));
    return {
      minAge: ages.length ? Math.min(...ages) : 0,
      maxAge: ages.length ? Math.max(...ages) : 1,
      maxVal: Math.max(1, ...vals),
    };
  }, [visibleSeries, visibleOverlays]);

  const span = Math.max(1, maxAge - minAge);
  const x = (age: number) => LL + ((age - minAge) / span) * (LR - LL);
  const y = (v: number) => AXIS - (Math.max(0, v) / maxVal) * (AXIS - AREA_TOP);

  // Year ticks along the axis; taller/darker every 5.
  const ticks = useMemo(() => {
    const out: { age: number; x: number; major: boolean }[] = [];
    for (let a = minAge; a <= maxAge; a++) out.push({ age: a, x: x(a), major: a % 5 === 0 });
    return out;
  }, [minAge, maxAge]); // eslint-disable-line react-hooks/exhaustive-deps

  const linePath = (pts: { age: number; value: number }[]) =>
    pts.map((p, j) => `${j === 0 ? 'M' : 'L'}${x(p.age).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const areaPath = (pts: { age: number; value: number }[]) =>
    `M ${x(pts[0].age).toFixed(1)},${AXIS} ${pts.map(p => `L ${x(p.age).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ')} L ${x(pts[pts.length - 1].age).toFixed(1)},${AXIS} Z`;

  // A plan with no savings degenerates: every value is 0, the top axis label
  // reads $0 and the line sits flat — it looks broken. Say why instead.
  const hasAnything = maxVal >= 2;

  // ── Interactive layers (strips) ──────────────────────────────────────────
  // Present only when the caller passes them; strips mount below the balance
  // axis and the viewBox grows to fit. Geometry helpers are shared by render
  // + drag math.
  const showStrips = !!spend || onEventChange != null || onAnchorsChange != null;

  // The spend strip's own scale: 0..max spending target (or 1).
  const maxSpend = Math.max(1, ...(spend?.points.map(p => p.value) ?? [0]));
  const ySp = (v: number) => SPEND_TOP + (1 - Math.max(0, Math.min(1, v / maxSpend))) * STRIP_H;
  const spendAtY = (py: number) => Math.max(0, (1 - (py - SPEND_TOP) / STRIP_H)) * maxSpend;

  // The market strip's scale: return −30%..+20%, volatility 0..40%.
  const RET_MIN = -0.30, RET_MAX = 0.20, VOL_MAX = 0.40;
  const yRet = (v: number) => MKT_TOP + (1 - (v - RET_MIN) / (RET_MAX - RET_MIN)) * STRIP_H;
  const retAtY = (py: number) => RET_MIN + (1 - (py - MKT_TOP) / STRIP_H) * (RET_MAX - RET_MIN);
  const yVol = (v: number) => MKT_TOP + (1 - v / VOL_MAX) * STRIP_H;
  const volAtY = (py: number) => Math.min(VOL_MAX, Math.max(0, (1 - (py - MKT_TOP) / STRIP_H) * VOL_MAX));

  // Drag state — one at a time: an event diamond or a market anchor.
  const svgRef = useRef<SVGSVGElement>(null);
  type Drag =
    | { kind: 'event'; id: string }
    | { kind: 'mkt'; id: string; field: 'return' | 'volatility' };
  const [drag, setDrag] = useState<Drag | null>(null);
  // The selected market anchor (the floating × targets it).
  const [selectedMkt, setSelectedMkt] = useState<string | null>(null);

  const svgPoint = (e: React.PointerEvent) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return {
      px: ((e.clientX - rect.left) / rect.width) * W,
      py: ((e.clientY - rect.top) / rect.height) * TOTAL_H,
    };
  };

  const ageAtX = (px: number) => Math.round(minAge + ((px - LL) / (LR - LL)) * span);

  // Event drag: horizontal for age, vertical for the (nominal) amount.
  const moveEvent = (e: React.PointerEvent, id: string) => {
    const pt = svgPoint(e);
    const ev = events.find(v => v.id === id);
    if (!pt || !ev) return;
    const next = { ...ev, age: Math.max(minAge, Math.min(maxAge, ageAtX(pt.px))), amount: Math.max(0, Math.round(spendAtY(pt.py) / 1000) * 1000) };
    if (next.age !== ev.age || next.amount !== ev.amount) onEventChange?.(next);
  };

  // Market-anchor drag: horizontal for age, vertical for the dragged field.
  const moveAnchor = (e: React.PointerEvent, id: string, field: 'return' | 'volatility') => {
    const pt = svgPoint(e);
    const a = anchors.find(v => v.id === id);
    if (!pt) return;
    const roundRet = (v: number) => Math.round(v * 1000) / 1000;
    const roundVol = (v: number) => Math.round(v * 200) / 200;
    const next = { ...a, age: Math.max(minAge, Math.min(maxAge, ageAtX(pt.px))) } as TimelineMarketAnchor;
    if (field === 'return') next.return = roundRet(Math.min(RET_MAX, Math.max(RET_MIN, retAtY(pt.py))));
    else next.volatility = roundVol(volAtY(pt.py));
    if (next.age !== a?.age || next.return !== a?.return || next.volatility !== a?.volatility) {
      onAnchorsChange?.(anchors.map(v => (v.id === id ? next : v)));
    }
  };

  // Window-level move/up so a drag continues outside the SVG (pointer capture
  // covers the same case natively; window listeners are the belt to suspenders).
  const onStripPointerDown = (kind: Drag['kind'], id: string, field?: 'return' | 'volatility') =>
    (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDrag(kind === 'event' ? { kind, id } : { kind, id, field: field! });
      if (kind === 'mkt') setSelectedMkt(id);
      const el = e.currentTarget as Element;
      el.setPointerCapture?.(e.pointerId);
    };

  useEffect(() => {
    if (!drag) return;
    const move = (e: PointerEvent) => {
      // React's synthetic pointer events don't fire on window; route through a
      // manual dispatch: re-derive (clientX/Y) and call the same math.
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect) return;
      const fake = { clientX: e.clientX, clientY: e.clientY } as React.PointerEvent;
      void rect;
      if (drag.kind === 'event') moveEvent(fake, drag.id);
      else moveAnchor(fake, drag.id, drag.field);
    };
    const up = () => setDrag(null);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [drag, events, anchors, minAge, maxAge, span, maxSpend]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      {/* Legend — one swatch per line; click to toggle. Strips add their own
          static (non-toggling) entries so the chart stays self-describing. */}
      <div className="mb-1 flex flex-wrap items-center gap-x-4 gap-y-1">
        {allLines.map(s => {
          const on = isOn(s.id);
          return (
            <button key={s.id} type="button" onClick={() => toggle(s.id)}
              className={`inline-flex items-center gap-1.5 text-[11px] ${on ? 'text-slate-700' : 'text-slate-400 line-through'}`}
              title={on ? `Hide ${s.label}` : `Show ${s.label}`}>
              <span className="inline-block h-2 w-4" style={{ background: s.color, opacity: on ? 1 : 0.3 }} />
              {s.label}
            </button>
          );
        })}
        {spend && (
          <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-400">
            <span className="inline-block h-0.5 w-4" style={{ background: '#059669' }} /> spend
          </span>
        )}
        {onEventChange != null && (
          <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-400">
            <span className="inline-block h-2 w-2 rotate-45" style={{ background: '#0ea5e9' }} />
            <span className="inline-block h-2 w-2 rotate-45" style={{ background: RED_DOT }} /> events
          </span>
        )}
        {onAnchorsChange != null && (
          <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-400">
            <span className="inline-block h-2 w-4" style={{ background: '#7c3aed' }} /> market
          </span>
        )}
      </div>

      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${showStrips ? TOTAL_H : H}`}
        className="block w-full select-none"
        role="img"
        aria-label={`Projection from age ${minAge} to ${maxAge}`}
        onDoubleClick={(e) => {
          if (!onAnchorsChange) return;
          const rect = svgRef.current?.getBoundingClientRect();
          if (!rect) return;
          const py = ((e.clientY - rect.top) / rect.height) * (showStrips ? TOTAL_H : H);
          if (py < MKT_TOP) return; // only the market strip accepts new anchors
          const px = ((e.clientX - rect.left) / rect.width) * W;
          const age = ageAtX(px);
          if (anchors.some(a => a.age === age)) return;
          // Seed with the flat constants — the engine ramps anchors into the
          // baseline, and the strip's curve redraws from the real sequence.
          onAnchorsChange([...anchors, {
            id: `mp-${age}-${Math.round(performance.now() % 1e6).toString(36)}`,
            age,
            return: 0.05,
            volatility: 0.10,
          }]);
        }}
      >
        {!hasAnything && (
          <text x={W / 2} y={H / 2} textAnchor="middle" fontSize="13" fill={FAINT} fontFamily="inherit">
            Nothing to draw — the plan has no savings yet. Add balances on the Details page.
          </text>
        )}
        {hasAnything && (
          <>
          {/* balance areas (soft fill) */}
          {visibleSeries.map((s, i) => {
          const fill = s.area ?? visibleSeries.length === 1;
          if (!fill) return null;
          const color = s.color ?? PALETTE[i % PALETTE.length];
          return <path key={`area-${s.id}`} d={areaPath(s.points)} fill={color} opacity="0.06" />;
        })}

        {/* the axis */}
        <line x1={LL} y1={AXIS} x2={LR} y2={AXIS} stroke={INK} strokeWidth="2" />

        {/* year ticks + labels */}
        {ticks.map(t => (
          <line key={t.age} x1={t.x} y1={AXIS} x2={t.x} y2={AXIS + (t.major ? 11 : 6)}
            stroke={t.major ? '#94a3b8' : '#cbd5e1'} strokeWidth={t.major ? 1.5 : 1} />
        ))}
        {ticks.filter(t => t.major).map(t => (
          <text key={`l${t.age}`} x={t.x} y={AXIS + 24} textAnchor="middle" fontSize="11" fill={FAINT} fontFamily="inherit">{t.age}</text>
        ))}

        {/* y reference labels (top + zero) */}
        <text x={LL - 4} y={AREA_TOP + 4} textAnchor="end" fontSize="10" fill={FAINT}>{fmtAxis(maxVal)}</text>
        <text x={LL - 4} y={AXIS + 3} textAnchor="end" fontSize="10" fill={FAINT}>$0</text>

        {/* balance lines */}
        {visibleSeries.map((s, i) => {
          const color = s.color ?? PALETTE[i % PALETTE.length];
          return <path key={s.id} d={linePath(s.points)} fill="none" stroke={color} strokeWidth="2" />;
        })}
        {/* overlay lines */}
        {visibleOverlays.map(s => (
          <path key={s.id} d={linePath(s.points)} fill="none" stroke={s.color} strokeWidth="1.5"
            strokeDasharray={s.dash ? '6 3' : undefined} />
        ))}

        {/* retirement marker */}
        {marker && (marker.style ?? 'line') === 'line' && (
          <line x1={x(marker.age)} x2={x(marker.age)} y1={AREA_TOP} y2={AXIS}
            stroke="#f59e0b" strokeWidth="2" strokeDasharray="5 3" />
        )}
        {marker && marker.style === 'dot' && (
          <rect x={x(marker.age) - 4.5} y={AXIS - 4.5} width="9" height="9" fill="#f59e0b" />
        )}

        {/* labelled pins */}
        {pins.map((p, i) => {
          const px = x(Math.max(minAge, Math.min(maxAge, p.age)));
          const above = (p.place ?? 'above') === 'above';
          const ly = above ? AREA_TOP - 4 : AXIS + 40;
          const color = p.color ?? '#475569';
          return (
            <g key={i}>
              <line x1={px} y1={AXIS} x2={px} y2={above ? ly + 4 : AXIS + 30} stroke={HAIRLINE} strokeWidth="1" />
              <text x={px} y={ly} textAnchor={p.anchor ?? 'middle'} fontSize="11" fontWeight="600" fill={color} fontFamily="inherit">
                {p.label}
              </text>
            </g>
          );
        })}

        {/* ── Spend strip (interactive when handlers arrive) ─────────────── */}
        {showStrips && (
          <g>
            <text x={LL - 4} y={SPEND_TOP + 10} textAnchor="end" fontSize="9" fill={FAINT}>spend</text>
            <rect x={LL} y={SPEND_TOP} width={LR - LL} height={STRIP_H} fill="none" stroke={HAIRLINE} strokeWidth="1" />
            {spend && spend.points.length > 0 && (
              <>
                {/* zero/max reference labels */}
                <text x={LL - 4} y={SPEND_AXIS + 3} textAnchor="end" fontSize="8" fill={FAINT}>{fmtAxis(0)}</text>
                <text x={LL - 4} y={SPEND_TOP + 10} textAnchor="end" fontSize="8" fill={FAINT} />
                <path d={spend.points.map((p, j) => `${j === 0 ? 'M' : 'L'}${x(p.age).toFixed(1)},${ySp(p.value).toFixed(1)}`).join(' ')}
                  fill="none" stroke="#059669" strokeWidth="1.5" />
                {/* base-spending handle at retirement (draggable) */}
                {spend.baseSpend != null && onSpendChange && (
                  <circle
                    cx={x(marker?.age ?? pins.find(p => p.label.startsWith('work ends'))?.age ?? minAge)}
                    cy={ySp(spend.baseSpend)}
                    r="5" fill="#059669" stroke="#fff" strokeWidth="1.5" className="cursor-ns-resize"
                    onPointerDown={(e) => {
                      e.preventDefault(); e.stopPropagation();
                      const el = e.currentTarget as Element;
                      el.setPointerCapture?.(e.pointerId);
                      const move = (ev: PointerEvent) => {
                        const rect = svgRef.current?.getBoundingClientRect();
                        if (!rect) return;
                        const py = ((ev.clientY - rect.top) / rect.height) * TOTAL_H;
                        onSpendChange(Math.round(spendAtY(py) / 500) * 500);
                      };
                      const up = () => {
                        window.removeEventListener('pointermove', move);
                        window.removeEventListener('pointerup', up);
                      };
                      window.addEventListener('pointermove', move);
                      window.addEventListener('pointerup', up);
                    }}
                  >
                    <title>Desired spending — drag to adjust</title>
                  </circle>
                )}
                {/* cash-event diamonds (draggable age + amount) */}
                {events.map(ev => (
                  <rect
                    key={ev.id}
                    x={x(ev.age) - 4.5} y={ySp(Math.min(maxSpend, ev.amount)) - 4.5} width="9" height="9"
                    transform={`rotate(45 ${x(ev.age)} ${ySp(Math.min(maxSpend, ev.amount))})`}
                    fill={ev.direction === 'in' ? '#0ea5e9' : RED_DOT} stroke="#fff" strokeWidth="1.5"
                    className="cursor-move"
                    onPointerDown={onStripPointerDown('event', ev.id)}
                  >
                    <title>{ev.label}: {ev.direction === 'in' ? '+' : '−'}{fmtAxis(ev.amount)} at age {ev.age} — drag to move/resize</title>
                  </rect>
                ))}
              </>
            )}
          </g>
        )}

        {/* ── Market strip (interactive when onAnchorsChange arrives) ────── */}
        {showStrips && (
          <g>
            <text x={LL - 4} y={MKT_TOP + 10} textAnchor="end" fontSize="9" fill={FAINT}>market</text>
            <rect x={LL} y={MKT_TOP} width={LR - LL} height={STRIP_H} fill="none" stroke={HAIRLINE} strokeWidth="1"
              className={onAnchorsChange ? 'cursor-crosshair' : undefined} />
            {/* zero-return reference */}
            <line x1={LL} x2={LR} y1={yRet(0)} y2={yRet(0)} stroke={HAIRLINE} strokeWidth="1" />
            <text x={LL - 4} y={yRet(0) + 3} textAnchor="end" fontSize="8" fill="#7c3aed">0%</text>

            {/* volatility curve + anchors (amber dashed, squares) */}
            {(() => {
              const withVol = anchors.filter(a => a.volatility != null);
              return (
                <>
                  {withVol.length > 0 && (
                    <path
                      d={withVol.map((a, i) => `${i === 0 ? 'M' : 'L'}${x(a.age).toFixed(1)},${yVol(a.volatility!).toFixed(1)}`).join(' ')}
                      fill="none" stroke={AMBER_DOT} strokeWidth="1.5" strokeDasharray="5 3" />
                  )}
                  {withVol.map(a => (
                    <rect key={`v-${a.id}`}
                      x={x(a.age) - 4} y={yVol(a.volatility!) - 4} width="8" height="8"
                      fill={selectedMkt === a.id ? '#b45309' : AMBER_DOT} stroke="#fff" strokeWidth="1.5"
                      className="cursor-move" opacity={drag?.kind === 'mkt' && drag.id === a.id ? 1 : 0.9}
                      onPointerDown={onStripPointerDown('mkt', a.id, 'volatility')}
                      onClick={(e) => { e.stopPropagation(); setSelectedMkt(a.id); }}
                    >
                      <title>Age {a.age}: σ {(a.volatility! * 100).toFixed(0)}% — drag to adjust; click to select</title>
                    </rect>
                  ))}
                </>
              );
            })()}

            {/* return curve + anchors (violet, circles) */}
            {anchors.length > 0 && (
              <path
                d={anchors.map((a, i) => `${i === 0 ? 'M' : 'L'}${x(a.age).toFixed(1)},${yRet(a.return).toFixed(1)}`).join(' ')}
                fill="none" stroke="#7c3aed" strokeWidth="2" />
            )}
            {anchors.map(a => (
              <circle key={`r-${a.id}`}
                cx={x(a.age)} cy={yRet(a.return)} r={selectedMkt === a.id ? 5.5 : 4.5}
                fill={selectedMkt === a.id ? '#5b21b6' : '#7c3aed'} stroke="#fff" strokeWidth="1.5"
                className="cursor-move" opacity={drag?.kind === 'mkt' && drag.id === a.id ? 1 : 0.9}
                onPointerDown={onStripPointerDown('mkt', a.id, 'return')}
                onClick={(e) => { e.stopPropagation(); setSelectedMkt(a.id); }}
              >
                <title>Age {a.age}: {(a.return * 100).toFixed(1)}% — drag to adjust; click to select</title>
              </circle>
            ))}

            {/* delete affordance for the selected anchor */}
            {selectedMkt && (() => {
              const a = anchors.find(v => v.id === selectedMkt);
              if (!a) return null;
              return (
                <g className="cursor-pointer"
                  onClick={(e) => {
                    e.stopPropagation();
                    onAnchorsChange?.(anchors.filter(v => v.id !== a.id));
                    setSelectedMkt(null);
                  }}>
                  <rect x={x(a.age) + 8} y={yRet(a.return) - 20} width="15" height="15" fill={RED_DOT} />
                  <text x={x(a.age) + 15.5} y={yRet(a.return) - 8.5} textAnchor="middle" fontSize="10" fill="#fff" className="pointer-events-none">×</text>
                  <title>Delete this anchor</title>
                </g>
              );
            })()}
          </g>
        )}
          </>
        )}
      </svg>
    </div>
  );
}

export { INK as TIMELINE_INK, RED_DOT as TIMELINE_RED };
