// Plain-JS mirror of the bake-off candidate list, so the dependency-free .mjs
// driver can read it without importing TS. The single source of truth for the
// RATIONALE + thresholds stays in training/bakeoff.ts; this mirrors just the
// fields the driver needs (modelId, label, sizeGB) in the same smallest-first
// order. If bakeoff.ts's redistributable set changes, update this to match.

export const CANDIDATES_SMALLEST_FIRST = [
  // Non-thinkers first (smallest to largest), then thinkers (smallest to
  // largest). Pruned: Qwen2.5-0.5B (0% both modes) and SmolLM2 (variant that
  // only added redundancy). Qwen2.5-1.5B is the one non-thinker still in.
  { modelId: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC', label: 'Qwen2.5 1.5B', sizeGB: 0.9, think: false },
  { modelId: 'Qwen3-0.6B-q4f16_1-MLC', label: 'Qwen3 0.6B', sizeGB: 0.4, think: true },
  { modelId: 'Qwen3.5-0.8B-q4f16_1-MLC', label: 'Qwen3.5 0.8B', sizeGB: 0.5, think: true },
  { modelId: 'Qwen3-1.7B-q4f16_1-MLC', label: 'Qwen3 1.7B', sizeGB: 1.0, think: true },
  { modelId: 'Qwen3.5-2B-q4f16_1-MLC', label: 'Qwen3.5 2B', sizeGB: 1.2, think: true },
];
