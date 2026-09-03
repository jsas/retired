/**
 * The built-in model registry: in-browser WebGPU (local, keyless, offline once
 * weights are cached) plus remote BYO-key presets. This is the single source of
 * truth for "which models can I pick" shared by the web assistant and the
 * markup assistant. Users can layer saved connections on top via
 * `createBridge({ extraModels })`.
 *
 * WebGPU entries mirror the app's curated `webLlmModels.ts` catalog (verified
 * MLC prebuilds, ordered best-first). Remote entries are sensible defaults per
 * provider — they carry no key (BYO at selection time) so they're inert until
 * configured.
 */

import type { ModelSpec } from './types.js'

export const BUILTIN_MODELS: ModelSpec[] = [
  // ---- Local WebGPU (in-browser, keyless) -------------------------------
  {
    id: 'local:qwen3.5-4b',
    label: 'Qwen3.5 4B (local)',
    provider: 'webllm',
    model: 'Qwen3.5-4B-q4f16_1-MLC',
    local: true,
    requiresKey: false,
    toolCapable: true,
    contextSize: 32768,
    options: { temperature: 0.3, maxTokens: 4096 },
    blurb: 'Newest all-rounder; strongest instruction-following in this size. Recommended.',
    recommended: true,
  },
  {
    id: 'local:qwen3-4b-thinking',
    label: 'Qwen3 4B thinking (local)',
    provider: 'webllm',
    model: 'Qwen3-4B-q4f16_1-MLC',
    local: true,
    requiresKey: false,
    toolCapable: true,
    contextSize: 32768,
    options: { temperature: 0.3, maxTokens: 4096 },
    blurb: 'Reasoning mode for multi-step math; a touch smaller download than 3.5.',
  },
  {
    id: 'local:phi4-mini',
    label: 'Phi-4 Mini 3.8B (local)',
    provider: 'webllm',
    model: 'Phi-4-mini-instruct-q4f16_1-MLC',
    local: true,
    requiresKey: false,
    toolCapable: true,
    contextSize: 16384,
    options: { temperature: 0.3, maxTokens: 4096, repetitionPenalty: 1.15, presencePenalty: 0.3 },
    blurb: "Microsoft's small instruct model; reliable at following formats.",
  },
  {
    id: 'local:qwen3.5-9b',
    label: 'Qwen3.5 9B (local)',
    provider: 'webllm',
    model: 'Qwen3.5-9B-q4f16_1-MLC',
    local: true,
    requiresKey: false,
    toolCapable: true,
    contextSize: 32768,
    options: { temperature: 0.3, maxTokens: 4096 },
    blurb: 'Strongest local model, for GPUs with 8 GB+. Largest download.',
  },

  // ---- Remote (BYO key) --------------------------------------------------
  {
    id: 'remote:claude-sonnet',
    label: 'Claude Sonnet',
    provider: 'anthropic',
    model: 'claude-sonnet-4-20250514',
    local: false,
    requiresKey: true,
    toolCapable: true,
    contextSize: 200000,
    options: { temperature: 0, maxTokens: 8192 },
    blurb: 'Anthropic flagship; strong vision for markup-image interpretation.',
  },
  {
    id: 'remote:gpt-4o-mini',
    label: 'GPT-4o mini',
    provider: 'openai',
    model: 'gpt-4o-mini',
    local: false,
    requiresKey: true,
    toolCapable: true,
    contextSize: 128000,
    options: { temperature: 0, maxTokens: 8192 },
    baseUrl: 'https://api.openai.com/v1',
    blurb: 'Cheap, fast OpenAI default with vision.',
  },
  {
    id: 'remote:gemini-flash',
    label: 'Gemini 2.0 Flash',
    provider: 'gemini',
    model: 'gemini-2.0-flash',
    local: false,
    requiresKey: true,
    toolCapable: true,
    contextSize: 1000000,
    options: { temperature: 0, maxTokens: 8192 },
    blurb: 'Google fast multimodal model; huge context.',
  },
  {
    id: 'remote:ollama-llama3.1',
    label: 'Llama 3.1 (Ollama)',
    provider: 'ollama',
    model: 'llama3.1',
    local: false,
    requiresKey: false,
    toolCapable: true,
    contextSize: 8192,
    options: { temperature: 0, maxTokens: 4096 },
    baseUrl: 'http://localhost:11434/v1',
    blurb: 'Self-hosted via a local Ollama daemon; no key.',
  },
]
