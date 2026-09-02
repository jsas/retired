// Machine-readable single-base scorer for the dashboard. Same scoring as
// runGate.ts, but emits ONE line of JSON on stdout (the last line) so the Node
// driver can read the verdict without parsing the human report. Run:
//   npx tsx training/driver/scoreOne.ts --replies data/bakeoff/<id>.replies.json --model <id> [--limit N]
// Last stdout line: { "pct": 0.42, "tiers": "parseable 80% …", "passed": false }

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mintReadRecords } from '../mint';
import { gateReport } from '../eval';
import { THRESHOLDS } from '../bakeoff';

const here = dirname(fileURLToPath(import.meta.url));       // training/driver
const trainingDir = dirname(here);                          // training/

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const repliesPath = arg('--replies');
const modelId = arg('--model') ?? 'unknown';
const limit = arg('--limit') ? Number(arg('--limit')) : undefined;

if (!repliesPath) { console.log(JSON.stringify({ error: 'no --replies' })); process.exit(2); }
const full = join(trainingDir, repliesPath);
if (!existsSync(full)) { console.log(JSON.stringify({ error: `not found: ${full}` })); process.exit(2); }

const replies = JSON.parse(readFileSync(full, 'utf8')) as string[];
const all = mintReadRecords().filter((r) => r.split === 'eval' && r.kind === 'tool-call');
const records = limit ? all.slice(0, limit) : all;
if (records.length !== replies.length) {
  console.log(JSON.stringify({ error: `records ${records.length} != replies ${replies.length}` }));
  process.exit(2);
}

const report = gateReport(modelId, records, replies, THRESHOLDS.postSftShipBar);
const pct = report.protocolValidity;
const t = report.tiers;
const tiers = `parseable ${(t.parseable * 100).toFixed(0)}% · in-catalog ${(t.inCatalog * 100).toFixed(0)}% · args-valid ${(t.argsValid * 100).toFixed(0)}% · tool-match ${(t.toolMatch * 100).toFixed(0)}`;
console.log(JSON.stringify({ pct, tiers, passed: report.passed }));
