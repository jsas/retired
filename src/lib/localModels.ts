// Dev-server serving for LOCAL fine-tune weights (public/models/).
//
// A model folder dropped into public/models/<name>/ (or symlinked there) is
// static-served by vite at <base>models/<name>/. web-llm, though, appends
// HuggingFace's "resolve/main/" to EVERY model URL before it fetches anything
// (cleanModelUrl assumes every host is an HF repo layout) — so the engine asks
// for <base>models/<name>/resolve/main/mlc-chat-config.json, which doesn't
// exist and falls through to the SPA's index.html. The engine then dies
// parsing HTML as JSON: `Unexpected token '<', "<!doctype "…`. This plugin
// rewrites that suffix back so a plain folder just works.
//
// Dev-only (apply: 'serve'): the deployed site ships no local weights.

import type { Plugin } from 'vite';

/** Strip web-llm's HuggingFace "resolve/main/" suffix from a local-model URL,
 *  preserving any base path. Returns null for anything that isn't a
 *  /models/<folder>/resolve/main/ path (or that tries to traverse out).
 *  Exported for tests. */
export function rewriteResolveMain(url: string): string | null {
  const m = url.match(/^(.*?\/models\/[^/]+)\/resolve\/main\/(.*)$/);
  if (!m) return null;
  const hops = (s: string) => s.split('/').includes('..');
  if (hops(m[1]) || hops(m[2])) return null;
  return `${m[1]}/${m[2]}`;
}

/** Vite plugin: serve local model folders at the path web-llm actually asks
 *  for. Spread into the app's plugins; inert in builds. */
export function serveLocalModels(): Plugin {
  return {
    name: 'dev-serve-local-models',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const rewritten = rewriteResolveMain(req.url ?? '');
        if (rewritten !== null) req.url = rewritten;
        next();
      });
    },
  };
}
