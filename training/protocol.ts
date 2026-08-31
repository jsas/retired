// Single source of truth for the assistant's text tool protocol, used by the
// #112 fine-tuning spike to mint and score synthetic training data.
//
// The contract this enforces is the app's OWN (`src/lib/ai/promptTools.ts`):
//   - the model emits ONE bare line:  TOOL_CALL: {"name": "<tool>", "args": {…}}
//   - results come back as the next USER message under a "Tool results:" header
//     with "[OK] …" / "[ERROR] …" blocks (never a TOOL_RESULT: line),
//   - a mutation (propose_* / set_scenario_value) pauses for a confirm card and
//     is then reported APPROVED (applied — do not re-propose) or REJECTED.
//
// Rather than re-implement any of that, we IMPORT the real catalog + parser so
// the synthetic corpus can never drift from what the shipped app actually
// teaches and accepts. If tools.ts gains a tool, the corpus picks it up on the
// next generation run.

import {
  buildPromptToolInstructions,
  extractPromptToolCalls,
  formatPromptToolResults,
} from '../src/lib/ai/promptTools';
import { toolSpecs } from '@retired/mcp-tools/tools';

/** The 23-name tool catalog exactly as the model sees it (name/description/args). */
export const SPECS = toolSpecs();

/** Every callable tool name — the "in-catalog" half of protocol-validity. */
export const TOOL_NAMES: ReadonlySet<string> = new Set(SPECS.map((s) => s.name));

/** The exact system-prompt block the app appends in prompt mode. Training and
 *  eval prompts must use THIS string, byte-for-byte, so the fine-tuned model is
 *  scored against the same instructions it was (or a stock model is) given. */
export const TOOL_INSTRUCTIONS = buildPromptToolInstructions(SPECS);

/** Emit one canonical tool-call line, matching the taught format exactly. */
export function emitToolCall(name: string, args: Record<string, unknown> = {}): string {
  return `TOOL_CALL: ${JSON.stringify({ name, args })}`;
}

export type Validity =
  | { kind: 'valid'; name: string; args: Record<string, unknown> }
  | { kind: 'no-call' }                 // parseable reply, but no tool call where one was expected
  | { kind: 'unknown-tool'; raw: string; message: string }
  | { kind: 'bad-json'; raw: string; message: string }
  | { kind: 'multi-call'; count: number }; // >1 executed call: works, but off-discipline

/**
 * Score ONE assistant reply that was expected to call a tool. Delegates parsing
 * to the app's real extractPromptToolCalls, so "valid" means "the shipped app
 * would run it," not "matches our own idea of the format."
 *
 * The discipline we reward is the taught one (§buildPromptToolInstructions):
 * exactly one call, in-catalog, valid JSON. Multiple parseable calls still RUN
 * in the app, but we flag them as off-discipline so the eval can separate
 * "protocol-valid" from "protocol-clean".
 */
export function scoreToolReply(reply: string): Validity {
  const { calls, errors } = extractPromptToolCalls(reply, TOOL_NAMES);

  if (errors.length > 0) {
    const msg = errors[0].message;
    if (msg.startsWith('Unknown tool')) return { kind: 'unknown-tool', raw: errors[0].raw, message: msg };
    return { kind: 'bad-json', raw: errors[0].raw, message: msg };
  }
  if (calls.length === 0) return { kind: 'no-call' };
  if (calls.length > 1) return { kind: 'multi-call', count: calls.length };
  return { kind: 'valid', name: calls[0].name, args: calls[0].args };
}

/** Wrap a tool's text result in the user-message envelope the app uses. */
export function wrapToolResult(content: string, isError = false): string {
  return formatPromptToolResults(
    [{ toolCallId: 'prompt-call-1', content, isError }],
    [],
  );
}

/** The exact APPROVED/REJECTED sentences a propose_* result is followed by
 *  (agentLoop.ts). Training pairs after a mutation must use these so the model
 *  learns: approved → confirm + report fresh numbers, never re-propose. */
export function mutationFeedback(approved: boolean, label: string, patchJson: string): string {
  return approved
    ? `The user approved this change and it is now APPLIED to the plan: ${label} (${patchJson}). ` +
      'It is live — do NOT re-propose it. Confirm it to the user and report the resulting numbers ' +
      '(run a fresh projection if useful).'
    : `The user REJECTED this change — it was NOT applied. Do not apply or repeat it unprompted; ` +
      'answer with that in mind.';
}
