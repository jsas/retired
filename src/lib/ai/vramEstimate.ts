// Estimate how much graphics memory (VRAM) a chosen context window adds on
// top of a local model's base footprint, so the Models page can warn BEFORE
// the user picks a window their GPU can't hold.
//
// The math: web-llm keeps a key/value cache with one entry per token in the
// window, per layer. Cache size ≈ tokens × layers × kv-heads × head-dim ×
// 2 (K and V) × 2 bytes (fp16). We don't ship per-architecture layer counts,
// so this uses a middle-of-the-road per-token constant (≈100 KB/token,
// typical for the 2–9B q4f16 models in the catalog) — deliberately rough,
// and the UI says so. Better a honest ±25% estimate than a false-precision
// table that silently lies for one architecture.

/** Estimated KV-cache bytes per context token, fp16. */
const BYTES_PER_TOKEN = 100 * 1024;

/** Headroom reserved for the page, the OS compositor, and fragmentation —
 *  the same 1 GB the machine guide leaves when picking a model. */
const HEADROOM_MB = 1024;

export interface ContextFit {
  /** Model base VRAM + estimated KV cache for the window, in MB. */
  neededMB: number;
  /** The KV-cache share alone, in MB. */
  cacheMB: number;
  /** True when we know the GPU size and the total fits within headroom.
   *  null when the browser didn't report GPU memory (can't say). */
  fits: boolean | null;
  /** Free VRAM after headroom, in MB — null when unknown. */
  budgetMB: number | null;
}

/** Estimate the fit of `contextTokens` for a model whose base footprint is
 *  `baseVramMB`, on a GPU with `gpuMemoryGB` (null = unknown). */
export function estimateContextFit(
  baseVramMB: number,
  contextTokens: number,
  gpuMemoryGB: number | null,
): ContextFit {
  const cacheMB = Math.round((contextTokens * BYTES_PER_TOKEN) / (1024 * 1024));
  const neededMB = baseVramMB + cacheMB;
  if (gpuMemoryGB == null) {
    return { neededMB, cacheMB, fits: null, budgetMB: null };
  }
  const budgetMB = Math.max(0, Math.round(gpuMemoryGB * 1024) - HEADROOM_MB);
  return { neededMB, cacheMB, fits: neededMB <= budgetMB, budgetMB };
}

/** Format megabytes the way the model picker formats VRAM. */
export function fmtMB(mb: number): string {
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb} MB`;
}
