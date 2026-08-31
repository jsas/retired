// Plain-English guidance for picking a LOCAL (web-llm) model. WebGPU (per
// MDN / the spec) deliberately does NOT expose real VRAM — you only get
// capability limits and a GPUOutOfMemoryError after the fact — so we don't
// pretend to detect memory. We check ONE thing (does the browser support
// WebGPU at all) and recommend a sensible default; the user picks the size.

import { WEBLLM_MODELS, webGpuAvailable, type WebLlmModelChoice } from './webLlmModels';
import { browserLabel, detectBrowser, isLikelyAppleSilicon } from './browserDetect';

export interface MachineGuide {
  /** Can this browser even try local models? */
  webgpu: boolean;
  /** The model we suggest they start with (a safe default, not a detection). */
  recommended: WebLlmModelChoice;
  /** One or two plain sentences explaining the recommendation. */
  headline: string;
  /** Longer plain-English explanation shown under the picker. */
  detail: string;
}

/** True when the browser can attempt WebGPU inference at all. */
export { webGpuAvailable };

/**
 * Build the plain-English guide. Support-only: we recommend a middle-of-the-
 * road model for everyone and let the user size up/down, because the browser
 * won't tell us how much graphics memory there really is.
 */
export function buildMachineGuide(webgpu: boolean): MachineGuide {
  const byVram = [...WEBLLM_MODELS].sort((a, b) => a.vramMB - b.vramMB);
  // Recommend the smallest model that can still drive the tool protocol (read
  // the plan, propose edits). Since #118 every curated model is tool-capable,
  // so this lands on the lightest download in the catalog.
  const recommended = byVram.find(m => m.toolCapable) ?? byVram[0];

  if (!webgpu) {
    const browser = detectBrowser();
    const name = browserLabel(browser);
    // Name the actual browser and the one concrete fix. On a Mac the answer is
    // always Chrome/Edge (WebGPU→Metal); we never imply the Mac can't do it.
    const fix = browser === 'safari'
      ? 'Safari doesn\'t turn WebGPU on yet. Open this page in Chrome or Edge on your Mac — local ' +
        'models run great on Apple Silicon — or use an online provider instead (the "advanced" ' +
        'option below).'
      : browser === 'firefox'
        ? 'Firefox keeps WebGPU off by default. Open this page in Chrome or Edge on your Mac — ' +
          'local models run great on Apple Silicon — or use an online provider instead (the ' +
          '"advanced" option below).'
        : isLikelyAppleSilicon()
          ? 'This Mac can run local models — it just needs a browser with WebGPU on. Open this ' +
            'page in the latest Chrome or Edge, or use an online provider instead (the "advanced" ' +
            'option below).'
          : 'Try the latest Chrome or Edge on a computer (not a phone), or use an online provider ' +
            'instead (the "advanced" option below).';
    return {
      webgpu: false,
      recommended,
      headline: `Local models won't run in ${name}.`,
      detail: `Running a model on your own computer needs a browser feature called WebGPU, which ${name} ` +
        `isn't exposing. ${fix}`,
    };
  }

  const siliconNote = isLikelyAppleSilicon()
    ? ' On Apple Silicon the CPU and GPU share one memory pool, so larger models usually run well.'
    : '';

  return {
    webgpu: true,
    recommended,
    headline: `Start with ${recommended.label} — a good balance for most computers.`,
    detail:
      'We can\'t detect your graphics memory, so we suggest a model that runs well for most ' +
      'people. Bigger models give smarter answers but need a stronger computer and a longer ' +
      'first download; when in doubt, start small — you can always switch.' + siliconNote,
  };
}
