/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: { port: 8081 },
  test: {
    environment: 'jsdom',
    setupFiles: ['src/test/setup.ts'],
    // Tests never touch Firebase; they inject a fake AuthRepository.
    env: { VITE_FIREBASE_PROJECT_ID: 'test', VITE_FIREBASE_API_KEY: 'test', VITE_FIREBASE_APP_ID: 'test' },
  },
});
