import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/__tests__/**/*.test.ts'],
    setupFiles: ['src/__tests__/setup.ts'],
    testTimeout: 10_000,
    hookTimeout: 10_000,
  },
  resolve: {
    conditions: ['node', 'import'],
  },
});
