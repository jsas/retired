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
//   node training/driver/runBakeoff.mjs                      # tiny-tier candidates, smallest first
//   node training/driver/runBakeoff.mjs --set family         # dropped families + Qwen3.5 4B control
//   node training/driver/runBakeoff.mjs --only Qwen3-0.6B    # one base
//   node training/driver/runBakeoff.mjs --limit 20           # first N eval records (smoke test)
//   node training/driver/runBakeoff.mjs --serve-port 8788 --cdp-port 9222
//
// Output: training/data/bakeoff/<modelId>.replies.json  (aligned to the eval
// tool-call records the gate consumes) — then:
//   npx tsx training/runGate.ts --replies data/bakeoff/<modelId>.replies.json --model <id>

import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { launchChrome, openTab, TabSession } from './cdp.mjs';

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

/** Kill a detached Chrome (and its GPU children). `child.kill()` on Windows
 *  leaves the tree alive, which is how the last run left a dead adapter. */
function killChrome(child) {
  if (!child?.pid) return;
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      child.kill('SIGKILL');
    }
  } catch { /* already gone */ }
}

const here = dirname(fileURLToPath(import.meta.url));       // training/driver
const trainingDir = dirname(here);                          // training/
const outDir = join(trainingDir, 'data', 'bakeoff');

function arg(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const ONLY = arg('--only');
const SET = arg('--set') ?? 'tiny';
const LIMIT = arg('--limit') ? Number(arg('--limit')) : undefined;
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

  const { CANDIDATES_SMALLEST_FIRST, FAMILY_CANDIDATES } = await import('./candidates.mjs');
  const pool = SET === 'family' ? FAMILY_CANDIDATES : CANDIDATES_SMALLEST_FIRST;
  if (SET !== 'tiny' && SET !== 'family') {
    console.error(`unknown --set ${SET} (want tiny|family)`);
    process.exit(2);
  }
  const bases = ONLY
    ? pool.filter((b) => b.modelId.includes(ONLY) || b.label.includes(ONLY))
    : pool;
  if (bases.length === 0) { console.error(`no base matched --only ${ONLY}`); process.exit(2); }

  const server = await serve();
  let chrome = await launchChrome({ port: CDP_PORT, gpu: true });

  async function freshChrome(reason) {
    console.error(`restarting Chrome (${reason})`);
    killChrome(chrome);
    await sleep(4000);
    chrome = await launchChrome({ port: CDP_PORT, gpu: true });
  }

  async function openHarness() {
    const target = await openTab(`http://127.0.0.1:${SERVE_PORT}/harness.html`, CDP_PORT);
    const tab = new TabSession(target.webSocketDebuggerUrl);
    await tab.connect();
    await tab.evalWhenReady(`(async () => { for (let i=0;i<100 && !window.BAKEOFF_READY;i++) await new Promise(r=>setTimeout(r,100)); if (!window.BAKEOFF_READY) throw new Error('harness never became ready'); return true; })()`);
    return tab;
  }

  try {
    for (const base of bases) {
      console.error(`\n=== ${base.label} (${base.modelId}, ~${base.sizeGB}GB) ===`);
      const outFile = join(outDir, `${base.modelId}.replies.json`);
      if (existsSync(outFile)) {
        console.error(`skip — already have ${outFile}`);
        continue;
      }

      let tab = await openHarness();
      let gpu = await tab.evalWhenReady(`(async () => window.BAKEOFF.hasWebGPU())()`);
      if (!gpu) {
        await tab.close();
        await freshChrome('no WebGPU adapter');
        tab = await openHarness();
        gpu = await tab.evalWhenReady(`(async () => window.BAKEOFF.hasWebGPU())()`);
        if (!gpu) {
          console.error('webgpu adapter: NO after restart — skipping this base');
          writeFileSync(join(outDir, `${base.modelId}.error.txt`), 'webgpu adapter: NO after restart');
          await tab.close();
          continue;
        }
      }
      console.error('webgpu adapter: YES');

      try {
        await tab.callFn(`(modelId) => window.BAKEOFF.load(modelId)`, [base.modelId], { timeoutMs: 900000 });
      } catch (err) {
        console.error(`LOAD FAIL ${base.label}: ${err.message ?? err}`);
        writeFileSync(join(outDir, `${base.modelId}.error.txt`), String(err.message ?? err));
        await tab.close();
        await freshChrome(`load fail ${base.label}`);
        continue;
      }
      console.error('model loaded; running eval…');

      const replies = [];
      try {
        for (let i = 0; i < evalRecords.length; i++) {
          const q = evalRecords[i].question;
          let text;
          try {
            text = await tab.callFn(
              `(systemPrompt, question) => window.BAKEOFF.reply(systemPrompt, question)`,
              [systemPrompt, q],
              { timeoutMs: 180000 },
            );
          } catch (err) {
            text = `REPLY_FAIL: ${err.message ?? err}`;
            console.error(`  q${i + 1} FAIL: ${err.message ?? err}`);
          }
          replies.push(text);
          if ((i + 1) % 10 === 0 || i === evalRecords.length - 1) {
            console.error(`  ${i + 1}/${evalRecords.length}`);
          }
        }
        writeFileSync(outFile, JSON.stringify(replies, null, 2));
        console.error(`wrote ${outFile} (${replies.length} replies)`);
      } catch (err) {
        console.error(`EVAL FAIL ${base.label}: ${err.message ?? err}`);
        writeFileSync(join(outDir, `${base.modelId}.error.txt`), String(err.message ?? err));
      }
      await tab.close();
      await freshChrome(`done ${base.label}`);
    }
  } finally {
    try { server.close(); } catch {}
    killChrome(chrome);
  }

  console.error('\nbake-off done. Score a base with:');
  for (const base of bases) {
    console.error(`  npx tsx training/runGate.ts --replies data/bakeoff/${base.modelId}.replies.json --model ${base.modelId}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
