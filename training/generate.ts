// Runnable corpus generator: mints the engine-grounded records and writes the
// train/eval JSONL the off-repo training + the bake-off eval consume.
//
// Run from the repo root:
//   npx tsx training/generate.ts            # writes training/data/*.jsonl
//
// (tsx runs TypeScript directly; the engine is deterministic, so re-running
// reproduces the same corpus byte-for-byte unless the engine or catalog changes
// — which is exactly when you WANT a fresh corpus.)

import { writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mintReadRecords, toJsonl } from './mint';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'data');

const records = mintReadRecords();
const train = records.filter((r) => r.split === 'train');
const evals = records.filter((r) => r.split === 'eval');

mkdirSync(outDir, { recursive: true });
const trainJsonl = toJsonl(train);
const evalJsonl = toJsonl(evals);
writeFileSync(join(outDir, 'corpus.train.jsonl'), trainJsonl);
writeFileSync(join(outDir, 'corpus.eval.jsonl'), evalJsonl);

// The eval hash (printed below) is the spike's analogue of the golden-master
// rule: a shipped model is always scored against the same frozen eval set.
// training/data/ is gitignored — re-running this regenerates the corpus; when
// the engine/catalog legitimately changes the output, the hash changes and the
// bake-off must be re-run (never let it drift silently).
const hash = createHash('sha256').update(evalJsonl).digest('hex').slice(0, 16);
writeFileSync(join(outDir, 'corpus.eval.sha256'), `${hash}  corpus.eval.jsonl\n`);

const byTool = new Map<string, number>();
for (const r of records) {
  const t = r.expect.toolName ?? '(none)';
  byTool.set(t, (byTool.get(t) ?? 0) + 1);
}
console.error(`minted ${records.length} records (${train.length} train / ${evals.length} eval)`);
console.error(`eval sha256: ${hash}`);
console.error('records per tool:');
for (const [tool, n] of [...byTool.entries()].sort()) {
  console.error(`  ${tool}: ${n}`);
}
