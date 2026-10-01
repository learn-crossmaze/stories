import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import type { Request } from 'firebase-functions/v2/https';

import { db, REGION } from '../core/firebase.js';
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

/**
 * Sends one queued message (safe to run more than once: only QUEUED messages
 * are sent). Messages for a branch without WhatsApp, or an event it has
 * switched off, are deleted; anything that can't go out is kept as SKIPPED or
 * FAILED with the reason, for the branch's message log.
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
  const branchId = (claimed.get('branchId') as string | null) ?? (await staffBranch(orgId, claimed.get('uid') as string | null, event));
  let conn;
  try {
    if (!branchId) throw new Error('no branch');
    conn = await loadConnection(orgId, branchId);
  } catch {
    // WhatsApp is not set up (or is off) for this branch: nothing to send or keep.
    await ref.delete();
    return 'DROPPED';
  }
  const template = templateOf(await templateRef(orgId, branchId, event).get(), event, conn.settings.language);
  if (!template.enabled || !eventFor(event)) {
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
    const error = e instanceof MetaError ? e.message : 'Could not send';
    await ref.update({ status: 'FAILED', toMasked: mask(who.to), recipientName: who.name, templateName: template.name, error });
    if (!(e instanceof MetaError)) logger.error('whatsapp deliver', e);
    return 'FAILED';
  }
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
    const ok = req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === conn.verifyToken;
    return ok ? res.status(200).send(String(req.query['hub.challenge'] ?? '')) : res.status(403).send('bad verify token');
  }
  const signature = req.headers['x-hub-signature-256'];
  if (conn.appSecret && !verifyMetaSignature(req.rawBody, Array.isArray(signature) ? signature[0] : signature, conn.appSecret)) return res.status(401).send('bad signature');

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
 * Queues renewal reminders for plans ending `days` days from now, within the
 * next hour (the hourly sweep calls this, so each plan is reminded once per
 * threshold). Plans already renewed (a pre-paid next term) are skipped.
 */
export async function queueRenewalReminders(now = new Date()): Promise<number> {
  let queued = 0;
  for (const days of REMINDER_DAYS) {
    const from = Timestamp.fromMillis(now.getTime() + days * 86_400_000);
    const to = Timestamp.fromMillis(from.toMillis() + 3_600_000);
    const due = await db.collectionGroup('subscriptions').where('status', '==', 'ACTIVE').where('endAt', '>=', from).where('endAt', '<', to).limit(500).get();
    const batch = db.batch();
    for (const s of due.docs) {
      const orgId = s.ref.parent.parent!.id;
      const member = await db.doc(`orgs/${orgId}/members/${s.get('memberId')}`).get();
      if (!member.exists || member.get('nextSubscriptionId') || member.get('activeSubscriptionId') !== s.id) continue;
      queueWhatsApp(batch, {
        orgId,
        branchId: s.get('branchId') as string,
        event: 'renewal_reminder',
        memberId: s.get('memberId') as string,
        vars: { plan_name: s.get('planSnapshot.name') as string, valid_until: dateIN(s.get('endAt').toDate()), days_left: String(days) },
        ref: { subscriptionId: s.id },
      });
      queued++;
    }
    await batch.commit();
  }
  return queued;
}
