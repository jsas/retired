// Plan checkpoints for agent-approved changes.
//
// Every time the user APPROVES an assistant-proposed change, the UI captures a
// checkpoint — a deep copy of the plan exactly as it was just before the patch
// landed. The agent can then propose reverting to one (propose_revert), which
// produces a normal confirm card like any other mutation: the model can name a
// checkpoint, but it can neither create one nor apply the rollback itself.
//
// Reverts are DIFF-based: the proposed patch contains only the fields where the
// live plan differs from the checkpoint, so manual sidebar edits made after the
// agent's change are visible on the card and only roll back when they conflict
// with what the checkpoint restores.

import type { RetirementInputs } from '../retirementEngine';

export interface PlanCheckpoint {
  id: string;
  /** Card label of the change that was about to land ("Add pension"). */
  label: string;
  /** Capture time (epoch ms). */
  at: number;
  /** Deep copy of the inputs BEFORE the approved patch was applied. */
  inputs: RetirementInputs;
}

/** Ring-buffer cap: the N most recent checkpoints per chat thread. Chats are
 *  local-only and disposable; ten checkpoints (~1–3 KB each) keeps storage
 *  bounded while covering a realistic session of experiments. */
export const CHECKPOINT_LIMIT = 10;

let seq = 0;
/** Capture a checkpoint from the current inputs. `now` injectable for tests. */
export function captureCheckpoint(
  label: string,
  inputs: RetirementInputs,
  now: number = Date.now(),
): PlanCheckpoint {
  return {
    id: `cp-${now.toString(36)}-${(++seq).toString(36)}`,
    label,
    at: now,
    inputs: JSON.parse(JSON.stringify(inputs)) as RetirementInputs,
  };
}

/** Append to the (chronological) list, keeping only the newest LIMIT. */
export function appendCheckpoint(list: PlanCheckpoint[], cp: PlanCheckpoint): PlanCheckpoint[] {
  return [...list, cp].slice(-CHECKPOINT_LIMIT);
}

export interface DiffEntry {
  key: string;
  /** Value at the checkpoint (undefined = field did not exist then). */
  before: unknown;
  /** Value in the live plan (undefined = field does not exist now). */
  after: unknown;
}

/** Stable JSON stringify — object keys sorted so the same shape always
 *  serializes identically regardless of insertion order. Arrays keep their
 *  order (element order is semantic for pensions/events). */
function stableStringify(v: unknown): string {
  return JSON.stringify(v, (_k, val) => {
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      return Object.fromEntries(Object.entries(val).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
    }
    return val;
  });
}

const isAbsent = (o: object, k: string) => !(k in o) || (o as Record<string, unknown>)[k] === undefined;

/** Top-level fields where the two input sets differ. Absent-vs-present counts
 *  as a difference (a spouse or pension added after the checkpoint must roll
 *  back off the plan). */
export function diffInputs(before: RetirementInputs, after: RetirementInputs): DiffEntry[] {
  const b = before as unknown as Record<string, unknown>;
  const a = after as unknown as Record<string, unknown>;
  const keys = new Set([...Object.keys(b), ...Object.keys(a)]);
  const entries: DiffEntry[] = [];
  for (const key of keys) {
    const beforeAbsent = isAbsent(before, key);
    const afterAbsent = isAbsent(after, key);
    if (beforeAbsent && afterAbsent) continue;
    if (!beforeAbsent && !afterAbsent && stableStringify(b[key]) === stableStringify(a[key])) continue;
    entries.push({ key, before: beforeAbsent ? undefined : b[key], after: afterAbsent ? undefined : a[key] });
  }
  return entries;
}

export interface RevertPlan {
  /** Patch containing ONLY the differing fields, valued from the checkpoint.
   *  Fields that did not exist at checkpoint time carry `undefined` — the only
   *  way `{ ...live, ...patch }` can REMOVE a key. */
  patch: Record<string, unknown>;
  /** Human-readable preview: { [field]: { from: liveValue, to: checkpointValue } }. */
  preview: Record<string, { from: unknown; to: unknown }>;
  changed: number;
}

/** Build the revert patch for a checkpoint against the live plan. */
export function buildRevertPlan(live: RetirementInputs, checkpoint: PlanCheckpoint): RevertPlan {
  const entries = diffInputs(checkpoint.inputs, live);
  const patch: Record<string, unknown> = {};
  const preview: Record<string, { from: unknown; to: unknown }> = {};
  for (const e of entries) {
    patch[e.key] = e.before;
    preview[e.key] = { from: e.after, to: e.before };
  }
  return { patch, preview, changed: entries.length };
}

// ---------------------------------------------------------------------------
// undefined through persistence
// ---------------------------------------------------------------------------

/** JSON.stringify drops keys whose value is `undefined`, so a persisted revert
 *  patch would silently lose its removals (spouse added after the checkpoint
 *  would survive the revert). Patches are encoded with this sentinel before
 *  storage and decoded back to `undefined` at apply time — only for patches
 *  flagged `revert`, so a plan value that legitimately equals the sentinel can
 *  never be clobbered by the decode. */
export const UNDEFINED_SENTINEL = '__retired:undefined__';

export function encodeRevertPatch(patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) out[k] = v === undefined ? UNDEFINED_SENTINEL : v;
  return out;
}

export function decodeRevertPatch(patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) out[k] = v === UNDEFINED_SENTINEL ? undefined : v;
  return out;
}
