// Smoke test: launch Chrome, serve the harness, confirm the BAKEOFF channel
// and a WebGPU adapter come up — WITHOUT downloading a model. Exercises every
// piece of the plumbing except the (slow, large) model load. Run:
//   node training/driver/smoke.mjs
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChrome, openTab, TabSession } from './cdp.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const MIME = { '.html': 'text/html', '.mjs': 'text/javascript' };

const server = createServer((req, res) => {
  const path = req.url === '/' ? '/harness.html' : req.url.split('?')[0];
  const file = join(here, path);
  if (!existsSync(file)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'text/plain' });
  res.end(readFileSync(file));
});

await new Promise((r) => server.listen(8791, r));
const chrome = await launchChrome({ port: 9223, gpu: true });

try {
  const target = await openTab('http://127.0.0.1:8791/harness.html', 9223);
  const tab = new TabSession(target.webSocketDebuggerUrl);
  await tab.connect();
  await tab.evalWhenReady(`(async () => { for (let i=0;i<150 && !window.BAKEOFF_READY;i++) await new Promise(r=>setTimeout(r,100)); if (!window.BAKEOFF_READY) throw new Error('harness never ready'); return true; })()`, { timeoutMs: 30000 });
  console.log('BAKEOFF channel: READY');
  const gpu = await tab.evalWhenReady(`(async () => window.BAKEOFF.hasWebGPU())()`);
  console.log('WebGPU adapter:', gpu ? 'YES' : 'NO');
  const version = await tab.evalWhenReady(`(async () => window.BAKEOFF.version)()`);
  console.log('web-llm version:', version);
  await tab.close();
  console.log(gpu ? '\nSMOKE PASS — driver plumbing + WebGPU work. Ready for a real bake-off run.' : '\nSMOKE PARTIAL — plumbing works but no WebGPU adapter in this Chrome.');
} finally {
  try { server.close(); } catch {}
  try { chrome.kill?.(); } catch {}
}
