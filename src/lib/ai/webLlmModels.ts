// Curated model list for the in-browser web-llm provider (@mlc-ai/web-llm).
//
// These run ENTIRELY on the user's GPU via WebGPU — no key, no network call at
// inference time, fully offline once the weights are cached. The weights come
// from MLC's public HuggingFace mirrors on first use (one multi-GB download,
// then cached in the browser's Cache API / IndexedDB / OPFS).
//
// The list is curated toward MATH AND REASONING models — the ones most useful
// for poking at a retirement projection — each labeled with its VRAM
// requirement so users pick what their GPU can actually hold. The full
// prebuilt catalog (60+ general-chat and vision models) stays available via
// the free-text model field; these are just the good defaults.

export interface WebLlmModelChoice {
  /** The prebuilt model_id from web-llm's prebuiltAppConfig. */
  id: string;
  /** Short display label. */
  label: string;
  /** VRAM needed at runtime, in MB (from web-llm's model metadata). */
  vramMB: number;
  /** Approximate one-time download size in GB (q4f16 weights ≈ params × 0.55);
   *  shown on the download button so users know what they're in for. */
  sizeGB: number;
  /** One-line "why this one" for the picker. */
  blurb: string;
}

export const WEBLLM_MODELS: WebLlmModelChoice[] = [
  // NOTE: the list is ordered best-first for a typical laptop GPU. The 1.5B
  // sits last deliberately — it fits anywhere but is too weak to follow the
  // tool protocol or stay grounded on a long interview, so it's a last resort.
  {
    id: 'Qwen3-4B-q4f16_1-MLC',
    label: 'Qwen3 4B (thinking)',
    vramMB: 3432,
    sizeGB: 2.5,
    blurb: 'Best balance of size and quality; has a reasoning mode. Recommended for most.',
  },
  {
    id: 'Ministral-3-3B-Reasoning-2512-q4f16_1-MLC',
    label: 'Ministral 3 3B Reasoning',
    vramMB: 2864,
    sizeGB: 2.1,
    blurb: 'Compact reasoning model, strong on multi-step arithmetic. Smaller download.',
  },
  {
    id: 'Qwen2.5-Math-7B-Instruct-q4f16_1-MLC',
    label: 'Qwen2.5 Math 7B',
    vramMB: 5107,
    sizeGB: 4.5,
    blurb: 'Strongest dedicated math model that fits a mid-range GPU.',
  },
  {
    id: 'DeepSeek-R1-Distill-Qwen-7B-q4f16_1-MLC',
    label: 'DeepSeek R1 Distill 7B',
    vramMB: 5107,
    sizeGB: 4.5,
    blurb: 'Thinks out loud (R1-style), then answers. Verbose but careful.',
  },
  {
    id: 'Qwen3-8B-q4f16_1-MLC',
    label: 'Qwen3 8B (thinking)',
    vramMB: 5696,
    sizeGB: 5.0,
    blurb: 'Biggest thinking Qwen most GPUs can hold; needs ~6 GB free VRAM.',
  },
  {
    id: 'WizardMath-7B-V1.1-q4f16_1-MLC',
    label: 'WizardMath 7B',
    vramMB: 4573,
    sizeGB: 4.0,
    blurb: 'Classic math-tuned Llama; requires shader-f16 support.',
  },
  {
    id: 'Qwen2.5-Math-1.5B-Instruct-q4f16_1-MLC',
    label: 'Qwen2.5 Math 1.5B',
    vramMB: 1630,
    sizeGB: 1.2,
    blurb: 'Fits almost any GPU, but too weak to use tools reliably or stay on track — avoid unless nothing else runs.',
  },
];

/** True when the browser can attempt WebGPU inference at all. */
export function webGpuAvailable(): boolean {
  try {
    return typeof navigator !== 'undefined' && 'gpu' in navigator;
  } catch {
    return false;
  }
}

/** Human-readable size for the picker. */
export function fmtVram(mb: number): string {
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB VRAM` : `${mb} MB VRAM`;
}

/** Human-readable download size ("2.5 GB"). */
export function fmtSize(gb: number): string {
  return `${gb.toFixed(1)} GB`;
}
