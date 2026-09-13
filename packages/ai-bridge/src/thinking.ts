/**
 * Per-model thinking / reasoning capability.
 *
 * Providers do not advertise this on /models, so detection is by provider +
 * model-id family. The UI hides the control when `kind` is `none`; otherwise it
 * shows Off plus whatever levels that family actually has.
 *
 * Stored on the connection as `generation.thinking`:
 *   off | auto | low | medium | high
 * `auto` = leave the provider default (Qwen3 thinks; Claude/OpenAI/Gemini use
 * their own default). `off` turns it off where the API allows.
 */

import type { AiProviderId } from './connections.js';

export const THINKING_MODES = ['off', 'auto', 'low', 'medium', 'high'] as const;
export type ThinkingMode = (typeof THINKING_MODES)[number];

export type ThinkingCapability =
  | { kind: 'none' }
  | { kind: 'toggle' }
  | { kind: 'effort'; levels: ThinkingMode[] };

const EFFORT_LEVELS: ThinkingMode[] = ['off', 'auto', 'low', 'medium', 'high'];

function norm(modelId: string): string {
  return modelId.toLowerCase();
}

/** True for Qwen3 / Qwen3.5 ids (WebLLM packs and OpenRouter/Ollama names). */
export function isQwen3Family(modelId: string): boolean {
  const id = norm(modelId);
  return /qwen3/.test(id) && !/qwen2/.test(id);
}

function isClaudeFamily(modelId: string): boolean {
  return /claude/.test(norm(modelId));
}

/** Claude 4.6+ / 5 use adaptive thinking + effort, not budget_tokens. */
export function claudeUsesAdaptiveThinking(modelId: string): boolean {
  const id = norm(modelId);
  if (!isClaudeFamily(id)) return false;
  if (/claude-mythos|claude-fable|claude-opus-5|claude-sonnet-5|claude-haiku-5/.test(id)) return true;
  // 4.6, 4.7, 4.10… but not 4.5 / 4-2025 / sonnet-4-20250514 (date suffix).
  if (/claude-(?:opus|sonnet|haiku)-4[.](?:[6-9]|[1-9]\d+)(?!\d)/.test(id)) return true;
  if (/claude-(?:opus|sonnet|haiku)-4-(?:[6-9]|[1-9]\d)(?!\d)/.test(id)) return true;
  return false;
}

function isOpenAiReasoner(modelId: string): boolean {
  const id = norm(modelId);
  return (
    /gpt-5|gpt-6|gpt-7/.test(id)
    || /o1|o3|o4/.test(id)
    || /^(o1|o3|o4)/.test(id)
  );
}

function isGeminiThinker(modelId: string): boolean {
  const id = norm(modelId);
  return (
    /gemini-2\.5/.test(id)
    || /gemini-3/.test(id)
    || /gemini-2\.0-flash-thinking/.test(id)
    || /thinking/.test(id)
  );
}

function isCompatThinker(modelId: string): boolean {
  const id = norm(modelId);
  return (
    isQwen3Family(id)
    || /deepseek-r1|deepseek-reasoner|r1-/.test(id)
    || /gpt-oss/.test(id)
    || isOpenAiReasoner(id)
    || /thinking|reasoner/.test(id)
  );
}

export function thinkingCapability(provider: AiProviderId, modelId: string): ThinkingCapability {
  if (!modelId) return { kind: 'none' };
  switch (provider) {
    case 'webllm':
      return isQwen3Family(modelId) ? { kind: 'toggle' } : { kind: 'none' };
    case 'bonsai':
      return { kind: 'none' };
    case 'anthropic':
      return isClaudeFamily(modelId) ? { kind: 'effort', levels: EFFORT_LEVELS } : { kind: 'none' };
    case 'gemini':
      return isGeminiThinker(modelId) ? { kind: 'effort', levels: EFFORT_LEVELS } : { kind: 'none' };
    case 'openai':
      return isOpenAiReasoner(modelId) ? { kind: 'effort', levels: EFFORT_LEVELS } : { kind: 'none' };
    case 'openrouter':
    case 'ollama':
    case 'openai-compatible':
      if (isQwen3Family(modelId) && !isOpenAiReasoner(modelId)) return { kind: 'toggle' };
      if (isCompatThinker(modelId) || isClaudeFamily(modelId) || isGeminiThinker(modelId)) {
        return { kind: 'effort', levels: EFFORT_LEVELS };
      }
      return { kind: 'none' };
  }
}

export function resolveThinkingMode(raw: string | undefined): ThinkingMode {
  return (THINKING_MODES as readonly string[]).includes(raw ?? '') ? (raw as ThinkingMode) : 'auto';
}

/** Anthropic extended-thinking budget for a chosen level. */
export function anthropicThinkingBudget(mode: ThinkingMode): number | undefined {
  switch (mode) {
    case 'low': return 1024;
    case 'medium': return 4096;
    case 'high': return 10000;
    default: return undefined;
  }
}

/**
 * Mutate a provider request body so thinking matches `mode`. No-op for `auto`
 * (leave the provider default) and for families that don't support the knob.
 */
export function applyThinkingToRequest(
  provider: AiProviderId,
  modelId: string,
  mode: ThinkingMode,
  body: Record<string, unknown>,
): void {
  if (mode === 'auto') return;
  const cap = thinkingCapability(provider, modelId);
  if (cap.kind === 'none') return;

  if (provider === 'webllm') {
    body.extra_body = { ...(body.extra_body as object | undefined), enable_thinking: mode !== 'off' };
    return;
  }

  if (provider === 'anthropic') {
    if (mode === 'off') {
      body.thinking = { type: 'disabled' };
      return;
    }
    if (claudeUsesAdaptiveThinking(modelId)) {
      body.thinking = { type: 'adaptive' };
      body.output_config = { ...(body.output_config as object | undefined), effort: mode };
      return;
    }
    const budget = anthropicThinkingBudget(mode);
    if (budget != null) {
      const maxTokens = typeof body.max_tokens === 'number' ? body.max_tokens : 16384;
      if (maxTokens <= budget) body.max_tokens = budget + 2048;
      body.thinking = { type: 'enabled', budget_tokens: budget };
    }
    return;
  }

  if (provider === 'gemini') {
    const gen = (body.generationConfig as Record<string, unknown> | undefined) ?? {};
    const thinkingConfig: Record<string, unknown> = {
      includeThoughts: mode !== 'off',
    };
    if (mode === 'off') {
      thinkingConfig.thinkingBudget = 0;
      thinkingConfig.thinking_level = 'minimal';
    } else {
      thinkingConfig.thinking_level = mode;
      const budget = mode === 'low' ? 1024 : mode === 'medium' ? 4096 : 8192;
      thinkingConfig.thinkingBudget = budget;
    }
    gen.thinkingConfig = thinkingConfig;
    body.generationConfig = gen;
    return;
  }

  // OpenAI-compatible (OpenAI, OpenRouter, Ollama, generic).
  if (mode === 'off') {
    if (isQwen3Family(modelId)) {
      body.chat_template_kwargs = { enable_thinking: false };
      body.enable_thinking = false;
      body.extra_body = { ...(body.extra_body as object | undefined), enable_thinking: false };
    }
    body.reasoning_effort = 'none';
    if (provider === 'openrouter') body.reasoning = { effort: 'none' };
    return;
  }
  body.reasoning_effort = mode;
  if (provider === 'openrouter') body.reasoning = { effort: mode };
  if (isQwen3Family(modelId)) {
    body.enable_thinking = true;
    body.extra_body = { ...(body.extra_body as object | undefined), enable_thinking: true };
  }
}
