import { useEffect } from 'react';
import { History } from 'lucide-react';
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
  onMounted?: () => void;
}

// GCP-console style page: header row, KPI chips, a bar per rolling window.
export function BacktestPanel({ result, onMounted }: BacktestPanelProps) {
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
  const { worstWindow, bestWindow } = result;

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <History size={18} className="text-blue-600" />
        <h2 className="text-lg font-bold text-slate-900">Historical Backtest</h2>
        <span className="text-[11px] text-slate-500">
          {result.windowCount} rolling {result.windowYears}-yr windows · Canadian real returns {startYear}–{endYear}
        </span>
      </div>

      <div>
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
            <div className="text-lg font-semibold text-slate-900">{worstWindow ? worstWindow.startYear : '—'}</div>
            <div className="text-[10px] text-slate-500 mt-0.5">
              {worstWindow ? (worstWindow.depleted ? `depleted at ${worstWindow.depletionAge}` : `ends ${formatCurrency(worstWindow.finalBalance)}`) : 'no windows'}
            </div>
          </div>
          <div className="border border-slate-200 rounded p-3">
            <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Median Ending</div>
            <div className="text-lg font-semibold text-slate-900">{formatCurrency(result.medianFinalBalance)}</div>
            <div className="text-[10px] text-slate-500 mt-0.5">real (today's) dollars</div>
          </div>
          <div className="border border-slate-200 rounded p-3">
            <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Best Window</div>
            <div className="text-lg font-semibold text-slate-900">{bestWindow ? bestWindow.startYear : '—'}</div>
            <div className="text-[10px] text-slate-500 mt-0.5">{bestWindow ? `ends ${formatCurrency(bestWindow.finalBalance)}` : 'no windows'}</div>
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
          {/* Axis: window start on the left, window END (= data coverage) on the right */}
          <div className="flex justify-between text-[10px] text-slate-400 mt-1">
            <span>{firstStart} start</span>
            <span>last window ends {lastStart + result.windowYears - 1}</span>
          </div>
        </div>

        {result.truncated && (
          <p className="mt-3 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2.5 py-1.5 leading-snug">
            Your plan's horizon is longer than the {endYear - startYear + 1}-year historical record,
            so each window was capped at {result.windowYears} years — the backtest doesn't reach your
            full horizon. A very early retirement age is the usual cause.
          </p>
        )}
        <p className="mt-3 text-[11px] text-slate-500 leading-snug">
          Each bar replays the plan against one {result.windowYears}-year historical sequence of real
          (after-inflation) returns, with spending held in today's dollars. Bars sit at each window's
          start year; the last window ends in {lastStart + result.windowYears - 1}, so all{' '}
          {endYear - startYear + 1} years of data are used. Red bars ran out of money before max age.
          60% S&P/TSX total return + 40% GoC long bond, deflated by CPI.
        </p>
      </div>
    </div>
  );
}
