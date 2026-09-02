import { useMemo, useState } from 'react';
import { GitCompareArrows, ArrowUpRight, ArrowDownRight, Minus } from 'lucide-react';
import type { AppConfig } from '@retired/engine-core/appConfig';
import type { Plan } from '@retired/engine-core/types';
import { comparePlans, type MetricDiff, type PlanComparison } from '@retired/engine-core/compareMetrics';

const MAX_COMPARE = 3;

function fmtMoney(v: number): string {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 }).format(v);
}
function fmtPct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

interface CompareCardProps {
  plans: Plan[];
  activePlanId: string;
  config: AppConfig;
}

// A signed delta chip under a metric value: green when the move is an
// improvement, red when worse, grey when it rounds to no change.
function DiffChip({ diff, format }: { diff: MetricDiff; format: (delta: number) => string }) {
  if (diff.neutral) {
    return (
      <span className="inline-flex items-center gap-0.5 text-[10px] text-slate-400">
        <Minus size={10} /> same
      </span>
    );
  }
  const Icon = diff.delta > 0 ? ArrowUpRight : ArrowDownRight;
  const color = diff.better ? 'text-emerald-600' : 'text-red-600';
  return (
    <span className={`inline-flex items-center gap-0.5 text-[10px] font-medium ${color}`}>
      <Icon size={10} /> {format(diff.delta)}
    </span>
  );
}

function moneyDelta(delta: number): string {
  const sign = delta > 0 ? '+' : '−';
  return `${sign}${fmtMoney(Math.abs(delta))}`;
}
function ageDelta(delta: number): string {
  if (delta === Number.POSITIVE_INFINITY) return 'never runs out';
  if (delta === Number.NEGATIVE_INFINITY) return 'runs out';
  const sign = delta > 0 ? '+' : '−';
  return `${sign}${Math.abs(Math.round(delta))} yr`;
}
function rateDelta(delta: number): string {
  const sign = delta > 0 ? '+' : '−';
  return `${sign}${(Math.abs(delta) * 100).toFixed(1)} pts`;
}

function VerdictColumn({ comparison, isBaseline }: { comparison: PlanComparison; isBaseline: boolean }) {
  const m = comparison.metrics;
  const d = comparison.diff;
  const statusColor = m.status === 'ON_TRACK' ? 'text-emerald-700 bg-emerald-50' : 'text-amber-700 bg-amber-50';
  return (
    <div className={`flex-1 min-w-0 rounded border ${isBaseline ? 'border-blue-300 bg-blue-50/40' : 'border-slate-200 bg-white'} p-3`}>
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0">
          <div className="text-xs font-semibold text-slate-800 truncate" title={m.name}>{m.name}</div>
          <div className="text-[10px] text-slate-400">
            {isBaseline ? 'baseline' : (m.isCouple ? 'couple' : 'single')}
          </div>
        </div>
        <span className={`shrink-0 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold ${statusColor}`}>
          {m.status.replace('_', ' ')}
        </span>
      </div>

      <dl className="space-y-2">
        <div>
          <dt className="text-[10px] uppercase tracking-wider text-slate-500">Wealth at retirement</dt>
          <dd className="text-sm font-semibold text-slate-900">{fmtMoney(m.householdWorth)}</dd>
          {d && <DiffChip diff={d.householdWorth} format={moneyDelta} />}
        </div>
        <div>
          <dt className="text-[10px] uppercase tracking-wider text-slate-500">Age of depletion</dt>
          <dd className="text-sm font-semibold text-slate-900">{m.depletionAge ?? 'Never'}</dd>
          {d && <DiffChip diff={d.depletionAge} format={ageDelta} />}
        </div>
        <div>
          <dt className="text-[10px] uppercase tracking-wider text-slate-500">Withdrawal rate</dt>
          <dd className="text-sm font-semibold text-slate-900">{fmtPct(m.withdrawalRate)}</dd>
          {d && <DiffChip diff={d.withdrawalRate} format={rateDelta} />}
        </div>
      </dl>
    </div>
  );
}

export function CompareCard({ plans, activePlanId, config }: CompareCardProps) {
  // Default to the active plan, pre-checked as the baseline.
  const [selectedIds, setSelectedIds] = useState<string[]>([activePlanId]);
  const [baselineId, setBaselineId] = useState<string>(activePlanId);

  const toggle = (id: string) => {
    setSelectedIds(prev => {
      if (prev.includes(id)) {
        const next = prev.filter(x => x !== id);
        // If the baseline was just unchecked, move it to the first remaining.
        if (id === baselineId) setBaselineId(next[0] ?? '');
        return next;
      }
      if (prev.length >= MAX_COMPARE) return prev; // cap reached
      const next = [...prev, id];
      if (!next.includes(baselineId)) setBaselineId(id);
      return next;
    });
  };

  const selected = useMemo(
    () => plans.filter(s => selectedIds.includes(s.id)),
    [plans, selectedIds],
  );

  const comparisons = useMemo(() => {
    if (selected.length < 2 || !baselineId) return [];
    return comparePlans(selected, baselineId, config);
  }, [selected, baselineId, config]);

  const atCap = selectedIds.length >= MAX_COMPARE;

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <GitCompareArrows size={18} className="text-blue-600" />
        <h2 className="text-lg font-bold text-slate-900">Compare plans</h2>
        <span className="text-[11px] text-slate-400">
          verdict cards computed with the current engine settings
        </span>
      </div>

      <div>
        {/* Plan picker */}
        <div className="mb-3">
          <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1.5">
            Pick {selectedIds.length < 2 ? '2–3' : `${selectedIds.length} of ${MAX_COMPARE}`} plans · click the dot to set the baseline
          </div>
          <div className="flex flex-wrap gap-1.5">
            {plans.map(s => {
              const checked = selectedIds.includes(s.id);
              const isBaseline = s.id === baselineId;
              const disabled = !checked && atCap;
              return (
                <button
                  key={s.id}
                  onClick={() => toggle(s.id)}
                  disabled={disabled}
                  title={disabled ? `Compare at most ${MAX_COMPARE} plans` : (checked ? 'Remove from comparison' : 'Add to comparison')}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded border text-xs transition-colors ${
                    isBaseline
                      ? 'border-blue-500 bg-blue-50 text-blue-800'
                      : checked
                        ? 'border-slate-400 bg-slate-100 text-slate-800'
                        : disabled
                          ? 'border-slate-200 text-slate-300 cursor-not-allowed'
                          : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {/* baseline selector dot */}
                  <span
                    role="radio"
                    aria-checked={isBaseline}
                    onClick={(e) => {
                      if (!checked) return; // can't baseline an unchecked plan
                      e.stopPropagation();
                      setBaselineId(s.id);
                    }}
                    title={checked ? (isBaseline ? 'Baseline' : 'Set as baseline') : undefined}
                    className={`w-2.5 h-2.5 rounded-full border ${isBaseline ? 'bg-blue-600 border-blue-600' : checked ? 'border-slate-400 hover:border-blue-500 cursor-pointer' : 'border-slate-300'}`}
                  />
                  {s.name}
                </button>
              );
            })}
          </div>
        </div>

        {/* Verdict columns */}
        {selected.length < 2 ? (
          <p className="text-xs text-slate-500 py-2">
            Select at least two plans to see their verdict cards side by side.
          </p>
        ) : (
          <div className="flex flex-col sm:flex-row gap-3 items-stretch">
            {comparisons.map(c => (
              <VerdictColumn key={c.metrics.id} comparison={c} isBaseline={c.metrics.id === baselineId} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
