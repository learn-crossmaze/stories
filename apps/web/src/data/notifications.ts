// In-app notifications (docs/HRMS.md §11): users/{uid}/notifications, written by functions; the owner marks them read.
import { collection, doc, limit, onSnapshot, orderBy, query, Timestamp, writeBatch } from 'firebase/firestore';

import { services } from './services';

export interface AppNotification {
  id: string;
  orgId: string;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
  read: boolean;
  at: Date | null;
}

const LATEST = 30;

/** Live list of the newest notifications; returns the unsubscribe function. */
export function watchNotifications(uid: string, onChange: (list: AppNotification[]) => void, onError: (e: Error) => void) {
  const q = query(collection(services().db, `users/${uid}/notifications`), orderBy('at', 'desc'), limit(LATEST));
  return onSnapshot(
    q,
    (snap) => onChange(snap.docs.map((d) => ({ ...(d.data() as Omit<AppNotification, 'id' | 'at'>), id: d.id, at: d.get('at') instanceof Timestamp ? (d.get('at') as Timestamp).toDate() : null }))),
    onError,
  );
}

export async function markRead(uid: string, ids: string[]) {
  if (!ids.length) return;
  const batch = writeBatch(services().db);
  for (const id of ids) batch.update(doc(services().db, `users/${uid}/notifications/${id}`), { read: true });
  await batch.commit();
}
