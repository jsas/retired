// One-shot: dump the eval+tool-call records to JSON so per-chunk scoring can
// skip the heavy mintReadRecords() import chain (@retired/mcp-tools etc.) and
// compile fast. Run once per corpus change:
//   npx tsx training/dumpEvalRecords.ts --out training/sft/<out>/dashboard/eval-records.json
//
// The records are deterministic for a given corpus, so caching them is safe —
// if mint.ts or the corpus changes, re-run this.

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mintReadRecords } from './mint';

const here = dirname(fileURLToPath(import.meta.url));

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const out = arg('--out');
if (!out) {
  console.error('usage: npx tsx dumpEvalRecords.ts --out <path.json>');
  process.exit(2);
}

const records = mintReadRecords().filter(
  (r) => r.split === 'eval' && r.kind === 'tool-call',
);
const full = join(here, out);
mkdirSync(dirname(full), { recursive: true });
writeFileSync(full, JSON.stringify(records));
console.error(`wrote ${records.length} eval records -> ${full}`);
