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
] as const;

export type AiProviderId = (typeof AI_PROVIDERS)[number];

export interface AiConnection {
  id: string;
  provider: AiProviderId;
  label: string;         // user-facing name ("My Claude key", "Local Ollama")
  apiKey: string;        // '' for Ollama / unauthenticated local endpoints
  model: string;
  /** OpenAI-compatible providers only; the provider's default when omitted. */
  baseUrl?: string;
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
}

const connectionSchema = z.object({
  id: z.string().min(1),
  provider: z.enum(AI_PROVIDERS),
  label: z.string(),
  apiKey: z.string(),
  model: z.string().min(1),
  baseUrl: z.string().optional(),
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
});

const STORAGE_KEY = 'retirement_ai_settings';

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

/** The default model id a provider gets when a connection is first added, so
 *  the chat works without the user knowing model names. All editable. */
export function defaultModelFor(provider: AiProviderId): string {
  switch (provider) {
    case 'anthropic': return 'claude-sonnet-4-20250514';
    case 'openai': return 'gpt-4o-mini';
    case 'openrouter': return 'anthropic/claude-sonnet-4';
    case 'gemini': return 'gemini-2.0-flash';
    case 'ollama': return 'llama3.1';
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
 *  legitimately have no key; a generic compatible endpoint needs a URL. */
export function connectionReady(c: AiConnection): boolean {
  if (!c.model.trim()) return false;
  if (c.provider === 'ollama') return (c.baseUrl ?? '').trim().length > 0;
  if (c.provider === 'openai-compatible') {
    return (c.baseUrl ?? '').trim().length > 0 && c.apiKey.trim().length > 0;
  }
  return c.apiKey.trim().length > 0;
}
