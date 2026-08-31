// Corpus minter: runs the REAL tool executor against the REAL deterministic
// engine to capture genuine tool results, then assembles engine-grounded
// training records. This is the "free, correct supervision" the spike is built
// on — every exemplar's numbers are the shipped engine's actual output.
//
// What it mints today (the engine-grounded core, which is also the BENCHMARK
// set for the stock-small-model bake-off):
//   - 'tool-call'     read-tool exemplars: question → canonical TOOL_CALL line
//   - 'tool-followup' TOOL_CALL → real [OK] result → plain-prose explanation
//                     that quotes the engine's figures (never free-standing advice)
//
// Mutation / refusal / clarify exemplars layer on top of the same context but
// don't need fresh engine output, so they live in buildCorpus.ts helpers.

import { executeToolCall, type ToolContext } from '../src/lib/ai/tools';
import { testConfig } from '../src/test/helpers';
import type { ChatMessage, CorpusRecord } from './buildCorpus';
import { emitToolCall, wrapToolResult } from './protocol';
import { SCENARIOS, type NamedScenario } from './scenarios';

/** A question → read-tool exemplar template. `args` may reference the scenario
 *  (e.g. retirementAge ± a delta) via a small resolver. */
interface ReadSpec {
  tool: string;
  question: (sc: NamedScenario) => string;
  args: (sc: NamedScenario) => Record<string, unknown>;
  /** Which grounded-explanation template the follow-up uses, or 'none' to mint
   *  only the tool-call record (for tools whose raw result — e.g. a JSON
   *  get_scenario block — doesn't fit the figure-grounded prose template). */
  explainFrom: 'verdict' | 'compare' | 'monteCarlo' | 'solve' | 'none';
}

const READ_SPECS: ReadSpec[] = [
  {
    tool: 'run_projection',
    question: () => 'Am I on track for retirement?',
    args: () => ({}),
    explainFrom: 'verdict',
  },
  {
    tool: 'run_projection',
    question: (sc) => `What changes if I retire at ${sc.inputs.retirementAge + 2}?`,
    args: (sc) => ({ overrides: { retirementAge: sc.inputs.retirementAge + 2 } }),
    explainFrom: 'verdict',
  },
  {
    tool: 'compare_scenarios',
    question: (sc) => `Compare retiring at ${sc.inputs.retirementAge} vs ${sc.inputs.retirementAge + 3}.`,
    args: (sc) => ({
      variants: [
        { label: `Retire ${sc.inputs.retirementAge}`, overrides: { retirementAge: sc.inputs.retirementAge } },
        { label: `Retire ${sc.inputs.retirementAge + 3}`, overrides: { retirementAge: sc.inputs.retirementAge + 3 } },
      ],
    }),
    explainFrom: 'compare',
  },
  {
    tool: 'run_monte_carlo',
    question: () => 'What are the odds my money lasts?',
    args: () => ({ runs: 500 }),
    explainFrom: 'monteCarlo',
  },
  {
    tool: 'solve_spending',
    question: () => 'How much can I safely spend each year?',
    args: () => ({ targetSuccessRate: 0.9, runs: 500 }),
    explainFrom: 'solve',
  },
  {
    tool: 'get_scenario',
    question: () => 'What accounts do I have?',
    args: () => ({ section: 'accounts' }),
    // get_scenario returns a raw JSON block (no $/% figures), so it doesn't fit
    // the figure-grounded prose template — mint the tool-call exemplar only.
    explainFrom: 'none',
  },
];

/** Build the executor context for one scenario. Pure in-memory; no UI. */
function contextFor(sc: NamedScenario): ToolContext {
  return {
    inputs: sc.inputs,
    config: testConfig(),
    scenarioName: sc.name,
    scenarioList: SCENARIOS.map((x) => ({ id: x.id, name: x.name })),
    activeScenarioId: sc.id,
  };
}

/** Run a read tool and return its result text (throws on mutation/error so a
 *  malformed spec fails the generation run loudly, not silently). */
function runRead(sc: NamedScenario, tool: string, args: Record<string, unknown>): string {
  const outcome = executeToolCall(contextFor(sc), { id: 'mint-1', name: tool, args });
  if (outcome.kind === 'error') throw new Error(`mint ${tool} failed for ${sc.id}: ${outcome.content}`);
  if (outcome.kind === 'mutation') throw new Error(`mint ${tool} unexpectedly produced a mutation for ${sc.id}`);
  return outcome.content;
}

/** Turn a real tool result into the assistant's grounded prose turn. We quote
 *  the engine's own figures and keep the calculator-not-planner framing: it
 *  explains consequences, it never recommends. */
function explain(spec: ReadSpec, resultText: string): string {
  // Quote the first line that carries an actual engine FIGURE (a $ amount or a
  // %), not a bare header like "Projection of the current plan" — that's what
  // keeps the exemplar grounded in the shipped engine's real output instead of
  // echoing a label. Fall back to the first non-empty line if none has a figure.
  const lines = resultText.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  const firstFigure = lines.find((l) => /[$%]/.test(l));
  const headline = firstFigure ?? lines[0] ?? resultText;
  const tail = 'Those are the numbers from your plan — I can show the consequences, not tell you what to choose.';
  switch (spec.explainFrom) {
    case 'verdict':
      return `${headline}\n\n${tail}`;
    case 'compare':
      return `Here's how the variants compare.\n${headline}\n\n${tail}`;
    case 'monteCarlo':
      return `Across the simulated market futures:\n${headline}\n\n${tail}`;
    case 'solve':
      return `${headline}\n\n${tail}`;
    case 'none':
      // Caller filters explainFrom:'none' out of the follow-up path; reaching
      // here means a spec was misconfigured.
      throw new Error(`explain() called for a 'none' spec`);
  }
}

/** Mint the engine-grounded read-tool records across the whole scenario sweep.
 *  `split` assigns every Nth record to eval so the bake-off has a held-out set
 *  drawn from the same distribution as train. */
export function mintReadRecords(evalEvery = 4): CorpusRecord[] {
  const records: CorpusRecord[] = [];
  let seq = 0;
  for (const sc of SCENARIOS) {
    for (const spec of READ_SPECS) {
      const args = spec.args(sc);
      const question = spec.question(sc);
      const resultText = runRead(sc, spec.tool, args);
      const split = ++seq % evalEvery === 0 ? 'eval' : 'train';
      const base = `${spec.tool}:${sc.id}`;

      const callMessages: ChatMessage[] = [
        { role: 'user', content: question },
        { role: 'assistant', content: emitToolCall(spec.tool, args) },
      ];
      records.push({
        id: `${base}:call`, split, kind: 'tool-call', scenarioId: sc.id,
        messages: callMessages,
        expect: { toolName: spec.tool },
      });

      // Tools whose raw result doesn't fit the grounded-prose template mint
      // only the tool-call exemplar (e.g. get_scenario's raw JSON block).
      if (spec.explainFrom === 'none') continue;

      const followMessages: ChatMessage[] = [
        { role: 'user', content: question },
        { role: 'assistant', content: emitToolCall(spec.tool, args) },
        { role: 'user', content: wrapToolResult(resultText) },
        { role: 'assistant', content: explain(spec, resultText) },
      ];
      records.push({
        id: `${base}:follow`, split, kind: 'tool-followup', scenarioId: sc.id,
        messages: followMessages,
        expect: {
          // The follow-up's call turn must invoke the same tool — the gate's
          // multi-turn grader checks it against this expected tool.
          toolName: spec.tool,
          mustContain: ['consequences'],
          mustNotContain: ['you should', 'I recommend', 'you ought to'],
        },
      });
    }
  }
  return records;
}

/** Serialize records to JSONL (one record per line). */
export function toJsonl(records: CorpusRecord[]): string {
  return records.map((r) => JSON.stringify(r)).join('\n') + '\n';
}
