import { describe, it, expect, vi } from 'vitest';
import { WEBLLM_MODELS, fmtVram, webGpuAvailable } from './webLlmModels';
import { connectionReady, defaultModelFor, type AiConnection } from '../aiSettings';
import { buildPlanDigest } from '../agentQA';
import { calculateHousehold } from '../retirementEngine';
import { baseInputs, testConfig } from '../../test/helpers';
import type { StreamEvent } from './providers';

// Fake the @mlc-ai/web-llm module: the real engine needs WebGPU and downloads
// multi-GB weights, so tests drive a scripted engine instead. The mock engine
// is reset per test by clearing the provider's cached engine.
let scriptedChunks: Array<Record<string, unknown>> = [];
let interruptCalls = 0;
let crashAfter: string | null = null; // when set, the stream throws after one chunk
const cachedModels = new Set<string>(); // models the fake cache reports as present
let deletedModels: string[] = [];

vi.mock('@mlc-ai/web-llm', () => ({
  CreateMLCEngine: async () => ({
    chat: {
      completions: {
        create: async () => (async function* () {
          if (crashAfter) {
            yield { choices: [{ delta: { content: crashAfter } }] };
            throw new Error("Failed to execute 'mapAsync' on 'GPUBuffer': Buffer was unmapped before mapping was resolved.");
          }
          yield* scriptedChunks;
        })(),
      },
    },
    interruptGenerate: async () => { interruptCalls++; },
    unload: async () => {},
  }),
  hasModelInCache: async (id: string) => cachedModels.has(id),
  deleteModelAllInfoInCache: async (id: string) => { deletedModels.push(id); cachedModels.delete(id); },
}));

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

  it('is math/reasoning focused (math, R1, thinking, or reasoning in the id/label)', () => {
    for (const m of WEBLLM_MODELS) {
      const s = `${m.id} ${m.label}`.toLowerCase();
      expect(
        s.includes('math') || s.includes('r1') || s.includes('reasoning') || s.includes('thinking') || s.includes('qwen3'),
        `model ${m.id} is not math/reasoning-flavored`,
      ).toBe(true);
    }
  });

  it('formats VRAM for the picker', () => {
    expect(fmtVram(1630)).toBe('1.6 GB VRAM');
    expect(fmtVram(5107)).toBe('5.0 GB VRAM');
    expect(fmtVram(512)).toBe('512 MB VRAM');
  });

  it('webGpuAvailable reports a boolean without throwing', () => {
    expect(typeof webGpuAvailable()).toBe('boolean');
  });
});

describe('webllm as a provider in settings', () => {
  const local: AiConnection = {
    id: 'c', provider: 'webllm', label: 'local', apiKey: '',
    model: 'Qwen2.5-Math-1.5B-Instruct-q4f16_1-MLC',
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
    model: 'Qwen2.5-Math-1.5B-Instruct-q4f16_1-MLC',
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

  it('strips <think>…</think> reasoning from the visible stream', async () => {
    scriptedChunks = [
      { choices: [{ delta: { content: '<think>Let me consider the balances…' } }] },
      { choices: [{ delta: { content: 'the user is 60.</think>Your plan lasts to 95.' }, finish_reason: 'stop' }] },
    ];
    const events = await collect();
    expect(events).toEqual([
      { type: 'text', text: 'Your plan lasts to 95.' },
      { type: 'done', stopReason: 'end_turn' },
    ]);
  });

  it('strips a think block whose tag is split across chunks', async () => {
    scriptedChunks = [
      { choices: [{ delta: { content: '<thi' } }] },
      { choices: [{ delta: { content: 'nk>hidden</think>visible answer' }, finish_reason: 'stop' }] },
    ];
    const events = await collect();
    expect(events).toEqual([
      { type: 'text', text: 'visible answer' },
      { type: 'done', stopReason: 'end_turn' },
    ]);
  });
});

describe('createThinkStripper', () => {
  it('passes plain text through untouched', async () => {
    const { createThinkStripper } = await import('./webLlmProvider');
    const s = createThinkStripper();
    expect(s.push('Hello, ')).toBe('Hello, ');
    expect(s.push('world.')).toBe('world.');
  });

  it('drops a complete think block in one push', async () => {
    const { createThinkStripper } = await import('./webLlmProvider');
    const s = createThinkStripper();
    expect(s.push('<think>secret</think>answer')).toBe('answer');
  });

  it('holds back a partial open tag until the rest arrives', async () => {
    const { createThinkStripper } = await import('./webLlmProvider');
    const s = createThinkStripper();
    expect(s.push('before <th')).toBe('before ');
    expect(s.push('ink>hidden</think>after')).toBe('after');
  });

  it('drops everything while a thought is still open', async () => {
    const { createThinkStripper } = await import('./webLlmProvider');
    const s = createThinkStripper();
    expect(s.push('<think>still')).toBe('');
    expect(s.push(' thinking…')).toBe('');
    expect(s.push('done</think>out')).toBe('out');
  });

  it('handles multiple think blocks in sequence', async () => {
    const { createThinkStripper } = await import('./webLlmProvider');
    const s = createThinkStripper();
    expect(s.push('<think>a</think>one<think>b</think>two')).toBe('onetwo');
  });

  it('does not swallow text that merely contains an angle bracket', async () => {
    const { createThinkStripper } = await import('./webLlmProvider');
    const s = createThinkStripper();
    expect(s.push('a < b and c > d')).toBe('a < b and c > d');
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

describe('web-llm model cache management', () => {
  const conn: AiConnection = {
    id: 'c', provider: 'webllm', label: 'local', apiKey: '',
    model: 'Qwen2.5-Math-1.5B-Instruct-q4f16_1-MLC',
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
