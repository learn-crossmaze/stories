// Stories Cloud Functions. Every action goes through core/callable.ts
// (auth → validation → permission → transaction + audit → idempotency).
//
// Code is organized by domain, one folder each: platform, organization,
// catalogue, inventory, members, billing, circulation, hr. Each domain's
// index.ts lists its actions, and routes.ts maps them to a few deployed
// routers (core/router.ts) to stay within the project's Cloud Run CPU quota.
// The app calls a router with `{ action: 'books-create', ... }`. The deployed
// names below never change. apps/web/src/data/api.ts ROUTERS must match
// (test/unit/routers.test.ts checks it).
import { setGlobalOptions } from 'firebase-functions/v2';
import { onRequest } from 'firebase-functions/v2/https';

import { expireSubscriptions, handleRazorpayWebhook } from './billing/index.js';
import { expireHolds } from './circulation/index.js';
import { REGION } from './core/firebase.js';
import { router } from './core/router.js';
import { expireDocuments } from './hr/index.js';
import { ROUTES } from './routes.js';

setGlobalOptions({ region: REGION, maxInstances: 5 });

/** Platform and organization administration. */
export const admin = router(ROUTES.admin);
/** Shared catalogue (head office). */
export const catalogue = router(ROUTES.catalogue);
/** Physical copies and shelf locations. */
export const inventory = router(ROUTES.inventory);
/** Members, guardians and member self-service. */
export const members = router(ROUTES.members);
/** Plans, subscriptions, counter and online payments, the deposit ledger. */
export const billing = router(ROUTES.billing);
/** Issue, return, exchange, reservations and transfers. */
export const circulation = router(ROUTES.circulation);
/** Staff HRMS (docs/HRMS.md). */
export const hr = router(ROUTES.hr);

/** Razorpay webhook (payment_link.paid, qr_code.credited); URL per branch: …/razorpayWebhook?o=<orgId>&b=<branchId>. */
export const razorpayWebhook = onRequest({ region: REGION }, (req, res) => handleRazorpayWebhook(req, res).then(() => undefined));

/** Scheduled jobs (idempotent). */
export const scheduled = { expireSubscriptions, expireHolds, expireDocuments };
