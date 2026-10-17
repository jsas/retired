import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { BacktestResult } from '../lib/historicalReturns';
import { HISTORICAL_REAL_RETURNS } from '../lib/historicalReturns';
import { useAppLocale } from '../lib/localeContext';

function formatCurrency(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
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
  const { t } = useTranslation('pages');
  const { locale } = useAppLocale();
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
          {t('backtestUi.windows', { count: result.windowCount, years: result.windowYears, from: startYear, to: endYear })}
        </span>
      </div>

      <div>
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          <div className="border-t-2 border-slate-900 pt-2">
            <div className="mb-1 text-[10px] uppercase tracking-[0.16em] text-slate-400">{t('backtestUi.successRate')}</div>
            <div className={`num text-lg font-semibold ${pct >= 90 ? 'text-blue-700' : pct >= 70 ? 'text-amber-700' : 'text-rose-700'}`}>
              {pct}%
            </div>
            <div className="mt-0.5 text-[10px] text-slate-500">{t('backtestUi.neverDepleted', { ok: result.successCount, total: result.windowCount })}</div>
          </div>
          <div className="border-t-2 border-slate-900 pt-2">
            <div className="mb-1 text-[10px] uppercase tracking-[0.16em] text-slate-400">{t('backtestUi.worst')}</div>
            <div className="num text-lg font-semibold text-slate-900">{worstWindow ? worstWindow.startYear : '—'}</div>
            <div className="mt-0.5 text-[10px] text-slate-500">
              {worstWindow ? (worstWindow.depleted ? t('backtestUi.depletedAt', { age: worstWindow.depletionAge }) : t('backtestUi.ends', { amount: formatCurrency(worstWindow.finalBalance, locale) })) : t('backtestUi.noWindows')}
            </div>
          </div>
          <div className="border-t-2 border-slate-900 pt-2">
            <div className="mb-1 text-[10px] uppercase tracking-[0.16em] text-slate-400">{t('backtestUi.medianEnding')}</div>
            <div className="num text-lg font-semibold text-slate-900">{formatCurrency(result.medianFinalBalance, locale)}</div>
            <div className="mt-0.5 text-[10px] text-slate-500">{t('backtestUi.realDollars')}</div>
          </div>
          <div className="border-t-2 border-slate-900 pt-2">
            <div className="mb-1 text-[10px] uppercase tracking-[0.16em] text-slate-400">{t('backtestUi.best')}</div>
            <div className="num text-lg font-semibold text-slate-900">{bestWindow ? bestWindow.startYear : '—'}</div>
            <div className="mt-0.5 text-[10px] text-slate-500">{bestWindow ? t('backtestUi.ends', { amount: formatCurrency(bestWindow.finalBalance, locale) }) : t('backtestUi.noWindows')}</div>
          </div>
        </div>

        {/* Window bars: height = ending balance, rose if depleted */}
        <div>
          <div className="mb-1.5 flex items-baseline justify-between">
            <div className="text-[10px] uppercase tracking-[0.16em] text-slate-400">{t('backtestUi.endingByStart')}</div>
            <div className="text-[10px] text-slate-400">
              {t('backtestUi.eachWindow', { years: result.windowYears, from: firstStart, to: lastStart + result.windowYears - 1 })}
            </div>
          </div>
          <div className="flex h-28 items-end gap-px">
            {result.windows.map((w) => {
              const h = Math.max(2, Math.round((Math.max(0, w.finalBalance) / maxAbs) * 100));
              return (
                <div
                  key={w.startYear}
                  title={w.depleted
                    ? t('backtestUi.barTitleDepleted', { from: w.startYear, to: w.startYear + result.windowYears - 1, age: w.depletionAge })
                    : t('backtestUi.barTitleOk', { from: w.startYear, to: w.startYear + result.windowYears - 1, amount: formatCurrency(w.finalBalance, locale) })}
                  className={`flex-1 ${w.depleted ? 'bg-rose-300' : 'bg-blue-200 hover:bg-blue-400'}`}
                  style={{ height: `${h}%` }}
                />
              );
            })}
          </div>
          {/* Axis: window start on the left, window END (= data coverage) on the right */}
          <div className="mt-1 flex justify-between text-[10px] text-slate-400">
            <span>{t('backtestUi.start', { year: firstStart })}</span>
            <span>{t('backtestUi.lastEnds', { year: lastStart + result.windowYears - 1 })}</span>
          </div>
        </div>

        {result.truncated && (
          <p className="mt-3 border-l-2 border-amber-500 px-2.5 py-1 text-[11px] leading-snug text-amber-800">
            {t('backtestUi.truncated', { years: endYear - startYear + 1, window: result.windowYears })}
          </p>
        )}
        <p className="mt-3 text-[11px] leading-snug text-slate-500">
          {t('backtestUi.foot', { years: result.windowYears, end: lastStart + result.windowYears - 1, record: endYear - startYear + 1 })}
        </p>
      </div>
    </div>
  );
}
