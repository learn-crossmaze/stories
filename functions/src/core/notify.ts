import { FieldValue, Timestamp, type Transaction, type WriteBatch } from 'firebase-admin/firestore';

import { db } from './firebase.js';

/**
 * In-app notifications (docs/HRMS.md §11): users/{uid}/notifications/{id},
 * written by functions when someone else acts on something of yours. The
 * owner reads them and may only mark them read. `expireAt` lets a Firestore
 * TTL policy clear old ones.
 */
export interface Notice {
  orgId: string;
  /** What happened, e.g. 'leave.approved'. */
  kind: string;
  title: string;
  body?: string;
  /** A path in the web app to open. */
  link?: string;
}

const KEEP_DAYS = 90;

/** Queues a notification for `uid` (skipped when there is no account, or it is the person acting). */
export function notify(writer: Transaction | WriteBatch, uid: string | null | undefined, notice: Notice, actorUid?: string) {
  if (!uid || uid === actorUid) return;
  const ref = db.collection(`users/${uid}/notifications`).doc();
  (writer as Transaction).set(ref, {
    orgId: notice.orgId,
    kind: notice.kind,
    title: notice.title,
    body: notice.body ?? null,
    link: notice.link ?? null,
    read: false,
    at: FieldValue.serverTimestamp(),
    expireAt: Timestamp.fromMillis(Date.now() + KEEP_DAYS * 86_400_000),
  });
}

/** Web paths notifications point to. */
export const LINKS = {
  me: '/me',
  myLeave: '/me/leave',
  myAttendance: '/me/attendance',
  myPayslips: '/me/payslips',
  payroll: '/admin/payroll',
};
