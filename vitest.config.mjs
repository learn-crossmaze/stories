import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['firebase/rules-tests/**/*.test.mjs'],
    testTimeout: 20000,
    fileParallelism: false,
  },
});
