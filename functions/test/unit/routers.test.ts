import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { ROUTES } from '../../src/routes.js';

// The web app picks the router from the action's prefix (apps/web/src/data/api.ts).
function webRouters(): Record<string, string> {
  const src = readFileSync(new URL('../../../apps/web/src/data/api.ts', import.meta.url), 'utf8');
  const table = /const ROUTERS: Record<string, string> = \{([\s\S]*?)\};/.exec(src)?.[1] ?? '';
  return Object.fromEntries([...table.matchAll(/(\w+):\s*'(\w+)'/g)].map((m) => [m[1], m[2]]));
}

describe('routers', () => {
  it('every action prefix belongs to exactly one router', () => {
    const owner = new Map<string, string>();
    for (const [router, routes] of Object.entries(ROUTES)) {
      for (const action of Object.keys(routes)) {
        const prefix = action.split('-')[0];
        expect(owner.get(prefix) ?? router, `${action} is split across routers`).toBe(router);
        owner.set(prefix, router);
      }
    }
  });

  it('the web app sends every action to the router that serves it', () => {
    const web = webRouters();
    for (const [router, routes] of Object.entries(ROUTES)) {
      for (const action of Object.keys(routes)) expect(web[action.split('-')[0]], action).toBe(router);
    }
  });
});
