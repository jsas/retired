/**
 * ProjectionTimeline — money over age, in the design language. A soft balance
 * area-fill above a clean axis with hairline ticks and token colours — the same
 * look as the dashboard's "Your life on one line" — abstracted so any surface
 * (dashboard, steering, Compare) draws it instead of forking its own SVG.
 *
 * It takes one or more balance series (one line/area each) with a toggleable
 * legend, optional auxiliary overlay lines (spend, market/portfolio components,
 * home equity), and optional labelled pins (retirement, depletion, "you").
 * The retirement pin renders as a vertical rule ('line'), a square marker on
 * the axis ('dot'), or a labelled pin ('pin') depending on the surface.
 */
import { useMemo, useState } from 'react';
import { INK, FAINT, HAIRLINE, RED_DOT } from './tokens';

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

const PALETTE = ['#1d4ed8', '#059669', '#d97706', '#be123c', '#7c3aed', '#0e7490'];

const W = 1000, H = 190;
const AXIS = 118;           // y of the baseline the area sits on
const LL = 34, LR = 978;    // plot left/right
const AREA_TOP = 18;        // tallest the area rises above the axis

function fmtAxis(v: number): string {
  if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `$${Math.round(v / 1_000)}k`;
  return `$${Math.round(v)}`;
}

export function ProjectionTimeline({ series, overlays = [], pins = [], marker, onToggleSeries }: {
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

  return (
    <div>
      {/* Legend — one swatch per line; click to toggle. */}
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
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="block w-full select-none" role="img"
        aria-label={`Projection from age ${minAge} to ${maxAge}`}>
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
      </svg>
    </div>
  );
}

export { INK as TIMELINE_INK, RED_DOT as TIMELINE_RED };
