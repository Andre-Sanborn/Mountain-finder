import { defineConfig } from 'vitest/config';

// Ground-truth acceptance suite (archive/v2-docs-20260929/PLAN.md P6.3). Runs the full pipeline against
// documented cases in fixtures/. Separate from `npm run check` because these
// are heavier end-to-end runs, not fast unit feedback.
export default defineConfig({
  test: {
    include: ['tests/acceptance/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
  },
});
