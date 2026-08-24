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
}

// GCP-console style panel: header row, KPI chips, a bar per rolling window.
export function BacktestPanel({ result, onClose }: BacktestPanelProps) {
  const { startYear, returns } = HISTORICAL_REAL_RETURNS;
  const endYear = startYear + returns.length - 1;
  const pct = Math.round(result.successRate * 100);

  const maxAbs = Math.max(
    1,
    ...result.windows.map((w) => Math.abs(w.finalBalance)),
  );

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
        <div className="grid grid-cols-4 gap-3 mb-4">
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
          <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1.5">Ending balance by window start year</div>
          <div className="flex items-end gap-px h-28">
            {result.windows.map((w) => {
              const h = Math.max(2, Math.round((Math.max(0, w.finalBalance) / maxAbs) * 100));
              return (
                <div
                  key={w.startYear}
                  title={`${w.startYear}: ${w.depleted ? `depleted at ${w.depletionAge}` : formatCurrency(w.finalBalance)}`}
                  className={`flex-1 rounded-sm ${w.depleted ? 'bg-red-400' : 'bg-blue-400 hover:bg-blue-500'}`}
                  style={{ height: `${h}%` }}
                />
              );
            })}
          </div>
          <div className="flex justify-between text-[10px] text-slate-400 mt-1">
            <span>{result.windows[0]?.startYear}</span>
            <span>{result.windows[result.windows.length - 1]?.startYear}</span>
          </div>
        </div>

        <p className="mt-3 text-[11px] text-slate-500 leading-snug">
          Each bar replays the plan against one historical sequence of real (after-inflation)
          returns, with spending held in today's dollars. Red bars ran out of money before max
          age — a plan that survives the 1973–74, 2000–02 and 2008 sequences is robust to
          sequence-of-returns risk. 60% S&P/TSX total return + 40% GoC long bond, deflated by CPI.
        </p>
      </div>
    </div>
  );
}
