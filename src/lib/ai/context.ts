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

/** Estimate the token count of a system prompt + chat history. */
export function estimateTokens(system: string, messages: ChatMessage[]): number {
  let chars = system.length;
  for (const m of messages) {
    chars += m.content.length;
    for (const c of m.toolCalls ?? []) chars += c.name.length + JSON.stringify(c.args).length;
    for (const r of m.toolResults ?? []) chars += r.content.length;
    chars += 8; // per-message role/framing overhead
  }
  return Math.ceil(chars / CHARS_PER_TOKEN);
}

/** The context window a connection gets when the user hasn't set one. Local
 *  models are compiled for a small KV cache (web-llm is created with
 *  context_window_size 8192); cloud endpoints default to a large window the
 *  user can narrow in Connections if their model is smaller. */
export function defaultContextSize(provider: string): number {
  return provider === 'webllm' ? 8192 : 128000;
}

export interface CompactionPlan {
  /** True when older turns were folded away and a digest must be carried. */
  compacted: boolean;
  /** The provider-facing history to send instead of the full one. When
   *  compacted, the first message carries the running digest note. */
  messages: ChatMessage[];
  /**
   * The transcript the caller should condense into the running digest (the
   * prior digest plus the turns being dropped). Empty when nothing was
   * compacted. The caller feeds this to the model and stores the result as
   * the thread's `contextSummary`; this module never invents a digest itself
   * because a verbatim copy of the dropped turns wouldn't save any space.
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

/**
 * Decide how to fit `messages` into `contextSize`. Under the trigger the
 * history passes through unchanged. Over it, the oldest turns are dropped from
 * the provider-facing history and replaced by the running digest note; the
 * dropped turns are returned in `excerptToDigest` for the caller to condense
 * into the digest it persists on the thread.
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
  /** How many trailing messages to keep verbatim (default 6). */
  keepRecent?: number;
}): CompactionPlan {
  const { system, messages, contextSize, priorSummary = '', keepRecent = 6 } = opts;
  const used = estimateTokens(system, messages);
  if (used <= contextSize * COMPACT_AT) {
    return { compacted: false, messages, excerptToDigest: '' };
  }

  // Drop oldest messages until the remainder + the digest note fits. Always
  // keep at least the trailing `keepRecent` messages verbatim.
  let drop = 0;
  const maxDrop = Math.max(0, messages.length - keepRecent);
  while (drop < maxDrop) {
    const rest = messages.slice(drop + 1);
    const projected = estimateTokens(system, [
      { role: 'user', content: summaryNote(priorSummary) },
      ...rest,
    ]);
    if (projected <= contextSize * COMPACT_AT) break;
    drop += 1;
  }
  const dropped = messages.slice(0, drop);
  const kept = messages.slice(drop);

  const excerptToDigest = [
    priorSummary.trim() ? `Prior digest:\n${priorSummary.trim()}` : '',
    'Fold these older messages into the digest:',
    ...dropped.map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`),
  ].filter(Boolean).join('\n');

  return {
    compacted: dropped.length > 0,
    messages: [{ role: 'user', content: summaryNote(priorSummary) }, ...kept],
    excerptToDigest: dropped.length > 0 ? excerptToDigest : '',
  };
}
