import { readdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import { describe, expect, it, vi } from 'vitest';

import { ENFORCE_APP_CHECK, REGION } from '../../src/core/firebase.js';
import { router } from '../../src/core/router.js';
import { API_ROUTES, merge, ROUTES } from '../../src/routes.js';

/** The options each callable was declared with (the real `onCall` still does the work). */
const onCallOptions = vi.hoisted(() => [] as unknown[]);
vi.mock('firebase-functions/v2/https', async (importOriginal) => {
  const actual = await importOriginal<typeof import('firebase-functions/v2/https')>();
  const onCall = ((opts: never, handler: never) => {
    onCallOptions.push(opts);
    return actual.onCall(opts, handler);
  }) as typeof actual.onCall;
  return { ...actual, onCall };
});

// The web app calls `api`; while the backend is older than the web build it falls back to the older router,
// picked from the action's prefix (apps/web/src/data/api.ts).
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

  it('no action takes an input named `action` (the router uses it for the action name)', () => {
    const offenders = readdirSync(new URL('../../src', import.meta.url), { recursive: true })
      .filter((f) => String(f).endsWith('.ts'))
      .filter((f) => /strictObject\(\{[^}]*\baction:\s*z\./.test(readFileSync(new URL(`../../src/${f}`, import.meta.url), 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('the web app falls back to the older router that serves the action', () => {
    const web = webRouters();
    for (const [router, routes] of Object.entries(ROUTES)) {
      for (const action of Object.keys(routes)) expect(web[action.split('-')[0]], action).toBe(router);
    }
  });

  it('`api` serves every action of the older routers, each exactly once, with the same handler', () => {
    const legacy = Object.values(ROUTES).flatMap((routes) => Object.entries(routes));
    expect(Object.keys(API_ROUTES).sort()).toEqual(legacy.map(([action]) => action).sort()); // equal as lists: nothing missing, extra or twice
    for (const [action, fn] of legacy) expect(API_ROUTES[action], action).toBe(fn);
  });

  it('refuses to join tables that define the same action twice', () => {
    const fn = API_ROUTES['books-create'];
    expect(merge({ 'a-one': fn }, { 'b-two': fn })).toEqual({ 'a-one': fn, 'b-two': fn });
    expect(() => merge({ 'a-one': fn }, { 'b-two': fn, 'a-one': fn })).toThrow('a-one');
  });

  it('`ping` is the router\'s own and no action of that name exists', () => {
    for (const routes of [API_ROUTES, ...Object.values(ROUTES)]) expect(Object.hasOwn(routes, 'ping')).toBe(false);
  });

  it('the web app calls the function this backend exports', async () => {
    const src = readFileSync(new URL('../../../apps/web/src/data/api.ts', import.meta.url), 'utf8');
    const name = /const API = '(\w+)';/.exec(src)?.[1];
    expect(name).toBe('api');
    const index = readFileSync(new URL('../../src/index.ts', import.meta.url), 'utf8');
    expect(index).toMatch(new RegExp(`export const ${name} = router\\(API_ROUTES\\b`));
    for (const legacy of Object.keys(ROUTES)) expect(index).toMatch(new RegExp(`export const ${legacy} = router\\(ROUTES\\.${legacy}\\)`));
  });
});

// Pins what router() relies on inside firebase-functions: its wrapper must leave the callable deployable and
// callable in-process, and the browser's preflight must come back cacheable.
describe('router()', () => {
  it('stays a deployable callable that tests can run in-process', () => {
    const fn = router({});
    expect(typeof fn).toBe('function');
    expect(fn.__endpoint.callableTrigger).toBeDefined();
    expect(typeof fn.run).toBe('function');
  });

  it('lets the browser cache the CORS preflight for 2 hours', async () => {
    const fn = router({});
    const server = createServer((req, res) => void fn(req as never, res as never));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/`, {
        method: 'OPTIONS',
        headers: { Origin: 'https://app.example', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type' },
      });
      expect(res.status).toBe(204);
      expect(res.headers.get('access-control-max-age')).toBe('7200');
      expect(res.headers.get('access-control-allow-origin')).toBe('https://app.example');
    } finally {
      server.close();
    }
  });

  it('takes extra options such as memory, but cannot be moved to another region or have App Check switched off', () => {
    const fn = router({}, { region: 'us-central1', enforceAppCheck: !ENFORCE_APP_CHECK, memory: '512MiB' });
    expect(onCallOptions.at(-1)).toEqual({ memory: '512MiB', region: REGION, enforceAppCheck: ENFORCE_APP_CHECK });
    expect(fn.__endpoint.region).toEqual([REGION]);
    expect(fn.__endpoint.availableMemoryMb).toBe(512);
  });
});
