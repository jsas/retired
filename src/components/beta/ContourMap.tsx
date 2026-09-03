// The map — the blue spending-contour pad at the heart of the f7 dashboard.
// It plots retirement age (x) against yearly spending (y) and shades where the
// plan holds: the blue line is the boundary where the plan stops holding, the
// wash below it is ground that holds, the bare paper above is where the money
// runs out early. The dot is "you are here" — drag it (or use the faders) and
// the verdict moves with it.
//
// The terrain (boundary curves) comes from src/lib terrain math in
// packages/engine-core/contour.ts, computed from the REAL engine. The ground
// depends on everything EXCEPT the two axes, so it's cached by terrainKey and
// only recomputed when a ground input (market, balances, benefits…) changes —
// dragging the dot never re-runs the engine.
import { useMemo, useRef, useState, useCallback, useEffect } from 'react';
import type { RetirementInputs } from '@retired/engine-core/retirementEngine';
import type { AppConfig } from '@retired/engine-core/appConfig';
import {
  buildBands, smoothPath, xFrac, yFrac, ageAtFrac, spendAtFrac, terrainKey,
  type TerrainWindow, type PlotBox,
} from '@retired/engine-core/contour';
import { BLUE, BLUE_DEEP, RED_DOT, AMBER_DOT, HAIRLINE, HAIRLINE_STRONG, FAINT, INK } from '../../design/tokens';
import { Legend } from '../../design/primitives';

// Plot geometry (viewBox units). Matches the mock's 720×480 pad.
const VW = 720, VH = 480;
const BOX: PlotBox = { left: 56, right: 700, top: 20, bottom: 432 };

export interface ContourMapProps {
  inputs: RetirementInputs;
  config: AppConfig;
  /** The axis window — retire age × spending, from the lever ranges. */
  window: TerrainWindow;
  onChange: (next: RetirementInputs) => void;
}

function statusOf(inputs: RetirementInputs, bands: { green: number[] }, win: TerrainWindow): 'holds' | 'borderline' | 'short' {
  // Compare current spending to the green boundary at the current retire age.
  const cols = bands.green.length - 1;
  const f = Math.min(1, Math.max(0, (inputs.retirementAge - win.ageMin) / (win.ageMax - win.ageMin)));
  const idx = Math.round(f * cols);
  const boundary = bands.green[idx];
  const margin = boundary - inputs.desiredSpending; // + = headroom below the line
  const span = win.spendTop - win.spendBottom;
  if (margin >= 0) return 'holds';
  if (margin > -span * 0.08) return 'borderline'; // within 8% of the window below the line
  return 'short';
}

export function ContourMap({ inputs, config, window: win, onChange }: ContourMapProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [dragging, setDragging] = useState(false);

  // Recompute the ground only when a ground input changes (terrainKey), not on
  // every render — dragging the dot changes retireAge/spending, which are axes.
  const key = terrainKey(inputs);
  const bands = useMemo(
    () => buildBands(inputs, config, win, { cols: 80, bisect: 14 }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key, config, win.ageMin, win.ageMax, win.spendTop, win.spendBottom],
  );

  const greenPath = useMemo(() => smoothPath(bands.green, win, BOX), [bands, win]);
  const deepPath = useMemo(() => smoothPath(bands.deep, win, BOX), [bands, win]);
  const status = statusOf(inputs, bands, win);

  const dotX = BOX.left + xFrac(inputs.retirementAge, win) * (BOX.right - BOX.left);
  const dotY = BOX.top + yFrac(inputs.desiredSpending, win) * (BOX.bottom - BOX.top);
  const dotColor = status === 'holds' ? BLUE : status === 'borderline' ? AMBER_DOT : RED_DOT;

  // The hold-wash: area under the green boundary, filled to the plot bottom.
  const washPath = useMemo(() => {
    const d = smoothPath(bands.green, win, BOX);
    return `${d} L ${BOX.right} ${BOX.bottom} L ${BOX.left} ${BOX.bottom} Z`;
  }, [bands, win]);

  const applyPoint = useCallback((clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return;
    const r = svg.getBoundingClientRect();
    // Convert screen px → viewBox units, then → data, clamped to the window.
    const vx = ((clientX - r.left) / r.width) * VW;
    const vy = ((clientY - r.top) / r.height) * VH;
    const fx = Math.min(1, Math.max(0, (vx - BOX.left) / (BOX.right - BOX.left)));
    const fy = Math.min(1, Math.max(0, (vy - BOX.top) / (BOX.bottom - BOX.top)));
    const age = Math.round(ageAtFrac(fx, win));
    const spend = Math.round(spendAtFrac(fy, win) / 1000) * 1000;
    onChange({ ...inputs, retirementAge: age, desiredSpending: spend });
  }, [inputs, onChange, win]);

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    setDragging(true);
    applyPoint(e.clientX, e.clientY);
  };
  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (dragging) applyPoint(e.clientX, e.clientY);
  };
  const endDrag = () => setDragging(false);
  useEffect(() => {
    if (!dragging) return;
    const up = () => setDragging(false);
    window.addEventListener('pointerup', up);
    return () => window.removeEventListener('pointerup', up);
  }, [dragging]);

  // Grid: verticals every 5 ages, horizontals every $20k.
  const vTicks: number[] = [];
  for (let a = Math.ceil(win.ageMin / 5) * 5; a <= win.ageMax; a += 5) vTicks.push(a);
  const hTicks: number[] = [];
  for (let s = Math.ceil(win.spendBottom / 20000) * 20000; s <= win.spendTop; s += 20000) hTicks.push(s);

  const fmtK = (v: number) => '$' + Math.round(v / 1000) + 'k';

  return (
    <div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${VW} ${VH}`}
        className="block w-full touch-none select-none border bg-white"
        style={{ borderColor: HAIRLINE, cursor: dragging ? 'grabbing' : 'crosshair' }}
        role="img"
        aria-label="Contour map of plan success over retirement age and yearly spending"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
      >
        <defs>
          <linearGradient id="holdWash" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={BLUE} stopOpacity="0.05" />
            <stop offset="100%" stopColor={BLUE_DEEP} stopOpacity="0.20" />
          </linearGradient>
        </defs>

        {/* grid */}
        <g>
          {vTicks.map(a => {
            const x = BOX.left + xFrac(a, win) * (BOX.right - BOX.left);
            return <line key={`v${a}`} x1={x} y1={BOX.top} x2={x} y2={BOX.bottom} stroke={HAIRLINE} strokeWidth="1" />;
          })}
          {hTicks.map(s => {
            const y = BOX.top + yFrac(s, win) * (BOX.bottom - BOX.top);
            return <line key={`h${s}`} x1={BOX.left} y1={y} x2={BOX.right} y2={y} stroke={HAIRLINE} strokeWidth="1" />;
          })}
          <rect x={BOX.left} y={BOX.top} width={BOX.right - BOX.left} height={BOX.bottom - BOX.top} fill="none" stroke={HAIRLINE_STRONG} strokeWidth="1" />
        </g>

        {/* the hold-wash + the faint deep (comfortable) contour */}
        <path d={washPath} fill="url(#holdWash)" stroke="none" />
        <path d={deepPath} fill="none" stroke={BLUE} strokeOpacity="0.22" strokeWidth="1.2" />

        {/* the boundary — the curve where the plan stops holding */}
        <path d={greenPath} fill="none" stroke={BLUE} strokeWidth="2" strokeLinejoin="round" />

        {/* axis labels */}
        <g fontSize="11" fill={FAINT} fontFamily="inherit">
          {vTicks.map(a => (
            <text key={`vl${a}`} x={BOX.left + xFrac(a, win) * (BOX.right - BOX.left)} y={BOX.bottom + 18} textAnchor="middle">{a}</text>
          ))}
          {hTicks.map(s => (
            <text key={`hl${s}`} x={BOX.left - 8} y={BOX.top + yFrac(s, win) * (BOX.bottom - BOX.top) + 4} textAnchor="end">{fmtK(s)}</text>
          ))}
          <text x={(BOX.left + BOX.right) / 2} y={VH - 8} textAnchor="middle" fontSize="12" fontWeight="600" fill="#475569">the age you stop working →</text>
          <text x="16" y={(BOX.top + BOX.bottom) / 2} textAnchor="middle" fontSize="12" fontWeight="600" fill="#475569" transform={`rotate(-90 16 ${(BOX.top + BOX.bottom) / 2})`}>what you spend each year →</text>
        </g>

        {/* you are here — halo + dot + square tag */}
        <g>
          <circle cx={dotX} cy={dotY} r="24" fill={dotColor} opacity="0.12" />
          <circle cx={dotX} cy={dotY} r="11" fill={dotColor} stroke="#fff" strokeWidth="3" style={{ cursor: 'grab' }} />
          <DotTag x={dotX} y={dotY} text={`you are here · ${inputs.retirementAge}, ${fmtK(inputs.desiredSpending)}`} />
        </g>
      </svg>

      <div className="mt-3">
        <Legend items={[
          { swatch: 'line-blue', label: 'the boundary — the curve where the plan stops holding' },
          { swatch: 'box-blue', label: `below it, the money lasts past ${inputs.maxAge}` },
          { swatch: 'box-rose', label: 'above it, it runs out early' },
        ]} />
      </div>
    </div>
  );
}

/* The square label tag above the dot — dark, flat, no pill. */
function DotTag({ x, y, text }: { x: number; y: number; text: string }) {
  const w = text.length * 6.4 + 16;
  const h = 24;
  // Sit above the dot unless near the top of the plot; clamp inside the frame.
  const above = y - 20 - h > 8;
  const ty = above ? y - 20 - h : y + 20;
  const tx = Math.min(VW - w - 4, Math.max(4, x - w / 2));
  return (
    <g pointerEvents="none">
      <rect x={tx} y={ty} width={w} height={h} fill={INK} opacity="0.92" />
      <text x={tx + w / 2} y={ty + h / 2 + 4} textAnchor="middle" fontSize="11.5" fontWeight="600" fill="#fff" fontFamily="inherit">
        {text}
      </text>
    </g>
  );
}
