// Transformers.js WebGPU provider for 1-bit Bonsai (onnx-community ONNX packs).
//
// Lazy-imports @huggingface/transformers so its wasm/onnx payload never hits the
// main bundle unless the user picks a Bonsai model. Chat-only on the wire —
// tools stay in the agent loop's prompt mode, same as web-llm.
//
// The Hugging Face space webml-community/bonsai-webgpu is this stack:
//   pipeline("text-generation", id, { device: "webgpu", dtype: "q1" })
// The 27B custom-WGSL demo is a one-file app, not an API — we don't wrap it.

import { effectiveGeneration, type AiConnection } from './connections.js';
import {
  BONSAI_GPU_OOM_MESSAGE,
  BONSAI_ORT_HEAP_MESSAGE,
  isGpuOom,
  isOrtSessionAlloc,
  unloadSiblingLocalEngine,
} from './localGpu.js';
import { ProviderError, type ChatMessage, type StreamEvent, type StreamChatRequest } from './providers.js';
import { BONSAI_MODELS } from './bonsaiModels.js';
import { createThinkSplitter, type LoadProgress } from './webLlmProvider.js';

/** Cache API without a DOM lib — same pattern as webLlmProvider.appOrigin. */
interface CacheStorageLike {
  keys(): Promise<string[]>;
  open(name: string): Promise<{
    keys(): Promise<Array<{ url: string }>>;
    delete(req: { url: string }): Promise<boolean>;
  }>;
}

function cacheStorage(): CacheStorageLike | undefined {
  return (globalThis as { caches?: CacheStorageLike }).caches;
}

/** Session options for Bonsai ONNX. 1.7B matches the HF demo (graph opt ON —
 *  that's what actually uses the GPU). 4B+ still blows the 32-bit WASM heap
 *  during compile, so those packs keep graph opt off. */
export function bonsaiSessionOptions(modelId: string): Record<string, unknown> | undefined {
  if (/Bonsai-1\.7B/i.test(modelId)) return undefined;
  return { graphOptimizationLevel: 'disabled' };
}

/**
 * True only when the 1-bit weight sidecar is in cache. Tokenizer / config /
 * the small `model_q1.onnx` graph are fetched first — matching those alone
 * painted "Downloaded" while chat still pulled `model_q1.onnx_data`.
 */
export function bonsaiWeightsCachedIn(urls: string[], modelId: string): boolean {
  const needle = modelId.toLowerCase();
  return urls.some(u => {
    const url = u.toLowerCase();
    return url.includes(needle) && url.includes('model_q1.onnx_data');
  });
}

/** Structural slice of a transformers.js text-generation pipeline. */
interface BonsaiPipeline {
  tokenizer: unknown;
  dispose?: () => Promise<void>;
  (messages: Array<{ role: string; content: string }>, opts: Record<string, unknown>): Promise<unknown>;
}

let enginePromise: Promise<BonsaiPipeline> | null = null;
let engineModel: string | null = null;
let interruptFn: (() => void) | null = null;

export function loadedBonsaiModel(): string | null {
  return engineModel;
}

export async function unloadBonsaiEngine(): Promise<void> {
  interruptFn = null;
  if (!enginePromise) {
    engineModel = null;
    return;
  }
  const p = enginePromise;
  enginePromise = null;
  engineModel = null;
  try {
    const pipe = await p;
    await pipe.dispose?.();
  } catch {
    // Engine never finished loading or already gone — nothing to release.
  }
}

/** Best-effort: Transformers.js stores weights in the Cache API. */
export async function isBonsaiModelCached(modelId: string): Promise<boolean> {
  try {
    const caches = cacheStorage();
    if (!caches) return false;
    const names = await caches.keys();
    const urls: string[] = [];
    for (const name of names) {
      const cache = await caches.open(name);
      for (const r of await cache.keys()) urls.push(r.url);
    }
    return bonsaiWeightsCachedIn(urls, modelId);
  } catch {
    /* private mode / denied */
  }
  return false;
}

export async function deleteBonsaiModel(modelId: string): Promise<void> {
  if (engineModel === modelId) await unloadBonsaiEngine();
  try {
    const caches = cacheStorage();
    if (!caches) return;
    const names = await caches.keys();
    const needle = modelId.toLowerCase();
    for (const name of names) {
      const cache = await caches.open(name);
      const keys = await cache.keys();
      await Promise.all(keys.filter(r => r.url.toLowerCase().includes(needle)).map(r => cache.delete(r)));
    }
  } catch {
    /* ignore */
  }
}

/** No conversation object to drop — the next generate is a fresh messages list. */
export async function resetBonsaiChat(): Promise<void> {
  /* weights stay loaded */
}

export async function loadBonsaiEngine(
  modelId: string,
  onProgress?: (p: LoadProgress) => void,
  _signal?: AbortSignal,
): Promise<BonsaiPipeline> {
  if (!BONSAI_MODELS.some(m => m.id === modelId)) {
    throw new ProviderError(`Unknown Bonsai model "${modelId}". Pick one from the Models list.`);
  }

  if (enginePromise && engineModel === modelId) return enginePromise;
  if (enginePromise) await unloadBonsaiEngine();
  // web-llm and Bonsai cannot share VRAM. A Qwen pack left resident is the usual
  // cause of ONNX session create failing with std::bad_alloc / ERROR_CODE 6.
  await unloadSiblingLocalEngine('bonsai');

  engineModel = modelId;
  enginePromise = (async () => {
    const tf = await import('@huggingface/transformers') as {
      env: { backends: { onnx: { webgpu?: { powerPreference?: string } } } };
      pipeline: (task: string, model: string, opts: Record<string, unknown>) => Promise<BonsaiPipeline>;
    };
    // Dual-GPU laptops: default WebGPU adapter is often the iGPU. Transformers.js
    // already defaults this, but pin it before session create so the 5070 Ti
    // (not the 2% AMD iGPU) is the one that actually runs.
    if (tf.env?.backends?.onnx?.webgpu) {
      tf.env.backends.onnx.webgpu.powerPreference = 'high-performance';
    }
    // 1-bit Bonsai: Transformers.js 4.x `q1`. 3.x rejects it with
    // "Invalid dtype: q1. Should be one of: auto, fp32, … q4f16" — that means
    // the dev server is still serving the old package; restart after npm install.
    let pipe: BonsaiPipeline;
    try {
      const session_options = bonsaiSessionOptions(modelId);
      pipe = await tf.pipeline('text-generation', modelId, {
        device: 'webgpu',
        dtype: 'q1',
        ...(session_options ? { session_options } : {}),
        progress_callback: (info: { progress?: number; status?: string; file?: string }) => {
          const frac = typeof info.progress === 'number'
            ? (info.progress > 1 ? Math.min(1, info.progress / 100) : Math.min(1, Math.max(0, info.progress)))
            : 0;
          const text = info.status === 'ready'
            ? 'Ready.'
            : info.file
              ? `Downloading ${info.file}…`
              : (info.status ?? 'Loading Bonsai…');
          onProgress?.({ progress: frac, text });
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/Invalid dtype:\s*q1/i.test(msg)) {
        throw new ProviderError(
          'Bonsai 1-bit needs Transformers.js 4.x (dtype q1). Restart the dev server after `npm install` so it picks up @huggingface/transformers 4.2+.',
        );
      }
      if (isOrtSessionAlloc(err)) {
        throw new ProviderError(BONSAI_ORT_HEAP_MESSAGE);
      }
      if (isGpuOom(err)) {
        throw new ProviderError(BONSAI_GPU_OOM_MESSAGE);
      }
      throw err;
    }
    // HF's bonsai-webgpu demo runs a 1-token generate after load so the WebGPU
    // shaders compile before the first real turn. Without it, "hi" looks like
    // the GPU is idle while ORT is still compiling.
    onProgress?.({ progress: 1, text: 'Warming up Bonsai on the GPU…' });
    try {
      await pipe([{ role: 'user', content: '.' }], { max_new_tokens: 1, do_sample: false });
    } catch {
      /* warmup is best-effort — a real generate still works */
    }
    onProgress?.({ progress: 1, text: 'Ready.' });
    return pipe;
  })();

  enginePromise.catch(() => { enginePromise = null; engineModel = null; });
  return enginePromise;
}

/** Empty system is omitted — a blank system turn still occupies the template. */
export function toBonsaiMessages(system: string, messages: ChatMessage[]): Array<{ role: string; content: string }> {
  const out: Array<{ role: string; content: string }> = [];
  if (system.trim()) out.push({ role: 'system', content: system });
  for (const m of messages) {
    if (m.role === 'assistant') out.push({ role: 'assistant', content: m.content });
    else if (!m.toolResults?.length) out.push({ role: 'user', content: m.content });
  }
  return out;
}

export async function* streamBonsai(
  conn: AiConnection,
  req: StreamChatRequest,
  onProgress?: (p: LoadProgress) => void,
): AsyncGenerator<StreamEvent> {
  let pipe: BonsaiPipeline;
  try {
    pipe = await loadBonsaiEngine(conn.model, onProgress);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/webgpu/i.test(msg)) {
      throw new ProviderError(
        'WebGPU is not available in this browser. Local Bonsai models need a WebGPU-capable browser ' +
        '(Chrome/Edge 113+, recent Safari/Firefox) and a GPU. Try a cloud provider instead.',
      );
    }
    if (err instanceof ProviderError) throw err;
    if (isOrtSessionAlloc(err)) {
      throw new ProviderError(BONSAI_ORT_HEAP_MESSAGE);
    }
    if (isGpuOom(err)) {
      throw new ProviderError(BONSAI_GPU_OOM_MESSAGE);
    }
    throw new ProviderError(`Failed to load Bonsai: ${msg.slice(0, 300)}`);
  }

  const tf = await import('@huggingface/transformers') as {
    TextStreamer: new (tokenizer: unknown, opts: Record<string, unknown>) => unknown;
    InterruptableStoppingCriteria?: new () => { interrupt(): void; reset(): void };
  };
  const stopper = tf.InterruptableStoppingCriteria ? new tf.InterruptableStoppingCriteria() : null;
  interruptFn = () => stopper?.interrupt();

  let stopped = false;
  const onAbort = () => {
    stopped = true;
    interruptFn?.();
  };
  req.signal?.addEventListener('abort', onAbort, { once: true });
  if (req.signal?.aborted) onAbort();

  type Item = { kind: 'text'; text: string } | { kind: 'end' } | { kind: 'err'; err: unknown };
  const queue: Item[] = [];
  let wake: (() => void) | null = null;
  const push = (item: Item) => {
    queue.push(item);
    wake?.();
    wake = null;
  };

  const genOpts = effectiveGeneration(conn);
  // Official demo is greedy. Sampling pulls logits back to JS every token and
  // leaves the discrete GPU looking idle (~few % 3D in Task Manager). Only
  // sample when the user actually set a temperature on this connection.
  const userTemp = conn.generation?.temperature;
  const doSample = userTemp != null && userTemp > 0.01;
  // Keep <think>…</think> (Qwen3 special tokens). skip_special_tokens: true
  // swallowed the whole thought, so the bubble sat on empty "Thinking…" until
  // (maybe) an answer. Same splitter as web-llm so the collapsible block fills.
  const streamer = new tf.TextStreamer(pipe.tokenizer, {
    skip_prompt: true,
    skip_special_tokens: false,
    callback_function: (text: string) => {
      if (!stopped && text) push({ kind: 'text', text });
    },
  });
  const think = createThinkSplitter();

  const running = pipe(toBonsaiMessages(req.system, req.messages), {
    max_new_tokens: req.maxTokens ?? genOpts.maxTokens,
    do_sample: doSample,
    ...(doSample ? { temperature: userTemp } : {}),
    streamer,
    ...(stopper ? { stopping_criteria: stopper } : {}),
  }).then(() => push({ kind: 'end' }), err => push({ kind: 'err', err }));

  try {
    for (;;) {
      if (queue.length === 0) await new Promise<void>(r => { wake = r; });
      const item = queue.shift()!;
      if (item.kind === 'end') break;
      if (item.kind === 'err') {
        const msg = item.err instanceof Error ? item.err.message : String(item.err);
        throw new ProviderError(`Bonsai error: ${msg.slice(0, 300)}`);
      }
      if (stopped) continue;
      // skip_special_tokens is off so <think> survives; still drop chat
      // control tokens (<|im_end|>, <|endoftext|>, …) that would otherwise leak.
      const raw = item.text.replace(/<\|[^>]+?\|>/g, '');
      if (!raw) continue;
      const { text: visible, reasoning } = think.push(raw);
      if (reasoning) yield { type: 'reasoning', text: reasoning };
      if (visible) yield { type: 'text', text: visible };
    }
    await running;
  } finally {
    interruptFn = null;
    req.signal?.removeEventListener('abort', onAbort);
  }
  yield { type: 'done', stopReason: stopped || req.signal?.aborted ? 'aborted' : 'end_turn' };
}
