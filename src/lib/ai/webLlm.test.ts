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

vi.mock('@mlc-ai/web-llm', () => ({
  CreateMLCEngine: async () => ({
    chat: {
      completions: {
        create: async () => (async function* () { yield* scriptedChunks; })(),
      },
    },
    interruptGenerate: async () => { interruptCalls++; },
    unload: async () => {},
  }),
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
});
