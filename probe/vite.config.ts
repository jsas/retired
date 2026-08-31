// Standalone Vite config for the ELECTIVE local-model tuning probe. Separate
// from the app's vite.config.ts so `npm run build` (the Pages deploy) never
// sees this directory — the probe is a dev-time tool: `npm run probe` then
// open http://localhost:5174/probe/ .
import { defineConfig } from 'vite';

export default defineConfig({
  // root stays the repo root (where vite is invoked from); the probe page is
  // served at /probe/. Imports of ../src/* resolve as ordinary source files.
  base: './',
  server: {
    port: 5174,
    host: true,
    // The probe is a static dev page — no HMR needed. Watching the whole
    // repo root means a Chrome profile (or any locked file) inside the tree
    // crashes the watcher with EBUSY and takes the server down mid-sweep.
    hmr: false,
    watch: { ignored: ['**'] },
  },
});
