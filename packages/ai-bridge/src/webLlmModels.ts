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
// Curated from a 20-q protocol bake-off (production TOOL_CALL: prompt).
// Five speakers that actually emit the protocol, plus Bonsai on a different
// runtime. Qwen3.5 4B stays the default (best fit of tools + VRAM). Auto
// loads every pack at 32k and backs off on OOM — MLC's 4096 is only the
// KV-cache default, not a compiled ceiling (a manual 32k window works).
// Dumped: SmolLM, Gemma 2B, both Ministrals, Hermes 2 Pro, both R1 distills,
// WizardMath, Qwen3.5 9B (not baked). Anything else stays on the free-text field.

export interface WebLlmModelChoice {
  /** The prebuilt model_id from web-llm's prebuiltAppConfig. For a `custom`
   *  entry this is just the registry key — the engine looks it up in the custom
   *  appConfig the provider builds, not in web-llm's prebuilt list. */
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
  /** Present for NON-prebuilt models — a fine-tune served from our own URL
   *  rather than MLC's HuggingFace mirror. `weightsUrl` is the directory holding
   *  mlc-chat-config.json + params_shard_*.bin (relative to the app origin);
   *  `modelLib` is the MLC wasm to run it on (usually the matching prebuilt
   *  lib for the base architecture + quantization). When set, the provider
   *  builds a custom appConfig instead of relying on prebuiltAppConfig. */
  custom?: {
    weightsUrl: string;
    /** wasm filename, e.g. 'Qwen3-0.6B-q4f16_1_cs1k-webgpu.wasm' — resolved
     *  against web-llm's modelLibURLPrefix + modelVersion at load time. */
    modelLib: string;
  };
  /** True for entries whose weights only exist on a DEVELOPMENT machine
   *  (served from public/models/ by the dev server, never deployed). Excluded
   *  from the machine-guide recommendation; the Connections page shows a
   *  "weights not on this server" hint instead of a Download button when the
   *  folder isn't being served. */
  localDevOnly?: boolean;
}

export const WEBLLM_MODELS: WebLlmModelChoice[] = [
  // Default first so the machine guide / picker land here. Then the small
  // 3B, then the 7B/8B upgrades. Tiny 1-bit lives in BONSAI_MODELS.
  {
    id: 'Qwen3.5-4B-q4f16_1-MLC',
    label: 'Qwen3.5 4B',
    vramMB: 3868,
    sizeGB: 2.8,
    toolCapable: true,
    maxWindow: 32768,
    blurb: 'Default. Tools + a full plan in context, on most laptop GPUs.',
  },
  {
    id: 'Llama-3.2-3B-Instruct-q4f16_1-MLC',
    label: 'Llama 3.2 3B',
    vramMB: 2264,
    sizeGB: 1.7,
    toolCapable: true,
    maxWindow: 32768,
    blurb: 'Smaller download. Fine for questions on most laptops.',
  },
  {
    id: 'Mistral-7B-Instruct-v0.3-q4f16_1-MLC',
    label: 'Mistral 7B Instruct',
    vramMB: 4573,
    sizeGB: 4.0,
    toolCapable: true,
    maxWindow: 32768,
    blurb: 'Larger instruct model. Needs ~4.5 GB VRAM.',
  },
  {
    id: 'Qwen3-8B-q4f16_1-MLC',
    label: 'Qwen3 8B',
    vramMB: 5696,
    sizeGB: 5.0,
    toolCapable: true,
    maxWindow: 32768,
    blurb: 'Larger Qwen with thinking. Needs ~6 GB free VRAM.',
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

/** Approximate disk used by cached catalog rows. Cache API bytes aren't
 *  cheap to sum (every response blob), so we add the same sizeGB the picker
 *  already shows. Rows without a size (unlisted extras) contribute 0. */
export function sumCachedSizeGB(
  rows: Array<{ id: string; sizeGB?: number }>,
  cached: Record<string, boolean>,
): number {
  let n = 0;
  for (const row of rows) {
    if (cached[row.id] && row.sizeGB) n += row.sizeGB;
  }
  return n;
}
