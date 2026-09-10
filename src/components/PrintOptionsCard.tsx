import { useTranslation } from 'react-i18next';
import type { PrintOptions } from '../lib/printOptions';
import type { MonteCarloResults } from '@retired/engine-core/monteCarlo';
import { Panel, Check } from '../design/primitives';
import { cls } from '../design/tokens';

interface PrintOptionsCardProps {
  options: PrintOptions;
  onChange: (opts: PrintOptions) => void;
  onPrint: () => void;
  /** Non-null while the Monte Carlo worker is running for the print chart. */
  mcPending: boolean;
  /** Latest MC results (needed before the fan chart can be printed). */
  mcResults: MonteCarloResults | null;
}

// The Print & export page body (BetaPage owns the page title — this renders
// no heading of its own). Choose the optional sections, then print. Flat,
// hairline, text-first: no icons, no colour that isn't carrying meaning.
export function PrintOptionsCard({
  options, onChange, onPrint, mcPending, mcResults
}: PrintOptionsCardProps) {
  const { t } = useTranslation('print');
  const set = (patch: Partial<PrintOptions>) => onChange({ ...options, ...patch });

  // Block printing until the MC worker has delivered the chart data.
  const mcReady = !options.includeMonteCarlo || mcResults != null;
  const canPrint = mcReady && !mcPending;

  return (
    <Panel label={t('build')}>
      <p className="max-w-lg text-[13px] leading-relaxed text-slate-600">
        {t('lead')}
      </p>

      <div className="mt-5 max-w-lg space-y-4">
          <OptionRow
            checked={options.includeTimeline}
            onChange={v => set({ includeTimeline: v })}
            title={t('timeline')}
            note={t('timelineNote')}
          />
          <OptionRow
            checked={options.includeMonteCarlo}
            onChange={v => set({ includeMonteCarlo: v })}
            title={t('monteCarlo')}
            note={t('monteCarloNote')}
          />
          <OptionRow
            checked={options.includeMilestones}
            onChange={v => set({ includeMilestones: v })}
            title={t('milestones')}
            note={t('milestonesNote')}
          />
          <OptionRow
            checked={options.includeDetailedTable}
            onChange={v => set({ includeDetailedTable: v })}
            title={t('table')}
            note={t('tableNote')}
          />
      </div>

      <div className="mt-7 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-4">
        <button
          onClick={onPrint}
          disabled={!canPrint}
          className={canPrint ? cls.primaryBtn : 'border border-slate-200 px-4 py-2 text-sm font-medium text-slate-400'}
          title={canPrint ? t('printTitle') : t('waitingMc')}
        >
          {mcPending ? t('preparing') : t('printSummary')}
        </button>
        {options.includeMonteCarlo && !mcResults && !mcPending && (
          <span className="text-[11px] text-slate-400">{t('simWhenNeeded')}</span>
        )}
        {mcPending && (
          <span className="text-[11px] text-slate-400">{t('running500')}</span>
        )}
      </div>
    </Panel>
  );
}

/** One flat checkbox row composed on the design primitive: the square ink
 *  Check (never blue — colour carries verdicts), a plain-word title, a quiet
 *  note. */
function OptionRow({ checked, onChange, title, note }: {
  checked: boolean;
  onChange: (v: boolean) => void;
  title: string;
  note: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <Check checked={checked} onChange={onChange} className="mt-0.5" />
      <span className="min-w-0">
        <span className="block text-[13px] font-medium text-slate-900">{title}</span>
        <span className="mt-0.5 block text-[11.5px] leading-relaxed text-slate-500">{note}</span>
      </span>
    </div>
  );
}
