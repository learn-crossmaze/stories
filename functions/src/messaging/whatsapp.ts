import { createHmac, timingSafeEqual } from 'node:crypto';

import { FieldValue, Timestamp, type Transaction, type WriteBatch } from 'firebase-admin/firestore';

import { errors } from '../core/errors.js';
import { db } from '../core/firebase.js';
import { defaultTemplateName, eventFor } from './events.js';

/**
 * WhatsApp Cloud API (Meta), set up per branch (docs/WHATSAPP.md). Public
 * settings live on the branch document (`whatsapp`); the access token, app
 * secret and webhook verify token live in orgs/{o}/branches/{b}/private/whatsapp,
 * which no client can read. Messages go through orgs/{o}/whatsappOutbox
 * (queued in the same transaction as what they report, sent by a trigger).
 */
export const GRAPH = 'https://graph.facebook.com/v23.0';
const TIMEOUT_MS = 10_000;

export interface WhatsAppSettings {
  enabled: boolean;
  phoneNumberId: string;
  wabaId: string;
  displayPhone: string | null;
  verifiedName: string | null;
  hasAppSecret: boolean;
  /** Language of the templates unless one says otherwise, e.g. en, en_US, hi. */
  language: string;
}

export interface Template {
  event: string;
  enabled: boolean;
  /** Name of the approved template in Meta's WhatsApp Manager. */
  name: string;
  language: string;
  body: string;
  /** NOT_SUBMITTED, PENDING, APPROVED, REJECTED, PAUSED or DISABLED (Meta's review). */
  status: string;
  reason: string | null;
  metaId: string | null;
}

export const privateRef = (orgId: string, branchId: string) => db.doc(`orgs/${orgId}/branches/${branchId}/private/whatsapp`);
export const templateRef = (orgId: string, branchId: string, event: string) => db.doc(`orgs/${orgId}/branches/${branchId}/whatsappTemplates/${event}`);
/** Which events each branch sends: lets busy code skip queueing when WhatsApp is off. */
export const switchboardRef = (orgId: string) => db.doc(`orgs/${orgId}/config/whatsapp`);
export const outboxCol = (orgId: string) => db.collection(`orgs/${orgId}/whatsappOutbox`);

/** A branch's template for an event: its own, or the default wording (switched off). */
export function templateOf(snap: FirebaseFirestore.DocumentSnapshot | null, event: string, language: string): Template {
  const e = eventFor(event)!;
  const own = snap?.exists ? (snap.data() as Partial<Template>) : {};
  return {
    event,
    enabled: own.enabled ?? false,
    name: own.name ?? defaultTemplateName(event),
    language: own.language ?? language,
    body: own.body ?? e.body,
    status: own.status ?? 'NOT_SUBMITTED',
    reason: own.reason ?? null,
    metaId: own.metaId ?? null,
  };
}

/** A branch's settings and secrets (reads only). */
export async function loadConnection(orgId: string, branchId: string, opts: { requireEnabled?: boolean } = {}) {
  const [branch, secret] = await Promise.all([db.doc(`orgs/${orgId}/branches/${branchId}`).get(), privateRef(orgId, branchId).get()]);
  if (!branch.exists) throw errors.notFound('Branch');
  const settings = branch.get('whatsapp') as WhatsAppSettings | undefined;
  if (!settings?.phoneNumberId || !secret.exists) {
    throw errors.conflict('WHATSAPP_NOT_CONFIGURED', 'WhatsApp is not set up for this branch. Add it under Settings → WhatsApp.');
  }
  if (opts.requireEnabled !== false && !settings.enabled) throw errors.conflict('WHATSAPP_DISABLED', 'WhatsApp messages are switched off for this branch.');
  return {
    settings,
    branch,
    accessToken: secret.get('accessToken') as string,
    appSecret: (secret.get('appSecret') as string | null) ?? null,
    verifyToken: secret.get('verifyToken') as string,
  };
}
export type Connection = Awaited<ReturnType<typeof loadConnection>>;

/** Error raised by the Graph API, with Meta's own message (safe to show the branch admin). */
export class MetaError extends Error {
  constructor(
    readonly status: number,
    readonly code: number | string,
    message: string,
  ) {
    super(message);
  }
}

/** Calls the Graph API with the branch's access token. */
export async function graph<T>(token: string, method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${GRAPH}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new MetaError(0, 'NETWORK', "WhatsApp (Meta) didn't answer. Try again in a minute.");
  }
  const json = (await res.json().catch(() => ({}))) as { error?: { code?: number; error_subcode?: number; message?: string; error_user_msg?: string } };
  if (!res.ok) {
    const e = json.error ?? {};
    const id = path.split(/[/?]/)[1] ?? '';
    // "Object does not exist or missing permissions" (100/33) and permission errors (10, 200): the token can't reach that ID.
    const cantReach = (e.code === 100 && e.error_subcode === 33) || e.code === 10 || e.code === 200;
    const message =
      res.status === 401 || e.code === 190
        ? 'Meta rejected the access token (it may have expired). Create a permanent System User token and save it again.'
        : cantReach
          ? `Meta won't let this access token use ${id}. Check that the ID is right, and that in Business Settings → System users the token's user has your WhatsApp account under Assign assets (Full control) and the token has the whatsapp_business_management and whatsapp_business_messaging permissions.`
          : (e.error_user_msg ?? e.message ?? `Meta answered ${res.status}.`);
    throw new MetaError(res.status, cantReach ? 'NO_ACCESS' : (e.code ?? res.status), message);
  }
  return json as T;
}

/** Maps a Graph API failure to a user-facing error. */
export function metaError(e: unknown): never {
  if (e instanceof MetaError) throw errors.conflict('WHATSAPP_ERROR', `WhatsApp: ${e.message}`);
  throw e;
}

/** Indian mobile numbers as WhatsApp wants them: country code and digits, no '+'. */
export function waNumber(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const d = phone.replace(/\D/g, '');
  if (d.length === 10) return `91${d}`;
  if (d.length === 12 && d.startsWith('91')) return d;
  if (d.length >= 11 && d.length <= 15) return d;
  return null;
}

/** Sends an approved template (body parameters in order). Returns Meta's message id (wamid). */
export async function sendTemplate(conn: Pick<Connection, 'accessToken' | 'settings'>, to: string, template: Pick<Template, 'name' | 'language'>, params: string[]) {
  const res = await graph<{ messages?: { id: string }[] }>(conn.accessToken, 'POST', `/${conn.settings.phoneNumberId}/messages`, {
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: {
      name: template.name,
      language: { code: template.language },
      ...(params.length ? { components: [{ type: 'body', parameters: params.map((text) => ({ type: 'text', text: text || '-' })) }] } : {}),
    },
  });
  return res.messages?.[0]?.id ?? null;
}

/** Verifies X-Hub-Signature-256: sha256= HMAC of the raw body with the Meta app secret. */
export function verifyMetaSignature(rawBody: Buffer | string, header: string | undefined, secret: string): boolean {
  if (!header?.startsWith('sha256=') || !secret) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(header.slice(7), 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Paise as rupees for a message, e.g. ₹1,399 or ₹1,399.50. */
export const rupeesText = (minor: number) => `₹${(minor / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

// ------------------------------------------------------------------ queueing

/** Org → branch → events switched on, cached for a minute (the switchboard document). */
const cache = new Map<string, { at: number; branches: Record<string, string[]> }>();
const CACHE_MS = 60_000;

async function refresh(orgId: string) {
  try {
    const snap = await switchboardRef(orgId).get();
    cache.set(orgId, { at: Date.now(), branches: (snap.get('branches') as Record<string, string[]> | undefined) ?? {} });
  } catch {
    // Unknown stays unknown: messages are queued and the sender decides.
  }
}

/**
 * Whether an event may go out for a branch, from the cached switchboard. While
 * the cache is cold it says yes (the sender re-checks and drops what is off)
 * and warms up in the background, so organizations without WhatsApp stop
 * writing to the outbox after the first minute.
 */
export function wanted(orgId: string, branchId: string | null, event: string): boolean {
  const c = cache.get(orgId);
  if (!c || Date.now() - c.at > CACHE_MS) void refresh(orgId);
  if (!c) return true;
  // Staff notices carry no branch: the sender finds the employee's branch (or any branch sending them).
  if (!branchId) return Object.values(c.branches).some((events) => events.includes(event));
  return (c.branches[branchId] ?? []).includes(event);
}

/** For tests: forget the cached switchboard. */
export const clearSwitchboardCache = () => cache.clear();

export interface QueuedMessage {
  orgId: string;
  branchId: string | null;
  event: string;
  /** Who receives it: a member (their phone, or their guardian's) or a staff account. */
  memberId?: string;
  uid?: string;
  /** Values the event knows; the sender adds names, phone and branch. */
  vars?: Record<string, string>;
  /** What it is about, e.g. { loanIds } or { subscriptionId } (for the log). */
  ref?: Record<string, string | string[] | null>;
}

/**
 * Queues a WhatsApp message in the caller's transaction or batch (writes only),
 * so it goes out exactly when the change it reports commits.
 */
export function queueWhatsApp(writer: Transaction | WriteBatch, m: QueuedMessage) {
  if (!wanted(m.orgId, m.branchId, m.event)) return;
  (writer as Transaction).create(outboxCol(m.orgId).doc(), {
    branchId: m.branchId,
    event: m.event,
    memberId: m.memberId ?? null,
    uid: m.uid ?? null,
    vars: m.vars ?? {},
    ref: m.ref ?? null,
    status: 'QUEUED',
    at: FieldValue.serverTimestamp(),
    expireAt: Timestamp.fromMillis(Date.now() + 90 * 86_400_000),
  });
}
