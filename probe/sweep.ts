// Elective probe — the sweep definition: loop-prone prompts and the sampler
// grid. Kept separate from repetition.ts so the page and any future analysis
// import one source of truth. Not part of the app bundle or deploy tests.

import type { SamplerProfile } from './repetition';

/** Retirement prompts chosen to PROVOKE the failure modes: long enumerations
 *  (the "walk me through every year" loop), tool-protocol mimicry (the
 *  screenshot's PROPOSE: salad), and open-ended advice (rambling). Each is
 *  run at every sampler profile. */
export const SWEEP_PROMPTS: Array<{ id: string; label: string; system: string; user: string }> = [
  {
    id: 'year-walkthrough',
    label: 'Year-by-year walkthrough',
    system: 'You are a Canadian retirement drawdown assistant. Answer in plain prose.',
    user: 'Walk me through my plan year by year from retirement at 62 to age 90: ' +
      'what I withdraw from each account, what tax I pay, and what my balances look like.',
  },
  {
    id: 'propose-rdsp',
    label: 'RDSP proposal (tool-protocol mimicry)',
    system: 'You propose plan changes as fenced JSON tool calls like ```tool ' +
      '{"name":"set_plan_value","args":{...}}```. The user confirms each one.',
    user: 'help me setup my rdsp',
  },
  {
    id: 'cpp-oas-advice',
    label: 'CPP/OAS timing advice',
    system: 'You are a Canadian retirement drawdown assistant. Answer in plain prose.',
    user: 'Should I take CPP early at 60 or wait until 70? Explain the trade-offs with numbers.',
  },
  {
    id: 'tax-rules-dump',
    label: 'Enumerate every tax rule',
    system: 'You are a Canadian retirement drawdown assistant. Answer in plain prose.',
    user: 'List every tax, benefit, and withdrawal rule you apply to my plan, with the exact figures.',
  },
];

/** The sampler grid. 'baseline' mirrors the CURRENTLY SHIPPED generic defaults
 *  (rep 1.15 / presence 0.3 / frequency 0.3 / temp 0.3) so the sweep can
 *  measure whether any profile actually beats what we ship today. The rest
 *  vary the two knobs that matter for loops — repetition strength and the
 *  presence/frequency pair — plus temperature. */
export const SWEEP_PROFILES: SamplerProfile[] = [
  { label: 'baseline', temperature: 0.3, repetitionPenalty: 1.15, presencePenalty: 0.3, frequencyPenalty: 0.3 },
  { label: 'phi4-shipped', temperature: 0.6, repetitionPenalty: 1.3, presencePenalty: 0.5, frequencyPenalty: 0.5 },
  { label: 'hot', temperature: 0.8, repetitionPenalty: 1.15, presencePenalty: 0.3, frequencyPenalty: 0.3 },
  { label: 'cold', temperature: 0.1, repetitionPenalty: 1.15, presencePenalty: 0.3, frequencyPenalty: 0.3 },
  { label: 'rep-strong', temperature: 0.3, repetitionPenalty: 1.5, presencePenalty: 0.3, frequencyPenalty: 0.3 },
  { label: 'pf-pair', temperature: 0.3, repetitionPenalty: 1.15, presencePenalty: 0.8, frequencyPenalty: 0.8 },
  { label: 'aggressive', temperature: 0.5, repetitionPenalty: 1.4, presencePenalty: 0.6, frequencyPenalty: 0.6 },
  { label: 'max-anti', temperature: 0.7, repetitionPenalty: 1.6, presencePenalty: 1.0, frequencyPenalty: 1.0 },
];

/** Generation budget per probe turn. Small enough to keep a full sweep
 *  tractable, large enough that a looping model hits the cap and we see where
 *  the loop starts (loopOnset needs a long tail to be meaningful). */
export const SWEEP_MAX_TOKENS = 1024;
