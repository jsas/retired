import { defineConfig } from 'vitest/config';

// Separate config so the shipped suite's include set (src/**) stays untouched.
// Run with:  npx vitest run -c training/vitest.config.ts
export default defineConfig({
  test: {
    environment: 'node',
    include: ['training/**/*.test.ts'],
    globals: false,
  },
});
