import { PanelLeft, LineChart, Sparkles, ShieldCheck, ArrowRight } from 'lucide-react';

const PANEL_STATE_KEY = 'wealthconsole_panel_state';
const DISMISS_KEY = 'welcome_dismissed';

export function isWelcomeDismissed(): boolean {
  try {
    const raw = localStorage.getItem(PANEL_STATE_KEY);
    if (raw) return JSON.parse(raw)[DISMISS_KEY] === true;
  } catch { /* ignore */ }
  return false;
}

function persistDismissed(dismissed: boolean) {
  try {
    const raw = localStorage.getItem(PANEL_STATE_KEY);
    const state = raw ? JSON.parse(raw) : {};
    state[DISMISS_KEY] = dismissed;
    localStorage.setItem(PANEL_STATE_KEY, JSON.stringify(state));
  } catch { /* ignore */ }
}

interface WelcomeCardProps {
  /** Navigate onward (to the projection dashboard). */
  onContinue: () => void;
}

// Getting-started page. Shown on load unless the user checks "don't show this
// again" (persisted to the panel-state store); the General settings tab can
// force it back on at every load.
export function WelcomeCard({ onContinue }: WelcomeCardProps) {
  const handleDontShowAgain = () => {
    persistDismissed(true);
    onContinue();
  };

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-lg font-bold text-slate-900">Getting started with RE: tired</h2>
        <p className="text-sm text-slate-600 mt-0.5">
          A Canadian retirement drawdown planner. Everything runs in your browser.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="flex gap-2 rounded border border-slate-200 bg-white p-3">
          <PanelLeft size={16} className="shrink-0 text-blue-600 mt-0.5" />
          <div>
            <p className="text-xs font-medium text-slate-800">1. Enter your plan</p>
            <p className="text-[11px] text-slate-600 leading-snug">
              Use the sidebar: ages, account balances, contributions, CPP/OAS, and your
              desired spending (optionally in phases). The projection updates live.
            </p>
          </div>
        </div>
        <div className="flex gap-2 rounded border border-slate-200 bg-white p-3">
          <LineChart size={16} className="shrink-0 text-blue-600 mt-0.5" />
          <div>
            <p className="text-xs font-medium text-slate-800">2. Read the results</p>
            <p className="text-[11px] text-slate-600 leading-snug">
              The summary, timeline chart and year-by-year schedule are each collapsible.
              Monte Carlo and the historical backtest stress-test the plan.
            </p>
          </div>
        </div>
        <div className="flex gap-2 rounded border border-slate-200 bg-white p-3">
          <Sparkles size={16} className="shrink-0 text-blue-600 mt-0.5" />
          <div>
            <p className="text-xs font-medium text-slate-800">3. Improve it</p>
            <p className="text-[11px] text-slate-600 leading-snug">
              <span className="font-medium">Optimize</span> ranks CPP/OAS timing and withdrawal-order
              strategies. The <span className="font-medium">Help</span> page documents every input;
              scenarios are saved in the sidebar.
            </p>
          </div>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-2 rounded border border-emerald-200 bg-emerald-50/60 px-4 py-2.5">
        <ShieldCheck size={14} className="shrink-0 text-emerald-600" />
        <p className="text-[11px] text-slate-600 leading-snug">
          <span className="font-medium text-slate-700">Your data never leaves this device.</span>{' '}
          Scenarios, settings and results are stored only in this browser's local storage — nothing is
          uploaded or sent to a server. Clearing your browser data (or using another browser/device)
          means starting fresh, so use the Export page to keep a backup file.
        </p>
      </div>

      <p className="mt-3 text-[10px] text-slate-500 leading-snug">
        For education and exploration only — RE: tired produces simplified estimates from a model of
        Canadian tax and benefit rules, not financial, tax, or investment advice. Real outcomes will
        differ. Consult a qualified financial planner or tax professional before acting on anything
        you see here.
      </p>

      <div className="mt-4 flex items-center gap-3">
        <button
          onClick={onContinue}
          className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded hover:bg-blue-700"
        >
          Get started <ArrowRight size={15} />
        </button>
        <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer select-none">
          <input
            type="checkbox"
            onChange={(e) => { if (e.target.checked) handleDontShowAgain(); }}
          />
          Don't show this again
        </label>
      </div>
    </div>
  );
}
