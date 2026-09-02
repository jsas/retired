// Prompt-based tool calling for chat-only providers (web-llm / local models).
//
// Native function-calling APIs don't exist on the web-llm chat surface we use,
// so instead the tools are DESCRIBED IN THE SYSTEM PROMPT as a text protocol:
// the model emits ```tool fenced JSON blocks and we parse + dispatch them
// exactly like native tool calls. Small models sometimes emit malformed calls —
// those come back as tool errors (same shape as a Zod rejection), so the model
// gets a retry with feedback, and a per-turn call cap breaks degenerate loops
// of repeated broken calls.
//
// The confirm-before-apply guarantee is unchanged: set_plan_value still
// produces a mutation proposal that pauses the loop for user approval.

import { z } from 'zod';
import type { AgentToolCall, ToolSpec } from './providers';

/** Result of scanning an assistant reply for tool blocks. */
export interface ParsedToolText {
  /** Prose with all tool blocks stripped. */
  prose: string;
  /** Successfully decoded tool calls (JSON parsed, name known, id assigned). */
  calls: AgentToolCall[];
  /** Blocks that looked like tool calls but failed to parse — fed back to the
   *  model as tool errors so it can fix and retry. */
  errors: Array<{ raw: string; message: string }>;
}

let promptCallSeq = 0;
const nextCallId = () => `prompt-call-${++promptCallSeq}`;

/** Extract TOOL_CALL: lines from assistant text. Tolerates prose before/after
 *  and multiple calls; anything not matching a known tool name is an error
 *  the model can learn from, not a silent drop. The line format (vs a fenced
 *  block) gives small models one unambiguous thing to emit and no closing
 *  fence to forget — the main source of raw-protocol leakage into the chat. */
export function extractPromptToolCalls(text: string, toolNames: ReadonlySet<string>): ParsedToolText {
  const calls: AgentToolCall[] = [];
  const errors: ParsedToolText['errors'] = [];
  const proseLines: string[] = [];
  // A call runs from 'TOOL_CALL:' to the end of its line; a call with an
  // "args" object may wrap onto continuation lines that end with '}'.
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Small models emit the marker in any casing (tool_call:, Tool_Call:, …) —
    // match case-insensitively so a lowercase marker doesn't leak into the chat.
    const start = line.toLowerCase().indexOf('tool_call:');
    if (start === -1) { proseLines.push(line); continue; }
    proseLines.push(line.slice(0, start));
    let raw = line.slice(start + 'tool_call:'.length).trim();
    // Swallow continuation lines while the JSON is incomplete (more opens
    // than closes) so multi-line args still parse.
    while (i + 1 < lines.length && !jsonLooksComplete(raw)) {
      raw += '\n' + lines[++i];
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      const obj = parsed as Record<string, unknown>;
      const name = typeof obj?.name === 'string' ? obj.name : '';
      if (!toolNames.has(name)) {
        errors.push({
          raw,
          message: name
            ? `Unknown tool "${name}". Use one of the listed tool names exactly.`
            : 'Tool call is missing "name". Format: TOOL_CALL: {"name": "<tool>", "args": {…}}',
        });
        continue;
      }
      const args = obj.args !== undefined && typeof obj.args === 'object' && obj.args !== null
        ? (obj.args as Record<string, unknown>)
        : {};
      // A confused model can emit dozens of TOOL_CALL: lines in one reply —
      // running them all spams the transcript. Keep the first few and report
      // the overflow as an error so the model learns to stop.
      if (calls.length >= PROMPT_TOOL_MAX_CALLS_PER_REPLY) {
        errors.push({
          raw,
          message: `Too many tool calls in one reply (max ${PROMPT_TOOL_MAX_CALLS_PER_REPLY}). ` +
            'Call one tool, read its result, then decide the next step.',
        });
        continue;
      }
      calls.push({ id: nextCallId(), name, args });
    } catch {
      errors.push({
        raw,
        message: 'That tool call was not valid JSON. Emit one line: ' +
          'TOOL_CALL: {"name": "<tool>", "args": {…}} — no comments, no trailing commas.',
      });
    }
  }
  return { prose: proseLines.join('\n').trim(), calls, errors };
}

/** Cheap brace balance check: true when the string plausibly contains a whole
 *  JSON object (as many closes as opens). Good enough for swallowing wrapped
 *  args; real validation happens in JSON.parse. */
function jsonLooksComplete(raw: string): boolean {
  const opens = (raw.match(/[{[]/g) ?? []).length;
  const closes = (raw.match(/[}\]]/g) ?? []).length;
  return opens > 0 && closes >= opens;
}

/** Serialize tool results as the next user message in the text protocol. */
export function formatPromptToolResults(
  results: Array<{ toolCallId: string; content: string; isError: boolean }>,
  parseErrors: ParsedToolText['errors'],
): string {
  const parts: string[] = ['Tool results:'];
  for (const r of results) {
    parts.push(`\n[${r.isError ? 'ERROR' : 'OK'}] ${r.content}`);
  }
  for (const e of parseErrors) {
    parts.push(`\n[ERROR] Your tool block could not be used: ${e.message}`);
  }
  parts.push(
    '\nIf you have everything you need, answer the user in plain prose now. ' +
    'Otherwise emit another TOOL_CALL: line.',
  );
  return parts.join('\n');
}

/** Cap on tool-call round trips for prompt-protocol providers. Native
 *  providers get maxRounds=8; small local models need a tighter leash because
 *  they can loop the same broken call forever. */
export const PROMPT_TOOL_MAX_CALLS = 5;

/** Cap on tool calls parsed from a SINGLE assistant reply. A small model that
 *  has lost the plot can emit dozens of TOOL_CALL: lines in one message; each
 *  becomes a transcript chip, so we keep only the first few and tell the model
 *  to slow down. */
export const PROMPT_TOOL_MAX_CALLS_PER_REPLY = 3;

/** Minimal JSON-Schema → compact text for the prompt. Full schemas are too
 *  token-heavy for small context windows, so we render "name (type, req?):
 *  description" lines instead. */
function compactSchema(jsonSchema: Record<string, unknown>): string {
  const props = (jsonSchema.properties ?? {}) as Record<string, Record<string, unknown>>;
  const required = new Set((jsonSchema.required as string[] | undefined) ?? []);
  const lines: string[] = [];
  for (const [key, spec] of Object.entries(props)) {
    const type = Array.isArray(spec.type) ? spec.type.join('|') : String(spec.type ?? 'any');
    const desc = typeof spec.description === 'string' ? spec.description.split('\n')[0] : '';
    const req = required.has(key) ? ', required' : '';
    lines.push(`    ${key} (${type}${req})${desc ? `: ${desc}` : ''}`);
  }
  return lines.length ? lines.join('\n') : '    (no arguments)';
}

/** Build the system-prompt section that teaches a chat-only model the tool
 *  protocol: the format, the tool catalog, and the discipline rules. Small
 *  models follow a one-line format far more reliably than fenced blocks. */
export function buildPromptToolInstructions(specs: ToolSpec[]): string {
  const catalog = specs.map(s => `- ${s.name}: ${s.description}\n  args:\n${compactSchema(s.jsonSchema)}`).join('\n');
  return [
    'TOOLS: to run local code, output ONE line starting with TOOL_CALL: followed by one JSON object:',
    'TOOL_CALL: {"name": "run_projection", "args": {}}',
    'The result comes back as the next message. Rules:',
    '- The TOOL_CALL: line contains ONLY the JSON — all prose goes on other lines.',
    '- Call AT MOST ONE tool, then STOP and wait for its result. Do NOT emit',
    '  several TOOL_CALL: lines in one reply.',
    '- Never call the same tool twice in a row with the same arguments.',
    '- Available tools:',
    catalog,
    '- Prefer run_projection/compare_plans numbers over guessing.',
    '- NEVER ask the user for balances, ages, or account values — they are in the plan',
    '  summary in the system prompt, and get_plan/run_projection return them.',
    '- Every propose_* and set_plan_value tool only PROPOSES a change; the user confirms it.',
    '- When the user asks WHERE something lives, use find_page (it tags the page they are',
    '  already on); use propose_navigate to offer opening a page — the app moves only on the',
    '  card the user approves. Never claim a page opened unless the result says it did.',
  ].join('\n');
}

/** Zod guard for the on-the-wire tool-call JSON shape — the parser hand-checks
 *  name/args above, this is for tests and future stricter handling. */
export const promptToolCallSchema = z.object({
  name: z.string().min(1),
  args: z.record(z.string(), z.unknown()).optional(),
});
