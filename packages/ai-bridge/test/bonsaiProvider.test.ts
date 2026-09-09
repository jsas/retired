import { describe, expect, it, vi, beforeEach } from 'vitest';

const callbackHold: Array<(t: string) => void> = [];
let pipelineError: Error | null = null;
let disposeCalls = 0;
let scriptedChunks: string[] = ['Hello', ' world'];

vi.mock('@huggingface/transformers', () => ({
  env: { backends: { onnx: { webgpu: { powerPreference: 'default' } } } },
  pipeline: async () => {
    if (pipelineError) throw pipelineError;
    const pipe = async () => {
      const cb = callbackHold[0];
      for (const chunk of scriptedChunks) cb?.(chunk);
    };
    (pipe as { tokenizer: unknown }).tokenizer = {};
    (pipe as { dispose: () => Promise<void> }).dispose = async () => { disposeCalls++; };
    return pipe;
  },
  TextStreamer: class {
    constructor(_tok: unknown, opts: { callback_function: (t: string) => void }) {
      callbackHold.push(opts.callback_function);
    }
  },
  InterruptableStoppingCriteria: class {
    interrupt() {}
    reset() {}
  },
}));

import { BONSAI_MODELS } from '../src/bonsaiModels.js';
import { toBonsaiMessages, streamBonsai, unloadBonsaiEngine, bonsaiWeightsCachedIn, bonsaiSessionOptions } from '../src/bonsaiProvider.js';
import type { AiConnection } from '../src/connections.js';

const conn: AiConnection = {
  id: 'b1',
  provider: 'bonsai',
  label: 'Bonsai',
  apiKey: '',
  model: 'onnx-community/Bonsai-1.7B-ONNX',
};

describe('Bonsai catalog', () => {
  it('ships onnx-community 1-bit packs, not MLC ids', () => {
    expect(BONSAI_MODELS.length).toBeGreaterThanOrEqual(2);
    expect(BONSAI_MODELS.some(m => m.id.includes('8B'))).toBe(false);
    for (const m of BONSAI_MODELS) {
      expect(m.id).toMatch(/^onnx-community\/Bonsai-/);
      expect(m.id).not.toMatch(/-MLC$/);
      expect(m.sizeGB).toBeGreaterThan(0);
    }
    const tiny = BONSAI_MODELS.find(m => m.id.endsWith('1.7B-ONNX'));
    expect(tiny?.toolCapable).toBe(false);
  });

  it('keeps graph opt on for 1.7B (HF demo) and off for 4B (WASM heap)', () => {
    expect(bonsaiSessionOptions('onnx-community/Bonsai-1.7B-ONNX')).toBeUndefined();
    expect(bonsaiSessionOptions('onnx-community/Bonsai-4B-ONNX')).toEqual({ graphOptimizationLevel: 'disabled' });
  });
});

describe('bonsaiWeightsCachedIn', () => {
  const id = 'onnx-community/Bonsai-1.7B-ONNX';
  it('is false when only tokenizer/config/graph are cached', () => {
    expect(bonsaiWeightsCachedIn([
      'https://huggingface.co/onnx-community/Bonsai-1.7B-ONNX/resolve/main/tokenizer.json',
      'https://huggingface.co/onnx-community/Bonsai-1.7B-ONNX/resolve/main/config.json',
      'https://huggingface.co/onnx-community/Bonsai-1.7B-ONNX/resolve/main/onnx/model_q1.onnx',
    ], id)).toBe(false);
  });

  it('is true when the q1 weight sidecar is present', () => {
    expect(bonsaiWeightsCachedIn([
      'https://huggingface.co/onnx-community/Bonsai-1.7B-ONNX/resolve/main/onnx/model_q1.onnx_data',
    ], id)).toBe(true);
  });
});

describe('toBonsaiMessages', () => {
  it('omits an empty system slot', () => {
    const msgs = toBonsaiMessages('', [{ role: 'user', content: 'hi' }]);
    expect(msgs).toEqual([{ role: 'user', content: 'hi' }]);
  });

  it('keeps a non-empty system first', () => {
    const msgs = toBonsaiMessages('be brief', [{ role: 'user', content: 'hi' }]);
    expect(msgs[0]).toEqual({ role: 'system', content: 'be brief' });
  });
});

describe('streamBonsai', () => {
  beforeEach(async () => {
    callbackHold.length = 0;
    pipelineError = null;
    scriptedChunks = ['Hello', ' world'];
    await unloadBonsaiEngine();
    disposeCalls = 0; // after unload — the previous test's dispose must not leak in.
  });

  it('streams TextStreamer deltas and finishes with done', async () => {
    const events: Array<{ type: string; text?: string }> = [];
    for await (const ev of streamBonsai(conn, { system: '', messages: [{ role: 'user', content: 'hi' }] })) {
      events.push(ev);
    }
    expect(events.filter(e => e.type === 'text').map(e => e.text).join('')).toBe('Hello world');
    expect(events.at(-1)?.type).toBe('done');
  });

  it('rejects an unknown catalog id before loading transformers', async () => {
    const bad: AiConnection = { ...conn, model: 'not-a-bonsai' };
    await expect(async () => {
      for await (const _ of streamBonsai(bad, { system: '', messages: [{ role: 'user', content: 'hi' }] })) {
        /* drain */
      }
    }).rejects.toThrow(/Unknown Bonsai model/);
  });

  it('maps ONNX session bad_alloc to the WASM-heap message, not VRAM', async () => {
    pipelineError = new Error("Can't create a session. ERROR_CODE: 6, ERROR_MESSAGE: std::bad_alloc");
    await expect(async () => {
      for await (const _ of streamBonsai(conn, { system: '', messages: [{ role: 'user', content: 'hi' }] })) {
        /* drain */
      }
    }).rejects.toThrow(/ONNX compiler/);
  });

  it('routes Qwen3 think tags to reasoning, not the empty Thinking spinner', async () => {
    scriptedChunks = ['<think>', 'hmm', '</think>', 'Hi'];
    const events: Array<{ type: string; text?: string }> = [];
    for await (const ev of streamBonsai(conn, { system: '', messages: [{ role: 'user', content: 'hi' }] })) {
      events.push(ev);
    }
    expect(events.filter(e => e.type === 'reasoning').map(e => e.text).join('')).toBe('hmm');
    expect(events.filter(e => e.type === 'text').map(e => e.text).join('')).toBe('Hi');
  });

  it('disposes the ONNX pipeline on unload', async () => {
    for await (const _ of streamBonsai(conn, { system: '', messages: [{ role: 'user', content: 'hi' }] })) {
      /* drain */
    }
    await unloadBonsaiEngine();
    expect(disposeCalls).toBe(1);
  });
});
