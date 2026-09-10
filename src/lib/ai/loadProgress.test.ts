import { describe, expect, it } from 'vitest';
import { classifyLoadProgress, localizeLoadProgress } from './loadProgress';

describe('classifyLoadProgress', () => {
  it('parses web-llm cache, fetch, shader, and finish lines', () => {
    expect(classifyLoadProgress(
      'Loading model from cache[1/127]: 485MB loaded. 10% completed, 2 secs elapsed.',
    )).toEqual({ kind: 'cache', current: 1, total: 127, mb: 485 });
    expect(classifyLoadProgress(
      'Fetching param cache[3/40]: 120MB fetched. 5% completed, 8 secs elapsed. It can take a while when we first visit this page to populate the cache. Later refreshes will become faster.',
    )).toEqual({ kind: 'download', current: 3, total: 40, mb: 120 });
    expect(classifyLoadProgress(
      'Loading GPU shader modules[4/12]: 30% completed, 1 secs elapsed.',
    )).toEqual({ kind: 'shaders', current: 4, total: 12 });
    expect(classifyLoadProgress('Finish loading on NVIDIA GeForce RTX 5070 Ti')).toEqual({ kind: 'ready' });
  });

  it('classifies Bonsai and our own preparing string', () => {
    expect(classifyLoadProgress('Preparing the local model…')).toEqual({ kind: 'preparing' });
    expect(classifyLoadProgress('Ready.')).toEqual({ kind: 'ready' });
    expect(classifyLoadProgress('Warming up Bonsai on the GPU…')).toEqual({ kind: 'compile' });
    expect(classifyLoadProgress('Downloading model_q1.onnx_data…')).toEqual({ kind: 'file', file: 'model_q1.onnx_data' });
    expect(classifyLoadProgress('Loading Bonsai…')).toEqual({ kind: 'download' });
  });
});

describe('localizeLoadProgress', () => {
  const en: Record<string, string> = {
    'assistant.loadingLocal': 'Loading the local model…',
    'assistant.loadFromCache': 'Loading from cache ({{current}}/{{total}}) — {{mb}} MB',
    'assistant.loadDownloading': 'Downloading weights ({{current}}/{{total}}) — {{mb}} MB',
    'assistant.loadShaders': 'Compiling GPU shaders ({{current}}/{{total}})',
    'assistant.loadCompile': 'Compiling the model for your GPU…',
    'assistant.loadFile': 'Downloading {{file}}…',
    'assistant.loadReady': 'Ready',
    'assistant.loadGeneric': 'Downloading…',
  };
  const t = (key: string, opts?: Record<string, unknown>) => {
    let s = en[key] ?? key;
    for (const [k, v] of Object.entries(opts ?? {})) s = s.replace(`{{${k}}}`, String(v));
    return s;
  };

  it('replaces the English cache dump with our copy', () => {
    expect(localizeLoadProgress(
      'Loading model from cache[1/127]: 485MB loaded. 10% completed, 2 secs elapsed.',
      t,
    )).toBe('Loading from cache (1/127) — 485 MB');
  });
});
