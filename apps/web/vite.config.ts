/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

const required = ['VITE_FIREBASE_PROJECT_ID', 'VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_APP_ID'];

export default defineConfig(({ command, mode }) => {
  if (command === 'build') {
    // Fail the build instead of publishing a site that renders a blank page.
    const env = loadEnv(mode, process.cwd());
    const missing = required.filter((k) => !env[k]);
    if (missing.length) {
      throw new Error(
        `Missing ${missing.join(', ')} for "${mode}" build. Create apps/web/.env.${mode} ` +
          '(run tools/firebase/provision.mjs, or copy the web app config from Firebase console → ' +
          'Project settings → Your apps). See apps/web/.env.production.example.',
      );
    }
  }
  return {
    plugins: [react()],
    server: { port: 8081 },
    build: {
      rolldownOptions: {
        output: {
          // Libraries change less often than the app: their own files stay cached across deploys.
          codeSplitting: {
            groups: [
              { name: 'firebase', test: /node_modules[\\/](@firebase|firebase)[\\/]/ },
              { name: 'react', test: /node_modules[\\/](react|react-dom|react-router|scheduler)[\\/]/ },
            ],
          },
        },
      },
    },
    test: {
      environment: 'jsdom',
      setupFiles: ['src/test/setup.ts'],
      // Tests never touch Firebase; they inject a fake AuthRepository.
      env: { VITE_FIREBASE_PROJECT_ID: 'test', VITE_FIREBASE_API_KEY: 'test', VITE_FIREBASE_APP_ID: 'test' },
    },
  };
});
