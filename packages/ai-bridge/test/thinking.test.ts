import { describe, expect, it } from 'vitest';
import {
  thinkingCapability,
  resolveThinkingMode,
  applyThinkingToRequest,
  claudeUsesAdaptiveThinking,
  isQwen3Family,
} from '../src/thinking.js';

describe('thinkingCapability', () => {
  it('treats WebLLM Qwen3 as a toggle and other local packs as none', () => {
    expect(thinkingCapability('webllm', 'Qwen3.5-4B-q4f16_1-MLC')).toEqual({ kind: 'toggle' });
    expect(thinkingCapability('webllm', 'Qwen3-8B-q4f16_1-MLC')).toEqual({ kind: 'toggle' });
    expect(thinkingCapability('webllm', 'Llama-3.2-3B-Instruct-q4f16_1-MLC').kind).toBe('none');
    expect(thinkingCapability('webllm', 'Mistral-7B-Instruct-v0.3-q4f16_1-MLC').kind).toBe('none');
    expect(thinkingCapability('bonsai', 'onnx-community/Bonsai-1.7B-ONNX').kind).toBe('none');
  });

  it('gives Claude / Gemini thinkers / OpenAI reasoners effort levels', () => {
    const effort = { kind: 'effort', levels: ['off', 'auto', 'low', 'medium', 'high'] };
    expect(thinkingCapability('anthropic', 'claude-sonnet-4-20250514')).toEqual(effort);
    expect(thinkingCapability('anthropic', 'claude-opus-4-6')).toEqual(effort);
    expect(thinkingCapability('gemini', 'gemini-2.5-flash')).toEqual(effort);
    expect(thinkingCapability('openai', 'gpt-5')).toEqual(effort);
    expect(thinkingCapability('openai', 'o3-mini')).toEqual(effort);
    expect(thinkingCapability('openai', 'gpt-4o-mini').kind).toBe('none');
    expect(thinkingCapability('gemini', 'gemini-2.0-flash').kind).toBe('none');
  });

  it('detects Qwen3 on OpenRouter as a toggle, DeepSeek-R1 as effort', () => {
    expect(thinkingCapability('openrouter', 'qwen/qwen3-8b')).toEqual({ kind: 'toggle' });
    expect(thinkingCapability('openrouter', 'deepseek/deepseek-r1').kind).toBe('effort');
    expect(thinkingCapability('ollama', 'llama3.1').kind).toBe('none');
  });

  it('returns none for an empty model id', () => {
    expect(thinkingCapability('anthropic', '').kind).toBe('none');
  });
});

describe('resolveThinkingMode / family helpers', () => {
  it('defaults unknown / missing values to auto', () => {
    expect(resolveThinkingMode(undefined)).toBe('auto');
    expect(resolveThinkingMode('nope')).toBe('auto');
    expect(resolveThinkingMode('high')).toBe('high');
  });

  it('flags Qwen3 families and Claude 4.6+ adaptive thinking', () => {
    expect(isQwen3Family('Qwen3.5-4B-q4f16_1-MLC')).toBe(true);
    expect(isQwen3Family('Qwen2.5-7B')).toBe(false);
    expect(claudeUsesAdaptiveThinking('claude-opus-4-6')).toBe(true);
    expect(claudeUsesAdaptiveThinking('claude-sonnet-4-20250514')).toBe(false);
  });
});

describe('applyThinkingToRequest', () => {
  it('is a no-op for auto', () => {
    const body: Record<string, unknown> = {};
    applyThinkingToRequest('anthropic', 'claude-sonnet-4-20250514', 'auto', body);
    expect(body).toEqual({});
  });

  it('maps WebLLM off/on onto extra_body.enable_thinking', () => {
    const off: Record<string, unknown> = {};
    applyThinkingToRequest('webllm', 'Qwen3.5-4B-q4f16_1-MLC', 'off', off);
    expect(off.extra_body).toEqual({ enable_thinking: false });
    const on: Record<string, unknown> = {};
    applyThinkingToRequest('webllm', 'Qwen3.5-4B-q4f16_1-MLC', 'low', on);
    expect(on.extra_body).toEqual({ enable_thinking: true });
  });

  it('disables Anthropic thinking, or sets a budget / adaptive effort', () => {
    const off: Record<string, unknown> = {};
    applyThinkingToRequest('anthropic', 'claude-sonnet-4-20250514', 'off', off);
    expect(off.thinking).toEqual({ type: 'disabled' });

    const budget: Record<string, unknown> = { max_tokens: 16384 };
    applyThinkingToRequest('anthropic', 'claude-sonnet-4-20250514', 'medium', budget);
    expect(budget.thinking).toEqual({ type: 'enabled', budget_tokens: 4096 });

    const adaptive: Record<string, unknown> = {};
    applyThinkingToRequest('anthropic', 'claude-opus-4-6', 'high', adaptive);
    expect(adaptive.thinking).toEqual({ type: 'adaptive' });
    expect(adaptive.output_config).toEqual({ effort: 'high' });
  });

  it('sets Gemini thinkingConfig and OpenAI-compat reasoning_effort', () => {
    const gem: Record<string, unknown> = { generationConfig: {} };
    applyThinkingToRequest('gemini', 'gemini-2.5-flash', 'low', gem);
    const cfg = (gem.generationConfig as { thinkingConfig: Record<string, unknown> }).thinkingConfig;
    expect(cfg.thinking_level).toBe('low');
    expect(cfg.includeThoughts).toBe(true);

    const oai: Record<string, unknown> = {};
    applyThinkingToRequest('openai', 'gpt-5', 'high', oai);
    expect(oai.reasoning_effort).toBe('high');

    const or: Record<string, unknown> = {};
    applyThinkingToRequest('openrouter', 'qwen/qwen3-8b', 'off', or);
    expect(or.enable_thinking).toBe(false);
    expect(or.reasoning).toEqual({ effort: 'none' });
  });
});
