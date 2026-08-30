import { defineConfig } from 'vitest/config';

// Test config is intentionally separate from vite.config.ts so the build
// (base path, single-file plugin, worker handling) is untouched. Tests run in
// Node against the pure library modules — no DOM needed for the engine.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    globals: false,
  },
});
