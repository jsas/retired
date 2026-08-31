import { useEffect, useMemo, useRef, useState } from 'react';
import { Sparkles, Check, Lightbulb, ArrowUpRight, ArrowDownRight, Crosshair, Loader2 } from 'lucide-react';
import type { RetirementInputs } from '@retired/engine-core/retirementEngine';
import type { AppConfig } from '@retired/engine-core/appConfig';
import { runStrategies, type StrategyReport } from '@retired/engine-core/strategies';
import { runSpendingSolverAuto } from '../lib/runSpendingSolver';
import type { SolverResult } from '@retired/engine-core/spendingSolver';

function fmt(v: number): string {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 }).format(v);
}

interface OptimizeCardProps {
  inputs: RetirementInputs;
  config: AppConfig;
  onApply: (patch: Partial<RetirementInputs>) => void;
}

export function OptimizeCard({ inputs, config, onApply }: OptimizeCardProps) {
  const report: StrategyReport = useMemo(() => runStrategies(inputs, config), [inputs, config]);
  const [tab, setTab] = useState<'strategies' | 'solver'>('strategies');

  // Solver tab state
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
    <div>
      <div className="flex items-center gap-2 mb-3">
        <Sparkles size={18} className="text-blue-600" />
        <h2 className="text-lg font-bold text-slate-900">Optimize</h2>
        {/* Tabs */}
        <div className="flex gap-1 ml-3">
          {(['strategies', 'solver'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-2.5 py-1 text-xs font-medium rounded ${tab === t ? 'bg-blue-50 text-blue-700' : 'text-slate-600 hover:bg-slate-100'}`}
            >
              {t === 'strategies' ? 'Strategy Explorer' : 'Solver'}
            </button>
          ))}
        </div>
      </div>

      {tab === 'strategies' && (
        <div className="p-4">
          {/* Suggested actions */}
          <div className="mb-4 border border-blue-100 bg-blue-50/60 rounded p-3">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-blue-800 mb-1.5">
              <Lightbulb size={13} /> Suggested course of action
            </div>
            <ul className="space-y-1">
              {report.suggestedActions.map((a, i) => (
                <li key={i} className="text-xs text-slate-700 leading-snug">• {a}</li>
              ))}
            </ul>
          </div>

          {/* Strategy table */}
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-slate-500 border-b border-slate-200">
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
      )}

      {tab === 'solver' && (
        <div className="p-4 max-w-xl">
          <div className="flex items-start gap-2 mb-3">
            <Crosshair size={15} className="text-slate-500 mt-0.5 shrink-0" />
            <p className="text-[11px] text-slate-500 leading-snug">
              Invert the verdict: pick a confidence level and the solver finds the <strong>most you can
              spend per year</strong> while your Monte Carlo still succeeds that often. It binary-searches
              spending against 500 randomized market futures ({(inputs.returnVolatility * 100).toFixed(0)}%
              volatility), then you can apply the result to your plan.
            </p>
          </div>

          <div className="flex items-end gap-3 mb-3">
            <div>
              <label className="block text-[11px] text-slate-500 mb-1">Target success rate (%)</label>
              <input
                type="number" min={50} max={99} step={1}
                value={targetPct}
                onChange={e => setTargetPct(Math.min(99, Math.max(50, parseInt(e.target.value) || 90)))}
                className="w-24 px-2.5 py-1.5 bg-white border border-slate-300 rounded text-xs text-slate-800 focus:outline-none focus:border-blue-500"
              />
            </div>
            <button
              onClick={runSolver}
              disabled={solverBusy}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-xs font-semibold rounded hover:bg-blue-700 disabled:opacity-50"
            >
              {solverBusy ? <Loader2 size={13} className="animate-spin" /> : <Crosshair size={13} />}
              {solverBusy ? 'Solving…' : 'Solve'}
            </button>
          </div>

          {solverError && <div className="text-xs text-red-600 mb-2">✕ {solverError}</div>}

          {solverResult && (
            <div className="border border-slate-200 rounded p-3 bg-slate-50/60">
              {!solverResult.feasible && (
                <p className="text-xs text-red-700 leading-snug">
                  No spending level reaches {Math.round(solverResult.targetSuccessRate * 100)}% success —
                  the plan depletes even at $0 spending (fixed costs are too high). Lower your expenses or
                  add income first.
                </p>
              )}
              {solverResult.feasible && solverResult.unconstrained && (
                <p className="text-xs text-slate-700 leading-snug">
                  Even very high spending clears {Math.round(solverResult.targetSuccessRate * 100)}% success —
                  the plan is not spending-constrained. You can spend freely within the tested range.
                </p>
              )}
              {solverResult.feasible && !solverResult.unconstrained && (
                <>
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="text-lg font-bold text-slate-900">{fmt(solverResult.spending)}</span>
                    <span className="text-xs text-slate-500">/yr max sustainable spending (today's $)</span>
                  </div>
                  <div className="mt-1.5 text-[11px] text-slate-500 leading-snug">
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
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 text-white text-xs font-semibold rounded hover:bg-emerald-700"
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
        <div className="font-medium text-slate-800">{r.name}</div>
        <div className="text-[10px] text-slate-500">{r.description}</div>
      </td>
      <td className="py-1.5 pr-3 text-right text-slate-800">{fmt(r.sustainableSpending)}</td>
      <td className={`py-1.5 pr-3 text-right font-medium ${up ? 'text-emerald-600' : down ? 'text-red-600' : 'text-slate-400'}`}>
        {isBaseline ? '—' : (
          <span className="inline-flex items-center gap-0.5 justify-end">
            {up && <ArrowUpRight size={11} />}
            {down && <ArrowDownRight size={11} />}
            {fmt(Math.abs(r.deltaSpending))}
          </span>
        )}
      </td>
      <td className="py-1.5 pr-3 text-right text-slate-700">{fmt(r.lifetimeTax)}</td>
      <td className="py-1.5 pr-3 text-right text-slate-700">{r.lifetimeGis > 0 ? fmt(r.lifetimeGis) : '—'}</td>
      <td className={`py-1.5 pr-3 text-right ${r.survived ? 'text-slate-700' : 'text-red-600 font-medium'}`}>
        {r.survived ? fmt(r.endingBalance) : `out at ${r.depletionAge}`}
      </td>
      <td className="py-1.5 text-right">
        {!isBaseline && (
          <button
            onClick={() => onApply(r.patch)}
            className="px-2 py-0.5 text-[11px] font-medium text-blue-600 border border-blue-200 rounded hover:bg-blue-50"
          >
            Apply
          </button>
        )}
      </td>
    </tr>
  );
}
