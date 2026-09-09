// AI agent settings: persistence for provider connections (BYO API key) and
// the prompt library.
//
// Everything here is stored LOCALLY ONLY (localStorage today; the kv table when
// the data layer folds preferences in). Keys never leave the device except as
// the Authorization header on a direct browser→provider HTTPS call — the app
// has no server and proxies nothing. No key configured → the whole AI feature
// is inert (see ROADMAP "No bundled AI").
//
// The connection model + provider/generation primitives (AiConnection,
// effectiveGeneration, connectionReady, the DEFAULT_* constants) live in
// @retired/ai-bridge — the shared model-selection surface — and are re-exported
// here so existing imports keep working. New code should import them from
// '@retired/ai-bridge'.

import { z } from 'zod';
import {
  AI_PROVIDERS,
  type AiConnection,
  type AiGenerationSettings,
  type AiProviderId,
} from '@retired/ai-bridge';

export {
  AI_PROVIDERS,
  DEFAULT_MAX_TOKENS,
  DEFAULT_LOCAL_TEMPERATURE,
  DEFAULT_LOCAL_REPETITION_PENALTY,
  DEFAULT_LOCAL_PRESENCE_PENALTY,
  DEFAULT_LOCAL_FREQUENCY_PENALTY,
  MODEL_SAMPLER_DEFAULTS,
  effectiveGeneration,
  defaultModelFor,
  defaultBaseUrlFor,
  connectionReady,
  isLocalProvider,
} from '@retired/ai-bridge';
export type { AiConnection, AiGenerationSettings, AiProviderId };

export interface AiPromptPreset {
  id: string;
  title: string;
  text: string;
  builtin?: boolean;     // ships with the app; only user copies are deletable
}

/** What rides on each assistant request. Unset = send (historical default).
 *  `personaLast` defaults on so a custom persona isn't drowned by later
 *  tool/rules text on small local models. */
export interface AiPromptSend {
  includePersona?: boolean;
  includePageLine?: boolean;
  includeToolInstructions?: boolean;
  includePromptCatalog?: boolean;
  includeProgramRules?: boolean;
  includeScenarioName?: boolean;
  includePlanDigest?: boolean;
  includeChatNote?: boolean;
  /** Advertise native function-calling tools to the provider. Off = empty
   *  tools array (the model still sees any tool-instruction text). */
  sendTools?: boolean;
  /** Put the persona AFTER mechanics so small models honor a custom override. */
  personaLast?: boolean;
}

export const DEFAULT_AI_PROMPT_SEND: Required<AiPromptSend> = {
  includePersona: true,
  includePageLine: true,
  includeToolInstructions: true,
  includePromptCatalog: true,
  includeProgramRules: true,
  includeScenarioName: true,
  includePlanDigest: true,
  includeChatNote: true,
  sendTools: true,
  personaLast: true,
};

export function resolveAiPromptSend(send?: AiPromptSend): Required<AiPromptSend> {
  return { ...DEFAULT_AI_PROMPT_SEND, ...send };
}

export interface AiSettings {
  connections: AiConnection[];
  activeConnectionId: string | null;
  prompts: AiPromptPreset[];
  /** User-edited replacement for the assistant's base persona prompt. When
   *  unset the built-in DEFAULT_SYSTEM_PROMPT (agentLoop) is used. */
  systemPromptOverride?: string;
  /** Replacement for the native-mode tool-instruction blurb. */
  toolInstructionsNative?: string;
  /** Replacement for the prompt-mode tool-instruction blurb. */
  toolInstructionsPrompt?: string;
  /** Replacement for the tools-off blurb. */
  toolInstructionsOff?: string;
  /** Per-piece send switches. Unset keys keep the default (send). */
  promptSend?: AiPromptSend;
  /** Per local-model tools override. Missing key = catalog default
   *  (`toolCapable` on WEBLLM_MODELS). `'on'` / `'off'` force the mode for
   *  testing without editing the catalog. Cloud connections ignore this. */
  toolCapableByModel?: Record<string, 'on' | 'off'>;
  /** Catalog keys (`local:<id>` or `<connectionId>:<model>`) the user put on
   *  the chat picker. The Models page lists everything in Local / Free / Remote
   *  dropdowns; only these show in the dock. */
  favoriteModels?: string[];
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

const promptSendSchema = z.object({
  includePersona: z.boolean().optional(),
  includePageLine: z.boolean().optional(),
  includeToolInstructions: z.boolean().optional(),
  includePromptCatalog: z.boolean().optional(),
  includeProgramRules: z.boolean().optional(),
  includeScenarioName: z.boolean().optional(),
  includePlanDigest: z.boolean().optional(),
  includeChatNote: z.boolean().optional(),
  sendTools: z.boolean().optional(),
  personaLast: z.boolean().optional(),
});

const settingsSchema = z.object({
  connections: z.array(connectionSchema),
  activeConnectionId: z.string().nullable(),
  prompts: z.array(promptSchema),
  systemPromptOverride: z.string().optional(),
  toolInstructionsNative: z.string().optional(),
  toolInstructionsPrompt: z.string().optional(),
  toolInstructionsOff: z.string().optional(),
  promptSend: promptSendSchema.optional(),
  toolCapableByModel: z.record(z.string(), z.enum(['on', 'off'])).optional(),
  favoriteModels: z.array(z.string()).optional(),
});

/** Catalog default unless the user forced this model on or off in Settings. */
export function resolveLocalToolCapable(
  catalogCapable: boolean | undefined,
  override: 'on' | 'off' | undefined,
): boolean {
  if (override === 'on') return true;
  if (override === 'off') return false;
  return catalogCapable ?? true;
}

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

// ---------------------------------------------------------------------------
// LIVE settings store
// ---------------------------------------------------------------------------
// AgentPage and ConnectionsPage used to each hold their own React copy of
// loadAiSettings(). Editing the persona in Settings would then fight the
// docked chat, and a backup restore would sit in localStorage until remount.
// One module-level store (same pattern as chatStore) is the source of truth.

let liveSettings: AiSettings = loadAiSettings();
let liveSettingsKV: KV = defaultKV();
const liveSettingsListeners = new Set<() => void>();

function emitAiSettings(): void {
  for (const l of liveSettingsListeners) l();
}

export function getAiSettings(): AiSettings {
  return liveSettings;
}

export function subscribeAiSettings(fn: () => void): () => void {
  liveSettingsListeners.add(fn);
  return () => { liveSettingsListeners.delete(fn); };
}

/** Replace the whole live store and persist. */
export function setAiSettings(next: AiSettings): void {
  liveSettings = next;
  saveAiSettings(liveSettings, liveSettingsKV);
  emitAiSettings();
}

/** Functional update (AgentPage / Connections / Settings all share this). */
export function updateAiSettings(mutate: (prev: AiSettings) => AiSettings): void {
  setAiSettings(mutate(liveSettings));
}

/** Reload from storage (backup restore writes the key then calls this). */
export function reloadAiSettingsFromStorage(kv: KV = liveSettingsKV): void {
  liveSettingsKV = kv;
  liveSettings = loadAiSettings(kv);
  emitAiSettings();
}

/** Test seam. */
export function resetAiSettingsForTests(kv: KV = memoryKV()): void {
  liveSettingsKV = kv;
  liveSettings = loadAiSettings(kv);
  emitAiSettings();
}
