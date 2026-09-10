import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AppConfig } from '@retired/engine-core/appConfig';
import type { Scenario } from '@retired/engine-core/types';
import {
  inputsForCompare, linkedSpouseName, metricsFromResults, type ScenarioMetrics,
} from '@retired/engine-core/compareMetrics';
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
  /** True when the saved plan has a spouse (linked or embedded) — the toggle
   *  target. Independent of the compare-only overlay, so turning the spouse
   *  off does not hide the control. */
  hasSpouse: boolean;
  partnerName?: string;
}

/**
 * Compare scenarios: every selected scenario as a line on one projection
 * timeline (toggle lines in the legend), with a plain table of the numbers
 * underneath. Couple plans show as a household; the spouse can be hidden for
 * THIS compare only — the saved plan is not patched.
 */
export function CompareCard({ scenarios, activeScenarioId, config }: CompareCardProps) {
  const { t } = useTranslation('pages');
  const { locale } = useAppLocale();
  // Lines that are off. Empty = every plan on. An opt-out Set (not an opt-in
  // snapshot of ids at first paint) so plans that load after mount still show
  // — freezing the "on" set at first render left the table at 2 rows while
  // the legend drew every later-arriving plan.
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(() => new Set());
  // Scenario ids whose spouse is off for this view only. Empty = every
  // household runs as a couple (today's default).
  const [spouseOffIds, setSpouseOffIds] = useState<Set<string>>(() => new Set());

  // Run each scenario ONCE: pull the balance series (for the timeline) and the
  // metrics + lifetime tax (for the table) off the same engine pass. Linked
  // spouses are resolved here so a host that stores only the link still scores
  // as a household.
  const { rows, seriesById } = useMemo(() => {
    const rows: Row[] = [];
    const seriesById = new Map<string, TimelineSeries>();
    for (const s of scenarios) {
      const withSpouse = inputsForCompare(s, scenarios, true);
      const hasSpouse = !!withSpouse.spouse?.enabled;
      const includeSpouse = hasSpouse && !spouseOffIds.has(s.id);
      const runInputs = includeSpouse ? withSpouse : inputsForCompare(s, scenarios, false);
      const results = calculateHousehold(runInputs, config);
      const m = metricsFromResults(s.id, s.name, results, runInputs);
      const last = results.yearlyBreakdown[results.yearlyBreakdown.length - 1];
      const lifetimeTax = results.yearlyBreakdown.reduce((sum, r) => sum + (r.totalTaxPaid ?? r.incomeTax ?? 0), 0);
      rows.push({
        ...m,
        lifetimeTax,
        endingBalance: last?.endingBalance ?? 0,
        hasSpouse,
        partnerName: linkedSpouseName(s, scenarios),
      });
      seriesById.set(s.id, {
        id: s.id,
        label: s.name,
        points: results.yearlyBreakdown.map(r => ({ age: r.age, value: r.endingBalance })),
      });
    }
    return { rows, seriesById };
  }, [scenarios, config, spouseOffIds]);

  // Always pass EVERY scenario to the timeline — the legend is built from
  // `series`, so filtering here would drop a hidden line's click target and
  // there'd be no way to turn it back on. The timeline hides the line itself.
  const allSeries = scenarios.map(s => seriesById.get(s.id)!);
  const activeRows = rows.filter(r => !hiddenIds.has(r.id));
  const anyHousehold = rows.some(r => r.hasSpouse);

  const toggleLine = (id: string) => {
    setHiddenIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSpouse = (id: string) => {
    setSpouseOffIds(prev => {
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
        {anyHousehold && (
          <span className="ml-2 text-[11px] text-slate-400">{t('compare.spouseHint')}</span>
        )}
      </div>

      <ProjectionTimeline series={allSeries} hiddenIds={hiddenIds} onToggleSeries={toggleLine} />
      {activeRows.length === 0 && (
        <p className="py-2 text-xs text-slate-500">{t('compare.allOff')}</p>
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
            {activeRows.map(r => {
              const spouseOn = r.hasSpouse && !spouseOffIds.has(r.id);
              return (
                <tr key={r.id} className={`border-b border-slate-100 ${r.id === activeScenarioId ? 'bg-slate-50' : ''}`}>
                  <td className="py-1.5 pr-3">
                    <span className="font-medium text-slate-900">{r.name}</span>
                    {r.hasSpouse ? (
                      <span className="ml-1.5 inline-flex items-center gap-1.5 align-middle">
                        <span className="text-[10px] uppercase tracking-[0.12em] text-slate-500">
                          {spouseOn
                            ? (r.partnerName
                              ? t('compare.householdWith', { name: r.partnerName })
                              : t('compare.household'))
                            : t('compare.youOnly')}
                        </span>
                        <button
                          type="button"
                          onClick={() => toggleSpouse(r.id)}
                          className="text-[10px] text-slate-500 underline decoration-slate-300 underline-offset-2 hover:text-slate-800"
                          aria-pressed={spouseOn}
                        >
                          {spouseOn ? t('compare.hideSpouse') : t('compare.showSpouse')}
                        </button>
                      </span>
                    ) : (
                      <span className="ml-1.5 text-[10px] text-slate-400">{t('compare.single')}</span>
                    )}
                  </td>
                  <td className="num py-1.5 pr-3 text-right text-slate-800">{fmtMoney(r.householdWorth, locale)}</td>
                  <td className={`num py-1.5 pr-3 text-right ${r.depletionAge ? 'font-medium text-rose-700' : 'text-slate-800'}`}>
                    {r.depletionAge ?? t('compare.never')}
                  </td>
                  <td className="num py-1.5 pr-3 text-right text-slate-800">{fmtPct(r.withdrawalRate)}</td>
                  <td className="num py-1.5 pr-3 text-right text-slate-800">{fmtMoney(r.lifetimeTax, locale)}</td>
                  <td className="num py-1.5 text-right text-slate-800">{fmtMoney(r.endingBalance, locale)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
