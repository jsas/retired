import { describe, expect, it } from 'vitest';
import { defaultAiSettings, type AiConnection } from '../aiSettings';
import {
  OPENROUTER_FREE_ROUTER,
  ensureOpenRouterFree,
  isOpenRouterFreeId,
  openRouterConnection,
} from './openRouterFree';

describe('OpenRouter free helpers', () => {
  it('treats the router and :free ids as free', () => {
    expect(isOpenRouterFreeId(OPENROUTER_FREE_ROUTER)).toBe(true);
    expect(isOpenRouterFreeId('meta-llama/llama-3.3-70b-instruct:free')).toBe(true);
    expect(isOpenRouterFreeId('anthropic/claude-sonnet-4')).toBe(false);
  });

  it('creates an OpenRouter connection aimed at the free router', () => {
    const next = ensureOpenRouterFree(defaultAiSettings(), () => 'or1');
    const c = openRouterConnection(next);
    expect(c).toMatchObject({
      id: 'or1',
      provider: 'openrouter',
      model: OPENROUTER_FREE_ROUTER,
      apiKey: '',
      baseUrl: 'https://openrouter.ai/api/v1',
    });
    expect(next.activeConnectionId).toBe('or1');
  });

  it('reuses an existing OpenRouter connection and does not wipe the key', () => {
    const existing: AiConnection = {
      id: 'keep',
      provider: 'openrouter',
      label: 'My OR',
      apiKey: 'sk-or-v1-secret',
      model: 'anthropic/claude-sonnet-4',
      baseUrl: 'https://openrouter.ai/api/v1',
    };
    const s = defaultAiSettings();
    s.connections.push(existing);
    const next = ensureOpenRouterFree(s, () => 'should-not-run');
    expect(next.connections).toHaveLength(1);
    expect(next.connections[0]).toMatchObject({
      id: 'keep',
      apiKey: 'sk-or-v1-secret',
      model: OPENROUTER_FREE_ROUTER,
      label: 'My OR',
    });
    expect(next.activeConnectionId).toBe('keep');
  });
});
