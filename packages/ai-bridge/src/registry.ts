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
    blurb: 'Default. Tools + a full plan in context, on most laptop GPUs.',
    recommended: true,
  },
  {
    id: 'local:llama-3.2-3b',
    label: 'Llama 3.2 3B (local)',
    provider: 'webllm',
    model: 'Llama-3.2-3B-Instruct-q4f16_1-MLC',
    local: true,
    requiresKey: false,
    toolCapable: true,
    contextSize: 32768,
    options: { temperature: 0.3, maxTokens: 2048 },
    blurb: 'Smaller download. Fine for questions on most laptops.',
  },
  {
    id: 'local:mistral-7b',
    label: 'Mistral 7B Instruct (local)',
    provider: 'webllm',
    model: 'Mistral-7B-Instruct-v0.3-q4f16_1-MLC',
    local: true,
    requiresKey: false,
    toolCapable: true,
    contextSize: 32768,
    options: { temperature: 0.3, maxTokens: 2048 },
    blurb: 'Larger instruct model. Needs ~4.5 GB VRAM.',
  },
  {
    id: 'local:qwen3-8b',
    label: 'Qwen3 8B (local)',
    provider: 'webllm',
    model: 'Qwen3-8B-q4f16_1-MLC',
    local: true,
    requiresKey: false,
    toolCapable: true,
    contextSize: 32768,
    options: { temperature: 0.3, maxTokens: 4096 },
    blurb: 'Larger Qwen with thinking. Needs ~6 GB free VRAM.',
  },
  {
    id: 'local:bonsai-1.7b',
    label: 'Bonsai 1.7B (1-bit, local)',
    provider: 'bonsai',
    model: 'onnx-community/Bonsai-1.7B-ONNX',
    local: true,
    requiresKey: false,
    toolCapable: false,
    contextSize: 32768,
    options: { temperature: 0.3, maxTokens: 2048 },
    blurb: 'Tiny 1-bit download. Questions only — pick the 4B for plan tools.',
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
