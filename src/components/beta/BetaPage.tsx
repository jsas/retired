// The shared beta page chrome — brand header, the named homes (Dashboard,
// Projection, Tools ▾: Steering/Optimizer/Monte Carlo/Backtest/Solver,
// Plans, Data), the persistent verdict chip, and the assistant dock. Every
// beta page sits inside this so navigation and the answer are always one
// glance away. Flat, hairline, sticky. The profile icon (top right) is the
// current plan — #/plan, the list of plans plus the numbers behind this one.
//
// The dock (f7's star): a min-340px right rail on desktop (user-draggable
// wider, remembered), a full-screen sheet on phones. The app works without
// it — the Assistant button toggles it and it never traps you.
import { createContext, useCallback, useContext, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { Link } from './nav';
import type { View } from '../../lib/viewRoutes';
import { Dropdown, HelpHint } from '../../design/primitives';
import { BLUE, RED_DOT, AMBER_DOT, cls } from '../../design/tokens';
import { CircleUserRound, Maximize2, Minimize2, Undo2 } from 'lucide-react';

// The grow/shrink arrows follow the Assistant button's own text colour —
// white on the dark (open) button, black on the white (closed) one.
const ASSISTANT_TOGGLE_ICON = 'h-3.5 w-3.5';
import { prefKV } from '../../lib/prefKv';

/** The plan's undo surface for the header (issue #165): edits autosave, and
 *  the undo icon steps back through the saved revisions (the rollback
 *  machinery). App owns the handler; every beta page's header reads it from
 *  here so the icons never need threading through each page's props. */
export const PlanUndoContext = createContext<{ canUndo: boolean; onUndo: () => void }>({
  canUndo: false,
  onUndo: () => {},
});

const DOCK_PREF_KEY = 'wealthconsole_dock_open';
const DOCK_WIDTH_PREF_KEY = 'wealthconsole_dock_width';
/** The current rail's width — the floor the user can drag up from. */
export const DOCK_MIN_PX = 340;
const DOCK_MAX_PX = 720;
const PAGE_MAX = 'max-w-[90rem]';
// Remember the dock's open state across loads (issue #20 prefKV — captured by
// every full backup). Default open on desktop; closed reads as the literal '0'.
function readDockOpen(openRoute = false): boolean {
  if (openRoute) return true; // the #/assistant route is an explicit open
  return prefKV().getItem(DOCK_PREF_KEY) !== '0';
}

function clampDockWidth(n: number): number {
  let room = DOCK_MAX_PX;
  if (typeof window !== 'undefined' && Number.isFinite(window.innerWidth) && window.innerWidth > 0) {
    room = Math.max(DOCK_MIN_PX, window.innerWidth - 420);
  }
  return Math.min(DOCK_MAX_PX, room, Math.max(DOCK_MIN_PX, Math.round(n)));
}

function readDockWidth(): number {
  const raw = prefKV().getItem(DOCK_WIDTH_PREF_KEY);
  const n = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(n) ? clampDockWidth(n) : DOCK_MIN_PX;
}

// Is the current view the assistant's own route? The hash tells the route
// even before the view state catches up, and the initial mount is the
// important case. SSR-safe: node-rendered pages never take the open-route
// override without a browser hash to read.
function isAssistantRoute(): boolean {
  return typeof window !== 'undefined'
    && window.location.hash.replace(/^#\/?/, '').replace(/\?.*$/, '') === 'assistant';
}

export interface VerdictChip {
  tone: 'holds' | 'short' | 'borderline' | 'checking';
  age: string;
  label: string;
}

/** The Tools menu (issue #162): the five analytic surfaces, each its own page.
 *  Desktop opens them from the header dropdown; the phone menu carries the same
 *  items flat (a dropdown inside a dropdown would close on the first tap). */
export const TOOLS_MENU_ITEMS: Array<{ view: View; label: string }> = [
  { view: 'eq', label: 'Steering' },
  { view: 'optimize', label: 'Optimizer' },
  { view: 'montecarlo', label: 'Monte Carlo' },
  { view: 'backtest', label: 'Backtest' },
  { view: 'solver', label: 'Solver' },
];

/** The phone menu's contents — the same named homes the desktop row shows
 *  (plus Dashboard/Help, which desktop reaches other ways). Exported so tests
 *  can prove nothing was dropped on phones. Details lives on Plans now. */
export const MOBILE_MENU_ITEMS: Array<{ view: View; label: string }> = [
  { view: 'projection', label: 'Dashboard' },
  { view: 'math', label: 'Projection' },
  // Tools ▾ flattened: every tool one tap away on phones.
  ...TOOLS_MENU_ITEMS,
  { view: 'scenarios', label: 'Plans' },
  { view: 'data', label: 'Data' },
  { view: 'print', label: 'Print' },
  { view: 'settings', label: 'Settings' },
  { view: 'connections', label: 'Assistant connection' },
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
  // session-only: it's a viewing mode, not a preference. The assistant's own
  // route (#/assistant) is an explicit open — the pref can't close it there.
  const openRoute = isAssistantRoute();
  const [dockOpen, setDockOpenState] = useState<boolean>(() => readDockOpen(openRoute));
  const [fullscreen, setAssistantFullscreen] = useState(false);
  const [dockWidth, setDockWidth] = useState<number>(() => readDockWidth());
  const dragRef = useRef<{ startX: number; startW: number } | null>(null);
  const setDockOpen = (open: boolean) => {
    setDockOpenState(open || openRoute);
    try { prefKV().setItem(DOCK_PREF_KEY, (open || openRoute) ? '1' : '0'); } catch { /* storage blocked */ }
  };
  const persistDockWidth = useCallback((w: number) => {
    try { prefKV().setItem(DOCK_WIDTH_PREF_KEY, String(w)); } catch { /* storage blocked */ }
  }, []);
  const onResizePointerDown = useCallback((e: PointerEvent<HTMLDivElement>) => {
    // Desktop-only: phones stay a full-screen sheet, never a wide rail.
    if (typeof window !== 'undefined' && window.matchMedia?.('(max-width: 1023px)')?.matches) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { startX: e.clientX, startW: dockWidth };
  }, [dockWidth]);
  const onResizePointerMove = useCallback((e: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    // Dragging the left edge right shrinks the rail; left grows it.
    setDockWidth(clampDockWidth(drag.startW + (drag.startX - e.clientX)));
  }, []);
  const onResizePointerUp = useCallback((e: PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* already released */ }
    setDockWidth(w => {
      persistDockWidth(w);
      return w;
    });
  }, [persistDockWidth]);
  const undo = useContext(PlanUndoContext);

  return (
    <div className="flex min-h-screen flex-col bg-white text-slate-800">
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white">
        <div className={`mx-auto flex h-12 w-full ${PAGE_MAX} items-center gap-1 px-4`}>
          <Link view="welcome" className="flex h-6 w-6 shrink-0 items-center justify-center bg-slate-900 text-[10px] font-bold text-white" aria-label="Home — the welcome">
            RE:
          </Link>
          <Link view="projection" className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900">Dashboard</Link>
          <Link view="math" className="hidden px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900 md:block">Projection</Link>

          {/* The Tools menu (issue #162): the five analytic surfaces, each its
              own page — steered by the same projection timeline they all show. */}
          <div className="hidden md:block">
            <Dropdown label="Tools">
              <p className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Ask the plan a different question
              </p>
              <div className="flex flex-col">
                {TOOLS_MENU_ITEMS.map(t => (
                  <Link key={t.view} view={t.view} className="px-2 py-1.5 text-[12.5px] text-slate-600 hover:bg-slate-50 hover:text-slate-900">
                    {t.label}
                  </Link>
                ))}
              </div>
              <p className="border-t border-slate-100 px-2 pt-1.5 text-[10.5px] text-slate-400">
                Steering drags · Optimizer compares · Monte Carlo rolls the futures · Backtest replays history · Solver inverts the verdict
              </p>
            </Dropdown>
          </div>

          <Link view="scenarios" className="hidden px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900 md:block">Plans</Link>
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
              being wired: one click opens or closes it, on every page. The
              grow/shrink arrows live here too (nowhere else): click the
              arrows to expand the open dock to fullscreen or shrink it back
              to the rail — or to open straight into fullscreen when closed. */}
          <button
            type="button"
            onClick={() => setDockOpen(!dockOpen)}
            className={`flex items-center border px-3 py-1.5 text-xs font-semibold transition-colors ${
              dockOpen
                ? 'border-slate-900 bg-slate-900 text-white hover:bg-slate-700'
                : 'border-slate-300 text-slate-800 hover:border-slate-900'
            }`}
            title="The assistant — reads your plan, answers questions, shows its work"
          >
            Assistant
            <span
              role="button"
              tabIndex={0}
              aria-label={fullscreen ? 'Shrink the assistant back to the side rail' : 'Grow the assistant to fullscreen'}
              title={fullscreen ? 'Shrink' : 'Grow'}
              className={`ml-2 flex items-center border-l pl-2 ${
                dockOpen
                  ? 'border-white/30 text-white/80 hover:text-white'
                  : 'border-slate-300 text-slate-900 hover:text-slate-600'
              }`}
              onClick={(e) => { e.stopPropagation(); setAssistantFullscreen(!fullscreen); setDockOpen(true); }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault(); e.stopPropagation();
                  setAssistantFullscreen(!fullscreen); setDockOpen(true);
                }
              }}
            >
              {fullscreen
                ? <Minimize2 size={12} className={ASSISTANT_TOGGLE_ICON} />
                : <Maximize2 size={12} className={ASSISTANT_TOGGLE_ICON} />}
            </span>
          </button>

          {/* Issue #165: profile + undo beside the verdict chip. The profile
              icon is the current plan (#/plan — the list of plans plus this
              plan's numbers); undo steps back through the saved revisions. */}
          <Link
            view="scenarios"
            aria-label="Your plan — the Plans page"
            title="Your plan — switch plans or edit this one's numbers"
            className="flex h-8 w-8 items-center justify-center text-slate-600 hover:bg-slate-50 hover:text-slate-900"
          >
            <CircleUserRound size={18} />
          </Link>
          <button
            type="button"
            onClick={undo.onUndo}
            disabled={!undo.canUndo}
            aria-label="Undo — step back to the previous saved plan"
            title={undo.canUndo
              ? 'Undo — step back to the previous saved plan'
              : 'Nothing to undo — edits save automatically and undo steps through saved plans'}
            className={`flex h-8 w-8 items-center justify-center transition-colors ${
              undo.canUndo
                ? 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                : 'cursor-not-allowed text-slate-300'
            }`}
          >
            <Undo2 size={18} />
          </button>

          {/* the persistent verdict chip — number and colour carry it; the words live in the tooltip */}
          <Link view="projection" className="flex items-center gap-2 border-l border-slate-200 pl-3" aria-label={`Back to the verdict — ${chip.label}`}>
            <span title={chip.label} className="inline-block h-2.5 w-2.5" style={{ backgroundColor: chipDot(chip.tone) }} />
            <span className="num text-[14px] font-bold text-slate-900">{chip.age}</span>
          </Link>
        </div>
      </header>

      <div className={`mx-auto flex w-full ${PAGE_MAX} flex-1`}>
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
            min-340px rail (draggable wider), or fullscreen from its own
            expand button. Phones: a full-screen sheet when open, gone when
            closed — width is never applied below lg. */}
        {assistant && (
          <aside
            className={`${
              dockOpen
                ? fullscreen
                  ? 'fixed inset-0 z-50 top-12 flex flex-col'
                  // phone: full-screen sheet starting BELOW the sticky header
                  // (top-12) so the Assistant button stays reachable to close
                  // it · desktop: the sticky rail beside the content
                  : 'fixed inset-0 top-12 z-50 flex flex-col lg:sticky lg:top-12 lg:z-0 lg:h-[calc(100vh-3rem)] lg:w-[var(--dock-w)] lg:shrink-0'
                : 'hidden'
            } border-l border-slate-200 bg-white`}
            style={dockOpen && !fullscreen ? { ['--dock-w' as string]: `${dockWidth}px` } : undefined}
            aria-label="Assistant"
          >
            {dockOpen && !fullscreen && (
              <div
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize the assistant"
                aria-valuemin={DOCK_MIN_PX}
                aria-valuemax={DOCK_MAX_PX}
                aria-valuenow={dockWidth}
                tabIndex={0}
                onPointerDown={onResizePointerDown}
                onPointerMove={onResizePointerMove}
                onPointerUp={onResizePointerUp}
                onPointerCancel={onResizePointerUp}
                onKeyDown={e => {
                  const step = e.shiftKey ? 40 : 16;
                  if (e.key === 'ArrowLeft') {
                    e.preventDefault();
                    setDockWidth(w => {
                      const next = clampDockWidth(w + step);
                      persistDockWidth(next);
                      return next;
                    });
                  } else if (e.key === 'ArrowRight') {
                    e.preventDefault();
                    setDockWidth(w => {
                      const next = clampDockWidth(w - step);
                      persistDockWidth(next);
                      return next;
                    });
                  } else if (e.key === 'Home') {
                    e.preventDefault();
                    persistDockWidth(DOCK_MIN_PX);
                    setDockWidth(DOCK_MIN_PX);
                  }
                }}
                className="absolute inset-y-0 -left-1 z-10 hidden w-2 cursor-col-resize touch-none lg:block"
              />
            )}
            <div className="flex h-11 shrink-0 items-center gap-2.5 border-b border-slate-200 px-4">
              <div className="flex h-5 w-5 items-center justify-center bg-slate-900 text-[8px] font-bold text-white">RE</div>
              <HelpHint topic="assistant" />
              <div className="flex-1" />
              {/* grow/shrink moved to the header's Assistant button (its arrow
                  chips) — the dock header stays pure chrome */}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">{assistant}</div>
          </aside>
        )}
      </div>

      {/* Footer: the demoted links — not nav peers, always one click away. */}
      <footer className="border-t border-slate-200">
        <div className={`mx-auto flex w-full ${PAGE_MAX} items-center gap-4 px-4 py-4 text-[11px] text-slate-400`}>
          <Link view="help" className="hover:text-slate-600">Help</Link>
          <Link view="donate" className="hover:text-slate-600">Support this app</Link>
          <span className="flex-1" />
          <span>Runs entirely in your browser — nothing is sent anywhere.</span>
        </div>
      </footer>
    </div>
  );
}
