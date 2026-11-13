import type { DocumentSnapshot, Transaction } from 'firebase-admin/firestore';

import { errors } from '../core/errors.js';
import { db } from '../core/firebase.js';
import type { Member } from '../members/model.js';

export interface Term {
  snap: DocumentSnapshot;
  max: number;
  /** Member-field changes to write if a pre-paid renewal has just started. */
  rollover: Record<string, unknown> | null;
}

const live = (s: DocumentSnapshot | null, now: number) =>
  !!s?.exists &&
  s.get('status') === 'ACTIVE' &&
  s.get('startAt') &&
  s.get('startAt').toMillis() <= now &&
  s.get('endAt').toMillis() > now;

/**
 * The member's subscription in force right now, checked against the clock
 * (not waiting for the hourly expiry sweep). If the current term ended and a
 * pre-paid renewal has started, that renewal is used and `rollover` says how
 * to update the member. Returns null when there is no active term.
 */
export async function currentTerm(tx: Pick<Transaction, 'get'>, orgId: string, member: Member): Promise<Term | null> {
  const now = Date.now();
  const read = (id: string | null) => (id ? tx.get(db.doc(`orgs/${orgId}/subscriptions/${id}`)) : Promise.resolve(null));
  const [current, next] = await Promise.all([read(member.activeSubscriptionId), read(member.nextSubscriptionId)]);
  if (live(current, now)) return { snap: current!, max: current!.get('planSnapshot.maxSimultaneousBooks'), rollover: null };
  if (live(next, now)) {
    return {
      snap: next!,
      max: next!.get('planSnapshot.maxSimultaneousBooks'),
      rollover: { activeSubscriptionId: next!.id, nextSubscriptionId: null, subscriptionEndsAt: next!.get('endAt') },
    };
  }
  return null;
}

/** Throws when the membership itself is not active (suspended or closed): borrowing is paused. */
export function assertMemberActive(member: Member): void {
  if (member.status !== 'ACTIVE') {
    throw errors.conflict('MEMBER_INACTIVE', `This membership is ${member.status.toLowerCase()}. Borrowing is paused.`);
  }
}

/**
 * The check on a term already read with `currentTerm`: throws the member-facing
 * reason borrowing is blocked, if any (the membership first, then the term).
 */
export function assertActiveTerm(member: Member, term: Term | null): Term {
  assertMemberActive(member);
  if (!term) {
    throw errors.conflict(
      'NO_ACTIVE_SUBSCRIPTION',
      'No active subscription. The member can still return books; renew to borrow or exchange again.',
    );
  }
  return term;
}

/** Throws the member-facing reason borrowing is blocked, if any. */
export async function requireActiveTerm(tx: Transaction, orgId: string, member: Member): Promise<Term> {
  // An inactive membership is refused before its subscriptions are read.
  assertMemberActive(member);
  return assertActiveTerm(member, await currentTerm(tx, orgId, member));
}
