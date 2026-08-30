// Tests for the paste-based "Ask an AI" question prompts.
import { describe, it, expect } from 'vitest';
import { QA_PRESETS, buildQAPrompt, buildPlanDigest } from './agentQA';
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
        desiredSpending: 25000, withdrawalOrder: ['tfsa', 'taxable', 'rrsp'], income: [],
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

  it('leads with the HOUSEHOLD verdict even when the primary silo depletes (A-03)', () => {
    // A couple whose primary runs dry but whose funded spouse covers the gap:
    // the per-person "You" digest reads SHORTFALL, while householdOutcome (the
    // dashboard/MC verdict, #33) says the household is fine. The prompt must
    // lead with the household verdict so the model doesn't conclude SHORTFALL
    // from the primary's line alone.
    const inputs = baseInputs({
      currentAge: 65, retirementAge: 65, maxAge: 90,
      rrspBalance: 100000, tfsaBalance: 0, taxableBalance: 0,
      cppStartAge: 65, cppMonthlyAmount: 500, oasStartAge: 65, oasYearsInCanada: 40,
      desiredSpending: 20000, income: [],
      spouse: {
        enabled: true, currentAge: 65, retirementAge: 65,
        rrspBalance: 900000, tfsaBalance: 200000, taxableBalance: 0, cashCushionBalance: 0,
        rrspContribution: 0, tfsaContribution: 0, taxableContribution: 0,
        cppStartAge: 65, cppMonthlyAmount: 800, oasStartAge: 65, oasYearsInCanada: 40,
        desiredSpending: 25000, income: [],
      },
    });
    const hr = calculateHousehold(inputs, config);
    // Fixture sanity: the primary DOES deplete (per-person SHORTFALL) while the
    // household verdict is ON_TRACK — otherwise the test proves nothing.
    expect(hr.status).toBe('SHORTFALL');
    const out = buildQAPrompt(inputs, { results: hr }, QA_PRESETS[0]);
    expect(out).toContain('HOUSEHOLD VERDICT: ON TRACK');
    // The household verdict must appear BEFORE the per-person digests.
    expect(out.indexOf('HOUSEHOLD VERDICT')).toBeLessThan(out.indexOf('You:'));
  });

  it('buildPlanDigest carries the same household verdict line', () => {
    const single = baseInputs({
      rrspBalance: 400000, tfsaBalance: 100000,
      cppStartAge: 65, cppMonthlyAmount: 1000, oasStartAge: 65, oasYearsInCanada: 40,
      desiredSpending: 55000, maxAge: 95,
    });
    const r = calculateRetirement(single, config);
    const digest = buildPlanDigest(single, { results: r });
    expect(digest).toContain('HOUSEHOLD VERDICT:');
    expect(digest.indexOf('HOUSEHOLD VERDICT')).toBeLessThan(digest.indexOf('Plan:'));
  });
});
