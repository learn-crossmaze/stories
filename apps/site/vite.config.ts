/// <reference types="vitest/config" />
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { defineConfig, type Plugin } from 'vite';

const root = import.meta.dirname;

/** Every page of the site (each is a real HTML file, so search engines read its content without running scripts). */
const PAGES = { index: 'index.html', books: 'books/index.html', plans: 'plans/index.html', branches: 'branches/index.html', 'how-it-works': 'how-it-works/index.html', franchise: 'franchise/index.html', contact: 'contact/index.html', notFound: '404.html' };

/** `<!-- include:header -->` → src/partials/header.html (before Vite fills in %VITE_…% values). */
const partials = (): Plugin => ({
  name: 'stories-partials',
  transformIndexHtml: {
    order: 'pre',
    handler: (html) => html.replace(/<!--\s*include:([a-z-]+)\s*-->/g, (_, name: string) => readFileSync(resolve(root, 'src/partials', `${name}.html`), 'utf8')),
  },
});

export default defineConfig({
  plugins: [partials()],
  server: {
    port: 8082,
    // Live data from the Functions emulator (`npm run emulators`), as /api/public is on the real site.
    proxy: { '/api/public': { target: 'http://127.0.0.1:5001', rewrite: () => '/demo-stories/asia-south1/sitePublic' } },
  },
  build: {
    rolldownOptions: { input: Object.fromEntries(Object.entries(PAGES).map(([k, v]) => [k, resolve(root, v)])) },
  },
  test: { environment: 'jsdom' },
});
