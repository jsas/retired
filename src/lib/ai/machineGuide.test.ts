import { describe, it, expect, afterEach } from 'vitest';
import { buildMachineGuide } from './machineGuide';
import { WEBLLM_MODELS } from './webLlmModels';

// The list is ordered best-first (not by size), so derive size facts here.
// Dev-only entries (local fine-tunes whose weights aren't deployed) are
// excluded — the guide never recommends a model a visitor can't download.
const byVram = [...WEBLLM_MODELS].filter(m => !m.localDevOnly).sort((a, b) => a.vramMB - b.vramMB);
const smallestToolCapable = byVram.find(m => m.toolCapable)!;

// Swap navigator.userAgent per test, then restore (the guide reads it via
// browserDetect). jsdom exposes it as a getter, so redefine the property.
const realNavigator = globalThis.navigator;
function setUA(ua: string) {
  Object.defineProperty(globalThis, 'navigator', {
    value: { userAgent: ua },
    configurable: true,
    writable: true,
  });
}
afterEach(() => {
  Object.defineProperty(globalThis, 'navigator', {
    value: realNavigator,
    configurable: true,
    writable: true,
  });
});
const SAFARI_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';
const FIREFOX_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:124.0) Gecko/20100101 Firefox/124.0';
const WINDOWS_CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

describe('buildMachineGuide', () => {
  it('steers no-WebGPU browsers away from local models, plainly', () => {
    const g = buildMachineGuide(false);
    expect(g.webgpu).toBe(false);
    expect(g.headline).toMatch(/won't run/);
    expect(g.detail).toMatch(/WebGPU/);
  });

  it('recommends the smallest TOOL-CAPABLE model', () => {
    // Since #118 pruned the weak models, every catalog entry is tool-capable —
    // the recommendation is the lightest download that can still drive the
    // plan (never a questions-only assistant).
    const g = buildMachineGuide(true);
    expect(g.recommended).toBe(smallestToolCapable);
    expect(g.recommended.toolCapable).toBe(true);
    expect(g.headline).toContain(g.recommended.label);
  });

  it('never claims a detected memory figure', () => {
    // The whole point of the simplification: WebGPU hides real VRAM, so the
    // copy must not assert a number it can't know.
    const g = buildMachineGuide(true);
    expect(g.detail).not.toMatch(/detected/i);
    expect(g.detail).not.toMatch(/\d+(\.\d+)? GB of graphics memory/);
    expect(g.headline).not.toMatch(/\d+(\.\d+)? GB/);
  });

  it('names Safari and points a Mac user at Chrome/Edge (never blames the Mac)', () => {
    setUA(SAFARI_MAC);
    const g = buildMachineGuide(false);
    expect(g.headline).toContain('Safari');
    expect(g.detail).toMatch(/Chrome or Edge/);
    expect(g.detail).toMatch(/Apple Silicon/);
    expect(g.detail).not.toMatch(/not a phone/); // Mac-specific copy, not generic
  });

  it('names Firefox and points a Mac user at Chrome/Edge', () => {
    setUA(FIREFOX_MAC);
    const g = buildMachineGuide(false);
    expect(g.headline).toContain('Firefox');
    expect(g.detail).toMatch(/Chrome or Edge/);
    expect(g.detail).toMatch(/Apple Silicon/);
  });

  it('adds a unified-memory note on Apple Silicon when WebGPU works', () => {
    setUA(SAFARI_MAC); // any mac UA marks it Apple Silicon for the note
    const g = buildMachineGuide(true);
    expect(g.detail).toMatch(/share one memory pool/);
  });

  it('omits the unified-memory note off-Mac', () => {
    setUA(WINDOWS_CHROME);
    const g = buildMachineGuide(true);
    expect(g.detail).not.toMatch(/share one memory pool/);
  });
});
