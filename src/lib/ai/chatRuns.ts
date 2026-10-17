// Module-level registry of in-flight assistant runs, keyed by chat thread id.
//
// Run state must NOT live in the component tree: the dock unmounts on every
// page navigation and on every thread switch, and a run that died with its
// component would break mid-reply. Runs live HERE instead — the agent loop
// keeps writing turns into the module-level chat store (chatStore.ts) while
// every component that started it is long gone — and any surface (thread
// sidebar, dock picker, the conversation itself) subscribes to see who is
// thinking.

export type RunPhase =
  /** The model is actively replying (thinking, streaming, running tools). */
  | 'streaming'
  /** The loop is PAUSED on a confirm card, waiting for Accept/Decline. */
  | 'parked';

export interface ChatRun {
  readonly threadId: string;
  readonly phase: RunPhase;
  /** Local-model load/compile progress while one applies (null for cloud). */
  readonly progress: { progress: number; text: string } | null;
  readonly startedAt: number;
}

export type DecisionResolver = (d: { approved: boolean; note?: string }) => void;

interface RunInternals {
  abort: AbortController;
  decisions: Map<string, DecisionResolver>;
}

const runs = new Map<string, ChatRun>();
const internals = new Map<string, RunInternals>();
let version = 0;
const listeners = new Set<() => void>();

function emit(): void {
  version += 1;
  for (const l of listeners) l();
}

/** Subscribe to run changes (for useSyncExternalStore). */
export function subscribeRuns(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** Snapshot version — bumps on every registry change so React re-renders. */
export function getRunsVersion(): number {
  return version;
}

/** The run state for a thread, or null when it isn't running. */
export function getRun(threadId: string): ChatRun | null {
  return runs.get(threadId) ?? null;
}

/** Every live run as a fresh Map (threadId → run) — for surfaces that render
 *  the whole list at once (thread sidebar, dock picker). */
export function runSnapshot(): Map<string, ChatRun> {
  return new Map(runs);
}

/** True while ANY thread runs. The local engine is one shared resource, so
 *  thread switches must not reset its conversation mid-run. */
export function hasActiveRun(): boolean {
  return runs.size > 0;
}

/** Register a run for a thread and return its abort controller. Re-registering
 *  over a live run is a caller bug; the per-thread guard lives in runTurn. */
export function startRun(threadId: string): AbortController {
  const abort = new AbortController();
  runs.set(threadId, { threadId, phase: 'streaming', progress: null, startedAt: Date.now() });
  internals.set(threadId, { abort, decisions: new Map() });
  emit();
  return abort;
}

/** Publish local-model load/compile progress for the run. */
export function setRunProgress(threadId: string, progress: { progress: number; text: string } | null): void {
  const run = runs.get(threadId);
  if (!run) return;
  runs.set(threadId, { ...run, progress });
  emit();
}

export function setRunPhase(threadId: string, phase: RunPhase): void {
  const run = runs.get(threadId);
  if (!run) return;
  runs.set(threadId, { ...run, phase });
  emit();
}

/** The loop parked on a confirm card — register how to resume it. Kept HERE
 *  (not in the component) so the card still works after the Conversation
 *  remounts following a thread switch. */
export function setRunDecision(threadId: string, callId: string, resolve: DecisionResolver): void {
  internals.get(threadId)?.decisions.set(callId, resolve);
}

/** Pop a parked decision's resolver (get + delete in one step). */
export function takeRunDecision(threadId: string, callId: string): DecisionResolver | undefined {
  const map = internals.get(threadId)?.decisions;
  const fn = map?.get(callId);
  map?.delete(callId);
  return fn;
}

/** Abort a thread's run. The run's own finally clears its turn state and the
 *  registry record — an abort only signals. */
export function abortRun(threadId: string): void {
  internals.get(threadId)?.abort.abort();
}

/** Clear the run record. Called from the run's finally path. */
export function endRun(threadId: string): void {
  if (runs.delete(threadId)) emit();
  internals.delete(threadId);
}

/** Test seam: clear everything. */
export function resetRunsForTests(): void {
  runs.clear();
  internals.clear();
  emit();
}
