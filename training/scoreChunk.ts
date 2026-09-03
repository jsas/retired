// Fast per-chunk scorer. Reads pre-dumped eval records (dumpEvalRecords.ts)
// and a replies file, then runs the SAME gateReport as runGate.ts — but only
// imports eval.ts (light: zod + types), not mint.ts (heavy: @retired/mcp-tools).
// This is what makes per-chunk eval viable; runGate.ts recompiles the mint
// chain for minutes each call. Output format matches runGate.ts so server.py's
// regex parses both identically.
//
//   npx tsx scoreChunk.ts --records <eval-records.json> --replies <replies.json> \
//       --model chunk-200 --limit 120

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gateReport } from './eval';
import { THRESHOLDS } from './bakeoff';
import type { CorpusRecord } from './buildCorpus';

const here = dirname(fileURLToPath(import.meta.url));

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function main(): number {
  const recordsPath = arg('--records');
  const repliesPath = arg('--replies');
  const modelId = arg('--model') ?? 'chunk';
  const limit = arg('--limit') ? Number(arg('--limit')) : undefined;
  if (!recordsPath || !repliesPath) {
    console.error('usage: --records <eval-records.json> --replies <replies.json> [--model id] [--limit N]');
    return 2;
  }
  // resolve() (not join) so absolute paths from the server pass through
  // unchanged; join() would wrongly concatenate an absolute second arg.
  const rf = resolve(here, recordsPath);
  const pf = resolve(here, repliesPath);
  if (!existsSync(rf)) { console.error(`records not found: ${rf}`); return 2; }
  if (!existsSync(pf)) { console.error(`replies not found: ${pf}`); return 2; }

  const all = JSON.parse(readFileSync(rf, 'utf8')) as CorpusRecord[];
  const replies = JSON.parse(readFileSync(pf, 'utf8')) as string[];
  const records = limit ? all.slice(0, limit) : all;
  if (records.length !== replies.length) {
    console.error(`records (${records.length}) and replies (${replies.length}) must align — pass --limit ${replies.length}`);
    return 2;
  }

  const threshold = THRESHOLDS.postSftShipBar;
  const report = gateReport(modelId, records, replies, threshold);

  console.error(`\n=== protocol-validity gate: ${report.modelId} ===`);
  console.error(`records:            ${report.total}`);
  console.error(`protocol-validity:  ${(report.protocolValidity * 100).toFixed(1)}%  (bar ${(threshold * 100).toFixed(0)}%)`);
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

process.exit(main());
