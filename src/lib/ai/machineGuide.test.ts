import { describe, it, expect } from 'vitest';
import { buildMachineGuide } from './machineGuide';
import { WEBLLM_MODELS } from './webLlmModels';

// The list is ordered best-first (not by size), so derive size facts here.
const byVram = [...WEBLLM_MODELS].sort((a, b) => a.vramMB - b.vramMB);
const smallest = byVram[0];                       // last-resort 1.5B
const smallestUsable = byVram.find(m => m.vramMB > smallest.vramMB)!;

describe('buildMachineGuide', () => {
  it('steers no-WebGPU browsers away from local models, plainly', () => {
    const g = buildMachineGuide(false, null);
    expect(g.webgpu).toBe(false);
    expect(g.headline).toMatch(/won't run/);
    expect(g.detail).toMatch(/WebGPU/);
    expect(g.recommended).toBe(smallestUsable); // harmless default
  });

  it('recommends the smallest usable model when VRAM is unknown', () => {
    const g = buildMachineGuide(true, null);
    expect(g.recommended).toBe(smallestUsable);
    expect(g.recommended).not.toBe(smallest); // never steer to the 1.5B by default
    expect(g.detail).toMatch(/didn't tell us/);
  });

  it('falls back to the last-resort model on a GPU too small for anything else', () => {
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
    const biggest = byVram[byVram.length - 1];
    expect(g.recommended).toBe(biggest);
  });

  it('fits the budget when anything does, else falls back to the last-resort model', () => {
    for (const gb of [2, 3, 4, 5, 6, 8, 12, 24]) {
      const budget = Math.max(0, (gb - 1) * 1024);
      const g = buildMachineGuide(true, gb);
      const usableFits = WEBLLM_MODELS.some(m => m !== smallest && m.vramMB <= budget);
      if (usableFits) {
        // A real model fits: stay within budget and never steer to the 1.5B.
        expect(g.recommended.vramMB).toBeLessThanOrEqual(budget);
        expect(g.recommended).not.toBe(smallest);
      } else {
        // Nothing usable fits the strict budget — the last-resort 1.5B is
        // offered even though it's over budget, rather than nothing at all.
        expect(g.recommended).toBe(smallest);
      }
    }
  });
});
