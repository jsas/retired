// The shared beta page chrome — brand header, the named homes (Details ▾,
// Plans ▾, Schedule, Insights, Data, style guide), the persistent verdict
// chip, and the assistant dock. Every beta page sits inside this so navigation
// and the answer are always one glance away. Flat, hairline, sticky.
//
// The dock (f7's star): a 340px right rail on desktop, a full-screen sheet on
// phones. The app works without it — the Assistant button toggles it and it
// never traps you.
import { useState, type ReactNode } from 'react';
import { Link } from './nav';
import { Dropdown, HelpHint } from '../../design/primitives';
import { BLUE, RED_DOT, AMBER_DOT, cls } from '../../design/tokens';
import { DETAILS_SECTIONS } from './detailsSections';

export interface VerdictChip {
  tone: 'holds' | 'short' | 'borderline' | 'checking';
  age: string;
  label: string;
}

function chipDot(tone: VerdictChip['tone']) {
  return tone === 'holds' ? BLUE : tone === 'short' ? RED_DOT : tone === 'borderline' ? AMBER_DOT : '#94a3b8';
}

export function BetaPage({ title, hint, chip, actions, assistant, children }: {
  title?: string;
  /** A help-topic id — renders a ? beside the page title. */
  hint?: string;
  chip: VerdictChip;
  actions?: ReactNode;
  /** The assistant conversation (AgentPage docked). Providing it turns the
   *  Assistant button + right rail on. */
  assistant?: ReactNode;
  children: ReactNode;
}) {
  // The dock starts open on desktop (the assistant came along from the
  // landing). On phones it's a sheet that stays hidden until the Assistant
  // button opens it — the app works without it, it never traps you.
  const [dockOpen, setDockOpen] = useState(true);

  return (
    <div className="flex min-h-screen flex-col bg-white text-slate-800">
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-12 max-w-5xl items-center gap-1 px-4">
          <Link view="welcome" className="flex h-6 w-6 shrink-0 items-center justify-center bg-slate-900 text-[10px] font-bold text-white" aria-label="Home — the welcome">
            RE:
          </Link>
          <Link view="projection" className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900">Dashboard</Link>

          <Dropdown label="Details" wide>
            <p className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              The full plan — every section one click away
            </p>
            <div className="grid grid-cols-2 gap-px">
              {DETAILS_SECTIONS.map(s => (
                <Link key={s.id} view="details" section={s.id} className="px-2 py-1.5 text-[12.5px] text-slate-600 hover:bg-slate-50 hover:text-slate-900">
                  {s.label}
                </Link>
              ))}
            </div>
            <p className="border-t border-slate-100 px-2 pt-1.5 text-[10.5px] text-slate-400">
              The map steers the two biggest of these. The rest live here.
            </p>
          </Dropdown>

          <Link view="math" className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900">Schedule</Link>
          <Link view="eq" className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900">Insights</Link>
          <Link view="scenarios" className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900">Plans</Link>
          <Link view="data" className="hidden px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900 md:block">Data</Link>
          <Link view="print" className="hidden px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900 md:block">Print</Link>
          <Link view="settings" className="hidden px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900 md:block">Settings</Link>

          <div className="flex-1" />
          {actions}

          {/* the assistant toggle — the pair's star */}
          {assistant && (
            <button
              type="button"
              onClick={() => setDockOpen((o) => !o)}
              className="border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-800 hover:border-slate-900"
              title="The assistant — reads your plan, answers questions, shows its work"
            >
              Assistant
            </button>
          )}

          {/* the persistent verdict chip */}
          <Link view="projection" className="flex items-center gap-2 border-l border-slate-200 pl-3" aria-label="Back to the verdict">
            <span className="inline-block h-2.5 w-2.5" style={{ backgroundColor: chipDot(chip.tone) }} />
            <span className="num text-[14px] font-bold text-slate-900">{chip.age}</span>
            <span className="hidden text-[9px] uppercase tracking-wider text-slate-400 sm:block">{chip.label}</span>
          </Link>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-5xl flex-1">
        <main className="w-full min-w-0 flex-1 px-4 pb-16">
          {title && (
            <div className="border-b border-slate-200 pb-4 pt-8">
              <p className={cls.sectionLabel}>{title}{hint && <HelpHint topic={hint} />}</p>
            </div>
          )}
          {children}
        </main>

        {/* The assistant dock. Desktop: sticky 340px rail beside the content,
            hidden when closed. Phones: a full-screen sheet when open, gone
            when closed — the app works without it, it never traps you. */}
        {assistant && (
          <aside
            className={`${
              dockOpen
                ? 'fixed inset-0 z-50 flex flex-col lg:sticky lg:top-12 lg:z-0 lg:flex lg:h-[calc(100vh-3rem)] lg:w-[340px] lg:shrink-0'
                : 'hidden'
            } border-l border-slate-200 bg-white`}
            aria-label="Assistant"
          >
            <div className="flex h-11 shrink-0 items-center gap-2.5 border-b border-slate-200 px-4">
              <div className="flex h-5 w-5 items-center justify-center bg-slate-900 text-[8px] font-bold text-white">RE</div>
              <div className="text-[13px] font-semibold">Assistant<HelpHint topic="assistant" /></div>
              <div className="flex-1" />
              <button
                type="button"
                onClick={() => setDockOpen(false)}
                className="px-1 text-lg leading-none text-slate-400 hover:text-slate-600"
                aria-label="Close the assistant"
              >
                ×
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">{assistant}</div>
          </aside>
        )}
      </div>

      {/* Footer: the demoted links — not nav peers, always one click away. */}
      <footer className="border-t border-slate-200">
        <div className="mx-auto flex max-w-5xl items-center gap-4 px-4 py-4 text-[11px] text-slate-400">
          <Link view="help" className="hover:text-slate-600">Help</Link>
          <Link view="donate" className="hover:text-slate-600">Support this app</Link>
          <span className="flex-1" />
          <span>Runs entirely in your browser — nothing is sent anywhere.</span>
        </div>
      </footer>
    </div>
  );
}
