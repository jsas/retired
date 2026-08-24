import { X, Printer, LineChart, Dices, Milestone, Loader2 } from 'lucide-react';
import type { PrintOptions } from '../lib/printOptions';
import type { MonteCarloResults } from '../lib/monteCarlo';

interface PrintOptionsCardProps {
  options: PrintOptions;
  onChange: (opts: PrintOptions) => void;
  onClose: () => void;
  onPrint: () => void;
  /** Non-null while the Monte Carlo worker is running for the print chart. */
  mcPending: boolean;
  /** Latest MC results (needed before the fan chart can be printed). */
  mcResults: MonteCarloResults | null;
}

// Closable card for choosing what goes into the printed plan summary. The
// base one-page summary is always included; these toggles add optional
// sections. Choices are persisted by the caller via savePrintOptions.
export function PrintOptionsCard({
  options, onChange, onClose, onPrint, mcPending, mcResults
}: PrintOptionsCardProps) {
  const set = (patch: Partial<PrintOptions>) => onChange({ ...options, ...patch });

  // Block printing until the MC worker has delivered the chart data.
  const mcReady = !options.includeMonteCarlo || mcResults != null;
  const canPrint = mcReady && !mcPending;

  return (
    <div className="mb-4 bg-white border border-slate-200 rounded">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-200">
        <div className="flex items-center gap-2">
          <Printer size={15} className="text-slate-500" />
          <h3 className="text-sm font-semibold text-slate-800">Print summary options</h3>
        </div>
        <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded" title="Close">
          <X size={15} className="text-slate-500" />
        </button>
      </div>

      <div className="p-4">
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
