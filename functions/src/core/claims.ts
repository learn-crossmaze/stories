import type { Transaction } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';

import { PERMISSION_CODES, ROLES } from '../generated/rbac.js';
import { errors } from './errors.js';
import { auth, db } from './firebase.js';
import { type Membership, permissionsOf, type UserProfile } from './rbac.js';
import { sweep } from './sweep.js';

/** Compact token claims (docs/RBAC.md §4). Short codes keep us under the 1000-byte limit. */
export interface StoriesClaims {
  v: number;
  sa: boolean;
  /** Per organization: ready-made role codes (`r`, for display), branch scope (`b`), and every permission held
   * there as 2-character codes run together (`p`, what rules and the app check; docs/RBAC.md §4). */
  o: Record<string, { r: string[]; b: string[]; p: string }>;
}

export function buildClaims(version: number, profile: Pick<UserProfile, 'platformRoles' | 'status'> | null, memberships: Membership[]): StoriesClaims {
  const active = profile?.status !== 'DISABLED';
  const o: StoriesClaims['o'] = {};
  if (active) {
    for (const m of memberships) {
      if (m.status !== 'ACTIVE' || (m.roles.length === 0 && !m.customRoles?.length)) continue;
      const p = [...permissionsOf(m)].map((x) => PERMISSION_CODES[x]).sort().join('');
      o[m.orgId] = { r: m.roles.filter((r) => ROLES[r]).map((r) => ROLES[r].code), b: [...m.branchIds], p };
    }
  }
  return { v: version, sa: active && (profile?.platformRoles ?? []).includes('SUPER_ADMIN'), o };
}

const MAX_CLAIMS_BYTES = 1000;
const fits = (claims: StoriesClaims) => Buffer.byteLength(JSON.stringify(claims)) <= MAX_CLAIMS_BYTES;

/**
 * Call in the same transaction that changes a user's roles. The flag stays set
 * until `syncClaims` has really updated the user's token, so a failed or
 * interrupted sync is finished by `syncStaleClaims` (scheduled) instead of
 * leaving, say, a revoked person with access in their token.
 */
export function markClaimsStale(tx: Transaction, uid: string) {
  tx.set(db.doc(`users/${uid}`), { claimsStale: true }, { merge: true });
}

/**
 * Refuses a role change whose token would exceed Firebase's 1000-byte claims
 * limit (checked before the commit, so roles never exist that can't reach the
 * token). Reads only: call it before the transaction's writes.
 */
export async function assertClaimsFit(tx: Transaction, uid: string, profile: Pick<UserProfile, 'platformRoles' | 'status'> | null, change: Membership) {
  const memberships = (await tx.get(db.collection(`users/${uid}/memberships`))).docs.map((d) => d.data() as Membership).filter((m) => m.orgId !== change.orgId);
  if (!fits(buildClaims(Number.MAX_SAFE_INTEGER, profile, [...memberships, change]))) {
    throw errors.conflict('TOO_MANY_ROLES', 'This person has roles in too many organizations or branches to add more. Use "all branches" or remove an old role first.');
  }
}

/**
 * Recomputes a user's custom claims from the authoritative documents, bumps
 * users/{uid}.claimsVersion (the web app watches it and refreshes its token),
 * and repeats if another sync raced ahead. Clears `claimsStale` only once the
 * token holds the latest version. Safe to call any number of times.
 */
export async function syncClaims(uid: string): Promise<StoriesClaims> {
  const userRef = db.doc(`users/${uid}`);
  for (let attempt = 0; attempt < 3; attempt++) {
    const { claims, version } = await db.runTransaction(async (tx) => {
      const [userSnap, memberships] = await Promise.all([tx.get(userRef), tx.get(db.collection(`users/${uid}/memberships`))]);
      const profile = userSnap.exists ? (userSnap.data() as UserProfile) : null;
      const version = (profile?.claimsVersion ?? 0) + 1;
      const claims = buildClaims(version, profile, memberships.docs.map((d) => d.data() as Membership));
      if (!fits(claims)) throw new Error(`claims for ${uid} exceed ${MAX_CLAIMS_BYTES} bytes`);
      tx.set(userRef, { claimsVersion: version }, { merge: true });
      return { claims, version };
    });
    await auth.setCustomUserClaims(uid, claims);
    // If a concurrent sync committed a newer version after ours, its claims may
    // have been overwritten by ours; loop to re-apply the latest state.
    const settled = await db.runTransaction(async (tx) => {
      const snap = await tx.get(userRef);
      if (snap.get('claimsVersion') !== version) return false;
      if (snap.get('claimsStale')) tx.update(userRef, { claimsStale: false });
      return true;
    });
    if (settled) return claims;
  }
  throw new Error(`claims sync for ${uid} did not settle`);
}

/** Finishes role changes whose token update failed or was interrupted (run by the maintenance job). */
export function syncStaleClaims() {
  return sweep('syncStaleClaims', db.collection('users').where('claimsStale', '==', true), async (doc) => {
    await syncClaims(doc.id);
    logger.info(`claims re-synced for ${doc.id}`);
  }, { concurrency: 4, budgetMs: 120_000 });
}
