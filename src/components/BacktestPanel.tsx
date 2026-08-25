import { useEffect } from 'react';
import { X, History } from 'lucide-react';
import type { BacktestResult } from '../lib/historicalReturns';
import { HISTORICAL_REAL_RETURNS } from '../lib/historicalReturns';

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: 'CAD',
    maximumFractionDigits: 0,
  }).format(value);
}

interface BacktestPanelProps {
  result: BacktestResult;
  onClose: () => void;
  onMounted?: () => void;
}

// GCP-console style panel: header row, KPI chips, a bar per rolling window.
export function BacktestPanel({ result, onClose, onMounted }: BacktestPanelProps) {
  // Let the parent scroll this panel into view once it's actually in the DOM.
  useEffect(() => { onMounted?.(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const { startYear, returns } = HISTORICAL_REAL_RETURNS;
  const endYear = startYear + returns.length - 1;
  const pct = Math.round(result.successRate * 100);

  const maxAbs = Math.max(
    1,
    ...result.windows.map((w) => Math.abs(w.finalBalance)),
  );

  const firstStart = result.windows[0]?.startYear ?? startYear;
  const lastStart = result.windows[result.windows.length - 1]?.startYear ?? startYear;
  const spanStart = Math.max(1, lastStart - firstStart);
  // Bar center for a window as a fraction of the chart width.
  const pos = (yr: number) => ((yr - firstStart) / spanStart);

  // Major market downturns. A marker sits at the window START whose sequence
  // opens into that downturn, so only downturns at or before the last start
  // year get a marker on the start-year axis (later ones still shaped the last
  // window, just not at a start boundary).
  const CRISES: { year: number; label: string }[] = [
    { year: 1973, label: '1973–74 oil shock' },
    { year: 1981, label: '1981–82 recession' },
    { year: 2000, label: '2000–02 dot-com' },
    { year: 2008, label: '2008 GFC' },
    { year: 2022, label: '2022 rate shock' },
  ].filter((c) => c.year >= firstStart && c.year <= lastStart);

  return (
    <div className="mt-6 bg-white border border-slate-200 rounded">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-200">
        <div className="flex items-center gap-2">
          <History size={15} className="text-slate-500" />
          <h3 className="text-sm font-semibold text-slate-800">Historical Backtest</h3>
          <span className="text-[11px] text-slate-500">
            {result.windowCount} rolling {result.windowYears}-yr windows · Canadian real returns {startYear}–{endYear}
          </span>
        </div>
        <button
          onClick={onClose}
          className="p-1 hover:bg-slate-100 rounded"
          title="Close backtest"
        >
          <X size={15} className="text-slate-500" />
        </button>
      </div>

      <div className="p-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <div className="border border-slate-200 rounded p-3">
            <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Success Rate</div>
            <div className={`text-lg font-semibold ${pct >= 90 ? 'text-emerald-600' : pct >= 70 ? 'text-amber-600' : 'text-red-600'}`}>
              {pct}%
            </div>
            <div className="text-[10px] text-slate-500 mt-0.5">{result.successCount}/{result.windowCount} windows never depleted</div>
          </div>
          <div className="border border-slate-200 rounded p-3">
            <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Worst Window</div>
            <div className="text-lg font-semibold text-slate-900">{result.worstWindow.startYear}</div>
            <div className="text-[10px] text-slate-500 mt-0.5">
              {result.worstWindow.depleted ? `depleted at ${result.worstWindow.depletionAge}` : `ends ${formatCurrency(result.worstWindow.finalBalance)}`}
            </div>
          </div>
          <div className="border border-slate-200 rounded p-3">
            <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Median Ending</div>
            <div className="text-lg font-semibold text-slate-900">{formatCurrency(result.medianFinalBalance)}</div>
            <div className="text-[10px] text-slate-500 mt-0.5">real (today's) dollars</div>
          </div>
          <div className="border border-slate-200 rounded p-3">
            <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Best Window</div>
            <div className="text-lg font-semibold text-slate-900">{result.bestWindow.startYear}</div>
            <div className="text-[10px] text-slate-500 mt-0.5">ends {formatCurrency(result.bestWindow.finalBalance)}</div>
          </div>
        </div>

        {/* Window bars: height = ending balance, red if depleted */}
        <div>
          <div className="flex items-baseline justify-between mb-1.5">
            <div className="text-[10px] uppercase tracking-wider text-slate-500">Ending balance by window start year</div>
            <div className="text-[10px] text-slate-400">
              each {result.windowYears}-yr window · coverage {firstStart}–{lastStart + result.windowYears - 1}
            </div>
          </div>
          <div className="relative">
            {/* Crisis markers: vertical lines at a downturn's start year */}
            {CRISES.map((c) => (
              <div
                key={c.year}
                className="absolute top-0 bottom-0 w-px bg-slate-300"
                style={{ left: `${pos(c.year) * 100}%` }}
                title={c.label}
              />
            ))}
            <div className="flex items-end gap-px h-28">
              {result.windows.map((w) => {
                const h = Math.max(2, Math.round((Math.max(0, w.finalBalance) / maxAbs) * 100));
                return (
                  <div
                    key={w.startYear}
                    title={`${w.startYear}–${w.startYear + result.windowYears - 1}: ${w.depleted ? `depleted at ${w.depletionAge}` : formatCurrency(w.finalBalance)}`}
                    className={`flex-1 rounded-sm ${w.depleted ? 'bg-red-400' : 'bg-blue-400 hover:bg-blue-500'}`}
                    style={{ height: `${h}%` }}
                  />
                );
              })}
            </div>
          </div>
          {/* Axis: window start on the left, window END (= data coverage) on the right */}
          <div className="flex justify-between text-[10px] text-slate-400 mt-1">
            <span>{firstStart} start</span>
            <span>last window ends {lastStart + result.windowYears - 1}</span>
          </div>
          {/* Crisis legend */}
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1.5">
            {CRISES.map((c) => (
              <span key={c.year} className="inline-flex items-center gap-1 text-[10px] text-slate-400">
                <span className="inline-block w-px h-2.5 bg-slate-300" />
                {c.label}
              </span>
            ))}
          </div>
        </div>

        <p className="mt-3 text-[11px] text-slate-500 leading-snug">
          Each bar replays the plan against one {result.windowYears}-year historical sequence of real
          (after-inflation) returns, with spending held in today's dollars. The left axis is each
          window's start year; the right shows that the last window ends in {lastStart + result.windowYears - 1},
          so all {endYear - startYear + 1} years of data are used. Red bars ran out of money before max
          age — the grey markers line up the windows that opened into the 1973–74, 2000–02 and 2008
          downturns, so you can see why those sequences hurt. 60% S&P/TSX total return + 40% GoC long
          bond, deflated by CPI.
        </p>
      </div>
    </div>
  );
}
