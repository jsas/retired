import { describe, it, expect } from 'vitest';
import {
  loadAiSettings, saveAiSettings, defaultAiSettings, SEED_PROMPTS,
  defaultModelFor, defaultBaseUrlFor, connectionReady, newConnectionId,
  memoryKV, effectiveGeneration,
  DEFAULT_MAX_TOKENS, DEFAULT_LOCAL_TEMPERATURE,
  DEFAULT_LOCAL_REPETITION_PENALTY, DEFAULT_LOCAL_PRESENCE_PENALTY,
  DEFAULT_LOCAL_FREQUENCY_PENALTY, MODEL_SAMPLER_DEFAULTS,
  type AiConnection,
} from './aiSettings';
import { WEBLLM_MODELS } from './ai/webLlmModels';

function conn(over: Partial<AiConnection> = {}): AiConnection {
  return {
    id: 'c1', provider: 'anthropic', label: 'Claude', apiKey: 'sk-ant-x',
    model: 'claude-sonnet-4-20250514', ...over,
  };
}

describe('aiSettings load/save', () => {
  it('returns defaults with the seed prompt library when nothing is stored', () => {
    const s = loadAiSettings(memoryKV());
    expect(s.connections).toEqual([]);
    expect(s.activeConnectionId).toBeNull();
    expect(s.prompts.map(p => p.id)).toEqual(SEED_PROMPTS.map(p => p.id));
  });

  it('round-trips connections and prompts', () => {
    const kv = memoryKV();
    const s = defaultAiSettings();
    s.connections.push(conn());
    s.activeConnectionId = 'c1';
    s.prompts.push({ id: 'mine', title: 'My prompt', text: 'do a thing' });
    saveAiSettings(s, kv);
    const back = loadAiSettings(kv);
    expect(back.connections).toHaveLength(1);
    expect(back.activeConnectionId).toBe('c1');
    expect(back.prompts.some(p => p.id === 'mine')).toBe(true);
  });

  it('falls back to defaults on a corrupt payload', () => {
    const kv = memoryKV();
    kv.setItem('retirement_ai_settings', '{not json');
    expect(loadAiSettings(kv).connections).toEqual([]);
    kv.setItem('retirement_ai_settings', JSON.stringify({ connections: 'nope' }));
    expect(loadAiSettings(kv).prompts.length).toBe(SEED_PROMPTS.length);
  });

  it('re-seeds newly added builtin prompts without touching user copies', () => {
    const kv = memoryKV();
    const s = defaultAiSettings();
    // User edited their copy of a builtin, and deleted another builtin.
    s.prompts = s.prompts.filter(p => p.id !== 'compare-runs');
    s.prompts.find(p => p.id === 'on-track')!.text = 'edited';
    saveAiSettings(s, kv);
    const back = loadAiSettings(kv);
    expect(back.prompts.find(p => p.id === 'on-track')!.text).toBe('edited');
    expect(back.prompts.some(p => p.id === 'compare-runs')).toBe(true);
  });

  it('drops a dangling activeConnectionId', () => {
    const kv = memoryKV();
    const s = defaultAiSettings();
    s.connections.push(conn());
    s.activeConnectionId = 'ghost';
    saveAiSettings(s, kv);
    expect(loadAiSettings(kv).activeConnectionId).toBe('c1');
  });
});

describe('provider defaults', () => {
  it('gives every provider a default model and the right base urls', () => {
    expect(defaultModelFor('anthropic')).toMatch(/^claude-/);
    expect(defaultBaseUrlFor('ollama')).toBe('http://localhost:11434/v1');
    expect(defaultBaseUrlFor('openrouter')).toContain('openrouter.ai');
    expect(defaultBaseUrlFor('anthropic')).toBeUndefined();
  });

  it('connectionReady respects per-provider requirements', () => {
    expect(connectionReady(conn())).toBe(true);
    expect(connectionReady(conn({ apiKey: '' }))).toBe(false);
    expect(connectionReady(conn({ model: '' }))).toBe(false);
    // Ollama needs a base url but no key.
    expect(connectionReady(conn({ provider: 'ollama', apiKey: '', baseUrl: 'http://localhost:11434/v1' }))).toBe(true);
    expect(connectionReady(conn({ provider: 'ollama', apiKey: '', baseUrl: '' }))).toBe(false);
    // Generic compatible endpoint needs both.
    expect(connectionReady(conn({ provider: 'openai-compatible', baseUrl: 'http://x/v1' }))).toBe(true);
    expect(connectionReady(conn({ provider: 'openai-compatible', baseUrl: '' }))).toBe(false);
  });

  it('generates unique connection ids', () => {
    expect(newConnectionId()).not.toBe(newConnectionId());
  });
});

describe('generation settings', () => {
  it('persists a connection generation block through save/load', () => {
    const kv = memoryKV();
    const s = defaultAiSettings();
    s.connections.push(conn({ generation: { maxTokens: 32768, temperature: 0.7 } }));
    saveAiSettings(s, kv);
    const back = loadAiSettings(kv).connections[0];
    expect(back.generation).toEqual({ maxTokens: 32768, temperature: 0.7 });
  });

  it('drops a malformed generation block to defaults rather than failing load', () => {
    const kv = memoryKV();
    // temperature above the schema's max (2) is invalid → whole payload falls
    // back to defaults (AI settings are disposable; see loadAiSettings).
    const s = defaultAiSettings();
    s.connections.push(conn({ generation: { temperature: 99 } }));
    saveAiSettings(s, kv);
    expect(loadAiSettings(kv).connections).toEqual([]);
  });

  it('effectiveGeneration returns the generous defaults when nothing is set', () => {
    const g = effectiveGeneration(conn());
    expect(g.maxTokens).toBe(DEFAULT_MAX_TOKENS);
    expect(g.temperature).toBeUndefined(); // cloud: provider's own default
    expect(g.repetitionPenalty).toBe(DEFAULT_LOCAL_REPETITION_PENALTY);
    expect(g.presencePenalty).toBe(DEFAULT_LOCAL_PRESENCE_PENALTY);
    expect(g.frequencyPenalty).toBe(DEFAULT_LOCAL_FREQUENCY_PENALTY);
  });

  it('effectiveGeneration prefers per-connection overrides', () => {
    const g = effectiveGeneration(conn({
      generation: { maxTokens: 8192, temperature: 0.2, repetitionPenalty: 1.3 },
    }));
    expect(g.maxTokens).toBe(8192);
    expect(g.temperature).toBe(0.2);
    expect(g.repetitionPenalty).toBe(1.3);
    expect(g.presencePenalty).toBe(DEFAULT_LOCAL_PRESENCE_PENALTY); // untouched
    expect(g.frequencyPenalty).toBe(DEFAULT_LOCAL_FREQUENCY_PENALTY); // untouched
  });

  it('local defaults keep deterministic-ish sampling', () => {
    expect(DEFAULT_LOCAL_TEMPERATURE).toBeLessThanOrEqual(0.5);
    expect(DEFAULT_LOCAL_REPETITION_PENALTY).toBeGreaterThan(1);
  });

  it('a loop-prone local model picks up its own sampler defaults', () => {
    const phi = conn({ provider: 'webllm', apiKey: '', model: 'Phi-4-mini-instruct-q4f16_1-MLC' });
    const g = effectiveGeneration(phi);
    const tuned = MODEL_SAMPLER_DEFAULTS['Phi-4-mini-instruct-q4f16_1-MLC'];
    // The model's profile overrides the generic local defaults…
    expect(g.temperature).toBe(tuned.temperature);
    expect(g.repetitionPenalty).toBe(tuned.repetitionPenalty);
    expect(g.presencePenalty).toBe(tuned.presencePenalty);
    expect(g.frequencyPenalty).toBe(tuned.frequencyPenalty);
    // …and it's actually stronger than the generic anti-repeat floor.
    expect(g.repetitionPenalty).toBeGreaterThan(DEFAULT_LOCAL_REPETITION_PENALTY);
    // …but a user's explicit setting still wins.
    const overridden = effectiveGeneration({
      ...phi, generation: { repetitionPenalty: 1.1 },
    });
    expect(overridden.repetitionPenalty).toBe(1.1);
    expect(overridden.presencePenalty).toBe(tuned.presencePenalty); // untouched
  });

  it('other local models keep the generic sampler defaults', () => {
    const qwen = conn({ provider: 'webllm', apiKey: '', model: 'Qwen3.5-4B-q4f16_1-MLC' });
    const g = effectiveGeneration(qwen);
    // No model profile: temperature stays undefined here and the provider
    // applies DEFAULT_LOCAL_TEMPERATURE at request time (unchanged behavior).
    expect(g.temperature).toBeUndefined();
    expect(g.repetitionPenalty).toBe(DEFAULT_LOCAL_REPETITION_PENALTY);
    expect(g.presencePenalty).toBe(DEFAULT_LOCAL_PRESENCE_PENALTY);
    expect(g.frequencyPenalty).toBe(DEFAULT_LOCAL_FREQUENCY_PENALTY);
  });

  it('every sampler-tuned model id is a real curated model', () => {
    const ids = new Set(WEBLLM_MODELS.map(m => m.id));
    for (const id of Object.keys(MODEL_SAMPLER_DEFAULTS)) {
      expect(ids.has(id), `${id} is not in WEBLLM_MODELS`).toBe(true);
    }
  });
});
