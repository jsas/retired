// Emit the exact eval set the gate scores, plus the production tool-protocol
// system prompt, as a single JSON blob on stdout. The .mjs bake-off driver runs
// this via `npx tsx` so it can reuse the live TS catalog/prompt without becoming
// a TS file itself. Keeping this as the single extraction point guarantees the
// questions the model answers are byte-for-byte the records runGate.ts scores.
//
//   npx tsx training/driver/extractEvalSet.ts   →  { systemPrompt, records }

import { mintReadRecords } from '../mint';
import { TOOL_INSTRUCTIONS } from '../protocol';

const records = mintReadRecords()
  .filter((r) => r.split === 'eval' && r.kind === 'tool-call')
  .map((r) => ({
    id: r.id,
    scenarioId: r.scenarioId,
    question: r.messages.find((m) => m.role === 'user')?.content ?? '',
  }));

// The production tool-protocol instructions ARE the system prompt the model
// must answer against — using the live build keeps the eval honest (the model
// sees exactly what the shipped assistant sees).
process.stdout.write(JSON.stringify({ systemPrompt: TOOL_INSTRUCTIONS, records }));
