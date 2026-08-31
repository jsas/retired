import { defineConfig } from 'vitest/config';

// ELECTIVE probe tests — the pure repetition-scoring logic in probe/. Deliberately
// separate from vitest.config.ts so `npm test` (the deploy gate) never runs them
// and they never touch src/**. Run with `npm run probe:test`.

export default defineConfig({
  test: {
    environment: 'node',
    include: ['probe/**/*.test.ts'],
    globals: false,
  },
});
