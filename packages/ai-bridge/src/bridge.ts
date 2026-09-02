/**
 * @retired/ai-bridge — the shared model-selection + chat surface.
 *
 * One configured entry point for "talk to a model" that BOTH the web app's
 * assistant and the markup assistant (and any future consumer) use, so model
 * selection and generation options live in one place instead of each feature
 * hard-coding a provider. The registry lists the built-in models — in-browser
 * WebGPU (local, keyless, offline) and remote (BYO-key) — and the caller's
 * saved connections fold in alongside them.
 *
 * The bridge OWNS the provider stack (providers.ts, webLlmProvider.ts,
 * webLlmModels.ts live in this package). There is no injected chat fn:
 * `bridge.streamChat(request)` streams events straight from the selected
 * model, and `bridge.chat(request)` is the request/response convenience for
 * one-shot turns (the markup engine uses it). Connections come in as config —
 * the app passes its saved AiConnections; nothing here touches storage.
 */

import type {
  AiConnection,
} from './connections.js'
import { connectionReady } from './connections.js'
import {
  streamChat as providerStreamChat,
  type AgentToolCall,
  type ChatMessage,
  type StreamChatRequest,
  type StreamEvent,
  type ToolSpec,
} from './providers.js'
import type { ModelSpec, ResolvedModel } from './types.js'
import { BUILTIN_MODELS } from './registry.js'

export interface BridgeOptions {
  /** Saved connections to offer alongside the built-in registry. Each becomes
   *  a selectable model (`conn:<id>`), carrying its key/baseUrl/tuning. */
  connections?: AiConnection[]
  /** Model id (built-in or `conn:<id>`) selected up front. Falls back to the
   *  first ready connection, else the registry recommendation. */
  defaultModelId?: string
}

export interface Bridge {
  /** Every selectable model (built-in + one per connection). */
  models(): ModelSpec[]
  /** Look up one model by id, or undefined. */
  model(id: string): ModelSpec | undefined
  /** The currently selected model. */
  selected(): ResolvedModel
  /** Select a model by id. Throws when unknown. */
  select(id: string): ResolvedModel
  /** The selected model's backing connection (for streaming + tuning). */
  connection(): AiConnection
  /** True when the selected model is ready to attempt a call. */
  ready(): boolean
  /** Stream a turn from the selected model (the agent loop uses this). */
  streamChat(req: Omit<StreamChatRequest, never>): AsyncGenerator<StreamEvent>
  /** One-shot chat: accumulate the stream into a single reply. */
  chat(req: { system?: string; messages: ChatMessage[]; signal?: AbortSignal }): Promise<{ text: string; stopReason?: string }>
}

/** A built-in registry model is self-describing (its provider + model id are
 *  the connection); a `conn:` model wraps a saved AiConnection. */
function specToConnection(spec: ModelSpec, connections: Map<string, AiConnection>): AiConnection {
  if (spec.id.startsWith('conn:')) {
    const conn = connections.get(spec.id.slice(5))
    if (conn) return conn
  }
  return {
    id: spec.id,
    provider: spec.provider,
    label: spec.label,
    apiKey: spec.apiKey ?? '',
    model: spec.model,
    baseUrl: spec.baseUrl,
    contextSize: spec.contextSize,
    generation: spec.options
      ? { maxTokens: spec.options.maxTokens, temperature: spec.options.temperature }
      : undefined,
  }
}

export function createBridge(options: BridgeOptions = {}): Bridge {
  const connections = new Map<string, AiConnection>()
  for (const c of options.connections ?? []) connections.set(c.id, c)

  const models = new Map<string, ModelSpec>()
  for (const m of BUILTIN_MODELS) models.set(m.id, m)
  for (const c of options.connections ?? []) {
    models.set(`conn:${c.id}`, {
      id: `conn:${c.id}`,
      label: c.label || c.model,
      provider: c.provider,
      model: c.model,
      local: c.provider === 'webllm',
      requiresKey: c.provider !== 'webllm' && c.provider !== 'ollama',
      apiKey: c.apiKey,
      baseUrl: c.baseUrl,
      contextSize: c.contextSize,
      toolCapable: true,
      options: c.generation
        ? { maxTokens: c.generation.maxTokens, temperature: c.generation.temperature }
        : undefined,
    })
  }

  const recommended = BUILTIN_MODELS.find((m) => m.recommended) ?? BUILTIN_MODELS[0]
  let currentId: string = options.defaultModelId ?? ''
  if (!currentId || !models.has(currentId)) {
    // Prefer a ready saved connection, else the registry recommendation.
    const readyConn = (options.connections ?? []).find((c) => connectionReady(c))
    currentId = readyConn ? `conn:${readyConn.id}` : (recommended?.id ?? '')
  }
  if (!currentId || !models.has(currentId)) {
    throw new Error('ai-bridge: no selectable model (empty registry)')
  }

  function selectedSpec(): ModelSpec {
    return models.get(currentId)!
  }

  function resolve(spec: ModelSpec): ResolvedModel {
    return {
      ...spec,
      options: {
        maxTokens: spec.options?.maxTokens ?? 4096,
        temperature: spec.options?.temperature ?? (spec.provider === 'webllm' ? 0.3 : 0),
      },
    }
  }

  function conn(): AiConnection {
    return specToConnection(selectedSpec(), connections)
  }

  return {
    models: () => [...models.values()],
    model: (id) => models.get(id),
    selected: () => resolve(selectedSpec()),
    select(id) {
      const spec = models.get(id)
      if (!spec) throw new Error(`ai-bridge: unknown model "${id}"`)
      currentId = id
      return resolve(spec)
    },
    connection: conn,
    ready: () => connectionReady(conn()),
    streamChat(req) {
      const c = conn()
      if (!connectionReady(c)) {
        throw new Error(`ai-bridge: model "${selectedSpec().id}" is not ready (missing key or URL)`)
      }
      return providerStreamChat(c, req as StreamChatRequest)
    },
    async chat(req) {
      let text = ''
      let stopReason: string | undefined
      for await (const ev of this.streamChat({
        system: req.system ?? '',
        messages: req.messages,
        tools: [],
        signal: req.signal,
      })) {
        if (ev.type === 'text') text += ev.text
        else if (ev.type === 'done') stopReason = ev.stopReason
      }
      return { text, stopReason }
    },
  }
}

export type { AgentToolCall, ChatMessage, StreamEvent, ToolSpec }
