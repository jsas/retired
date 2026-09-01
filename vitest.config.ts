import { defineConfig } from 'vitest/config';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

// Test config is intentionally separate from vite.config.ts so the build
// (base path, single-file plugin, worker handling) is untouched. Tests run in
// Node against the pure library modules — no DOM needed for the engine. The
// @retired/* workspace packages resolve to their TypeScript source so engine
// and MCP-tool tests run against the same code the app builds from.
export default defineConfig({
  resolve: {
    alias: [
      // Most-specific first: the shared engine test fixtures live under
      // packages/engine-core/test, not src.
      { find: '@retired/engine-core/test/helpers', replacement: join(here, 'packages/engine-core/test/helpers.ts') },
      { find: '@retired/engine-core', replacement: join(here, 'packages/engine-core/src') },
      { find: '@retired/mcp-tools', replacement: join(here, 'packages/mcp-tools/src') },
      { find: '@retired/mcp-server', replacement: join(here, 'packages/mcp-server/src') },
    ],
  },
  test: {
    environment: 'node',
    include: [
      'src/**/*.test.ts', 'src/**/*.test.tsx', 'packages/**/*.test.ts',
      // SFT corpus gates the deploy too: a leaked split would inflate the
      // bake-off's protocol-validity scoring on any fine-tuned model, and we
      // would never see the leak. Run training tests in the same gate.
      'training/**/*.test.ts',
    ],
    globals: false,
  },
});
