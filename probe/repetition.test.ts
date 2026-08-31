// Elective probe scoring tests — run with `npm run probe:test` (NOT the deploy
// gate). These lock the metrics that rank sampler profiles, so a sweep result
// is trustworthy without needing a GPU.

import { describe, it, expect } from 'vitest';
import {
  tokenize, ttr, phraseRepeatRatio, maxWordRepeat, longTokenRatio,
  loopOnset, repetitionScore, rankProfiles, toSamplerDefaults,
} from './repetition';
import { SWEEP_PROFILES } from './sweep';

// Genuinely varied prose — many distinct sentences, so a rich trailing
// vocabulary. (A repeated sentence is NOT a good "healthy" fixture: it trips
// the collapsed-vocabulary metric, which is exactly what it should do.)
const SENTENCES = [
  'Your CPP at sixty five is roughly fourteen thousand dollars per year.',
  'Deferring OAS until seventy raises it by forty two percent.',
  'The GIS clawback begins once net income crosses the annual threshold.',
  'RRIF minimums start at seventy two and climb with age.',
  'A taxable withdrawal triggers capital gains only on the paid‑up difference.',
  'Monte Carlo shows an eighty seven percent success rate over a thirty year horizon.',
  'Sequence risk bites hardest in the first decade of drawdown.',
  'Your spouse inherits the registered plan through a rollover election.',
  'Inflation at two percent quietly erodes purchasing power by your eighties.',
  'The TFSA recontributes room only in the calendar following a withdrawal.',
  'An annuity guarantees lifetime income but surrenders the residual estate.',
  'Reverse mortgage interest compounds against your home equity balance.',
  'Splitting pension income can drop your combined tax bracket one notch.',
  'The basic personal amount shelters the first fifteen thousand from federal tax.',
  'Provincial surtax adds a percentage on top of the federal calculation.',
  'Bridge benefits stop at sixty five when CPP and OAS take over.',
  'A larger Roth contribution now means tax‑free growth for later decades.',
  'Long‑term care premiums rise steeply after age seventy.',
  'Your estate pays probate on the non‑registered accounts at death.',
  'Charitable donations through bonds avoid the capital gains inclusion.',
];
const healthy = Array.from({ length: 20 }, (_, i) => SENTENCES[i % SENTENCES.length]).join(' ');

describe('tokenize', () => {
  it('lowercases, splits on non-words, drops short fillers', () => {
    expect(tokenize("It's a TEST — don't mind me.")).toEqual(["it's", 'test', "don't", 'mind']);
  });
});

describe('ttr', () => {
  it('is 1 for windows shorter than the size', () => {
    expect(ttr(tokenize('one two three'), 220)).toBe(1);
  });
  it('is low for a collapsed loop, high for varied prose', () => {
    const loop = tokenize('withdrawal from rrsp '.repeat(300));
    expect(ttr(loop)).toBeLessThan(0.1);
    expect(ttr(tokenize(healthy))).toBeGreaterThan(0.4);
  });
});

describe('phraseRepeatRatio', () => {
  it('is 0 for varied prose', () => {
    expect(phraseRepeatRatio(tokenize(healthy))).toBeLessThan(0.2);
  });
  it('rises with a repeated sentence', () => {
    const sentence = 'Now let us assume you contribute at age sixty five and take away at ninety five. ';
    const ratio = phraseRepeatRatio(tokenize(sentence.repeat(8)));
    expect(ratio).toBeGreaterThan(0.5);
  });
});

describe('maxWordRepeat', () => {
  it('ignores stopwords even when one dominates the window', () => {
    // "the" hammered at the END (inside the trailing window) must not count —
    // it's a function word, not the loop signal.
    const text = tokenize(healthy).join(' ') + ' ' + 'the '.repeat(200);
    expect(maxWordRepeat(tokenize(text))).toBeLessThan(0.1);
  });
  it('catches one content word hammered through a diverse window', () => {
    const words: string[] = [];
    for (let i = 0; i < 40; i++) words.push('explicitly', `concept${i}`, `metric${i}`, `factor${i}`);
    expect(maxWordRepeat(tokenize(words.join(' ')))).toBeGreaterThan(0.1);
  });
});

describe('longTokenRatio', () => {
  it('is high for a jargon dump, low for plain prose', () => {
    const dump = Array.from({ length: 240 }, (_, i) => `transcendentalization${i}`).join(' ');
    expect(longTokenRatio(tokenize(dump))).toBeGreaterThan(0.9);
    expect(longTokenRatio(tokenize(healthy))).toBeLessThan(0.55);
  });
});

describe('loopOnset', () => {
  it('is 1 when the reply never degenerates', () => {
    expect(loopOnset(tokenize(healthy))).toBe(1);
  });
  it('is early when the whole tail is a loop', () => {
    const loop = tokenize('withdrawal from rrsp '.repeat(300));
    expect(loopOnset(loop)).toBe(0);
  });
  it('marks the middle when a clean answer degenerates halfway', () => {
    const text = healthy + ' ' + 'seamlessly continuously consistently successfully '.repeat(120);
    const onset = loopOnset(tokenize(text));
    expect(onset).toBeGreaterThan(0.05);
    expect(onset).toBeLessThan(0.9);
  });
});

describe('repetitionScore', () => {
  it('is 0 for short replies (nothing to judge)', () => {
    expect(repetitionScore('Yes, your plan is funded to age 95.')).toBe(0);
  });
  it('is low for healthy prose and high for both loop flavours', () => {
    const collapsed = 'withdrawal from rrsp '.repeat(300);
    const diverse: string[] = [];
    for (let i = 0; i < 60; i++) diverse.push('explicitly', `concept${i}`, `metric${i}`, `factor${i}`, `aspect${i}`);
    expect(repetitionScore(healthy)).toBeLessThan(0.2);
    expect(repetitionScore(collapsed)).toBeGreaterThan(0.5);
    expect(repetitionScore(diverse.join(' '))).toBeGreaterThan(0.5);
  });
});

describe('rankProfiles + toSamplerDefaults', () => {
  const profiles = SWEEP_PROFILES.slice(0, 3);
  it('ranks by average score ascending', () => {
    const ranked = rankProfiles({
      modelId: 'x',
      profiles: profiles.map((p, i) => ({ profile: p, avgScore: 3 - i, worstScore: 4 - i, samples: 5 })),
    });
    expect(ranked[0].profile.label).toBe(profiles[2].label);
  });
  it('emits a defaults snippet only when a profile clearly beats the baseline', () => {
    // profiles[0] is the sweep's 'baseline' label; a clear winner must be
    // named, a marginal one must not.
    const mk = (bestDelta: number) => [{
      modelId: 'Phi-4-mini-instruct-q4f16_1-MLC',
      profiles: [
        { profile: profiles[0], avgScore: 0.5, worstScore: 0.8, samples: 8 },
        { profile: profiles[2], avgScore: 0.5 - bestDelta, worstScore: 0.6, samples: 8 },
      ],
    }];
    expect(toSamplerDefaults(mk(0.02))).toContain('No model beat the baseline');
    const out = toSamplerDefaults(mk(0.3));
    expect(out).toContain('Phi-4-mini-instruct-q4f16_1-MLC');
    expect(out).toContain('repetitionPenalty');
  });
});
