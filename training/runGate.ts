// Runnable eval-gate driver. Two uses:
//
//   1. Corpus self-check (default, no model needed): feed each eval record's
//      OWN assistant target back through the gate as the "reply". A correct
//      corpus scores 100% protocol-validity — the sanity floor that must hold
//      before any real model is measured. Run:
//          npx tsx training/runGate.ts
//
//   2. Model scoring: pipe a JSON file of the model's replies (aligned to the
//      eval records' order) to score an actual base. The bake-off drives this.
//          npx tsx training/runGate.ts --replies path/to/replies.json --model Qwen3-0.6B
//
// Exit code is 0 iff the gate passes, so CI / the bake-off can gate on it.

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mintReadRecords } from './mint';
import { gateReport } from './eval';
import { THRESHOLDS } from './bakeoff';
import type { CorpusRecord } from './buildCorpus';

const here = dirname(fileURLToPath(import.meta.url));

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** The eval records that expect a tool call, in a stable order. */
function evalCallRecords(): CorpusRecord[] {
  return mintReadRecords().filter((r) => r.split === 'eval' && r.kind === 'tool-call');
}

async function main(): Promise<number> {
  const allRecords = evalCallRecords();
  const threshold = THRESHOLDS.postSftShipBar;

  const repliesPath = arg('--replies');
  const modelId = arg('--model') ?? 'corpus-self-check';
  const limit = arg('--limit') ? Number(arg('--limit')) : undefined;

  let replies: string[];
  if (repliesPath) {
    const full = join(here, repliesPath);
    if (!existsSync(full)) {
      console.error(`replies file not found: ${full}`);
      return 2;
    }
    replies = JSON.parse(readFileSync(full, 'utf8')) as string[];
  } else {
    // Self-check: the assistant target of each record IS the "reply".
    replies = allRecords.map((r) => {
      const assistant = r.messages.find((m) => m.role === 'assistant');
      if (!assistant) throw new Error(`${r.id} has no assistant target`);
      return assistant.content;
    });
  }

  // A partial bake-off (--limit N) scores only the first N eval records.
  const records = limit ? allRecords.slice(0, limit) : allRecords;
  if (records.length !== replies.length) {
    console.error(`records (${records.length}) and replies (${replies.length}) must align — pass --limit ${replies.length} to match a partial bake-off`);
    return 2;
  }

  const report = gateReport(modelId, records, replies, threshold);

  console.error(`\n=== protocol-validity gate: ${report.modelId} ===`);
  console.error(`records:            ${report.total}`);
  console.error(`protocol-validity:  ${(report.protocolValidity * 100).toFixed(1)}%  (bar ${(report.threshold * 100).toFixed(0)}%)`);
  console.error(`tiers: parseable ${(report.tiers.parseable * 100).toFixed(0)}%  in-catalog ${(report.tiers.inCatalog * 100).toFixed(0)}%  args-valid ${(report.tiers.argsValid * 100).toFixed(0)}%  tool-match ${(report.tiers.toolMatch * 100).toFixed(0)}%`);
  if (Object.keys(report.failures).length > 0) {
    console.error('failures:');
    for (const [reason, n] of Object.entries(report.failures).sort((a, b) => b[1] - a[1])) {
      console.error(`  ${n}× ${reason}`);
    }
  }
  console.error(`result: ${report.passed ? 'PASS' : 'FAIL'}\n`);
  return report.passed ? 0 : 1;
}

main().then((code) => process.exit(code));
