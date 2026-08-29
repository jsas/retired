// Persistent chat threads for the assistant, stored LOCALLY ONLY (localStorage
// today; the kv table when it lands). A thread is a named conversation tied to
// the scenario it was about, with the full transcript so it can be reopened and
// continued. Chats are disposable — corrupt payloads fall back to an empty list
// rather than breaking the page (unlike scenarios, which are precious).

import { z } from 'zod';
import type { RetirementInputs } from '../retirementEngine';

const STORAGE_KEY = 'retirement_ai_chats';
/** Exported so the backup layer (db.ts / Data page) can carry chats in the
 *  SQLite file under the same key they occupy in localStorage. */
export const AI_CHATS_STORAGE_KEY = STORAGE_KEY;

// ---------------------------------------------------------------------------
// Serializable transcript model
// ---------------------------------------------------------------------------

/** One tool invocation as shown in the transcript. */
const toolActivitySchema = z.object({
  id: z.string(),
  name: z.string(),
  state: z.enum(['running', 'done', 'error']),
  summary: z.string().optional(),
});

/** A proposed (and possibly decided) plan change awaiting/after user review.
 *  `patch` is the partial inputs patch applied on approval (scalar or
 *  structural); `label` is the card title. Older threads stored field/value —
 *  those are tolerated on load but new proposals always carry patch+label. */
const pendingChangeSchema = z.object({
  callId: z.string(),
  patch: z.record(z.string(), z.unknown()).optional(),
  label: z.string().optional(),
  // Legacy single-field shape (pre-patch proposals).
  field: z.string().optional(),
  value: z.unknown().optional(),
  rationale: z.string().optional(),
  preview: z.record(z.string(), z.unknown()),
  // Revert proposals carry encoded undefined-removals (see checkpoints.ts);
  // the flag tells the UI to decode before applying.
  revert: z.boolean().optional(),
  resolved: z.enum(['approved', 'rejected']).optional(),
});

const turnSchema = z.object({
  id: z.string(),
  role: z.enum(['user', 'assistant']),
  text: z.string(),
  /** Chain-of-thought from reasoning models; optional so older chats load. */
  reasoning: z.string().optional(),
  tools: z.array(toolActivitySchema),
  changes: z.array(pendingChangeSchema),
  /** 'needs-decision' = the model proposed a change and the loop is paused
   *  waiting for the user to Accept/Decline it (survives a page reload, where
   *  'streaming' would wrongly suggest it's still working). */
  state: z.enum(['streaming', 'done', 'aborted', 'truncated', 'error', 'needs-decision']).optional(),
});

export type StoredTurn = z.infer<typeof turnSchema>;

const threadSchema = z.object({
  id: z.string(),
  /** Display title (first user message, or user-renamed). */
  title: z.string(),
  /** The scenario this chat was about when it started (informational). */
  scenarioName: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
  turns: z.array(turnSchema),
  /** Extra standing instructions for this chat, appended to the built system
   *  prompt. Optional so older saved chats stay valid. */
  systemNote: z.string().optional(),
  /** Running digest of compacted older turns, written by the model the first
   *  time the conversation outgrows the context window and extended on later
   *  compactions. Optional so older saved chats stay valid. */
  contextSummary: z.string().optional(),
  /** Automatic plan checkpoints (snapshots taken before each approved agent
   *  change), oldest first, for propose_revert. Optional so older saved chats
   *  stay valid. Typed explicitly: a z.record would infer Record<string,
   *  unknown>, which doesn't overlap RetirementInputs. */
  checkpoints: z.array(z.object({
    id: z.string(),
    label: z.string(),
    at: z.number(),
    inputs: z.custom<RetirementInputs>(() => true),
  })).optional(),
});

export type ChatThread = z.infer<typeof threadSchema>;

const storeSchema = z.object({
  threads: z.array(threadSchema),
  /** The thread shown when the assistant page opens. */
  activeThreadId: z.string().nullable(),
});

export interface ChatStore {
  threads: ChatThread[];
  activeThreadId: string | null;
}

// ---------------------------------------------------------------------------
// KV plumbing (mirrors aiSettings)
// ---------------------------------------------------------------------------

interface KV {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

function memoryKV(): KV {
  const m = new Map<string, string>();
  return {
    getItem: k => (m.has(k) ? m.get(k)! : null),
    setItem: (k, v) => { m.set(k, String(v)); },
  };
}

function defaultKV(): KV {
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch {
    // SSR / blocked storage — fall through to memory.
  }
  return memoryKV();
}

function emptyStore(): ChatStore {
  return { threads: [], activeThreadId: null };
}

/** Parse storage into a valid store; corrupt payloads fall back to empty.
 *  A turn persisted mid-stream keeps state 'streaming' forever (the abort/
 *  finalize that would have flipped it died with the page), which makes the
 *  bubble look stuck and the conversation cut off after a reload — so a
 *  loaded 'streaming' turn is normalized to 'done'. A turn genuinely awaiting
 *  a decision ('needs-decision') is preserved untouched. */
export function loadChats(kv: KV = defaultKV()): ChatStore {
  try {
    const raw = kv.getItem(STORAGE_KEY);
    if (!raw) return emptyStore();
    const parsed = storeSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return emptyStore();
    const s = parsed.data;
    if (s.activeThreadId && !s.threads.some(t => t.id === s.activeThreadId)) {
      s.activeThreadId = s.threads[0]?.id ?? null;
    }
    for (const t of s.threads) {
      for (const turn of t.turns) {
        if (turn.state === 'streaming') turn.state = 'done';
      }
    }
    return s;
  } catch {
    return emptyStore();
  }
}

export function saveChats(store: ChatStore, kv: KV = defaultKV()): void {
  try {
    kv.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Storage full / blocked: chats are non-critical; keep working in memory.
  }
}

// ---------------------------------------------------------------------------
// Thread helpers
// ---------------------------------------------------------------------------

let threadSeq = 0;
/** Unique-ish id without a uuid dependency: timestamp + counter + random. */
export function newThreadId(): string {
  return `chat-${Date.now().toString(36)}-${(++threadSeq).toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

/** Derive a short title from the first user message. */
export function titleFromFirstMessage(text: string): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length <= 48 ? oneLine : oneLine.slice(0, 47) + '…';
}

/** Create a fresh empty thread. `now` is injected for tests. */
export function newThread(scenarioName: string, now: number): ChatThread {
  return {
    id: newThreadId(),
    title: 'New chat',
    scenarioName,
    createdAt: now,
    updatedAt: now,
    turns: [],
  };
}
