import { ROLES } from '../generated/rbac.js';
import { auth, db } from './firebase.js';
import type { Membership, UserProfile } from './rbac.js';

/** Compact token claims (docs/RBAC.md §4). Short codes keep us under the 1000-byte limit. */
export interface StoriesClaims {
  v: number;
  sa: boolean;
  o: Record<string, { r: string[]; b: string[] }>;
}

export function buildClaims(version: number, profile: Pick<UserProfile, 'platformRoles' | 'status'> | null, memberships: Membership[]): StoriesClaims {
  const active = profile?.status !== 'DISABLED';
  const o: StoriesClaims['o'] = {};
  if (active) {
    for (const m of memberships) {
      if (m.status !== 'ACTIVE' || m.roles.length === 0) continue;
      o[m.orgId] = { r: m.roles.map((r) => ROLES[r].code), b: [...m.branchIds] };
    }
  }
  return { v: version, sa: active && (profile?.platformRoles ?? []).includes('SUPER_ADMIN'), o };
}

const MAX_CLAIMS_BYTES = 1000;

/**
 * Recomputes a user's custom claims from the authoritative documents, bumps
 * users/{uid}.claimsVersion (the web app watches it and refreshes its token),
 * and repeats if another sync raced ahead. Safe to call any number of times.
 */
export async function syncClaims(uid: string): Promise<StoriesClaims> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { claims, version } = await db.runTransaction(async (tx) => {
      const userRef = db.doc(`users/${uid}`);
      const [userSnap, memberships] = await Promise.all([
        tx.get(userRef),
        tx.get(db.collection(`users/${uid}/memberships`)),
      ]);
      const profile = userSnap.exists ? (userSnap.data() as UserProfile) : null;
      const version = (profile?.claimsVersion ?? 0) + 1;
      const claims = buildClaims(version, profile, memberships.docs.map((d) => d.data() as Membership));
      if (Buffer.byteLength(JSON.stringify(claims)) > MAX_CLAIMS_BYTES) {
        throw new Error(`claims for ${uid} exceed ${MAX_CLAIMS_BYTES} bytes`);
      }
      tx.set(userRef, { claimsVersion: version }, { merge: true });
      return { claims, version };
    });
    await auth.setCustomUserClaims(uid, claims);
    // If a concurrent sync committed a newer version after ours, its claims may
    // have been overwritten by ours; loop to re-apply the latest state.
    const latest = (await db.doc(`users/${uid}`).get()).get('claimsVersion');
    if (latest === version) return claims;
  }
  throw new Error(`claims sync for ${uid} did not settle`);
}
