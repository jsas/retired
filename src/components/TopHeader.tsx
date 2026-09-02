import { useState } from 'react';
import { ChevronDown, Settings, Database, Save, FolderOpen, RotateCcw, Dices, BookOpen, History, Heart, Menu, MoreVertical } from 'lucide-react';
import type { RetirementInputs } from '@retired/engine-core/retirementEngine';

interface TopHeaderProps {
  onToggleSidebar: () => void;
  plans: Array<{ id: string; name: string; inputs: RetirementInputs }>;
  activePlanId: string;
  onScenarioChange: (id: string) => void;
  onSave: () => void;
  hasUnsavedChanges: boolean;
  onManageScenarios: () => void;
  onResetScenario: () => void;
  onRunMonteCarlo: () => void;
  onRunBacktest: () => void;
  onOpenSettings: () => void;
  onOpenData: () => void;
  onOpenDonate: () => void;
  onOpenHelp: () => void;
}

const BTN = 'flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-neutral-300 hover:bg-neutral-800 hover:text-white rounded cursor-pointer';
const SEP = 'w-px h-5 bg-neutral-700';
// Full-width row inside the mobile overflow dropdown.
const MENU_ITEM = 'w-full flex items-center gap-2.5 px-3 py-2 text-xs text-neutral-200 hover:bg-neutral-800 rounded text-left cursor-pointer';

// GitHub's octocat mark (lucide doesn't ship brand icons). Sized to match the
// 14px lucide icons in the header.
function GitHubIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

export function TopHeader({
  onToggleSidebar,
  plans,
  activePlanId,
  onScenarioChange,
  onSave,
  hasUnsavedChanges,
  onManageScenarios,
  onResetScenario,
  onRunMonteCarlo,
  onRunBacktest,
  onOpenSettings,
  onOpenData,
  onOpenDonate,
  onOpenHelp
}: TopHeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = () => setMenuOpen(false);

  // The actions that collapse into the overflow menu on narrow screens. Each is
  // rendered as a full-width row; the import row carries the hidden file input.
  const overflowItems = (
    <>
      <button onClick={() => { closeMenu(); onManageScenarios(); }} className={MENU_ITEM}>
        <FolderOpen size={14} /> Plans
      </button>
      <button onClick={() => { closeMenu(); onResetScenario(); }} className={MENU_ITEM}>
        <RotateCcw size={14} /> Reset
      </button>
      <div className="my-1 h-px bg-neutral-800" />
      <button onClick={() => { closeMenu(); onRunMonteCarlo(); }} className={MENU_ITEM}>
        <Dices size={14} /> Monte Carlo
      </button>
      <button onClick={() => { closeMenu(); onRunBacktest(); }} className={MENU_ITEM}>
        <History size={14} /> Backtest
      </button>
      <div className="my-1 h-px bg-neutral-800" />
      <button onClick={() => { closeMenu(); onOpenData(); }} className={MENU_ITEM}>
        <Database size={14} /> Data
      </button>
      <div className="my-1 h-px bg-neutral-800" />
      <button onClick={() => { closeMenu(); onOpenSettings(); }} className={MENU_ITEM}>
        <Settings size={14} /> Settings
      </button>
      <button onClick={() => { closeMenu(); onOpenDonate(); }} className={MENU_ITEM}>
        <Heart size={14} /> Donate
      </button>
      <button onClick={() => { closeMenu(); onOpenHelp(); }} className={MENU_ITEM}>
        <BookOpen size={14} /> Help
      </button>
    </>
  );

  return (
    <header className="relative bg-neutral-900 text-white flex items-center flex-wrap px-3 md:px-4 py-2 md:py-0 md:h-14 gap-2 border-b border-neutral-800">
      {/* Hamburger — toggles the input drawer on mobile */}
      <button
        onClick={onToggleSidebar}
        className="p-1.5 text-neutral-300 hover:bg-neutral-800 hover:text-white rounded md:hidden"
        title="Toggle inputs"
      >
        <Menu size={18} />
      </button>

      {/* Logo — the blue chip carries the "RE:", so the wordmark is just "tired" */}
      <div className="flex items-center gap-2 font-semibold text-sm mr-1 md:mr-2">
        <div className="w-6 h-6 bg-blue-600 rounded flex items-center justify-center text-xs font-bold">RE:</div>
        <span>tired</span>
        {/* Build revision (short commit hash) — inconspicuous on purpose; it
            only exists so a user can tell whether the page they're looking at
            is running the latest deploy. */}
        <span
          className="text-[10px] font-normal text-neutral-600 select-text"
          title={`Build revision ${__APP_REVISION__}`}
        >
          {__APP_REVISION__}
        </span>
      </div>

      {/* Project selector */}
      <div className="relative min-w-0">
        <select
          value={activePlanId}
          onChange={(e) => onScenarioChange(e.target.value)}
          className="flex items-center gap-1.5 px-2.5 py-1.5 bg-neutral-800 rounded text-xs hover:bg-neutral-700 cursor-pointer appearance-none pr-7 max-w-[10rem] md:max-w-none truncate"
        >
          {plans.map(plan => (
            <option key={plan.id} value={plan.id} className="bg-neutral-800">
              {plan.name}
            </option>
          ))}
        </select>
        <ChevronDown size={14} className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
      </div>

      {/* Save — always visible */}
      <button
        onClick={onSave}
        disabled={!hasUnsavedChanges}
        className={hasUnsavedChanges
          ? 'flex items-center gap-1.5 px-2.5 py-1.5 text-xs bg-emerald-600 text-white hover:bg-emerald-700 rounded font-medium'
          : 'flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-neutral-600 rounded cursor-not-allowed'}
        title={hasUnsavedChanges ? 'Save current inputs to the active plan' : 'No unsaved changes'}
      >
        <Save size={14} /> Save
        {hasUnsavedChanges && <span className="w-1.5 h-1.5 bg-white rounded-full" />}
      </button>

      {/* Desktop-only inline actions (hidden below md) */}
      <div className="hidden md:flex items-center gap-2 flex-1 min-w-0">
        <div className={SEP} />
        <button onClick={onManageScenarios} className={BTN} title="Create, rename, duplicate, and delete plans">
          <FolderOpen size={14} /> Plans
        </button>
        <button onClick={onResetScenario} className={BTN} title="Discard unsaved changes and revert to this plan's last-saved inputs">
          <RotateCcw size={14} /> Reset
        </button>
        <div className={SEP} />
        <button onClick={onRunMonteCarlo} className={BTN} title="Run 500 randomized market plans and chart the probability bands">
          <Dices size={14} /> Monte Carlo
        </button>
        <button onClick={onRunBacktest} className={BTN} title="Replay the plan against every rolling window of historical Canadian real returns since 1970">
          <History size={14} /> Backtest
        </button>
        <div className="flex-1" />
        <button onClick={onOpenData} className={BTN} title="Import / export the projection, a full backup, or re-import a file">
          <Database size={14} /> Data
        </button>
        <button onClick={onOpenSettings} className={BTN} title="Open the engine settings page (tax tables, RRIF rates, OAS)">
          <Settings size={14} /> Settings
        </button>
        <button onClick={onOpenDonate} className={BTN} title="Support the project — what donations fund">
          <Heart size={14} /> Donate
        </button>
        <button onClick={onOpenHelp} className={BTN} title="Open the help & documentation page — what every input means and how the engine works">
          <BookOpen size={14} /> Help
        </button>
        <a
          href="https://github.com/jsas/retired"
          target="_blank"
          rel="noopener noreferrer"
          className={BTN}
          title="View the source on GitHub (jsas/retired)"
        >
          <GitHubIcon />
        </a>
      </div>

      {/* Mobile overflow menu trigger */}
      <div className="flex-1 md:hidden" />
      <a
        href="https://github.com/jsas/retired"
        target="_blank"
        rel="noopener noreferrer"
        className="p-1.5 text-neutral-300 hover:bg-neutral-800 hover:text-white rounded md:hidden"
        title="View the source on GitHub (jsas/retired)"
      >
        <GitHubIcon size={18} />
      </a>
      <button
        onClick={() => setMenuOpen((o) => !o)}
        className="p-1.5 text-neutral-300 hover:bg-neutral-800 hover:text-white rounded md:hidden"
        title="More actions"
        aria-expanded={menuOpen}
      >
        <MoreVertical size={18} />
      </button>

      {/* Mobile overflow dropdown */}
      {menuOpen && (
        <>
          <div className="fixed inset-0 z-40 md:hidden" onClick={closeMenu} aria-hidden="true" />
          <div className="absolute right-2 top-full z-50 mt-1 w-52 rounded-md border border-neutral-800 bg-neutral-900 p-1.5 shadow-xl md:hidden">
            {overflowItems}
          </div>
        </>
      )}
    </header>
  );
}
