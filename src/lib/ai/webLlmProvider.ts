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
): Promise<MlcEngine> {
  if (enginePromise && engineModel === modelId) return enginePromise;
  // A different model was requested: drop the old engine (VRAM is scarce).
  if (enginePromise) await unloadWebLlmEngine();

  engineModel = modelId;
  enginePromise = (async () => {
    const webllm = await import('@mlc-ai/web-llm');
    const engine = await webllm.CreateMLCEngine(modelId, {
      initProgressCallback: (report: { progress?: number; text?: string }) => {
        onProgress?.({ progress: report.progress ?? 0, text: report.text ?? '' });
      },
    });
    return engine as unknown as MlcEngine;
  })();

  // If the load fails, clear the cached promise so the next attempt retries
  // instead of reusing a rejected engine.
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
      max_tokens: req.maxTokens ?? 4096,
      temperature: 0.3, // math/reasoning models: keep them deterministic-ish
      // Small quantized models occasionally get stuck emitting one token
      // ("000000…") at low temperature; a mild penalty breaks the loop.
      repetition_penalty: 1.1,
      frequency_penalty: 0.1,
    });
  } catch (err) {
    throw new ProviderError(`Local model error: ${err instanceof Error ? err.message : String(err)}`);
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
  try {
    for await (const chunk of stream) {
      if (stopped) break;
      const delta = (chunk as {
        choices?: Array<{ delta?: { content?: string | null }; finish_reason?: string | null }>;
      }).choices?.[0];
      const text = delta?.delta?.content;
      if (text) yield { type: 'text', text };
      if (delta?.finish_reason) finishReason = delta.finish_reason;
    }
  } finally {
    req.signal?.removeEventListener('abort', onAbort);
  }
  // 'length' means the model hit the token cap mid-thought — the agent loop
  // surfaces that so the UI can say the answer was cut short. An abort that
  // landed after the last chunk still counts as aborted.
  const wasAborted = stopped || req.signal?.aborted === true;
  const stopReason: 'end_turn' | 'max_tokens' | 'aborted' =
    wasAborted ? 'aborted' : finishReason === 'length' ? 'max_tokens' : 'end_turn';
  yield { type: 'done', stopReason };
}
