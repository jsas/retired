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
import { canonicalView, pageForView, pageTitleLine, type View } from '@retired/mcp-tools/navigation';
import { testConfig } from '@retired/engine-core/test/helpers';
import type { ChatMessage, CorpusRecord } from './buildCorpus';
import { emitToolCall, wrapToolResult, mutationFeedback, navigationFeedback, ambientPageLine } from './protocol';
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
      // Boundary paraphrases (post-checkpoint-1000 gate failures): phrases that
      // LOOK like a read (get_scenario / get_schedule) but should route to
      // run_projection. Grounded by mint.test's intended-tool assertion.
      () => 'How is my plan doing right now?',
      () => 'Is my retirement plan healthy?',
      () => 'Tell me how my plan performs.',
      () => 'Give me a health-check on my retirement plan.',
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
      // Contrast-discrimination (post-checkpoint-1000): the multiple-call slip
      // clusters on compare_scenarios. Teach that ONE call produces ONE answer;
      // subsequent explanation is prose, not a second call.
      (sc) => `Retiring at ${sc.inputs.retirementAge} or ${sc.inputs.retirementAge + 3} — one variant, not a list.`,
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
      // Boundary vs run_projection: "different markets" reads like a plan
      // outcome; route the ODDS question to the MC tool, not run_projection.
      () => 'Estimate the probability my plan works.',
      () => 'What are the chances this retires me comfortably?',
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
      // Boundary vs run_strategies: a TARGET-DATUM question ("how much") routes
      // to solve_spending; "what should I compare" routes to run_strategies.
      () => 'How much should I aim to spend yearly?',
      () => 'Tell me the safe yearly spend.',
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
      // Enum-value minting (post-checkpoint-1000): model sometimes invents
      // sections; reinforce the exact enum set (full/summary/accounts/
      // benefits/spending/spouse). 'benefits' covers projection-ish queries;
      // 'accounts' balances/holdings; 'summary' for the overview.
      () => 'Give me the overall summary of my plan.',
      () => 'Show my account balances section.',
    ],
    args: (sc) => {
      // Alternate across real enum values by scenario so several are
      // exercised (silences the enum-invention slip).
      const sections = ['summary', 'accounts', 'benefits', 'spending'];
      const idx = SCENARIOS.indexOf(sc);
      return { section: sections[idx % sections.length] };
    },
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
      // Boundary vs solve_spending: a sweep-of-options question routes to
      // run_strategies (today's ask "compare candidate levers") — solve only
      // when the user fixes a target datum.
      () => 'Compare some candidate levers for my plan.',
      () => 'Show me a few ways to boost my plan.',
      // Schema-edge mint: 'categories' accepts EITHER the label/value/overrides
      // object shape OR the compact string list — both are valid — and the
      // model keeps emitting the wrong one after the schema check. Exercise
      // both shapes so the Zod union-training signal doesn't asymmetrize.
      () => 'Compare CPP at 70 vs 72.',
      () => 'Check OAS at 65 vs 70.',
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
  // -------------------------------------------------------------------------
  // Contrastive boundary minting (post-v2 gate): for the top confusion pairs
  // from mineFailures, mint questions whose wording deliberately SITS ON THE
  // BOUNDARY — the user's phrasing could be either tool, but we ground the
  // RIGHT one. Model learns the discriminative feature via repetition, not
  // via explicit instruction.
  //
  // Pair → discriminators we keep distinct:
  //   compare_scenarios  — needs MORE-THAN-ONE option (variant labels, "vs",
  //                         "or", "either") in the question
  //   run_projection     — one named what-if (NOT a versus list)
  //   get_scenario       — READ the plan, not run it
  //   solve_spending     — needs a target datum phrase ("how much")
  //   run_strategies     — needs an exploration sweep ("levers", "boost")
  //   get_schedule       — needs a year-by-year / schedule / table phrase
  //   run_monte_carlo    — needs a probability/simulation/odds question
  // -------------------------------------------------------------------------
  {
    // compare_scenarios vs run_projection — 56+14 = 70 fails previously. The
    // projections below all have a single "what-if" (one number), NOT a vs-list.
    tool: 'run_projection',
    questions: [
      (sc) => `What if I retire at ${sc.inputs.retirementAge + 3}?`,
      (sc) => `Just run it with retirement at ${sc.inputs.retirementAge + 3}.`,
      (sc) => `Show me my plan if I retire at ${sc.inputs.retirementAge + 3} alone.`,
      (sc) => `One what-if: retire at ${sc.inputs.retirementAge + 3}.`,
      (sc) => `Single scenario, retirement at ${sc.inputs.retirementAge + 3}.`,
    ],
    args: (sc) => ({ overrides: { retirementAge: sc.inputs.retirementAge + 3 } }),
    explainFrom: 'verdict',
  },
  {
    // get_scenario vs run_projection — 37+19 = 56 fails. Reads of the plan.
    tool: 'get_scenario',
    questions: [
      () => 'Just read my plan as-is.',
      () => "Don't run anything — show what I have today.",
      () => 'Walk me through the inputs I gave you.',
      () => 'Show the plan inputs I saved, nothing more.',
      () => 'Read the current plan — no projection, just the inputs.',
    ],
    args: () => ({ section: 'summary' }),
    explainFrom: 'none',
  },
  {
    // solve_spending vs compare_scenarios — 22 fails. 'how much' → solver.
    tool: 'solve_spending',
    questions: [
      () => 'How much yearly spend gives me 90% success?',
      () => "Solve for a safe spending target; don't compare options yet.",
      () => 'Figure out one number: the safe yearly spend.',
      () => 'Calculate my affordable yearly spend.',
    ],
    args: () => ({ targetSuccessRate: 0.9, runs: 300 }),
    explainFrom: 'solve',
  },
  {
    // run_strategies vs compare_scenarios — 27 fails. Sweep-of-levers, not
    // a pinned compare.
    tool: 'run_strategies',
    questions: [
      () => 'Scan all the levers and rank what helps.',
      () => "Don't pin two options yet — tell me which levers matter.",
      () => 'Find the best improvements across CPP/OAS/pension timing.',
      () => "Broad sweep: which strategies do well on my plan?",
    ],
    args: () => ({ maxVariants: 6 }),
    explainFrom: 'none',
  },
  {
    // get_schedule vs get_scenario / run_projection — 18 fails. Year-by-year
    // wording → schedule.
    tool: 'get_schedule',
    questions: [
      (sc) => `Year-by-year table from ${sc.inputs.retirementAge} to ${sc.inputs.maxAge}.`,
      (sc) => `Show the schedule, ages ${sc.inputs.retirementAge} through ${sc.inputs.maxAge}.`,
      (sc) => `Walk me through the table between ${sc.inputs.retirementAge} and ${sc.inputs.maxAge}.`,
    ],
    args: (sc) => ({ fromAge: sc.inputs.retirementAge, toAge: sc.inputs.maxAge, stride: 3 }),
    explainFrom: 'none',
  },
];

// ---------------------------------------------------------------------------
// Contrastive negative-pair minting (L3.5). For the top confusion pair from
// mineFailures, mint an explicit "the right call here is X, not Y" assistant
// reply. Format: prose first (plain-text explanation), then ONE TOOL_CALL
// line — still protocol-valid.
// ---------------------------------------------------------------------------

interface ContrastPair {
  correct: string;
  wrong: string;
  question: (sc: NamedScenario) => string;
  args: (sc: NamedScenario) => Record<string, unknown>;
  /** One-sentence rationale distinguishing the two tools for THIS question. */
  rationale: (sc: NamedScenario) => string;
}

const CONTRAST_PAIRS: ContrastPair[] = [
  // compare_scenarios magnet (largest single cluster).
  {
    correct: 'run_projection',
    wrong: 'compare_scenarios',
    question: (sc) => `What if I retire at ${sc.inputs.retirementAge + 3}?`,
    args: (sc) => ({ overrides: { retirementAge: sc.inputs.retirementAge + 3 } }),
    rationale: () =>
      'Single what-if (one number change) is a run_projection call — ' +
      'compare_scenarios needs at least two variant labels.',
  },
  {
    correct: 'get_scenario',
    wrong: 'compare_scenarios',
    question: () => 'Show me my plan as-is.',
    args: () => ({ section: 'summary' }),
    rationale: () =>
      'Plain read of the plan is get_scenario. compare_scenarios requires ' +
      'two-or-more variant options, which a bare "as-is" lacks.',
  },
  {
    correct: 'run_monte_carlo',
    wrong: 'compare_scenarios',
    question: () => 'What are the odds my plan succeeds?',
    args: () => ({ runs: 500 }),
    rationale: () =>
      'Probability across markets is a Monte Carlo simulation. ' +
      "compare_scenarios picks two named variants — 'odds' isn't a variant.",
  },
  {
    correct: 'solve_spending',
    wrong: 'compare_scenarios',
    question: () => 'How much can I safely spend each year?',
    args: () => ({ targetSuccessRate: 0.9, runs: 300 }),
    rationale: () =>
      "'How much' is a target-datum question — solve_spending computes one " +
      'number. compare_scenarios compares two options, not a solve target.',
  },
  {
    correct: 'run_strategies',
    wrong: 'compare_scenarios',
    question: () => 'Which levers would help my plan most?',
    args: () => ({ maxVariants: 5 }),
    rationale: () =>
      "A sweep-of-levers is run_strategies. compare_scenarios compares " +
      'pinned variants — lever exploration is a strategy scan, not a pin.',
  },
  {
    correct: 'get_schedule',
    wrong: 'compare_scenarios',
    question: (sc) => `Year-by-year table, ages ${sc.inputs.retirementAge}–${sc.inputs.maxAge}.`,
    args: (sc) => ({ fromAge: sc.inputs.retirementAge, toAge: sc.inputs.maxAge, stride: 3 }),
    rationale: () =>
      'A schedule/table request is get_schedule. compare_scenarios produces ' +
      'a verdict comparison, not a year-by-year table.',
  },
  {
    correct: 'get_scenario',
    wrong: 'run_projection',
    question: () => 'Read my plan inputs, no projection.',
    args: () => ({ section: 'summary' }),
    rationale: () =>
      'When the user says "just read them" they want get_scenario. ' +
      'run_projection runs the engine — not a read.',
  },
  {
    correct: 'solve_spending',
    wrong: 'run_strategies',
    question: () => 'Solve for the safe yearly spend.',
    args: () => ({ targetSuccessRate: 0.9, runs: 300 }),
    rationale: () =>
      "A 'solve for …' phrasing with a target datum is solve_spending. " +
      'run_strategies sweeps levers without computing one target number.',
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

  // Contrastive negative-pair records (L3.5): explicit "the right call here is
  // X, not Y" replies. Skips the eval split — these are train-only.
  for (const sc of SCENARIOS) {
    for (const pair of CONTRAST_PAIRS) {
      const q = pair.question(sc);
      const args = pair.args(sc);
      const rationale = pair.rationale(sc);
      seq += 1;
      const base = `contrast:${pair.correct}-vs-${pair.wrong}:${sc.id}:q${seq}`;
      records.push({
        id: `${base}:call`, split: 'train', kind: 'tool-call-contrast',
        scenarioId: sc.id,
        messages: [
          { role: 'user', content: q },
          {
            role: 'assistant',
            content:
              `${rationale} The right call here is ${pair.correct}, not ${pair.wrong}.\n` +
              emitToolCall(pair.correct, args),
          },
        ],
        expect: { toolName: pair.correct },
      });
    }
  }

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

// ---------------------------------------------------------------------------
// Navigation records (issue #141): the site-awareness layer. Where the reads
// answer "what does my plan say", these answer "where do I go to see/change it".
// The whole minter is driven off the LIVE catalog (searchablePages()), so when
// the UI is re-targeted — beta becomes the skin, a page is renamed or folded —
// the exemplars follow the same single source of truth the tools and the
// sitemap artifact use; no nav copy can rot against the routes.
//
// Two shapes the fine-tune must learn, both keyed to the ambient "you are
// currently on the X page" line (the app's buildSystemPrompt adds it; here it
// rides as a per-record SYSTEM message so a chat-template trainer conditions on
// it, while the spike's single-systemPrompt bake-off stays untouched):
//   - a "where is it" ask → find_page (and, once, that the answer is "you are
//     already here" when the user is ON the page — never propose a no-op jump)
//   - a "take me there" ask → propose_navigate confirm card, then acknowledge
//     the page OPENED (UI moved, no plan numbers to report).
// Split rotation matches the rest of the corpus. NOTE the bake-off gate
// (runGate/extractEvalSet) scores only `mintReadRecords()` eval records, so
// adding these does NOT change #112's frozen eval hash — the nav records mint
// into corpus.train.jsonl alongside everything else. The ambient current-page
// line rides as a per-record SYSTEM message (a chat-template trainer conditions
// on it), which the single-systemPrompt bake-off simply never reads.
// ---------------------------------------------------------------------------

/** One canonical destination page's worth of nav exemplars. `query` is a
 *  phrase that must rank THIS page first via find_page (mint.test asserts it,
 *  so the mapping can't silently drift from the keywords). */
interface NavSpec {
  view: View;
  query: string;
  /** Phrasings of "where does this live?" → find_page(query). */
  findAsks: Array<(sc: NamedScenario) => string>;
  /** Phrasings of "take me there" → propose_navigate. */
  goAsks: Array<(sc: NamedScenario) => string>;
}

/** Pick a human-sounding label for a go-card from the destination's title. A
 *  folded legacy view resolves to its destination, so the card names the page
 *  the user actually sees. */
function navLabel(view: View): string {
  const entry = pageForView(canonicalView(view));
  const title = (entry?.title ?? view).replace(/\s*\(.*\)$/, '');
  return `Open the ${title} page`;
}

/** Exported for the mint tests' query↔page drift guard: every `query` must
 *  rank its spec's (canonicalized) page first via the live catalog. */
export const NAV_SPECS: NavSpec[] = [
  {
    view: 'details', query: 'tfsa room',
    findAsks: [
      () => 'Where do I enter my TFSA and RRSP contribution room?',
      () => 'Which page has my account balances?',
      () => 'Where are my government benefit settings?',
    ],
    goAsks: [
      () => 'Take me to the page where I edit my accounts and balances.',
      () => 'Open my plan inputs.',
    ],
  },
  {
    view: 'eq', query: 'monte carlo',
    findAsks: [
      () => 'Where can I see the odds my money lasts?',
      () => 'Which page runs the simulation?',
    ],
    goAsks: [
      () => 'Take me to the Monte Carlo page.',
      () => 'Show me my options and what helps most.',
    ],
  },
  {
    view: 'scenarios', query: 'compare',
    findAsks: [
      () => 'Where can I compare my saved plans side by side?',
      () => 'Which page lists my saved scenarios?',
    ],
    goAsks: [
      () => 'Take me to my saved plans.',
      () => 'Open the scenario manager.',
    ],
  },
  {
    view: 'data', query: 'backup',
    findAsks: [
      () => 'Where do I back up or restore my plan?',
      () => 'How do I export everything to a file?',
    ],
    goAsks: [
      () => 'Take me to the data backup page.',
      () => 'I want to share my plan — where is that?',
    ],
  },
  {
    view: 'settings', query: 'tax tables',
    findAsks: [
      () => 'Where can I edit the tax tables?',
      () => 'Which page has the app settings?',
    ],
    goAsks: [
      () => 'Open settings.',
    ],
  },
  {
    view: 'print', query: 'print',
    findAsks: [
      () => 'Where do I get a printable summary?',
    ],
    goAsks: [
      () => 'Take me to the print page.',
    ],
  },
];

/** Run a nav tool for real (against the executor + current ctx) to capture the
 *  exact result text the model would see, including the "already here" tag. */
function runNav(sc: NamedScenario, tool: string, args: Record<string, unknown>, currentView?: View): string {
  const c: ToolContext = { ...contextFor(sc), currentView, canNavigate: true };
  const outcome = executeToolCall(c, { id: 'mint-nav', name: tool, args });
  if (outcome.kind === 'mutation' || outcome.kind === 'error') {
    throw new Error(`mint ${tool} failed for ${sc.id}: ${outcome.content}`);
  }
  return outcome.content;
}

/** Ground the find_page follow-up in the real result: name the destination page
 *  (first match's title, stripped of the "already here" tag) and its hash — the
 *  model learns to point the user somewhere concrete, not to say "somewhere". */
function explainFind(resultText: string): string {
  const firstMatch = resultText.split('\n').find((l) => /^\s*1\.\s/.test(l)) ?? '';
  // e.g. "1. Insights (you are already here) — #/steering — desc" → title + hash.
  const title = firstMatch.replace(/^\s*1\.\s+/, '').replace(/\s*\(you are already here\).*/, '').split(' — ')[0].trim();
  const hash = firstMatch.match(/#\S+/)?.[0] ?? '';
  const alreadyHere = /\(you are already here\)/.test(firstMatch);
  if (alreadyHere) {
    return `You're already on the ${title} page${hash ? ` (${hash})` : ''} — it's what's in front of you right now.`;
  }
  return `The ${title} page is where that lives${hash ? ` (open ${hash})` : ''}. It's one of the app's pages — I can take you there if you'd like.`;
}

function mintNavRecordsFor(sc: NamedScenario, seqRef: { n: number }, evalEvery: number): CorpusRecord[] {
  const records: CorpusRecord[] = [];
  for (const spec of NAV_SPECS) {
    const here = canonicalView(spec.view);
    const findArgs = { query: spec.query };
    const goArgs = { view: spec.view, label: navLabel(spec.view) };

    // (a) "where is it" — find_page, with the user somewhere ELSE (the common
    // case): the follow-up points at the destination.
    for (const ask of spec.findAsks) {
      const question = ask(sc);
      const split = ++seqRef.n % evalEvery === 0 ? 'eval' : 'train';
      const base = `find_page:${sc.id}:q${seqRef.n}`;
      // Ambient line: put the user on a DIFFERENT reachable page so the answer
      // is a real redirect. projection (Dashboard) is always reachable.
      const ambient = here === 'projection' ? 'settings' : 'projection';
      records.push({
        id: `${base}:call`, split, kind: 'navigation', scenarioId: sc.id,
        messages: [
          { role: 'system', content: ambientPageLine(ambient) },
          { role: 'user', content: question },
          { role: 'assistant', content: emitToolCall('find_page', findArgs) },
        ],
        expect: { toolName: 'find_page' },
      });
      const resultText = runNav(sc, 'find_page', findArgs, ambient);
      records.push({
        id: `${base}:follow`, split, kind: 'navigation', scenarioId: sc.id,
        messages: [
          { role: 'system', content: ambientPageLine(ambient) },
          { role: 'user', content: question },
          { role: 'assistant', content: emitToolCall('find_page', findArgs) },
          { role: 'user', content: wrapToolResult(resultText) },
          { role: 'assistant', content: explainFind(resultText) },
        ],
        expect: {
          toolName: 'find_page',
          mustNotContain: ['you should', 'i recommend', 'you ought to'],
        },
      });
    }

    // (b) "where is it" WHEN THE USER IS ALREADY ON THE PAGE — the
    // page-context-awareness case: find_page must return the already-here tag
    // and the reply must say so, never propose a jump that goes nowhere.
    {
      const question = `Where do I set my ${spec.query}?`;
      const split = ++seqRef.n % evalEvery === 0 ? 'eval' : 'train';
      const base = `find_page-here:${sc.id}:q${seqRef.n}`;
      records.push({
        id: `${base}:call`, split, kind: 'navigation', scenarioId: sc.id,
        messages: [
          { role: 'system', content: ambientPageLine(here) },
          { role: 'user', content: question },
          { role: 'assistant', content: emitToolCall('find_page', findArgs) },
        ],
        expect: { toolName: 'find_page' },
      });
      const resultText = runNav(sc, 'find_page', findArgs, here);
      records.push({
        id: `${base}:follow`, split, kind: 'navigation', scenarioId: sc.id,
        messages: [
          { role: 'system', content: ambientPageLine(here) },
          { role: 'user', content: question },
          { role: 'assistant', content: emitToolCall('find_page', findArgs) },
          { role: 'user', content: wrapToolResult(resultText) },
          { role: 'assistant', content: explainFind(resultText) },
        ],
        expect: {
          toolName: 'find_page',
          mustContain: ['already on'],
          mustNotContain: ['TOOL_CALL', 'you should', 'i recommend'],
        },
      });
    }

    // (c) "take me there" — propose_navigate card, then approve/reject.
    for (const ask of spec.goAsks) {
      const question = ask(sc);
      const split = ++seqRef.n % evalEvery === 0 ? 'eval' : 'train';
      const base = `propose_navigate:${sc.id}:q${seqRef.n}`;
      records.push({
        id: `${base}:call`, split, kind: 'navigation', scenarioId: sc.id,
        messages: [
          { role: 'system', content: ambientPageLine('projection') },
          { role: 'user', content: question },
          { role: 'assistant', content: emitToolCall('propose_navigate', goArgs) },
        ],
        expect: { toolName: 'propose_navigate' },
      });
      records.push({
        id: `${base}:approved`, split, kind: 'navigation', scenarioId: sc.id,
        messages: [
          { role: 'system', content: ambientPageLine('projection') },
          { role: 'user', content: question },
          { role: 'assistant', content: emitToolCall('propose_navigate', goArgs) },
          { role: 'user', content: navigationFeedback(true, goArgs.label) },
          { role: 'assistant', content: `Opened it — the ${pageTitleLine(here)} page is now on screen. What would you like to look at?` },
        ],
        expect: { toolName: 'propose_navigate', mustNotContain: ['TOOL_CALL'] },
      });
      records.push({
        id: `${base}:rejected`, split, kind: 'navigation', scenarioId: sc.id,
        messages: [
          { role: 'system', content: ambientPageLine('projection') },
          { role: 'user', content: question },
          { role: 'assistant', content: emitToolCall('propose_navigate', goArgs) },
          { role: 'user', content: navigationFeedback(false, goArgs.label) },
          { role: 'assistant', content: `No problem — staying where you are. I can still answer questions from here.` },
        ],
        expect: { toolName: 'propose_navigate', mustNotContain: ['TOOL_CALL'] },
      });
    }
  }

  // (d) the "show me everything" ask → get_sitemap.
  const sitemapArgs = {};
  for (const question of [
    'What can this app do?',
    'What pages are in here?',
    'Give me a tour of the app.',
  ]) {
    const split = ++seqRef.n % evalEvery === 0 ? 'eval' : 'train';
    const base = `get_sitemap:${sc.id}:q${seqRef.n}`;
    records.push({
      id: `${base}:call`, split, kind: 'navigation', scenarioId: sc.id,
      messages: [
        { role: 'user', content: question },
        { role: 'assistant', content: emitToolCall('get_sitemap', sitemapArgs) },
      ],
      expect: { toolName: 'get_sitemap' },
    });
    const resultText = runNav(sc, 'get_sitemap', sitemapArgs);
    records.push({
      id: `${base}:follow`, split, kind: 'navigation', scenarioId: sc.id,
      messages: [
        { role: 'user', content: question },
        { role: 'assistant', content: emitToolCall('get_sitemap', sitemapArgs) },
        { role: 'user', content: wrapToolResult(resultText) },
        { role: 'assistant', content: explainSitemap(resultText) },
      ],
      expect: {
        toolName: 'get_sitemap',
        mustNotContain: ['you should', 'i recommend'],
      },
    });
  }
  return records;
}

/** Ground the get_sitemap follow-up: name a couple of the pages the result
 *  lists, so the reply proves it READ the map rather than reciting a canned
 *  tour. Deterministic: the first two listed pages by catalog order. */
function explainSitemap(resultText: string): string {
  const pages = resultText
    .split('\n')
    .map((l) => l.replace(/^\s*\d+\.\s+/, '').split(/\s+\(view\s/)[0])
    .filter((l) => l && !l.startsWith('The site map'));
  const named = pages.slice(0, 3).join(', ');
  return `This app is a Canadian retirement drawdown planner. The pages cover the plan itself (the dashboard and your inputs), the year-by-year schedule, insights (levers, Monte Carlo odds, backtest), saved profiles, data (share/backup/export), plus print, settings, help, and the assistant. Say the word and I can open any of them — for example ${named}.`;
}

export function mintNavRecords(evalEvery = 5): CorpusRecord[] {
  const records: CorpusRecord[] = [];
  const seqRef = { n: 0 };
  for (const sc of SCENARIOS) {
    records.push(...mintNavRecordsFor(sc, seqRef, evalEvery));
  }
  return records;
}

/** The full corpus: engine-grounded reads + mutations + guardrail + options +
 *  domain knowledge + navigation. */
export function mintCorpus(): CorpusRecord[] {
  return [
    ...mintReadRecords(),
    ...mintMutationRecords(),
    ...mintGuardrailRecords(),
    ...mintOptionFramingRecords(),
    ...mintDomainKnowledgeRecords(),
    ...mintNavRecords(),
  ];
}

/** Serialize records to JSONL (one record per line). */
export function toJsonl(records: CorpusRecord[]): string {
  return records.map((r) => JSON.stringify(r)).join('\n') + '\n';
}
