/**
 * Environment-driven configuration for the dev markup loop. Everything the
 * dev overlay + proxy engine needs is read from `MARKUP_*` variables so the
 * whole loop is tunable from a local `.env` without touching code — and the
 * secrets (the model API key) never enter the client bundle, because this is
 * only ever evaluated in the vite dev server (node), not shipped to the page.
 *
 * Recognized variables (all optional except ENDPOINT to go live):
 *   MARKUP_MODEL_ENDPOINT   OpenAI-compatible chat-completions URL.
 *                           Unset -> the dev overlay stays off entirely.
 *   MARKUP_MODEL_API_KEY    Bearer token for the endpoint (server-side only).
 *   MARKUP_MODEL            model name sent in the request body.
 *   MARKUP_MODEL_VISION     '1'/'true' -> attach the captured image (needs a
 *                           vision-capable model); otherwise text-only.
 *   MARKUP_SYSTEM_PROMPT    override the engine's system prompt.
 *   MARKUP_AUTO_APPLY       '1'/'true' (default) -> write source edits to disk
 *                           as soon as the model returns them; anything else
 *                           holds them (a confirm step can gate them later).
 *   MARKUP_HOTKEY           activation chord, e.g. 'ctrl+shift+m' (default),
 *                           'ctrl+shift+k', 'alt+m'. Modifier names: ctrl,
 *                           shift, alt, meta. The last token is the key.
 *   MARKUP_DOM_SNAPSHOT     '1'/'true' (default) -> include a serialized DOM
 *                           snapshot as model context; '0'/'false' to omit.
 */
import { OpenAIEngine } from './openai.js'
import type { Engine } from './engine.js'
import type { Hotkey } from '../core/protocol.js'

export interface MarkupEnvConfig {
  endpoint?: string
  apiKey?: string
  model?: string
  vision: boolean
  systemPrompt?: string
  autoApply: boolean
  hotkey: Hotkey
  domSnapshot: boolean
}

type EnvLike = Record<string, string | undefined>

function truthy(v: string | undefined): boolean {
  return v === '1' || v === 'true' || v === 'yes'
}

function falsy(v: string | undefined): boolean {
  return v === '0' || v === 'false' || v === 'no'
}

/** Parse 'ctrl+shift+m' into a Hotkey. Unrecognized modifiers are ignored. */
export function parseHotkey(spec: string | undefined): Hotkey {
  const fallback: Hotkey = { ctrl: true, shift: true, meta: false, key: 'm' }
  if (!spec) return fallback
  const parts = spec.toLowerCase().split('+').map((p) => p.trim()).filter(Boolean)
  if (parts.length === 0) return fallback
  const key = parts[parts.length - 1] ?? fallback.key
  return {
    ctrl: parts.includes('ctrl'),
    shift: parts.includes('shift'),
    meta: parts.includes('meta') || parts.includes('cmd'),
    key,
  }
}

export function readMarkupEnv(env: EnvLike): MarkupEnvConfig {
  return {
    endpoint: env.MARKUP_MODEL_ENDPOINT || undefined,
    apiKey: env.MARKUP_MODEL_API_KEY || undefined,
    model: env.MARKUP_MODEL || undefined,
    vision: truthy(env.MARKUP_MODEL_VISION),
    systemPrompt: env.MARKUP_SYSTEM_PROMPT || undefined,
    // Auto-apply defaults ON in dev: the mark -> snap -> send -> reload loop is
    // fastest when the edit lands without a click. Set MARKUP_AUTO_APPLY=0 to
    // hold edits for review instead.
    autoApply: !falsy(env.MARKUP_AUTO_APPLY),
    hotkey: parseHotkey(env.MARKUP_HOTKEY),
    domSnapshot: !falsy(env.MARKUP_DOM_SNAPSHOT),
  }
}

/** True only when an endpoint is configured — the live loop's on/off switch. */
export function markupEnvEnabled(env: EnvLike): boolean {
  return typeof env.MARKUP_MODEL_ENDPOINT === 'string' && env.MARKUP_MODEL_ENDPOINT.length > 0
}

/**
 * Build the live engine from env. Returns null when no endpoint is set so the
 * caller can keep the dev server fully offline (or skip mounting the overlay).
 * The engine is constructed lazily — importing this module never touches the
 * network or throws on a missing key.
 */
export function openaiEngineFromEnv(env: EnvLike): Engine | null {
  const cfg = readMarkupEnv(env)
  if (!cfg.endpoint || !cfg.model) return null
  return new OpenAIEngine({
    endpoint: cfg.endpoint,
    model: cfg.model,
    apiKey: cfg.apiKey,
    systemPrompt: cfg.systemPrompt,
    // Vision gating happens at message-build time inside the engine via the
    // screenshot it receives; the overlay only attaches an image when the
    // capability is on, so a text-only endpoint never gets one.
  })
}
