import { useEffect, useMemo, useRef, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Check, ArrowUpRight, ArrowDownRight, Crosshair, Loader2 } from 'lucide-react';
import type { RetirementInputs } from '@retired/engine-core/retirementEngine';
import type { AppConfig } from '@retired/engine-core/appConfig';
import { runStrategies, SUSTAINABLE_SPENDING_CEILING, type StrategyReport } from '@retired/engine-core/strategies';
import { runSpendingSolverAuto } from '../lib/runSpendingSolver';
import type { SolverResult } from '@retired/engine-core/spendingSolver';
import { useAppLocale } from '../lib/localeContext';

function fmt(v: number, locale: string): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 }).format(v);
}

/* The sustainable-spending search caps at an absolute ceiling so a plan with
   more money than it can ever spend doesn't run forever. When a row reports
   exactly that sentinel the honest answer is "no cap reached", not the number. */
function fmtSustainable(v: number, locale: string, noCap: string): string {
  return v >= SUSTAINABLE_SPENDING_CEILING ? noCap : fmt(v, locale);
}

interface OptimizeCardProps {
  inputs: RetirementInputs;
  config: AppConfig;
  onApply: (patch: Partial<RetirementInputs>) => void;
}

/* The two tool halves behind the tabbed card (stable site). Issue #162 gave
   each half its own beta page under the Tools menu — StrategyExplorer answers
   "which lever helps?", SpendingSolver answers "how much can I spend?" — and
   the card stays their tabbed container on the old site so neither surface
   forks its logic. */
export function OptimizeCard({ inputs, config, onApply }: OptimizeCardProps) {
  const { t } = useTranslation('pages');
  const [tab, setTab] = useState<'strategies' | 'solver'>('strategies');

  return (
    <div>
      {/* Tabs */}
      <div className="mb-3 flex gap-4">
        {(['strategies', 'solver'] as const).map(tabKey => (
          <button
            key={tabKey}
            onClick={() => setTab(tabKey)}
            className={`-mb-px border-b-2 px-1 pb-2 text-xs font-medium ${tab === tabKey
              ? 'border-slate-900 text-slate-900'
              : 'border-transparent text-slate-400 hover:text-slate-900'}`}
          >
            {tabKey === 'strategies' ? t('optimizer.tabStrategies') : t('optimizer.tabSolver')}
          </button>
        ))}
      </div>

      {tab === 'strategies' && <StrategyExplorer inputs={inputs} config={config} onApply={onApply} />}
      {tab === 'solver' && <SpendingSolver inputs={inputs} config={config} onApply={onApply} />}
    </div>
  );
}

/** Deterministic named-variant replays, scored on sustainable spending. */
export function StrategyExplorer({ inputs, config, onApply }: OptimizeCardProps) {
  const { t } = useTranslation('pages');
  const report: StrategyReport = useMemo(() => runStrategies(inputs, config), [inputs, config]);

  return (
    <div>
      {/* Suggested actions */}
      <div className="mb-4 border-l-2 border-blue-700 pl-3">
        <div className="mb-1.5 text-xs font-semibold text-slate-900">{t('optimizer.suggested')}</div>
        <ul className="space-y-1">
          {report.suggestedActions.map((a, i) => (
            <li key={i} className="text-xs leading-snug text-slate-600">• {a}</li>
          ))}
        </ul>
      </div>

      {/* Strategy table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-slate-200 text-left text-[10px] uppercase tracking-[0.16em] text-slate-400">
              <th className="py-1.5 pr-3 font-semibold">{t('optimizer.strategy')}</th>
              <th className="py-1.5 pr-3 font-semibold text-right">{t('optimizer.sustainable')}</th>
              <th className="py-1.5 pr-3 font-semibold text-right">{t('optimizer.vsCurrent')}</th>
              <th className="py-1.5 pr-3 font-semibold text-right">{t('optimizer.lifetimeTax')}</th>
              <th className="py-1.5 pr-3 font-semibold text-right" title={t('optimizer.lifetimeGisTitle')}>{t('optimizer.lifetimeGis')}</th>
              <th className="py-1.5 pr-3 font-semibold text-right">{t('optimizer.endingBalance')}</th>
              <th className="py-1.5 font-semibold text-right">{t('optimizer.apply')}</th>
            </tr>
          </thead>
          <tbody>
            <StrategyRow r={report.baseline} isBaseline onApply={onApply} />
            {report.strategies.map(s => (
              <StrategyRow key={s.id} r={s} onApply={onApply} />
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-[11px] text-slate-500 leading-snug">
        {t('optimizer.foot')}
      </p>
    </div>
  );
}

/** Target-success-rate spending solve: the verdict, inverted. */
export function SpendingSolver({ inputs, config, onApply }: OptimizeCardProps) {
  const { t } = useTranslation('pages');
  const { locale } = useAppLocale();
  const [targetPct, setTargetPct] = useState(90);
  const [solverBusy, setSolverBusy] = useState(false);
  const [solverResult, setSolverResult] = useState<SolverResult | null>(null);
  const [solverError, setSolverError] = useState<string | null>(null);
  const cancelSolver = useRef<(() => void) | null>(null);

  // Cancel any in-flight solve when the card closes or unmounts.
  useEffect(() => () => cancelSolver.current?.(), []);

  const runSolver = () => {
    cancelSolver.current?.();
    setSolverBusy(true);
    setSolverError(null);
    setSolverResult(null);
    cancelSolver.current = runSpendingSolverAuto(
      {
        inputs, config,
        targetSuccessRate: targetPct / 100,
        volatility: inputs.returnVolatility,
        runs: 500,
      },
      (res) => { setSolverResult(res); setSolverBusy(false); },
      (msg) => { setSolverError(msg); setSolverBusy(false); },
    );
  };

  return (
    <div className="max-w-xl">
      <p className="mb-3 text-[11px] leading-snug text-slate-500">
        <Trans i18nKey="optimizer.lead" ns="pages" values={{ vol: (inputs.returnVolatility * 100).toFixed(0) }} />
      </p>

      <div className="mb-3 flex items-end gap-3">
        <div>
          <label className="mb-1 block text-[11px] text-slate-500">{t('optimizer.targetRate')}</label>
          <input
            type="number" min={50} max={99} step={1}
            value={targetPct}
            onChange={e => setTargetPct(Math.min(99, Math.max(50, parseInt(e.target.value) || 90)))}
            className="w-24 border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-800 focus:border-slate-900 focus:outline-none"
          />
        </div>
        <button
          onClick={runSolver}
          disabled={solverBusy}
          className="flex items-center gap-1.5 bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {solverBusy ? <Loader2 size={13} className="animate-spin" /> : <Crosshair size={13} />}
          {solverBusy ? t('optimizer.solving') : t('optimizer.solve')}
        </button>
      </div>

      {solverError && <div className="mb-2 text-xs text-rose-700">✕ {solverError}</div>}

      {solverResult && (
        <div className="border border-slate-200 bg-slate-50 p-3">
          {!solverResult.feasible && (
            <p className="text-xs leading-snug text-rose-700">
              {t('optimizer.infeasible', { pct: Math.round(solverResult.targetSuccessRate * 100) })}
            </p>
          )}
          {solverResult.feasible && solverResult.unconstrained && (
            <p className="text-xs leading-snug text-slate-700">
              {t('optimizer.unconstrained', { pct: Math.round(solverResult.targetSuccessRate * 100) })}
            </p>
          )}
          {solverResult.feasible && !solverResult.unconstrained && (
            <>
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="num text-xl font-bold text-slate-900">{fmt(solverResult.spending, locale)}</span>
                <span className="text-xs text-slate-500">{t('optimizer.perYearMax')}</span>
              </div>
              <div className="mt-1.5 text-[11px] leading-snug text-slate-500">
                {t('optimizer.succeeds', {
                  pct: (solverResult.achievedSuccessRate * 100).toFixed(1),
                  target: Math.round(solverResult.targetSuccessRate * 100),
                })}
                {solverResult.nextStepSuccessRate !== null &&
                  t('optimizer.oneStepHigher', { pct: (solverResult.nextStepSuccessRate * 100).toFixed(1) })}
                {t('optimizer.currentSpends', { amount: fmt(inputs.desiredSpending, locale) })}
                {solverResult.spending > inputs.desiredSpending
                  ? t('optimizer.headroom', { amount: fmt(solverResult.spending - inputs.desiredSpending, locale) })
                  : solverResult.spending < inputs.desiredSpending
                    ? t('optimizer.over', { amount: fmt(inputs.desiredSpending - solverResult.spending, locale) })
                    : t('optimizer.atLevel')}
              </div>
              <div className="mt-2.5 flex items-center gap-2">
                <button
                  onClick={() => onApply({ desiredSpending: solverResult.spending })}
                  className="flex items-center gap-1.5 bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700"
                >
                  <Check size={13} /> {t('optimizer.applyYr', { amount: fmt(solverResult.spending, locale) })}
                </button>
                <span className="text-[10px] text-slate-400">{t('optimizer.writesDesired')}</span>
              </div>
            </>
          )}
          <p className="mt-2.5 text-[10px] text-slate-400 leading-snug border-t border-slate-200 pt-2">
            {t('optimizer.approx')}
          </p>
        </div>
      )}
    </div>
  );
}

function StrategyRow({ r, isBaseline = false, onApply }: {
  r: StrategyReport['baseline'];
  isBaseline?: boolean;
  onApply: (patch: Partial<RetirementInputs>) => void;
}) {
  const { t } = useTranslation('pages');
  const { locale } = useAppLocale();
  const up = r.deltaSpending > 0;
  const down = r.deltaSpending < 0;
  return (
    <tr className={`border-b border-slate-100 ${isBaseline ? 'bg-slate-50' : ''}`}>
      <td className="py-1.5 pr-3">
        <div className="font-medium text-slate-900">{r.name}</div>
        <div className="text-[10px] text-slate-500">{r.description}</div>
      </td>
      <td className="num py-1.5 pr-3 text-right text-slate-800">{fmtSustainable(r.sustainableSpending, locale, t('optimizer.noCap'))}</td>
      <td className={`num py-1.5 pr-3 text-right font-medium ${up ? 'text-blue-700' : down ? 'text-rose-700' : 'text-slate-400'}`}>
        {isBaseline ? '—' : (
          <span className="inline-flex items-center gap-0.5 justify-end">
            {up && <ArrowUpRight size={11} />}
            {down && <ArrowDownRight size={11} />}
            {fmt(Math.abs(r.deltaSpending), locale)}
          </span>
        )}
      </td>
      <td className="num py-1.5 pr-3 text-right text-slate-700">{fmt(r.lifetimeTax, locale)}</td>
      <td className="num py-1.5 pr-3 text-right text-slate-700">{r.lifetimeGis > 0 ? fmt(r.lifetimeGis, locale) : '—'}</td>
      <td className={`num py-1.5 pr-3 text-right ${r.survived ? 'text-slate-700' : 'font-medium text-rose-700'}`}>
        {r.survived ? fmt(r.endingBalance, locale) : t('optimizer.outAt', { age: r.depletionAge })}
      </td>
      <td className="py-1.5 text-right">
        {!isBaseline && (
          <button
            onClick={() => onApply(r.patch)}
            className="border border-slate-300 px-2 py-0.5 text-[11px] font-medium text-slate-700 hover:border-slate-900 hover:text-slate-900"
          >
            {t('optimizer.apply')}
          </button>
        )}
      </td>
    </tr>
  );
}
