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
// The list is a slice of chat.webllm.ai's settings catalog: instruct /
// reasoning chat prebuilds a laptop GPU can actually hold. VRAM figures
// come from web-llm's own metadata. Sub-4B stays questions-only so the
// machine guide still recommends a 4B that can drive plan tools. Phi-4
// is omitted on purpose. 70B-class packs are omitted (they won't fit).
// Anything else in the 160+ prebuilt catalog stays available via the
// free-text model field.

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
  // NOTE: ordered best-first for a typical laptop GPU. Small ≠ good here —
  // the weakest models can't follow the tool protocol, so the list starts at
  // models that actually work and only goes down to genuinely usable ones.
  {
    // EXPERIMENTAL LOCAL FINE-TUNE (issue #112/#135): Qwen3-0.6B SFT'd on the
    // app's own tool-protocol corpus, quantized to q4f16_1. Weights are served
    // from the dev server's /models/ dir (a symlink to training/dist/…), NOT
    // from HuggingFace — this entry only loads when running locally with the
    // weights symlinked into public/models/. It reuses the prebuilt Qwen3-0.6B
    // q4f16 wasm. Tiny + tool-trained: the candidate for a sub-GB on-device
    // assistant. toolCapable reflects its 66.6% protocol-validity gate score —
    // it speaks the protocol but still mis-chooses tools ~1/3 of the time.
    id: 'retired-qwen3-0.6b-ft-q4f16_1',
    label: 'RE:tired 0.6B (local fine-tune)',
    vramMB: 700,
    sizeGB: 0.34,
    toolCapable: true,
    maxWindow: 8192,
    blurb: 'Our own 0.6B fine-tune on the app\'s tool protocol — tiny, local, experimental. Weights live in public/models/ on a dev machine only.',
    // Weights are never deployed — a production visitor can't download this.
    localDevOnly: true,
    custom: {
      weightsUrl: 'models/qwen3-0.6b-ft-q4f16_1-MLC',
      modelLib: 'Qwen3-0.6B-q4f16_1_cs1k-webgpu.wasm',
    },
  },
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
  {
    id: 'Qwen3.5-2B-q4f16_1-MLC',
    label: 'Qwen3.5 2B',
    vramMB: 2245,
    sizeGB: 1.3,
    toolCapable: false,
    maxWindow: 4096,
    blurb: 'Smaller Qwen3.5 — short questions. Compiled at 4096 tokens, so a full plan summary often will not fit; pick the 4B for that.',
  },
  {
    id: 'Qwen2.5-7B-Instruct-q4f16_1-MLC',
    label: 'Qwen2.5 7B',
    vramMB: 5107,
    sizeGB: 4.0,
    toolCapable: true,
    maxWindow: 4096,
    blurb: 'Previous-gen Qwen instruct. Solid tools if 3.5 8B/9B is too big.',
  },
  {
    id: 'Qwen2.5-Math-1.5B-Instruct-q4f16_1-MLC',
    label: 'Qwen2.5 Math 1.5B',
    vramMB: 1630,
    sizeGB: 0.9,
    toolCapable: false,
    maxWindow: 4096,
    blurb: 'Tiny math specialist. Questions only — not for plan tools.',
  },
  {
    id: 'Llama-3.2-3B-Instruct-q4f16_1-MLC',
    label: 'Llama 3.2 3B',
    vramMB: 2264,
    sizeGB: 1.7,
    toolCapable: false,
    maxWindow: 4096,
    blurb: 'Compact Llama instruct. Questions only — pick a 4B for tools.',
  },
  {
    id: 'Llama-3.1-8B-Instruct-q4f16_1-MLC',
    label: 'Llama 3.1 8B',
    vramMB: 5001,
    sizeGB: 4.5,
    toolCapable: true,
    maxWindow: 4096,
    blurb: 'Full-size Llama instruct. Needs ~5 GB VRAM.',
  },
  {
    id: 'Hermes-3-Llama-3.2-3B-q4f16_1-MLC',
    label: 'Hermes 3 Llama 3.2 3B',
    vramMB: 2264,
    sizeGB: 1.7,
    toolCapable: false,
    maxWindow: 4096,
    blurb: 'Nous Hermes on Llama 3.2 3B. Chat-first; too small for plan tools.',
  },
  {
    id: 'DeepSeek-R1-Distill-Qwen-7B-q4f16_1-MLC',
    label: 'DeepSeek R1 Distill Qwen 7B',
    vramMB: 5107,
    sizeGB: 4.0,
    toolCapable: true,
    maxWindow: 4096,
    blurb: 'R1 reasoning distilled onto Qwen 7B. Thinks out loud; needs ~5 GB.',
  },
  {
    id: 'DeepSeek-R1-Distill-Llama-8B-q4f16_1-MLC',
    label: 'DeepSeek R1 Distill Llama 8B',
    vramMB: 5001,
    sizeGB: 4.5,
    toolCapable: true,
    maxWindow: 4096,
    blurb: 'R1 reasoning distilled onto Llama 8B. Similar size to Llama 3.1 8B.',
  },
  {
    id: 'gemma-2-2b-it-q4f16_1-MLC',
    label: 'Gemma 2 2B',
    vramMB: 1895,
    sizeGB: 1.2,
    toolCapable: false,
    maxWindow: 4096,
    blurb: 'Small Gemma 2 instruct. Short questions; not for plan tools.',
  },
  {
    id: 'gemma-2-9b-it-q4f16_1-MLC',
    label: 'Gemma 2 9B',
    vramMB: 6422,
    sizeGB: 5.5,
    toolCapable: true,
    maxWindow: 4096,
    blurb: 'Large Gemma 2 instruct. Needs ~6 GB free VRAM.',
  },
  {
    id: 'Mistral-7B-Instruct-v0.3-q4f16_1-MLC',
    label: 'Mistral 7B Instruct',
    vramMB: 4573,
    sizeGB: 4.0,
    toolCapable: true,
    maxWindow: 4096,
    blurb: 'Classic Mistral instruct. Tools on; ~4.5 GB VRAM.',
  },
  {
    id: 'Hermes-2-Pro-Mistral-7B-q4f16_1-MLC',
    label: 'Hermes 2 Pro Mistral 7B',
    vramMB: 4033,
    sizeGB: 4.0,
    toolCapable: true,
    maxWindow: 4096,
    blurb: 'Nous Hermes 2 Pro on Mistral 7B — trained to follow function calls.',
  },
  {
    id: 'Ministral-3-3B-Instruct-2512-BF16-q4f16_1-MLC',
    label: 'Ministral 3 3B Instruct',
    vramMB: 2864,
    sizeGB: 1.8,
    toolCapable: false,
    maxWindow: 4096,
    blurb: 'Mistral\'s small instruct. Questions only — pick a 4B for tools.',
  },
  {
    id: 'Ministral-3-3B-Reasoning-2512-q4f16_1-MLC',
    label: 'Ministral 3 3B Reasoning',
    vramMB: 2864,
    sizeGB: 1.8,
    toolCapable: false,
    maxWindow: 4096,
    blurb: 'Mistral\'s small reasoning pack. Thinks out loud; still questions only.',
  },
  {
    id: 'SmolLM2-1.7B-Instruct-q4f16_1-MLC',
    label: 'SmolLM2 1.7B',
    vramMB: 1774,
    sizeGB: 1.1,
    toolCapable: false,
    maxWindow: 4096,
    blurb: 'Hugging Face tiny instruct. Small download, questions only.',
  },
  {
    id: 'WizardMath-7B-V1.1-q4f16_1-MLC',
    label: 'WizardMath 7B',
    vramMB: 4573,
    sizeGB: 4.0,
    toolCapable: false,
    maxWindow: 4096,
    blurb: 'Math-tuned 7B. Good at arithmetic; not trained for plan tools.',
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
