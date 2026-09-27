import { FieldValue } from 'firebase-admin/firestore';
import { defineString } from 'firebase-functions/params';
import { z } from 'zod';

import { recordAudit } from '../core/audit.js';
import { command } from '../core/callable.js';
import { syncClaims } from '../core/claims.js';
import { errors } from '../core/errors.js';
import { db } from '../core/firebase.js';

/** The one email allowed to claim the first Super Admin seat (functions/.env). */
const bootstrapEmail = defineString('BOOTSTRAP_SUPER_ADMIN_EMAIL');

/**
 * One-time: makes the configured owner the first Super Admin. Refuses once any
 * Super Admin has been bootstrapped, for any other email, or unverified emails.
 */
export const bootstrapSuperAdmin = command(
  'platform-bootstrapSuperAdmin',
  z.strictObject({}),
  async ({ actor, requestId }, tx) => {
    const stateRef = db.doc('platform/state');
    const userRef = db.doc(`users/${actor.uid}`);
    const [state, user] = await Promise.all([tx.get(stateRef), tx.get(userRef)]);
    const allowed = bootstrapEmail.value().trim().toLowerCase();
    if (!allowed || actor.email?.toLowerCase() !== allowed) throw errors.forbidden();
    if (!actor.emailVerified) {
      throw errors.conflict('EMAIL_NOT_VERIFIED', 'Verify your email address first, then try again.');
    }
    if (state.get('superAdminBootstrapped')) {
      throw errors.conflict('ALREADY_BOOTSTRAPPED', 'Administration has already been set up.');
    }
    if (!user.exists) throw errors.conflict('NO_PROFILE', 'Please sign out and sign in again, then retry.');
    tx.set(stateRef, { superAdminBootstrapped: true, bootstrappedBy: actor.uid, at: FieldValue.serverTimestamp() });
    tx.update(userRef, { platformRoles: ['SUPER_ADMIN'], updatedAt: FieldValue.serverTimestamp() });
    recordAudit(tx, { actorUid: actor.uid, actorEmail: actor.email, requestId }, null, {
      action: 'platform.superAdmin.bootstrap',
      entityType: 'user',
      entityId: actor.uid,
      after: { platformRoles: ['SUPER_ADMIN'] },
    });
    return { ok: true };
  },
  async (_r, { actor }) => {
    await syncClaims(actor.uid);
  },
);
