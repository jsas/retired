// web-llm provider: runs an open-weight model IN THE BROWSER via WebGPU.
//
// This is the only fully private / offline provider — after a one-time
// multi-GB weight download (cached by the browser), inference happens entirely
// on the user's GPU with zero network calls and no API key.
//
// @mlc-ai/web-llm is imported LAZILY so its wasm/worker payload never touches
// the main bundle unless the user actually picks the local provider.
//
// CHAT-ONLY BY DESIGN: web-llm's tool/function calling is marked WIP upstream
// and small math models mangle tool JSON, so this provider is wired for
// streaming chat only (the agent loop supplies tools only for providers that
// support them). The plan digest goes into the conversation via the system
// prompt instead — the model still answers from real numbers.

import type { AiConnection } from '../aiSettings';
import { ProviderError, type ChatMessage, type StreamEvent, type StreamChatRequest } from './providers';

/** Engine handle; one per loaded model, reused across chats. */
interface MlcEngine {
  chat: {
    completions: {
      create(req: Record<string, unknown>): Promise<AsyncIterable<unknown>>;
    };
  };
  /** Halts the in-flight generation; used when the user presses Stop, since
   *  the engine's own stream doesn't observe our AbortSignal. */
  interruptGenerate?(): Promise<void>;
  unload?(): Promise<void>;
}

let enginePromise: Promise<MlcEngine> | null = null;
let engineModel: string | null = null;

export interface LoadProgress {
  /** 0–1 fraction of the weight download/load. */
  progress: number;
  text: string;
}

/**
 * Load (or reuse) the engine for `modelId`. The first load for a model
 * downloads and compiles the weights; subsequent chats reuse the same engine.
 * Progress is reported through `onProgress`.
 */
export async function loadWebLlmEngine(
  modelId: string,
  onProgress?: (p: LoadProgress) => void,
  signal?: AbortSignal,
): Promise<MlcEngine> {
  if (enginePromise && engineModel === modelId) return enginePromise;
  // A different model was requested: drop the old engine (VRAM is scarce).
  if (enginePromise) await unloadWebLlmEngine();

  engineModel = modelId;
  enginePromise = (async () => {
    // The load belongs to the MODEL, not to whichever turn happened to start
    // it. It is NOT cancelled by that turn's abort signal: if the user stops a
    // chat (or the agent loop's per-request signal fires) mid-load, we still
    // finish and keep the engine, so the NEXT turn reuses it instead of
    // re-downloading from zero. Dropping the promise on that turn's abort was
    // the regenerate-after-stop bug — every retry recompiled from scratch and
    // looked like a hang at "Preparing the local model… 0%". Only the signal
    // passed here (an explicit "cancel the download" from Connections) abandons
    // a load, and nothing currently passes one.
    const webllm = await import('@mlc-ai/web-llm');
    const engine = await webllm.CreateMLCEngine(modelId, {
      initProgressCallback: (report: { progress?: number; text?: string }) => {
        if (!signal?.aborted) onProgress?.({ progress: report.progress ?? 0, text: report.text ?? '' });
      },
    });
    return engine as unknown as MlcEngine;
  })();

  // If the load fails (or is cancelled), clear the cached promise so the next
  // attempt retries instead of reusing a rejected engine.
  enginePromise.catch(() => { enginePromise = null; engineModel = null; });
  return enginePromise;
}

/** Release the loaded engine and its VRAM. */
export async function unloadWebLlmEngine(): Promise<void> {
  if (!enginePromise) return;
  const p = enginePromise;
  enginePromise = null;
  engineModel = null;
  try {
    const engine = await p;
    await engine.unload?.();
  } catch {
    // Engine never finished loading or already gone — nothing to release.
  }
}

/** The model currently loaded (null when none). */
export function loadedWebLlmModel(): string | null {
  return engineModel;
}

/** True when the model's weights are cached on this device. Best-effort:
 *  resolves false when the cache can't be queried. */
export async function isWebLlmModelCached(modelId: string): Promise<boolean> {
  try {
    const webllm = await import('@mlc-ai/web-llm');
    return await webllm.hasModelInCache(modelId);
  } catch {
    return false;
  }
}

/** Delete a model's downloaded weights + metadata from this device. If the
 *  model is the one currently loaded, unload it first (VRAM), then purge the
 *  cache so the disk space is reclaimed. */
export async function deleteWebLlmModel(modelId: string): Promise<void> {
  if (engineModel === modelId) await unloadWebLlmEngine();
  const webllm = await import('@mlc-ai/web-llm');
  await webllm.deleteModelAllInfoInCache(modelId);
}

/** Streaming <think>…</think> splitter. Reasoning models wrap their chain-of-
 *  thought in these tags; the two kinds of content are returned separately so
 *  the UI can show the thinking collapsibly and the answer as the prose. A
 *  small carry buffer copes with a tag split across chunk boundaries (e.g.
 *  "<thi" + "nk>"). Exported for tests. */
export function createThinkSplitter(): { push(text: string): { text: string; reasoning: string } } {
  const OPEN = '<think>';
  const CLOSE = '</think>';
  let inThink = false;
  let carry = '';
  return {
    push(text: string): { text: string; reasoning: string } {
      let buf = carry + text;
      carry = '';
      let text0 = '';
      let reasoning0 = '';
      while (buf.length > 0) {
        if (inThink) {
          const end = buf.indexOf(CLOSE);
          if (end === -1) {
            // Still inside the thought; keep only a possible partial close tag.
            reasoning0 += buf.slice(0, buf.length - longestSuffixPrefix(buf, CLOSE));
            carry = buf.slice(buf.length - longestSuffixPrefix(buf, CLOSE));
            return { text: text0, reasoning: reasoning0 };
          }
          reasoning0 += buf.slice(0, end);
          buf = buf.slice(end + CLOSE.length);
          inThink = false;
          continue;
        }
        const start = buf.indexOf(OPEN);
        if (start === -1) {
          // No open tag: emit everything except a possible partial "<think" tail.
          const partial = longestSuffixPrefix(buf, OPEN);
          text0 += buf.slice(0, buf.length - partial);
          carry = buf.slice(buf.length - partial);
          return { text: text0, reasoning: reasoning0 };
        }
        text0 += buf.slice(0, start);
        buf = buf.slice(start + OPEN.length);
        inThink = true;
      }
      return { text: text0, reasoning: reasoning0 };
    },
  };
}

/** Length of the longest suffix of `s` that is also a prefix of `tag` — the
 *  part that might be the start of a split tag and must be held back. */
function longestSuffixPrefix(s: string, tag: string): number {
  const max = Math.min(s.length, tag.length - 1);
  for (let n = max; n > 0; n--) {
    if (s.endsWith(tag.slice(0, n))) return n;
  }
  return 0;
}

/** Degenerate-repetition circuit breaker. Small quantized models at low
 *  temperature can lock onto one sentence and emit it hundreds of times,
 *  burning the whole token budget on garbage. This watches the visible text
 *  and, once the tail is clearly one repeated block, reports the cut point so
 *  the caller can truncate + stop instead of streaming nonsense. Returns the
 *  index to cut at, or -1 while the text looks healthy. Exported for tests. */
export function detectRepetitionCut(text: string): number {
  // Don't judge short replies; only the tail matters (a legit answer can
  // repeat a phrase a couple of times early on).
  const MIN = 200;
  if (text.length < MIN) return -1;
  const tail = text.slice(-1600);
  // Try block sizes from a sentence up to a paragraph; if the tail is the same
  // block repeated ≥3 times, it's a loop.
  for (let size = 40; size <= 600; size++) {
    if (tail.length < size * 3) continue;
    const block = tail.slice(-size);
    let runs = 1;
    let pos = tail.length - size;
    while (pos - size >= 0 && tail.slice(pos - size, pos) === block) {
      runs++;
      pos -= size;
    }
    if (runs >= 3) {
      // Cut just after the FIRST occurrence of the block so the user keeps one
      // clean copy. Find where the repeated run started within the whole text.
      const runStart = text.length - size * runs;
      return runStart + size;
    }
  }
  return -1;
}

/** Degenerate "word salad" detector. The verbatim-block breaker above misses
 *  the failure small models like Phi-4 actually produce: a long run-on that
 *  isn't the SAME block but the same TOKENS recycled in ever-shifting order
 *  ("…seamlessly adapted successfully continuously reviewed regularly…") plus
 *  vocabulary dumping (long strings of barely-repeated capitalized terms).
 *  Healthy prose repeats common words but keeps a rich vocabulary; a loop's
 *  vocabulary collapses. This returns true when the recent window is clearly
 *  degenerate. Exported for tests. */
export function isTokenEcho(text: string): boolean {
  // Need enough words for the ratio to mean anything; short answers pass.
  const WORDS = 220;
  const tokens = text.toLowerCase().split(/[^a-z']+/).filter(w => w.length > 2);
  if (tokens.length < WORDS) return false;
  const window = tokens.slice(-WORDS);
  const unique = new Set(window);
  const ratio = unique.size / window.length;
  // A collapsed-vocabulary loop: few distinct words across a long window.
  if (ratio < 0.30) return true;
  // A synonym/word-dump: the window is dominated by LONG tokens (the model
  // listing jargon), which normal sentences never are.
  const long = window.filter(w => w.length >= 9).length;
  if (long / window.length > 0.55) return true;
  return false;
}

/** Translate engine failures into plain, actionable language. Raw WebGPU
 *  errors ("mapAsync", "device lost") mean nothing to a non-technical user. */
function translateLocalError(err: unknown): ProviderError {
  const msg = err instanceof Error ? err.message : String(err);
  if (/mapAsync|device.?lost|out of memory|was unmapped|GPUBuffer/i.test(msg)) {
    return new ProviderError(
      'The local model crashed while answering — this usually means it ran out of graphics ' +
      'memory (the question plus your plan data was too big for this model on this GPU). ' +
      'Try a shorter question, or switch to a smaller/larger model in Connections. If it keeps ' +
      'happening, a cloud provider (Advanced) is more reliable on this computer.',
    );
  }
  return new ProviderError(`Local model error: ${msg.slice(0, 300)}`);
}

/** Serialize the provider-neutral history into OpenAI-style messages. */
function toMessages(system: string, messages: ChatMessage[]): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [{ role: 'system', content: system }];
  for (const m of messages) {
    if (m.role === 'assistant') {
      out.push({ role: 'assistant', content: m.content });
    } else if (!m.toolResults?.length) {
      out.push({ role: 'user', content: m.content });
    }
    // Tool calls/results are skipped: this provider is chat-only and the
    // agent loop never sends them here.
  }
  return out;
}

/**
 * Stream a chat turn from the in-browser engine. Yields text chunks, then a
 * single done event. Aborts via `req.signal`.
 */
export async function* streamWebLlm(
  conn: AiConnection,
  req: StreamChatRequest,
  onProgress?: (p: LoadProgress) => void,
): AsyncGenerator<StreamEvent> {
  let engine: MlcEngine;
  try {
    // Deliberately do NOT pass req.signal as the load-abort: the engine load
    // must outlive this one request (see loadWebLlmEngine). req.signal still
    // aborts the GENERATION below via interruptGenerate.
    engine = await loadWebLlmEngine(conn.model, onProgress);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/webgpu/i.test(msg)) {
      throw new ProviderError(
        'WebGPU is not available in this browser. Local models need a WebGPU-capable browser ' +
        '(Chrome/Edge 113+, recent Safari/Firefox) and a GPU. Try a cloud provider instead.',
      );
    }
    throw new ProviderError(`Failed to load the local model: ${msg.slice(0, 300)}`);
  }

  let stream: AsyncIterable<unknown>;
  try {
    stream = await engine.chat.completions.create({
      messages: toMessages(req.system, req.messages),
      stream: true,
      max_tokens: req.maxTokens ?? 1024,
      // Bound the context: the plan digest + tool catalog + a long user answer
      // can exceed the KV cache a small model was compiled for, which is the
      // main cause of mid-generation GPU crashes (mapAsync / device lost).
      // Clamp the compile window so an over-large user value can't blow VRAM.
      context_window_size: Math.min(req.contextSize ?? 16384, 32768),
      temperature: 0.3, // math/reasoning models: keep them deterministic-ish
      // A degenerate reply is a REPEATED sentence, not a single token, so
      // penalize whole n-gram repeats (repetition_penalty) rather than per-
      // token frequency — and a streaming circuit-breaker below cuts it off
      // entirely once it's clearly looping.
      repetition_penalty: 1.15,
      presence_penalty: 0.3,
    });
  } catch (err) {
    throw translateLocalError(err);
  }

  let stopped = false;
  const onAbort = () => {
    stopped = true;
    // Actually halt the GPU work — the stream alone doesn't observe the signal.
    void engine.interruptGenerate?.();
  };
  req.signal?.addEventListener('abort', onAbort, { once: true });
  if (req.signal?.aborted) onAbort(); // signal fired before we subscribed
  let finishReason: string | null = null;
  const think = createThinkSplitter();
  let visibleSoFar = ''; // for the repetition circuit breaker
  let reasoningSoFar = ''; // reasoning loops too — and worse, it isn't visible-checked
  let loopedOut = false; // set when the breaker cuts a degenerate repeat
  try {
    for await (const chunk of stream) {
      if (stopped) break;
      const delta = (chunk as {
        choices?: Array<{ delta?: { content?: string | null }; finish_reason?: string | null }>;
      }).choices?.[0];
      const raw = delta?.delta?.content;
      if (raw) {
        // Reasoning models (Qwen3 "thinking", DeepSeek-R1) emit their chain of
        // thought inside <think>…</think>; split it out so the chat shows the
        // thinking collapsibly and the answer as the prose. Handles the tag
        // arriving split across chunks.
        const { text: visible, reasoning } = think.push(raw);
        if (reasoning) {
          reasoningSoFar += reasoning;
          // A reasoning model can loop INSIDE the thought and never produce an
          // answer at all. Same breakers as the visible text; on a hit we stop
          // (the partial thought stays visible, marked as cut short).
          if (detectRepetitionCut(reasoningSoFar) !== -1 || isTokenEcho(reasoningSoFar)) {
            loopedOut = true;
            void engine.interruptGenerate?.();
            break;
          }
          yield { type: 'reasoning', text: reasoning };
        }
        if (visible) {
          visibleSoFar += visible;
          // Circuit breaker: a small model locked into a repeat loop would
          // otherwise burn the whole token budget on garbage. Cut at the end
          // of the first clean copy and stop. The token-echo check catches the
          // synonym word-salad the verbatim-block check can't (Phi-4's failure
          // mode) — there we drop the degenerate tail rather than yield it.
          const cut = detectRepetitionCut(visibleSoFar);
          if (cut !== -1) {
            const keep = visibleSoFar.slice(0, cut);
            const alreadySent = visibleSoFar.length - visible.length;
            if (keep.length > alreadySent) yield { type: 'text', text: keep.slice(alreadySent) };
            loopedOut = true;
            void engine.interruptGenerate?.();
            break;
          }
          if (isTokenEcho(visibleSoFar)) {
            loopedOut = true;
            void engine.interruptGenerate?.();
            break;
          }
          yield { type: 'text', text: visible };
        }
      }
      if (delta?.finish_reason) finishReason = delta.finish_reason;
    }
  } catch (err) {
    // The engine can die mid-stream (GPU device lost, context overflow) —
    // translate to something a person can act on instead of a raw WebGPU dump.
    throw translateLocalError(err);
  } finally {
    req.signal?.removeEventListener('abort', onAbort);
  }
  // 'length' means the model hit the token cap mid-thought — the agent loop
  // surfaces that so the UI can say the answer was cut short. An abort that
  // landed after the last chunk still counts as aborted. A repetition cut is
  // reported as truncation so the UI says the answer was cut short.
  const wasAborted = stopped || req.signal?.aborted === true;
  const stopReason: 'end_turn' | 'max_tokens' | 'aborted' =
    wasAborted ? 'aborted' : (loopedOut || finishReason === 'length') ? 'max_tokens' : 'end_turn';
  yield { type: 'done', stopReason };
}
