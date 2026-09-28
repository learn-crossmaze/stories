import { FieldValue } from 'firebase-admin/firestore';
import { z } from 'zod';

import { query } from '../core/callable.js';
import { auth, db } from '../core/firebase.js';

/**
 * Creates users/{uid} on first sign-in (or refreshes email/name). Clients
 * cannot write their profile directly; roles are never set here.
 */
export const ensureProfile = query('users-ensureProfile', z.strictObject({}), async ({ actor }) => {
  const ref = db.doc(`users/${actor.uid}`);
  const { displayName } = await auth.getUser(actor.uid);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) {
      tx.create(ref, {
        uid: actor.uid,
        email: actor.email,
        displayName: displayName ?? null,
        status: 'ACTIVE',
        platformRoles: [],
        claimsVersion: 0,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    } else if (snap.get('email') !== actor.email || snap.get('displayName') !== (displayName ?? null)) {
      tx.update(ref, { email: actor.email, displayName: displayName ?? null, updatedAt: FieldValue.serverTimestamp() });
    }
  });
  return { ok: true };
});
