import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'
import { rmSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

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
  return {
    base: single ? './' : '/retired/',
    server: {
      // Listen on all interfaces (0.0.0.0) so the dev server is reachable from
      // other devices on the LAN (phone, tablet) — vite prints the network URL.
      host: true,
    },
    plugins: [
      react(),
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
