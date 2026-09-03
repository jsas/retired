import { useState, useEffect, useMemo } from 'react';
import type { RetirementInputs } from '@retired/engine-core/retirementEngine';
import { baselineInputs } from '@retired/engine-core/exampleScenarios';
import { diffRevisions, MAX_REVISIONS, type ScenarioRevision } from '../lib/scenarioRevisions';
import { Dot } from '../design/primitives';
import { BLUE, cls } from '../design/tokens';

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

// The Profiles page body (BetaPage owns the page title — no heading here). One
// hairline list: the active plan reads by weight and its blue dot, the rest
// sit quiet until hovered. Every save keeps a revision you can roll back to.
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
      <div className="flex items-start justify-between gap-4">
        <p className="max-w-lg text-[12.5px] leading-relaxed text-slate-500">
          Click a profile to load it. Duplicate branches a what-if; each save keeps a
          revision (last {MAX_REVISIONS} per plan) you can roll back to.
        </p>
        <button onClick={handleCreateNew} className={`${cls.primaryBtn} shrink-0`}>
          New profile
        </button>
      </div>

      <div className="mt-5 divide-y divide-slate-100 border-y border-slate-200">
        {scenarios.map(scenario => {
          const isActive = scenario.id === activeScenarioId;
          const isEditing = editingId === scenario.id;
          return (
            <div key={scenario.id} className="py-3">
              <div className="flex items-center gap-3">
                {isEditing ? (
                  <div className="flex flex-1 items-center gap-2">
                    <input
                      type="text"
                      value={editingName}
                      onChange={(e) => setEditingName(e.target.value)}
                      className={`${cls.input} flex-1 py-1.5`}
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleRename();
                        if (e.key === 'Escape') setEditingId(null);
                      }}
                    />
                    <button onClick={handleRename} className={cls.hairlineBtn} title="Save name">Save</button>
                    <button onClick={() => setEditingId(null)} className={cls.hairlineBtn} title="Cancel">Cancel</button>
                  </div>
                ) : (
                  <>
                    <button onClick={() => onSelectScenario(scenario.id)} className="min-w-0 flex-1 text-left">
                      <div className="flex items-center gap-2">
                        {isActive && <Dot color={BLUE} title="the active plan" />}
                        <span className={`truncate text-[14px] ${isActive ? 'font-semibold text-slate-900' : 'font-medium text-slate-600'}`}>
                          {scenario.name}
                        </span>
                      </div>
                      <div className="mt-0.5 text-[11px] text-slate-400">
                        {isActive ? 'Active — the dashboard shows this plan' : 'Click to load'}
                      </div>
                    </button>
                    <div className="flex shrink-0 items-center gap-1 text-[11px]">
                      <RowAction onClick={() => setHistoryFor(historyFor === scenario.id ? null : scenario.id)}>
                        {historyFor === scenario.id ? 'Hide history' : 'History'}
                      </RowAction>
                      <RowAction onClick={() => handleDuplicate(scenario.id)}>Duplicate</RowAction>
                      <RowAction onClick={() => setEditingId(scenario.id)}>Rename</RowAction>
                      <RowAction
                        onClick={() => handleDelete(scenario.id)}
                        disabled={scenarios.length <= 1}
                        title={scenarios.length <= 1 ? 'Keep at least one scenario' : 'Delete this scenario'}
                      >
                        <span className="text-rose-700">Delete</span>
                      </RowAction>
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

/** A quiet per-row text action — words, not icon buttons. */
function RowAction({ onClick, disabled, title, children }: {
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="px-1.5 py-1 text-slate-400 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-30"
    >
      {children}
    </button>
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
      <div className="mt-2 border-t border-slate-100 pt-2 text-[11px] text-slate-400">
        No revisions yet. Every save of this scenario keeps one here (last {MAX_REVISIONS}).
      </div>
    );
  }

  return (
    <div className="mt-3 space-y-1.5 border-t border-slate-100 pt-2.5">
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
        className="-mx-1.5 min-w-0 flex-1 px-1.5 py-1 text-left hover:bg-slate-50"
      >
        <span className="num font-medium text-slate-700">{when}</span>
        <span className="text-slate-300"> · </span>
        <span className="text-slate-500">{source}</span>
        <span className="text-slate-300"> · </span>
        <span className="text-slate-500">{diffs.length === 0 ? 'no changes from previous' : `${diffs.length} change${diffs.length === 1 ? '' : 's'}`}</span>
        {open && diffs.length > 0 && (
          <div className="num mt-1 break-all font-mono text-[10px] text-slate-600">
            {diffs.map(d => (
              <div key={d.field}>
                <span className="text-slate-400">{d.field}:</span>{' '}
                <span className="text-rose-700">{fmt(d.from)}</span>
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
          className="shrink-0 px-1 py-1 text-slate-400 hover:text-slate-900"
          title="Roll back to this revision (deletes newer revisions)"
        >
          undo
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
