// Bake-off DASHBOARD runner. Opens ONE persistent visible page that shows a live
// status card per base, then runs the bases sequentially (one model in WebGPU
// memory at a time — safe on a 16 GB card) while pushing state to the cards.
//
// You watch the browser window: each card shows queued → downloading % → running
// x/165 → done→score, and the banner up top names the active base + overall %.
// A card that stops advancing for >STALL_MS is flagged STUCK in red.
//
// Usage:
//   node training/driver/runDashboard.mjs                    # all candidates, smallest first
//   node training/driver/runDashboard.mjs --only Qwen3-0.6B  # one base
//   node training/driver/runDashboard.mjs --limit 20         # first N eval records (smoke)
//   node training/driver/runDashboard.mjs --serve-port 8788 --cdp-port 9222
//
// Replies are written to training/data/bakeoff/<modelId>.replies.json (aligned to
// the eval split), then the driver scores each base in-process and pushes the
// protocol-validity % onto its card. Score again later with:
//   npx tsx training/runGate.ts --replies data/bakeoff/<modelId>.replies.json --model <id>

import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChrome, openTab, TabSession } from './cdp.mjs';

const here = dirname(fileURLToPath(import.meta.url));       // training/driver
const trainingDir = dirname(here);                          // training/
const outDir = join(trainingDir, 'data', 'bakeoff');

const STALL_MS = 90000;   // no reply for this long → flag the card STUCK

function arg(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const ONLY = arg('--only');
const LIMIT = arg('--limit') ? Number(arg('--limit')) : undefined;
const SERVE_PORT = Number(arg('--serve-port') ?? 8788);
const CDP_PORT = Number(arg('--cdp-port') ?? 9222);

const MIME = { '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript' };

/** Loopback-only dev server. The URL path is validated against a strict allowlist
 *  (letters/digits/`._-/`, no `..`) before it touches the filesystem — CodeQL
 *  recognizes the character allowlist as a sanitizer; root confinement is
 *  defense-in-depth on top (CodeQL: uncontrolled data in path expression). */
function serve() {
  const root = resolve(here);
  const server = createServer((req, res) => {
    const urlPath = req.url === '/' ? '/dashboard.html' : req.url.split('?')[0];
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
 *  bypass the shim: local node_modules first, then the npm `_npx` cache. */
async function findTsxCli() {
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

/** Load the eval-split tool-call records + production system prompt via a tsx
 *  side-process so this .mjs stays dependency-free (no TS import). */
async function loadEvalSet() {
  const { execFileSync } = await import('node:child_process');
  const extractor = join(trainingDir, 'driver', 'extractEvalSet.ts');
  const tsx = await findTsxCli();
  const json = execFileSync(process.execPath, [tsx, extractor], { cwd: dirname(trainingDir), maxBuffer: 64 * 1024 * 1024 }).toString();
  return JSON.parse(json); // { systemPrompt, records: [{id, question}] }
}

/** Score one base's replies against the eval split, in-process, via a tsx
 *  side-process running the real gate. Returns { pct, tiers } or null. */
async function scoreReplies(modelId, repliesFile, limit) {
  const { execFileSync } = await import('node:child_process');
  const scorer = join(trainingDir, 'driver', 'scoreOne.ts');
  const tsx = await findTsxCli();
  const rel = repliesFile.split(/[\\/]data[\\/]/).pop();
  const args = [tsx, scorer, '--replies', `data/${rel}`, '--model', modelId];
  if (limit) args.push('--limit', String(limit));
  try {
    const out = execFileSync(process.execPath, args, { cwd: dirname(trainingDir), maxBuffer: 16 * 1024 * 1024 }).toString();
    return JSON.parse(out.trim().split('\n').pop()); // last line is the JSON summary
  } catch { return null; }
}

const oneLine = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

async function main() {
  mkdirSync(outDir, { recursive: true });
  const { systemPrompt, records } = await loadEvalSet();
  const evalRecords = LIMIT ? records.slice(0, LIMIT) : records;

  const { CANDIDATES_SMALLEST_FIRST } = await import('./candidates.mjs');
  const bases = ONLY
    ? CANDIDATES_SMALLEST_FIRST.filter((b) => b.modelId.includes(ONLY) || b.label.includes(ONLY))
    : CANDIDATES_SMALLEST_FIRST;
  if (bases.length === 0) { console.error(`no base matched --only ${ONLY}`); process.exit(2); }

  const server = await serve();
  const chrome = await launchChrome({ port: CDP_PORT, gpu: true, headless: false });

  // One persistent tab for the whole sweep.
  const target = await openTab(`http://127.0.0.1:${SERVE_PORT}/dashboard.html`, CDP_PORT);
  const tab = new TabSession(target.webSocketDebuggerUrl);
  await tab.connect();
  await tab.evalWhenReady(`(async () => { for (let i=0;i<150 && !window.BAKEOFF_READY;i++) await new Promise(r=>setTimeout(r,100)); if (!window.BAKEOFF_READY) throw new Error('dashboard never became ready'); return true; })()`);

  const gpu = await tab.evalWhenReady(`(async () => window.BAKEOFF.hasWebGPU())()`);
  if (!gpu) {
    await tab.callFn(`() => window.DASH.setBanner('No WebGPU adapter — cannot run the bake-off', 'stuck')`, []);
    throw new Error('no WebGPU adapter');
  }

  // Create one card per base up front so the whole sweep is visible at a glance.
  for (const base of bases) {
    await tab.callFn(
      `(id, label, sizeGB) => window.DASH.makeCard(id, label, sizeGB)`,
      [base.modelId, base.label, base.sizeGB],
    );
  }

  const results = [];
  try {
    for (let b = 0; b < bases.length; b++) {
      const base = bases[b];
      const id = base.modelId;
      await tab.callFn(`(id) => window.DASH.update(id, { active: true, phase: 'loading…', phaseClass: 'active', pct: 0 })`, [id]);
      await tab.callFn(`(t) => window.DASH.setBanner(t, 'run')`, [`[${b + 1}/${bases.length}] ${base.label} — downloading / warming`]);

      // Download + warm (progress callback on the page updates the card's bar).
      await tab.callFn(`(modelId, cardId) => window.BAKEOFF.load(modelId, cardId)`, [base.modelId, id], { timeoutMs: 900000 });

      // Run the eval questions, pushing a heartbeat per reply.
      await tab.callFn(`(id) => window.DASH.update(id, { phase: 'running', pct: 0 })`, [id]);
      const replies = [];
      let lastAdvance = Date.now();
      // Stall watchdog: if no reply lands for STALL_MS, flag the card + banner so a
      // hung model is obvious instead of a silently frozen progress bar.
      let stalled = false;
      const watchdog = setInterval(async () => {
        if (Date.now() - lastAdvance > STALL_MS && !stalled) {
          stalled = true;
          try {
            await tab.callFn(`(id) => window.DASH.update(id, { phaseClass: 'failed' })`, [id]);
            await tab.callFn(`(t) => window.DASH.setBanner(t, 'stuck')`, [`STUCK: ${base.label} — no reply for ${Math.round(STALL_MS / 1000)}s`]);
          } catch {}
        }
      }, 5000);
      const diag = { thought: 0, lengthCut: 0, noCall: 0 };
      for (let i = 0; i < evalRecords.length; i++) {
        const q = evalRecords[i].question;
        const r = await tab.callFn(
          `(systemPrompt, question) => window.BAKEOFF.reply(systemPrompt, question)`,
          [systemPrompt, q],
          { timeoutMs: 180000 },
        );
        const text = typeof r === 'string' ? r : (r?.text ?? '');
        replies.push(text);
        if (r && typeof r === 'object') {
          if (r.thought) diag.thought++;
          if (r.finishReason === 'length') diag.lengthCut++;
          if (!r.hasCall) diag.noCall++;
        }
        lastAdvance = Date.now();
        stalled = false;
        const done = i + 1, pct = done / evalRecords.length;
        await tab.callFn(
          `(id, patch) => window.DASH.update(id, patch)`,
          [id, { phase: `running ${done}/${evalRecords.length}`, pct, last: '→ ' + oneLine(text).slice(0, 70) }],
        );
        await tab.callFn(`(t) => window.DASH.setBanner(t, 'run')`,
          [`[${b + 1}/${bases.length}] ${base.label} — ${done}/${evalRecords.length}  (overall ${Math.floor((((b * evalRecords.length) + done) / (bases.length * evalRecords.length)) * 100)}%)`]);
      }
      clearInterval(watchdog);
      // Self-audit line: for a thinking base we expect thought>0 and lengthCut==0;
      // a nonzero lengthCut means 2048 wasn't enough headroom and the score is
      // truncated, not a fair read of the base.
      console.error(`  [diag] ${base.label}: thought ${diag.thought}/${evalRecords.length} · length-cut ${diag.lengthCut} · no-call ${diag.noCall}`);

      // Write replies, score in-process, push the verdict onto the card.
      const outFile = join(outDir, `${id}.replies.json`);
      writeFileSync(outFile, JSON.stringify(replies, null, 2));
      const scored = await scoreReplies(id, outFile, LIMIT);
      const pass = scored && scored.pct >= 0.95;
      // Prefix the tiers line with the think/length audit so the card shows at a
      // glance whether this base thought and whether any reply was cut off.
      const diagNote = `think ${diag.thought}/${evalRecords.length} · len-cut ${diag.lengthCut}`;
      const tiersLine = (scored?.tiers ?? '') + (scored ? ' — ' : '') + diagNote;
      await tab.callFn(`(id, patch) => window.DASH.update(id, patch)`, [id, {
        active: false,
        cardClass: pass ? 'done' : 'failed',
        phase: pass ? 'done' : 'done (below bar)', phaseClass: pass ? 'done' : 'failed',
        pct: 1,
        score: scored ? `protocol-validity ${(scored.pct * 100).toFixed(1)}%` : 'score unavailable',
        scoreClass: pass ? 'pass' : 'fail',
        tiers: tiersLine,
      }]);
      results.push({ base, pct: scored?.pct ?? null, tiers: tiersLine });
    }

    const cleared = results.filter((r) => r.pct != null && r.pct >= 0.95);
    const summary = cleared.length
      ? `Done — smallest clearing 95%: ${cleared[0].base.label} (${(cleared[0].pct * 100).toFixed(1)}%)`
      : 'Done — no base cleared the 95% bar';
    await tab.callFn(`(t) => window.DASH.setBanner(t, '')`, [summary]);
    console.error('\n' + summary);
    for (const r of results) console.error(`  ${r.base.label.padEnd(18)} ${r.pct == null ? 'n/a' : (r.pct * 100).toFixed(1) + '%'}`);

    // Persist the board so it survives the browser window and can be read back /
    // pasted without screenshots: results.json (machine) + results.md (human).
    const stamp = new Date().toISOString();
    const board = {
      generatedAt: stamp,
      think: 'allowed (not suppressed) · max_tokens 2048',
      evalRecords: evalRecords.length,
      bar: 0.95,
      bases: results.map((r) => ({ modelId: r.base.modelId, label: r.base.label, sizeGB: r.base.sizeGB, protocolValidity: r.pct })),
    };
    writeFileSync(join(outDir, 'results.json'), JSON.stringify(board, null, 2));
    const md = [
      `# Bake-off results — ${stamp}`,
      ``,
      `thinking allowed (not suppressed) · temperature 0 · max_tokens 2048 · ${evalRecords.length} eval records · bar 95%`,
      ``,
      `| base | size | protocol-validity | clears bar | tiers |`,
      `|---|---|---|---|---|`,
      ...results.map((r) => `| ${r.base.label} | ~${r.base.sizeGB}GB | ${r.pct == null ? 'n/a' : (r.pct * 100).toFixed(1) + '%'} | ${r.pct != null && r.pct >= 0.95 ? '✅' : '—'} | ${r.tiers} |`),
      ``,
      `**${summary}**`,
    ].join('\n');
    writeFileSync(join(outDir, 'results.md'), md);
    console.error(`\nwrote ${join(outDir, 'results.md')}`);
  } catch (e) {
    // Leave the window showing where it stopped.
    try { await tab.callFn(`(t) => window.DASH.setBanner(t, 'stuck')`, [`STOPPED: ${e.message}`]); } catch {}
    throw e;
  } finally {
    try { server.close(); } catch {}
    // Keep Chrome open so you can read the final board; close it yourself.
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
