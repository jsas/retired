// Per-scenario revision history: every save of a scenario's inputs snapshots
// the FULL inputs object into a rolling, per-scenario list (newest last).
//
// Why full snapshots instead of patches: plans are small (a few KB of JSON),
// rollback is then a plain restore with no patch-application machinery to get
// wrong, and an old snapshot never breaks when the inputs shape gains a field
// (a patch against a renamed field would). Snapshots deep-copy on the way in —
// callers keep mutating their live object — and are only ever compared, never
// re-edited.
//
// Cap: MAX_REVISIONS per scenario, dropped oldest-first. Nothing else prunes;
// revisions of a deleted scenario are dropped with it (they live inside the
// scenario's own record, not a global pool).
//
// Storage: a SQLite table via the same AppDatabase every other store uses
// (scenarios, config, memories) — one more table in the one .sqlite file that
// backs up with everything else.

import type { RetirementInputs } from './retirementEngine';
import { migrateInputs } from './scenarioStorage';
import type { AppDatabase } from '../data/db';

/** Revisions kept per scenario. Oldest dropped first (rolling window). */
export const MAX_REVISIONS = 100;

/** The minimum shape of a revision row (a Scenario plus its own id column). */
export interface ScenarioRevision {
  /** Revision id — also the row's creation order (monotonic, sortable). */
  id: string;
  scenarioId: string;
  /** ms epoch. */
  at: number;
  /** What wrote this revision ('save' = user Save, 'agent' = agent apply…). */
  source: 'save' | 'agent' | 'import' | 'revert';
  inputs: RetirementInputs;
}

/** Two values are history-equivalent: JSON-equal, or both "empty", or the
 *  spouse-source pair (absent, {kind:'builtin'}) — the scenarioStorage
 *  migrator back-fills `events: []`, `pensions: []` and
 *  `spouseSource: {kind:'builtin'}` onto rows loaded from SQL, so older
 *  snapshots that omit those keys would otherwise read as changed on every
 *  diff (fabricating revisions and "N changes" rows that aren't changes). */
function equivalent(a: unknown, b: unknown): boolean {
  if (JSON.stringify(a) === JSON.stringify(b)) return true;
  if (isEmptyish(a) && isEmptyish(b)) return true;
  return isBuiltinSpouseSource(a) && isBuiltinSpouseSource(b);
}

function isEmptyish(v: unknown): boolean {
  if (v == null) return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'object') return Object.keys(v).length === 0;
  return false;
}

/** absent / undefined AND {kind:'builtin'} are the same: the embedded-spouse
 *  adapter is the default. */
function isBuiltinSpouseSource(v: unknown): boolean {
  if (v == null) return true;
  if (typeof v !== 'object') return false;
  const kind = (v as { kind?: unknown }).kind;
  return kind === 'builtin';
}

/** True when the two plans' inputs differ (used to skip no-op revisions).
 *  Compares key-by-key so shape drift (absent vs empty array) isn't a change. */
export function inputsChanged(a: RetirementInputs, b: RetirementInputs): boolean {
  return diffRevisions(a, b).length > 0;
}

/** Pure: insert (or overwrite, when id already exists) and enforce the cap PER
 *  SCENARIO by dropping that scenario's oldest revision. The cap is per
 *  scenario on purpose: one busy plan must never evict another plan's history.
 *  Returns the new list; never mutates the input. */
export function pushRevision(list: ScenarioRevision[], rev: ScenarioRevision): ScenarioRevision[] {
  const idx = list.findIndex(r => r.id === rev.id);
  const next = idx >= 0
    ? list.map(r => (r.id === rev.id ? rev : r))
    : [...list, rev];
  const mine = next.filter(r => r.scenarioId === rev.scenarioId);
  if (mine.length <= MAX_REVISIONS) return next;
  const drop = new Set(mine.slice(0, mine.length - MAX_REVISIONS).map(r => r.id));
  return next.filter(r => !drop.has(r.id));
}

/**
 * SQLite persistence. One row per revision; the inputs JSON is the same
 * scenario-schema JSON the scenarios table stores (migrated on the way out so
 * older rows gain newer fields).
 */
export class SqliteRevisionStore {
  private db: AppDatabase;

  constructor(db: AppDatabase) {
    this.db = db;
    db.withTransaction(() => {
      db.run(`CREATE TABLE IF NOT EXISTS scenario_revisions (
        id TEXT PRIMARY KEY,
        scenario_id TEXT NOT NULL,
        at INTEGER NOT NULL,
        source TEXT NOT NULL,
        inputs TEXT NOT NULL
      )`);
      db.run(`CREATE INDEX IF NOT EXISTS scenario_revisions_scenario_idx
        ON scenario_revisions (scenario_id, at)`);
    });
  }

  loadAll(): ScenarioRevision[] {
    const res = this.db.exec(`SELECT id, scenario_id, at, source, inputs
      FROM scenario_revisions ORDER BY at, id`);
    if (res.length === 0) return [];
    return res[0].values.map(([id, scenarioId, at, source, inputs]) => ({
      id: id as string,
      scenarioId: scenarioId as string,
      at: at as number,
      source: source as ScenarioRevision['source'],
      // Migrated on the way out so older rows gain newer fields (same policy
      // as the scenarios table).
      inputs: migrateInputs(JSON.parse(inputs as string)),
    }));
  }

  /** Replace the whole revision set (the write path mirrors saveScenarios:
   *  few rows, always written as a set inside one transaction). */
  saveAll(revisions: ScenarioRevision[]): void {
    this.db.run('BEGIN');
    try {
      this.db.run('DELETE FROM scenario_revisions');
      for (const r of revisions) {
        this.db.run(
          `INSERT INTO scenario_revisions (id, scenario_id, at, source, inputs)
           VALUES (?, ?, ?, ?, ?)`,
          [r.id, r.scenarioId, r.at, r.source, JSON.stringify(r.inputs)],
        );
      }
      this.db.run('COMMIT');
    } catch (err) {
      this.db.run('ROLLBACK');
      throw err;
    }
  }

  /** Drop every revision of one scenario (when the scenario is deleted). */
  deleteForScenario(scenarioId: string): void {
    this.db.run('DELETE FROM scenario_revisions WHERE scenario_id = ?', [scenarioId]);
  }
}

// ---------------------------------------------------------------------------
// Pure helpers the UI uses to present the history
// ---------------------------------------------------------------------------

/** One field-level difference between a revision and another plan state. */
export interface RevisionDiff {
  field: string;
  from: unknown;
  to: unknown;
}

/** Flat-field diff of two plans (top-level keys only, structural blocks diff
 *  as whole values — the UI shows them as "changed", which is enough to decide
 *  whether to roll back). Returns [] when the plans are identical. */
export function diffRevisions(from: RetirementInputs, to: RetirementInputs): RevisionDiff[] {
  const diffs: RevisionDiff[] = [];
  const keys = new Set([
    ...Object.keys(from as unknown as Record<string, unknown>),
    ...Object.keys(to as unknown as Record<string, unknown>),
  ]);
  for (const k of keys) {
    const a = (from as unknown as Record<string, unknown>)[k];
    const b = (to as unknown as Record<string, unknown>)[k];
    if (!equivalent(a, b)) {
      diffs.push({ field: k, from: a, to: b });
    }
  }
  return diffs;
}

/** Count the changes between a revision and a target plan, for the list UI. */
export function revisionChangeCount(diffs: RevisionDiff[]): number {
  return diffs.length;
}

/** The revision to roll back TO (id match); also carries what would change. */
export function planRollback(revisions: ScenarioRevision[], revisionId: string, current: RetirementInputs): {
  revision: ScenarioRevision;
  diffs: RevisionDiff[];
} | null {
  const revision = revisions.find(r => r.id === revisionId);
  if (!revision) return null;
  return { revision, diffs: diffRevisions(revision.inputs, current) };
}
