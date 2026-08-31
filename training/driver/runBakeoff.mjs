// Bake-off driver: load each stock tiny base in WebGPU (smallest first), feed
// every eval-split tool-call question through the production system prompt,
// capture the raw replies, and write replies JSON the eval gate scores.
//
// This is the "confirm" half of the spike: it turns the corpus eval set into a
// per-base protocol-validity number on REAL hardware, so the smallest base that
// clears the bar picks itself. Everything runs client-side in a headless-Chrome
// tab via web-llm — no server, no proxying.
//
// Usage:
//   node training/driver/runBakeoff.mjs                      # all candidates, smallest first
//   node training/driver/runBakeoff.mjs --only Qwen3-0.6B    # one base
//   node training/driver/runBakeoff.mjs --limit 20           # first N eval records (smoke test)
//   node training/driver/runBakeoff.mjs --visible            # headed Chrome: watch the page
//   node training/driver/runBakeoff.mjs --verbose            # print each Q + A as it lands
//   node training/driver/runBakeoff.mjs --serve-port 8788 --cdp-port 9222
//
// Output: training/data/bakeoff/<modelId>.replies.json  (aligned to the eval
// tool-call records the gate consumes) — then:
//   npx tsx training/runGate.ts --replies data/bakeoff/<modelId>.replies.json --model <id>

import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChrome, openTab, TabSession } from './cdp.mjs';

const here = dirname(fileURLToPath(import.meta.url));       // training/driver
const trainingDir = dirname(here);                          // training/
const outDir = join(trainingDir, 'data', 'bakeoff');

function arg(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const ONLY = arg('--only');
const LIMIT = arg('--limit') ? Number(arg('--limit')) : undefined;
const VISIBLE = process.argv.includes('--visible');   // headed Chrome so you can watch
const VERBOSE = process.argv.includes('--verbose');   // print each reply as it lands
const SERVE_PORT = Number(arg('--serve-port') ?? 8788);
const CDP_PORT = Number(arg('--cdp-port') ?? 9222);

const MIME = { '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript' };

/** Serve the driver dir over http so Chrome can load the harness as a module
 *  (file:// blocks ESM + WebGPU in some configs). Loopback-only dev server. The
 *  URL path is validated against a strict allowlist (letters/digits/`._-/`, no
 *  `..`) before it touches the filesystem — CodeQL recognizes the character
 *  allowlist as a sanitizer, and confining to the serve root is defense-in-depth
 *  on top (CodeQL: uncontrolled data in path expression). */
function serve() {
  const root = resolve(here);
  const server = createServer((req, res) => {
    const urlPath = req.url === '/' ? '/harness.html' : req.url.split('?')[0];
    // Reject anything that isn't a plain in-root relative path.
    if (!/^\/[A-Za-z0-9._\-/]*$/.test(urlPath) || urlPath.includes('..')) {
      res.writeHead(403); res.end('forbidden'); return;
    }
    const file = resolve(root, `.${urlPath}`);
    if (!file.startsWith(root + sep)) { res.writeHead(403); res.end('forbidden'); return; }
    if (!existsSync(file)) { res.writeHead(404); res.end('nope'); return; }
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'text/plain' });
    res.end(readFileSync(file));
  });
  return new Promise((resolve) => server.listen(SERVE_PORT, () => resolve(server)));
}

/** Locate the tsx CLI entry (cli.mjs) so we can run it under `node` directly.
 *  On Windows, spawning `npx`/`npx.cmd` from Node fails (ENOENT / EINVAL), so we
 *  bypass the shim: check local node_modules first, then the npm `_npx` cache
 *  (where `npx tsx` installed it on first use). */
async function findTsxCli() {
  const { existsSync } = await import('node:fs');
  const { readdirSync } = await import('node:fs');
  const local = join(dirname(trainingDir), 'node_modules', 'tsx', 'dist', 'cli.mjs');
  if (existsSync(local)) return local;
  const cacheRoot = process.platform === 'win32'
    ? join(process.env.LOCALAPPDATA ?? '', 'npm-cache', '_npx')
    : join(process.env.HOME ?? '', '.npm', '_npx');
  if (existsSync(cacheRoot)) {
    for (const dir of readdirSync(cacheRoot)) {
      const candidate = join(cacheRoot, dir, 'node_modules', 'tsx', 'dist', 'cli.mjs');
      if (existsSync(candidate)) return candidate;
    }
  }
  throw new Error('tsx not found — run `npx tsx --version` once to prime the npx cache');
}

/** Load the eval-split tool-call records + production system prompt, extracted
 *  by a tiny tsx side-process so this .mjs stays dependency-free (no TS import). */
async function loadEvalSet() {
  const { execFileSync } = await import('node:child_process');
  const extractor = join(trainingDir, 'driver', 'extractEvalSet.ts');
  const tsx = await findTsxCli();
  const json = execFileSync(process.execPath, [tsx, extractor], { cwd: dirname(trainingDir), maxBuffer: 64 * 1024 * 1024 }).toString();
  return JSON.parse(json); // { systemPrompt, records: [{id, question}] }
}

async function main() {
  mkdirSync(outDir, { recursive: true });
  const { systemPrompt, records } = await loadEvalSet();
  const evalRecords = LIMIT ? records.slice(0, LIMIT) : records;
  console.error(`eval set: ${evalRecords.length} tool-call records (system prompt ${systemPrompt.length} chars)`);

  const { CANDIDATES_SMALLEST_FIRST } = await import('./candidates.mjs');
  const bases = ONLY
    ? CANDIDATES_SMALLEST_FIRST.filter((b) => b.modelId.includes(ONLY) || b.label.includes(ONLY))
    : CANDIDATES_SMALLEST_FIRST;
  if (bases.length === 0) { console.error(`no base matched --only ${ONLY}`); process.exit(2); }

  const server = await serve();
  const chrome = await launchChrome({ port: CDP_PORT, gpu: true, headless: !VISIBLE });

  try {
    for (const base of bases) {
      console.error(`\n=== ${base.label} (${base.modelId}, ~${base.sizeGB}GB) ===`);
      const target = await openTab(`http://127.0.0.1:${SERVE_PORT}/harness.html`, CDP_PORT);
      const tab = new TabSession(target.webSocketDebuggerUrl);
      await tab.connect();

      // Wait for the module script to install the BAKEOFF channel.
      await tab.evalWhenReady(`(async () => { for (let i=0;i<100 && !window.BAKEOFF_READY;i++) await new Promise(r=>setTimeout(r,100)); if (!window.BAKEOFF_READY) throw new Error('harness never became ready'); return true; })()`);

      const gpu = await tab.evalWhenReady(`(async () => window.BAKEOFF.hasWebGPU())()`);
      console.error(`webgpu adapter: ${gpu ? 'YES' : 'NO — aborting this base'}`);
      if (!gpu) { await tab.close(); continue; }

      // Download + warm the model (slow on first run; cached in the browser profile after).
      // modelId crosses as a bound argument, not interpolated into the eval source.
      await tab.callFn(`(modelId) => window.BAKEOFF.load(modelId)`, [base.modelId], { timeoutMs: 900000 });
      console.error('model loaded; running eval…');

      const replies = [];
      const t0 = Date.now();
      for (let i = 0; i < evalRecords.length; i++) {
        const q = evalRecords[i].question;
        const text = await tab.callFn(
          `(systemPrompt, question) => window.BAKEOFF.reply(systemPrompt, question)`,
          [systemPrompt, q],
          { timeoutMs: 120000 },
        );
        replies.push(text);
        const oneLine = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
        if (VERBOSE) {
          console.error(`  [${i + 1}/${evalRecords.length}] Q: ${oneLine(q).slice(0, 90)}`);
          console.error(`       A: ${oneLine(text).slice(0, 140)}`);
        } else {
          // Live one-line progress with a rough ETA so a long run isn't silent.
          const done = i + 1, per = (Date.now() - t0) / done, eta = Math.round((per * (evalRecords.length - done)) / 1000);
          process.stderr.write(`\r  ${done}/${evalRecords.length}  last: ${oneLine(text).slice(0, 70)}   (eta ${eta}s)   `);
          if (done === evalRecords.length) process.stderr.write('\n');
        }
      }

      const outFile = join(outDir, `${base.modelId}.replies.json`);
      writeFileSync(outFile, JSON.stringify(replies, null, 2));
      console.error(`wrote ${outFile} (${replies.length} replies)`);
      await tab.close();
    }
  } finally {
    try { server.close(); } catch {}
    try { chrome.kill?.(); } catch {}
  }

  console.error('\nbake-off done. Score a base with:');
  for (const base of bases) {
    console.error(`  npx tsx training/runGate.ts --replies data/bakeoff/${base.modelId}.replies.json --model ${base.modelId}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
