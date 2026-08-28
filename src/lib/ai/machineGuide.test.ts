import { describe, it, expect } from 'vitest';
import { buildMachineGuide } from './machineGuide';
import { WEBLLM_MODELS } from './webLlmModels';

// The list is ordered best-first (not by size), so derive size facts here.
const byVram = [...WEBLLM_MODELS].sort((a, b) => a.vramMB - b.vramMB);
const smallest = byVram[0];
const biggest = byVram[byVram.length - 1];

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
});
