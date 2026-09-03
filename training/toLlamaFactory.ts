// Convert corpus.{train,eval}.jsonl (OpenAI-style messages) to LLaMA-Factory
// sharegpt format with function_call / observation roles, so SFT renders
// through Qwen3's native chat template (<tool_call>{...}</tool_call>) instead
// of our hand-rolled "TOOL_CALL: " prefix.
//
//   npx tsx training/toLlamaFactory.ts
//
// Reads  training/data/corpus.train.jsonl, training/data/corpus.eval.jsonl
// Writes training/data/lf_train.json, training/data/lf_eval.json
//        training/data/dataset_info.json (LLaMA-Factory registry entry)
//
// Mapping (glaive_toolcall_en_demo.json conventions):
//   user                              -> human
//   assistant "TOOL_CALL: {...}"      -> function_call, value = stringified
//                                        {"name": ..., "arguments": {...}}
//                                        (args renamed to arguments)
//   user "Tool results:\n\n..."       -> observation, value = stringified
//                                        {"result": "<text>"} — Qwen's prior
//                                        is JSON payloads, ours is prose; we
//                                        wrap rather than restructure.
//   assistant prose                   -> gpt
//   system                            -> top-level "system" field
// Every record carries the full tool catalog in "tools" (stringified array of
// {"name","description","parameters"} — the glaive demo shape, and what the
// Qwen template's <tools> manifest expects).

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { toolSpecs } from '@retired/mcp-tools/tools';

const here = dirname(fileURLToPath(import.meta.url));

interface Msg { role: string; content: string }
interface Rec { messages: Msg[]; kind?: string }

type ShareMsg = { from: string; value: string };
interface ShareRec {
  conversations: ShareMsg[];
  system?: string;
  tools: string;
}

// Glaive demo shape: [{"name","description","parameters"}] as a string.
//
// SLIM MANIFEST: the full JSON schemas run ~6.2k tokens for 29 tools — larger
// than the 4096 training window, which truncated every example mid-manifest
// and made training both slow (~50h) and blind (the model never saw the
// conversations). We keep what the model needs to emit a valid call — tool
// name, a short description, arg names, types, required list, and enum values
// (enums carry the valid-value constraints like province codes) — and drop the
// token-fat that adds nothing: per-field prose, $schema, additionalProperties,
// and defaults. Full schemas stay in src/lib/ai/tools.ts for runtime validation.
interface SchemaProp {
  type?: string;
  enum?: unknown[];
  items?: { type?: string; enum?: unknown[] };
  [k: string]: unknown;
}
function slimParameters(schema: unknown): unknown {
  const s = schema as { type?: string; properties?: Record<string, SchemaProp>; required?: string[] } | undefined;
  if (!s || typeof s !== 'object') return { type: 'object', properties: {} };
  const props: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(s.properties ?? {})) {
    const p: Record<string, unknown> = { type: v.type ?? 'string' };
    if (v.enum) p.enum = v.enum;                    // keep valid-value constraints
    if (v.items?.type) p.items = { type: v.items.type };
    if (v.items?.enum) p.items = { ...(p.items as object), enum: v.items.enum };
    props[k] = p;
  }
  return { type: 'object', properties: props, required: s.required ?? [] };
}
const TOOLS_STRING = JSON.stringify(
  toolSpecs().map((s) => ({
    name: s.name,
    description: s.description.length > 90 ? `${s.description.slice(0, 87)}…` : s.description,
    parameters: slimParameters(s.jsonSchema),
  })),
);

// Corpus assistant turns now carry Qwen-native blocks; accept the legacy
// TOOL_CALL: line too so an older corpus still converts.
const TOOL_CALL_BLOCK_RE = /^<tool_call>\s*(\{[\s\S]*?\})\s*<\/tool_call>$/s;
const TOOL_CALL_LINE_RE = /^TOOL_CALL:\s*(\{.*\})\s*$/s;

function convert(rec: Rec): ShareRec {
  const conversations: ShareMsg[] = [];
  let system: string | undefined;

  for (const m of rec.messages) {
    if (m.role === 'system') {
      // Multiple system lines (navigation ambient + digest) fold into one
      // system field, matching how the chat template renders a single block.
      system = system ? `${system}\n\n${m.content}` : m.content;
      continue;
    }
    if (m.role === 'user') {
      if (m.content.startsWith('Tool results:')) {
        // Strip the "Tool results:\n\n" header; keep the payload. Wrap as JSON
        // so observation shape matches Qwen's tool_response prior.
        const payload = m.content.replace(/^Tool results:\s*\n+/, '');
        conversations.push({ from: 'observation', value: JSON.stringify({ result: payload }) });
      } else {
        conversations.push({ from: 'human', value: m.content });
      }
      continue;
    }
    if (m.role === 'assistant') {
      const t = m.content.trim();
      const match = t.match(TOOL_CALL_BLOCK_RE) ?? t.match(TOOL_CALL_LINE_RE);
      if (match) {
        const call = JSON.parse(match[1]) as { name: string; args?: unknown; arguments?: unknown };
        conversations.push({
          from: 'function_call',
          value: JSON.stringify({
            name: call.name,
            arguments: call.arguments ?? call.args ?? {},
          }),
        });
      } else {
        conversations.push({ from: 'gpt', value: m.content });
      }
      continue;
    }
    throw new Error(`unhandled role ${m.role}`);
  }

  // Always emit `system` (empty string when absent) — datasets infers a
  // uniform column type and chokes casting a present-string/missing-null mix.
  const out: ShareRec = { conversations, system: system ?? '', tools: TOOLS_STRING };
  return out;
}

function load(p: string): Rec[] {
  return readFileSync(p, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as Rec);
}

const DATASET_INFO = {
  retired_train: {
    file_name: 'lf_train.json',
    formatting: 'sharegpt',
    columns: { messages: 'conversations', system: 'system', tools: 'tools' },
    tags: {
      role_tag: 'from',
      content_tag: 'value',
      user_tag: 'human',
      assistant_tag: 'gpt',
      function_tag: 'function_call',
      observation_tag: 'observation',
    },
  },
  retired_eval: {
    file_name: 'lf_eval.json',
    formatting: 'sharegpt',
    columns: { messages: 'conversations', system: 'system', tools: 'tools' },
    tags: {
      role_tag: 'from',
      content_tag: 'value',
      user_tag: 'human',
      assistant_tag: 'gpt',
      function_tag: 'function_call',
      observation_tag: 'observation',
    },
  },
};

function main(): void {
  const train = load(join(here, 'data', 'corpus.train.jsonl')).map(convert);
  const evals = load(join(here, 'data', 'corpus.eval.jsonl')).map(convert);
  // Compact (no indent) — LLaMA-Factory parses identically and these files are
  // large; pretty-printing doubles their size for zero training benefit.
  writeFileSync(join(here, 'data', 'lf_train.json'), JSON.stringify(train));
  writeFileSync(join(here, 'data', 'lf_eval.json'), JSON.stringify(evals));
  writeFileSync(join(here, 'data', 'dataset_info.json'), JSON.stringify(DATASET_INFO, null, 2));
  console.error(`train: ${train.length}  eval: ${evals.length}`);
  // Sanity: report role transition counts so a bad fold is visible.
  let fn = 0; let obs = 0; let sys = 0;
  for (const r of train) {
    if (r.system) sys++;
    for (const c of r.conversations) {
      if (c.from === 'function_call') fn++;
      if (c.from === 'observation') obs++;
    }
  }
  console.error(`train: ${fn} function_call, ${obs} observation, ${sys} with system`);
}

main();
