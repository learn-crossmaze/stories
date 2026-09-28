import { useState } from 'react';
import { Link } from 'react-router';

import { command } from '../../data/api';
import { branchReservations, type Reservation } from '../../data/circulation';
import { useAsync } from '../../shared/useAsync';
import { day, when } from '../../shared/format';
import { paths } from '../../paths';
import { EmptyState, SkeletonRows } from '../../shared/ui';
import { ConfirmWithReason } from '../components/Dialog';
import { NeedBranch, Tabs } from '../components/kit';
import { lt } from '../../strings/library';
import { useWorkspace } from '../Workspace';

function Queue({ orgId, branchId }: { orgId: string; branchId: string }) {
  const [tab, setTab] = useState<'ALLOCATED' | 'WAITING'>('ALLOCATED');
  const list = useAsync(() => branchReservations(orgId, branchId, tab), [orgId, branchId, tab]);
  const [cancelling, setCancelling] = useState<Reservation | null>(null);
  return (
    <>
      <Tabs tabs={[{ value: 'ALLOCATED', label: lt.awaitingPickup }, { value: 'WAITING', label: lt.waitingQueue }]} value={tab} onChange={setTab} />
      {list.loading ? (
        <SkeletonRows rows={3} />
      ) : !list.data?.length ? (
        <EmptyState icon="bookmark" title={lt.noReservations} message="" />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{lt.reserveBook}</th>
                <th scope="col">{lt.reserveFor}</th>
                <th scope="col">{tab === 'ALLOCATED' ? lt.copy : 'Since'}</th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {list.data.map((r, i) => (
                <tr key={r.id}>
                  <td>
                    {tab === 'WAITING' && <span className="muted small">#{i + 1} </span>}
                    <Link to={paths.adminBook(r.bookId)}>{r.bookTitle}</Link>
                  </td>
                  <td>
                    <Link to={paths.adminMember(r.memberId)}>{r.memberName}</Link> <span className="mono small">{r.memberCode}</span>
                  </td>
                  <td className="small">{tab === 'ALLOCATED' ? <><span className="mono">{r.allocatedCopyCode}</span> · {lt.holdUntil(when(r.holdUntil))}</> : day(r.queuedAt)}</td>
                  <td className="cell-actions">
                    <button type="button" className="btn btn-text" onClick={() => setCancelling(r)}>
                      {lt.cancelReservation}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {cancelling && (
        <ConfirmWithReason title={`${lt.cancelReservation}?`} body={`${cancelling.bookTitle} · ${cancelling.memberName}`} confirmLabel={lt.cancelReservation} onClose={() => setCancelling(null)}
          onConfirm={async (reason) => { await command('reservations-cancel', { orgId, reservationId: cancelling.id, reason }); list.reload(); setCancelling(null); }} />
      )}
    </>
  );
}

export function ReservationsPage() {
  const { org } = useWorkspace();
  return (
    <>
      <header className="page-header">
        <h1>{lt.reservationsTitle}</h1>
        <p className="muted">Place reservations from a member’s page.</p>
      </header>
      <NeedBranch>{(branchId) => org && <Queue orgId={org.id} branchId={branchId} />}</NeedBranch>
    </>
  );
}
