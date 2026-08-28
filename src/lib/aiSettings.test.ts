import { describe, it, expect } from 'vitest';
import {
  loadAiSettings, saveAiSettings, defaultAiSettings, SEED_PROMPTS,
  defaultModelFor, defaultBaseUrlFor, connectionReady, newConnectionId,
  memoryKV,
  type AiConnection,
} from './aiSettings';

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
