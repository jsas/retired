// Per-question scoring helper for the dashboard's live score. The driver
// spawns this ONCE via tsx and holds stdin/stdout open; each line on stdin is
// {question, reply} → one line of JSON back with the scorers' verdict.
// Using mintReadRecords + scoreReply directly (not gateReport) because the
// gate report is meant for whole-set judgement, and we just want live %
// against the CURRENT question — the same judgement the driver's partial
// score uses at SKIP_AFTER.

import { mintReadRecords } from '../mint';
import { scoreReply } from '../eval';
import readline from 'node:readline';

const all = mintReadRecords().filter((r) => r.split === 'eval' && r.kind === 'tool-call');
const byId = new Map(all.map((r) => [r.id, r]));

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  try {
    const q = JSON.parse(line);
    const record = byId.get(q.id);
    const reply = String(q.reply ?? '');
    if (!record) { process.stdout.write(JSON.stringify({ error: 'unknown id' }) + '\n'); return; }
    const s = scoreReply(record, reply);
    process.stdout.write(JSON.stringify({ id: q.id, valid: s.valid, parseable: s.parseable, argsValid: s.argsValid, toolMatch: s.toolMatch }) + '\n');
  } catch (e) {
    process.stdout.write(JSON.stringify({ error: String(e) }) + '\n');
  }
});
