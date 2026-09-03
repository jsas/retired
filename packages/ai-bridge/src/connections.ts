/**
 * Connection model + generation-default primitives for the ai-bridge. Moved
 * here from the app's `src/lib/aiSettings.ts` so the bridge owns the full
 * model-selection surface (providers + connections + their tuning) that both
 * the web assistant and the markup assistant consume. The app keeps the
 * persistence/prompt-library half in `aiSettings.ts` and re-exports these.
 */

export const AI_PROVIDERS = [
  'anthropic',
  'openai',
  'openrouter',
  'gemini',
  'ollama',
  'openai-compatible',
  'webllm',
] as const;

export type AiProviderId = (typeof AI_PROVIDERS)[number];

/** Per-connection generation tuning. Every field is optional — when omitted
 *  the provider's DEFAULT_* constant applies, so a connection the user never
 *  tunes behaves exactly as before. */
export interface AiGenerationSettings {
  maxTokens?: number;
  temperature?: number;
  repetitionPenalty?: number;
  presencePenalty?: number;
  frequencyPenalty?: number;
}

export interface AiConnection {
  id: string;
  provider: AiProviderId;
  label: string;
  apiKey: string;
  model: string;
  baseUrl?: string;
  contextSize?: number;
  generation?: AiGenerationSettings;
}

/** Generation defaults. max_tokens is deliberately generous: reasoning models
 *  (DeepSeek-R1, Qwen3-thinking, GLM) spend their chain of thought INSIDE the
 *  same budget before writing the visible answer, so a small cap yields a
 *  thought-then-nothing turn or a mid-sentence cutoff. Temperature defaults
 *  differ by tier: cloud providers get their own (omit the field); local
 *  math/reasoning models stay deterministic-ish. */
export const DEFAULT_MAX_TOKENS = 16384;
export const DEFAULT_LOCAL_TEMPERATURE = 0.3;
export const DEFAULT_LOCAL_REPETITION_PENALTY = 1.15;
export const DEFAULT_LOCAL_PRESENCE_PENALTY = 0.3;
export const DEFAULT_LOCAL_FREQUENCY_PENALTY = 0.3;

/** Sampler tuning keyed by web-llm model id. Loop-prone local models carry
 *  their own defaults here, applied only when the user hasn't set an explicit
 *  value on the connection. */
export const MODEL_SAMPLER_DEFAULTS: Record<string, {
  temperature?: number;
  repetitionPenalty?: number;
  presencePenalty?: number;
  frequencyPenalty?: number;
}> = {
  // Phi-4-mini's failure mode is the diverse word-salad: hundreds of
  // mostly-unique jargon tokens at a runaway pace. The generic defaults don't
  // restrain it — and web-llm zeroes an unpaired presence penalty. Give this
  // model a stronger, frequency-backed anti-repeat profile.
  'Phi-4-mini-instruct-q4f16_1-MLC': {
    temperature: 0.6,
    repetitionPenalty: 1.3,
    presencePenalty: 0.5,
    frequencyPenalty: 0.5,
  },
};

/** Resolve a connection's effective generation settings: the user's override
 *  when present, then the MODEL's own sampler defaults, then the generic
 *  provider default. Cloud temperature stays undefined (the provider's own
 *  default applies — omitting the field is different from sending one). */
export function effectiveGeneration(c: AiConnection): {
  maxTokens: number;
  temperature: number | undefined;
  repetitionPenalty: number;
  presencePenalty: number;
  frequencyPenalty: number;
} {
  const sampler = c.provider === 'webllm' ? MODEL_SAMPLER_DEFAULTS[c.model] : undefined;
  return {
    maxTokens: c.generation?.maxTokens ?? DEFAULT_MAX_TOKENS,
    temperature: c.generation?.temperature ?? sampler?.temperature,
    repetitionPenalty: c.generation?.repetitionPenalty
      ?? sampler?.repetitionPenalty ?? DEFAULT_LOCAL_REPETITION_PENALTY,
    presencePenalty: c.generation?.presencePenalty
      ?? sampler?.presencePenalty ?? DEFAULT_LOCAL_PRESENCE_PENALTY,
    frequencyPenalty: c.generation?.frequencyPenalty
      ?? sampler?.frequencyPenalty ?? DEFAULT_LOCAL_FREQUENCY_PENALTY,
  };
}

/** The default model id a provider gets when a connection is first added, so
 *  the chat works without the user knowing model names. All editable. */
export function defaultModelFor(provider: AiProviderId): string {
  switch (provider) {
    case 'anthropic': return 'claude-sonnet-4-20250514';
    case 'openai': return 'gpt-4o-mini';
    case 'openrouter': return 'anthropic/claude-sonnet-4';
    case 'gemini': return 'gemini-2.0-flash';
    case 'ollama': return 'llama3.1';
    // Newest 4B all-rounder — strong instruction-following at a size most GPUs
    // hold. Weaker models derail on the tool protocol.
    case 'webllm': return 'Qwen3.5-4B-q4f16_1-MLC';
    case 'openai-compatible': return '';
  }
}

export function defaultBaseUrlFor(provider: AiProviderId): string | undefined {
  switch (provider) {
    case 'openai': return 'https://api.openai.com/v1';
    case 'openrouter': return 'https://openrouter.ai/api/v1';
    case 'ollama': return 'http://localhost:11434/v1';
    default: return undefined; // anthropic & gemini endpoints are fixed
  }
}

/** True when a connection has everything needed to attempt a call. Ollama may
 *  legitimately have no key; web-llm needs no key or URL (in-browser); a
 *  generic compatible endpoint needs a URL. */
export function connectionReady(c: AiConnection): boolean {
  if (!c.model.trim()) return false;
  if (c.provider === 'webllm') return true; // in-browser: a model id is enough
  if (c.provider === 'ollama') return (c.baseUrl ?? '').trim().length > 0;
  if (c.provider === 'openai-compatible') {
    return (c.baseUrl ?? '').trim().length > 0 && c.apiKey.trim().length > 0;
  }
  return c.apiKey.trim().length > 0;
}
