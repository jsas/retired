// Plain-English guidance for picking a LOCAL (web-llm) model: detect what the
// user's machine can do and point at a model size, in language a non-technical
// person can follow. Everything here is best-effort — when the browser won't
// say, we recommend the smallest model and say so.

import { WEBLLM_MODELS, webGpuAvailable, type WebLlmModelChoice } from './webLlmModels';

export interface MachineGuide {
  /** Can this browser even try local models? */
  webgpu: boolean;
  /** Detected GPU VRAM in GB, when the adapter reports it (else null). */
  gpuMemoryGB: number | null;
  /** The model we suggest they start with. */
  recommended: WebLlmModelChoice;
  /** One or two plain sentences explaining the recommendation. */
  headline: string;
  /** Longer plain-English explanation shown under the picker. */
  detail: string;
}

/** Query the WebGPU adapter for a memory ceiling. Best-effort: resolves null
 *  when WebGPU or the limit is unavailable. Never throws. */
export async function detectGpuMemoryGB(): Promise<number | null> {
  if (!webGpuAvailable()) return null;
  try {
    const nav = navigator as unknown as { gpu?: { requestAdapter(): Promise<unknown> } };
    const adapter = await nav.gpu?.requestAdapter();
    if (!adapter) return null;
    // maxBufferSize is a decent proxy for usable VRAM on most adapters.
    const limits = (adapter as { limits?: { maxBufferSize?: number } }).limits;
    const bytes = limits?.maxBufferSize;
    if (typeof bytes === 'number' && bytes > 0) return bytes / 1e9;
    return null;
  } catch {
    return null;
  }
}

/**
 * Build the plain-English guide. `gpuMemoryGB` is injected (from
 * detectGpuMemoryGB) so the logic is testable without a real GPU.
 */
export function buildMachineGuide(webgpu: boolean, gpuMemoryGB: number | null): MachineGuide {
  const byVram = [...WEBLLM_MODELS].sort((a, b) => a.vramMB - b.vramMB);
  // Every model in the list is usable (the too-weak ones were removed), so the
  // smallest is a fine floor and the largest a fine ceiling.
  const smallest = byVram[0];

  if (!webgpu) {
    return {
      webgpu: false,
      gpuMemoryGB: null,
      recommended: smallest,
      headline: 'Local models won\'t run in this browser.',
      detail:
        'Running a model on your own computer needs a browser feature called WebGPU, which this browser ' +
        'doesn\'t have. Try the latest Chrome or Edge on a computer (not a phone), or use an online ' +
        'provider instead (the "advanced" option below).',
    };
  }

  // Pick the largest model that fits comfortably (leave ~1 GB headroom for the
  // rest of the page and the OS's compositor). Unknown VRAM → play it safe
  // with the smallest model rather than guessing big.
  let pick = smallest;
  if (gpuMemoryGB != null) {
    const budgetMB = Math.max(0, (gpuMemoryGB - 1) * 1024);
    // byVram is ascending, so the last one that fits is the largest that fits.
    for (const m of byVram) {
      if (m.vramMB <= budgetMB) pick = m;
    }
    // (If nothing fits, pick stays `smallest` — offered as a tight fit rather
    // than nothing at all.)
  }

  const headline = gpuMemoryGB == null
    ? `Start with ${pick.label} — a good balance for most computers.`
    : `Your computer can likely run ${pick.label}.`;

  const detail = gpuMemoryGB == null
    ? 'Your browser didn\'t tell us how much graphics memory you have, so we picked a model ' +
      'that works well for most people. Bigger models give smarter answers but need a stronger ' +
      'computer and a longer first download; when in doubt, start with the suggested one.'
    : `We detected roughly ${gpuMemoryGB.toFixed(1)} GB of graphics memory. The model we picked fits ` +
      'with room to spare. Bigger models give smarter answers but take longer to download the first ' +
      'time and can feel slow on a weaker computer. When in doubt, start smaller — you can always ' +
      'switch.';

  return { webgpu: true, gpuMemoryGB, recommended: pick, headline, detail };
}
