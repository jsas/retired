// The protocol-validity EVAL GATE — scores a model's replies against the frozen
// corpus eval split. This is what the stock-small-model bake-off (and later the
// fine-tuned candidate) is measured by. It fills the gaps the #106 probe left:
//   1. arg-schema validation (Zod) — not just "parseable + in-catalog",
//   2. expected-call ground truth — each corpus record carries expect.toolName,
//   3. pass/fail aggregation — per-model protocol-validity vs a threshold.
// (Multi-turn execution is layered on top of scoreReply; the gate's unit is one
// assistant reply, which is where protocol-validity lives.)
//
// The gate scores ONE assistant reply per `tool-call` corpus record across
// three tiers of increasing strictness:
//   parseable      — the app parser extracts a call without an error
//   inCatalog      — …and the call is a real tool (not a hallucinated name)
//   argsValid      — …and the args satisfy the tool's Zod schema (the executor
//                    would accept it, not just the parser)
// `toolMatch` additionally checks the model picked the EXPECTED tool for the
// question (precision on tool choice), and `valid` is the strictest tier
// (inCatalog ∧ argsValid ∧ exactly one call ∧ the expected tool).

import { extractPromptToolCalls } from '../src/lib/ai/promptTools';
import { TOOL_SCHEMAS } from '../src/lib/ai/tools';
import type { CorpusRecord } from './buildCorpus';
import { scoreToolReply, TOOL_NAMES } from './protocol';

/** Advice verbs a non-advisory explanation must avoid (calculator-not-planner). */
const ADVICE_PHRASES = ['you should', 'i recommend', 'you ought to', 'the best choice is', 'i advise'];

export interface ReplyScore {
  /** A tool call was extracted without a parse error. */
  parseable: boolean;
  /** The extracted call names a real, in-catalog tool. */
  inCatalog: boolean;
  /** Exactly one call (the taught discipline), in-catalog. */
  singleCall: boolean;
  /** The args satisfy the tool's Zod schema (executor would accept). */
  argsValid: boolean;
  /** The called tool is the one the corpus record expects. */
  toolMatch: boolean;
  /** Strictest tier: singleCall ∧ inCatalog ∧ argsValid ∧ toolMatch. */
  valid: boolean;
  /** Why it failed, for triage (undefined when valid). */
  reason?: string;
}

/** Score one assistant reply against the corpus record it should satisfy. */
export function scoreReply(record: CorpusRecord, reply: string): ReplyScore {
  const expectedTool = record.expect.toolName;
  const v = scoreToolReply(reply);

  if (v.kind === 'no-call') return fail('no tool call emitted');
  if (v.kind === 'bad-json') return fail('malformed JSON', { parseable: false });
  if (v.kind === 'unknown-tool') return fail(`hallucinated tool (${v.message})`, { parseable: true });

  // 'valid' (one call) or 'multi-call': re-parse with the app parser to get the
  // first call's name/args, then grade discipline + schema + tool choice.
  const { calls } = extractPromptToolCalls(reply, TOOL_NAMES);
  const first = calls[0];
  const singleCall = v.kind === 'valid';
  const inCatalog = first !== undefined && TOOL_NAMES.has(first.name);
  const argsValid = inCatalog && validateArgs(first.name, first.args ?? {});
  const toolMatch = expectedTool !== undefined && first?.name === expectedTool;

  const valid = singleCall && inCatalog && argsValid && toolMatch;
  let reason: string | undefined;
  if (!valid) {
    if (!inCatalog) reason = 'call not in catalog';
    else if (!argsValid) reason = `args fail ${first.name} schema`;
    else if (!toolMatch) reason = `wrong tool (got ${first.name}, want ${expectedTool})`;
    else if (!singleCall) reason = 'multiple calls in one reply';
  }
  return { parseable: true, inCatalog, singleCall, argsValid, toolMatch, valid, reason };
}

/** Zod-validate args against the tool's schema — the executor's own bar. */
function validateArgs(name: string, args: Record<string, unknown>): boolean {
  const schema = TOOL_SCHEMAS[name as keyof typeof TOOL_SCHEMAS];
  if (!schema) return false;
  return schema.safeParse(args ?? {}).success;
}

function fail(reason: string, over: Partial<ReplyScore> = {}): ReplyScore {
  return {
    parseable: over.parseable ?? false,
    inCatalog: false, singleCall: false, argsValid: false, toolMatch: false,
    valid: false, reason,
  };
}

// ---------------------------------------------------------------------------
// Multi-turn grading (gap #5). The model must call the tool, then CONTINUE
// after the fed-back result to a grounded, non-advisory final answer. This is
// what makes the corpus's tool-followup / mutation-confirm records scoreable.
// ---------------------------------------------------------------------------

export interface FollowupScore {
  /** Tier 1: the tool call turn is protocol-valid (delegates to scoreReply). */
  call: ReplyScore;
  /** Tier 2: the continuation references the fed-back result. */
  grounded: boolean;
  /** Tier 3: the continuation stays non-advisory. */
  nonAdvisory: boolean;
  /** Tier 4: required phrases present (record.expect.mustContain). */
  hasRequired: boolean;
  /** Overall: all tiers pass. */
  pass: boolean;
  reason?: string;
}

/**
 * Grade a `tool-followup` record given the model's TWO turns: its tool-call
 * reply and its continuation after the result is fed back.
 *
 * @param record   a tool-followup CorpusRecord (carries the real result text in
 *                 messages[2] and the grounding expectations in expect).
 * @param callReply   the model's first turn (should emit the TOOL_CALL).
 * @param continuation  the model's turn after seeing the [OK] result.
 */
export function scoreFollowup(record: CorpusRecord, callReply: string, continuation: string): FollowupScore {
  // Tier 1: the call itself must be protocol-valid against the expected tool.
  const call = scoreReply({ ...record, kind: 'tool-call' }, callReply);

  // The real result text the model saw (messages[2] is the fed-back envelope).
  const resultMsg = record.messages.find((m) => m.role === 'user' && m.content.includes('[OK]'));
  const resultText = resultMsg?.content ?? '';

  // Tier 2: grounded — the continuation references at least one FIGURE from the
  // fed-back result (a $ amount or % that actually appears in the result), so
  // it can't float free of the tool's output.
  const figures = (resultText.match(/\$[\d,]+|\d+(?:\.\d+)?%/g) ?? []);
  const grounded = figures.length === 0
    ? continuation.trim().length > 0  // result had no figures to quote; any prose counts
    : figures.some((f) => continuation.includes(f));

  // Tier 3: non-advisory.
  const lower = continuation.toLowerCase();
  const nonAdvisory = !ADVICE_PHRASES.some((p) => lower.includes(p));

  // Tier 4: required phrases.
  const required = record.expect.mustContain ?? [];
  const hasRequired = required.every((p) => continuation.toLowerCase().includes(p.toLowerCase()));

  const pass = call.valid && grounded && nonAdvisory && hasRequired;
  let reason: string | undefined;
  if (!pass) {
    if (!call.valid) reason = `call invalid: ${call.reason}`;
    else if (!grounded) reason = 'continuation does not reference the tool result';
    else if (!nonAdvisory) reason = 'continuation crosses into advice';
    else if (!hasRequired) reason = 'continuation missing required phrase(s)';
  }
  return { call, grounded, nonAdvisory, hasRequired, pass, reason };
}

// ---------------------------------------------------------------------------
// Mutation-confirm grading. After a propose_* / set_scenario_value the loop
// feeds back APPROVED ("now APPLIED … do NOT re-propose") or REJECTED ("NOT
// applied … do not repeat unprompted"). The model must learn the discipline:
// confirm and move on — never re-emit the same proposal.
// ---------------------------------------------------------------------------

export interface MutationScore {
  /** The propose_* call itself is protocol-valid (args satisfy the schema). */
  callValid: boolean;
  /** The continuation does NOT re-propose (no new TOOL_CALL for a mutation). */
  noRepropose: boolean;
  /** The continuation acknowledges the outcome (approved→confirm / rejected→accept). */
  acknowledges: boolean;
  pass: boolean;
  reason?: string;
}

/**
 * Grade a mutation-confirm exchange.
 * @param callReply   the model's propose_* turn.
 * @param expectedTool the mutation tool it should call.
 * @param approved    whether the (scripted) user approved the proposal.
 * @param continuation  the model's turn after the APPROVED/REJECTED feedback.
 */
export function scoreMutationConfirm(
  callReply: string,
  expectedTool: string,
  approved: boolean,
  continuation: string,
): MutationScore {
  const call = scoreReply(
    { id: 'm', split: 'eval', kind: 'tool-call', scenarioId: 's', messages: [], expect: { toolName: expectedTool } },
    callReply,
  );
  const callValid = call.valid;

  // Re-proposing = emitting another TOOL_CALL (for a mutation tool) in the
  // continuation. After approval OR rejection, the correct move is prose.
  const { calls } = extractPromptToolCalls(continuation, TOOL_NAMES);
  const noRepropose = calls.length === 0;

  const lower = continuation.toLowerCase();
  const acknowledges = approved
    ? /(applied|now live|it'?s in|updated|done|confirmed|taken effect)/.test(lower)
    : /(not applied|won'?t (apply|make)|reverted|left (it|the plan) (as|unchanged)|unchanged|no change|understood)/.test(lower);

  const pass = callValid && noRepropose && acknowledges;
  let reason: string | undefined;
  if (!pass) {
    if (!callValid) reason = `mutation call invalid: ${call.reason}`;
    else if (!noRepropose) reason = 're-proposed after the user already decided';
    else if (!acknowledges) reason = `did not ${approved ? 'confirm the applied change' : 'accept the rejection'}`;
  }
  return { callValid, noRepropose, acknowledges, pass, reason };
}

// ---------------------------------------------------------------------------
// Aggregation across a model's replies on the whole eval split.
// ---------------------------------------------------------------------------

export interface GateReport {
  modelId: string;
  total: number;
  /** Fraction of replies that were fully protocol-valid (strictest tier). */
  protocolValidity: number;
  /** Weakest→strongest tier fractions, for diagnosing where a model breaks. */
  tiers: { parseable: number; inCatalog: number; argsValid: number; toolMatch: number };
  /** Per-failure-reason counts, for triage. */
  failures: Record<string, number>;
  /** Did the model clear the bar? */
  passed: boolean;
  threshold: number;
}

/** Aggregate reply scores into a gate report. `replies[i]` is the model's
 *  answer to `records[i]` (both must be `tool-call` records with expect.toolName). */
export function gateReport(
  modelId: string,
  records: CorpusRecord[],
  replies: string[],
  threshold: number,
): GateReport {
  if (records.length !== replies.length) {
    throw new Error(`records (${records.length}) and replies (${replies.length}) must align`);
  }
  const scores = records.map((r, i) => scoreReply(r, replies[i]));
  const n = scores.length || 1;
  const frac = (f: (s: ReplyScore) => boolean) => scores.filter(f).length / n;
  const failures: Record<string, number> = {};
  for (const s of scores) {
    if (!s.valid && s.reason) failures[s.reason] = (failures[s.reason] ?? 0) + 1;
  }
  const protocolValidity = frac((s) => s.valid);
  return {
    modelId,
    total: scores.length,
    protocolValidity,
    tiers: {
      parseable: frac((s) => s.parseable),
      inCatalog: frac((s) => s.inCatalog),
      argsValid: frac((s) => s.argsValid),
      toolMatch: frac((s) => s.toolMatch),
    },
    failures,
    passed: protocolValidity >= threshold,
    threshold,
  };
}
