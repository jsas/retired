// Bake-off DASHBOARD runner. Opens ONE persistent visible page that shows a live
// status card per base+mode, then runs candidates sequentially while pushing
// state to the cards as it goes.
//
// For each thinker (think: true in candidates.mjs) we score BOTH modes:
//   ON  — think naturally (matches prod assistant inference setup)
//   OFF — force immediate answers via the ` /no_think` suffix
// The page shows one card per (base, mode) so both scores land per base.
//
// After SKIP_AFTER questions per mode, the driver runs a partial score:
// if not ONE valid call yet, the base is skipped (and the card says so) to
// stop wasting time on bases that trivially fail.
//
// Usage:
//   node training/driver/runDashboard.mjs                      # all bases × their modes
//   node training/driver/runDashboard.mjs --only Qwen3-0.6B   # one base (both modes)
//   node training/driver/runDashboard.mjs --limit 20          # first N eval records (smoke)
//   node training/driver/runDashboard.mjs --serve-port 8788 --cdp-port 9222
//
// Replies are written to data/bakeoff/<modelId>.<mode>.replies.json then scored.
// Final results live in results.md / results.json.

import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChrome, openTab, TabSession } from './cdp.mjs';

const here = dirname(fileURLToPath(import.meta.url));            // training/driver
const trainingDir = dirname(here);                               // training/

const outDir = join(trainingDir, 'data', 'bakeoff');

const STALL_MS = 90000;
// Skip a base's mode when this many questions had ZERO valid calls.
const SKIP_AFTER = 8;

function arg(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const ONLY = arg('--only');
const LIMIT = arg('--limit') ? Number(arg('--limit')) : undefined;
const SERVE_PORT = Number(arg('--serve-port') ?? 8788);
const CDP_PORT = Number(arg('--cdp-port') ?? 9222);

const MIME = { '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript' };

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

async function loadEvalSet() {
  const { execFileSync } = await import('node:child_process');
  const extractor = join(trainingDir, 'driver', 'extractEvalSet.ts');
  const tsx = await findTsxCli();
  const json = execFileSync(process.execPath, [tsx, extractor], { cwd: dirname(trainingDir), maxBuffer: 64 * 1024 * 1024 }).toString();
  return JSON.parse(json); // { systemPrompt, records: [{id, question}] }
}

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

  // Kick off server + Chrome together — they're both I/O-bound and neither
  // depends on the other, so this shaves the ~2-3s serial startup gap off every
  // run.
  console.log('[startup] launching static server + Chrome…');
  const [server, chrome] = await Promise.all([
    serve(),
    launchChrome({ port: CDP_PORT, gpu: true, headless: false }),
  ]);
  console.log('[startup] ready: server@' + SERVE_PORT + ' chrome@' + CDP_PORT);

  console.log('[startup] opening dashboard tab…');
  const target = await openTab(`http://127.0.0.1:${SERVE_PORT}/dashboard.html`, CDP_PORT);
  const tab = new TabSession(target.webSocketDebuggerUrl);
  await tab.connect();
  await tab.evalWhenReady(`(async () => { for (let i=0;i<150 && !window.BAKEOFF_READY;i++) await new Promise(r=>setTimeout(r,100)); if (!window.BAKEOFF_READY) throw new Error('dashboard never became ready'); return true; })()`);

  const gpu = await tab.evalWhenReady(`(async () => window.BAKEOFF.hasWebGPU())()`);
  if (!gpu) {
    await tab.callFn(`() => window.DASH.setBanner('No WebGPU adapter — cannot run the bake-off', 'stuck')`, []);
    throw new Error('no WebGPU adapter');
  }

  // Each thinker runs both modes; non-thinkers run ON only.
  // Jobs: [{ base, mode }] where mode is 'on' | 'off'.
  const jobs = [];
  for (const base of bases) {
    if (base.think) {
      jobs.push({ base, mode: 'on' });
      jobs.push({ base, mode: 'off' });
    } else {
      jobs.push({ base, mode: 'on' });
    }
  }
  // One card per (base, mode) up front.
  for (const { base, mode } of jobs) {
    const cardId = `${base.modelId}:${mode}`;
    await tab.callFn(
      `(id, label, sizeGB) => window.DASH.makeCard(id, label, sizeGB)`,
      [cardId, `${base.label} (${mode === 'on' ? 'think' : 'no-think'})`, base.sizeGB],
    );
  }

  const results = [];
  try {
    for (let j = 0; j < jobs.length; j++) {
      const { base, mode } = jobs[j];
      const jobId = `${base.modelId}:${mode}`;
      await tab.callFn(`(id) => window.DASH.update(id, { active: true, phase: 'loading…', phaseClass: 'active', pct: 0 })`, [jobId]);
      await tab.callFn(`(t) => window.DASH.setBanner(t, 'run')`, [`[${j + 1}/${jobs.length}] ${base.label} ${mode === 'on' ? '(think)' : '(no-think)'} — downloading / warming`]);

      // Load (already cached after the first mode of this base).
      await tab.callFn(`(modelId, cardId) => window.BAKEOFF.load(modelId, cardId)`, [base.modelId, jobId], { timeoutMs: 900000 });
      await tab.callFn(`(id) => window.DASH.update(id, { phase: 'running', pct: 0 })`, [jobId]);

      const replies = [];
      const partialFile = join(outDir, `${jobId}.replies.json`);
      let skipped = false;
      let lastAdvance = Date.now();
      let stalled = false;
      const watchdog = setInterval(async () => {
        if (Date.now() - lastAdvance > STALL_MS && !stalled) {
          stalled = true;
          try {
            await tab.callFn(`(id) => window.DASH.update(id, { phaseClass: 'failed' })`, [jobId]);
            await tab.callFn(`(t) => window.DASH.setBanner(t, 'stuck')`, [`STUCK: ${base.label} (${mode}) — no reply for ${Math.round(STALL_MS / 1000)}s`]);
          } catch {}
        }
      }, 5000);

      const diag = { thought: 0, lengthCut: 0, noCall: 0 };
      for (let i = 0; i < evalRecords.length; i++) {
        const q = evalRecords[i].question;
        const r = await tab.callFn(
          `(systemPrompt, question, noThink) => window.BAKEOFF.reply(systemPrompt, question, noThink)`,
          [systemPrompt, q, mode === 'off'],
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
        const done = i + 1;
        const pct = done / evalRecords.length;

        // User-driven skip: if the user pressed the card's "skip" button, stop.
        if (!skipped) {
          const userFlag = await tab.evalWhenReady(`() => window.SKIP_FLAG ?? null`);
          if (userFlag === jobId) {
            console.error(`  [user-skip] ${base.label} (${mode})`);
            await tab.callFn(`(id, patch) => window.DASH.update(id, patch)`, [jobId, {
              active: false, cardClass: 'failed',
              phase: 'skipped (user)', phaseClass: 'failed',
              pct: done / evalRecords.length,
              score: 'skipped by user', scoreClass: 'fail',
            }]);
            skipped = true;
            break;
          }
        }

        // Live partial scoring after SKIP_AFTER: if no valid call yet, skip.
        if (!skipped && done === SKIP_AFTER) {
          writeFileSync(partialFile, JSON.stringify(replies, null, 2));
          const early = await scoreReplies(jobId, partialFile, LIMIT);
          const passRate = early?.pct ?? 0;
          if (passRate === 0) {
            console.error(`  [skip] ${base.label} (${mode}): 0/${SKIP_AFTER} valid → skip`);
            await tab.callFn(`(id, patch) => window.DASH.update(id, patch)`, [jobId, {
              active: false, cardClass: 'failed',
              phase: 'skipped', phaseClass: 'failed',
              pct: done / evalRecords.length,
              score: `skipped (0/${SKIP_AFTER} valid)`,
              scoreClass: 'fail',
            }]);
            skipped = true;
            break;
          }
          await tab.callFn(`(id, patch) => window.DASH.update(id, patch)`, [jobId, {
            phase: `running ${done}/${evalRecords.length}`, pct,
            last: `partial ${(passRate * 100).toFixed(0)}% at ${done}`,
          }]);
        }

        if (!skipped) {
          await tab.callFn(`(id, patch) => window.DASH.update(id, patch)`, [jobId, {
            phase: `running ${done}/${evalRecords.length}`, pct,
            last: '→ ' + oneLine(text).slice(0, 70),
          }]);
          await tab.callFn(`(t) => window.DASH.setBanner(t, 'run')`,
            [`[${j + 1}/${jobs.length}] ${base.label} (${mode}) — ${done}/${evalRecords.length}`]);
        }
      }
      clearInterval(watchdog);

      if (skipped) {
        results.push({ base, mode, pct: null, tiers: `skipped after ${SKIP_AFTER} questions (0 valid)` });
        continue;
      }
      console.error(`  [diag] ${base.label} (${mode}): thought ${diag.thought}/${evalRecords.length} · length-cut ${diag.lengthCut} · no-call ${diag.noCall}`);

      // Final score + push verdict onto the card.
      writeFileSync(partialFile, JSON.stringify(replies, null, 2));
      const scored = await scoreReplies(jobId, partialFile, LIMIT);
      const pass = scored && scored.pct >= 0.95;
      const diagNote = `think ${diag.thought}/${evalRecords.length} · len-cut ${diag.lengthCut}`;
      const tiersLine = (scored?.tiers ?? '') + (scored ? ' — ' : '') + diagNote;
      await tab.callFn(`(id, patch) => window.DASH.update(id, patch)`, [jobId, {
        active: false,
        cardClass: pass ? 'done' : 'failed',
        phase: pass ? 'done' : 'done (below bar)', phaseClass: pass ? 'done' : 'failed',
        pct: 1,
        score: scored ? `protocol-validity ${(scored.pct * 100).toFixed(1)}%` : 'score unavailable',
        scoreClass: pass ? 'pass' : 'fail',
        tiers: tiersLine,
      }]);
      results.push({ base, mode, pct: scored?.pct ?? null, tiers: tiersLine });
    }

    // Compact result table; results.md gains a mode column.
    const cleared = results.filter((r) => r.pct != null && r.pct >= 0.95);
    const summary = cleared.length
      ? `Done — smallest clearing 95%: ${cleared[0].base.label} (${(cleared[0].pct * 100).toFixed(1)}%)`
      : 'Done — no base cleared the 95% bar';
    await tab.callFn(`(t) => window.DASH.setBanner(t, '')`, [summary]);
    console.error('\n' + summary);
    for (const r of results) console.error(`  ${(r.base.label + ' ' + (r.mode === 'on' ? '(think)' : '(no-think)')).padEnd(28)} ${r.pct == null ? 'skip' : (r.pct * 100).toFixed(1) + '%'}`);

    const stamp = new Date().toISOString();
    const board = {
      generatedAt: stamp,
      think: 'per-mode — ON=natural, OFF=forced /no_think',
      evalRecords: evalRecords.length,
      bar: 0.95,
      bases: results.map((r) => ({ modelId: r.base.modelId, mode: r.mode, label: r.base.label, sizeGB: r.base.sizeGB, protocolValidity: r.pct })),
    };
    writeFileSync(join(outDir, 'results.json'), JSON.stringify(board, null, 2));
    const md = [
      `# Bake-off results — ${stamp}`,
      ``,
      `think ON=natural, OFF=\`/no_think\` · temperature 0 · max_tokens 2048 · ${evalRecords.length} eval records · bar 95%`,
      ``,
      `| base | mode | size | protocol-validity | clears bar | tiers |`,
      `|---|---|---|---|---|---|`,
      ...results.map((r) =>
        `| ${r.base.label} | ${r.mode === 'on' ? 'think' : 'no-think'} | ~${r.base.sizeGB}GB | ${r.pct == null ? 'skip' : (r.pct * 100).toFixed(1) + '%'} | ${r.pct != null && r.pct >= 0.95 ? '✅' : r.pct == null ? '⏭' : '—'} | ${r.tiers} |`),
      ``,
      `**${summary}**`,
    ].join('\n');
    writeFileSync(join(outDir, 'results.md'), md);
    console.error(`\nwrote ${join(outDir, 'results.md')}`);
  } catch (e) {
    try { await tab.callFn(`(t) => window.DASH.setBanner(t, 'stuck')`, [`STOPPED: ${e.message}`]); } catch {}
    throw e;
  } finally {
    try { server.close(); } catch {}
    // Keep Chrome open for reading the final board.
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
