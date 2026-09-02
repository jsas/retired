import { mintReadRecords } from '../mint';
import { scoreReply } from '../eval';
import * as fs from 'node:fs';

interface Rec { id: string; split: string; kind: string; messages: { role: string; content: string }[] }
interface Reply { id: string; reply: string }
interface Fail { id: string; expected: string; actual: string; parseable: boolean; argsValid: boolean; toolMatch: boolean }
interface Score { valid: boolean; parseable: boolean; argsValid: boolean; toolMatch: boolean }

const evalSet = (mintReadRecords() as Rec[]).filter((r) => r.split === 'eval' && r.kind === 'tool-call');
const repliesRaw = fs.readFileSync(process.argv[2] ?? 'training/sft/out/replies-v2-fixed.json', 'utf-8');
const parsed = JSON.parse(repliesRaw);
const replies: Reply[] = Array.isArray(parsed)
  ? evalSet.map((r, i) => ({ id: r.id, reply: String(parsed[i] ?? '') }))
  : (parsed as Reply[]);

const fails: Fail[] = [];
const byPair: Record<string, number> = {};

for (const rec of evalSet) {
  const idx = evalSet.indexOf(rec);
  const r = replies[idx];
  if (!r || typeof r !== 'object') continue;
  const s = scoreReply(rec, r.reply) as Score;
  if (s.valid) continue;
  const asst = rec.messages.find((m) => m.role === 'assistant')?.content ?? '';
  const expected = asst.match(/"name":\s*"([^"]+)"/)?.[1] ?? 'unknown';
  const actual = r.reply.match(/TOOL_CALL:\s*[^"']*"name":\s*"([^"]+)"/)?.[1] ?? 'parse-fail';
  const pair = expected + ' vs ' + actual;
  byPair[pair] = (byPair[pair] ?? 0) + 1;
  fails.push({ id: rec.id, expected, actual, parseable: s.parseable, argsValid: s.argsValid, toolMatch: s.toolMatch });
}

console.log(`evaluated ${evalSet.length}, failed ${fails.length}`);
const sorted = Object.entries(byPair).sort((a, b) => b[1] - a[1]);
sorted.slice(0, 20).forEach(([p, c]) => console.log(`${String(c).padStart(4)} ${p}`));
console.log('--- sample fails ---');
fails.slice(0, 5).forEach((f) => console.log(JSON.stringify(f)));
