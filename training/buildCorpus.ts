// Synthetic training-corpus builder for the #112 fine-tuning spike.
//
// WHY THIS IS CHEAP AND CORRECT: the engine is deterministic and client-side,
// so we mint supervision for free — no human labeling. For each scenario we
// (1) phrase a question that maps to a tool, (2) emit the canonical TOOL_CALL
// line, (3) run the REAL tool executor against the REAL engine, (4) record the
// app's actual text result. Every pair is grounded in shipped behavior, so the
// fine-tune learns the protocol AND the domain from true numbers, not paraphrase.
//
// Corpus shape (one JSONL record per assistant turn we want to teach):
//   { id, split, kind, scenarioId, messages: ChatMessage[], expect: {...} }
// `messages` is the exact multi-turn context a chat template consumes
// (system → plan-digest user → user question → assistant TOOL_CALL → user
// "Tool results:" → assistant prose). `expect` is the frozen ground-truth the
// eval gate replays and scores.

import { emitToolCall, mutationFeedback, wrapToolResult } from './protocol';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface CorpusRecord {
  id: string;
  split: 'train' | 'eval';
  kind:
    | 'tool-call'          // question → one in-catalog TOOL_CALL (the core skill)
    | 'tool-followup'      // TOOL_CALL → result → plain-prose explanation
    | 'mutation-confirm'   // propose_* → APPROVED/REJECTED → confirm, never re-propose
    | 'refusal'            // out-of-guardrail ask → deflect, calculator-not-planner
    | 'clarify'            // ambiguous ask → ask a question, do NOT guess a tool
    | 'domain-explain'     // read a projection digest → explain in plain words
    | 'option-framing'     // "what can I optimize?" → survey the levers (run_strategies)
                          //   + plain-words framing of the trade-offs, never a directive
    | 'domain-knowledge'   // Canadian tax / benefit-program / market-history fact,
                          //   answered from the app's OWN shipped tables (can't drift),
                          //   always with an offer to ground it in the user's numbers
    | 'navigation';        // site-awareness (issue #141): find_page / get_sitemap /
                          //   propose_navigate, keyed to the ambient current-page line
  scenarioId: string;
  messages: ChatMessage[];
  /** Frozen ground truth the eval gate replays. */
  expect: {
    toolName?: string;            // for tool-call kinds
    mustContain?: string[];       // phrases the prose turn must include
    mustNotContain?: string[];    // e.g. advice verbs for refusal records
  };
}

// ---------------------------------------------------------------------------
// Taxonomy → tool coverage matrix. Every tool gets at least one tool-call
// exemplar and one follow-up; mutation tools additionally get both an APPROVED
// and a REJECTED record. This is the checklist a generation run walks.
// ---------------------------------------------------------------------------

export const TOOL_TAXONOMY: ReadonlyArray<{
  tool: string;
  sampleQuestions: string[];
  mutation: boolean;
}> = [
  { tool: 'run_projection', mutation: false, sampleQuestions: [
    'Am I on track?', 'What happens if I retire at {retirementAge±3}?',
    'Is my plan funded to 95?'] },
  { tool: 'compare_scenarios', mutation: false, sampleQuestions: [
    'Should I retire at 60, 65, or 70?', 'Compare taking CPP at 60 vs 65 vs 70.'] },
  { tool: 'run_strategies', mutation: false, sampleQuestions: [
    'What levers would help my plan most?', 'Which changes improve my sustainable spending?'] },
  { tool: 'solve_spending', mutation: false, sampleQuestions: [
    'How much can I safely spend each year?', 'What spending survives 90% of markets?'] },
  { tool: 'run_monte_carlo', mutation: false, sampleQuestions: [
    'What are the odds my money lasts?', 'Run the simulation on my plan.'] },
  { tool: 'get_schedule', mutation: false, sampleQuestions: [
    'Show my year-by-year balances from 65 to 95.', 'What is my tax at age 72?'] },
  { tool: 'get_scenario', mutation: false, sampleQuestions: [
    'What accounts do I have?', 'Read my current plan.'] },
  { tool: 'recall', mutation: false, sampleQuestions: [
    '(conversation start — ground yourself)', 'What do you remember about my pension?'] },
  { tool: 'list_scenarios', mutation: false, sampleQuestions: [
    'What plans do I have saved?', 'Which scenarios exist?'] },
  { tool: 'set_scenario_value', mutation: true, sampleQuestions: [
    'Set my CPP start age to 70.', 'Change my retirement age to 62.'] },
  { tool: 'propose_patch', mutation: true, sampleQuestions: [
    'Defer both CPP and OAS to 70.', 'Move my retirement and CPP to 65.'] },
  { tool: 'propose_spouse', mutation: true, sampleQuestions: [
    'Add my spouse who retires at 65.', 'Remove the spouse from my plan.'] },
  { tool: 'propose_income', mutation: true, sampleQuestions: [
    'Add my $12,000/yr defined-benefit pension starting at 65.'] },
  { tool: 'manage_income', mutation: true, sampleQuestions: [
    'Remove my pension.', 'Update my DB pension to $14,400.'] },
  { tool: 'propose_spending_bands', mutation: true, sampleQuestions: [
    'Model go-go/slow-go/no-go spending.', 'Spend less after 75.'] },
  { tool: 'propose_cash_event', mutation: true, sampleQuestions: [
    'Add a $200k downsize inflow at 70.', 'I inherit $50k at 68.'] },
  { tool: 'manage_cash_event', mutation: true, sampleQuestions: [
    'Remove the downsize.', 'Change the inheritance to $60k.'] },
  { tool: 'propose_reverse_mortgage', mutation: true, sampleQuestions: [
    'Model a reverse mortgage on my $800k home.'] },
  { tool: 'propose_rdsp', mutation: true, sampleQuestions: [
    'Set up an RDSP with a $1,500 contribution.'] },
  { tool: 'propose_revert', mutation: true, sampleQuestions: [
    'That made it worse — undo it.', 'Roll back the last change.'] },
  { tool: 'remember', mutation: false, sampleQuestions: [
    'Remember that I will not touch my RRSP before 71.'] },
  { tool: 'open_scenario', mutation: false, sampleQuestions: [
    'Open my "Downsized at 65" plan.'] },
  { tool: 'save_scenario_as', mutation: false, sampleQuestions: [
    'Keep this as its own plan called "Retire at 60".'] },
  // Navigation (issue #141): the site-awareness layer — find the page, show
  // the whole map, propose a page switch (confirm card).
  { tool: 'find_page', mutation: false, sampleQuestions: [
    'Where do I enter my TFSA contribution room?', 'Which page has the Monte Carlo odds?'] },
  { tool: 'get_sitemap', mutation: false, sampleQuestions: [
    'What pages does this app have?', 'What can this app do?'] },
  { tool: 'propose_navigate', mutation: true, sampleQuestions: [
    'Take me to the print summary.', 'Open my saved plans.'] },
];

/** Build the assistant's tool-call turn for a question→tool exemplar. */
export function toolCallTurn(tool: string, args: Record<string, unknown>): ChatMessage {
  return { role: 'assistant', content: emitToolCall(tool, args) };
}

/** Build the user turn that returns a tool's real result. */
export function toolResultTurn(resultText: string, isError = false): ChatMessage {
  return { role: 'user', content: wrapToolResult(resultText, isError) };
}

/** Build the user turn that follows a mutation proposal. */
export function mutationResultTurn(approved: boolean, label: string, patch: Record<string, unknown>): ChatMessage {
  return { role: 'user', content: mutationFeedback(approved, label, JSON.stringify(patch)) };
}

// NOTE: the engine-grounding step (running the real executor to produce the
// `resultText` for toolResultTurn, and the scenario sweep that feeds it) is
// wired in a follow-up once the scenario/input-space map lands. The taxonomy
// and message-shape helpers above are the parts the protocol already fixes.
