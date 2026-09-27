import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false,
    env: {
      GCLOUD_PROJECT: 'demo-stories',
      BOOTSTRAP_SUPER_ADMIN_EMAIL: 'owner@stories.test',
    },
  },
});
