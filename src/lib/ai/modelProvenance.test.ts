import { describe, expect, it } from 'vitest';
import { provenanceLine, provenanceDetail } from './modelProvenance';

describe('provenanceLine', () => {
  it('shows asked → served when the free router rewrote the model', () => {
    expect(provenanceLine('openrouter/free', 'meta-llama/llama-3.3-70b-instruct:free'))
      .toBe('openrouter/free → meta-llama/llama-3.3-70b-instruct:free');
  });

  it('collapses to one id when asked and served match', () => {
    expect(provenanceLine('Qwen3.5-4B-q4f16_1-MLC', 'Qwen3.5-4B-q4f16_1-MLC'))
      .toBe('Qwen3.5-4B-q4f16_1-MLC');
  });

  it('returns empty when nothing was recorded', () => {
    expect(provenanceLine()).toBe('');
    expect(provenanceDetail()).toBeNull();
  });
});
