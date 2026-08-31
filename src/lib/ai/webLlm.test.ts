import { describe, it, expect, vi } from 'vitest';
import { prebuiltAppConfig } from '@mlc-ai/web-llm';
import { WEBLLM_MODELS, fmtVram, webGpuAvailable } from './webLlmModels';
import { connectionReady, defaultModelFor, type AiConnection } from '../aiSettings';
import { buildPlanDigest } from '../agentQA';
import { calculateHousehold } from '@retired/engine-core/retirementEngine';
import { baseInputs, testConfig } from '@retired/engine-core/test/helpers';
import type { StreamEvent } from './providers';

// Fake the @mlc-ai/web-llm module: the real engine needs WebGPU and downloads
// multi-GB weights, so tests drive a scripted engine instead. The mock engine
// is reset per test by clearing the provider's cached engine.
let scriptedChunks: Array<Record<string, unknown>> = [];
let interruptCalls = 0;
let resetChatCalls = 0;
let crashAfter: string | null = null; // when set, the stream throws after one chunk
let crashWith: string | null = null; // the error message to throw (defaults to a mapAsync dump)
const cachedModels = new Set<string>(); // models the fake cache reports as present
let deletedModels: string[] = [];
let lastRequest: Record<string, unknown> | null = null; // the completion request, captured
let loadAttempts: Array<{ contextWindow: number | undefined }> = []; // CreateMLCEngine calls
let oomFirstLoads = 0; // how many initial loads should throw OOM before succeeding

vi.mock('@mlc-ai/web-llm', async (importOriginal) => {
  // Keep the real prebuilt catalog (so the curated-list test validates against
  // genuine ids) but fake the engine + cache.
  const actual = await importOriginal<typeof import('@mlc-ai/web-llm')>();
  return {
    ...actual,
    CreateMLCEngine: async (_modelId: string, _init?: unknown, chatOpts?: { context_window_size?: number }) => {
      loadAttempts.push({ contextWindow: chatOpts?.context_window_size });
      if (oomFirstLoads > 0) {
        oomFirstLoads--;
        throw new Error('WebGPU device was lost while loading the model (OOM)');
      }
      return {
      chat: {
        completions: {
          create: async (req: Record<string, unknown>) => {
            lastRequest = req;
            return (async function* () {
              if (crashAfter) {
                yield { choices: [{ delta: { content: crashAfter } }] };
                throw new Error(crashWith ?? "Failed to execute 'mapAsync' on 'GPUBuffer': Buffer was unmapped before mapping was resolved.");
              }
              yield* scriptedChunks;
            })();
          },
        },
      },
      interruptGenerate: async () => { interruptCalls++; },
      resetChat: async () => { resetChatCalls++; },
      unload: async () => {},
      };
    },
    hasModelInCache: async (id: string) => cachedModels.has(id),
    deleteModelAllInfoInCache: async (id: string) => { deletedModels.push(id); cachedModels.delete(id); },
  };
});

describe('curated web-llm model list', () => {
  it('ships only valid MLC prebuilt ids with VRAM labels', () => {
    expect(WEBLLM_MODELS.length).toBeGreaterThanOrEqual(5);
    for (const m of WEBLLM_MODELS) {
      expect(m.id).toMatch(/-MLC$/);
      expect(m.vramMB).toBeGreaterThan(0);
      expect(m.label.length).toBeGreaterThan(3);
      expect(m.blurb.length).toBeGreaterThan(10);
    }
  });

  it('contains only ids that exist in web-llm\'s prebuilt catalog (else they won\'t load)', () => {
    // A stale or hand-typed id fails at download time with a confusing error —
    // verify every curated id is actually a known prebuild.
    const prebuilt = new Set(
      (prebuiltAppConfig.model_list as Array<{ model_id: string }>).map(m => m.model_id),
    );
    for (const m of WEBLLM_MODELS) {
      expect(prebuilt.has(m.id), `model ${m.id} is not in web-llm's prebuilt catalog`).toBe(true);
    }
  });

  it('formats VRAM for the picker', () => {
    expect(fmtVram(1630)).toBe('1.6 GB VRAM');
    expect(fmtVram(5107)).toBe('5.0 GB VRAM');
    expect(fmtVram(512)).toBe('512 MB VRAM');
  });

  it('curates only tool-capable models — every listed model can drive the plan', () => {
    // The tool-capability contract after #118: the probe sweep showed the two
    // weak/low-value models (Gemma 2 2B, DeepSeek R1 7B) weren't earning their
    // download, so the catalog is now all-tool-capable. A user who still wants
    // a tiny Q&A-only model reaches it via the free-text field (assumed
    // capable); the tools-off tier in AgentPage stays for that path.
    const weak = WEBLLM_MODELS.filter(m => !m.toolCapable);
    expect(weak).toEqual([]);
    // And the smallest download is still modest, so "start small" is real.
    const minSize = Math.min(...WEBLLM_MODELS.map(m => m.sizeGB));
    expect(minSize).toBeLessThanOrEqual(2.5);
  });

  it('webGpuAvailable reports a boolean without throwing', () => {
    expect(typeof webGpuAvailable()).toBe('boolean');
  });
});

describe('webllm as a provider in settings', () => {
  const local: AiConnection = {
    id: 'c', provider: 'webllm', label: 'local', apiKey: '',
    model: 'Qwen3.5-4B-q4f16_1-MLC',
  };

  it('needs no key or base URL — just a model id', () => {
    expect(connectionReady(local)).toBe(true);
    expect(connectionReady({ ...local, model: '' })).toBe(false);
  });

  it('has a curated default model', () => {
    const def = defaultModelFor('webllm');
    expect(WEBLLM_MODELS.some(m => m.id === def)).toBe(true);
  });
});

describe('buildPlanDigest (chat-only provider context)', () => {
  it('embeds the plan inputs and computed verdict without a question', () => {
    const inputs = baseInputs();
    const results = calculateHousehold(inputs, testConfig());
    const digest = buildPlanDigest(inputs, { results });
    expect(digest).toContain('PLAN INPUTS (JSON):');
    expect(digest).toContain('COMPUTED PROJECTION (summary):');
    expect(digest).toContain('withdrawal rate');
    expect(digest).not.toContain('QUESTION:');
    // The digest must carry the actual numbers, not placeholders.
    expect(digest).toContain('"tfsaBalance": 500000');
  });
});

describe('streamWebLlm', () => {
  const conn: AiConnection = {
    id: 'c', provider: 'webllm', label: 'local', apiKey: '',
    model: 'Qwen3.5-4B-q4f16_1-MLC',
  };

  const collect = async (signal?: AbortSignal): Promise<StreamEvent[]> => {
    const { streamWebLlm, unloadWebLlmEngine } = await import('./webLlmProvider');
    await unloadWebLlmEngine(); // reset the cached engine so the mock reloads
    const events: StreamEvent[] = [];
    for await (const e of streamWebLlm(conn, {
      system: 'sys', messages: [{ role: 'user', content: 'hi' }], tools: [], signal,
    })) events.push(e);
    return events;
  };

  it('streams text chunks and reports end_turn on a clean finish', async () => {
    scriptedChunks = [
      { choices: [{ delta: { content: 'Your plan ' } }] },
      { choices: [{ delta: { content: 'lasts.' }, finish_reason: 'stop' }] },
    ];
    const events = await collect();
    expect(events).toEqual([
      { type: 'text', text: 'Your plan ' },
      { type: 'text', text: 'lasts.' },
      { type: 'done', stopReason: 'end_turn' },
    ]);
  });

  it('maps finish_reason length to max_tokens so the UI can flag truncation', async () => {
    scriptedChunks = [
      { choices: [{ delta: { content: 'half an answer…' }, finish_reason: 'length' }] },
    ];
    const events = await collect();
    expect(events.at(-1)).toEqual({ type: 'done', stopReason: 'max_tokens' });
  });

  it('defaults to a generous token budget so a reasoning model can think AND answer', async () => {
    // Regression: a 1024 cap let a reasoning model spend its whole budget on
    // chain-of-thought and stop with finish_reason 'length' before writing any
    // visible answer (the "thought, then quit; continue cut off" bug).
    scriptedChunks = [{ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] }];
    await collect();
    expect(lastRequest?.max_tokens).toBeGreaterThanOrEqual(4096);
  });

  it('reports progress only while loading — a reused engine stays silent', async () => {
    // Regression for "Preparing the local model… 0% stuck on every chat": the
    // page keys the progress bar off this callback, so on an engine-reuse turn
    // it must NOT fire at all — otherwise the bar appears with nothing to
    // clear it until the whole reply finishes.
    const { streamWebLlm, unloadWebLlmEngine, loadedWebLlmModel } = await import('./webLlmProvider');
    await unloadWebLlmEngine();
    scriptedChunks = [{ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] }];
    const progress: Array<{ progress: number }> = [];
    const req = () => ({ system: 'sys', messages: [{ role: 'user' as const, content: 'hi' }], tools: [] });
    // First turn: a cold engine loads, progress flows, and the model reports resident.
    for await (const _ of streamWebLlm(conn, req(), p => progress.push(p))) void _;
    expect(progress.length).toBeGreaterThan(0);
    expect(loadedWebLlmModel()).toBe(conn.model);
    // Second turn: the engine is reused — no load, no progress events.
    progress.length = 0;
    for await (const _ of streamWebLlm(conn, req(), p => progress.push(p))) void _;
    expect(progress).toEqual([]);
  });

  it('respects an explicit maxTokens cap', async () => {
    const { streamWebLlm, unloadWebLlmEngine } = await import('./webLlmProvider');
    await unloadWebLlmEngine();
    scriptedChunks = [{ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] }];
    for await (const _ of streamWebLlm(conn, {
      system: 'sys', messages: [{ role: 'user', content: 'hi' }], tools: [], maxTokens: 512,
    })) void _;
    expect(lastRequest?.max_tokens).toBe(512);
  });

  it('uses the connection generation block when set (and the local defaults otherwise)', async () => {
    const { streamWebLlm, unloadWebLlmEngine } = await import('./webLlmProvider');

    // No generation block → the deterministic-ish local defaults apply.
    await unloadWebLlmEngine();
    scriptedChunks = [{ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] }];
    for await (const _ of streamWebLlm(conn, {
      system: 'sys', messages: [{ role: 'user', content: 'hi' }], tools: [],
    })) void _;
    expect(lastRequest?.temperature).toBe(0.3);
    expect(lastRequest?.repetition_penalty).toBe(1.15);
    expect(lastRequest?.presence_penalty).toBe(0.3);
    expect(lastRequest?.max_tokens).toBeGreaterThanOrEqual(4096);

    // A tuned connection overrides each of them.
    await unloadWebLlmEngine();
    const tuned: AiConnection = {
      ...conn,
      generation: { maxTokens: 8192, temperature: 0.9, repetitionPenalty: 1.4, presencePenalty: 0.1 },
    };
    for await (const _ of streamWebLlm(tuned, {
      system: 'sys', messages: [{ role: 'user', content: 'hi' }], tools: [],
    })) void _;
    expect(lastRequest?.max_tokens).toBe(8192);
    expect(lastRequest?.temperature).toBe(0.9);
    expect(lastRequest?.repetition_penalty).toBe(1.4);
    expect(lastRequest?.presence_penalty).toBe(0.1);
  });

  it('aborting interrupts the engine and reports aborted', async () => {
    interruptCalls = 0;
    const controller = new AbortController();
    scriptedChunks = [{ choices: [{ delta: { content: 'x' } }] }];
    // Abort before collecting: the stream sees the signal, interrupts the
    // engine, and finishes with 'aborted'.
    controller.abort();
    const events = await collect(controller.signal);
    expect(events.at(-1)).toEqual({ type: 'done', stopReason: 'aborted' });
    expect(interruptCalls).toBeGreaterThan(0);
  });

  it('translates a mid-stream GPU crash (mapAsync) into plain language', async () => {
    const { streamWebLlm, unloadWebLlmEngine } = await import('./webLlmProvider');
    await unloadWebLlmEngine();
    crashAfter = 'partial…'; // engine dies mid-generation like the real mapAsync failure
    await expect(async () => {
      for await (const _ of streamWebLlm(conn, {
        system: 's', messages: [{ role: 'user', content: 'hi' }], tools: [],
      })) { /* drain */ }
    }).rejects.toThrow(/graphics memory/);
    crashAfter = null;
  });

  it('translates a context-window overflow into actionable guidance', async () => {
    const { streamWebLlm, unloadWebLlmEngine } = await import('./webLlmProvider');
    await unloadWebLlmEngine();
    crashAfter = 'partial…';
    crashWith = 'Prompt tokens exceed context window size: number of prompt tokens: 4818; context window size: 4096';
    await expect(async () => {
      for await (const _ of streamWebLlm(conn, {
        system: 's', messages: [{ role: 'user', content: 'hi' }], tools: [],
      })) { /* drain */ }
    }).rejects.toThrow(/too large for this local model's context window/);
    crashAfter = null;
    crashWith = null;
  });

  it('auto mode (no contextSize) loads at the model ceiling and uses it for the request', async () => {
    const { streamWebLlm, unloadWebLlmEngine } = await import('./webLlmProvider');
    await unloadWebLlmEngine();
    loadAttempts = [];
    scriptedChunks = [{ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] }];
    // conn has NO contextSize → auto. Qwen3.5 4B's ceiling is 32768.
    for await (const _ of streamWebLlm(conn, {
      system: 's', messages: [{ role: 'user', content: 'hi' }], tools: [],
    })) void _;
    expect(loadAttempts[0]?.contextWindow).toBe(32768);
    expect(lastRequest?.context_window_size).toBe(32768);
  });

  it('auto mode halves the window and retries when the GPU runs out of memory', async () => {
    const { streamWebLlm, unloadWebLlmEngine } = await import('./webLlmProvider');
    await unloadWebLlmEngine();
    loadAttempts = [];
    oomFirstLoads = 2; // first two loads OOM, the third (quarter window) succeeds
    scriptedChunks = [{ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] }];
    for await (const _ of streamWebLlm(conn, {
      system: 's', messages: [{ role: 'user', content: 'hi' }], tools: [],
    })) void _;
    // 32768 → 16384 (OOM) → 8192 (loads).
    expect(loadAttempts.map(a => a.contextWindow)).toEqual([32768, 16384, 8192]);
    // And the request uses the window that actually loaded.
    expect(lastRequest?.context_window_size).toBe(8192);
    oomFirstLoads = 0;
  });

  it('an explicit contextSize is honoured and clamped to the model ceiling', async () => {
    const { streamWebLlm, unloadWebLlmEngine } = await import('./webLlmProvider');
    await unloadWebLlmEngine();
    loadAttempts = [];
    scriptedChunks = [{ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] }];
    const manual: AiConnection = { ...conn, contextSize: 8192 };
    for await (const _ of streamWebLlm(manual, {
      system: 's', messages: [{ role: 'user', content: 'hi' }], tools: [],
    })) void _;
    expect(loadAttempts[0]?.contextWindow).toBe(8192);
    expect(lastRequest?.context_window_size).toBe(8192);
  });

  it('splits <think>…</think> reasoning out of the visible stream', async () => {
    scriptedChunks = [
      { choices: [{ delta: { content: '<think>Let me consider the balances…' } }] },
      { choices: [{ delta: { content: 'the user is 60.</think>Your plan lasts to 95.' }, finish_reason: 'stop' }] },
    ];
    const events = await collect();
    expect(events).toEqual([
      { type: 'reasoning', text: 'Let me consider the balances…' },
      { type: 'reasoning', text: 'the user is 60.' },
      { type: 'text', text: 'Your plan lasts to 95.' },
      { type: 'done', stopReason: 'end_turn' },
    ]);
  });

  it('splits a think block whose tag is split across chunks', async () => {
    scriptedChunks = [
      { choices: [{ delta: { content: '<thi' } }] },
      { choices: [{ delta: { content: 'nk>hidden</think>visible answer' }, finish_reason: 'stop' }] },
    ];
    const events = await collect();
    expect(events).toEqual([
      { type: 'reasoning', text: 'hidden' },
      { type: 'text', text: 'visible answer' },
      { type: 'done', stopReason: 'end_turn' },
    ]);
  });
});

describe('createThinkSplitter', () => {
  it('passes plain text through as text, no reasoning', async () => {
    const { createThinkSplitter } = await import('./webLlmProvider');
    const s = createThinkSplitter();
    expect(s.push('Hello, ')).toEqual({ text: 'Hello, ', reasoning: '' });
    expect(s.push('world.')).toEqual({ text: 'world.', reasoning: '' });
  });

  it('splits a complete think block from the answer in one push', async () => {
    const { createThinkSplitter } = await import('./webLlmProvider');
    const s = createThinkSplitter();
    expect(s.push('<think>secret</think>answer')).toEqual({ text: 'answer', reasoning: 'secret' });
  });

  it('holds back a partial open tag until the rest arrives', async () => {
    const { createThinkSplitter } = await import('./webLlmProvider');
    const s = createThinkSplitter();
    expect(s.push('before <th')).toEqual({ text: 'before ', reasoning: '' });
    expect(s.push('ink>hidden</think>after')).toEqual({ text: 'after', reasoning: 'hidden' });
  });

  it('streams reasoning while a thought is still open', async () => {
    const { createThinkSplitter } = await import('./webLlmProvider');
    const s = createThinkSplitter();
    expect(s.push('<think>still')).toEqual({ text: '', reasoning: 'still' });
    expect(s.push(' thinking…')).toEqual({ text: '', reasoning: ' thinking…' });
    expect(s.push('done</think>out')).toEqual({ text: 'out', reasoning: 'done' });
  });

  it('handles multiple think blocks in sequence', async () => {
    const { createThinkSplitter } = await import('./webLlmProvider');
    const s = createThinkSplitter();
    expect(s.push('<think>a</think>one<think>b</think>two'))
      .toEqual({ text: 'onetwo', reasoning: 'ab' });
  });

  it('does not swallow text that merely contains an angle bracket', async () => {
    const { createThinkSplitter } = await import('./webLlmProvider');
    const s = createThinkSplitter();
    expect(s.push('a < b and c > d')).toEqual({ text: 'a < b and c > d', reasoning: '' });
  });
});

describe('detectRepetitionCut (degenerate-loop circuit breaker)', () => {
  it('returns -1 for healthy, varied text', async () => {
    const { detectRepetitionCut } = await import('./webLlmProvider');
    const healthy = 'Your plan is funded to age 95. The TFSA lasts longest because ' +
      'withdrawals are tax-free. Consider the RRIF minimums after 71. ' +
      'CPP at 65 is reduced by 0.6% per month before that age. ' +
      'OAS begins at 65 and can be deferred to 70 for a higher amount. ' +
      'The RRIF minimum percentage rises each year from age 71 onward.';
    expect(detectRepetitionCut(healthy)).toBe(-1);
  });

  it('returns -1 for short replies even if repetitive', async () => {
    const { detectRepetitionCut } = await import('./webLlmProvider');
    expect(detectRepetitionCut('yes yes yes yes')).toBe(-1);
  });

  it('detects a sentence repeated many times and cuts after the first copy', async () => {
    const { detectRepetitionCut } = await import('./webLlmProvider');
    const sentence = 'Now let\'s assume that you contribute at age 65 and take away at age 95. ';
    const text = 'Here is the answer. ' + sentence.repeat(10);
    const cut = detectRepetitionCut(text);
    expect(cut).toBeGreaterThan(-1);
    // Keep the intro + exactly one copy of the repeated sentence.
    expect(text.slice(0, cut)).toBe('Here is the answer. ' + sentence);
  });

  it('does not fire on a couple of repeats (below the 3x threshold)', async () => {
    const { detectRepetitionCut } = await import('./webLlmProvider');
    const sentence = 'Bigger models give smarter answers but need a stronger computer. ';
    const text = 'Some intro text here. ' + sentence.repeat(2);
    expect(detectRepetitionCut(text)).toBe(-1);
  });
});

describe('isTokenEcho (word-salad circuit breaker)', () => {
  it('returns false for healthy, varied prose', async () => {
    const { isTokenEcho } = await import('./webLlmProvider');
    const healthy = Array.from({ length: 12 }, (_, i) =>
      `Year ${2026 + i}: the balance grows, tax is owed, and withdrawals cover spending.`,
    ).join(' ');
    expect(isTokenEcho(healthy)).toBe(false);
  });

  it('returns false for short answers', async () => {
    const { isTokenEcho } = await import('./webLlmProvider');
    expect(isTokenEcho('Yes, that works.')).toBe(false);
  });

  it('fires on a collapsed-vocabulary loop (Phi-4 style rambling)', async () => {
    const { isTokenEcho } = await import('./webLlmProvider');
    // The same handful of filler words recycled — the real Phi-4 failure.
    const salad = 'seamlessly continuously consistently successfully optimally effectively proactively ';
    const text = 'Let me compute the contribution. ' + salad.repeat(40);
    expect(isTokenEcho(text)).toBe(true);
  });

  it('fires on a jargon word-dump (long barely-repeated terms)', async () => {
    const { isTokenEcho } = await import('./webLlmProvider');
    const dump = Array.from({ length: 240 }, (_, i) => `transcendentalization${i}`).join(' ');
    expect(isTokenEcho(dump)).toBe(true);
  });

  it('fires on a high-diversity salad hammering one content word (the Phi-4 screenshot failure)', async () => {
    const { isTokenEcho } = await import('./webLlmProvider');
    // Mostly-UNIQUE jargon words (vocabulary stays rich, so the collapsed-
    // vocabulary check passes) but one token hammered dozens of times,
    // interleaved so it isn't one verbatim block — exactly the "…explicitly
    // attributed explicitly scoring explicitly thresholds…" tail in the report.
    const words: string[] = [];
    for (let i = 0; i < 40; i++) {
      words.push('explicitly', `concept${i}`, `metric${i}`, `factor${i}`, `aspect${i}`, `detail${i}`);
    }
    const text = words.join(' ');
    expect(isTokenEcho(text)).toBe(true);
  });

  it('does not fire on a long healthy answer that reuses domain terms', async () => {
    const { isTokenEcho } = await import('./webLlmProvider');
    // A genuinely long, coherent retirement answer with varied sentences:
    // "rrsp"/"withdrawal" appear often (they're the topic) but far under the
    // loop threshold, and the vocabulary stays rich.
    const sentences = [
      'At age 65 your RRSP converts to a RRIF and the minimum withdrawal begins.',
      'Each withdrawal is taxed as ordinary income in the calendar year received.',
      'A larger withdrawal can push part of it into a higher bracket.',
      'The TFSA withdrawal is tax-free and never affects OAS or GIS.',
      'Order matters: spend taxable dollars first, then RRIF, then TFSA last.',
      'CPP taken before 65 is reduced by 0.6 percent per month early.',
      'Deferring OAS to 70 raises it by 0.6 percent per month delayed.',
      'Your plan stays funded to age 95 under the current assumptions.',
      'Inflation runs at 2.1 percent with a 5 percent nominal portfolio return.',
      'The taxable account triggers capital gains only when units are sold.',
      'A surviving spouse inherits the RRIF rollover without immediate tax.',
      'Monte Carlo shows an 87 percent success rate across 1000 trials.',
      'Sequence risk matters most in the first decade of drawdown.',
      'A reverse mortgage can supplement cash flow without selling the home.',
    ];
    // ~220+ words, coherent and varied; each domain term repeats only a few times.
    const text = Array.from({ length: 16 }, (_, i) => sentences[i % sentences.length]).join(' ');
    expect(isTokenEcho(text)).toBe(false);
  });
});

describe('web-llm model cache management', () => {
  const conn: AiConnection = {
    id: 'c', provider: 'webllm', label: 'local', apiKey: '',
    model: 'Qwen3.5-4B-q4f16_1-MLC',
  };

  it('reports whether a model is cached, and false on a cache error', async () => {
    const { isWebLlmModelCached } = await import('./webLlmProvider');
    cachedModels.add('Some-Model-MLC');
    expect(await isWebLlmModelCached('Some-Model-MLC')).toBe(true);
    expect(await isWebLlmModelCached('Not-There-MLC')).toBe(false);
    cachedModels.clear();
  });

  it('deletes a cached model that is not loaded', async () => {
    const { deleteWebLlmModel } = await import('./webLlmProvider');
    cachedModels.add('Other-Model-MLC');
    deletedModels = [];
    await deleteWebLlmModel('Other-Model-MLC');
    expect(deletedModels).toContain('Other-Model-MLC');
    expect(cachedModels.has('Other-Model-MLC')).toBe(false);
  });

  it('resets the engine conversation so a new chat starts from an empty KV cache', async () => {
    // Regression for "new chat still sees the same context window as other
    // chats": the engine keeps one conversation + KV cache across requests and
    // reuses it whenever the next request matches its last conversation, so a
    // fresh thread could silently inherit the previous chat's context. The
    // page calls resetWebLlmChat on new/switch — verify it actually reaches
    // the engine's resetChat (and is a safe no-op before any model loads).
    const { resetWebLlmChat, streamWebLlm, unloadWebLlmEngine } = await import('./webLlmProvider');
    await unloadWebLlmEngine();
    resetChatCalls = 0;
    await resetWebLlmChat(); // no engine loaded: must not throw
    expect(resetChatCalls).toBe(0);
    // Load the engine, then reset — the engine's resetChat runs.
    scriptedChunks = [{ choices: [{ delta: { content: 'hi' }, finish_reason: 'stop' }] }];
    for await (const _ of streamWebLlm(conn, {
      system: 's', messages: [{ role: 'user', content: 'hi' }], tools: [],
    })) { /* drain to load */ }
    await resetWebLlmChat();
    expect(resetChatCalls).toBe(1);
  });

  it('unloads the live engine before deleting its model', async () => {
    const { streamWebLlm, deleteWebLlmModel, loadedWebLlmModel } = await import('./webLlmProvider');
    // Load the engine by streaming once.
    scriptedChunks = [{ choices: [{ delta: { content: 'hi' }, finish_reason: 'stop' }] }];
    for await (const _ of streamWebLlm(conn, {
      system: 's', messages: [{ role: 'user', content: 'hi' }], tools: [],
    })) { /* drain to load */ }
    expect(loadedWebLlmModel()).toBe(conn.model);
    cachedModels.add(conn.model);
    deletedModels = [];
    await deleteWebLlmModel(conn.model);
    expect(loadedWebLlmModel()).toBeNull(); // engine torn down first
    expect(deletedModels).toContain(conn.model);
  });
});
