// Tests for the paste-based "Ask an AI" question prompts.
import { describe, it, expect } from 'vitest';
import { QA_PRESETS, buildQAPrompt } from './agentQA';
import { calculateRetirement, calculateHousehold } from './retirementEngine';
import { testConfig, baseInputs } from '../test/helpers';

const config = testConfig();

describe('agentQA presets', () => {
  it('ships five presets, each with id/title/blurb/question', () => {
    expect(QA_PRESETS).toHaveLength(5);
    const ids = new Set<string>();
    for (const p of QA_PRESETS) {
      expect(p.id).toBeTruthy();
      expect(p.title).toBeTruthy();
      expect(p.blurb).toBeTruthy();
      expect(p.question.length).toBeGreaterThan(40); // a real question, not a stub
      expect(ids.has(p.id)).toBe(false);
      ids.add(p.id);
    }
  });
});

describe('buildQAPrompt', () => {
  const inputs = baseInputs({
    rrspBalance: 400000, tfsaBalance: 100000,
    cppStartAge: 65, cppMonthlyAmount: 1000, oasStartAge: 65, oasYearsInCanada: 40,
    desiredSpending: 55000, maxAge: 95,
  });
  const results = calculateRetirement(inputs, config);

  it('embeds the plan inputs JSON', () => {
    const out = buildQAPrompt(inputs, { results }, QA_PRESETS[0]);
    expect(out).toContain('"desiredSpending": 55000');
    expect(out).toContain('"rrspBalance": 400000');
    expect(out).toContain('PLAN INPUTS (JSON):');
  });

  it('embeds the computed projection (verdict + depletion), not just inputs', () => {
    const out = buildQAPrompt(inputs, { results }, QA_PRESETS[0]);
    expect(out).toContain('COMPUTED PROJECTION');
    expect(out).toContain(results.status.replace('_', ' '));
    // Wealth at retirement and a withdrawal rate appear in the digest.
    expect(out).toContain('withdrawal rate');
    expect(out).toMatch(/wealth at retirement \$/);
  });

  it('uses the preset question by default and a custom question when given', () => {
    const preset = QA_PRESETS[1];
    const withPreset = buildQAPrompt(inputs, { results }, preset);
    expect(withPreset).toContain(preset.question.trim());

    const custom = buildQAPrompt(inputs, { results }, preset, '  Should I downsize my house?  ');
    expect(custom).toContain('Should I downsize my house?');
    expect(custom).not.toContain(preset.question.trim());
  });

  it('falls back to the preset question when the custom text is blank', () => {
    const preset = QA_PRESETS[2];
    const out = buildQAPrompt(inputs, { results }, preset, '   ');
    expect(out).toContain(preset.question.trim());
  });

  it('frames the answer as educational, from the given numbers', () => {
    const out = buildQAPrompt(inputs, { results }, QA_PRESETS[0]);
    expect(out).toContain('do not re-derive the numbers');
    expect(out).toContain('not personalized financial advice');
  });

  it('labels the two plans "You" and "Spouse" for a household', () => {
    const withSpouse = baseInputs({
      rrspBalance: 500000, desiredSpending: 60000,
      spouse: {
        enabled: true, currentAge: 62, retirementAge: 65,
        rrspBalance: 200000, tfsaBalance: 50000, taxableBalance: 0, cashCushionBalance: 0,
        rrspContribution: 0, tfsaContribution: 0, taxableContribution: 0,
        cppStartAge: 65, cppMonthlyAmount: 700, oasStartAge: 65, oasYearsInCanada: 40,
        desiredSpending: 25000, withdrawalOrder: ['tfsa', 'taxable', 'rrsp'], pensions: [],
      },
    });
    const hr = calculateHousehold(withSpouse, config);
    const out = buildQAPrompt(withSpouse, { results: hr }, QA_PRESETS[0]);
    expect(out).toContain('You:');
    expect(out).toContain('Spouse:');
  });

  it('includes Monte Carlo success rate when provided, omits it when null', () => {
    const mc = {
      successRate: 0.87, runs: 1000, volatility: 0.15,
      medianFinalBalance: 123456, percentileBands: [],
    } as unknown as Parameters<typeof buildQAPrompt>[1]['mcResults'];
    const withMc = buildQAPrompt(inputs, { results, mcResults: mc }, QA_PRESETS[0]);
    expect(withMc).toContain('MONTE CARLO');
    expect(withMc).toContain('success rate 87.0%');

    const withoutMc = buildQAPrompt(inputs, { results, mcResults: null }, QA_PRESETS[0]);
    expect(withoutMc).not.toContain('MONTE CARLO');
  });

  it('ends with the QUESTION section', () => {
    const out = buildQAPrompt(inputs, { results }, QA_PRESETS[4]);
    const qIdx = out.lastIndexOf('QUESTION:');
    expect(qIdx).toBeGreaterThan(-1);
    expect(qIdx).toBeGreaterThan(out.indexOf('COMPUTED PROJECTION'));
  });
});
