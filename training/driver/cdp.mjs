// Minimal Chrome DevTools Protocol client over a raw WebSocket — no puppeteer.
// The bake-off driver only needs three verbs: open a tab on a URL, evaluate an
// async expression in it (awaitPromise), and close it. Keeping the dependency
// surface at zero means the driver runs anywhere `node` + a Chrome binary do.
//
// Chrome is launched separately with --remote-debugging-port; this module just
// talks to the already-running instance over its HTTP + WS endpoints.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import http from 'node:http';

/** Locate a Chrome/Edge binary on Windows (or honor CHROME_PATH). */
export function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const candidates = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe`,
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  ];
  for (const c of candidates) {
    if (c && existsSync(c)) return c;
  }
  throw new Error('No Chrome/Edge binary found. Set CHROME_PATH to one.');
}

function httpJson(path, port, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path, method },
      (res) => {
        let body = '';
        res.on('data', (d) => (body += d));
        res.on('end', () => {
          try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

/** Launch headless Chrome with remote debugging + WebGPU enabled, and wait for
 *  the devtools endpoint to answer. Returns the child process. */
export async function launchChrome({ port = 9222, gpu = true } = {}) {
  const bin = findChrome();
  const args = [
    `--remote-debugging-port=${port}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--user-data-dir=' + `${process.env.TEMP}/retired-bakeoff-profile`,
    // WebGPU on headless: don't force-disable GPU; enable the unsafe fallback so
    // SwiftShader/ANGLE still exposes an adapter where hardware is present.
    ...(gpu ? ['--enable-unsafe-webgpu', '--enable-features=Vulkan'] : []),
    'about:blank',
  ];
  const child = spawn(bin, args, { stdio: 'ignore', detached: true });
  child.unref();
  // Poll the HTTP endpoint until devtools is up (model downloads can be slow).
  const deadline = Date.now() + 30000;
  for (;;) {
    try {
      await httpJson('/json/version', port);
      return child;
    } catch {
      if (Date.now() > deadline) throw new Error('Chrome devtools endpoint never came up');
      await new Promise((r) => setTimeout(r, 500));
    }
  }
}

/** Open a fresh tab navigated to `url`; returns the CDP target. Newer Chrome
 *  requires PUT (not GET) for /json/new. */
export async function openTab(url, port = 9222) {
  return httpJson(`/json/new?${encodeURIComponent(url)}`, port, 'PUT');
}

/** A thin async-eval channel to one tab, over its webSocketDebuggerUrl. Each
 *  call is a Runtime.evaluate with awaitPromise, so the page can run async
 *  model work and hand back a JSON value. */
export class TabSession {
  constructor(webSocketDebuggerUrl) {
    this.wsUrl = webSocketDebuggerUrl;
    this.ws = null;
    this.seq = 0;
    this.pending = new Map();
  }

  async connect() {
    // Node 22+ has a global WebSocket (undici).
    this.ws = new WebSocket(this.wsUrl);
    await new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = (e) => reject(new Error('WS connect failed: ' + (e.message ?? 'error')));
    });
    this.ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id != null && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message ?? JSON.stringify(msg.error)));
        else resolve(msg.result);
      }
    };
  }

  _send(method, params) {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  /** Evaluate an async expression; `expression` must resolve to a
   *  JSON-serializable value. Returns that value. */
  async eval(expression, { timeoutMs = 600000 } = {}) {
    const result = await this._send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      timeout: timeoutMs,
    });
    if (result.exceptionDetails) {
      const d = result.exceptionDetails;
      throw new Error('page exception: ' + (d.exception?.description ?? d.text ?? 'unknown'));
    }
    return result.result?.value;
  }

  /** Call a page function with arguments bound as VALUES, not interpolated into
   *  the evaluated source (Runtime.callFunctionOn + arguments). Prefer this over
   *  `eval(\`...fn(${JSON.stringify(x)})...\`)` when passing untrusted/large data:
   *  the value crosses as a parameter, so it can never be re-parsed as code and
   *  there's nothing to mis-escape (CodeQL: improper code sanitization).
   *  `fnDecl` is a function *declaration* source, e.g. `(a, b) => a + b`; args are
   *  JSON-serializable. Returns the awaited, by-value result. */
  async callFn(fnDecl, args = [], { timeoutMs = 600000 } = {}) {
    const result = await this._send('Runtime.callFunctionOn', {
      functionDeclaration: fnDecl,
      arguments: args.map((v) => ({ value: v })),
      awaitPromise: true,
      returnByValue: true,
      timeout: timeoutMs,
    });
    if (result.exceptionDetails) {
      const d = result.exceptionDetails;
      throw new Error('page exception: ' + (d.exception?.description ?? d.text ?? 'unknown'));
    }
    return result.result?.value;
  }

  /** Like eval, but tolerant of the navigation race: a freshly-opened tab can
   *  have its execution context destroyed as it commits the URL. Retry those
   *  transient failures until the page is stable (a real page error still
   *  throws). */
  async evalWhenReady(expression, { timeoutMs = 600000, retries = 40, retryDelayMs = 250 } = {}) {
    let lastErr;
    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        return await this.eval(expression, { timeoutMs });
      } catch (e) {
        lastErr = e;
        const transient = /Execution context was destroyed|Cannot find context|Inspected target navigated|Session closed|Target closed/i.test(e.message);
        if (!transient) throw e;      // genuine page error — surface it
        await new Promise((r) => setTimeout(r, retryDelayMs));
      }
    }
    throw lastErr;
  }

  async close() {
    try { this.ws?.close(); } catch { /* already gone */ }
  }
}
