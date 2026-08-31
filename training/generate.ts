// Runnable corpus generator: mints the engine-grounded records and writes the
// train/eval JSONL the off-repo training + the bake-off eval consume.
//
// Run from the repo root:
//   npx tsx training/generate.ts            # writes training/data/*.jsonl
//   npx tsx training/generate.ts --subset 3 # additionally writes corpus.train.subset3.jsonl
//                                           # (every 3rd train record — deterministic reduced slice
//                                           #  for the full-SFT-vs-QLoRA tiebreak; eval is untouched)
//
// (tsx runs TypeScript directly; the engine is deterministic, so re-running
// reproduces the same corpus byte-for-byte unless the engine or catalog changes
// — which is exactly when you WANT a fresh corpus.)

import { writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mintCorpus, toJsonl } from './mint';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'data');

const records = mintCorpus();
const train = records.filter((r) => r.split === 'train');
const evals = records.filter((r) => r.split === 'eval');

mkdirSync(outDir, { recursive: true });
const trainJsonl = toJsonl(train);
const evalJsonl = toJsonl(evals);
writeFileSync(join(outDir, 'corpus.train.jsonl'), trainJsonl);
writeFileSync(join(outDir, 'corpus.eval.jsonl'), evalJsonl);

// Optional deterministic reduced-train slice for the full-SFT-vs-QLoRA tiebreak
// (SPIKE.md §5): same corpus, same eval, less train data — any protocol-validity
// gap between the two methods on this slice is a (conservative) proxy for the gap
// at full scale. Every-Nth by mint order keeps the kind/tool mix proportional.
const subsetArg = process.argv.find((a) => a.startsWith('--subset'));
if (subsetArg) {
  const n = Number(subsetArg.split('=')[1] ?? process.argv[process.argv.indexOf(subsetArg) + 1]);
  if (!Number.isInteger(n) || n < 2) throw new Error('--subset N: N must be an integer >= 2');
  const subset = train.filter((_, i) => i % n === 0);
  const subsetJsonl = toJsonl(subset);
  writeFileSync(join(outDir, `corpus.train.subset${n}.jsonl`), subsetJsonl);
  console.error(`subset: every ${n}th train record -> ${subset.length} records (corpus.train.subset${n}.jsonl)`);
}

// The eval hash (printed below) is the spike's analogue of the golden-master
// rule: a shipped model is always scored against the same frozen eval set.
// training/data/ is gitignored — re-running this regenerates the corpus; when
// the engine/catalog legitimately changes the output, the hash changes and the
// bake-off must be re-run (never let it drift silently).
const hash = createHash('sha256').update(evalJsonl).digest('hex').slice(0, 16);
writeFileSync(join(outDir, 'corpus.eval.sha256'), `${hash}  corpus.eval.jsonl\n`);

const byKind = new Map<string, number>();
const byTool = new Map<string, number>();
for (const r of records) {
  byKind.set(r.kind, (byKind.get(r.kind) ?? 0) + 1);
  if (r.expect.toolName) byTool.set(r.expect.toolName, (byTool.get(r.expect.toolName) ?? 0) + 1);
}
console.error(`minted ${records.length} records (${train.length} train / ${evals.length} eval)`);
console.error(`eval sha256: ${hash}`);
console.error('records per kind:');
for (const [kind, n] of [...byKind.entries()].sort()) console.error(`  ${kind}: ${n}`);
console.error('records per tool (engine-grounded):');
for (const [tool, n] of [...byTool.entries()].sort()) console.error(`  ${tool}: ${n}`);
