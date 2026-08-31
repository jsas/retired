// Corpus minter: runs the REAL tool executor against the REAL deterministic
// engine to capture genuine tool results, then assembles engine-grounded
// training records. This is the "free, correct supervision" the spike is built
// on — every exemplar's numbers are the shipped engine's actual output.
//
// SCALE. A model needs thousands of exemplars, not dozens, so the minter mints
// the cartesian product of (read-spec × question-paraphrase × scenario). Every
// question paraphrase for a tool maps to the SAME canonical args, so the model
// learns "many phrasings → one correct TOOL_CALL" — the muscle memory that is
// the whole point of the fine-tune. Engine-grounded follow-ups quote the real
// result; refusal/clarify/domain-explain records need no fresh engine output.
//
// Kinds minted:
//   - 'tool-call'        question → canonical TOOL_CALL line (the core skill)
//   - 'tool-followup'    TOOL_CALL → real [OK] result → grounded, non-advisory prose
//   - 'mutation-confirm' propose_* → APPROVED/REJECTED → acknowledge, never re-propose
//   - 'refusal'          recommendation-seeking ask → deflect to consequences
//   - 'clarify'          ambiguous ask → ask a question, don't guess a tool
//   - 'domain-explain'   a concept question → plain-words explainer, no tool needed

import { executeToolCall, type ToolContext } from '@retired/mcp-tools/tools';
import { testConfig } from '@retired/engine-core/test/helpers';
import type { ChatMessage, CorpusRecord } from './buildCorpus';
import { emitToolCall, wrapToolResult, mutationFeedback } from './protocol';
import { mintDomainKnowledgeRecords } from './domain';
import { SCENARIOS, type NamedScenario } from './scenarios';

/** A question → read-tool exemplar template. `args` may reference the scenario
 *  (e.g. retirementAge ± a delta) via a small resolver. */
interface ReadSpec {
  tool: string;
  /** Several phrasings of the same underlying ask → the SAME canonical call. */
  questions: Array<(sc: NamedScenario) => string>;
  args: (sc: NamedScenario) => Record<string, unknown>;
  /** Which grounded-explanation template the follow-up uses, or 'none' to mint
   *  only the tool-call record (for tools whose raw result — e.g. a JSON
   *  get_scenario block — doesn't fit the figure-grounded prose template). */
  explainFrom: 'verdict' | 'compare' | 'monteCarlo' | 'solve' | 'none';
}

const READ_SPECS: ReadSpec[] = [
  {
    tool: 'run_projection',
    questions: [
      () => 'Am I on track for retirement?',
      () => 'Will my money last?',
      () => 'Run the projection on my plan.',
      () => 'Is my plan funded to the end?',
      () => 'How does my retirement look?',
    ],
    args: () => ({}),
    explainFrom: 'verdict',
  },
  {
    tool: 'run_projection',
    questions: [
      (sc) => `What changes if I retire at ${sc.inputs.retirementAge + 2}?`,
      (sc) => `What if I work until ${sc.inputs.retirementAge + 2}?`,
      (sc) => `Show me the numbers for retiring at ${sc.inputs.retirementAge + 2}.`,
    ],
    args: (sc) => ({ overrides: { retirementAge: sc.inputs.retirementAge + 2 } }),
    explainFrom: 'verdict',
  },
  {
    tool: 'run_projection',
    questions: [
      (sc) => `What if I retired a couple years earlier, at ${Math.max(sc.inputs.retirementAge - 2, sc.inputs.currentAge)}?`,
      (sc) => `Run it with retirement at ${Math.max(sc.inputs.retirementAge - 2, sc.inputs.currentAge)}.`,
    ],
    args: (sc) => ({ overrides: { retirementAge: Math.max(sc.inputs.retirementAge - 2, sc.inputs.currentAge) } }),
    explainFrom: 'verdict',
  },
  {
    tool: 'compare_scenarios',
    questions: [
      (sc) => `Compare retiring at ${sc.inputs.retirementAge} vs ${sc.inputs.retirementAge + 3}.`,
      (sc) => `Should I look at ${sc.inputs.retirementAge} or ${sc.inputs.retirementAge + 3}? Show both.`,
      (sc) => `What's the difference between retiring at ${sc.inputs.retirementAge} and ${sc.inputs.retirementAge + 3}?`,
    ],
    args: (sc) => ({
      variants: [
        { label: `Retire ${sc.inputs.retirementAge}`, overrides: { retirementAge: sc.inputs.retirementAge } },
        { label: `Retire ${sc.inputs.retirementAge + 3}`, overrides: { retirementAge: sc.inputs.retirementAge + 3 } },
      ],
    }),
    explainFrom: 'compare',
  },
  {
    tool: 'compare_scenarios',
    questions: [
      (sc) => `Compare taking CPP at ${sc.inputs.cppStartAge ?? 65} vs 70.`,
      (sc) => `CPP at ${sc.inputs.cppStartAge ?? 65} or defer to 70 — show me both.`,
    ],
    args: (sc) => ({
      variants: [
        { label: `CPP at ${sc.inputs.cppStartAge ?? 65}`, overrides: { cppStartAge: sc.inputs.cppStartAge ?? 65 } },
        { label: 'CPP at 70', overrides: { cppStartAge: 70 } },
      ],
    }),
    explainFrom: 'compare',
  },
  {
    tool: 'run_monte_carlo',
    questions: [
      () => 'What are the odds my money lasts?',
      () => 'Run the Monte Carlo simulation.',
      () => 'How likely is my plan to succeed across different markets?',
    ],
    args: () => ({ runs: 500 }),
    explainFrom: 'monteCarlo',
  },
  {
    tool: 'solve_spending',
    questions: [
      () => 'How much can I safely spend each year?',
      () => 'What annual spending is sustainable?',
      () => 'Solve for the spending my plan can support.',
    ],
    args: () => ({ targetSuccessRate: 0.9, runs: 500 }),
    explainFrom: 'solve',
  },
  {
    tool: 'get_scenario',
    questions: [
      () => 'What accounts do I have?',
      () => 'Show me my account balances.',
      () => 'Read my current accounts.',
    ],
    args: () => ({ section: 'accounts' }),
    explainFrom: 'none', // raw JSON block (no $/%) — tool-call exemplar only
  },
  {
    tool: 'get_scenario',
    questions: [
      () => 'What are my CPP and OAS details?',
      () => 'Show my government benefits.',
    ],
    args: () => ({ section: 'benefits' }),
    explainFrom: 'none',
  },
  {
    tool: 'get_schedule',
    questions: [
      (sc) => `Show my year-by-year balances from ${sc.inputs.retirementAge} to ${sc.inputs.maxAge}.`,
      (sc) => `Walk me through the projection every few years.`,
    ],
    args: (sc) => ({ fromAge: sc.inputs.retirementAge, toAge: sc.inputs.maxAge, stride: 5 }),
    explainFrom: 'none', // large multi-line table — tool-call exemplar only
  },
  {
    tool: 'run_strategies',
    questions: [
      () => 'What levers would help my plan most?',
      () => 'Which changes improve my sustainable spending?',
      () => 'Explore the strategies that could help.',
    ],
    args: () => ({ maxVariants: 5 }),
    explainFrom: 'none',
  },
  {
    tool: 'list_scenarios',
    questions: [
      () => 'What plans do I have saved?',
      () => 'List my scenarios.',
    ],
    args: () => ({}),
    explainFrom: 'none',
  },
];

// ---------------------------------------------------------------------------
// Executor plumbing
// ---------------------------------------------------------------------------

function contextFor(sc: NamedScenario): ToolContext {
  return {
    inputs: sc.inputs,
    config: testConfig(),
    scenarioName: sc.name,
    scenarioList: SCENARIOS.map((x) => ({ id: x.id, name: x.name })),
    activeScenarioId: sc.id,
  };
}

function runRead(sc: NamedScenario, tool: string, args: Record<string, unknown>): string {
  const outcome = executeToolCall(contextFor(sc), { id: 'mint-1', name: tool, args });
  if (outcome.kind === 'error') throw new Error(`mint ${tool} failed for ${sc.id}: ${outcome.content}`);
  if (outcome.kind === 'mutation') throw new Error(`mint ${tool} unexpectedly produced a mutation for ${sc.id}`);
  return outcome.content;
}

/** Turn a real tool result into the assistant's grounded prose turn. Quote the
 *  first FIGURE-bearing line (a $ amount or %), not a bare header — that keeps
 *  the exemplar grounded in the shipped engine's real output. */
function explain(spec: ReadSpec, resultText: string): string {
  const lines = resultText.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  const headline = lines.find((l) => /[$%]/.test(l)) ?? lines[0] ?? resultText;
  const tail = 'Those are the numbers from your plan — I can show the consequences, not tell you what to choose.';
  switch (spec.explainFrom) {
    case 'verdict': return `${headline}\n\n${tail}`;
    case 'compare': return `Here's how the variants compare.\n${headline}\n\n${tail}`;
    case 'monteCarlo': return `Across the simulated market futures:\n${headline}\n\n${tail}`;
    case 'solve': return `${headline}\n\n${tail}`;
    case 'none': throw new Error(`explain() called for a 'none' spec`);
  }
}

// ---------------------------------------------------------------------------
// Read-tool records (tool-call + tool-followup), paraphrase × scenario sweep
// ---------------------------------------------------------------------------

export function mintReadRecords(evalEvery = 5): CorpusRecord[] {
  const records: CorpusRecord[] = [];
  let seq = 0;
  for (const sc of SCENARIOS) {
    for (const spec of READ_SPECS) {
      const args = spec.args(sc);
      // Run the engine ONCE per (spec, scenario) — all paraphrases share the
      // same args, hence the same real result.
      const resultText = spec.explainFrom === 'none' ? null : runRead(sc, spec.tool, args);
      for (const q of spec.questions) {
        const question = q(sc);
        const split = ++seq % evalEvery === 0 ? 'eval' : 'train';
        const base = `${spec.tool}:${sc.id}:q${seq}`;

        records.push({
          id: `${base}:call`, split, kind: 'tool-call', scenarioId: sc.id,
          messages: [
            { role: 'user', content: question },
            { role: 'assistant', content: emitToolCall(spec.tool, args) },
          ],
          expect: { toolName: spec.tool },
        });

        if (spec.explainFrom === 'none' || resultText === null) continue;
        records.push({
          id: `${base}:follow`, split, kind: 'tool-followup', scenarioId: sc.id,
          messages: [
            { role: 'user', content: question },
            { role: 'assistant', content: emitToolCall(spec.tool, args) },
            { role: 'user', content: wrapToolResult(resultText) },
            { role: 'assistant', content: explain(spec, resultText) },
          ],
          expect: {
            toolName: spec.tool,
            mustContain: ['consequences'],
            mustNotContain: ['you should', 'I recommend', 'you ought to'],
          },
        });
      }
    }
  }
  return records;
}

// ---------------------------------------------------------------------------
// Mutation-tool records (propose_*/set_scenario_value/remember/recall/...).
// These teach the model to emit the RIGHT proposal call for a change request,
// and — after the user's confirm — to acknowledge without re-proposing. The
// engine isn't needed for the call itself (a mutation pauses for confirm), so
// these are minted from templates over the same scenarios.
// ---------------------------------------------------------------------------

interface MutationSpec {
  tool: string;
  questions: Array<(sc: NamedScenario) => string>;
  args: (sc: NamedScenario) => Record<string, unknown>;
  /** What the assistant says after the user approves the confirm card. */
  approvedReply: (sc: NamedScenario) => string;
  /** What it says after the user rejects. */
  rejectedReply: (sc: NamedScenario) => string;
}

const MUTATION_SPECS: MutationSpec[] = [
  {
    tool: 'set_scenario_value',
    questions: [
      (sc) => `Change my retirement age to ${sc.inputs.retirementAge + 2}.`,
      (sc) => `Set retirement at ${sc.inputs.retirementAge + 2}.`,
    ],
    args: (sc) => ({ field: 'retirementAge', value: sc.inputs.retirementAge + 2 }),
    approvedReply: (sc) => `Done — retirement age updated to ${sc.inputs.retirementAge + 2}. Want me to re-run the projection on the new plan?`,
    rejectedReply: () => 'No problem — I\'ve left the plan unchanged.',
  },
  {
    tool: 'set_scenario_value',
    questions: [
      (sc) => `Lower my spending to $${Math.round(sc.inputs.desiredSpending * 0.9).toLocaleString('en-CA')} a year.`,
    ],
    args: (sc) => ({ field: 'desiredSpending', value: Math.round(sc.inputs.desiredSpending * 0.9) }),
    approvedReply: () => 'Updated. I can run the projection to show what that does to the plan.',
    rejectedReply: () => 'Understood — no change made.',
  },
  {
    tool: 'propose_patch',
    questions: [
      () => 'Delay both CPP and OAS to 70.',
      () => 'Push CPP and OAS out to age 70.',
    ],
    args: () => ({ changes: { cppStartAge: 70, oasStartAge: 70 } }),
    approvedReply: () => 'Both benefit start ages moved to 70. Want me to compare that against the current timing?',
    rejectedReply: () => 'Okay — benefit timing left as is.',
  },
  {
    tool: 'propose_income',
    questions: [
      () => 'I have a small pension that pays $800 a month starting at 65.',
      () => 'Add my work pension of $800/month from age 65.',
    ],
    args: () => ({ label: 'Work pension', kind: 'pension', annualAmount: 9600, startAge: 65, endAge: null, indexedToCpi: true }),
    approvedReply: () => 'Pension added. I can show how it changes the drawdown.',
    rejectedReply: () => 'No problem — pension not added.',
  },
  {
    tool: 'propose_cash_event',
    questions: [
      () => 'I expect a $50,000 inheritance around age 70.',
      () => 'Add a one-time $50k inflow when I\'m 70.',
    ],
    args: () => ({ label: 'Inheritance', direction: 'inflow', amount: 50000, age: 70, account: 'taxable' }),
    approvedReply: () => 'Inheritance added as a one-time inflow at 70. Want me to re-run the projection?',
    rejectedReply: () => 'Understood — inheritance not added.',
  },
  {
    tool: 'propose_fhsa',
    questions: [
      () => 'I want to start saving for a first home — set up an FHSA.',
      () => 'Open an FHSA and put in $8,000 a year.',
    ],
    args: (sc) => ({ changes: { enabled: true, balance: 0, contribution: 8000, contributionBasis: 0, openAge: sc.inputs.currentAge } }),
    approvedReply: () => 'FHSA set up — deductible in, tax-sheltered growth, and it transfers to your RRSP at retirement if you don\'t buy. Want me to show the effect on your plan?',
    rejectedReply: () => 'Okay — FHSA left off.',
  },
  {
    tool: 'propose_debt',
    questions: [
      () => 'Add my mortgage — $400,000 left at 5.1% with a $2,400 monthly payment.',
      () => 'I still owe on the house. Model the mortgage in.',
    ],
    // Debt args are the debt fields flat (the tool's schema omits only `id`).
    // startAge omitted → payments start now; endAge omitted → until paid off.
    args: () => ({ label: 'Mortgage', kind: 'mortgage', balance: 400000, interestRate: 0.051, monthlyPayment: 2400 }),
    approvedReply: () => 'Mortgage added — the payments come out of your spending each year until it\'s paid off, so it drags on the plan until then. Want me to show what it does to your numbers?',
    rejectedReply: () => 'Okay — debt left out of the plan.',
  },
  {
    tool: 'propose_debt',
    questions: [
      () => 'I carry a credit-card balance of $18,000 at 19.9%, paying $600 a month.',
    ],
    args: () => ({ label: 'Credit card', kind: 'creditCard', balance: 18000, interestRate: 0.199, monthlyPayment: 600 }),
    approvedReply: () => 'Credit-card debt added. At that rate the interest is a real drag — the payments are funded from spending until the balance is gone. I can run the projection to show the effect.',
    rejectedReply: () => 'Understood — card balance not added.',
  },
  {
    tool: 'manage_debt',
    questions: [
      () => 'Actually, my mortgage balance is down to $350,000 now.',
      () => 'Update the mortgage — I\'ve paid it down to $350k.',
    ],
    args: () => ({ action: 'update', target: 'Mortgage', changes: { balance: 350000 } }),
    approvedReply: () => 'Mortgage balance updated to $350,000. Want me to re-run the projection on the new figure?',
    rejectedReply: () => 'No problem — mortgage left as it was.',
  },
  {
    tool: 'manage_debt',
    questions: [
      () => 'I paid off the credit card — take it out of the plan.',
    ],
    args: () => ({ action: 'remove', target: 'Credit card' }),
    approvedReply: () => 'Credit-card debt removed — that frees up the payment going forward. I can re-run the plan to show the difference.',
    rejectedReply: () => 'Okay — card debt kept in the plan.',
  },
  {
    tool: 'propose_market_periods',
    questions: [
      () => 'Model a crash — markets drop 30% the year I turn 68.',
      () => 'What if there\'s a 30% market crash right when my drawdown starts?',
    ],
    args: () => ({ periods: [{ age: 68, return: -0.30 }] }),
    approvedReply: () => 'Crash year added — the projection follows the hypothesis curve for that age, then eases back to your flat expected return. I can run it to show the hit.',
    rejectedReply: () => 'Okay — hypothesis left out.',
  },
  {
    tool: 'propose_market_periods',
    questions: [
      () => 'Let\'s stress-test the plan — early years volatile, then a strong recovery.',
      () => 'Model a rough patch followed by a rebound in the markets.',
    ],
    args: () => ({ periods: [
      { age: 68, return: -0.30, volatility: 0.30 },
      { age: 70, return: 0.10 },
    ] }),
    approvedReply: () => 'Hypothesis set — the crash year shapes both the projection and the Monte Carlo spread, then the curve returns to your flat baseline. Want me to re-run it?',
    rejectedReply: () => 'Okay — hypothesis not added.',
  },
  {
    tool: 'propose_market_periods',
    questions: [
      () => 'Actually, forget that crash scenario — go back to the flat assumption.',
      () => 'Clear that market hypothesis — use the constant return again.',
    ],
    args: () => ({ periods: [] }),
    approvedReply: () => 'Cleared — back to your flat expected return for the whole horizon.',
    rejectedReply: () => 'Okay — hypothesis kept.',
  },
  {
    tool: 'remember',
    questions: [
      () => 'Remember that I plan to downsize the house in a few years.',
    ],
    args: () => ({ text: 'User plans to downsize the house in a few years.', scope: 'global', importance: 0.6, keywords: ['housing', 'downsize', 'home', 'move'] }),
    approvedReply: () => 'Got it — I\'ll remember that.',
    rejectedReply: () => 'Okay, I won\'t keep that.',
  },
  {
    tool: 'open_scenario',
    questions: [
      () => 'Switch to my other plan.',
    ],
    args: (sc) => ({ name: sc.name }),
    approvedReply: () => 'Switched. What would you like to look at?',
    rejectedReply: () => 'Staying on the current plan.',
  },
  {
    tool: 'save_scenario_as',
    questions: [
      () => 'Keep this variant as its own plan called "Early retirement".',
    ],
    args: () => ({ name: 'Early retirement' }),
    approvedReply: () => 'Saved as a new scenario — the original is untouched.',
    rejectedReply: () => 'Okay, not saved.',
  },
];

/** Mint mutation exemplars: the proposal call, plus the post-confirm
 *  acknowledgement for both APPROVED and REJECTED outcomes. The approve/reject
 *  turn is where the model must NOT re-propose — a common small-model failure. */
export function mintMutationRecords(evalEvery = 5): CorpusRecord[] {
  const records: CorpusRecord[] = [];
  let seq = 0;
  for (const sc of SCENARIOS) {
    for (const spec of MUTATION_SPECS) {
      const args = spec.args(sc);
      for (const q of spec.questions) {
        const question = q(sc);
        const split = ++seq % evalEvery === 0 ? 'eval' : 'train';
        const base = `${spec.tool}:${sc.id}:q${seq}`;

        records.push({
          id: `${base}:call`, split, kind: 'mutation-confirm', scenarioId: sc.id,
          messages: [
            { role: 'user', content: question },
            { role: 'assistant', content: emitToolCall(spec.tool, args) },
          ],
          expect: { toolName: spec.tool },
        });

        records.push({
          id: `${base}:approved`, split, kind: 'mutation-confirm', scenarioId: sc.id,
          messages: [
            { role: 'user', content: question },
            { role: 'assistant', content: emitToolCall(spec.tool, args) },
            { role: 'user', content: mutationFeedback(true, spec.tool, JSON.stringify(args)) },
            { role: 'assistant', content: spec.approvedReply(sc) },
          ],
          expect: { toolName: spec.tool, mustNotContain: ['TOOL_CALL'] },
        });

        records.push({
          id: `${base}:rejected`, split, kind: 'mutation-confirm', scenarioId: sc.id,
          messages: [
            { role: 'user', content: question },
            { role: 'assistant', content: emitToolCall(spec.tool, args) },
            { role: 'user', content: mutationFeedback(false, spec.tool, JSON.stringify(args)) },
            { role: 'assistant', content: spec.rejectedReply(sc) },
          ],
          expect: { toolName: spec.tool, mustNotContain: ['TOOL_CALL'] },
        });
      }
    }
  }
  return records;
}



const ADVICE_FREE_REDIRECT =
  'I can run the numbers and show you the consequences of each option, but I can\'t tell you which to choose — that call is yours.';

/** Recommendation-seeking asks the model must deflect (calculator-not-planner). */
const REFUSAL_ASKS: Array<(sc: NamedScenario) => string> = [
  () => 'Should I retire at 60 or 65?',
  () => 'What\'s the best age to take CPP?',
  () => 'Should I draw down my RRSP first or my TFSA?',
  () => 'Is a reverse mortgage a good idea for me?',
  () => 'Tell me what to do with my savings.',
];

/** Ambiguous asks where the right move is a clarifying question, not a tool. */
const CLARIFY_ASKS: Array<{ ask: (sc: NamedScenario) => string; clarify: string }> = [
  { ask: () => 'What about my wife?', clarify: 'Would you like me to add a spouse to the plan, or open a plan that already has one?' },
  { ask: () => 'Can you bump that up a bit?', clarify: 'Which value would you like me to change, and to what?' },
  { ask: () => 'Will I be okay?', clarify: 'Do you mean whether your savings last to the end of the plan, or how much you can spend each year?' },
];

/** Plain-language concept explainers — no tool needed, but the model should
 *  still offer to ground it in the user's real numbers. */
const DOMAIN_EXPLAIN: Array<{ ask: string; answer: string }> = [
  {
    ask: 'What is GIS clawback?',
    answer: 'The Guaranteed Income Supplement is reduced as your other income rises — roughly 50 cents lost per extra dollar of taxable income (excluding OAS). That\'s why big RRSP/RRIF withdrawals can wipe out GIS. I can run your projection to show whether clawback affects your plan.',
  },
  {
    ask: 'What does deferring CPP to 70 do?',
    answer: 'CPP grows 0.7% for every month you delay past 65, up to +42% at 70 — and it\'s indexed for life. Taking it early cuts it 0.6% per month, −36% at 60. I can compare the timing options on your real numbers.',
  },
  {
    ask: 'What is a RRIF meltdown?',
    answer: 'After 71 you must draw a rising minimum from your RRIF whether you need it or not, and it\'s fully taxable. A "meltdown" spreads or accelerates withdrawals earlier to avoid a big taxed lump and OAS/GIS clawback later. I can model it on your plan.',
  },
];

export function mintGuardrailRecords(): CorpusRecord[] {
  const records: CorpusRecord[] = [];
  let seq = 0;
  for (const sc of SCENARIOS) {
    for (const ask of REFUSAL_ASKS) {
      records.push({
        id: `refusal:${sc.id}:${seq++}`, split: 'train', kind: 'refusal', scenarioId: sc.id,
        messages: [
          { role: 'user', content: ask(sc) },
          { role: 'assistant', content: `${ADVICE_FREE_REDIRECT} Want me to run the comparison?` },
        ],
        expect: { mustNotContain: ['you should', 'the best is', 'i recommend', 'retire at 60', 'take cpp at'] },
      });
    }
    for (const { ask, clarify } of CLARIFY_ASKS) {
      records.push({
        id: `clarify:${sc.id}:${seq++}`, split: 'train', kind: 'clarify', scenarioId: sc.id,
        messages: [
          { role: 'user', content: ask(sc) },
          { role: 'assistant', content: clarify },
        ],
        expect: { mustNotContain: ['TOOL_CALL'] },
      });
    }
  }
  for (const { ask, answer } of DOMAIN_EXPLAIN) {
    records.push({
      id: `domain:${seq++}`, split: 'train', kind: 'domain-explain', scenarioId: 'any',
      messages: [
        { role: 'user', content: ask },
        { role: 'assistant', content: answer },
      ],
      expect: { mustNotContain: ['you should', 'i recommend'] },
    });
  }
  return records;
}

// ---------------------------------------------------------------------------
// Option-framing records: the behavior the user asked the model to be GOOD at.
// "What can I optimize / what are my options?" is NOT an advice ask to deflect
// — it's a request to survey the levers. The right move is: run_strategies to
// ground the options in THIS person's numbers, then frame the trade-offs in
// plain words WITHOUT recommending one (calculator-not-planner). This is the
// "understands the scenario/person, shows options, never dictates" register.
// ---------------------------------------------------------------------------

const OPTION_ASKS: Array<(sc: NamedScenario) => string> = [
  () => 'What can I do to improve my retirement?',
  () => 'What are my options for making my savings last longer?',
  () => 'Where can I optimize my plan?',
  () => 'What levers do I have to work with?',
  () => 'How could I spend more without running out?',
];

/** The hand-the-choice-back closers, rotated so the model doesn't parrot one
 *  sentence. All frame the trade-off and return the decision to the user —
 *  the option-framing register, varied. */
const OPTION_CLOSERS = [
  'Which of those is worth trading off depends on what you value — I can run any of them side by side on your numbers so you can see the consequences, but the choice is yours.',
  'Which lever to pull is your call — I can run any of them on your numbers so you see exactly what each one does before you decide.',
  'Each of those trades something off — I can put them side by side on your plan so the consequences are concrete, and then it\'s up to you.',
  'There\'s no single right answer here — it depends on what you value most. I can model whichever of these you want to see on your actual numbers.',
];

/** Turn a real run_strategies result into the option-framing reply: name the
 *  top levers + their numbers, framed as "here's what moves the needle and by
 *  how much", with an explicit "your call" close — never "you should". */
function frameOptions(resultText: string, closerIndex = 0): string {
  const lines = resultText.split('\n').map((l) => l.trim()).filter(Boolean);
  const baseline = lines.find((l) => l.startsWith('CURRENT plan')) ?? '';
  // Pull up to two strategy rows (the "$x/yr (+$y vs current)" lines) as the
  // concrete options, so the reply is grounded in the real deltas.
  const leverRows = lines.filter((l) => /sustainable spending \$/.test(l)).slice(0, 2);
  const options = leverRows.length
    ? `For example:\n${leverRows.map((l) => `  • ${l}`).join('\n')}`
    : '';
  return [
    `Every plan has a few levers that move the needle — benefit timing, withdrawal order, how much you draw, and (if it applies) a pension or your home. ${baseline}`,
    options,
    OPTION_CLOSERS[closerIndex % OPTION_CLOSERS.length],
  ].filter(Boolean).join('\n');
}

/** Mint option-framing exemplars: question → run_strategies call → real result
 *  → grounded, non-advisory survey of the options. Two records per (ask ×
 *  scenario): the tool-call and the follow-up. */
export function mintOptionFramingRecords(evalEvery = 5): CorpusRecord[] {
  const records: CorpusRecord[] = [];
  let seq = 0;
  for (const sc of SCENARIOS) {
    const args = { maxVariants: 5 };
    const resultText = runRead(sc, 'run_strategies', args);
    for (const q of OPTION_ASKS) {
      const question = q(sc);
      const split = ++seq % evalEvery === 0 ? 'eval' : 'train';
      const base = `option-framing:${sc.id}:q${seq}`;
      records.push({
        id: `${base}:call`, split, kind: 'option-framing', scenarioId: sc.id,
        messages: [
          { role: 'user', content: question },
          { role: 'assistant', content: emitToolCall('run_strategies', args) },
        ],
        expect: { toolName: 'run_strategies' },
      });
      records.push({
        id: `${base}:follow`, split, kind: 'option-framing', scenarioId: sc.id,
        messages: [
          { role: 'user', content: question },
          { role: 'assistant', content: emitToolCall('run_strategies', args) },
          { role: 'user', content: wrapToolResult(resultText) },
          { role: 'assistant', content: frameOptions(resultText, seq) },
        ],
        expect: {
          toolName: 'run_strategies',
          mustContain: ['lever'],
          mustNotContain: ['you should', 'i recommend', 'the best option', 'you ought to'],
        },
      });
    }
  }
  return records;
}

/** The full corpus: engine-grounded reads + mutations + guardrail + options +
 *  domain knowledge. */
export function mintCorpus(): CorpusRecord[] {
  return [
    ...mintReadRecords(),
    ...mintMutationRecords(),
    ...mintGuardrailRecords(),
    ...mintOptionFramingRecords(),
    ...mintDomainKnowledgeRecords(),
  ];
}

/** Serialize records to JSONL (one record per line). */
export function toJsonl(records: CorpusRecord[]): string {
  return records.map((r) => JSON.stringify(r)).join('\n') + '\n';
}
