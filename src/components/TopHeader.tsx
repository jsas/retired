import { useState } from 'react';
import { ChevronDown, Settings, Download, Upload, Save, FolderOpen, RotateCcw, Dices, BookOpen, History, Heart, Menu, MoreVertical } from 'lucide-react';
import type { RetirementInputs } from '../lib/retirementEngine';

interface TopHeaderProps {
  onToggleSidebar: () => void;
  scenarios: Array<{ id: string; name: string; inputs: RetirementInputs }>;
  activeScenarioId: string;
  onScenarioChange: (id: string) => void;
  onSave: () => void;
  hasUnsavedChanges: boolean;
  onManageScenarios: () => void;
  onResetScenario: () => void;
  onRunMonteCarlo: () => void;
  onRunBacktest: () => void;
  onOpenSettings: () => void;
  onExportDb: () => void;
  onImportDb: (file: File) => void;
  onOpenDonate: () => void;
  onOpenHelp: () => void;
}

const BTN = 'flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-neutral-300 hover:bg-neutral-800 hover:text-white rounded';
const SEP = 'w-px h-5 bg-neutral-700';
// Full-width row inside the mobile overflow dropdown.
const MENU_ITEM = 'w-full flex items-center gap-2.5 px-3 py-2 text-xs text-neutral-200 hover:bg-neutral-800 rounded text-left';

export function TopHeader({
  onToggleSidebar,
  scenarios,
  activeScenarioId,
  onScenarioChange,
  onSave,
  hasUnsavedChanges,
  onManageScenarios,
  onResetScenario,
  onRunMonteCarlo,
  onRunBacktest,
  onOpenSettings,
  onExportDb,
  onImportDb,
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
        <FolderOpen size={14} /> Scenarios
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
      <button onClick={() => { closeMenu(); onExportDb(); }} className={MENU_ITEM}>
        <Download size={14} /> Export
      </button>
      <label className={`${MENU_ITEM} cursor-pointer`}>
        <Upload size={14} /> Import
        <input
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={e => {
            const file = e.target.files?.[0];
            if (file) onImportDb(file);
            e.target.value = '';
            closeMenu();
          }}
        />
      </label>
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
      </div>

      {/* Project selector */}
      <div className="relative min-w-0">
        <select
          value={activeScenarioId}
          onChange={(e) => onScenarioChange(e.target.value)}
          className="flex items-center gap-1.5 px-2.5 py-1.5 bg-neutral-800 rounded text-xs hover:bg-neutral-700 cursor-pointer appearance-none pr-7 max-w-[10rem] md:max-w-none truncate"
        >
          {scenarios.map(scenario => (
            <option key={scenario.id} value={scenario.id} className="bg-neutral-800">
              {scenario.name}
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
        title={hasUnsavedChanges ? 'Save current inputs to the active scenario' : 'No unsaved changes'}
      >
        <Save size={14} /> Save
        {hasUnsavedChanges && <span className="w-1.5 h-1.5 bg-white rounded-full" />}
      </button>

      {/* Desktop-only inline actions (hidden below md) */}
      <div className="hidden md:flex items-center gap-2 flex-1 min-w-0">
        <div className={SEP} />
        <button onClick={onManageScenarios} className={BTN} title="Create, rename, duplicate, and delete scenarios">
          <FolderOpen size={14} /> Scenarios
        </button>
        <button onClick={onResetScenario} className={BTN} title="Discard unsaved changes and revert to this scenario's last-saved inputs">
          <RotateCcw size={14} /> Reset
        </button>
        <div className={SEP} />
        <button onClick={onRunMonteCarlo} className={BTN} title="Run 500 randomized market scenarios and chart the probability bands">
          <Dices size={14} /> Monte Carlo
        </button>
        <button onClick={onRunBacktest} className={BTN} title="Replay the plan against every rolling window of historical Canadian real returns since 1970">
          <History size={14} /> Backtest
        </button>
        <div className="flex-1" />
        <button onClick={onExportDb} className={BTN} title="Download the entire app database (scenarios + settings) as JSON">
          <Download size={14} /> Export
        </button>
        <label className={`${BTN} cursor-pointer`} title="Load an app database JSON file (replaces all scenarios and settings)">
          <Upload size={14} /> Import
          <input
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={e => {
              const file = e.target.files?.[0];
              if (file) onImportDb(file);
              e.target.value = '';
            }}
          />
        </label>
        <button onClick={onOpenSettings} className={BTN} title="Open the engine settings page (tax tables, RRIF rates, OAS)">
          <Settings size={14} /> Settings
        </button>
        <button onClick={onOpenDonate} className={BTN} title="Support the project — what donations fund">
          <Heart size={14} /> Donate
        </button>
        <button onClick={onOpenHelp} className={BTN} title="Open the help & documentation page — what every input means and how the engine works">
          <BookOpen size={14} /> Help
        </button>
      </div>

      {/* Mobile overflow menu trigger */}
      <div className="flex-1 md:hidden" />
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
