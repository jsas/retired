import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'
import { rmSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'
import { devMarkupOverlay } from './src/lib/devMarkupPlugin.js'

const here = dirname(fileURLToPath(import.meta.url))

// App revision stamped into the build: the short commit hash, with '-dirty'
// when the working tree has uncommitted changes. Falls back to a UTC timestamp
// when git is unavailable (exported tarball, CI without the repo). Surfaced
// inconspicuously in the header so users can tell which build they're on.
function appRevision(): string {
  try {
    const hash = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
    const dirty = execSync('git status --porcelain', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() !== ''
    return dirty ? `${hash}-dirty` : hash
  } catch {
    return new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12)
  }
}

// Single-file builds must emit exactly one file. The Monte Carlo worker chunk
// is still emitted (the singlefile plugin can't inline it) but is never used —
// lib/runMonteCarlo falls back to a main-thread run when a worker can't be
// constructed from file://. Delete anything that isn't index.html.
function pruneToSingleHtml(outDir: string): Plugin {
  return {
    name: 'prune-to-single-html',
    apply: 'build',
    closeBundle() {
      for (const entry of readdirSync(outDir)) {
        if (entry !== 'index.html') rmSync(join(outDir, entry), { recursive: true, force: true })
      }
    },
  }
}

// https://vite.dev/config/
// Two build flavours:
//  - default: multi-file site for GitHub Pages, served from the project path
//    (https://jsas.github.io/retired/), output in dist/.
//  - `--mode singlefile`: ONE self-contained HTML file in dist-single/,
//    usable from file:// or passed around as an attachment.
export default defineConfig(({ mode }) => {
  const single = mode === 'singlefile'
  // Read MARKUP_* (and any other local secrets) from .env without a VITE_
  // prefix, so the dev markup loop's model endpoint/key stay server-side.
  const env = { ...process.env, ...loadEnv(mode, here, '') }
  return {
    base: single ? './' : '/retired/',
    resolve: {
      alias: [
        // Most-specific first: the shared engine test fixtures live under
        // packages/engine-core/test, not src. Workspace packages resolve
        // @retired/* straight to their TypeScript source so the app and tests
        // build from the same code the MCP packages ship.
        { find: '@retired/engine-core/test/helpers', replacement: join(here, 'packages/engine-core/test/helpers.ts') },
        { find: '@retired/engine-core', replacement: join(here, 'packages/engine-core/src') },
        { find: '@retired/mcp-tools', replacement: join(here, 'packages/mcp-tools/src') },
        { find: '@retired/mcp-server', replacement: join(here, 'packages/mcp-server/src') },
        { find: '@retired/markup-assistant', replacement: join(here, 'packages/markup-assistant/src') },
        { find: '@retired/ai-bridge', replacement: join(here, 'packages/ai-bridge/src') },
      ],
    },
    define: {
      __APP_REVISION__: JSON.stringify(appRevision()),
    },
    server: {
      // Listen on all interfaces (0.0.0.0) so the dev server is reachable from
      // other devices on the LAN (phone, tablet) — vite prints the network URL.
      host: true,
    },
    plugins: [
      react(),
      // Dev markup overlay: mark -> snap -> send -> a real model edits source ->
      // HMR reloads -> the snapped layer clears. Enabled only when
      // MARKUP_MODEL_ENDPOINT is set in the local .env; otherwise a no-op.
      ...(single ? [] : devMarkupOverlay({ env })),
      ...(single ? [viteSingleFile(), pruneToSingleHtml('dist-single')] : []),
    ],
    // public/ holds the standalone favicon.svg (used by the multi-file Pages
    // build). The single-file build inlines the favicon as a data-URI, so
    // copying public/ would leave stray files beside the HTML.
    publicDir: single ? false : 'public',
    build: {
      outDir: single ? 'dist-single' : 'dist',
      // Inline every asset (favicon svg, fonts, …) in single-file mode.
      assetsInlineLimit: single ? 100_000_000 : undefined,
      chunkSizeWarningLimit: 2_000,
      ...(single ? {
        rollupOptions: {
          output: {
            // The singlefile plugin inlines only entry+static assets; emitted
            // worker chunks stay separate. Flatten them into the entry so the
            // worker constructor gets an inline blob URL and file:// works.
            inlineDynamicImports: true,
          },
        },
      } : {}),
    },
    worker: {
      // The singlefile plugin inlines module workers into the bundle.
      format: 'es',
    },
  }
})
