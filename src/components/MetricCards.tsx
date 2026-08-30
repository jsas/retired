import { householdOutcome, type RetirementResults, type RetirementInputs } from '../lib/retirementEngine';

interface MetricCardsProps {
  results: RetirementResults;
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

export function MetricCards({ results, inputs }: MetricCardsProps) {
  // Household-first verdict: when the COMBINED money runs out, not either silo.
  const ho = householdOutcome(results, inputs);
  const statusColor = ho.status === 'ON_TRACK' ? 'text-emerald-600' : 'text-amber-600';
  const statusBg = ho.status === 'ON_TRACK' ? 'bg-emerald-50' : 'bg-amber-50';
  const statusBorder = ho.status === 'ON_TRACK' ? 'border-emerald-200' : 'border-amber-200';

  const spouse = results.spouse;
  const householdWorth = results.totalNetWorthAtRetirement + (spouse?.totalNetWorthAtRetirement ?? 0);

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {/* Total Wealth at Retirement */}
      <div className="bg-white border border-slate-200 rounded p-3">
        <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">
          {spouse ? 'Household Wealth at Retirement' : 'Total Wealth at Retirement'}
        </div>
        <div className="text-lg font-semibold text-slate-900">{formatCurrency(householdWorth)}</div>
        {spouse && (
          <div className="text-[10px] text-slate-500 mt-0.5">
            you {formatCurrency(results.totalNetWorthAtRetirement)} · spouse {formatCurrency(spouse.totalNetWorthAtRetirement)}
          </div>
        )}
      </div>

      {/* Age of Depletion — household-first: combined money exhausted */}
      <div className="bg-white border border-slate-200 rounded p-3">
        <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">
          {spouse ? 'Household Money Lasts To' : 'Age of Depletion'}
        </div>
        <div className="text-lg font-semibold text-slate-900">
          {ho.depletionAge ?? 'Never'}
        </div>
        {spouse && (
          <div className="text-[10px] text-slate-500 mt-0.5">
            combined accounts · you {results.depletionAge ?? 'never'} · spouse {spouse.depletionAge ?? 'never'}
          </div>
        )}
      </div>

      {/* Withdrawal Rate */}
      <div className="bg-white border border-slate-200 rounded p-3">
        <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Withdrawal Rate</div>
        <div className="text-lg font-semibold text-slate-900">{formatPercent(results.withdrawalRate)}</div>
        {spouse && (
          <div className="text-[10px] text-slate-500 mt-0.5">spouse {formatPercent(spouse.withdrawalRate)}</div>
        )}
      </div>

      {/* Status */}
      <div className={`bg-white border ${statusBorder} rounded p-3`}>
        <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Status</div>
        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${statusColor} ${statusBg}`}>
          {ho.status.replace('_', ' ')}
        </span>
        {spouse ? (
          <div className="text-[10px] text-slate-500 mt-0.5">
            {ho.status === 'ON_TRACK'
              ? 'household money lasts to your max age'
              : `household runs out at age ${ho.depletionAge ?? '—'}`}
          </div>
        ) : (
          <div className="text-[10px] text-slate-500 mt-0.5">
            {ho.status === 'ON_TRACK'
              ? 'money lasts to your max age'
              : `runs out at age ${ho.depletionAge ?? '—'}`}
          </div>
        )}
      </div>
    </div>
  );
}
