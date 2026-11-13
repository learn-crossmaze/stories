import { randomBytes } from 'node:crypto';

import { FieldValue, type Transaction } from 'firebase-admin/firestore';
import { z } from 'zod';

import { recordAudit } from '../core/audit.js';
import type { Actor } from '../core/rbac.js';
import { command, query } from '../core/callable.js';
import { errors } from '../core/errors.js';
import { db } from '../core/firebase.js';
import { id } from '../core/schemas.js';
import { EVENT_KEYS, EVENTS, eventFor, metaBody, placeholders, tooFewWords } from './events.js';
import {
  graph,
  loadConnection,
  MetaError,
  metaError,
  outboxCol,
  privateRef,
  sendTemplate,
  switchboardRef,
  type Template,
  templateOf,
  templateRef,
  waNumber,
  type WhatsAppSettings,
} from './whatsapp.js';

// Settings → WhatsApp, per branch: the connection (three values from Meta),
// one template per event, test sends and the message log (docs/WHATSAPP.md).

const LANGUAGE = z.string().trim().regex(/^[a-z]{2,3}(_[A-Z]{2})?$/, 'must be a WhatsApp language code such as en, en_US or hi');
const branchInput = { orgId: id, branchId: id };

async function requireBranch(actor: Actor, orgId: string, branchId: string, tx?: Transaction) {
  await actor.require('messaging.manage', orgId, branchId, tx);
  const ref = db.doc(`orgs/${orgId}/branches/${branchId}`);
  const branch = tx ? await tx.get(ref) : await ref.get();
  if (!branch.exists || branch.get('status') !== 'ACTIVE') throw errors.notFound('Branch');
  return branch;
}

const templatesCol = (orgId: string, branchId: string) => db.collection(`orgs/${orgId}/branches/${branchId}/whatsappTemplates`);

/** The switchboard entry of a branch: the events switched on, or none while the branch's sending is off. */
const writeSwitchboard = (tx: Transaction, orgId: string, branchId: string, settingsOn: boolean, on: Iterable<string>) =>
  tx.set(switchboardRef(orgId), { branches: { [branchId]: settingsOn ? [...on].sort() : [] } }, { merge: true });

/**
 * Rewrites the switchboard entry for a branch (events that may go out), from
 * its connection and templates. Reads first: call before other writes.
 */
async function planSwitchboard(tx: Transaction, orgId: string, branchId: string, override?: { enabled?: boolean; template?: Pick<Template, 'event' | 'enabled'> }) {
  const [branch, templates] = await Promise.all([tx.get(db.doc(`orgs/${orgId}/branches/${branchId}`)), tx.get(templatesCol(orgId, branchId))]);
  const settingsOn = override?.enabled ?? (branch.get('whatsapp.enabled') as boolean | undefined) ?? false;
  const on = new Set(templates.docs.filter((d) => d.get('enabled')).map((d) => d.id));
  if (override?.template) {
    if (override.template.enabled) on.add(override.template.event);
    else on.delete(override.template.event);
  }
  return () => writeSwitchboard(tx, orgId, branchId, settingsOn, on);
}

/** Where Meta should send delivery updates and replies for this branch. */
const webhookPath = (orgId: string, branchId: string) => `whatsappWebhook?o=${encodeURIComponent(orgId)}&b=${encodeURIComponent(branchId)}`;

/** The branch's WhatsApp page: connection (no secrets), every event with its template, and the webhook details. */
export const overview = query('whatsapp-overview', z.strictObject(branchInput), async ({ actor, input }) => {
  const branch = await requireBranch(actor, input.orgId, input.branchId);
  const [secret, templates] = await Promise.all([
    privateRef(input.orgId, input.branchId).get(),
    templatesCol(input.orgId, input.branchId).get(),
  ]);
  const settings = (branch.get('whatsapp') as WhatsAppSettings | undefined) ?? null;
  const language = settings?.language ?? 'en';
  return {
    settings,
    webhook: settings ? { path: webhookPath(input.orgId, input.branchId), verifyToken: (secret.get('verifyToken') as string | undefined) ?? null } : null,
    events: EVENTS.map((e) => {
      const snap = templates.docs.find((d) => d.id === e.key) ?? null;
      // "Added": the branch has set this notification up (it shows in its list).
      return { ...e, added: !!snap, template: templateOf(snap, e.key, language) };
    }),
  };
});

/**
 * Saves the branch's connection: Phone number ID, WhatsApp Business Account ID
 * and a permanent access token (write-only: leave blank to keep the saved one),
 * plus the app secret for verifying webhooks. The values are checked with Meta
 * first; the number's display name and phone are stored for the page.
 */
/** What Meta confirmed before the save (saveConnection's prepare step). */
interface VerifiedConnection {
  accessToken: string;
  appSecret: string;
  number: { display_phone_number?: string; verified_name?: string };
}

export const saveConnection = command(
  'whatsapp-saveConnection',
  z.strictObject({
    ...branchInput,
    enabled: z.boolean(),
    phoneNumberId: z.string().trim().regex(/^\d{6,20}$/, 'must be the numeric Phone number ID from WhatsApp → API Setup'),
    wabaId: z.string().trim().regex(/^\d{6,20}$/, 'must be the numeric WhatsApp Business Account ID'),
    accessToken: z.string().trim().max(1000).default(''),
    appSecret: z.string().trim().max(100).default(''),
    language: LANGUAGE.default('en'),
  }),
  async ({ actor, input, requestId, prepared }, tx) => {
    const branch = await requireBranch(actor, input.orgId, input.branchId, tx);
    const secret = await tx.get(privateRef(input.orgId, input.branchId));
    const { accessToken, appSecret, number } = prepared as VerifiedConnection;
    const switchboard = await planSwitchboard(tx, input.orgId, input.branchId, { enabled: input.enabled });
    const before = (branch.get('whatsapp') as WhatsAppSettings | undefined) ?? null;
    const settings: WhatsAppSettings & Record<string, unknown> = {
      enabled: input.enabled,
      phoneNumberId: input.phoneNumberId,
      wabaId: input.wabaId,
      displayPhone: number.display_phone_number ?? null,
      verifiedName: number.verified_name ?? null,
      hasAppSecret: !!appSecret,
      language: input.language,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: actor.uid,
    };
    tx.update(branch.ref, { whatsapp: settings, updatedAt: FieldValue.serverTimestamp() });
    tx.set(privateRef(input.orgId, input.branchId), {
      accessToken,
      appSecret: appSecret || null,
      // The token Meta echoes when it checks the webhook URL (shown on the page; not a secret that grants access).
      verifyToken: (secret.get('verifyToken') as string | undefined) ?? randomBytes(16).toString('hex'),
      updatedAt: FieldValue.serverTimestamp(),
    });
    switchboard();
    recordAudit(tx, { actorUid: actor.uid, actorEmail: actor.email, requestId }, input.orgId, {
      action: 'branch.whatsapp',
      entityType: 'branch',
      entityId: input.branchId,
      branchId: input.branchId,
      before: before ? { enabled: before.enabled, phoneNumberId: before.phoneNumberId, wabaId: before.wabaId } : null,
      after: { enabled: input.enabled, phoneNumberId: input.phoneNumberId, wabaId: input.wabaId, tokenChanged: !!input.accessToken, appSecretChanged: !!input.appSecret },
    });
    return { displayPhone: settings.displayPhone, verifiedName: settings.verifiedName };
  },
  null,
  {
    // Meta is asked before the transaction (it can take seconds and must not repeat on contention).
    prepare: async ({ actor, input }) => {
      await requireBranch(actor, input.orgId, input.branchId);
      const secret = await privateRef(input.orgId, input.branchId).get();
      const accessToken = input.accessToken || ((secret.get('accessToken') as string | undefined) ?? '');
      if (!accessToken) throw errors.invalid('Paste the permanent access token (System User token) from Meta Business Settings.');
      const appSecret = input.appSecret || ((secret.get('appSecret') as string | undefined) ?? '');
      try {
        const number = await graph<{ display_phone_number?: string; verified_name?: string }>(accessToken, 'GET', `/${input.phoneNumberId}?fields=display_phone_number,verified_name`);
        // Templates are managed through the business account: check the token can use it and the number belongs to it.
        const numbers = await graph<{ data?: { id: string }[] }>(accessToken, 'GET', `/${input.wabaId}/phone_numbers?fields=id`);
        if (!numbers.data?.some((n) => n.id === input.phoneNumberId)) {
          throw errors.invalid('This Phone number ID is not in that WhatsApp Business Account. Copy both IDs from WhatsApp → API Setup in your Meta app.');
        }
        return { accessToken, appSecret, number } satisfies VerifiedConnection;
      } catch (e) {
        return metaError(e);
      }
    },
  },
);

const templateName = z.string().trim().regex(/^[a-z0-9_]{1,512}$/, 'must use only lower-case letters, digits and underscores');

/**
 * Saves one event's template for the branch: on/off, wording (with
 * {{variable}} placeholders from the event), language and the Meta template
 * name. Changing the wording or name means it has to be approved again.
 */
export const saveTemplate = command(
  'whatsapp-saveTemplate',
  z.strictObject({
    ...branchInput,
    event: z.enum(EVENT_KEYS),
    enabled: z.boolean(),
    name: templateName,
    language: LANGUAGE,
    body: z.string().trim().min(10).max(1024),
  }),
  async ({ actor, input, requestId }, tx) => {
    const branch = await requireBranch(actor, input.orgId, input.branchId, tx);
    const event = eventFor(input.event)!;
    const unknown = placeholders(input.body).filter((k) => !event.variables.some((v) => v.key === k));
    if (unknown.length) throw errors.invalid(`This message can't use {{${unknown[0]}}}. Use: ${event.variables.map((v) => `{{${v.key}}}`).join(', ')}.`);
    if (/^\s*\{\{|\}\}\s*$/.test(input.body)) throw errors.invalid("Meta doesn't accept a message that starts or ends with a {{variable}}. Add a word before or after it.");
    const ref = templateRef(input.orgId, input.branchId, input.event);
    const snap = await tx.get(ref);
    const switchboard = await planSwitchboard(tx, input.orgId, input.branchId, { template: { event: input.event, enabled: input.enabled } });
    const current = templateOf(snap, input.event, (branch.get('whatsapp.language') as string | undefined) ?? 'en');
    // Checked when the wording changes (switching an older template on or off still works).
    const short = current.body !== input.body || !snap.exists ? tooFewWords(input.body) : null;
    if (short) throw errors.invalid(short);
    const changed = current.body !== input.body || current.name !== input.name || current.language !== input.language;
    tx.set(ref, {
      event: input.event,
      enabled: input.enabled,
      name: input.name,
      language: input.language,
      body: input.body,
      status: changed ? 'NOT_SUBMITTED' : current.status,
      reason: changed ? null : current.reason,
      metaId: current.name === input.name && current.language === input.language ? current.metaId : null,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: actor.uid,
    });
    switchboard();
    recordAudit(tx, { actorUid: actor.uid, actorEmail: actor.email, requestId }, input.orgId, {
      action: 'whatsapp.template',
      entityType: 'branch',
      entityId: input.branchId,
      branchId: input.branchId,
      after: { event: input.event, enabled: input.enabled, name: input.name, language: input.language, changed },
    });
    return { status: changed ? 'NOT_SUBMITTED' : current.status };
  },
);

const eventList = z.array(z.enum(EVENT_KEYS)).min(1).max(EVENT_KEYS.length);

/**
 * Adds several notifications to the branch's list in one go, each with the
 * default wording and template name, switched off and not yet sent to Meta.
 * One the branch already has (possibly reworded) is left as it is.
 */
export const addTemplates = command('whatsapp-addTemplates', z.strictObject({ ...branchInput, events: eventList }), async ({ actor, input, requestId }, tx) => {
  const branch = await requireBranch(actor, input.orgId, input.branchId, tx);
  const have = new Set((await tx.get(templatesCol(input.orgId, input.branchId))).docs.map((d) => d.id));
  const added = EVENT_KEYS.filter((k) => input.events.includes(k) && !have.has(k));
  if (!added.length) return { added };
  const language = (branch.get('whatsapp.language') as string | undefined) ?? 'en';
  // Nothing is switched on, so the switchboard stays as it is.
  for (const event of added) {
    tx.create(templateRef(input.orgId, input.branchId, event), { ...templateOf(null, event, language), updatedAt: FieldValue.serverTimestamp(), updatedBy: actor.uid });
  }
  recordAudit(tx, { actorUid: actor.uid, actorEmail: actor.email, requestId }, input.orgId, {
    action: 'whatsapp.template.add',
    entityType: 'branch',
    entityId: input.branchId,
    branchId: input.branchId,
    after: { events: added },
  });
  return { added };
});

/**
 * Switches several of the branch's notifications on or off in one go. Only
 * notifications the branch has added are touched; the rest are ignored.
 */
export const switchTemplates = command(
  'whatsapp-switchTemplates',
  z.strictObject({ ...branchInput, events: eventList, enabled: z.boolean() }),
  async ({ actor, input, requestId }, tx) => {
    const branch = await requireBranch(actor, input.orgId, input.branchId, tx);
    const templates = await tx.get(templatesCol(input.orgId, input.branchId));
    const change = templates.docs.filter((d) => input.events.includes(d.id) && !!d.get('enabled') !== input.enabled);
    const switched = change.map((d) => d.id).sort();
    if (!switched.length) return { switched };
    const on = templates.docs.filter((d) => (switched.includes(d.id) ? input.enabled : !!d.get('enabled'))).map((d) => d.id);
    for (const d of change) tx.update(d.ref, { enabled: input.enabled, updatedAt: FieldValue.serverTimestamp(), updatedBy: actor.uid });
    writeSwitchboard(tx, input.orgId, input.branchId, (branch.get('whatsapp.enabled') as boolean | undefined) ?? false, on);
    recordAudit(tx, { actorUid: actor.uid, actorEmail: actor.email, requestId }, input.orgId, {
      action: 'whatsapp.template.switch',
      entityType: 'branch',
      entityId: input.branchId,
      branchId: input.branchId,
      after: { events: switched, enabled: input.enabled },
    });
    return { switched };
  },
);

/**
 * Removes a notification from the branch's list: it stops being sent. The
 * template stays in Meta's WhatsApp Manager (delete it there if wanted).
 */
export const removeTemplate = command('whatsapp-removeTemplate', z.strictObject({ ...branchInput, event: z.enum(EVENT_KEYS) }), async ({ actor, input, requestId }, tx) => {
  await requireBranch(actor, input.orgId, input.branchId, tx);
  const ref = templateRef(input.orgId, input.branchId, input.event);
  const snap = await tx.get(ref);
  if (!snap.exists) return { removed: false };
  const switchboard = await planSwitchboard(tx, input.orgId, input.branchId, { template: { event: input.event, enabled: false } });
  tx.delete(ref);
  switchboard();
  recordAudit(tx, { actorUid: actor.uid, actorEmail: actor.email, requestId }, input.orgId, {
    action: 'whatsapp.template.remove',
    entityType: 'branch',
    entityId: input.branchId,
    branchId: input.branchId,
    before: { event: input.event, name: snap.get('name') as string, enabled: !!snap.get('enabled') },
  });
  return { removed: true };
});

/**
 * Sends the template to Meta for approval (or updates the one Meta already
 * has). Meta reviews utility templates in minutes to a few hours; "Check
 * approvals" (whatsapp-syncTemplates) picks up the result.
 */
export const submitTemplate = query('whatsapp-submitTemplate', z.strictObject({ ...branchInput, event: z.enum(EVENT_KEYS) }), async ({ actor, input }) => {
  await requireBranch(actor, input.orgId, input.branchId);
  const conn = await loadConnection(input.orgId, input.branchId, { requireEnabled: false });
  const ref = templateRef(input.orgId, input.branchId, input.event);
  const t = templateOf(await ref.get(), input.event, conn.settings.language);
  const event = eventFor(input.event)!;
  const short = tooFewWords(t.body);
  if (short) throw errors.invalid(`${short} Open the message and add words, then submit again.`);
  const keys = placeholders(t.body);
  const samples = keys.map((k) => event.variables.find((v) => v.key === k)!.sample);
  const component = { type: 'BODY', text: metaBody(t.body), ...(keys.length ? { example: { body_text: [samples] } } : {}) };
  const create = () => graph<{ id?: string; status?: string }>(conn.accessToken, 'POST', `/${conn.settings.wabaId}/message_templates`, { name: t.name, language: t.language, category: 'UTILITY', components: [component] });
  let res: { id?: string; status?: string; success?: boolean };
  try {
    try {
      res = t.metaId ? await graph(conn.accessToken, 'POST', `/${t.metaId}`, { components: [component] }) : await create();
    } catch (e) {
      // The template Meta had is gone (deleted, or made under another account): submit it afresh.
      if (!(t.metaId && e instanceof MetaError && e.code === 'NO_ACCESS')) throw e;
      res = await create();
    }
  } catch (e) {
    metaError(e);
  }
  const status = res.status ?? 'PENDING';
  await ref.set({ ...t, status, reason: null, metaId: res.id ?? t.metaId, submittedAt: FieldValue.serverTimestamp() }, { merge: true });
  return { status };
});

/** Reads every template's review status from Meta and updates the branch's templates (matched by name and language). */
export const syncTemplates = query('whatsapp-syncTemplates', z.strictObject(branchInput), async ({ actor, input }) => {
  await requireBranch(actor, input.orgId, input.branchId);
  const conn = await loadConnection(input.orgId, input.branchId, { requireEnabled: false });
  let list: { data: { id: string; name: string; language: string; status: string; rejected_reason?: string }[] };
  try {
    list = await graph(conn.accessToken, 'GET', `/${conn.settings.wabaId}/message_templates?fields=id,name,language,status,rejected_reason&limit=250`);
  } catch (e) {
    metaError(e);
  }
  const snaps = await templatesCol(input.orgId, input.branchId).get();
  const batch = db.batch();
  const result: Record<string, string> = {};
  const missing: string[] = [];
  for (const e of EVENTS) {
    const t = templateOf(snaps.docs.find((d) => d.id === e.key) ?? null, e.key, conn.settings.language);
    const found = list.data.find((m) => m.name === t.name && m.language === t.language);
    if (!found) {
      // Submitted earlier but not in this business account (sent with another token or account): submit again.
      if (t.status !== 'NOT_SUBMITTED') {
        missing.push(e.key);
        batch.set(templateRef(input.orgId, input.branchId, e.key), { ...t, status: 'NOT_SUBMITTED', reason: null, metaId: null, syncedAt: FieldValue.serverTimestamp() }, { merge: true });
      }
      continue;
    }
    result[e.key] = found.status;
    batch.set(
      templateRef(input.orgId, input.branchId, e.key),
      { ...t, status: found.status, reason: found.rejected_reason && found.rejected_reason !== 'NONE' ? found.rejected_reason : null, metaId: found.id, syncedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
  }
  await batch.commit();
  return { statuses: result, found: list.data.length, missing };
});

/**
 * Sends a test message to a number: an event's template filled with sample
 * values, or Meta's built-in hello_world template to check the connection.
 */
export const sendTest = query(
  'whatsapp-sendTest',
  z.strictObject({ ...branchInput, to: z.string().trim().min(10).max(20), event: z.enum(EVENT_KEYS).nullable().default(null) }),
  async ({ actor, input }) => {
    await requireBranch(actor, input.orgId, input.branchId);
    const conn = await loadConnection(input.orgId, input.branchId, { requireEnabled: false });
    const to = waNumber(input.to);
    if (!to) throw errors.invalid('Enter a mobile number, e.g. 98765 43210.');
    let template: { name: string; language: string } = { name: 'hello_world', language: 'en_US' };
    let params: string[] = [];
    if (input.event) {
      const t = templateOf(await templateRef(input.orgId, input.branchId, input.event).get(), input.event, conn.settings.language);
      const event = eventFor(input.event)!;
      template = t;
      params = placeholders(t.body).map((k) => event.variables.find((v) => v.key === k)!.sample);
    }
    try {
      return { wamid: await sendTemplate(conn, to, template, params) };
    } catch (e) {
      metaError(e);
    }
  },
);

/** The branch's latest messages and what happened to each (queued, sent, delivered, read, failed, skipped). */
export const log = query('whatsapp-log', z.strictObject({ ...branchInput, limit: z.number().int().min(1).max(100).default(50) }), async ({ actor, input }) => {
  await requireBranch(actor, input.orgId, input.branchId);
  const snap = await outboxCol(input.orgId).where('branchId', '==', input.branchId).orderBy('at', 'desc').limit(input.limit).get();
  return {
    messages: snap.docs.map((d) => ({
      id: d.id,
      event: d.get('event') as string,
      to: (d.get('toMasked') as string | null) ?? null,
      recipient: (d.get('recipientName') as string | null) ?? null,
      status: d.get('status') as string,
      error: (d.get('error') as string | null) ?? null,
      at: d.get('at')?.toDate().toISOString() ?? null,
    })),
  };
});
