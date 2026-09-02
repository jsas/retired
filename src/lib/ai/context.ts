// Context-window bookkeeping for the assistant: how much of the model's
// context the current request would use, and how to shrink an over-long
// conversation so it still fits.
//
// Tokens are ESTIMATED (~4 characters per token) because prompt-mode streams
// and most OpenAI-compatible servers don't return prompt-token counts. The
// estimate is deliberately conservative (it errs high) so the compaction
// trigger fires before the window actually overflows rather than after.

import type { ChatMessage } from './providers';

/** Rough characters-per-token for English prose + JSON. Conservative: real
 *  tokenizers usually do better, so this overestimates usage a little — the
 *  right side to err on when the cost of being wrong is a blown context. */
export const CHARS_PER_TOKEN = 4;

/** Fraction of the context window at which compaction kicks in. Leaves head-
 *  room for the model's reply and the tool round-trips that follow. */
export const COMPACT_AT = 0.8;

/** Fraction of the compaction budget the fold excerpt may use. The excerpt is
 *  read back into the model on the next turn as the digest's source material —
 *  letting it grow without bound would hand the summarizer a prompt bigger
 *  than the original compaction problem. */
const EXCERPT_BUDGET_FRACTION = 0.25;

/** Floor on the excerpt budget so a tiny window still lets the digest see the
 *  immediately dropped turns (the most recent history is the most likely to
 *  carry the user's current intent). */
const EXCERPT_MIN_TOKENS = 500;

export interface ChatMessageChars {
  message: ChatMessage;
  chars: number;
}

/** Rough character count of one ChatMessage as the estimator sees it. */
export function messageChars(m: ChatMessage): number {
  let chars = m.content.length + 8; // role/framing overhead
  for (const c of m.toolCalls ?? []) chars += c.id.length + c.name.length + JSON.stringify(c.args).length;
  for (const r of m.toolResults ?? []) chars += r.toolCallId.length + r.content.length;
  return chars;
}

/** Estimate the token count of a system prompt + chat history. */
export function estimateTokens(system: string, messages: ChatMessage[]): number {
  let chars = system.length;
  for (const m of messages) chars += messageChars(m);
  return Math.ceil(chars / CHARS_PER_TOKEN);
}

/** The context window a connection gets when the user hasn't set one. Local
 *  (web-llm) models are normally on AUTO — the engine loads at the model's own
 *  ceiling and backs off on OOM (see webLlmProvider.loadWebLlmEngine and
 *  AgentPage.effectiveContextLimit), so this 16384 is only the fallback for an
 *  unlisted custom model and the seed for a manual override. 16384 because the
 *  plan digest + tool catalog alone is several thousand tokens — at 8192 the
 *  history was compacted so hard the model lost the thread and rambled. Cloud
 *  endpoints default to a large window the user can narrow in Connections. */
export function defaultContextSize(provider: string): number {
  return provider === 'webllm' ? 16384 : 128000;
}

export interface CompactionPlan {
  /** True when older turns were folded away and a digest must be carried. */
  compacted: boolean;
  /** The provider-facing history to send instead of the full one. When
   *  compacted, the first message carries the running digest note. */
  messages: ChatMessage[];
  /**
   * The transcript the caller should condense into the running digest (the
   * prior digest plus the turns being dropped THIS pass). Empty when nothing
   * was compacted. The caller feeds this to the model and stores the result
   * as the thread's `contextSummary`; this module never invents a digest
   * itself because a verbatim copy of the dropped turns wouldn't save any
   * space.
   */
  excerptToDigest: string;
}

/** Wrap the running digest in the note that stands in for the folded history
 *  at the head of the provider-facing messages. */
export function summaryNote(digest: string): string {
  return [
    '[Earlier in this conversation — the oldest messages were compacted to fit',
    'the context window. What happened, in brief:]',
    digest.trim() || '(no digest yet — the user has only just started.)',
  ].join('\n');
}

/** Segment the flat history into atomic foldable units. An assistant message
 *  with tool calls plus the immediately following user message carrying the
 *  matching results is ONE unit — the fold boundary must never fall between
 *  them (a folded call with no result, or a result with no call, reads as a
 *  dangling ref to both the provider and the digest model). Returns units in
 *  conversation order, each carrying its precomputed size. */
function segmentTurns(messages: ChatMessage[]): ChatMessageChars[][] {
  const units: ChatMessageChars[][] = [];
  let i = 0;
  while (i < messages.length) {
    const m = messages[i];
    const calls = m.toolCalls ?? [];
    const next = messages[i + 1];
    const nextResults = next?.toolResults ?? [];
    // Pair an assistant's tool calls with the next message's matching results.
    // The pairing is positional (toHistory emits them back-to-back), and we
    // verify every call has its result so a partial exchange stays unpaired.
    if (
      m.role === 'assistant' && calls.length > 0 &&
      next?.role === 'user' && nextResults.length > 0 &&
      calls.every(c => nextResults.some(r => r.toolCallId === c.id))
    ) {
      units.push([
        { message: m, chars: messageChars(m) },
        { message: next, chars: messageChars(next) },
      ]);
      i += 2;
      continue;
    }
    units.push([{ message: m, chars: messageChars(m) }]);
    i += 1;
  }
  return units;
}

/** Render one folded message as a readable digest excerpt. Prose goes through
 *  as role-tagged text; tool calls/results become short notes so the digest
 *  model sees what the assistant DID (not the raw JSON wire shape, and not an
 *  empty stub when a turn's entire payload was tool traffic). */
function renderExcerptMessage(m: ChatMessage): string {
  const speaker = m.role === 'user' ? 'User' : 'Assistant';
  const lines: string[] = [];
  if (m.content.trim()) lines.push(`${speaker}: ${m.content}`);
  for (const c of m.toolCalls ?? []) {
    lines.push(`${speaker} called ${c.name}(${JSON.stringify(c.args)})`);
  }
  for (const r of m.toolResults ?? []) {
    const body = r.content.length > 120 ? `${r.content.slice(0, 117)}…` : r.content;
    lines.push(`Tool returned${r.isError ? ' (error)' : ''}: ${body}`);
  }
  return lines.join('\n');
}

/**
 * Decide how to fit `messages` into `contextSize`. Under the trigger the
 * history passes through unchanged. Over it, the oldest turns are dropped from
 * the provider-facing history and replaced by the running digest note; the NEW
 * drops are returned in `excerptToDigest` for the caller to condense into the
 * digest it persists on the thread. Turns dropped in earlier passes are left
 * out — the prior digest already covers them — so the summarizer reads only
 * fresh material each pass instead of re-digesting the whole history.
 *
 * The most recent `keepRecent` messages are always kept verbatim so the model
 * never loses the immediate thread of the conversation.
 */
export function planCompaction(opts: {
  system: string;
  messages: ChatMessage[];
  contextSize: number;
  /** The running digest from a previous compaction (carried on the thread). */
  priorSummary?: string;
  /** How many trailing MESSAGES (not units) to aim to keep verbatim (default 6).
   *  Treated as a soft target: a unit on the boundary is kept whole, and the
   *  window shrinks the kept tail when even that can't fit. */
  keepRecent?: number;
}): CompactionPlan {
  const { system, messages, contextSize, priorSummary = '', keepRecent = 6 } = opts;
  const budgetChars = contextSize * COMPACT_AT * CHARS_PER_TOKEN;
  const note = (): ChatMessage => ({ role: 'user', content: summaryNote(priorSummary) });
  const noteChars = messageChars(note());

  // Fixed overhead: the system prompt plus the digest note that replaces the
  // folded turns. History must fit in what remains.
  const overheadChars = system.length + noteChars;

  // Fast path: under the trigger, pass the history through untouched. Single
  // accumulation, not the prior O(n·k) estimate per shrink iteration.
  let historyChars = 0;
  for (const m of messages) historyChars += messageChars(m);
  if (system.length + historyChars <= budgetChars) {
    return { compacted: false, messages, excerptToDigest: '' };
  }

  // Atomic foldable units. A boundary never falls mid tool-exchange.
  const units = segmentTurns(messages);

  // Pick the kept tail in a single back-to-front pass, accumulating budget as
  // we go. `keepRecent` is the caller's stated preference in MESSAGES; we honor
  // it only cheaply (stop early once we've kept that many) and always let the
  // budget shrink it further when the window can't hold the tail + overhead.
  // The single newest message is never dropped: it's the live edge of the
  // conversation, and the caller's overflow check reports the case where even
  // it won't fit.
  let keptUnits = 0;
  let keptChars = 0;
  let keptMessages = 0;
  for (let u = units.length - 1; u >= 0; u -= 1) {
    const unit = units[u];
    const unitChars = unit.reduce((s, m) => s + m.chars, 0);
    const unitMessages = unit.length;
    // The newest unit (first one visited) is always kept WHOLE — even when it
    // doesn't fit — so the model never loses the live edge and a tool pair on
    // the edge keeps its result. After that, stop the moment adding one more
    // would cross the budget or exceed keepRecent.
    if (
      u < units.length - 1 &&
      (overheadChars + keptChars + unitChars > budgetChars ||
        keptMessages + unitMessages > keepRecent)
    ) {
      break;
    }
    keptUnits += 1;
    keptChars += unitChars;
    keptMessages += unitMessages;
  }

  const droppedUnits = units.slice(0, units.length - keptUnits);
  const kept = units.slice(units.length - keptUnits).flat().map(u => u.message);

  // Build the excerpt from ONLY this pass's newly dropped units. Turns folded
  // in an earlier pass are already inside `priorSummary`; re-listing them
  // would just burn summarizer tokens re-reading what it already condensed.
  // The excerpt is bounded so a runaway history can't hand the summarizer a
  // prompt larger than the compaction problem it was solving. Newest drops
  // go in first (recency beats antiquity for the digest), then older ones
  // backfill until the budget runs out; lines too long for the remaining
  // budget are truncated in place rather than skipped whole.
  const excerptBudgetChars = Math.max(
    EXCERPT_MIN_TOKENS * CHARS_PER_TOKEN,
    Math.floor(budgetChars * EXCERPT_BUDGET_FRACTION),
  );
  const header: string[] = [];
  if (priorSummary.trim()) header.push(`Prior digest:\n${priorSummary.trim()}`);
  header.push('Fold these older messages into the digest:');
  let excerptChars = header.join('\n').length;
  const keyed = droppedUnits.flatMap(unit =>
    unit.map(u => ({ u, line: renderExcerptMessage(u.message) })).filter(k => k.line),
  );
  const picked: string[] = [];
  for (let i = keyed.length - 1; i >= 0; i -= 1) {
    const { line } = keyed[i];
    const remaining = excerptBudgetChars - excerptChars - 1;
    // Skip a line only when NO budget remains; otherwise truncate the line to
    // the remaining space. Truncation beats skipping — a skipped turn never
    // reaches the digest at all.
    if (remaining <= 0) continue;
    const cut = line.length <= remaining ? line : `${line.slice(0, remaining)}…`;
    picked.unshift(cut); // newest first while walking back; unshift restores order
    excerptChars += cut.length + 1;
  }
  const hasDrops = droppedUnits.length > 0;
  const excerptToDigest = hasDrops && picked.length > 0
    ? [...header, ...picked].join('\n')
    : '';

  return {
    compacted: hasDrops,
    messages: hasDrops ? [note(), ...kept] : messages,
    excerptToDigest,
  };
}
