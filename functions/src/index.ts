// Stories Cloud Functions. Every action goes through core/callable.ts
// (auth → validation → permission → transaction + audit → idempotency).
//
// Actions are grouped into a few deployed routers (core/router.ts) to stay
// within the project's Cloud Run CPU quota: the app calls the router with
// `{ action: 'books-create', ... }`. Keep apps/web/src/data/api.ts ROUTERS in sync.
import { setGlobalOptions } from 'firebase-functions/v2';
import { onRequest } from 'firebase-functions/v2/https';

import * as branches from './branches/branches.js';
import * as numbering from './branches/numbering.js';
import * as catalog from './catalog/catalog.js';
import * as covers from './catalog/covers.js';
import * as lookup from './catalog/lookup.js';
import * as circ from './circulation/circulation.js';
import * as res from './circulation/reservations.js';
import * as xfer from './circulation/transfers.js';
import { REGION } from './core/firebase.js';
import { router } from './core/router.js';
import * as online from './payments/online.js';
import * as departments from './departments/departments.js';
import * as inv from './inventory/copies.js';
import * as loc from './inventory/locations.js';
import * as mem from './members/members.js';
import * as orgs from './orgs/orgs.js';
import * as platform from './platform/bootstrap.js';
import * as staff from './staff/roles.js';
import * as dep from './subscriptions/deposits.js';
import * as pl from './subscriptions/plans.js';
import * as subs from './subscriptions/subscriptions.js';
import * as sweep from './subscriptions/sweep.js';
import * as users from './users/profile.js';

setGlobalOptions({ region: REGION, maxInstances: 5 });

/** Platform and organization administration (Phase 0). */
export const admin = router({
  'users-ensureProfile': users.ensureProfile,
  'platform-bootstrapSuperAdmin': platform.bootstrapSuperAdmin,
  'orgs-create': orgs.create,
  'orgs-update': orgs.update,
  'branches-create': branches.create,
  'branches-update': branches.update,
  'branches-archive': branches.archive,
  'branches-setNumbering': numbering.setBranchNumbering,
  'branches-setPaymentGateway': online.setGateway,
  'branches-testPaymentGateway': online.testGateway,
  'departments-create': departments.create,
  'departments-rename': departments.rename,
  'departments-archive': departments.archive,
  'staff-setRoles': staff.setRoles,
  'staff-revoke': staff.revoke,
});

/** Shared catalogue (head office). */
export const catalogue = router({
  'books-create': catalog.create,
  'books-update': catalog.update,
  'books-archive': catalog.archive,
  'books-restore': catalog.restore,
  'books-delete': catalog.remove,
  'books-setNumbering': numbering.setBookNumbering,
  'books-setCover': covers.setCover,
  'books-lookup': lookup.lookup,
  'authors-create': catalog.authors.create,
  'authors-rename': catalog.authors.rename,
  'authors-archive': catalog.authors.archive,
  'publishers-create': catalog.publishers.create,
  'publishers-rename': catalog.publishers.rename,
  'publishers-archive': catalog.publishers.archive,
  'categories-create': catalog.categories.create,
  'categories-rename': catalog.categories.rename,
  'categories-archive': catalog.categories.archive,
});

/** Physical copies and shelf locations. */
export const inventory = router({
  'copies-acquire': inv.acquire,
  'copies-relocate': inv.relocate,
  'copies-recordCondition': inv.recordCondition,
  'copies-inspect': inv.inspect,
  'copies-repair': inv.repair,
  'copies-markLost': inv.markLost,
  'copies-found': inv.found,
  'copies-retire': inv.retire,
  'copies-availability': inv.availability,
  'copies-availabilityMany': inv.availabilityMany,
  'copies-locate': inv.locate,
  'locations-create': loc.create,
  'locations-archive': loc.archive,
});

export const members = router({
  'members-register': mem.register,
  'members-update': mem.update,
  'members-setStatus': mem.setStatus,
  'members-indexList': mem.indexList,
});

/** Plans, subscriptions, counter payments and the deposit ledger. */
export const billing = router({
  'plans-create': pl.create,
  'plans-update': pl.update,
  'plans-archive': pl.archive,
  'subscriptions-create': subs.create,
  'subscriptions-cancelPending': subs.cancelPending,
  'payments-recordOffline': subs.recordOfflinePayment,
  'payments-createRequest': online.createRequest,
  'payments-checkRequest': online.checkRequest,
  'payments-cancelRequest': online.cancelRequest,
  'deposits-proposeAdjustment': dep.proposeAdjustment,
  'deposits-decide': dep.decideAdjustment,
  'deposits-startSettlement': dep.startSettlement,
  'deposits-refund': dep.refund,
});

/** Issue, return, exchange, reservations and transfers. */
export const circulation = router({
  'circulation-issue': circ.issue,
  'circulation-return': circ.returnCopies,
  'circulation-exchange': circ.exchange,
  'circulation-declareLost': circ.declareLost,
  'reservations-place': res.place,
  'reservations-cancel': res.cancel,
  'transfers-create': xfer.create,
  'transfers-dispatch': xfer.dispatch,
  'transfers-receive': xfer.receive,
  'transfers-cancel': xfer.cancel,
});

/** Scheduled jobs (idempotent). */
/** Razorpay webhook (payment_link.paid, qr_code.credited); URL per branch: …/razorpayWebhook?o=<orgId>&b=<branchId>. */
export const razorpayWebhook = onRequest({ region: REGION }, (req, res) => online.handleWebhook(req, res).then(() => undefined));

export const scheduled = {
  expireSubscriptions: sweep.expireSweep,
  expireHolds: res.expireHoldsSweep,
};
