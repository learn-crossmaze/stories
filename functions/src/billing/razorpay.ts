import { createHmac, timingSafeEqual } from 'node:crypto';

import type { DocumentSnapshot, Transaction } from 'firebase-admin/firestore';

import { errors } from '../core/errors.js';
import { db } from '../core/firebase.js';

/**
 * Razorpay, configured per branch (each branch may use its own Razorpay
 * account). Public settings live on the branch document (`payments.razorpay`);
 * the key secret and webhook secret live in
 * orgs/{o}/branches/{b}/private/razorpay, which no client can read (Security
 * Rules deny it) — only these functions use them.
 */
export const API = 'https://api.razorpay.com/v1';
const TIMEOUT_MS = 10_000;

export interface GatewaySettings {
  enabled: boolean;
  keyId: string;
  mode: 'test' | 'live';
  notifySms: boolean;
  notifyEmail: boolean;
  hasWebhookSecret: boolean;
}

export interface Credentials {
  keyId: string;
  keySecret: string;
  webhookSecret: string | null;
  settings: GatewaySettings;
}

export const privateRef = (orgId: string, branchId: string) => db.doc(`orgs/${orgId}/branches/${branchId}/private/razorpay`);
export const KEY_ID = /^rzp_(test|live)_[A-Za-z0-9]{8,32}$/;
export const modeOf = (keyId: string): 'test' | 'live' => (keyId.startsWith('rzp_live_') ? 'live' : 'test');

/** Loads a branch's Razorpay settings and secrets (reads only). */
export async function loadCredentials(tx: Transaction | null, orgId: string, branchId: string, opts: { requireEnabled?: boolean } = {}) {
  const get = (ref: FirebaseFirestore.DocumentReference) => (tx ? tx.get(ref) : ref.get());
  const [branch, secret]: DocumentSnapshot[] = await Promise.all([get(db.doc(`orgs/${orgId}/branches/${branchId}`)), get(privateRef(orgId, branchId))]);
  if (!branch.exists) throw errors.notFound('Branch');
  const settings = branch.get('payments.razorpay') as GatewaySettings | undefined;
  if (!settings?.keyId || !secret.exists) {
    throw errors.conflict('GATEWAY_NOT_CONFIGURED', 'Online payments are not set up for this branch. An administrator can add Razorpay under Branches → Payments.');
  }
  if (opts.requireEnabled !== false && !settings.enabled) {
    throw errors.conflict('GATEWAY_DISABLED', 'Online payments are switched off for this branch.');
  }
  return { keyId: settings.keyId, keySecret: secret.get('keySecret') as string, webhookSecret: (secret.get('webhookSecret') as string | null) ?? null, settings, branch } as Credentials & {
    branch: DocumentSnapshot;
  };
}

/** Error raised by Razorpay, with its own description (safe to show staff). */
export class RazorpayError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Calls the Razorpay REST API with the branch's key (HTTP Basic auth). */
export async function rzp<T>(creds: Pick<Credentials, 'keyId' | 'keySecret'>, method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Basic ${Buffer.from(`${creds.keyId}:${creds.keySecret}`).toString('base64')}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new RazorpayError(0, 'NETWORK', "Razorpay didn't answer. Check the connection and try again.");
  }
  const json = (await res.json().catch(() => ({}))) as { error?: { code?: string; description?: string } };
  if (!res.ok) {
    const description = json.error?.description ?? `Razorpay answered ${res.status}.`;
    throw new RazorpayError(res.status, json.error?.code ?? 'ERROR', res.status === 401 ? 'Razorpay rejected the key ID or key secret.' : description);
  }
  return json as T;
}

/** Maps a Razorpay failure to a user-facing error. */
export function gatewayError(e: unknown): never {
  if (e instanceof RazorpayError) throw errors.conflict('GATEWAY_ERROR', `Razorpay: ${e.message}`);
  throw e;
}

/** Verifies the X-Razorpay-Signature header: HMAC-SHA256 of the raw request body with the webhook secret. */
export function verifySignature(rawBody: Buffer | string, signature: string | undefined, secret: string): boolean {
  if (!signature || !secret) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(signature, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

// ------------------------------------------------------------------ API shapes (subset)

export interface PaymentLink {
  id: string;
  short_url: string;
  status: 'created' | 'partially_paid' | 'paid' | 'cancelled' | 'expired';
  amount: number;
  amount_paid?: number;
  payments?: { payment_id: string; amount: number; status: string; method?: string }[] | null;
}

export interface QrCode {
  id: string;
  image_url: string;
  status: 'active' | 'closed';
  payments_amount_received?: number;
}

export interface Payment {
  id: string;
  amount: number;
  status: string;
  method?: string;
}
