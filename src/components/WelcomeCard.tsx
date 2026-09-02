import { PanelLeft, LineChart, Sparkles, ShieldCheck, ArrowRight } from 'lucide-react';
import { prefKV } from '../lib/prefKv';

const PANEL_STATE_KEY = 'wealthconsole_panel_state';
const DISMISS_KEY = 'welcome_dismissed';

export function isWelcomeDismissed(): boolean {
  try {
    const raw = prefKV().getItem(PANEL_STATE_KEY);
    if (raw) return JSON.parse(raw)[DISMISS_KEY] === true;
  } catch { /* ignore */ }
  return false;
}

function persistDismissed(dismissed: boolean) {
  try {
    const kv = prefKV();
    const raw = kv.getItem(PANEL_STATE_KEY);
    const state = raw ? JSON.parse(raw) : {};
    state[DISMISS_KEY] = dismissed;
    kv.setItem(PANEL_STATE_KEY, JSON.stringify(state));
  } catch { /* ignore */ }
}

interface WelcomeCardProps {
  /** Navigate onward (to the projection dashboard). */
  onContinue: () => void;
}

// Getting-started page. Open and editorial now that it's a full page: a wide
// hero, the three steps as an un-boxed feature row, a privacy strip, then the
// call to action. Shown on load unless the user checks "don't show this again"
// (persisted to the panel-state store); the General settings tab can force it
// back on at every load.
export function WelcomeCard({ onContinue }: WelcomeCardProps) {
  const handleDontShowAgain = () => {
    persistDismissed(true);
    onContinue();
  };

  const steps = [
    {
      icon: PanelLeft,
      title: 'Enter your plan',
      body: 'A short wizard collects ages, balances, contributions, CPP/OAS and your spending goal — and can run a partner through their own. Everything stays editable in the sidebar afterwards, live as you type.',
    },
    {
      icon: LineChart,
      title: 'Read the results',
      body: 'The summary, timeline chart and year-by-year schedule each collapse away. Monte Carlo and the historical backtest stress-test the plan against sequence risk.',
    },
    {
      icon: Sparkles,
      title: 'Improve it',
      body: 'Optimize ranks CPP/OAS timing, withdrawal orders and reverse-mortgage timing. Steering lets you drag the plan and watch the success rate move. Compare puts saved plans side by side. Help documents every input.',
    },
  ];

  return (
    <div className="max-w-3xl py-4 md:py-10">
      {/* Hero */}
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-blue-600 mb-3">
        Canadian retirement drawdown planner
      </p>
      <h2 className="text-2xl md:text-4xl font-bold text-slate-900 leading-tight tracking-tight">
        Will your money outlast you?
      </h2>
      <p className="mt-3 text-sm md:text-base text-slate-600 leading-relaxed max-w-2xl">
        RE: tired projects your savings year by year through retirement — taxes, CPP, OAS, GIS and
        all — and tells you the age your money lasts to. Everything runs in your browser; nothing is
        uploaded.
      </p>

      {/* Steps — open feature row, no boxes */}
      <div className="mt-10 md:mt-14 grid gap-x-10 gap-y-8 sm:grid-cols-3">
        {steps.map((s, i) => (
          <div key={s.title}>
            <div className="flex items-center gap-2.5 mb-2">
              <span className="text-xs font-bold text-slate-300 tabular-nums">{String(i + 1).padStart(2, '0')}</span>
              <s.icon size={17} className="text-blue-600" />
              <h3 className="text-sm font-semibold text-slate-900">{s.title}</h3>
            </div>
            <p className="text-[13px] text-slate-600 leading-relaxed">{s.body}</p>
          </div>
        ))}
      </div>

      {/* Privacy strip — a hairline divider, not a card */}
      <div className="mt-10 md:mt-14 pt-6 border-t border-slate-200 flex items-start gap-3">
        <ShieldCheck size={18} className="shrink-0 text-emerald-600 mt-0.5" />
        <p className="text-[13px] text-slate-600 leading-relaxed">
          <span className="font-semibold text-slate-800">Your data never leaves this device.</span>{' '}
          Plans, settings and results live only in this browser's local storage. Clearing browser
          data (or switching device) starts fresh — use the Data page to keep a backup file.
        </p>
      </div>

      {/* CTA */}
      <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3">
        <button
          onClick={onContinue}
          className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-md hover:bg-blue-700"
        >
          Get started <ArrowRight size={16} />
        </button>
        <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer select-none">
          <input type="checkbox" onChange={(e) => { if (e.target.checked) handleDontShowAgain(); }} />
          Don't show this again
        </label>
      </div>

      <p className="mt-10 text-[11px] text-slate-400 leading-relaxed max-w-2xl">
        For education and exploration only — RE: tired produces simplified estimates from a model of
        Canadian tax and benefit rules, not financial, tax, or investment advice. Real outcomes will
        differ. Consult a qualified financial planner or tax professional before acting on anything
        you see here.
      </p>
    </div>
  );
}
