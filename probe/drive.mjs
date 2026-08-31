// Elective probe — headless driver. NOT part of the app or the deploy.
//
// Drives probe/main.ts's unattended triage mode (?auto=1) in a headless
// Chrome via the DevTools protocol (plain WebSockets — Node 22+ built-in,
// no new deps), and streams every PROBE_EVENT to stdout +
// probe/results/triage-<stamp>.jsonl.
//
// Usage:
//   npm run probe                      # serve the probe page (port 5174)
//   node probe/drive.mjs               # sweep ALL curated models, shipped profiles
//   node probe/drive.mjs --models=Phi-4-mini-instruct-q4f16_1-MLC|gemma-2-2b-it-q4f16_1-MLC
//   node probe/drive.mjs --profile=hot --maxtokens=512
//   node probe/drive.mjs --cdp=http://127.0.0.1:9223 --url=http://localhost:5174/probe/
//
// Chrome must run with --remote-debugging-port + --enable-unsafe-webgpu and
// a --user-data-dir OUTSIDE the repo (vite's watcher crashes on the locked
// profile files otherwise):
//   chrome.exe --headless=new --remote-debugging-port=9223 \
//     --enable-unsafe-webgpu --user-data-dir=%LOCALAPPDATA%/reprobe-chrome \
//     --no-first-run about:blank
//
// First run per model downloads its weights (multi-GB) into the Chrome
// profile's cache — slow but one-time; re-runs against the same profile load
// from cache in seconds.

import { mkdirSync, appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).map(a => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? '1'] : [a.replace(/^--/, ''), '1'];
  }),
);

const CDP = args.cdp || process.env.PROBE_CDP || 'http://127.0.0.1:9223';
const BASE = args.url || process.env.PROBE_URL || 'http://localhost:5174/probe/';

// URL params consumed by probe/main.ts's parseAutoParam().
const auto = ['1'];
if (args.models) auto.push(`models=${args.models}`);
if (args.maxtokens) auto.push(`maxtokens=${args.maxtokens}`);
const url = `${BASE}?auto=${auto.join(',')}${args.profile ? `&profile=${args.profile}` : ''}`;

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = join(dirname(fileURLToPath(import.meta.url)), 'results');
mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, `triage-${stamp}.jsonl`);
console.log(`# probe driver → ${outPath}`);
console.log(`# url: ${url}`);

// --- CDP plumbing ------------------------------------------------------------

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    ws.onopen = () => resolve(ws);
    ws.onerror = () => reject(new Error('websocket connect failed — is Chrome running with --remote-debugging-port?'));
  });
}

let msgId = 0;
const pending = new Map();
function send(ws, method, params) {
  const id = ++msgId;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

async function findPageTarget() {
  const list = await (await fetch(`${CDP}/json/list`)).json();
  let page = list.find(t => t.type === 'page');
  if (!page) page = await (await fetch(`${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
  return page;
}

// --- run ---------------------------------------------------------------------

const target = await findPageTarget();
const ws = await connect(target.webSocketDebuggerUrl);

let finished = false;
let sawDone = false;
ws.onclose = () => {
  if (finished || sawDone) return;
  // The debug socket vanished before the sweep reported 'done' — the window
  // was closed or Chrome died. Exit NONZERO so run-triage.sh relaunches.
  console.log('… lost the Chrome window before the sweep finished (closed or crashed?). ' +
    'The triage script will reopen it; downloaded weights are cached so relaunch is cheap.');
  process.exitCode = 3;
};
ws.onmessage = ev => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const { resolve, reject } = pending.get(m.id);
    pending.delete(m.id);
    if (m.error) reject(new Error(`${m.method ?? ''} ${m.error.message}`));
    else resolve(m.result);
    return;
  }
  if (m.method === 'Runtime.consoleAPICalled') {
    const first = m.args?.[0];
    const txt = first?.type === 'string' ? first.value : '';
    if (typeof txt === 'string' && txt.startsWith('PROBE_EVENT ')) {
      try {
        const evt = JSON.parse(txt.slice('PROBE_EVENT '.length));
        appendFileSync(outPath, JSON.stringify(evt) + '\n');
        printEvent(evt);
        if (evt.type === 'start') sawStart = true;
        if (evt.type === 'done') sawDone = true;
        if (evt.type === 'done' || evt.type === 'fatal') finish(evt.type === 'fatal' ? 1 : 0);
      } catch { /* malformed line — already on disk */ }
    }
  } else if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params?.exceptionDetails;
    console.log(`  (page exception) ${d?.exception?.description ?? d?.text ?? '?'}`.slice(0, 300));
  }
};

// Enable domains BEFORE navigating so no early PROBE_EVENT is missed.
await send(ws, 'Runtime.enable');
await send(ws, 'Page.enable');
await send(ws, 'Page.navigate', { url });

function finish(code) {
  if (finished) return;
  finished = true;
  clearInterval(keepAlive);
  console.log(`# events saved to ${outPath}`);
  try { ws.close(); } catch { /* ignore */ }
  process.exitCode = code;
}

// Keep the loop alive while we wait (a settled WebSocket + unref'd timers can
// leave Node with nothing to do — it must run until 'done' or a real error).
const keepAlive = setInterval(() => {}, 30_000);

// Startup watchdog: a cold vite cache can take minutes to pre-bundle web-llm
// before the page emits its first event, so don't fail on a fixed timer —
// PROBE the page itself. Only give up when the page is genuinely dead (not on
// the probe URL, or the debug socket rejects). Live-but-slow keeps waiting.
let sawStart = false;
const startPoll = setInterval(async () => {
  if (finished) { clearInterval(startPoll); return; }
  if (sawStart) { clearInterval(startPoll); return; }
  try {
    const r = await send(ws, 'Runtime.evaluate', {
      expression: '({u: location.href, b: (document.getElementById("barText")||{}).textContent || "", l: (document.getElementById("logBox")||{}).textContent?.length || 0})',
      returnByValue: true,
    });
    const v = r?.result?.value;
    if (v && /\/probe\//.test(v.u)) {
      if (v.b || v.l) { console.log('# page is alive and working (slow first load — cold vite cache?). Waiting for events…'); }
      return; // on the probe page: alive, just not streaming events yet
    }
    console.log(`!! probe page never started (window is at ${v?.u ?? 'unknown URL'}). ` +
      'Check the Chrome window and /tmp/probe-vite.log.');
    finish(4);
  } catch {
    console.log('!! probe page is gone (window closed?).');
    finish(4);
  }
}, 20_000);
startPoll.unref?.();

// Safety net: a cold sweep (7 models ≈ 22 GB of downloads) can take hours.
// Cap the DRIVER, not the page — Ctrl-C or timeout ends collection; the sweep
// in Chrome keeps going and re-running this driver re-attaches to fresh events
// only after a navigate, so for long hauls pass --timeoutMs.
const capMs = Number(args.timeoutMs || 0) || 12 * 60 * 60 * 1000;
setTimeout(() => { console.log('… driver timeout (sweep may still be running in the browser)'); finish(2); }, capMs).unref?.();

function printEvent(e) {
  switch (e.type) {
    case 'start': console.log(`▶ sweep start: ${e.models.length} model(s), maxTokens ${e.maxTokens}, profile ${e.override}`); break;
    case 'load-start': console.log(`⬇ ${e.modelId} ${e.cached ? '(cached)' : '(DOWNLOAD — may take a long while)'}`); break;
    case 'load-progress': if ((e.progress ?? 0) < 0.99) console.log(`   … ${Math.round((e.progress ?? 0) * 100)}% ${e.text}`); break;
    case 'load-done': console.log(`✓ ${e.modelId} loaded (window ${e.window.toLocaleString()}, tools ${e.toolMode}, ${e.persona} persona)`); break;
    case 'cell-start': break;
    case 'cell':
      console.log(`  · ${e.promptId.padEnd(17)} score ${e.score.toFixed(2)}  ttr ${e.ttr.toFixed(2)}  onset ${(e.onset * 100).toFixed(0)}%  ` +
        `${e.breakerEcho || e.breakerBlock ? '⚑breaker ' : '          '} ${e.tokens}tok ${e.seconds.toFixed(0)}s  ` +
        (e.toolCalls.length ? `calls[${e.toolCalls.join(',')}] ` : 'no-calls ') +
        (e.toolErrors ? `err${e.toolErrors} ` : '') +
        `| ${JSON.stringify(e.rawHead).slice(0, 50)}`);
      break;
    case 'cell-fail': console.log(`  ✗ ${e.promptId} FAILED: ${e.error}`); break;
    case 'model-fail': console.log(`✗ MODEL ${e.modelId} FAILED: ${e.error}`); break;
    case 'model-done': console.log(`■ ${e.modelId} done`); break;
    case 'done': console.log(`★ sweep complete in ${e.totalSeconds}s`); break;
    case 'fatal': console.log(`✗ FATAL: ${e.error}`); break;
  }
}

process.on('SIGINT', () => { console.log('\n… interrupted (page keeps running; re-run driver to re-attach)'); finish(130); });
