import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import type { Request } from 'firebase-functions/v2/https';

import { safeEqual } from '../core/crypto.js';
import { AppError } from '../core/errors.js';
import { db, REGION } from '../core/firebase.js';
import { sweep } from '../core/sweep.js';
import { eventFor, placeholders } from './events.js';
import { loadConnection, MetaError, outboxCol, queueWhatsApp, sendTemplate, switchboardRef, templateOf, templateRef, verifyMetaSignature, waNumber } from './whatsapp.js';

const dateFmt = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeZone: 'Asia/Kolkata' });
export const dateIN = (d: Date) => dateFmt.format(d);
const first = (name: string) => name.split(/\s+/)[0] ?? name;
const mask = (n: string) => `+${n.slice(0, 2)} ••••• ${n.slice(-4)}`;

/** Who a queued message goes to: phone (WhatsApp format) and the names the template can use. */
async function recipient(orgId: string, m: FirebaseFirestore.DocumentSnapshot) {
  const memberId = m.get('memberId') as string | null;
  const uid = m.get('uid') as string | null;
  if (memberId) {
    const member = await db.doc(`orgs/${orgId}/members/${memberId}`).get();
    if (!member.exists) return { skip: 'Member not found' };
    if (member.get('whatsappOptOut')) return { skip: 'The member asked not to get WhatsApp messages' };
    let phone = member.get('phone') as string | null;
    // Children have no phone of their own: their guardian gets the message.
    if (!phone && member.get('guardian.memberId')) {
      const guardian = await db.doc(`orgs/${orgId}/members/${member.get('guardian.memberId')}`).get();
      if (guardian.get('whatsappOptOut')) return { skip: 'The guardian asked not to get WhatsApp messages' };
      phone = (guardian.get('phone') as string | null) ?? null;
    }
    const to = waNumber(phone);
    if (!to) return { skip: 'No mobile number' };
    const name = member.get('fullName') as string;
    const vars: Record<string, string> = { member_name: first(name), member_code: member.get('code') as string };
    return { to, name, vars };
  }
  if (uid) {
    const emp = await db.collection(`orgs/${orgId}/employees`).where('uid', '==', uid).limit(1).get();
    const e = emp.docs[0];
    const to = waNumber(e?.get('phone') as string | undefined);
    if (!e || !to) return { skip: 'No mobile number on the employee record' };
    const name = e.get('fullName') as string;
    const vars: Record<string, string> = { employee_name: first(name) };
    return { to, name, vars };
  }
  return { skip: 'No recipient' };
}

/**
 * The branch whose WhatsApp number sends a staff notice: the employee's own
 * branch, or (head-office staff) the first branch that sends staff notices.
 */
async function staffBranch(orgId: string, uid: string | null, event: string): Promise<string | null> {
  if (!uid) return null;
  const emp = await db.collection(`orgs/${orgId}/employees`).where('uid', '==', uid).limit(1).get();
  const own = (emp.docs[0]?.get('branchId') as string | null | undefined) ?? null;
  if (own) return own;
  const board = (await switchboardRef(orgId).get()).get('branches') as Record<string, string[]> | undefined;
  return Object.entries(board ?? {}).find(([, events]) => events.includes(event))?.[0] ?? null;
}

/** The branch can't send this event at all (WhatsApp not set up, switched off, or the event is off): nothing to keep. */
const NOT_SENDABLE = new Set(['WHATSAPP_NOT_CONFIGURED', 'WHATSAPP_DISABLED', 'NOT_FOUND']);

/**
 * Sends one queued message (safe to run more than once: only QUEUED messages
 * are sent). Messages for a branch without WhatsApp, or an event it has
 * switched off, are deleted; anything that can't go out is kept as SKIPPED or
 * FAILED with the reason, for the branch's message log. A message is never
 * left SENDING: an unexpected error marks it FAILED (and is rethrown for the logs).
 */
export async function deliver(orgId: string, outboxId: string) {
  const ref = outboxCol(orgId).doc(outboxId);
  const claimed = await db.runTransaction(async (tx) => {
    const m = await tx.get(ref);
    if (!m.exists || m.get('status') !== 'QUEUED') return null;
    tx.update(ref, { status: 'SENDING', attemptAt: FieldValue.serverTimestamp() });
    return m;
  });
  if (!claimed) return 'NOT_QUEUED';
  const event = claimed.get('event') as string;
  try {
    if (!eventFor(event)) {
      await ref.delete();
      return 'DROPPED';
    }
    const branchId = (claimed.get('branchId') as string | null) ?? (await staffBranch(orgId, claimed.get('uid') as string | null, event));
    let conn;
    try {
      if (!branchId) throw new AppError('not-found', 'NOT_FOUND', 'No branch');
      conn = await loadConnection(orgId, branchId);
    } catch (e) {
      if (!(e instanceof AppError && NOT_SENDABLE.has((e.details as { reason?: string }).reason ?? ''))) throw e;
      // WhatsApp is not set up (or is off) for this branch: nothing to send or keep.
      await ref.delete();
      return 'DROPPED';
    }
    const template = templateOf(await templateRef(orgId, branchId, event).get(), event, conn.settings.language);
    if (!template.enabled) {
      await ref.delete();
      return 'DROPPED';
    }
    const who = await recipient(orgId, claimed);
    if ('skip' in who) {
      await ref.update({ status: 'SKIPPED', error: who.skip });
      return 'SKIPPED';
    }
    const values: Record<string, string> = {
      branch_name: (conn.branch.get('name') as string) ?? '',
      ...who.vars,
      ...((claimed.get('vars') as Record<string, string>) ?? {}),
    };
    const params = placeholders(template.body).map((k) => values[k] ?? '');
    try {
      const wamid = await sendTemplate(conn, who.to, template, params);
      await ref.update({ status: 'SENT', wamid, toMasked: mask(who.to), recipientName: who.name, templateName: template.name, sentAt: FieldValue.serverTimestamp(), error: null });
      return 'SENT';
    } catch (e) {
      if (!(e instanceof MetaError)) throw e;
      await ref.update({ status: 'FAILED', toMasked: mask(who.to), recipientName: who.name, templateName: template.name, error: e.message });
      logger.warn('whatsapp: Meta refused a message', { orgId, outboxId, event, metaCode: e.code, status: e.status });
      return 'FAILED';
    }
  } catch (e) {
    logger.error('whatsapp: sending failed', { orgId, outboxId, event, error: e instanceof Error ? e.message : String(e) });
    await ref.update({ status: 'FAILED', error: 'Could not send (an error on our side). It was not retried.' }).catch(() => undefined);
    throw e;
  }
}

/** A message waits this long for its trigger before the maintenance job sends it. */
const QUEUED_GRACE_MS = 10 * 60_000;
/** A send interrupted for this long is marked failed (not resent: it may have gone out). */
const SENDING_GRACE_MS = 15 * 60_000;

/**
 * Safety net run by the maintenance job: sends messages whose trigger never
 * ran (still QUEUED after 10 minutes) and closes sends that were interrupted
 * (SENDING after 15 minutes) as FAILED rather than risk a duplicate.
 */
export async function reapOutbox(now = Date.now()) {
  const queued = await sweep(
    'whatsapp.reapQueued',
    db.collectionGroup('whatsappOutbox').where('status', '==', 'QUEUED').where('at', '<=', Timestamp.fromMillis(now - QUEUED_GRACE_MS)),
    async (doc) => (await deliver(doc.ref.parent.parent!.id, doc.id)) !== 'NOT_QUEUED',
    { concurrency: 4, budgetMs: 120_000 },
  );
  const stuck = await sweep(
    'whatsapp.reapSending',
    db.collectionGroup('whatsappOutbox').where('status', '==', 'SENDING').where('attemptAt', '<=', Timestamp.fromMillis(now - SENDING_GRACE_MS)),
    (doc) =>
      db.runTransaction(async (tx) => {
        const m = await tx.get(doc.ref);
        if (m.get('status') !== 'SENDING') return false;
        tx.update(doc.ref, { status: 'FAILED', error: 'Sending was interrupted. It was not retried, in case the message went out.' });
        return true;
      }),
    { budgetMs: 60_000 },
  );
  return { resent: queued.changed, closed: stuck.changed };
}

/** Sends each message as soon as it is queued (functions/src/index.ts deploys it). */
export const sendQueued = onDocumentCreated({ document: 'orgs/{orgId}/whatsappOutbox/{id}', region: REGION, retry: false }, async (e) => {
  await deliver(e.params.orgId, e.params.id);
});

// ------------------------------------------------------------------ webhook

const STATUS_RANK: Record<string, number> = { sent: 1, delivered: 2, read: 3, failed: 4 };

/**
 * Meta's webhook for a branch (…/whatsappWebhook?o=<orgId>&b=<branchId>):
 * GET answers Meta's verification with the branch's verify token; POST
 * records delivery updates (delivered, read, failed) on the message log and
 * honours STOP replies by switching WhatsApp off for that number's members.
 * When the branch saved its app secret, the X-Hub-Signature-256 header must match.
 */
export async function handleWebhook(req: Request, res: { status: (n: number) => { send: (b?: unknown) => void } }) {
  const orgId = String(req.query.o ?? '');
  const branchId = String(req.query.b ?? '');
  if (!orgId || !branchId) return res.status(400).send('missing branch');
  let conn;
  try {
    conn = await loadConnection(orgId, branchId, { requireEnabled: false });
  } catch {
    return res.status(404).send('unknown branch');
  }
  if (req.method === 'GET') {
    const ok = req.query['hub.mode'] === 'subscribe' && safeEqual(String(req.query['hub.verify_token'] ?? ''), conn.verifyToken);
    return ok ? res.status(200).send(String(req.query['hub.challenge'] ?? '')) : res.status(403).send('bad verify token');
  }
  const signature = req.headers['x-hub-signature-256'];
  if (conn.appSecret && !verifyMetaSignature(req.rawBody, Array.isArray(signature) ? signature[0] : signature, conn.appSecret)) {
    logger.warn('whatsapp webhook: bad signature', { orgId, branchId });
    return res.status(401).send('bad signature');
  }
  if (!conn.appSecret) logger.warn('whatsapp webhook: accepted without a signature check (no app secret saved for this branch)', { orgId, branchId });

  type Value = {
    event?: string;
    message_template_id?: number | string;
    message_template_name?: string;
    reason?: string | null; statuses?: { id: string; status: string; errors?: { title?: string; message?: string }[] }[]; messages?: { from: string; text?: { body?: string } }[] };
  let body: { entry?: { changes?: { field?: string; value?: Value }[] }[] };
  try {
    body = JSON.parse(req.rawBody.toString('utf8'));
  } catch {
    return res.status(400).send('bad json');
  }
  for (const change of body.entry?.flatMap((e) => e.changes ?? []) ?? []) {
    for (const s of change.value?.statuses ?? []) {
      const found = await outboxCol(orgId).where('wamid', '==', s.id).limit(1).get();
      const doc = found.docs[0];
      if (!doc) continue;
      const now = (STATUS_RANK[String(doc.get('status')).toLowerCase()] ?? 0);
      if ((STATUS_RANK[s.status] ?? 0) <= now && s.status !== 'failed') continue;
      await doc.ref.update({
        status: s.status.toUpperCase(),
        [`${s.status}At`]: FieldValue.serverTimestamp(),
        ...(s.status === 'failed' ? { error: s.errors?.[0]?.message ?? s.errors?.[0]?.title ?? 'Delivery failed' } : {}),
      });
    }
    // Meta's review of a template (field "message_template_status_update"): update every branch using it.
    if (change.field === 'message_template_status_update' && change.value?.message_template_id) {
      await applyTemplateStatus(orgId, String(change.value.message_template_id), change.value.event ?? '', change.value.reason ?? null);
    }
    for (const msg of change.value?.messages ?? []) {
      if ((msg.text?.body ?? '').trim().toUpperCase() !== 'STOP') continue;
      const members = await db.collection(`orgs/${orgId}/members`).where('phone', '==', `+${msg.from}`).limit(10).get();
      await Promise.all(members.docs.map((d) => d.ref.update({ whatsappOptOut: true, updatedAt: FieldValue.serverTimestamp() })));
    }
  }
  return res.status(200).send('ok');
}

/** Records Meta's decision on a template (APPROVED, REJECTED, PAUSED…) on each branch template that uses it. */
async function applyTemplateStatus(orgId: string, metaId: string, event: string, reason: string | null) {
  if (!event) return;
  const branches = await db.collection(`orgs/${orgId}/branches`).select().get();
  for (const b of branches.docs) {
    const found = await b.ref.collection('whatsappTemplates').where('metaId', '==', metaId).get();
    await Promise.all(
      found.docs.map((d) =>
        d.ref.update({ status: event.toUpperCase(), reason: reason && reason !== 'NONE' ? reason : null, syncedAt: FieldValue.serverTimestamp() }),
      ),
    );
  }
}

// ------------------------------------------------------------------ renewal reminders

/** Days before a plan ends that the member is reminded (once each). */
export const REMINDER_DAYS = [7, 1];

/**
 * Queues renewal reminders for plans ending `days` days after the hour that
 * starts at `hour` (the hourly sweep passes its scheduled hour, so consecutive
 * runs cover back-to-back windows with no gap or overlap). Each reminder has a
 * fixed id per plan and threshold, so a re-run or overlapping run never sends
 * it twice. Plans already renewed (a pre-paid next term) are skipped.
 */
export async function queueRenewalReminders(hour = new Date()): Promise<number> {
  const start = Math.floor(hour.getTime() / 3_600_000) * 3_600_000;
  let queued = 0;
  for (const days of REMINDER_DAYS) {
    const from = Timestamp.fromMillis(start + days * 86_400_000);
    const to = Timestamp.fromMillis(from.toMillis() + 3_600_000);
    const due = db.collectionGroup('subscriptions').where('status', '==', 'ACTIVE').where('endAt', '>=', from).where('endAt', '<', to);
    const run = await sweep(`renewalReminders.${days}d`, due, async (s) => {
      const orgId = s.ref.parent.parent!.id;
      const member = await db.doc(`orgs/${orgId}/members/${s.get('memberId')}`).get();
      if (!member.exists || member.get('nextSubscriptionId') || member.get('activeSubscriptionId') !== s.id) return false;
      const batch = db.batch();
      const queuedNow = queueWhatsApp(batch, {
        id: `renewal_${s.id}_${days}d`,
        orgId,
        branchId: s.get('branchId') as string,
        event: 'renewal_reminder',
        memberId: s.get('memberId') as string,
        vars: { plan_name: s.get('planSnapshot.name') as string, valid_until: dateIN(s.get('endAt').toDate()), days_left: String(days) },
        ref: { subscriptionId: s.id },
      });
      if (!queuedNow) return false;
      try {
        await batch.commit();
        return true;
      } catch (e) {
        if ((e as { code?: unknown }).code === 6) return false; // ALREADY_EXISTS: reminded before
        throw e;
      }
    });
    queued += run.changed;
  }
  return queued;
}
