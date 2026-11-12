// Stories Cloud Functions. Every action goes through core/callable.ts
// (auth → validation → permission → transaction + audit → idempotency).
//
// Code is organized by domain, one folder each: platform, organization,
// catalogue, inventory, members, billing, circulation, hr. Each domain's
// index.ts lists its actions, and routes.ts joins them into the one deployed
// function `api` (core/router.ts): one Cloud Run service that any call from any
// screen keeps warm, instead of several that each go cold on their own.
// The app calls it with `{ action: 'books-create', ... }`.
import { setGlobalOptions } from 'firebase-functions/v2';
import { onRequest } from 'firebase-functions/v2/https';

import { expireSubscriptions, handleRazorpayWebhook } from './billing/index.js';
import { expireHolds } from './circulation/index.js';
import { REGION } from './core/firebase.js';
import { handleDeliveryWebhook } from './delivery/index.js';
import { router } from './core/router.js';
import { accrueLeave, expireDocuments } from './hr/index.js';
import { handleWhatsAppWebhook, sendWhatsApp } from './messaging/index.js';
import { maintenance } from './platform/maintenance.js';
import { API_ROUTES, ROUTES } from './routes.js';
import { handleSitePages } from './site/pages.js';
import { handleSitePublic } from './site/public.js';

setGlobalOptions({ region: REGION, maxInstances: 5 });

/** Every action of every domain. 512MiB because one instance now holds all of them (the default 256MiB is tight). */
export const api = router(API_ROUTES, { memory: '512MiB' });

// The seven routers the app called before `api`. Kept for one release, serving exactly what they always served, so
// browser tabs still open on the older app and a web build that is ahead of or behind the backend keep working
// (apps/web/src/data/api.ts ROUTERS names them; test/unit/routers.test.ts checks it). Remove them in a later release.
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
/** Issue, return, exchange, reservations, transfers and home delivery. */
export const circulation = router(ROUTES.circulation);
/** Staff HRMS (docs/HRMS.md). */
export const hr = router(ROUTES.hr);

/** Razorpay webhook (payment_link.paid, qr_code.credited); URL per branch: …/razorpayWebhook?o=<orgId>&b=<branchId>. */
export const razorpayWebhook = onRequest({ region: REGION }, (req, res) => handleRazorpayWebhook(req, res).then(() => undefined));

/** WhatsApp (Meta) webhook: delivery updates and STOP replies; URL per branch: …/whatsappWebhook?o=<orgId>&b=<branchId>. */
export const whatsappWebhook = onRequest({ region: REGION }, (req, res) => handleWhatsAppWebhook(req, res).then(() => undefined));

/** Courier status updates for home delivery (Porter…); URL per branch: …/deliveryWebhook?o=<orgId>&b=<branchId>&t=<token>. */
export const deliveryWebhook = onRequest({ region: REGION }, (req, res) => handleDeliveryWebhook(req, res).then(() => undefined));

/** Public website data (apps/site): branches, plans and prices; served as /api/public on the website through a Hosting rewrite. */
export const sitePublic = onRequest({ region: REGION }, (req, res) => handleSitePublic(req, res));

/** The website's server-rendered pages (blog, branch pages, About, previews): /blog/**, /branches/*, /about, /preview/** through Hosting rewrites. */
export const sitePages = onRequest({ region: REGION }, (req, res) => handleSitePages(req, res));

/** Sends each queued WhatsApp message (orgs/{o}/whatsappOutbox). */
export const whatsapp = { send: sendWhatsApp };

/** Scheduled jobs (idempotent). `maintenance` finishes interrupted work: claims syncs and WhatsApp sends. */
export const scheduled = { expireSubscriptions, expireHolds, expireDocuments, accrueLeave, maintenance };
