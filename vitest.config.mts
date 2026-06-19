import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['**/*.spec.ts', '**/*.integration.spec.ts'],
    testTimeout: 30000,
    passWithNoTests: true,
  },
});
