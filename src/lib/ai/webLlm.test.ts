import { describe, it, expect } from 'vitest';
import { WEBLLM_MODELS, fmtVram, webGpuAvailable } from './webLlmModels';
import { connectionReady, defaultModelFor, type AiConnection } from '../aiSettings';
import { buildPlanDigest } from '../agentQA';
import { calculateHousehold } from '../retirementEngine';
import { baseInputs, testConfig } from '../../test/helpers';

describe('curated web-llm model list', () => {
  it('ships only valid MLC prebuilt ids with VRAM labels', () => {
    expect(WEBLLM_MODELS.length).toBeGreaterThanOrEqual(5);
    for (const m of WEBLLM_MODELS) {
      expect(m.id).toMatch(/-MLC$/);
      expect(m.vramMB).toBeGreaterThan(0);
      expect(m.label.length).toBeGreaterThan(3);
      expect(m.blurb.length).toBeGreaterThan(10);
    }
  });

  it('is math/reasoning focused (math, R1, thinking, or reasoning in the id/label)', () => {
    for (const m of WEBLLM_MODELS) {
      const s = `${m.id} ${m.label}`.toLowerCase();
      expect(
        s.includes('math') || s.includes('r1') || s.includes('reasoning') || s.includes('thinking') || s.includes('qwen3'),
        `model ${m.id} is not math/reasoning-flavored`,
      ).toBe(true);
    }
  });

  it('formats VRAM for the picker', () => {
    expect(fmtVram(1630)).toBe('1.6 GB VRAM');
    expect(fmtVram(5107)).toBe('5.0 GB VRAM');
    expect(fmtVram(512)).toBe('512 MB VRAM');
  });

  it('webGpuAvailable reports a boolean without throwing', () => {
    expect(typeof webGpuAvailable()).toBe('boolean');
  });
});

describe('webllm as a provider in settings', () => {
  const local: AiConnection = {
    id: 'c', provider: 'webllm', label: 'local', apiKey: '',
    model: 'Qwen2.5-Math-1.5B-Instruct-q4f16_1-MLC',
  };

  it('needs no key or base URL — just a model id', () => {
    expect(connectionReady(local)).toBe(true);
    expect(connectionReady({ ...local, model: '' })).toBe(false);
  });

  it('has a curated default model', () => {
    const def = defaultModelFor('webllm');
    expect(WEBLLM_MODELS.some(m => m.id === def)).toBe(true);
  });
});

describe('buildPlanDigest (chat-only provider context)', () => {
  it('embeds the plan inputs and computed verdict without a question', () => {
    const inputs = baseInputs();
    const results = calculateHousehold(inputs, testConfig());
    const digest = buildPlanDigest(inputs, { results });
    expect(digest).toContain('PLAN INPUTS (JSON):');
    expect(digest).toContain('COMPUTED PROJECTION (summary):');
    expect(digest).toContain('withdrawal rate');
    expect(digest).not.toContain('QUESTION:');
    // The digest must carry the actual numbers, not placeholders.
    expect(digest).toContain('"tfsaBalance": 500000');
  });
});
