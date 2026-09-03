import { useEffect, useMemo, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import type { MonteCarloRequest, MonteCarloResults } from '@retired/engine-core/monteCarlo';
import { runMonteCarloAuto } from '../lib/runMonteCarlo';
import { BLUE } from '../design/tokens';

interface MonteCarloChartProps {
  request: MonteCarloRequest;
  retirementAge: number;
  onRefresh?: () => void;
  onMounted?: () => void;
}

const W = 860;
const H = 360;
const PAD = { top: 16, right: 16, bottom: 28, left: 64 };

function formatMoney(v: number): string {
  if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `$${Math.round(v / 1_000)}k`;
  return `$${Math.round(v)}`;
}

function formatMoneyFull(v: number): string {
  return v.toLocaleString('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 });
}

export function MonteCarloChart({ request, retirementAge, onRefresh, onMounted }: MonteCarloChartProps) {
  const [results, setResults] = useState<MonteCarloResults | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hoverAge, setHoverAge] = useState<number | null>(null);

  // Fires once on mount so the parent can scroll this panel into view — more
  // reliable than scrolling from the parent, since the panel is guaranteed to
  // be in the DOM and laid out here.
  useEffect(() => { onMounted?.(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    // Worker when available; inline fallback for the single-file build
    // (file:// can't construct module workers).
    const cancel = runMonteCarloAuto(request, setResults, setError);
    return cancel;
  }, [request]);

  const chart = useMemo(() => {
    if (!results) return null;
    const bands = results.percentileBands;
    if (bands.length < 2) return null;

    const ages = bands.map(b => b.age);
    const minAge = ages[0];
    const maxAge = ages[ages.length - 1];
    const maxBalance = Math.max(1, ...bands.map(b => b.p90));
    // Start y at 0 — probability of ruin matters more than headroom.
    const x = (age: number) => PAD.left + ((age - minAge) / Math.max(1, maxAge - minAge)) * (W - PAD.left - PAD.right);
    const y = (v: number) => PAD.top + (1 - v / maxBalance) * (H - PAD.top - PAD.bottom);

    const bandPath = (upper: keyof typeof bands[number], lower: keyof typeof bands[number]) => {
      const top = bands.map((b, i) => `${i === 0 ? 'M' : 'L'}${x(b.age).toFixed(1)},${y(b[upper] as number).toFixed(1)}`).join(' ');
      const bottom = [...bands].reverse().map(b => `L${x(b.age).toFixed(1)},${y(b[lower] as number).toFixed(1)}`).join(' ');
      return `${top} ${bottom} Z`;
    };
    const linePath = (key: keyof typeof bands[number]) =>
      bands.map((b, i) => `${i === 0 ? 'M' : 'L'}${x(b.age).toFixed(1)},${y(b[key] as number).toFixed(1)}`).join(' ');

    const yTicks = [0, 0.25, 0.5, 0.75, 1].map(f => f * maxBalance);
    const xTicks: number[] = [];
    const step = Math.max(1, Math.round((maxAge - minAge) / 12));
    for (let a = minAge; a <= maxAge; a += step) xTicks.push(a);

    return { bands, x, y, bandPath, linePath, yTicks, xTicks, minAge, maxAge, maxBalance };
  }, [results]);

  const hoverBand = hoverAge != null && chart
    ? chart.bands.reduce((best, b) => Math.abs(b.age - hoverAge) < Math.abs(best.age - hoverAge) ? b : best, chart.bands[0])
    : null;

  const successPct = results ? (results.successRate * 100).toFixed(1) : null;
  const successColor = results
    ? results.successRate >= 0.9 ? 'text-blue-700' : results.successRate >= 0.75 ? 'text-amber-700' : 'text-rose-700'
    : '';

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-slate-500">
          {request.runs} runs · {(request.volatility * 100).toFixed(1)}% volatility · fat-tailed (Student-t)
        </span>
        <div className="flex items-center gap-1">
          {onRefresh && (
            <button onClick={onRefresh} className="flex items-center gap-1.5 border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:border-slate-900 hover:text-slate-900" title="Re-run the simulation with the current plan">
              <RefreshCw size={13} /> Re-run
            </button>
          )}
        </div>
      </div>

      {/* Body */}
      <div>
        {!results && !error && (
          <div className="flex items-center justify-center gap-2 py-16 text-slate-500 text-sm">
            <Loader2 size={16} className="animate-spin" />
            Running {request.runs} simulations…
          </div>
        )}
        {error && (
          <div className="py-8 text-center text-sm text-rose-700">Simulation failed: {error}</div>
        )}
        {results && chart && (
          <>
            {/* Summary stats — hairline top rules, not cards */}
            <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="border-t-2 border-slate-900 pt-2">
                <div className="text-[11px] uppercase tracking-[0.16em] text-slate-400">Success rate</div>
                <div className={`num text-xl font-bold ${successColor}`}>{successPct}%</div>
                <div className="text-[11px] text-slate-500">
                  {results.successCount} of {results.runs} runs funded to age {request.inputs.maxAge}
                </div>
              </div>
              <div className="border-t-2 border-slate-900 pt-2">
                <div className="text-[11px] uppercase tracking-[0.16em] text-slate-400">Median final balance</div>
                <div className="num text-xl font-bold text-slate-900">{formatMoney(results.medianFinalBalance)}</div>
                <div className="text-[11px] text-slate-500">portfolio value at age {request.inputs.maxAge}</div>
              </div>
              <div className="border-t-2 border-slate-900 pt-2">
                <div className="text-[11px] uppercase tracking-[0.16em] text-slate-400">Depletion risk</div>
                <div className="num text-xl font-bold text-slate-900">
                  {((1 - results.successRate) * 100).toFixed(1)}%
                </div>
                <div className="text-[11px] text-slate-500">
                  {results.depletionHistogram.length > 0
                    ? `earliest depletion at age ${results.depletionHistogram[0].age}`
                    : 'no run depleted'}
                </div>
              </div>
            </div>

            {/* Fan chart */}
            <div className="relative">
              <svg
                viewBox={`0 0 ${W} ${H}`}
                className="w-full"
                onMouseMove={e => {
                  const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
                  const px = ((e.clientX - rect.left) / rect.width) * W;
                  const age = chart.minAge + ((px - PAD.left) / (W - PAD.left - PAD.right)) * (chart.maxAge - chart.minAge);
                  setHoverAge(Math.round(Math.min(chart.maxAge, Math.max(chart.minAge, age))));
                }}
                onMouseLeave={() => setHoverAge(null)}
              >
                {/* Y gridlines + labels */}
                {chart.yTicks.map((t, i) => (
                  <g key={i}>
                    <line x1={PAD.left} x2={W - PAD.right} y1={chart.y(t)} y2={chart.y(t)} stroke="#e2e8f0" strokeWidth="1" />
                    <text x={PAD.left - 6} y={chart.y(t) + 3} textAnchor="end" fontSize="10" fill="#64748b">
                      {formatMoney(t)}
                    </text>
                  </g>
                ))}
                {/* X labels */}
                {chart.xTicks.map(a => (
                  <text key={a} x={chart.x(a)} y={H - 8} textAnchor="middle" fontSize="10" fill="#64748b">
                    {a}
                  </text>
                ))}

                {/* Probability bands */}
                <path d={chart.bandPath('p90', 'p10')} fill="#3b82f6" opacity="0.12" />
                <path d={chart.bandPath('p75', 'p25')} fill="#3b82f6" opacity="0.22" />
                <path d={chart.linePath('p50')} fill="none" stroke="#1d4ed8" strokeWidth="2" />

                {/* Retirement marker */}
                <line
                  x1={chart.x(retirementAge)} x2={chart.x(retirementAge)}
                  y1={PAD.top} y2={H - PAD.bottom}
                  stroke="#94a3b8" strokeWidth="1" strokeDasharray="4 3"
                />
                <text x={chart.x(retirementAge) + 4} y={PAD.top + 10} fontSize="10" fill="#64748b">
                  retire
                </text>

                {/* Hover crosshair */}
                {hoverBand && (
                  <line
                    x1={chart.x(hoverBand.age)} x2={chart.x(hoverBand.age)}
                    y1={PAD.top} y2={H - PAD.bottom}
                    stroke="#334155" strokeWidth="1" opacity="0.4"
                  />
                )}
              </svg>

              {/* Hover tooltip */}
              {hoverBand && (
                <div className="absolute top-2 right-2 border border-slate-200 bg-white px-3 py-2 font-mono text-[11px] pointer-events-none">
                  <div className="font-semibold text-slate-900 mb-1">Age {hoverBand.age}</div>
                  <div className="text-slate-600">90th: {formatMoneyFull(hoverBand.p90)}</div>
                  <div className="text-slate-600">75th: {formatMoneyFull(hoverBand.p75)}</div>
                  <div className="text-blue-700 font-semibold">median: {formatMoneyFull(hoverBand.p50)}</div>
                  <div className="text-slate-600">25th: {formatMoneyFull(hoverBand.p25)}</div>
                  <div className="text-slate-600">10th: {formatMoneyFull(hoverBand.p10)}</div>
                </div>
              )}
            </div>

            {/* Legend — square swatches, the design-token blue (no raw hex). */}
            <div className="flex items-center gap-4 mt-2 text-[11px] text-slate-600">
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 inline-block" style={{ background: BLUE, opacity: 0.12 }} /> 10th–90th percentile
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 inline-block" style={{ background: BLUE, opacity: 0.3 }} /> 25th–75th percentile
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-4 h-0.5 bg-blue-700 inline-block" /> median
              </span>
            </div>

            {/* Depletion histogram */}
            {results.depletionHistogram.length > 0 && (
              <div className="mt-4">
                <div className="mb-1.5 text-[11px] uppercase tracking-[0.16em] text-slate-400">
                  When failed runs ran out of money
                </div>
                <div className="flex h-16 items-end gap-px">
                  {results.depletionHistogram.map(({ age, count }) => {
                    const maxCount = Math.max(...results.depletionHistogram.map(d => d.count));
                    return (
                      <div
                        key={age}
                        className="flex-1 bg-rose-300 hover:bg-rose-500"
                        style={{ height: `${Math.max(4, (count / maxCount) * 100)}%` }}
                        title={`Age ${age}: ${count} run${count === 1 ? '' : 's'} depleted`}
                      />
                    );
                  })}
                </div>
                <div className="flex justify-between text-[10px] text-slate-500 mt-0.5">
                  <span>{results.depletionHistogram[0].age}</span>
                  <span>{results.depletionHistogram[results.depletionHistogram.length - 1].age}</span>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
