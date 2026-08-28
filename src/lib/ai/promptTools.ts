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
// The confirm-before-apply guarantee is unchanged: set_scenario_value still
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

/** Extract ```tool blocks from assistant text. Tolerates prose before/after
 *  and multiple blocks; anything not matching a known tool name is an error
 *  the model can learn from, not a silent drop. */
export function extractPromptToolCalls(text: string, toolNames: ReadonlySet<string>): ParsedToolText {
  const calls: AgentToolCall[] = [];
  const errors: ParsedToolText['errors'] = [];
  // ```tool\n{...}\n``` — block ends at the next fence or end of text (small
  // models often forget the closing fence).
  const pattern = /```tool\s*\n([\s\S]*?)(?:```|$)/g;
  let prose = '';
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const idx = match.index ?? 0;
    prose += text.slice(last, idx);
    last = idx + match[0].length;
    const raw = match[1].trim();
    try {
      const parsed: unknown = JSON.parse(raw);
      const obj = parsed as Record<string, unknown>;
      const name = typeof obj?.name === 'string' ? obj.name : '';
      if (!toolNames.has(name)) {
        errors.push({
          raw,
          message: name
            ? `Unknown tool "${name}". Check the tool list and use the exact name.`
            : 'Tool call is missing a "name" field. Format: {"name": "<tool>", "args": {…}}',
        });
        continue;
      }
      const args = obj.args !== undefined && typeof obj.args === 'object' && obj.args !== null
        ? (obj.args as Record<string, unknown>)
        : {};
      calls.push({ id: nextCallId(), name, args });
    } catch {
      errors.push({
        raw,
        message: 'The tool block was not valid JSON. Re-emit it as a single JSON object: ' +
          '```tool {"name": "<tool>", "args": {…}} ``` — no comments, no trailing commas.',
      });
    }
  }
  prose += text.slice(last);
  return { prose: prose.trim(), calls, errors };
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
    '\nIf you have everything you need, answer the user in plain prose (no tool block). ' +
    'Otherwise call another tool with a ```tool block.',
  );
  return parts.join('\n');
}

/** Cap on tool-call round trips for prompt-protocol providers. Native
 *  providers get maxRounds=8; small local models need a tighter leash because
 *  they can loop the same broken call forever. */
export const PROMPT_TOOL_MAX_CALLS = 5;

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
 *  protocol: the format, the tool catalog, and the discipline rules. */
export function buildPromptToolInstructions(specs: ToolSpec[]): string {
  const catalog = specs.map(s => `  - ${s.name}: ${s.description}\n  args:\n${compactSchema(s.jsonSchema)}`).join('\n');
  return [
    'You can run LOCAL CODE through tool calls. To call a tool, output a fenced block EXACTLY like this,',
    'with one JSON object inside (no prose inside the block):',
    '```tool',
    '{"name": "run_projection", "args": {}}',
    '```',
    'The tool result comes back as the next message. Rules:',
    '- Put ALL prose outside the block; a block contains JSON only.',
    '- One tool per block; you may emit several blocks in one reply.',
    '- Available tools:',
    catalog,
    '- Prefer run_projection/compare_scenarios numbers over guessing.',
    '- set_scenario_value only PROPOSES a change; the user confirms it.',
  ].join('\n');
}

/** Zod guard for the on-the-wire tool-call JSON shape — the parser hand-checks
 *  name/args above, this is for tests and future stricter handling. */
export const promptToolCallSchema = z.object({
  name: z.string().min(1),
  args: z.record(z.string(), z.unknown()).optional(),
});
