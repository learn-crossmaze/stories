import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import type { Request } from 'firebase-functions/v2/https';
import { z } from 'zod';

import { recordAudit } from '../core/audit.js';
import { command, query, requestIdSchema } from '../core/callable.js';
import { errors } from '../core/errors.js';
import { db } from '../core/firebase.js';
import { id } from '../core/schemas.js';
import { readSettlement, writeSettlement } from '../subscriptions/subscriptions.js';
import {
  gatewayError,
  KEY_ID,
  loadCredentials,
  modeOf,
  type PaymentLink,
  type Payment,
  privateRef,
  type QrCode,
  rzp,
  verifySignature,
} from './razorpay.js';

const LINK_DAYS = 7;
const QR_MINUTES = 30;

export type Channel = 'LINK' | 'QR' | 'QR_LINK';
const requestRef = (orgId: string, gatewayId: string) => db.doc(`orgs/${orgId}/paymentRequests/${gatewayId}`);

// ------------------------------------------------------------------ branch settings

/**
 * Saves a branch's Razorpay settings. Secrets are write-only: leave them blank
 * to keep the saved ones. The audit log records what changed, never a secret.
 */
export const setGateway = command(
  'branches-setPaymentGateway',
  z.strictObject({
    orgId: id,
    branchId: id,
    enabled: z.boolean(),
    keyId: z.string().trim().regex(KEY_ID, 'must look like rzp_test_… or rzp_live_…'),
    keySecret: z.string().trim().max(100).default(''),
    webhookSecret: z.string().trim().max(100).default(''),
    notifySms: z.boolean().default(true),
    notifyEmail: z.boolean().default(true),
  }),
  async ({ actor, input, requestId }, tx) => {
    await actor.require('branches.manage', input.orgId, input.branchId, tx);
    const branchRef = db.doc(`orgs/${input.orgId}/branches/${input.branchId}`);
    const [branch, secret] = await Promise.all([tx.get(branchRef), tx.get(privateRef(input.orgId, input.branchId))]);
    if (!branch.exists || branch.get('status') !== 'ACTIVE') throw errors.notFound('Branch');
    const before = branch.get('payments.razorpay') ?? null;
    const keyChanged = before?.keyId !== input.keyId;
    const keySecret = input.keySecret || (keyChanged ? '' : ((secret.get('keySecret') as string | undefined) ?? ''));
    if (!keySecret) throw errors.invalid(keyChanged ? 'Enter the key secret for this key ID.' : 'Enter the key secret.');
    const webhookSecret = input.webhookSecret || ((secret.get('webhookSecret') as string | undefined) ?? '');

    const settings = {
      enabled: input.enabled,
      keyId: input.keyId,
      mode: modeOf(input.keyId),
      notifySms: input.notifySms,
      notifyEmail: input.notifyEmail,
      hasWebhookSecret: !!webhookSecret,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: actor.uid,
    };
    tx.update(branchRef, { 'payments.razorpay': settings, updatedAt: FieldValue.serverTimestamp() });
    tx.set(privateRef(input.orgId, input.branchId), { keySecret, webhookSecret: webhookSecret || null, updatedAt: FieldValue.serverTimestamp() });
    const { updatedAt: _u, updatedBy: _b, ...shown } = settings;
    recordAudit(tx, { actorUid: actor.uid, actorEmail: actor.email, requestId }, input.orgId, {
      action: 'branch.paymentGateway',
      entityType: 'branch',
      entityId: input.branchId,
      branchId: input.branchId,
      before: before ? { enabled: before.enabled, keyId: before.keyId, notifySms: before.notifySms, notifyEmail: before.notifyEmail } : null,
      after: { ...shown, keySecretChanged: !!input.keySecret, webhookSecretChanged: !!input.webhookSecret },
    });
    return { branchId: input.branchId, mode: settings.mode };
  },
);

/** Checks the saved key against Razorpay (lists one payment link). */
export const testGateway = query('branches-testPaymentGateway', z.strictObject({ orgId: id, branchId: id }), async ({ actor, input }) => {
  await actor.require('branches.manage', input.orgId, input.branchId);
  const creds = await loadCredentials(null, input.orgId, input.branchId, { requireEnabled: false });
  try {
    await rzp(creds, 'GET', '/payment_links?count=1');
  } catch (e) {
    gatewayError(e);
  }
  return { ok: true, mode: creds.settings.mode };
});

// ------------------------------------------------------------------ collecting a payment

/**
 * Asks Razorpay for a payment link (sent to the member's mobile and email) or
 * a single-use UPI QR code for a subscription waiting for payment. If the
 * Razorpay account can't make UPI QR codes, a payment link is shown as a QR
 * code instead (channel QR_LINK). An open request for the same subscription
 * and channel is reused rather than duplicated.
 */
export const createRequest = query(
  'payments-createRequest',
  z.strictObject({ orgId: id, subscriptionId: id, channel: z.enum(['LINK', 'QR']), requestId: requestIdSchema }),
  async ({ actor, input }) => {
    const col = db.collection(`orgs/${input.orgId}/paymentRequests`);
    const replay = await col.where('requestId', '==', input.requestId).limit(1).get();
    if (!replay.empty) return describe(replay.docs[0]);

    const sub = await db.doc(`orgs/${input.orgId}/subscriptions/${input.subscriptionId}`).get();
    if (!sub.exists) throw errors.notFound('Subscription');
    const branchId = sub.get('branchId') as string;
    await actor.require('payments.recordOffline', input.orgId, branchId);
    if (sub.get('status') !== 'PENDING_PAYMENT') throw errors.conflict('NOT_PENDING', 'This subscription is not waiting for payment (it may already be paid).');

    const open = await col.where('subscriptionId', '==', input.subscriptionId).where('status', '==', 'OPEN').get();
    const reusable = open.docs.find((d) => (input.channel === 'LINK' ? d.get('channel') === 'LINK' : d.get('channel') !== 'LINK') && (d.get('expiresAt') as Timestamp).toMillis() > Date.now() + 60_000);
    if (reusable) return describe(reusable);

    const creds = await loadCredentials(null, input.orgId, branchId);
    const member = await db.doc(`orgs/${input.orgId}/members/${sub.get('memberId')}`).get();
    const amount = sub.get('amountDue.totalMinor') as number;
    if (amount < 100) throw errors.invalid('Online payments need an amount of at least ₹1.');
    const notes = { orgId: input.orgId, branchId, subscriptionId: input.subscriptionId, memberId: member.id };
    const description = `${sub.get('planSnapshot.name')} · ${member.get('code')}`.slice(0, 250);
    const phone = (member.get('phone') as string | null) ?? null;
    const email = (member.get('email') as string | null) || null;

    let channel: Channel = input.channel;
    let gatewayId: string;
    let url: string | null = null;
    let qrImageUrl: string | null = null;
    let expiresAt: Date;
    let sentTo = { sms: null as string | null, email: null as string | null };
    const makeLink = async (notify: boolean) => {
      if (notify && !phone && !email) throw errors.invalid('Add a mobile number or email to the member to send a payment link.');
      const sms = notify && creds.settings.notifySms && !!phone;
      const mail = notify && creds.settings.notifyEmail && !!email;
      const expire = new Date(Date.now() + LINK_DAYS * 86_400_000);
      const link = await rzp<PaymentLink>(creds, 'POST', '/payment_links', {
        amount,
        currency: 'INR',
        accept_partial: false,
        description,
        reference_id: `${input.subscriptionId.slice(0, 24)}-${Date.now().toString(36)}`,
        customer: { name: member.get('fullName'), ...(phone ? { contact: phone } : {}), ...(email ? { email } : {}) },
        notify: { sms, email: mail },
        reminder_enable: notify,
        expire_by: Math.floor(expire.getTime() / 1000),
        notes,
      });
      sentTo = { sms: sms ? phone : null, email: mail ? email : null };
      return { link, expire };
    };

    try {
      if (input.channel === 'LINK') {
        const { link, expire } = await makeLink(true);
        gatewayId = link.id;
        url = link.short_url;
        expiresAt = expire;
      } else {
        const close = new Date(Date.now() + QR_MINUTES * 60_000);
        try {
          const qr = await rzp<QrCode>(creds, 'POST', '/payments/qr_codes', {
            type: 'upi_qr',
            name: String(creds.branch.get('name') ?? 'Stories').slice(0, 40),
            usage: 'single_use',
            fixed_amount: true,
            payment_amount: amount,
            description,
            close_by: Math.floor(close.getTime() / 1000),
            notes,
          });
          gatewayId = qr.id;
          qrImageUrl = qr.image_url;
          expiresAt = close;
        } catch (e) {
          // Accounts without the QR Codes product: show a payment link as a QR code (it opens any UPI app).
          logger.warn('payments-createRequest: UPI QR unavailable, using a payment link QR', e instanceof Error ? e.message : e);
          const { link, expire } = await makeLink(false);
          channel = 'QR_LINK';
          gatewayId = link.id;
          url = link.short_url;
          expiresAt = expire;
        }
      }
    } catch (e) {
      gatewayError(e);
    }

    const ref = requestRef(input.orgId, gatewayId!);
    await db.runTransaction(async (tx) => {
      tx.create(ref, {
        gateway: 'razorpay',
        mode: creds.settings.mode,
        channel,
        gatewayId: gatewayId!,
        url,
        qrImageUrl,
        subscriptionId: input.subscriptionId,
        memberId: member.id,
        memberCode: member.get('code'),
        memberName: member.get('fullName'),
        branchId,
        amountMinor: amount,
        status: 'OPEN',
        sentTo,
        requestId: input.requestId,
        createdBy: actor.uid,
        createdAt: FieldValue.serverTimestamp(),
        expiresAt: Timestamp.fromDate(expiresAt!),
      });
      recordAudit(tx, { actorUid: actor.uid, actorEmail: actor.email, requestId: input.requestId }, input.orgId, {
        action: 'payment.requestOnline', entityType: 'subscription', entityId: input.subscriptionId, branchId, memberId: member.id,
        after: { channel, gatewayId: gatewayId!, amountMinor: amount, sentTo },
      });
    });
    return describe(await ref.get());
  },
);

function describe(d: FirebaseFirestore.DocumentSnapshot) {
  return {
    requestId: d.id,
    channel: d.get('channel') as Channel,
    url: d.get('url') as string | null,
    qrImageUrl: d.get('qrImageUrl') as string | null,
    amountMinor: d.get('amountMinor') as number,
    status: d.get('status') as string,
    sentTo: d.get('sentTo') as { sms: string | null; email: string | null },
    expiresAt: (d.get('expiresAt') as Timestamp).toDate().toISOString(),
    mode: d.get('mode') as string,
  };
}

// ------------------------------------------------------------------ settling

export interface GatewayPayment {
  paymentId: string;
  amountMinor: number;
  method: string | null;
}

/**
 * Applies a captured Razorpay payment to its request (webhook or status
 * check; safe to run more than once). Activates the subscription exactly
 * like a counter payment. Money that can't be applied — the subscription was
 * cancelled or already paid, or the amount differs — is still recorded and
 * flagged for finance to refund or apply by hand.
 */
export async function applyGatewayPayment(orgId: string, gatewayId: string, paid: GatewayPayment, source: 'webhook' | 'check') {
  return db.runTransaction(async (tx) => {
    const ref = requestRef(orgId, gatewayId);
    const req = await tx.get(ref);
    if (!req.exists) return { applied: false, reason: 'UNKNOWN_REQUEST' };
    if (req.get('status') === 'PAID') return { applied: false, reason: 'ALREADY_PAID' };
    const s = await readSettlement(tx, orgId, req.get('subscriptionId'));
    const system = { uid: `razorpay:${source}`, email: null };
    const channel = req.get('channel') as Channel;
    const method = channel === 'LINK' ? 'ONLINE_LINK' : 'ONLINE_UPI_QR';
    const problem =
      s.status !== 'PENDING_PAYMENT'
        ? 'The subscription was no longer waiting for payment.'
        : paid.amountMinor !== s.due.totalMinor
          ? `Paid ₹${(paid.amountMinor / 100).toFixed(2)} but ₹${(s.due.totalMinor / 100).toFixed(2)} was due.`
          : null;

    if (problem) {
      const payRef = db.collection(`orgs/${orgId}/payments`).doc();
      tx.create(payRef, {
        memberId: s.memberId, memberCode: s.member.code, branchId: s.branchId, subscriptionId: s.subscriptionId, purpose: 'SUBSCRIPTION',
        direction: 'IN', lines: [{ type: 'UNAPPLIED', amountMinor: paid.amountMinor }], amountMinor: paid.amountMinor, currency: 'INR',
        method, reference: paid.paymentId, gateway: { provider: 'razorpay', requestId: gatewayId, paymentId: paid.paymentId, channel },
        status: 'NEEDS_ATTENTION', note: problem, recordedBy: system.uid, at: FieldValue.serverTimestamp(),
      });
      tx.update(ref, { status: 'PAID', paidAt: FieldValue.serverTimestamp(), paymentId: payRef.id, gatewayPaymentId: paid.paymentId, needsAttention: problem });
      recordAudit(tx, { actorUid: system.uid, actorEmail: null }, orgId, {
        action: 'payment.onlineUnapplied', entityType: 'subscription', entityId: s.subscriptionId, branchId: s.branchId, memberId: s.memberId,
        after: { gatewayPaymentId: paid.paymentId, amountMinor: paid.amountMinor, problem },
      });
      return { applied: false, reason: 'NEEDS_ATTENTION', problem };
    }
    const r = writeSettlement(tx, s, {
      method,
      reference: paid.paymentId,
      gateway: { provider: 'razorpay', requestId: gatewayId, paymentId: paid.paymentId, channel },
    }, system, undefined);
    tx.update(ref, { status: 'PAID', paidAt: FieldValue.serverTimestamp(), paymentId: r.paymentId, gatewayPaymentId: paid.paymentId, paidWith: paid.method });
    return { applied: true, paymentId: r.paymentId };
  });
}

/** Captured payment for a request, straight from Razorpay (null if not paid yet). */
async function fetchPaid(creds: Awaited<ReturnType<typeof loadCredentials>>, channel: Channel, gatewayId: string): Promise<GatewayPayment | null> {
  if (channel === 'QR') {
    const list = await rzp<{ items: Payment[] }>(creds, 'GET', `/payments/qr_codes/${gatewayId}/payments`);
    const p = list.items.find((i) => i.status === 'captured');
    return p ? { paymentId: p.id, amountMinor: p.amount, method: p.method ?? null } : null;
  }
  const link = await rzp<PaymentLink>(creds, 'GET', `/payment_links/${gatewayId}`);
  const p = link.status === 'paid' ? link.payments?.find((i) => i.status === 'captured') : undefined;
  return p ? { paymentId: p.payment_id, amountMinor: p.amount, method: p.method ?? null } : null;
}

/** Asks Razorpay whether a request has been paid (for when the webhook isn't set up or is delayed). */
export const checkRequest = query('payments-checkRequest', z.strictObject({ orgId: id, paymentRequestId: id }), async ({ actor, input }) => {
  const req = await requestRef(input.orgId, input.paymentRequestId).get();
  if (!req.exists) throw errors.notFound('Payment request');
  await actor.require('payments.view', input.orgId, req.get('branchId'));
  if (req.get('status') !== 'OPEN') return { status: req.get('status') as string };
  const creds = await loadCredentials(null, input.orgId, req.get('branchId'), { requireEnabled: false });
  let paid: GatewayPayment | null = null;
  try {
    paid = await fetchPaid(creds, req.get('channel'), req.id);
  } catch (e) {
    gatewayError(e);
  }
  if (!paid) return { status: 'OPEN' };
  const r = await applyGatewayPayment(input.orgId, req.id, paid, 'check');
  return { status: 'PAID', ...r };
});

/** Cancels an unpaid link / closes an unused QR code. */
export const cancelRequest = command(
  'payments-cancelRequest',
  z.strictObject({ orgId: id, paymentRequestId: id }),
  async ({ actor, input, requestId }, tx) => {
    const ref = requestRef(input.orgId, input.paymentRequestId);
    const req = await tx.get(ref);
    if (!req.exists) throw errors.notFound('Payment request');
    await actor.require('payments.recordOffline', input.orgId, req.get('branchId'), tx);
    if (req.get('status') !== 'OPEN') throw errors.conflict('NOT_OPEN', 'This payment request is no longer open.');
    const creds = await loadCredentials(tx, input.orgId, req.get('branchId'), { requireEnabled: false });
    try {
      if (req.get('channel') === 'QR') await rzp(creds, 'POST', `/payments/qr_codes/${req.id}/close`);
      else await rzp(creds, 'POST', `/payment_links/${req.id}/cancel`);
    } catch (e) {
      gatewayError(e);
    }
    tx.update(ref, { status: 'CANCELLED', cancelledBy: actor.uid, cancelledAt: FieldValue.serverTimestamp() });
    recordAudit(tx, { actorUid: actor.uid, actorEmail: actor.email, requestId }, input.orgId, {
      action: 'payment.requestCancelled', entityType: 'subscription', entityId: req.get('subscriptionId'), branchId: req.get('branchId'), memberId: req.get('memberId'),
      after: { gatewayId: req.id },
    });
    return { requestId: req.id };
  },
);

// ------------------------------------------------------------------ webhook

interface WebhookBody {
  event?: string;
  payload?: {
    payment_link?: { entity?: { id?: string } };
    qr_code?: { entity?: { id?: string } };
    payment?: { entity?: { id?: string; amount?: number; status?: string; method?: string } };
  };
}

/**
 * Razorpay webhook. Its URL carries the branch (`?o=<orgId>&b=<branchId>`) so
 * the signature is checked with that branch's webhook secret. Handles
 * payment_link.paid and qr_code.credited; everything else is acknowledged
 * and ignored. Responds 2xx for handled or ignored events so Razorpay
 * doesn't retry, 4xx for bad signatures.
 */
export async function handleWebhook(req: Pick<Request, 'query' | 'headers' | 'rawBody' | 'method'>, res: { status: (n: number) => { send: (b: string) => void } }) {
  if (req.method !== 'POST') return res.status(405).send('POST only');
  const orgId = String(req.query.o ?? '');
  const branchId = String(req.query.b ?? '');
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(orgId) || !/^[A-Za-z0-9_-]{1,64}$/.test(branchId)) return res.status(400).send('missing branch');
  const secret = await privateRef(orgId, branchId).get();
  const webhookSecret = secret.get('webhookSecret') as string | undefined;
  const signature = req.headers['x-razorpay-signature'];
  if (!webhookSecret || !verifySignature(req.rawBody, Array.isArray(signature) ? signature[0] : signature, webhookSecret)) {
    logger.warn('razorpayWebhook: bad or missing signature', { orgId, branchId });
    return res.status(401).send('bad signature');
  }
  let body: WebhookBody;
  try {
    body = JSON.parse(req.rawBody.toString('utf8')) as WebhookBody;
  } catch {
    return res.status(400).send('bad json');
  }
  const gatewayId = body.event === 'payment_link.paid' ? body.payload?.payment_link?.entity?.id : body.event === 'qr_code.credited' ? body.payload?.qr_code?.entity?.id : undefined;
  const payment = body.payload?.payment?.entity;
  if (!gatewayId || !payment?.id || payment.status !== 'captured') return res.status(200).send('ignored');
  const result = await applyGatewayPayment(orgId, gatewayId, { paymentId: payment.id, amountMinor: payment.amount ?? 0, method: payment.method ?? null }, 'webhook');
  logger.info('razorpayWebhook', { orgId, branchId, gatewayId, ...result });
  return res.status(200).send(result.reason ?? 'ok');
}
