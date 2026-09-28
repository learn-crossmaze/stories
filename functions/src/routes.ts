// Deployed router → the actions it serves. Each domain's index.ts lists its
// own actions; this file only decides which router serves them. Not exported
// from index.ts (Firebase would deploy every entry as its own function).
import * as billing from './billing/index.js';
import * as catalogue from './catalogue/index.js';
import * as circulation from './circulation/index.js';
import * as hr from './hr/index.js';
import * as inventory from './inventory/index.js';
import * as members from './members/index.js';
import * as organization from './organization/index.js';
import * as platform from './platform/index.js';

export const ROUTES = {
  admin: { ...platform.routes, ...organization.routes },
  catalogue: catalogue.routes,
  inventory: inventory.routes,
  members: members.routes,
  billing: billing.routes,
  circulation: circulation.routes,
  hr: hr.routes,
};

export type RouterName = keyof typeof ROUTES;
