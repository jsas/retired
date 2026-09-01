import type { PrintOptions } from '../lib/printOptions';
import type { MonteCarloResults } from '@retired/engine-core/monteCarlo';
import { Panel } from '../design/primitives';
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
  const set = (patch: Partial<PrintOptions>) => onChange({ ...options, ...patch });

  // Block printing until the MC worker has delivered the chart data.
  const mcReady = !options.includeMonteCarlo || mcResults != null;
  const canPrint = mcReady && !mcPending;

  return (
    <Panel label="Build the printout">
      <p className="max-w-lg text-[13px] leading-relaxed text-slate-600">
        The one-page summary — profile, savings, verdict — is always included.
        Add any of these sections:
      </p>

      <div className="mt-5 max-w-lg space-y-4">
          <OptionRow
            checked={options.includeTimeline}
            onChange={v => set({ includeTimeline: v })}
            title="Projection timeline chart"
            note="Portfolio balance by age with the retirement-age marker."
          />
          <OptionRow
            checked={options.includeMonteCarlo}
            onChange={v => set({ includeMonteCarlo: v })}
            title="Monte Carlo fan chart"
            note="Percentile bands (10th–90th) and success rate from a fresh 500-run simulation. Takes a moment to compute."
          />
          <OptionRow
            checked={options.includeMilestones}
            onChange={v => set({ includeMilestones: v })}
            title="Major spending milestones & changes"
            note="Retirement, CPP/OAS start, RRIF conversion, spending-phase changes and one-time cash events, in age order."
          />
          <OptionRow
            checked={options.includeDetailedTable}
            onChange={v => set({ includeDetailedTable: v })}
            title="Detailed year-by-year table"
            note="Every year with balances, withdrawals, tax and benefits — plus the per-year drill-down (withdrawal sources, growth per account, reverse mortgage, events). Prints several pages."
          />
      </div>

      <div className="mt-7 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-4">
        <button
          onClick={onPrint}
          disabled={!canPrint}
          className={canPrint ? cls.primaryBtn : 'border border-slate-200 px-4 py-2 text-sm font-medium text-slate-400'}
          title={canPrint ? 'Open the print dialog' : 'Waiting for the Monte Carlo simulation…'}
        >
          {mcPending ? 'Preparing chart…' : 'Print summary'}
        </button>
        {options.includeMonteCarlo && !mcResults && !mcPending && (
          <span className="text-[11px] text-slate-400">The simulation runs when the chart is needed.</span>
        )}
        {mcPending && (
          <span className="text-[11px] text-slate-400">Running 500 simulations for the fan chart…</span>
        )}
      </div>
    </Panel>
  );
}

/** One flat checkbox row: a square check, a plain-word title, a quiet note.
 *  The check is ink (accent-slate-900) — never blue; colour carries verdicts. */
function OptionRow({ checked, onChange, title, note }: {
  checked: boolean;
  onChange: (v: boolean) => void;
  title: string;
  note: string;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <input
        type="checkbox"
        checked={checked}
        onChange={e => onChange(e.target.checked)}
        className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-slate-900"
      />
      <span className="min-w-0">
        <span className="block text-[13px] font-medium text-slate-900">{title}</span>
        <span className="mt-0.5 block text-[11.5px] leading-relaxed text-slate-500">{note}</span>
      </span>
    </label>
  );
}
