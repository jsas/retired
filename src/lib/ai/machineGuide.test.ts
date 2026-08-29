import { describe, it, expect, afterEach } from 'vitest';
import { buildMachineGuide } from './machineGuide';
import { WEBLLM_MODELS } from './webLlmModels';

// The list is ordered best-first (not by size), so derive size facts here.
const byVram = [...WEBLLM_MODELS].sort((a, b) => a.vramMB - b.vramMB);
const smallest = byVram[0];
const biggest = byVram[byVram.length - 1];

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

describe('buildMachineGuide', () => {
  it('steers no-WebGPU browsers away from local models, plainly', () => {
    const g = buildMachineGuide(false, null);
    expect(g.webgpu).toBe(false);
    expect(g.headline).toMatch(/won't run/);
    expect(g.detail).toMatch(/WebGPU/);
    expect(g.recommended).toBe(smallest); // harmless default
  });

  it('recommends the smallest model when VRAM is unknown (plays it safe)', () => {
    const g = buildMachineGuide(true, null);
    expect(g.recommended).toBe(smallest);
    expect(g.detail).toMatch(/didn't tell us/);
  });

  it('offers the smallest model on a GPU too small for anything else', () => {
    const g = buildMachineGuide(true, 2); // 2 GB − 1 GB headroom = 1 GB budget
    expect(g.recommended).toBe(smallest);
    expect(g.detail).toContain('2.0 GB');
  });

  it('recommends a mid model when VRAM allows', () => {
    const g = buildMachineGuide(true, 6);
    // 6 GB − 1 GB headroom = 5 GB budget → the largest model under ~5 GB VRAM.
    expect(g.recommended.vramMB).toBeLessThanOrEqual(5 * 1024);
    expect(g.recommended).not.toBe(smallest);
    expect(g.headline).toContain(g.recommended.label);
  });

  it('recommends the biggest curated model on a large GPU', () => {
    const g = buildMachineGuide(true, 24);
    expect(g.recommended).toBe(biggest);
  });

  it('never recommends a model above the budget', () => {
    for (const gb of [2, 3, 4, 5, 6, 8, 12, 24]) {
      const budget = Math.max(0, (gb - 1) * 1024);
      const g = buildMachineGuide(true, gb);
      const anyFits = WEBLLM_MODELS.some(m => m.vramMB <= budget);
      if (anyFits) {
        expect(g.recommended.vramMB).toBeLessThanOrEqual(budget);
      } else {
        // Nothing fits the strict budget — offer the smallest as a tight fit.
        expect(g.recommended).toBe(smallest);
      }
    }
  });

  it('names Safari and points a Mac user at Chrome/Edge (never blames the Mac)', () => {
    setUA(SAFARI_MAC);
    const g = buildMachineGuide(false, null);
    expect(g.headline).toContain('Safari');
    expect(g.detail).toMatch(/Chrome or Edge/);
    expect(g.detail).toMatch(/Apple Silicon/);
    expect(g.detail).not.toMatch(/not a phone/); // Mac-specific copy, not generic
  });

  it('names Firefox and points a Mac user at Chrome/Edge', () => {
    setUA(FIREFOX_MAC);
    const g = buildMachineGuide(false, null);
    expect(g.headline).toContain('Firefox');
    expect(g.detail).toMatch(/Chrome or Edge/);
    expect(g.detail).toMatch(/Apple Silicon/);
  });

  it('adds a unified-memory note on Apple Silicon when WebGPU works', () => {
    setUA(SAFARI_MAC); // any mac UA marks it Apple Silicon for the note
    const g = buildMachineGuide(true, 24);
    expect(g.detail).toMatch(/share one memory pool/);
    expect(g.detail).toMatch(/larger\s+model/);
  });

  it('omits the unified-memory note off-Mac', () => {
    setUA('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
    const g = buildMachineGuide(true, 24);
    expect(g.detail).not.toMatch(/share one memory pool/);
  });
});
