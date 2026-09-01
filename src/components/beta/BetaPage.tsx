// The shared beta page chrome — brand header, the named homes (Details ▾,
// Profiles, Schedule, Insights, Data, style guide), the persistent verdict
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
import { Maximize2, Minimize2 } from 'lucide-react';
import { prefKV } from '../../lib/prefKv';

const DOCK_PREF_KEY = 'wealthconsole_dock_open';
// Remember the dock's open state across loads (issue #20 prefKV — captured by
// every full backup). Default open on desktop; closed reads as the literal '0'.
function readDockOpen(): boolean {
  return prefKV().getItem(DOCK_PREF_KEY) !== '0';
}

export interface VerdictChip {
  tone: 'holds' | 'short' | 'borderline' | 'checking';
  age: string;
  label: string;
}

/** The phone menu's contents — the same named homes the desktop row shows
 *  (plus Dashboard/Details/Help, which desktop reaches other ways). Exported
 *  so tests can prove nothing was dropped on phones. */
export const MOBILE_MENU_ITEMS: Array<{ view: 'projection' | 'math' | 'eq' | 'scenarios' | 'details' | 'data' | 'print' | 'settings' | 'help'; label: string }> = [
  { view: 'projection', label: 'Dashboard' },
  { view: 'math', label: 'Schedule' },
  { view: 'eq', label: 'Insights' },
  { view: 'scenarios', label: 'Profiles' },
  { view: 'details', label: 'Details' },
  { view: 'data', label: 'Data' },
  { view: 'print', label: 'Print' },
  { view: 'settings', label: 'Settings' },
  { view: 'help', label: 'Help' },
];

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
   *  Assistant button + right rail on. THE SAME element must be passed on
   *  every page — it always sits at the same tree position, so navigating
   *  never unmounts the conversation and a stream keeps running. */
  assistant?: ReactNode;
  children?: ReactNode;
}) {
  // The dock's open state is remembered (prefKV) — closing it once keeps it
  // closed across loads and pages until reopened. Default open. Fullscreen is
  // session-only: it's a viewing mode, not a preference.
  const [dockOpen, setDockOpenState] = useState<boolean>(readDockOpen);
  const [fullscreen, setAssistantFullscreen] = useState(false);
  const setDockOpen = (open: boolean) => {
    setDockOpenState(open);
    try { prefKV().setItem(DOCK_PREF_KEY, open ? '1' : '0'); } catch { /* storage blocked */ }
  };

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
            <div className="grid grid-cols-1 gap-px sm:grid-cols-2">
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

          <Link view="math" className="hidden px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900 md:block">Schedule</Link>
          <Link view="eq" className="hidden px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900 md:block">Insights</Link>
          <Link view="scenarios" className="hidden px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900 md:block">Profiles</Link>
          <Link view="data" className="hidden px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900 md:block">Data</Link>
          <Link view="print" className="hidden px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900 md:block">Print</Link>
          <Link view="settings" className="hidden px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900 md:block">Settings</Link>

          {/* Phones: the same named homes collapse into one Menu — the row
              (logo, Menu, Assistant, verdict chip) fits a 375px viewport. */}
          <div className="md:hidden">
            <Dropdown label="Menu">
              <div className="flex flex-col">
                {MOBILE_MENU_ITEMS.map(item => (
                  <Link key={item.view} view={item.view} className="px-2 py-1.5 text-[13px] text-slate-600 hover:bg-slate-50 hover:text-slate-900">
                    {item.label}
                  </Link>
                ))}
              </div>
            </Dropdown>
          </div>

          <div className="flex-1" />
          {actions}

          {/* the assistant toggle — ALWAYS present, not gated on the dock
              being wired: one click opens or closes it, on every page */}
          <button
            type="button"
            onClick={() => setDockOpen(!dockOpen)}
            className={`border px-3 py-1.5 text-xs font-semibold transition-colors ${
              dockOpen
                ? 'border-slate-900 bg-slate-900 text-white hover:bg-slate-700'
                : 'border-slate-300 text-slate-800 hover:border-slate-900'
            }`}
            title="The assistant — reads your plan, answers questions, shows its work"
          >
            Assistant
          </button>

          {/* the persistent verdict chip — number and colour carry it; the words live in the tooltip */}
          <Link view="projection" className="flex items-center gap-2 border-l border-slate-200 pl-3" aria-label={`Back to the verdict — ${chip.label}`}>
            <span title={chip.label} className="inline-block h-2.5 w-2.5" style={{ backgroundColor: chipDot(chip.tone) }} />
            <span className="num text-[14px] font-bold text-slate-900">{chip.age}</span>
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

        {/* The assistant dock. Closing it (header button) hides the rail but
            NEVER unmounts the conversation — the same element sits at the
            same tree position every page, so a stream keeps running and the
            chat is exactly as you left it when you reopen. Desktop: sticky
            340px rail, or fullscreen from its own expand button. Phones: a
            full-screen sheet when open, gone when closed. */}
        {assistant && (
          <aside
            className={`${
              dockOpen
                ? fullscreen
                  ? 'fixed inset-0 z-50 top-12 flex flex-col'
                  : 'fixed inset-0 z-50 hidden flex-col lg:sticky lg:top-12 lg:z-0 lg:flex lg:h-[calc(100vh-3rem)] lg:w-[340px] lg:shrink-0'
                : 'hidden'
            } border-l border-slate-200 bg-white`}
            aria-label="Assistant"
          >
            <div className="flex h-11 shrink-0 items-center gap-2.5 border-b border-slate-200 px-4">
              <div className="flex h-5 w-5 items-center justify-center bg-slate-900 text-[8px] font-bold text-white">RE</div>
              <HelpHint topic="assistant" />
              <div className="flex-1" />
              {/* fullscreen toggle: arrows out to expand, in to return to the rail */}
              {fullscreen ? (
                <button
                  type="button"
                  onClick={() => setAssistantFullscreen(false)}
                  className="p-1 text-slate-400 hover:text-slate-700"
                  aria-label="Return the assistant to the side rail"
                  title="Back to the side rail"
                >
                  <Minimize2 size={14} />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setAssistantFullscreen(true)}
                  className="p-1 text-slate-400 hover:text-slate-700"
                  aria-label="Expand the assistant to fullscreen"
                  title="Fullscreen"
                >
                  <Maximize2 size={14} />
                </button>
              )}
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
