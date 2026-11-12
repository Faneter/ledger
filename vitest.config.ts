import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['packages/**/tests/**/*.test.ts', 'apps/**/tests/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@ledger/core': resolve(__dirname, 'packages/core/src/index.ts'),
      '@ledger/db': resolve(__dirname, 'packages/db/src/index.ts'),
    },
  },
});
