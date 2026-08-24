import { X, PanelLeft, LineChart, Sparkles, ShieldCheck } from 'lucide-react';

const PANEL_STATE_KEY = 'wealthconsole_panel_state';
const DISMISS_KEY = 'welcome_dismissed';

export function isWelcomeDismissed(): boolean {
  try {
    const raw = localStorage.getItem(PANEL_STATE_KEY);
    if (raw) return JSON.parse(raw)[DISMISS_KEY] === true;
  } catch { /* ignore */ }
  return false;
}

function persistDismissed() {
  try {
    const raw = localStorage.getItem(PANEL_STATE_KEY);
    const state = raw ? JSON.parse(raw) : {};
    state[DISMISS_KEY] = true;
    localStorage.setItem(PANEL_STATE_KEY, JSON.stringify(state));
  } catch { /* ignore */ }
}

// Getting-started card shown at the top of the projection page. Explains the
// basic workflow and that all data stays in the browser. Dismissal persists to
// the panel-state store; the General settings tab can force it back on at load.
export function WelcomeCard({ onDismiss }: { onDismiss: () => void }) {
  const dismiss = () => {
    persistDismissed();
    onDismiss();
  };

  return (
    <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50/60 shadow-sm">
      <div className="flex items-start justify-between gap-3 px-4 pt-3 pb-1">
        <div>
          <h2 className="text-sm font-semibold text-slate-800">Getting started with RE: tired</h2>
          <p className="text-xs text-slate-600 mt-0.5">
            A Canadian retirement drawdown planner. Everything runs in your browser.
          </p>
        </div>
        <button
          onClick={dismiss}
          className="p-1 text-slate-400 hover:text-slate-700 hover:bg-blue-100 rounded"
          title="Don't show again"
          aria-label="Dismiss welcome card"
        >
          <X size={15} />
        </button>
      </div>

      <div className="grid gap-3 px-4 pb-3 sm:grid-cols-3">
        <div className="flex gap-2">
          <PanelLeft size={16} className="shrink-0 text-blue-600 mt-0.5" />
          <div>
            <p className="text-xs font-medium text-slate-800">1. Enter your plan</p>
            <p className="text-[11px] text-slate-600 leading-snug">
              Use the sidebar: ages, account balances, contributions, CPP/OAS, and your
              desired spending (optionally in phases). The projection updates live.
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <LineChart size={16} className="shrink-0 text-blue-600 mt-0.5" />
          <div>
            <p className="text-xs font-medium text-slate-800">2. Read the results</p>
            <p className="text-[11px] text-slate-600 leading-snug">
              The summary, timeline chart and year-by-year schedule are each collapsible.
              Monte Carlo and the historical backtest stress-test the plan below.
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Sparkles size={16} className="shrink-0 text-blue-600 mt-0.5" />
          <div>
            <p className="text-xs font-medium text-slate-800">3. Improve it</p>
            <p className="text-[11px] text-slate-600 leading-snug">
              <span className="font-medium">Optimize</span> ranks CPP/OAS timing and withdrawal-order
              strategies. The <span className="font-medium">Help</span> page documents every input;
              profiles are saved in the sidebar.
            </p>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 border-t border-blue-100 px-4 py-2">
        <ShieldCheck size={14} className="shrink-0 text-emerald-600" />
        <p className="text-[11px] text-slate-600 leading-snug">
          <span className="font-medium text-slate-700">Your data never leaves this device.</span>{' '}
          Profiles, settings and results are stored only in this browser's local storage — nothing is
          uploaded or sent to a server. Clearing your browser data (or using another browser/device)
          means starting fresh, so use the sidebar's Export to keep a backup file.
        </p>
      </div>

      <div className="border-t border-blue-100 px-4 py-2">
        <p className="text-[10px] text-slate-500 leading-snug">
          For education and exploration only — RE: tired produces simplified estimates from a model of
          Canadian tax and benefit rules, not financial, tax, or investment advice. Real outcomes will
          differ. Consult a qualified financial planner or tax professional before acting on anything
          you see here.
        </p>
      </div>
    </div>
  );
}
