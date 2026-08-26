import { Printer, LineChart, Dices, Milestone, Table2, Loader2 } from 'lucide-react';
import type { PrintOptions } from '../lib/printOptions';
import type { MonteCarloResults } from '../lib/monteCarlo';

interface PrintOptionsCardProps {
  options: PrintOptions;
  onChange: (opts: PrintOptions) => void;
  onPrint: () => void;
  /** Non-null while the Monte Carlo worker is running for the print chart. */
  mcPending: boolean;
  /** Latest MC results (needed before the fan chart can be printed). */
  mcResults: MonteCarloResults | null;
}

// Print-summary page: choose what goes into the printed plan summary. The base
// one-page summary is always included; these toggles add optional sections.
// Choices are persisted by the caller via savePrintOptions.
export function PrintOptionsCard({
  options, onChange, onPrint, mcPending, mcResults
}: PrintOptionsCardProps) {
  const set = (patch: Partial<PrintOptions>) => onChange({ ...options, ...patch });

  // Block printing until the MC worker has delivered the chart data.
  const mcReady = !options.includeMonteCarlo || mcResults != null;
  const canPrint = mcReady && !mcPending;

  return (
    <div className="max-w-2xl">
      <div className="flex items-center gap-2 mb-3">
        <Printer size={18} className="text-blue-600" />
        <h2 className="text-lg font-bold text-slate-900">Print summary options</h2>
      </div>

      <div>
        <p className="text-xs text-slate-600 mb-3 leading-snug">
          The one-page plan summary (profile, savings, verdict) is always included.
          Add any of these sections to the printout:
        </p>

        <div className="space-y-2.5 max-w-lg">
          <label className="flex items-start gap-2.5 text-xs text-slate-700 cursor-pointer">
            <input
              type="checkbox"
              checked={options.includeTimeline}
              onChange={e => set({ includeTimeline: e.target.checked })}
              className="mt-0.5"
            />
            <span className="flex items-start gap-1.5">
              <LineChart size={14} className="text-blue-600 mt-px shrink-0" />
              <span>
                <span className="font-medium">Projection timeline chart</span>
                <span className="block text-[11px] text-slate-500 mt-0.5">
                  Portfolio balance by age with the retirement-age marker.
                </span>
              </span>
            </span>
          </label>

          <label className="flex items-start gap-2.5 text-xs text-slate-700 cursor-pointer">
            <input
              type="checkbox"
              checked={options.includeMonteCarlo}
              onChange={e => set({ includeMonteCarlo: e.target.checked })}
              className="mt-0.5"
            />
            <span className="flex items-start gap-1.5">
              <Dices size={14} className="text-blue-600 mt-px shrink-0" />
              <span>
                <span className="font-medium">Monte Carlo fan chart</span>
                <span className="block text-[11px] text-slate-500 mt-0.5">
                  Percentile bands (10th–90th) and success rate from a fresh 500-run simulation.
                  Takes a moment to compute.
                </span>
              </span>
            </span>
          </label>

          <label className="flex items-start gap-2.5 text-xs text-slate-700 cursor-pointer">
            <input
              type="checkbox"
              checked={options.includeMilestones}
              onChange={e => set({ includeMilestones: e.target.checked })}
              className="mt-0.5"
            />
            <span className="flex items-start gap-1.5">
              <Milestone size={14} className="text-blue-600 mt-px shrink-0" />
              <span>
                <span className="font-medium">Major spending milestones &amp; changes</span>
                <span className="block text-[11px] text-slate-500 mt-0.5">
                  Retirement, CPP/OAS start, RRIF conversion, spending-phase changes and one-time
                  cash events, in age order.
                </span>
              </span>
            </span>
          </label>

          <label className="flex items-start gap-2.5 text-xs text-slate-700 cursor-pointer">
            <input
              type="checkbox"
              checked={options.includeDetailedTable}
              onChange={e => set({ includeDetailedTable: e.target.checked })}
              className="mt-0.5"
            />
            <span className="flex items-start gap-1.5">
              <Table2 size={14} className="text-blue-600 mt-px shrink-0" />
              <span>
                <span className="font-medium">Detailed year-by-year table</span>
                <span className="block text-[11px] text-slate-500 mt-0.5">
                  Every year with balances, withdrawals, tax and benefits — plus the per-year
                  drill-down (withdrawal sources, growth per account, reverse mortgage, events).
                  Prints several pages.
                </span>
              </span>
            </span>
          </label>
        </div>

        <div className="flex items-center gap-3 mt-4 pt-3 border-t border-slate-100">
          <button
            onClick={onPrint}
            disabled={!canPrint}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-xs font-semibold rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            title={canPrint ? 'Open the print dialog' : 'Waiting for the Monte Carlo simulation…'}
          >
            {mcPending ? <Loader2 size={13} className="animate-spin" /> : <Printer size={13} />}
            {mcPending ? 'Preparing chart…' : 'Print summary'}
          </button>
          {options.includeMonteCarlo && !mcResults && !mcPending && (
            <span className="text-[11px] text-slate-500">Simulation will run when the chart is needed.</span>
          )}
          {mcPending && (
            <span className="text-[11px] text-slate-500">Running 500 simulations for the fan chart…</span>
          )}
        </div>
      </div>
    </div>
  );
}
