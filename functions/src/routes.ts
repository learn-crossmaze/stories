// The actions each deployed function serves. Each domain's index.ts lists its
// own actions; this file only joins them. Not exported from index.ts (Firebase
// would deploy every entry as its own function).
import type { CallableFunction } from 'firebase-functions/v2/https';

import * as billing from './billing/index.js';
import * as catalogue from './catalogue/index.js';
import * as circulation from './circulation/index.js';
import * as delivery from './delivery/index.js';
import * as hr from './hr/index.js';
import * as inventory from './inventory/index.js';
import * as members from './members/index.js';
import * as messaging from './messaging/index.js';
import * as organization from './organization/index.js';
import * as platform from './platform/index.js';
import * as site from './site/index.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Routes = Record<string, CallableFunction<any, any>>;

/** Joins action tables into one. Two tables defining the same action is a mistake (a plain spread would silently keep the last), so it throws. */
export function merge(...tables: Routes[]): Routes {
  const all: Routes = {};
  for (const table of tables) {
    for (const [action, fn] of Object.entries(table)) {
      if (Object.hasOwn(all, action)) throw new Error(`Action ${action} is defined twice.`);
      all[action] = fn;
    }
  }
  return all;
}

/** Every action of every domain: what the one `api` function serves. */
export const API_ROUTES = merge(
  platform.routes, organization.routes, messaging.routes, site.routes,
  catalogue.routes,
  inventory.routes,
  members.routes, delivery.memberRoutes,
  billing.routes,
  circulation.routes, delivery.routes,
  hr.routes,
);

/**
 * The seven routers from before `api`, each with the actions it always served. Kept for one release so open tabs and a
 * web build older or newer than the backend keep working (apps/web/src/data/api.ts falls back to them); then remove.
 */
export const ROUTES = {
  admin: { ...platform.routes, ...organization.routes, ...messaging.routes, ...site.routes },
  catalogue: catalogue.routes,
  inventory: inventory.routes,
  members: { ...members.routes, ...delivery.memberRoutes },
  billing: billing.routes,
  circulation: { ...circulation.routes, ...delivery.routes },
  hr: hr.routes,
};

export type RouterName = keyof typeof ROUTES;
