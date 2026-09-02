import { useState, useEffect, useMemo } from 'react';
import { Plus, Edit3, Trash2, Save, X, Copy, Check, History, Undo2 } from 'lucide-react';
import type { RetirementInputs } from '@retired/engine-core/retirementEngine';
import { baselineInputs } from '@retired/engine-core/examplePlans';
import { diffRevisions, MAX_REVISIONS, type PlanRevision } from '../lib/planRevisions';

interface Plan {
  id: string;
  name: string;
  inputs: RetirementInputs;
  /** True when this is a clean baseline (New Plan) so the parent can run
   *  the setup wizard; false/undefined for a Duplicate (already-filled plan). */
  isFresh?: boolean;
}

interface ScenarioManagerProps {
  plans: Plan[];
  activePlanId: string;
  onScenariosChange: (plans: Plan[]) => void;
  /** Every plan's revision history (all plans, newest last). */
  revisions: PlanRevision[];
  /** Roll the ACTIVE plan back to a revision (parent applies + persists). */
  onRollback: (revisionId: string) => void;
  /** Select a plan and navigate back to the dashboard. */
  onSelectScenario: (id: string) => void;
  /** Add a freshly-built plan and make it active. The parent owns this so
   *  the new plan is registered AND selected in one update — calling
   *  onScenariosChange then onSelectScenario separately races (the select reads
   *  the plan list before the new one has been added). */
  onCreateScenario: (plan: Plan) => void;
}

// Manage-plans page (was a modal). Light-themed to match the other routed
// pages; selecting a plan loads it and returns to the projection dashboard.
export function PlanManager({ plans, activePlanId, onScenariosChange, revisions, onRollback, onSelectScenario, onCreateScenario }: ScenarioManagerProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  /** Which plan's history is expanded (one at a time keeps it readable). */
  const [historyFor, setHistoryFor] = useState<string | null>(null);

  useEffect(() => {
    if (editingId) {
      const plan = plans.find(s => s.id === editingId);
      if (plan) setEditingName(plan.name);
    }
  }, [editingId, plans]);

  // New Plan = a clean baseline, NOT a copy of the active plan. Branching
  // the current plan is what Duplicate is for.
  const handleCreateNew = () => {
    onCreateScenario({
      id: `plan-${Date.now()}`,
      name: `New Plan ${plans.length + 1}`,
      inputs: baselineInputs(),
      isFresh: true,
    });
  };

  const handleDuplicate = (id: string) => {
    const plan = plans.find(s => s.id === id);
    if (!plan) return;
    onCreateScenario({
      id: `plan-${Date.now()}`,
      name: `${plan.name} Copy`,
      inputs: JSON.parse(JSON.stringify(plan.inputs)),
      isFresh: false,
    });
  };

  const handleRename = () => {
    if (!editingId || !editingName.trim()) return;
    onScenariosChange(plans.map(s => (s.id === editingId ? { ...s, name: editingName.trim() } : s)));
    setEditingId(null);
    setEditingName('');
  };

  const handleDelete = (id: string) => {
    if (plans.length <= 1) return;
    const updated = plans.filter(s => s.id !== id);
    onScenariosChange(updated);
    if (id === activePlanId) onSelectScenario(updated[0].id);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-lg font-bold text-slate-900">Manage Plans</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Click a plan to load it. Duplicate to branch a what-if; rename or delete below.
            Each save keeps a revision (last {MAX_REVISIONS} per plan) you can roll back to.
          </p>
        </div>
        <button
          onClick={handleCreateNew}
          className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 rounded text-xs text-white flex items-center gap-1.5"
        >
          <Plus size={12} /> New Plan
        </button>
      </div>

      <div className="space-y-2">
        {plans.map(plan => {
          const isActive = plan.id === activePlanId;
          const isEditing = editingId === plan.id;
          return (
            <div
              key={plan.id}
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
                    <button onClick={() => onSelectScenario(plan.id)} className="flex-1 text-left min-w-0">
                      <div className="text-sm font-medium text-slate-900 truncate">{plan.name}</div>
                      <div className="text-[11px] text-slate-500">
                        {isActive ? 'Active — currently loaded' : 'Click to load'}
                      </div>
                    </button>
                    <div className="flex items-center gap-1 shrink-0">
                      {isActive && <Check size={15} className="text-blue-600 mr-1" />}
                      <button
                        onClick={() => setHistoryFor(historyFor === plan.id ? null : plan.id)}
                        className={`p-1.5 rounded ${historyFor === plan.id ? 'bg-blue-50' : 'hover:bg-slate-100'}`}
                        title="Revision history"
                      >
                        <History size={14} className="text-slate-500" />
                      </button>
                      <button
                        onClick={() => handleDuplicate(plan.id)}
                        className="p-1.5 hover:bg-slate-100 rounded"
                        title="Duplicate"
                      >
                        <Copy size={14} className="text-slate-500" />
                      </button>
                      <button
                        onClick={() => setEditingId(plan.id)}
                        className="p-1.5 hover:bg-slate-100 rounded"
                        title="Rename"
                      >
                        <Edit3 size={14} className="text-slate-500" />
                      </button>
                      <button
                        onClick={() => handleDelete(plan.id)}
                        disabled={plans.length <= 1}
                        className="p-1.5 hover:bg-slate-100 rounded disabled:opacity-30"
                        title={plans.length <= 1 ? 'Keep at least one plan' : 'Delete'}
                      >
                        <Trash2 size={14} className="text-slate-500" />
                      </button>
                    </div>
                  </>
                )}
              </div>

              {/* Revision history for this plan, newest first. Only the
                  active plan can roll back (the parent applies to it). */}
              {historyFor === plan.id && (
                <RevisionList
                  planId={plan.id}
                  revisions={revisions}
                  currentInputs={plan.inputs}
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

/** One plan's revisions, newest first. Each row diffs against the
 *  NEXT-NEWER revision (or the current plan for the newest) — i.e. what
 *  changed to get here — and rolling back to a row DELETES every revision
 *  newer than it (history rewinds, doesn't branch). */
function RevisionList({ planId, revisions, currentInputs, canRollback, onRollback }: {
  planId: string;
  revisions: PlanRevision[];
  /** This plan's inputs as saved right now (the newest row's baseline). */
  currentInputs: RetirementInputs;
  canRollback: boolean;
  onRollback: (revisionId: string) => void;
}) {
  const mine = useMemo(
    () => revisions
      .filter(r => r.planId === planId)
      .sort((a, b) => (b.at - a.at) || (b.id < a.id ? -1 : 1)), // newest first
    [revisions, planId],
  );

  if (mine.length === 0) {
    return (
      <div className="mt-2 pt-2 border-t border-slate-100 text-[11px] text-slate-500">
        No revisions yet. Every save of this plan keeps one here (last {MAX_REVISIONS}).
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
  rev: PlanRevision;
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
