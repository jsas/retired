// Curated model list for the in-browser web-llm provider (@mlc-ai/web-llm).
//
// These run ENTIRELY on the user's GPU via WebGPU — no key, no network call at
// inference time, fully offline once the weights are cached. The weights come
// from MLC's public HuggingFace mirrors on first use (one multi-GB download,
// then cached in the browser's Cache API / IndexedDB / OPFS).
//
// Every id below is a verified MLC PREBUILD (present in web-llm's
// prebuiltAppConfig) — a model that isn't MLC-compiled will not load. The
// LiteRT/MediaPipe collections (litert-community Gemma etc.) are a DIFFERENT
// runtime and are intentionally absent here.
//
// The list is curated toward INSTRUCT/REASONING models that can follow the
// tool protocol and stay grounded on a retirement projection, ordered
// best-first for a typical laptop GPU. VRAM figures come straight from
// web-llm's own metadata. The full prebuilt catalog (160+ general-chat and
// vision models) stays available via the free-text model field; these are
// just the good defaults.

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
  /** Can this model drive the assistant's tool protocol (read the plan, call
   *  run_projection, propose edits)? Small models mangle the fenced-JSON tool
   *  calls, so they're forced into a tools-off "answer questions only" mode. */
  toolCapable: boolean;
  /** The largest context window (tokens) this build is compiled to run —
   *  its architectural ceiling, NOT the 4096 KV-cache default web-llm ships
   *  with. Auto mode loads the engine at this size and backs off on OOM; the
   *  model's weights are the same either way, so a bigger window only costs
   *  KV-cache memory, never quality. */
  maxWindow: number;
  /** One-line "why this one" for the picker. */
  blurb: string;
}

export const WEBLLM_MODELS: WebLlmModelChoice[] = [
  // NOTE: ordered best-first for a typical laptop GPU. Small ≠ good here —
  // the weakest models can't follow the tool protocol, so the list starts at
  // models that actually work and only goes down to genuinely usable ones.
  {
    id: 'Qwen3.5-4B-q4f16_1-MLC',
    label: 'Qwen3.5 4B',
    vramMB: 3868,
    sizeGB: 2.8,
    toolCapable: true,
    maxWindow: 32768,
    blurb: 'Newest all-rounder; strongest instruction-following in this size. Recommended for most.',
  },
  {
    id: 'Qwen3-4B-q4f16_1-MLC',
    label: 'Qwen3 4B (thinking)',
    vramMB: 3432,
    sizeGB: 2.5,
    toolCapable: true,
    maxWindow: 32768,
    blurb: 'Reasoning mode for multi-step math; a touch smaller download than 3.5.',
  },
  {
    id: 'Phi-4-mini-instruct-q4f16_1-MLC',
    label: 'Phi-4 Mini 3.8B',
    vramMB: 3438,
    sizeGB: 2.5,
    toolCapable: true,
    maxWindow: 16384,
    // Loop-prone: see MODEL_SAMPLER_DEFAULTS in aiSettings for its stronger
    // anti-repeat profile (diverse word-salad is its failure mode).
    blurb: 'Microsoft\'s small instruct model; reliable at following formats.',
  },
  {
    id: 'Qwen3-8B-q4f16_1-MLC',
    label: 'Qwen3 8B (thinking)',
    vramMB: 5696,
    sizeGB: 5.0,
    toolCapable: true,
    maxWindow: 32768,
    blurb: 'Biggest thinking Qwen most GPUs can hold; needs ~6 GB free VRAM.',
  },
  {
    id: 'Qwen3.5-9B-q4f16_1-MLC',
    label: 'Qwen3.5 9B',
    vramMB: 6433,
    sizeGB: 5.7,
    toolCapable: true,
    maxWindow: 32768,
    blurb: 'Strongest model in the list, for GPUs with 8 GB+. Largest download.',
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
