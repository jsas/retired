/**
 * devMarkupOverlay(): the app's dev-time markup loop, gated on env.
 *
 * Composes the markup-assistant vite bridge (intent/apply/events endpoints) with
 * a source sink that posts edits back to /apply, so the model's edits land on
 * disk and HMR reloads the page — the "mark -> snap -> send -> reload -> markup
 * clears" loop. Everything is driven by MARKUP_* env vars (see
 * engine/envConfig.ts); with no MARKUP_MODEL_ENDPOINT set, the function returns
 * null and the dev server is untouched (fully offline).
 *
 * Security: the model API key is read here, in node, and never serialized to
 * the client. The injected bootstrap receives only the non-secret toggles
 * (hotkey, vision, dom-snapshot). The /intent /apply /events endpoints are
 * unauthenticated same-origin dev routes — fine on localhost, never expose the
 * dev server beyond it.
 */
import type { Plugin } from 'vite'
// The node-dist of markup-assistant (built by packages/markup-assistant/npm run
// build). The vite config runs in node, so it must import real .js — the
// package's /node subpath points at dist/ rather than the source the client
// bundle consumes.
import { markupAssistant } from '@retired/markup-assistant/node'
import {
  createStubEngine,
  markupEnvEnabled,
  openaiEngineFromEnv,
  readMarkupEnv,
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
 * Returns the bridge plugin + the bootstrap-injection plugin when the loop is
 * enabled (MARKUP_MODEL_ENDPOINT set), otherwise []. Spread into the app's
 * plugins array.
 */
export function devMarkupOverlay(options: DevMarkupOverlayOptions = {}): Plugin[] {
  const env = options.env ?? process.env
  if (!markupEnvEnabled(env)) return []

  const cfg = readMarkupEnv(env)
  const engine = openaiEngineFromEnv(env) ?? createStubEngine()
  const origin = options.origin ?? ''
  const autoApply = cfg.autoApply

  // Source sink: forwards edits to the bridge's own /apply endpoint so they
  // land on disk. Held (reported failed) when MARKUP_AUTO_APPLY=0.
  const sourceSink: Sink = {
    name: 'source',
    supports: (edit: Edit) => edit.kind === 'text' || edit.kind === 'write',
    async apply(edit: Edit) {
      if (!autoApply) return 'failed'
      if (edit.kind !== 'text' && edit.kind !== 'write') return 'failed'
      try {
        const res = await fetch(`${origin}/__markup_assistant__/apply`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ edit }),
        })
        return res.ok ? 'applied' : 'failed'
      } catch {
        return 'failed'
      }
    },
  }

  const bridge = markupAssistant({
    engine,
    endpointPrefix: '/__markup_assistant__',
    sinks: [sourceSink],
  })

  // Inject the bootstrap script (a real app module, so the alias resolves it
  // to source and vite import-analysis rewrites it). The non-secret overlay
  // config is serialized into a window binding so the page stays in step
  // without re-publishing a static script.
  const bootstrap: Plugin = {
    name: 'dev-markup-overlay-bootstrap',
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
          attrs: { src: '/src/lib/markupBootstrap.ts', type: 'module' },
          injectTo: 'head',
        },
      ]
    },
  }

  return [bridge, bootstrap]
}
