import { useEffect } from 'react';
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
      <div className="mb-3">
        <span className="text-[11px] text-slate-500">
          {result.windowCount} rolling {result.windowYears}-yr windows · Canadian real returns {startYear}–{endYear}
        </span>
      </div>

      <div>
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          <div className="border-t-2 border-slate-900 pt-2">
            <div className="mb-1 text-[10px] uppercase tracking-[0.16em] text-slate-400">Success Rate</div>
            <div className={`num text-lg font-semibold ${pct >= 90 ? 'text-blue-700' : pct >= 70 ? 'text-amber-700' : 'text-rose-700'}`}>
              {pct}%
            </div>
            <div className="mt-0.5 text-[10px] text-slate-500">{result.successCount}/{result.windowCount} windows never depleted</div>
          </div>
          <div className="border-t-2 border-slate-900 pt-2">
            <div className="mb-1 text-[10px] uppercase tracking-[0.16em] text-slate-400">Worst Window</div>
            <div className="num text-lg font-semibold text-slate-900">{worstWindow ? worstWindow.startYear : '—'}</div>
            <div className="mt-0.5 text-[10px] text-slate-500">
              {worstWindow ? (worstWindow.depleted ? `depleted at ${worstWindow.depletionAge}` : `ends ${formatCurrency(worstWindow.finalBalance)}`) : 'no windows'}
            </div>
          </div>
          <div className="border-t-2 border-slate-900 pt-2">
            <div className="mb-1 text-[10px] uppercase tracking-[0.16em] text-slate-400">Median Ending</div>
            <div className="num text-lg font-semibold text-slate-900">{formatCurrency(result.medianFinalBalance)}</div>
            <div className="mt-0.5 text-[10px] text-slate-500">real (today's) dollars</div>
          </div>
          <div className="border-t-2 border-slate-900 pt-2">
            <div className="mb-1 text-[10px] uppercase tracking-[0.16em] text-slate-400">Best Window</div>
            <div className="num text-lg font-semibold text-slate-900">{bestWindow ? bestWindow.startYear : '—'}</div>
            <div className="mt-0.5 text-[10px] text-slate-500">{bestWindow ? `ends ${formatCurrency(bestWindow.finalBalance)}` : 'no windows'}</div>
          </div>
        </div>

        {/* Window bars: height = ending balance, rose if depleted */}
        <div>
          <div className="mb-1.5 flex items-baseline justify-between">
            <div className="text-[10px] uppercase tracking-[0.16em] text-slate-400">Ending balance by window start year</div>
            <div className="text-[10px] text-slate-400">
              each {result.windowYears}-yr window · coverage {firstStart}–{lastStart + result.windowYears - 1}
            </div>
          </div>
          <div className="flex h-28 items-end gap-px">
            {result.windows.map((w) => {
              const h = Math.max(2, Math.round((Math.max(0, w.finalBalance) / maxAbs) * 100));
              return (
                <div
                  key={w.startYear}
                  title={`${w.startYear}–${w.startYear + result.windowYears - 1}: ${w.depleted ? `depleted at ${w.depletionAge}` : formatCurrency(w.finalBalance)}`}
                  className={`flex-1 ${w.depleted ? 'bg-rose-300' : 'bg-blue-200 hover:bg-blue-400'}`}
                  style={{ height: `${h}%` }}
                />
              );
            })}
          </div>
          {/* Axis: window start on the left, window END (= data coverage) on the right */}
          <div className="mt-1 flex justify-between text-[10px] text-slate-400">
            <span>{firstStart} start</span>
            <span>last window ends {lastStart + result.windowYears - 1}</span>
          </div>
        </div>

        {result.truncated && (
          <p className="mt-3 border-l-2 border-amber-500 px-2.5 py-1 text-[11px] leading-snug text-amber-800">
            Your plan's horizon is longer than the {endYear - startYear + 1}-year historical record,
            so each window was capped at {result.windowYears} years — the backtest doesn't reach your
            full horizon. A very early retirement age is the usual cause.
          </p>
        )}
        <p className="mt-3 text-[11px] leading-snug text-slate-500">
          Each bar replays the plan against one {result.windowYears}-year historical sequence of real
          (after-inflation) returns, with spending held in today's dollars. Bars sit at each window's
          start year; the last window ends in {lastStart + result.windowYears - 1}, so all{' '}
          {endYear - startYear + 1} years of data are used. Rose bars ran out of money before max age.
          60% S&P/TSX total return + 40% GoC long bond, deflated by CPI.
        </p>
      </div>
    </div>
  );
}
