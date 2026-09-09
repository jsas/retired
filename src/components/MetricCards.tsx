import { householdOutcome, type RetirementResults } from '@retired/engine-core/retirementEngine';
import type { Household } from '@retired/engine-core/householdTypes';
import { Dot } from '../design/primitives';
import { BLUE, AMBER_DOT } from '../design/tokens';

import type { RetirementInputs } from '@retired/engine-core/retirementEngine';

interface MetricCardsProps {
  results: RetirementResults;
  household: Household;
  inputs: RetirementInputs;
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: 'CAD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatReScore(ho: { depletionAge: number | null }, maxAge: number): number {
  const { depletionAge } = ho;
  if (depletionAge === null) return 100; // never depletes — fully funded to horizon
  return Math.min(100, Math.max(0, Math.round((depletionAge / maxAge) * 100)));
}

export function MetricCards({ results, household, inputs }: MetricCardsProps) {
  // Household-first verdict: when the COMBINED money runs out, not either silo.
  const ho = householdOutcome(results, household);
  const statusColor = ho.status === 'ON_TRACK' ? 'text-blue-700' : 'text-amber-700';
  const statusDot = ho.status === 'ON_TRACK' ? BLUE : AMBER_DOT;

  const spouse = results.spouse;
  const householdWorth = results.totalNetWorthAtRetirement + (spouse?.totalNetWorthAtRetirement ?? 0);

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {/* Total Wealth at Retirement */}
      <div className="border-t-2 border-slate-900 pt-2">
        <div className="mb-1 text-[10px] uppercase tracking-[0.16em] text-slate-400">
          {spouse ? 'Household Wealth at Retirement' : 'Total Wealth at Retirement'}
        </div>
        <div className="num text-lg font-semibold text-slate-900">{formatCurrency(householdWorth)}</div>
        {spouse && (
          <div className="mt-0.5 text-[10px] text-slate-500">
            you {formatCurrency(results.totalNetWorthAtRetirement)} · spouse {formatCurrency(spouse.totalNetWorthAtRetirement)}
          </div>
        )}
      </div>

      {/* Re:score — years of retirement funded per year of spending (0 = runs out immediately, 1 = funded to max age, >1 = beyond max age) */}
      <div className="border-t-2 border-slate-900 pt-2">
        <div className="mb-1 text-[10px] uppercase tracking-[0.16em] text-slate-400">
          {spouse ? 'Household Re:score' : 'Re:score'}
        </div>
        <div className="num text-lg font-semibold text-slate-900">
          {formatReScore(ho, inputs.maxAge)}/100
        </div>
        {spouse && (
          <div className="mt-0.5 text-[10px] text-slate-500">
            {formatReScore(ho, inputs.maxAge)}/100 · you {formatReScore(results, inputs.maxAge)}/100 · spouse {formatReScore(spouse, inputs.maxAge)}/100
          </div>
        )}
      </div>

      {/* Withdrawal Rate */}
      <div className="border-t-2 border-slate-900 pt-2">
        <div className="mb-1 text-[10px] uppercase tracking-[0.16em] text-slate-400">Withdrawal Rate</div>
        <div className="num text-lg font-semibold text-slate-900">{formatPercent(results.withdrawalRate)}</div>
        {spouse && (
          <div className="mt-0.5 text-[10px] text-slate-500">spouse {formatPercent(spouse.withdrawalRate)}</div>
        )}
      </div>

      {/* Status */}
      <div className="border-t-2 border-slate-900 pt-2">
        <div className="mb-1 text-[10px] uppercase tracking-[0.16em] text-slate-400">Status</div>
        <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${statusColor}`}>
          <Dot color={statusDot} /> {ho.status.replace('_', ' ')}
        </span>
        {spouse ? (
          <div className="mt-0.5 text-[10px] text-slate-500">
            {ho.status === 'ON_TRACK'
              ? 'household money lasts to your max age'
              : `household runs out at age ${ho.depletionAge ?? '—'}`}
          </div>
        ) : (
          <div className="mt-0.5 text-[10px] text-slate-500">
            {ho.status === 'ON_TRACK'
              ? 'money lasts to your max age'
              : `runs out at age ${ho.depletionAge ?? '—'}`}
          </div>
        )}
      </div>
    </div>
  );
}
