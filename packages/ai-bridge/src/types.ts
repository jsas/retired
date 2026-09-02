/**
 * Shared model-spec types for the ai-bridge registry. The streaming chat types
 * (StreamEvent, ToolSpec, ChatMessage, StreamChatRequest) live in
 * providers.ts and are re-exported from the package index — the bridge owns
 * the provider stack, so there is one canonical definition.
 */

import type { AiProviderId } from './connections.js'

/** Generation tuning for a model. All optional — the bridge fills defaults. */
export interface ModelOptions {
  maxTokens?: number
  temperature?: number
  repetitionPenalty?: number
  presencePenalty?: number
  frequencyPenalty?: number
}

/** A model the bridge can select: its provider, the provider's own model id,
 *  connection details, and default options. */
export interface ModelSpec {
  /** Bridge-unique id (e.g. "local:qwen3.5-4b", "remote:claude-sonnet", "conn:<id>"). */
  id: string
  /** Display label for pickers. */
  label: string
  provider: AiProviderId
  /** The id passed to the provider's API / web-llm (e.g. "Qwen3.5-4B-q4f16_1-MLC"). */
  model: string
  /** True for in-browser WebGPU models (no key, offline after weight cache). */
  local: boolean
  /** Whether this provider needs an API key (false for webllm/ollama). */
  requiresKey: boolean
  /** BYO key for remote providers. Empty for keyless local ones. */
  apiKey?: string
  /** Endpoint override for OpenAI-compatible / Ollama providers. */
  baseUrl?: string
  /** Context window in tokens, for budgeting + compaction. */
  contextSize?: number
  /** Can this model drive a tool protocol? Small models can't. */
  toolCapable: boolean
  /** Default generation options. */
  options?: ModelOptions
  /** One-line "why this one" for pickers. */
  blurb?: string
  /** Marks the registry's headline recommendation. */
  recommended?: boolean
}

/** A ModelSpec with defaults resolved (maxTokens/temperature always set). */
export interface ResolvedModel extends ModelSpec {
  options: Required<Pick<ModelOptions, 'maxTokens' | 'temperature'>> & ModelOptions
}
