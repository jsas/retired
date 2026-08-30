// AI agent settings: provider connections (BYO API key) and the prompt library.
//
// Everything here is stored LOCALLY ONLY (localStorage today; the kv table when
// the data layer folds preferences in). Keys never leave the device except as
// the Authorization header on a direct browser→provider HTTPS call — the app
// has no server and proxies nothing. No key configured → the whole AI feature
// is inert (see ROADMAP "No bundled AI").

import { z } from 'zod';

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
 *  tunes behaves exactly as before. Surfaced on the Connections page. */
export interface AiGenerationSettings {
  /** Max tokens the model may generate per turn (chain-of-thought included).
   *  Anthropic/OpenAI-compatible REQUIRE the field, so "no limit" isn't
   *  possible — the default is generous instead (DEFAULT_MAX_TOKENS). */
  maxTokens?: number;
  /** Sampling temperature (0 = deterministic). Provider default when unset. */
  temperature?: number;
  /** Local (web-llm) only: whole-n-gram repeat penalty, the anti-ramble guard. */
  repetitionPenalty?: number;
  /** Local (web-llm) only: presence penalty (encourages new topics). */
  presencePenalty?: number;
  /** Local (web-llm) only: frequency penalty (discourages re-using the same
   *  words). web-llm pairs this with presence — whichever is unset gets
   *  zeroed — so setting both is what makes either one bite. */
  frequencyPenalty?: number;
}

export interface AiConnection {
  id: string;
  provider: AiProviderId;
  label: string;         // user-facing name ("My Claude key", "Local Ollama")
  apiKey: string;        // '' for Ollama / unauthenticated local endpoints
  model: string;
  /** OpenAI-compatible providers only; the provider's default when omitted. */
  baseUrl?: string;
  /** Context window in tokens, for the usage indicator + compaction trigger.
   *  When omitted a provider default is assumed (small for local models). */
  contextSize?: number;
  generation?: AiGenerationSettings;
}

export interface AiPromptPreset {
  id: string;
  title: string;
  text: string;
  builtin?: boolean;     // ships with the app; only user copies are deletable
}

export interface AiSettings {
  connections: AiConnection[];
  activeConnectionId: string | null;
  prompts: AiPromptPreset[];
  /** User-edited replacement for the assistant's base persona prompt. When
   *  unset the built-in DEFAULT_SYSTEM_PROMPT (agentLoop) is used. */
  systemPromptOverride?: string;
}

const generationSchema = z.object({
  maxTokens: z.number().int().positive().optional(),
  temperature: z.number().min(0).max(2).optional(),
  repetitionPenalty: z.number().min(0).max(2).optional(),
  presencePenalty: z.number().min(-2).max(2).optional(),
  frequencyPenalty: z.number().min(-2).max(2).optional(),
});

const connectionSchema = z.object({
  id: z.string().min(1),
  provider: z.enum(AI_PROVIDERS),
  label: z.string(),
  apiKey: z.string(),
  model: z.string().min(1),
  baseUrl: z.string().optional(),
  contextSize: z.number().int().positive().optional(),
  generation: generationSchema.optional(),
});

const promptSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  text: z.string(),
  builtin: z.boolean().optional(),
});

const settingsSchema = z.object({
  connections: z.array(connectionSchema),
  activeConnectionId: z.string().nullable(),
  prompts: z.array(promptSchema),
  systemPromptOverride: z.string().optional(),
});

const STORAGE_KEY = 'retirement_ai_settings';
/** Exported so the backup layer (db.ts / Data page) can carry AI settings in
 *  the SQLite file under the same key they occupy in localStorage. */
export const AI_SETTINGS_STORAGE_KEY = STORAGE_KEY;

/** Starter prompt library. The first is the headline onboarding flow: the
 *  agent interviews the user and drafts a scenario instead of the user facing
 *  an empty form. */
export const SEED_PROMPTS: AiPromptPreset[] = [
  {
    id: 'onboard',
    title: 'Get me started on a scenario',
    builtin: true,
    text:
      'Help me build my retirement scenario from scratch. Interview me one question at a time about ' +
      'my age, province, account balances (RRSP, TFSA, taxable, cash), annual contributions, pensions, ' +
      'when I want to retire, and what I expect to spend. Ask about my spouse/partner too if I have one. ' +
      'Use the get_scenario tool to see what is already filled in, and propose changes with ' +
      'set_scenario_value as we go — never set anything without my agreement. When the basics are in ' +
      'place, run the projection with run_projection and walk me through what it says.',
  },
  {
    id: 'on-track',
    title: 'Am I on track? Top 3 levers',
    builtin: true,
    text:
      'Use run_projection on my current scenario and tell me whether I am on track to fund my ' +
      'retirement to my max age. Identify the three highest-impact levers to improve the outcome ' +
      '(spending level, retirement age, CPP/OAS start ages, withdrawal order, savings rate), ranked by ' +
      'expected effect, and explain each in a sentence or two. Do not change anything without asking.',
  },
  {
    id: 'cpp-oas-timing',
    title: 'When should I take CPP & OAS?',
    builtin: true,
    text:
      'Using run_projection, analyze when I should start CPP (any age 60–70) and OAS (65–70). Weigh the ' +
      'early-CPP reduction (0.6%/month before 65) and the deferral bonuses (CPP +0.7%/month, OAS ' +
      '+0.6%/month, both to 70) against my portfolio draw, my tax bracket by year, any OAS clawback, and ' +
      'how long my money needs to last. Explain your reasoning; ask before changing my inputs.',
  },
  {
    id: 'compare-runs',
    title: 'Test a change against my baseline',
    builtin: true,
    text:
      'I want to see how one change would affect my plan. Ask me which lever and value to try, then use ' +
      'compare_scenarios to run my current inputs against that variant. Report the difference in ' +
      'sustainable outcome — depletion age, lifetime tax, ending balance — and whether the change is ' +
      'worth applying. Do not apply it without my say-so.',
  },
];

export function defaultAiSettings(): AiSettings {
  return {
    connections: [],
    activeConnectionId: null,
    prompts: SEED_PROMPTS.map(p => ({ ...p })),
  };
}

interface KV {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

/** The backing key-value store (localStorage in the app, an in-memory shim in
 *  tests). */
export function memoryKV(): KV {
  const m = new Map<string, string>();
  return {
    getItem: k => (m.has(k) ? m.get(k)! : null),
    setItem: (k, v) => { m.set(k, String(v)); },
  };
}

function defaultKV(): KV {
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch {
    // SSR / blocked storage — fall through to memory.
  }
  return memoryKV();
}

/** Parse whatever is in storage into valid settings. Corrupt or legacy
 *  payloads fall back to defaults (with the seed prompt library) rather than
 *  breaking the page — AI settings are disposable; scenarios are not. */
export function loadAiSettings(kv: KV = defaultKV()): AiSettings {
  try {
    const raw = kv.getItem(STORAGE_KEY);
    if (!raw) return defaultAiSettings();
    const parsed = settingsSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return defaultAiSettings();
    const s = parsed.data;
    // Re-seed any builtin prompts the user hasn't seen (new releases add them);
    // user edits to a builtin's copy survive because the id is already present.
    const have = new Set(s.prompts.map(p => p.id));
    for (const seed of SEED_PROMPTS) {
      if (!have.has(seed.id)) s.prompts.push({ ...seed });
    }
    if (s.activeConnectionId && !s.connections.some(c => c.id === s.activeConnectionId)) {
      s.activeConnectionId = s.connections[0]?.id ?? null;
    }
    return s;
  } catch {
    return defaultAiSettings();
  }
}

export function saveAiSettings(settings: AiSettings, kv: KV = defaultKV()): void {
  try {
    kv.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Storage full / blocked: AI settings are non-critical; the page keeps
    // working with in-memory state.
  }
}

export function newConnectionId(): string {
  return `conn-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

/** Generation defaults. max_tokens is deliberately generous: reasoning models
 *  (DeepSeek-R1, Qwen3-thinking, GLM) spend their chain of thought INSIDE the
 *  same budget before writing the visible answer, so a small cap yields a
 *  thought-then-nothing turn or a mid-sentence cutoff. 16384 leaves room for
 *  both; the user can raise or lower it per connection on the Connections
 *  page. Temperature defaults differ by tier: cloud providers get their own
 *  (omit the field); local math/reasoning models stay deterministic-ish. */
export const DEFAULT_MAX_TOKENS = 16384;
export const DEFAULT_LOCAL_TEMPERATURE = 0.3;
export const DEFAULT_LOCAL_REPETITION_PENALTY = 1.15;
export const DEFAULT_LOCAL_PRESENCE_PENALTY = 0.3;
export const DEFAULT_LOCAL_FREQUENCY_PENALTY = 0.3;

/** Sampler tuning keyed by web-llm model id. Models loop differently —
 *  Phi-4-mini's failure is the diverse word-salad, which the generic
 *  defaults don't restrain — so a loop-prone model carries its own
 *  defaults here, applied only when the user hasn't set an explicit value
 *  on the connection. Kept in this module (not webLlmModels) so
 *  effectiveGeneration has no import cycle. */
export const MODEL_SAMPLER_DEFAULTS: Record<string, {
  temperature?: number;
  repetitionPenalty?: number;
  presencePenalty?: number;
  /** web-llm pairs frequency with presence (zeroing whichever is unset), so
   *  a presence-only setting under-delivers — set both for the intended bite. */
  frequencyPenalty?: number;
}> = {
  // Phi-4-mini's failure mode is the diverse word-salad: hundreds of
  // mostly-unique jargon tokens at a runaway pace. The generic defaults
  // (rep 1.15, presence-only 0.3) don't restrain it — and web-llm zeroes an
  // unpaired presence penalty, halving what bite it had. Give this model a
  // stronger, frequency-backed anti-repeat profile.
  'Phi-4-mini-instruct-q4f16_1-MLC': {
    temperature: 0.6,
    repetitionPenalty: 1.3,
    presencePenalty: 0.5,
    frequencyPenalty: 0.5,
  },
};

/** Resolve a connection's effective generation settings: the user's override
 *  when present, then the MODEL's own sampler defaults (loop-prone local
 *  models above), then the generic provider default. Cloud temperature stays
 *  undefined (the provider's own default applies — omitting the field is
 *  different from sending one). */
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
    // Default to the newest 4B all-rounder — strong instruction-following at a
    // size most GPUs hold. Weaker models derail on the tool protocol.
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
