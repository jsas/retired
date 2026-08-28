import { describe, it, expect } from 'vitest';
import { estimateContextFit, fmtMB } from './vramEstimate';

describe('estimateContextFit', () => {
  it('scales the KV cache linearly with the window', () => {
    const a = estimateContextFit(3000, 8192, null);
    const b = estimateContextFit(3000, 16384, null);
    expect(b.cacheMB).toBe(a.cacheMB * 2);
    expect(b.neededMB).toBe(3000 + b.cacheMB);
  });

  it('is honest that 16K is not free: ~1.6 GB of cache', () => {
    const fit = estimateContextFit(3438, 16384, null);
    expect(fit.cacheMB).toBe(1600);
    expect(fit.neededMB).toBe(5038);
  });

  it('reports fits=true within budget and false past it, after 1 GB headroom', () => {
    // 8 GB GPU → 7168 MB budget. Base 3438 + 1600 cache = 5038 fits.
    expect(estimateContextFit(3438, 16384, 8).fits).toBe(true);
    // Same model with a 128K window: 3438 + 12800 = 16238 > 7168.
    expect(estimateContextFit(3438, 131072, 8).fits).toBe(false);
    // 4 GB GPU → 3072 MB budget: even the base model + 16K doesn't fit.
    expect(estimateContextFit(3438, 16384, 4).fits).toBe(false);
  });

  it('returns fits=null when the GPU size is unknown', () => {
    const fit = estimateContextFit(3438, 16384, null);
    expect(fit.fits).toBeNull();
    expect(fit.budgetMB).toBeNull();
    expect(fit.neededMB).toBeGreaterThan(0);
  });

  it('a GPU reporting under 1 GB leaves a zero (not negative) budget', () => {
    const fit = estimateContextFit(1000, 4096, 0.5);
    expect(fit.budgetMB).toBe(0);
    expect(fit.fits).toBe(false);
  });
});

describe('fmtMB', () => {
  it('formats sub-GB as MB and larger as GB with one decimal', () => {
    expect(fmtMB(800)).toBe('800 MB');
    expect(fmtMB(1600)).toBe('1.6 GB');
    expect(fmtMB(5038)).toBe('4.9 GB');
  });
});
