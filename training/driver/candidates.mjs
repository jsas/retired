// Plain-JS mirror of the bake-off candidate list, so the dependency-free .mjs
// driver can read it without importing TS. The single source of truth for the
// RATIONALE + thresholds stays in training/bakeoff.ts; this mirrors just the
// fields the driver needs (modelId, label, sizeGB) in the same smallest-first
// order. If bakeoff.ts's redistributable set changes, update this to match.

export const CANDIDATES_SMALLEST_FIRST = [
  { modelId: 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC', label: 'Qwen2.5 0.5B', sizeGB: 0.3 },
  { modelId: 'Qwen3-0.6B-q4f16_1-MLC', label: 'Qwen3 0.6B', sizeGB: 0.4 },
  { modelId: 'Qwen3.5-0.8B-q4f16_1-MLC', label: 'Qwen3.5 0.8B', sizeGB: 0.5 },
  { modelId: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC', label: 'Qwen2.5 1.5B', sizeGB: 0.9 },
  { modelId: 'Qwen3-1.7B-q4f16_1-MLC', label: 'Qwen3 1.7B', sizeGB: 1.0 },
  { modelId: 'SmolLM2-1.7B-Instruct-q4f16_1-MLC', label: 'SmolLM2 1.7B', sizeGB: 1.0 },
  { modelId: 'Qwen3.5-2B-q4f16_1-MLC', label: 'Qwen3.5 2B', sizeGB: 1.2 },
];

/** One pack per dropped family, plus the Qwen3.5 4B control. Protocol-validity
 *  bake-off — not a 4k-vs-32k test (the gate questions are short). Control first
 *  so a later OOM still leaves a baseline. Then smallest-first among the rest.
 *
 *  Dumped after the first 20-q pass (0–15% protocol, or GPU-killing):
 *  SmolLM2 1.7B, Gemma 2 2B, Ministral 3B Instruct, Ministral 3B Reasoning.
 *  WizardMath 7B dumped without a run — math SFT, not a chat/tool pack. */
export const FAMILY_CANDIDATES = [
  { modelId: 'Qwen3.5-4B-q4f16_1-MLC', label: 'Qwen3.5 4B (control)', sizeGB: 2.8 },
  { modelId: 'Llama-3.2-3B-Instruct-q4f16_1-MLC', label: 'Llama 3.2 3B', sizeGB: 1.7 },
  { modelId: 'Hermes-3-Llama-3.2-3B-q4f16_1-MLC', label: 'Hermes 3 Llama 3.2 3B', sizeGB: 1.7 },
  { modelId: 'Mistral-7B-Instruct-v0.3-q4f16_1-MLC', label: 'Mistral 7B Instruct', sizeGB: 4.0 },
  { modelId: 'Hermes-2-Pro-Mistral-7B-q4f16_1-MLC', label: 'Hermes 2 Pro Mistral 7B', sizeGB: 4.0 },
  { modelId: 'DeepSeek-R1-Distill-Qwen-7B-q4f16_1-MLC', label: 'DeepSeek R1 Distill Qwen 7B', sizeGB: 4.0 },
  { modelId: 'Llama-3.1-8B-Instruct-q4f16_1-MLC', label: 'Llama 3.1 8B', sizeGB: 4.5 },
  { modelId: 'DeepSeek-R1-Distill-Llama-8B-q4f16_1-MLC', label: 'DeepSeek R1 Distill Llama 8B', sizeGB: 4.5 },
  { modelId: 'gemma-2-9b-it-q4f16_1-MLC', label: 'Gemma 2 9B', sizeGB: 5.5 },
];
