import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ArrowUpRight, ArrowDownRight, Crosshair, Loader2 } from 'lucide-react';
import type { RetirementInputs } from '@retired/engine-core/retirementEngine';
import type { AppConfig } from '@retired/engine-core/appConfig';
import { runStrategies, SUSTAINABLE_SPENDING_CEILING, type StrategyReport } from '@retired/engine-core/strategies';
import { runSpendingSolverAuto } from '../lib/runSpendingSolver';
import type { SolverResult } from '@retired/engine-core/spendingSolver';

function fmt(v: number): string {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 }).format(v);
}

/* The sustainable-spending search caps at an absolute ceiling so a plan with
   more money than it can ever spend doesn't run forever. When a row reports
   exactly that sentinel the honest answer is "no cap reached", not the number. */
function fmtSustainable(v: number): string {
  return v >= SUSTAINABLE_SPENDING_CEILING ? 'No cap reached' : fmt(v);
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
  const [tab, setTab] = useState<'strategies' | 'solver'>('strategies');

  return (
    <div>
      {/* Tabs */}
      <div className="mb-3 flex gap-4">
        {(['strategies', 'solver'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`-mb-px border-b-2 px-1 pb-2 text-xs font-medium ${tab === t
              ? 'border-slate-900 text-slate-900'
              : 'border-transparent text-slate-400 hover:text-slate-900'}`}
          >
            {t === 'strategies' ? 'Strategy Explorer' : 'Solver'}
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
  const report: StrategyReport = useMemo(() => runStrategies(inputs, config), [inputs, config]);

  return (
    <div>
      {/* Suggested actions */}
      <div className="mb-4 border-l-2 border-blue-700 pl-3">
        <div className="mb-1.5 text-xs font-semibold text-slate-900">Suggested course of action</div>
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
              <th className="py-1.5 pr-3 font-semibold">Strategy</th>
              <th className="py-1.5 pr-3 font-semibold text-right">Sustainable spending</th>
              <th className="py-1.5 pr-3 font-semibold text-right">vs current</th>
              <th className="py-1.5 pr-3 font-semibold text-right">Lifetime tax</th>
              <th className="py-1.5 pr-3 font-semibold text-right" title="Cumulative Guaranteed Income Supplement received over the plan — RRSP/RRIF withdrawals and pensions claw it back 50¢/$, TFSA does not.">Lifetime GIS</th>
              <th className="py-1.5 pr-3 font-semibold text-right">Ending balance</th>
              <th className="py-1.5 font-semibold text-right">Apply</th>
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
        Each row replays the full projection with one change and binary-searches the highest flat
        yearly spending that survives to max age — deterministic, no randomness. "Apply" writes that
        lever into your inputs (unsaved until you click Save).
      </p>
    </div>
  );
}

/** Target-success-rate spending solve: the verdict, inverted. */
export function SpendingSolver({ inputs, config, onApply }: OptimizeCardProps) {
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
        Invert the verdict: pick a confidence level and the solver finds the <strong>most you can
        spend per year</strong> while your Monte Carlo still succeeds that often. It binary-searches
        spending against 500 randomized market futures ({(inputs.returnVolatility * 100).toFixed(0)}%
        volatility), then you can apply the result to your plan.
      </p>

      <div className="mb-3 flex items-end gap-3">
        <div>
          <label className="mb-1 block text-[11px] text-slate-500">Target success rate (%)</label>
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
          {solverBusy ? 'Solving…' : 'Solve'}
        </button>
      </div>

      {solverError && <div className="mb-2 text-xs text-rose-700">✕ {solverError}</div>}

      {solverResult && (
        <div className="border border-slate-200 bg-slate-50 p-3">
          {!solverResult.feasible && (
            <p className="text-xs leading-snug text-rose-700">
              No spending level reaches {Math.round(solverResult.targetSuccessRate * 100)}% success —
              the plan depletes even at $0 spending (fixed costs are too high). Lower your expenses or
              add income first.
            </p>
          )}
          {solverResult.feasible && solverResult.unconstrained && (
            <p className="text-xs leading-snug text-slate-700">
              Even very high spending clears {Math.round(solverResult.targetSuccessRate * 100)}% success —
              the plan is not spending-constrained. You can spend freely within the tested range.
            </p>
          )}
          {solverResult.feasible && !solverResult.unconstrained && (
            <>
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="num text-xl font-bold text-slate-900">{fmt(solverResult.spending)}</span>
                <span className="text-xs text-slate-500">/yr max sustainable spending (today's $)</span>
              </div>
              <div className="mt-1.5 text-[11px] leading-snug text-slate-500">
                succeeds {(solverResult.achievedSuccessRate * 100).toFixed(1)}% of the time
                (target {Math.round(solverResult.targetSuccessRate * 100)}%)
                {solverResult.nextStepSuccessRate !== null &&
                  ` · one step higher only ${(solverResult.nextStepSuccessRate * 100).toFixed(1)}%`}
                {' '}· current plan spends {fmt(inputs.desiredSpending)}/yr
                {solverResult.spending > inputs.desiredSpending
                  ? ` (${fmt(solverResult.spending - inputs.desiredSpending)} headroom)`
                  : solverResult.spending < inputs.desiredSpending
                    ? ` (${fmt(inputs.desiredSpending - solverResult.spending)} over — you're above the sustainable level)`
                    : ' (right at the sustainable level)'}
              </div>
              <div className="mt-2.5 flex items-center gap-2">
                <button
                  onClick={() => onApply({ desiredSpending: solverResult.spending })}
                  className="flex items-center gap-1.5 bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700"
                >
                  <Check size={13} /> Apply {fmt(solverResult.spending)}/yr
                </button>
                <span className="text-[10px] text-slate-400">writes to Desired Spending (unsaved until you Save)</span>
              </div>
            </>
          )}
          <p className="mt-2.5 text-[10px] text-slate-400 leading-snug border-t border-slate-200 pt-2">
            Approximate: the answer is exact for the 500 futures tested, but a fresh batch of futures
            lands within a point or two. Higher targets → lower sustainable spending.
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
  const up = r.deltaSpending > 0;
  const down = r.deltaSpending < 0;
  return (
    <tr className={`border-b border-slate-100 ${isBaseline ? 'bg-slate-50' : ''}`}>
      <td className="py-1.5 pr-3">
        <div className="font-medium text-slate-900">{r.name}</div>
        <div className="text-[10px] text-slate-500">{r.description}</div>
      </td>
      <td className="num py-1.5 pr-3 text-right text-slate-800">{fmtSustainable(r.sustainableSpending)}</td>
      <td className={`num py-1.5 pr-3 text-right font-medium ${up ? 'text-blue-700' : down ? 'text-rose-700' : 'text-slate-400'}`}>
        {isBaseline ? '—' : (
          <span className="inline-flex items-center gap-0.5 justify-end">
            {up && <ArrowUpRight size={11} />}
            {down && <ArrowDownRight size={11} />}
            {fmt(Math.abs(r.deltaSpending))}
          </span>
        )}
      </td>
      <td className="num py-1.5 pr-3 text-right text-slate-700">{fmt(r.lifetimeTax)}</td>
      <td className="num py-1.5 pr-3 text-right text-slate-700">{r.lifetimeGis > 0 ? fmt(r.lifetimeGis) : '—'}</td>
      <td className={`num py-1.5 pr-3 text-right ${r.survived ? 'text-slate-700' : 'font-medium text-rose-700'}`}>
        {r.survived ? fmt(r.endingBalance) : `out at ${r.depletionAge}`}
      </td>
      <td className="py-1.5 text-right">
        {!isBaseline && (
          <button
            onClick={() => onApply(r.patch)}
            className="border border-slate-300 px-2 py-0.5 text-[11px] font-medium text-slate-700 hover:border-slate-900 hover:text-slate-900"
          >
            Apply
          </button>
        )}
      </td>
    </tr>
  );
}
