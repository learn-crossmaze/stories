import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { onSchedule } from 'firebase-functions/v2/scheduler';

import { recordAudit } from '../core/audit.js';
import { db, REGION } from '../core/firebase.js';
import { JOB_OPTIONS, sweep } from '../core/sweep.js';
import { queueRenewalReminders } from '../messaging/outbox.js';
import { queueWhatsApp } from '../messaging/whatsapp.js';

/**
 * Marks subscriptions whose term has ended as EXPIRED and moves members onto
 * their pre-paid renewal, if any. Safe to run repeatedly: each subscription is
 * re-checked inside its own transaction. Borrowing checks use the clock
 * directly, so a delayed sweep never lets an expired member borrow.
 */
export async function expireDueSubscriptions(now = new Date()): Promise<number> {
  const due = db.collectionGroup('subscriptions').where('status', '==', 'ACTIVE').where('endAt', '<=', Timestamp.fromDate(now));
  const run = await sweep('expireSubscriptions', due, (doc) => {
    const orgId = doc.ref.parent.parent!.id;
    return db.runTransaction(async (tx) => {
      const sub = await tx.get(doc.ref);
      if (sub.get('status') !== 'ACTIVE' || sub.get('endAt').toMillis() > now.getTime()) return false;
      const memberRef = db.doc(`orgs/${orgId}/members/${sub.get('memberId')}`);
      const member = await tx.get(memberRef);
      const nextId = member.get('nextSubscriptionId') as string | null;
      const next = nextId ? await tx.get(db.doc(`orgs/${orgId}/subscriptions/${nextId}`)) : null;
      tx.update(doc.ref, { status: 'EXPIRED', expiredAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
      if (member.get('activeSubscriptionId') === sub.id) {
        const nextLive = next?.exists && next.get('status') === 'ACTIVE';
        tx.update(memberRef, {
          activeSubscriptionId: nextLive ? next!.id : null,
          subscriptionEndsAt: nextLive ? next!.get('endAt') : null,
          nextSubscriptionId: null,
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
      recordAudit(tx, { actorUid: 'system' }, orgId, {
        action: 'subscription.expire', entityType: 'subscription', entityId: sub.id, branchId: sub.get('branchId'), memberId: sub.get('memberId'),
        before: { status: 'ACTIVE' }, after: { status: 'EXPIRED', renewedInto: next?.exists ? next.id : null },
      });
      if (member.get('activeSubscriptionId') === sub.id && !(next?.exists && next.get('status') === 'ACTIVE')) {
        queueWhatsApp(tx, { orgId, branchId: sub.get('branchId'), event: 'plan_ended', memberId: sub.get('memberId'), vars: { plan_name: sub.get('planSnapshot.name') as string }, ref: { subscriptionId: sub.id } });
      }
      return true;
    });
  });
  return run.changed;
}

/** Hourly: ends terms, then queues renewal reminders for the scheduled hour (each step runs even if the other fails). */
export const expireSweep = onSchedule({ schedule: 'every 60 minutes', region: REGION, timeZone: 'Asia/Kolkata', ...JOB_OPTIONS }, async (event) => {
  const hour = new Date(event.scheduleTime);
  const results = await Promise.allSettled([expireDueSubscriptions(hour), queueRenewalReminders(hour)]);
  for (const r of results) if (r.status === 'rejected') logger.error('expireSubscriptions: a step failed', { error: String(r.reason) });
  if (results.some((r) => r.status === 'rejected')) throw new Error('expireSubscriptions: a step failed (see the log above)');
});
