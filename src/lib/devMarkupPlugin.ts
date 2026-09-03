/**
 * devMarkupOverlay(): the app's dev-time markup loop, gated on env.
 *
 * Composes the markup-assistant vite bridge (intent/apply/events/record/revert
 * endpoints) with the bootstrap-injection plugin and a console plugin that
 * serves /__markup_console__ (per-interaction history + undo) reading from
 * the SSE. Everything is driven by MARKUP_* env vars (see
 * engine/envConfig.ts); with no MARKUP_MODEL_ENDPOINT set, the function
 * returns [] and the dev server is untouched.
 *
 * Security: the model API key is read here, in node, and never serialized to
 * the client. The injected bootstrap receives only the non-secret toggles
 * (hotkey, vision, dom-snapshot). The /intent /apply /events /record /revert
 * endpoints are unauthenticated same-origin dev routes — fine on localhost,
 * never expose the dev server beyond it.
 */
import type { Plugin, ResolvedConfig } from 'vite'
// The node-dist of markup-assistant (built by `npm run build` in the package
// — wired into `predev`/`dev` so it can never go stale). The vite config runs
// in node, which can't resolve the package's .js→.ts source imports, so the
// /node subpath points at dist/ rather than the source the client bundle
// consumes.
import { markupAssistant } from '@retired/markup-assistant/node'
import {
  createStubEngine,
  markupEnvEnabled,
  openaiEngineFromEnv,
  readMarkupEnv,
  OpenAIEngine,
} from '@retired/markup-assistant/node/engine'
import type { Sink } from '@retired/markup-assistant/node/engine'
import type { Edit } from '@retired/markup-assistant/node/engine'

export interface DevMarkupOverlayOptions {
  /** Env to read; defaults to process.env. Injectable for tests. */
  env?: Record<string, string | undefined>
  /** Origin the source sink posts edits back to. Defaults to same-origin (''). */
  origin?: string
}

/**
 * Returns [bridge, console, bootstrap] when the loop is enabled
 * (MARKUP_MODEL_ENDPOINT set), otherwise []. Spread into the app's plugins
 * array.
 */
export function devMarkupOverlay(options: DevMarkupOverlayOptions = {}): Plugin[] {
  const env = options.env ?? process.env
  if (!markupEnvEnabled(env)) return []

  const cfg = readMarkupEnv(env)
  const engine = openaiEngineFromEnv(env) ?? createStubEngine()
  const autoApply = cfg.autoApply

  // The sink runs in NODE, where fetch() rejects relative URLs outright. The
  // origin must be absolute; we learn the real port when vite's config
  // resolves (below) and read it lazily at apply time.
  let resolvedOrigin = options.origin ?? ''
  const sinkOrigin = () =>
    resolvedOrigin || `http://127.0.0.1:${lastKnownPort ?? 5173}`
  let lastKnownPort: number | undefined

  // Source sink: forwards edits to the bridge's own /apply endpoint so they
  // land on disk. Held (reported failed) when MARKUP_AUTO_APPLY=0.
  const sourceSink: Sink = {
    name: 'source',
    supports: (edit: Edit) => edit.kind === 'text' || edit.kind === 'write',
    async apply(edit: Edit) {
      if (!autoApply) return { state: 'failed' as const, reason: 'auto-apply disabled' }
      if (edit.kind !== 'text' && edit.kind !== 'write') {
        return { state: 'failed' as const, reason: 'unsupported edit kind' }
      }
      try {
        const res = await fetch(`${sinkOrigin()}/__markup_assistant__/apply`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ edit }),
        })
        if (res.ok) return 'applied'
        // The /apply endpoint ends with a plain-text reason (not-found,
        // ambiguous, file unreadable, ...) — carry it to the chat bubble.
        const reason = (await res.text().catch(() => '')).trim() || `HTTP ${res.status}`
        return { state: 'failed' as const, reason }
      } catch (err) {
        return { state: 'failed' as const, reason: String(err) }
      }
    },
  }

  // When the engine asks for a specific source file ("please share the file
  // containing X"), it may come through the engine's fetchSource hook —
  // point it at the bridge's /source route so the model really gets it.
  if (engine instanceof OpenAIEngine) {
    engine.fetchSource = async (file: string) => {
      try {
        const url = `${sinkOrigin()}/__markup_assistant__/source?file=${encodeURIComponent(file)}`
        const res = await fetch(url)
        return res.ok ? res.text() : undefined
      } catch {
        return undefined
      }
    }
  }

  const bridge = markupAssistant({
    engine,
    endpointPrefix: '/__markup_assistant__',
    sinks: [sourceSink],
  })

  // Console: serves a self-contained page at /__markup_console__ that polls
  // /record for the history ledger and offers per-file revert buttons that
  // post to /revert. Lives in the app so we can keep the plugin console-free.
  const consolePlugin: Plugin = {
    name: 'dev-markup-console',
    configureServer(server) {
      // The sink posts edits back over HTTP; capture the port vite actually
      // bound (strictPort keeps config.port, but 'listening' is authoritative
      // and covers the auto-increment case too).
      const port = server.config.server?.port
      if (typeof port === 'number' && port > 0) lastKnownPort = port
      server.httpServer?.once('listening', () => {
        const addr = server.httpServer?.address()
        if (addr && typeof addr === 'object' && typeof addr.port === 'number') {
          lastKnownPort = addr.port
        }
      })
      server.middlewares.use((req, res, next) => {
        if (req.url !== '/__markup_console__') return next()
        if (req.method !== 'GET') return next()
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        res.end(consoleHtml())
      })
    },
  }

  // Inject the bootstrap script (a real app module, so the alias resolves it
  // to source and vite import-analysis rewrites it). The non-secret overlay
  // config is serialized into a window binding so the page stays in step
  // without re-publishing a static script.
  //
  // The injected `src` must include the configured base (e.g. '/retired/').
  // Vite won't rewrite attrs we add through transformIndexHtml, so we read the
  // base once config resolves and prefix it ourselves.
  let base = '/'
  const bootstrap: Plugin = {
    name: 'dev-markup-overlay-bootstrap',
    configResolved(config: ResolvedConfig) {
      base = config.base ?? '/'
    },
    transformIndexHtml() {
      return [
        {
          tag: 'script',
          children: `window.__MARKUP_ASSISTANT_CONFIG__=${JSON.stringify({
            hotkey: cfg.hotkey,
            captureImage: cfg.vision,
            captureDom: cfg.domSnapshot,
          })};`,
          injectTo: 'head-prepend',
        },
        {
          tag: 'script',
          attrs: { src: `${base.replace(/\/+$/, '')}/src/lib/markupBootstrap.ts`, type: 'module' },
          injectTo: 'head',
        },
      ]
    },
  }

  return [bridge, consolePlugin, bootstrap]
}

/**
 * Self-contained console page. Polls /record every 750 ms; per-file "revert"
 * button for entries whose edits are source edits. No build step: plain HTML
 * + inline module, served from the dev middleware pipeline.
 */
function consoleHtml(): string {
  return `<!doctype html>
<html><head><title>markup console</title><style>
body{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;background:#111;color:#eee;margin:0;padding:12px}
h1{font-size:13px;margin:0 0 8px}
.entry{border:1px solid #333;border-radius:4px;margin:6px 0;padding:6px}
.row{display:flex;gap:8px;flex-wrap:wrap}
.tag{background:#222;padding:1px 5px;border-radius:3px}
.ok{color:#8f8}.fail{color:#f88}.pend{color:#cc8}
.edit{margin:2px 0;padding:3px;background:#1a1a1a;border-radius:2px}
button{background:#333;border:1px solid #555;color:#eee;padding:2px 6px;border-radius:3px;cursor:pointer}
button:hover{background:#444}
</style></head><body>
<h1>markup console</h1>
<div id="list"></div>
<script type="module">
const P='/__markup_assistant__';
async function refresh(){
  const r=await fetch(P+'/record');
  const j=await r.json();
  render(j.history);
}
function render(h){
  const el=document.getElementById('list');
  el.innerHTML='';
  for(const e of h){
    const d=document.createElement('div');d.className='entry';
    d.innerHTML='<div class="row"><span class="tag">'+e.interactionId+'</span>'
      +'<span class="tag '+(e.terminal==='applied'||e.terminal==='answered'?'ok':e.terminal?'fail':'pend')+'">'+(e.terminal??e.lastStatus??'received')+'</span>'
      +(e.gesture?'<span class="tag">'+e.gesture.kind+'</span>':'')+'</div>'
      +(e.detail?'<div>'+e.detail+'</div>':'');
    if(e.gesture&&e.gesture.summary){const s=document.createElement('div');s.textContent='gesture: '+e.gesture.summary;d.appendChild(s)}
    for(const c of (e.context||[])){const s=document.createElement('div');s.textContent='ctx['+c.kind+']: '+c.summary;d.appendChild(s)}
    if(e.gesture&&e.gesture.text){const s=document.createElement('div');s.textContent='text: "'+e.gesture.text+'"';d.appendChild(s)}
    if(e.image){
      const img=document.createElement('img');
      img.src=e.image;
      img.style.cssText='max-width:220px;max-height:120px;border:1px solid #333;margin:4px 0;display:block;'
      d.appendChild(img)
    }
    for(const ed of e.edits||[]){
      const row=document.createElement('div');row.className='edit';
      row.textContent=ed.kind+' '+ (ed.file||'');
      if(ed.kind==='text'||ed.kind==='write'){
        const b=document.createElement('button');b.textContent='revert';
        b.onclick=async()=>{await fetch(P+'/revert',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({edit:ed})});refresh()};
        row.appendChild(b)
      }
      d.appendChild(row)
    }
    el.appendChild(d)
  }
}
refresh(); setInterval(refresh,750);
</script></body></html>`
}
