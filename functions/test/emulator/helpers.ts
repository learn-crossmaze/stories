import { randomUUID } from 'node:crypto';

import type { CallableFunction, CallableRequest } from 'firebase-functions/v2/https';

import { auth, db } from '../../src/core/firebase.js';

const PROJECT = 'demo-stories';

if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  throw new Error('Emulator tests must run under `firebase emulators:exec --only firestore,auth`.');
}

export async function resetEmulators() {
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, {
    method: 'DELETE',
  });
  await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/emulator/v1/projects/${PROJECT}/accounts`, {
    method: 'DELETE',
  });
}

export interface TestUser {
  uid: string;
  email: string;
  verified: boolean;
}

/** Creates an Auth user plus their users/{uid} profile, as first sign-in would. */
export async function createUser(email: string, opts: { verified?: boolean; superAdmin?: boolean } = {}): Promise<TestUser> {
  const u = await auth.createUser({ email, password: 'password123', displayName: email.split('@')[0], emailVerified: opts.verified ?? true });
  await db.doc(`users/${u.uid}`).set({
    uid: u.uid, email, displayName: u.displayName, status: 'ACTIVE',
    platformRoles: opts.superAdmin ? ['SUPER_ADMIN'] : [], claimsVersion: 0,
  });
  return { uid: u.uid, email, verified: opts.verified ?? true };
}

/** Invokes a callable in-process as `user` (bypasses HTTP, keeps the full pipeline). */
export function call<R>(fn: CallableFunction<unknown, unknown>, user: TestUser | null, data: Record<string, unknown>, requestId: string | null = randomUUID()): Promise<R> {
  const req = {
    data: requestId ? { ...data, requestId } : data,
    auth: user ? { uid: user.uid, token: { email: user.email, email_verified: user.verified } } : undefined,
    rawRequest: {},
    acceptsStreaming: false,
  } as unknown as CallableRequest;
  return fn.run(req) as Promise<R>;
}

/** Resolves to the error's `details.reason` (or code) so tests can assert on it. */
export async function failure(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    const err = e as { details?: { reason?: string }; code?: string };
    return err.details?.reason ?? err.code ?? String(e);
  }
  throw new Error('expected the call to fail');
}

export const address = { line1: '12 MG Road', city: 'Bengaluru', state: 'Karnataka', postalCode: '560001' };
export const contact = { phone: '+91 80 1234 5678' };
