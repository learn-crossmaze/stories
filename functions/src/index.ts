// Stories Cloud Functions. Every callable goes through core/callable.ts
// (auth → validation → permission → transaction + audit → idempotency).
// Deployed names are `<group>-<name>`, e.g. `branches-create`.
import { setGlobalOptions } from 'firebase-functions/v2';

import { REGION } from './core/firebase.js';

setGlobalOptions({ region: REGION, maxInstances: 10 });

// Phase 0 — platform
export * as users from './users/profile.js';
export * as platform from './platform/bootstrap.js';
export * as orgs from './orgs/orgs.js';
export * as branches from './branches/branches.js';
export * as departments from './departments/departments.js';
export * as staff from './staff/roles.js';

// Phase 1 — core library. Explicit groups so deployed names match the
// callable names used by the app (e.g. `payments-recordOffline`).
import * as catalog from './catalog/catalog.js';
import * as circ from './circulation/circulation.js';
import * as res from './circulation/reservations.js';
import * as xfer from './circulation/transfers.js';
import * as inv from './inventory/copies.js';
import * as loc from './inventory/locations.js';
import * as mem from './members/members.js';
import * as dep from './subscriptions/deposits.js';
import * as pl from './subscriptions/plans.js';
import * as subs from './subscriptions/subscriptions.js';
import * as sweep from './subscriptions/sweep.js';

export const books = { create: catalog.create, update: catalog.update, archive: catalog.archive };
export const authors = catalog.authors;
export const publishers = catalog.publishers;
export const categories = catalog.categories;
export const copies = {
  acquire: inv.acquire, relocate: inv.relocate, recordCondition: inv.recordCondition, inspect: inv.inspect,
  repair: inv.repair, markLost: inv.markLost, found: inv.found, retire: inv.retire, availability: inv.availability,
};
export const locations = { create: loc.create, archive: loc.archive };
export const members = { register: mem.register, update: mem.update, setStatus: mem.setStatus };
export const plans = { create: pl.create, update: pl.update, archive: pl.archive };
export const subscriptions = { create: subs.create, cancelPending: subs.cancelPending, expireSweep: sweep.expireSweep };
export const payments = { recordOffline: subs.recordOfflinePayment };
export const deposits = {
  proposeAdjustment: dep.proposeAdjustment, decide: dep.decideAdjustment, startSettlement: dep.startSettlement, refund: dep.refund,
};
export const circulation = { issue: circ.issue, return: circ.returnCopies, exchange: circ.exchange, declareLost: circ.declareLost };
export const reservations = { place: res.place, cancel: res.cancel, expireHolds: res.expireHoldsSweep };
export const transfers = { create: xfer.create, dispatch: xfer.dispatch, receive: xfer.receive, cancel: xfer.cancel };
