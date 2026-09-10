import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AppConfig } from '@retired/engine-core/appConfig';
import type { Scenario } from '@retired/engine-core/types';
import { computeScenarioMetrics, type ScenarioMetrics } from '@retired/engine-core/compareMetrics';
import { calculateHousehold } from '@retired/engine-core/retirementEngine';
import { ProjectionTimeline, type TimelineSeries } from '../design/ProjectionTimeline';
import { useAppLocale } from '../lib/localeContext';

function fmtMoney(v: number, locale: string): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 }).format(v);
}
function fmtPct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

interface CompareCardProps {
  scenarios: Scenario[];
  activeScenarioId: string;
  config: AppConfig;
}

interface Row extends ScenarioMetrics {
  lifetimeTax: number;
  endingBalance: number;
}

/**
 * Compare scenarios: every selected scenario as a line on one projection
 * timeline (toggle lines in the legend), with a plain table of the numbers
 * underneath. No scenario cap, no "baseline" ritual — the numbers stand alone.
 */
export function CompareCard({ scenarios, activeScenarioId, config }: CompareCardProps) {
  const { t } = useTranslation('pages');
  const { locale } = useAppLocale();
  // All scenarios on by default; the legend toggles lines, the table follows.
  const [onIds, setOnIds] = useState<Set<string>>(() => new Set(scenarios.map(s => s.id)));

  // Run each scenario ONCE: pull the balance series (for the timeline) and the
  // metrics + lifetime tax (for the table) off the same engine pass.
  const { rows, seriesById } = useMemo(() => {
    const rows: Row[] = [];
    const seriesById = new Map<string, TimelineSeries>();
    for (const s of scenarios) {
      const results = calculateHousehold(s.inputs, config);
      const m = computeScenarioMetrics(s, config, scenarios);
      const last = results.yearlyBreakdown[results.yearlyBreakdown.length - 1];
      const lifetimeTax = results.yearlyBreakdown.reduce((sum, r) => sum + (r.totalTaxPaid ?? r.incomeTax ?? 0), 0);
      rows.push({ ...m, lifetimeTax, endingBalance: last?.endingBalance ?? 0 });
      seriesById.set(s.id, {
        id: s.id,
        label: s.name,
        points: results.yearlyBreakdown.map(r => ({ age: r.age, value: r.endingBalance })),
      });
    }
    return { rows, seriesById };
  }, [scenarios, config]);

  const activeSeries = scenarios.map(s => seriesById.get(s.id)!).filter(s => onIds.has(s.id));
  const activeRows = rows.filter(r => onIds.has(r.id));

  const toggleLine = (id: string) => {
    setOnIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  if (scenarios.length === 0) {
    return <p className="text-xs text-slate-500">{t('compare.empty')}</p>;
  }

  return (
    <div>
      <div className="mb-3">
        <span className="text-[11px] text-slate-400">{t('compare.toggleHint')}</span>
      </div>

      {activeSeries.length === 0 ? (
        <p className="py-2 text-xs text-slate-500">{t('compare.allOff')}</p>
      ) : (
        <ProjectionTimeline series={activeSeries} onToggleSeries={toggleLine} />
      )}

      {/* The numbers underneath — one row per scenario that's on. */}
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="border-b border-slate-200 text-left text-[10px] uppercase tracking-[0.16em] text-slate-400">
              <th className="py-1.5 pr-3 font-semibold">{t('compare.scenario')}</th>
              <th className="py-1.5 pr-3 font-semibold text-right">{t('compare.wealth')}</th>
              <th className="py-1.5 pr-3 font-semibold text-right">{t('compare.depletion')}</th>
              <th className="py-1.5 pr-3 font-semibold text-right">{t('compare.withdrawal')}</th>
              <th className="py-1.5 pr-3 font-semibold text-right">{t('compare.lifetimeTax')}</th>
              <th className="py-1.5 font-semibold text-right">{t('compare.ending')}</th>
            </tr>
          </thead>
          <tbody>
            {activeRows.map(r => (
              <tr key={r.id} className={`border-b border-slate-100 ${r.id === activeScenarioId ? 'bg-slate-50' : ''}`}>
                <td className="py-1.5 pr-3">
                  <span className="font-medium text-slate-900">{r.name}</span>
                  <span className="ml-1.5 text-[10px] text-slate-400">{r.isCouple ? t('compare.couple') : t('compare.single')}</span>
                </td>
                <td className="num py-1.5 pr-3 text-right text-slate-800">{fmtMoney(r.householdWorth, locale)}</td>
                <td className={`num py-1.5 pr-3 text-right ${r.depletionAge ? 'font-medium text-rose-700' : 'text-slate-800'}`}>
                  {r.depletionAge ?? t('compare.never')}
                </td>
                <td className="num py-1.5 pr-3 text-right text-slate-800">{fmtPct(r.withdrawalRate)}</td>
                <td className="num py-1.5 pr-3 text-right text-slate-800">{fmtMoney(r.lifetimeTax, locale)}</td>
                <td className="num py-1.5 text-right text-slate-800">{fmtMoney(r.endingBalance, locale)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {activeRows.length === 0 && (
          <p className="text-xs text-slate-500 py-2">{t('compare.nothingToShow')}</p>
        )}
      </div>
    </div>
  );
}
