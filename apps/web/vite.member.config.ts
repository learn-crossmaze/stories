import { resolve } from 'node:path';

import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

/**
 * The member area: the member pages of this app, built on their own and served by the public website at
 * /account (docs/SITE.md). Output goes straight into the website's build (apps/site/dist/account), so build the
 * website first (`npm run build:site` does both).
 */
const required = ['VITE_FIREBASE_PROJECT_ID', 'VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_APP_ID'];
const root = import.meta.dirname;

export default defineConfig(({ command, mode }) => {
  if (command === 'build') {
    const env = loadEnv(mode, root);
    const missing = required.filter((k) => !env[k]);
    if (missing.length) throw new Error(`Missing ${missing.join(', ')} for "${mode}" build (apps/web/.env.${mode}).`);
  }
  return {
    plugins: [react()],
    base: '/account/',
    server: { port: 8083, open: '/account/' },
    build: {
      outDir: resolve(root, '../site/dist/account'),
      emptyOutDir: true,
      sourcemap: 'hidden',
      rolldownOptions: {
        input: resolve(root, 'member.html'),
        output: {
          codeSplitting: {
            groups: [
              { name: 'firebase', test: /node_modules[\\/](@firebase|firebase)[\\/]/ },
              { name: 'react', test: /node_modules[\\/](react|react-dom|react-router|scheduler)[\\/]/ },
            ],
          },
        },
      },
    },
  };
});
