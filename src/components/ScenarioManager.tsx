import { useState, useEffect, useMemo } from 'react';
import { Plus, Edit3, Trash2, Save, X, Copy, Check, History, Undo2 } from 'lucide-react';
import type { RetirementInputs } from '../lib/retirementEngine';
import { baselineInputs } from '../lib/scenarioStorage';
import { diffRevisions, MAX_REVISIONS, type ScenarioRevision } from '../lib/scenarioRevisions';

interface Scenario {
  id: string;
  name: string;
  inputs: RetirementInputs;
  /** True when this is a clean baseline (New Scenario) so the parent can run
   *  the setup wizard; false/undefined for a Duplicate (already-filled plan). */
  isFresh?: boolean;
}

interface ScenarioManagerProps {
  scenarios: Scenario[];
  activeScenarioId: string;
  onScenariosChange: (scenarios: Scenario[]) => void;
  /** Every scenario's revision history (all scenarios, newest last). */
  revisions: ScenarioRevision[];
  /** Roll the ACTIVE scenario back to a revision (parent applies + persists). */
  onRollback: (revisionId: string) => void;
  /** Select a scenario and navigate back to the dashboard. */
  onSelectScenario: (id: string) => void;
  /** Add a freshly-built scenario and make it active. The parent owns this so
   *  the new scenario is registered AND selected in one update — calling
   *  onScenariosChange then onSelectScenario separately races (the select reads
   *  the scenario list before the new one has been added). */
  onCreateScenario: (scenario: Scenario) => void;
}

// Manage-scenarios page (was a modal). Light-themed to match the other routed
// pages; selecting a scenario loads it and returns to the projection dashboard.
export function ScenarioManager({ scenarios, activeScenarioId, onScenariosChange, revisions, onRollback, onSelectScenario, onCreateScenario }: ScenarioManagerProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  /** Which scenario's history is expanded (one at a time keeps it readable). */
  const [historyFor, setHistoryFor] = useState<string | null>(null);

  useEffect(() => {
    if (editingId) {
      const scenario = scenarios.find(s => s.id === editingId);
      if (scenario) setEditingName(scenario.name);
    }
  }, [editingId, scenarios]);

  // New Scenario = a clean baseline, NOT a copy of the active plan. Branching
  // the current plan is what Duplicate is for.
  const handleCreateNew = () => {
    onCreateScenario({
      id: `scenario-${Date.now()}`,
      name: `New Scenario ${scenarios.length + 1}`,
      inputs: baselineInputs(),
      isFresh: true,
    });
  };

  const handleDuplicate = (id: string) => {
    const scenario = scenarios.find(s => s.id === id);
    if (!scenario) return;
    onCreateScenario({
      id: `scenario-${Date.now()}`,
      name: `${scenario.name} Copy`,
      inputs: JSON.parse(JSON.stringify(scenario.inputs)),
      isFresh: false,
    });
  };

  const handleRename = () => {
    if (!editingId || !editingName.trim()) return;
    onScenariosChange(scenarios.map(s => (s.id === editingId ? { ...s, name: editingName.trim() } : s)));
    setEditingId(null);
    setEditingName('');
  };

  const handleDelete = (id: string) => {
    if (scenarios.length <= 1) return;
    const updated = scenarios.filter(s => s.id !== id);
    onScenariosChange(updated);
    if (id === activeScenarioId) onSelectScenario(updated[0].id);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-lg font-bold text-slate-900">Manage Scenarios</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Click a scenario to load it. Duplicate to branch a what-if; rename or delete below.
            Each save keeps a revision (last {MAX_REVISIONS} per scenario) you can roll back to.
          </p>
        </div>
        <button
          onClick={handleCreateNew}
          className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 rounded text-xs text-white flex items-center gap-1.5"
        >
          <Plus size={12} /> New Scenario
        </button>
      </div>

      <div className="space-y-2">
        {scenarios.map(scenario => {
          const isActive = scenario.id === activeScenarioId;
          const isEditing = editingId === scenario.id;
          return (
            <div
              key={scenario.id}
              className={`p-3 rounded border bg-white ${
                isActive ? 'border-blue-400 ring-1 ring-blue-200' : 'border-slate-200'
              }`}
            >
              <div className="flex items-center gap-2">
                {isEditing ? (
                  <div className="flex flex-1 items-center gap-2">
                    <input
                      type="text"
                      value={editingName}
                      onChange={(e) => setEditingName(e.target.value)}
                      className="flex-1 px-2 py-1 bg-white border border-slate-300 rounded text-sm text-slate-900"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleRename();
                        if (e.key === 'Escape') setEditingId(null);
                      }}
                    />
                    <button onClick={handleRename} className="p-1.5 hover:bg-slate-100 rounded" title="Save name">
                      <Save size={14} className="text-emerald-600" />
                    </button>
                    <button onClick={() => setEditingId(null)} className="p-1.5 hover:bg-slate-100 rounded" title="Cancel">
                      <X size={14} className="text-slate-500" />
                    </button>
                  </div>
                ) : (
                  <>
                    <button onClick={() => onSelectScenario(scenario.id)} className="flex-1 text-left min-w-0">
                      <div className="text-sm font-medium text-slate-900 truncate">{scenario.name}</div>
                      <div className="text-[11px] text-slate-500">
                        {isActive ? 'Active — currently loaded' : 'Click to load'}
                      </div>
                    </button>
                    <div className="flex items-center gap-1 shrink-0">
                      {isActive && <Check size={15} className="text-blue-600 mr-1" />}
                      <button
                        onClick={() => setHistoryFor(historyFor === scenario.id ? null : scenario.id)}
                        className={`p-1.5 rounded ${historyFor === scenario.id ? 'bg-blue-50' : 'hover:bg-slate-100'}`}
                        title="Revision history"
                      >
                        <History size={14} className="text-slate-500" />
                      </button>
                      <button
                        onClick={() => handleDuplicate(scenario.id)}
                        className="p-1.5 hover:bg-slate-100 rounded"
                        title="Duplicate"
                      >
                        <Copy size={14} className="text-slate-500" />
                      </button>
                      <button
                        onClick={() => setEditingId(scenario.id)}
                        className="p-1.5 hover:bg-slate-100 rounded"
                        title="Rename"
                      >
                        <Edit3 size={14} className="text-slate-500" />
                      </button>
                      <button
                        onClick={() => handleDelete(scenario.id)}
                        disabled={scenarios.length <= 1}
                        className="p-1.5 hover:bg-slate-100 rounded disabled:opacity-30"
                        title={scenarios.length <= 1 ? 'Keep at least one scenario' : 'Delete'}
                      >
                        <Trash2 size={14} className="text-slate-500" />
                      </button>
                    </div>
                  </>
                )}
              </div>

              {/* Revision history for this scenario, newest first. Only the
                  active scenario can roll back (the parent applies to it). */}
              {historyFor === scenario.id && (
                <RevisionList
                  scenarioId={scenario.id}
                  revisions={revisions}
                  currentInputs={scenario.inputs}
                  canRollback={isActive}
                  onRollback={onRollback}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** One scenario's revisions, newest first. Each row diffs against the
 *  NEXT-NEWER revision (or the current plan for the newest) — i.e. what
 *  changed to get here — and rolling back to a row DELETES every revision
 *  newer than it (history rewinds, doesn't branch). */
function RevisionList({ scenarioId, revisions, currentInputs, canRollback, onRollback }: {
  scenarioId: string;
  revisions: ScenarioRevision[];
  /** This scenario's inputs as saved right now (the newest row's baseline). */
  currentInputs: RetirementInputs;
  canRollback: boolean;
  onRollback: (revisionId: string) => void;
}) {
  const mine = useMemo(
    () => revisions
      .filter(r => r.scenarioId === scenarioId)
      .sort((a, b) => (b.at - a.at) || (b.id < a.id ? -1 : 1)), // newest first
    [revisions, scenarioId],
  );

  if (mine.length === 0) {
    return (
      <div className="mt-2 pt-2 border-t border-slate-100 text-[11px] text-slate-500">
        No revisions yet. Every save of this scenario keeps one here (last {MAX_REVISIONS}).
      </div>
    );
  }

  return (
    <div className="mt-2 pt-2 border-t border-slate-100 space-y-1.5">
      {mine.map((rev, i) => (
        <RevisionRow
          key={rev.id}
          rev={rev}
          // The diff baseline for row i is the state at i-1 (newer); for the
          // newest row it's the plan as saved right now.
          baseline={i === 0 ? currentInputs : mine[i - 1].inputs}
          canRollback={canRollback}
          onRollback={onRollback}
        />
      ))}
    </div>
  );
}

function RevisionRow({ rev, baseline, canRollback, onRollback }: {
  rev: ScenarioRevision;
  /** The inputs this row is diffed against: the next-newer revision's
   *  snapshot (or the current plan, for the newest row). */
  baseline: RetirementInputs;
  canRollback: boolean;
  onRollback: (revisionId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  /** What this revision changed relative to the state just after it —
   *  recomputed when the baseline changes (i.e. after any save/rollback). */
  const diffs = useMemo(
    () => diffRevisions(rev.inputs, baseline),
    [rev, baseline],
  );

  const when = new Date(rev.at).toLocaleString('en-CA', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
  const source = rev.source === 'agent' ? 'agent change'
    : rev.source === 'revert' ? 'rollback' : 'save';

  return (
    <div className="flex items-start gap-2 text-[11px]">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex-1 text-left min-w-0 hover:bg-slate-50 rounded px-1.5 py-1 -mx-1.5"
      >
        <span className="font-medium text-slate-700">{when}</span>
        <span className="text-slate-400"> · </span>
        <span className="text-slate-500">{source}</span>
        <span className="text-slate-400"> · </span>
        <span className="text-slate-500">{diffs.length === 0 ? 'no changes from previous' : `${diffs.length} change${diffs.length === 1 ? '' : 's'}`}</span>
        {open && diffs.length > 0 && (
          <div className="mt-1 space-y-0.5 text-[10px] text-slate-600 font-mono break-all">
            {diffs.map(d => (
              <div key={d.field}>
                <span className="text-slate-500">{d.field}:</span>{' '}
                <span className="text-rose-600">{fmt(d.from)}</span>
                {' → '}
                <span className="text-emerald-700">{fmt(d.to)}</span>
              </div>
            ))}
          </div>
        )}
      </button>
      {canRollback && (
        <button
          // Rewind, not branch: everything after this point is deleted from
          // history immediately — no confirm, the row title says what it does.
          onClick={() => onRollback(rev.id)}
          className="p-1 hover:bg-slate-100 rounded shrink-0"
          title="Roll back to this revision (deletes newer revisions)"
        >
          <Undo2 size={12} className="text-slate-500" />
        </button>
      )}
    </div>
  );
}

/** Compact value formatting for diffs (structural blocks collapse to a tag). */
function fmt(v: unknown): string {
  if (v === undefined) return '(absent)';
  if (v === null) return 'null';
  if (typeof v === 'number') return String(Math.round(v * 100) / 100);
  if (typeof v === 'boolean') return String(v);
  if (typeof v === 'string') return `"${v}"`;
  if (Array.isArray(v)) return `[${v.length} items]`;
  return '{…}';
}
