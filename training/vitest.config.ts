import { defineConfig } from 'vitest/config';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = dirname(here); // training/ -> worktree root

// Separate config so the shipped suite's include set (src/**) stays untouched.
// Run with:  npx vitest run -c training/vitest.config.ts
//
// The @retired/* workspace packages resolve to their TypeScript source (same as
// the root vitest.config.ts) so the minter + eval gate import the real engine /
// tool catalog, not a stale build. Most-specific alias first (test fixtures live
// under packages/engine-core/test, not src).
export default defineConfig({
  resolve: {
    alias: [
      { find: '@retired/engine-core/test/helpers', replacement: join(root, 'packages/engine-core/test/helpers.ts') },
      { find: '@retired/engine-core', replacement: join(root, 'packages/engine-core/src') },
      { find: '@retired/mcp-tools', replacement: join(root, 'packages/mcp-tools/src') },
      { find: '@retired/mcp-server', replacement: join(root, 'packages/mcp-server/src') },
    ],
  },
  test: {
    environment: 'node',
    include: ['training/**/*.test.ts'],
    globals: false,
  },
});
