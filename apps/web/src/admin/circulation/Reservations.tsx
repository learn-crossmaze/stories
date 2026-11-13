import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';

import { useAuth } from '../../auth/AuthContext';
import { can } from '../../auth/claims';
import { command } from '../../data/api';
import { branchReservations, type Reservation, RESERVATIONS_PAGE } from '../../data/circulation';
import { type BranchStock, shelvedElsewhere, stockByBranchAll } from '../../data/inventory';
import { useAsync } from '../../shared/useAsync';
import { day, when } from '../../shared/format';
import { paths } from '../../paths';
import { EmptyState, SkeletonRows, TableWrap } from '../../shared/ui';
import { ConfirmWithReason } from '../components/Dialog';
import { NeedBranch, Notice, Tabs } from '../components/kit';
import { lt } from '../../strings/library';
import { useWorkspace } from '../Workspace';
import { ReserveDialog } from '../members/memberDialogs';

function Queue({ orgId, branchId }: { orgId: string; branchId: string }) {
  const [tab, setTab] = useState<'ALLOCATED' | 'WAITING'>('ALLOCATED');
  // Both lists are read together: switching tabs reads nothing, and cancelling a held book can change both.
  const lists = useAsync(async () => {
    const [ALLOCATED, WAITING] = await Promise.all([branchReservations(orgId, branchId, 'ALLOCATED'), branchReservations(orgId, branchId, 'WAITING')]);
    return { ALLOCATED, WAITING };
  }, [orgId, branchId]);
  const [cancelling, setCancelling] = useState<Reservation | null>(null);
  const { claims } = useAuth();
  // Handing a held book over happens at the desk, which opens with the member already chosen.
  const canHandOver = can(claims, 'loans.issue', orgId, branchId);
  // Reserving from here starts by finding the member, so it needs the right to see members too.
  const canReserve = can(claims, 'reservations.manage', orgId, branchId) && can(claims, 'members.view', orgId, branchId);
  const [reserving, setReserving] = useState(false);
  const [placed, setPlaced] = useState<string | null>(null);
  const rows = lists.data?.[tab] ?? [];
  const waiting = lists.data?.WAITING;

  // Which other branch has a waited-for title on its shelf: asked for once per title, the first time Waiting is
  // opened. The numbers are of that moment, and an extra: the list works without them.
  const [stock, setStock] = useState<Record<string, BranchStock[]>>({});
  const [stockFailed, setStockFailed] = useState(false);
  const asked = useRef(new Set<string>());
  useEffect(() => {
    if (tab !== 'WAITING' || !waiting || stockFailed) return;
    const missing = [...new Set(waiting.map((r) => r.bookId))].filter((id) => !asked.current.has(id));
    if (!missing.length) return;
    for (const id of missing) asked.current.add(id);
    stockByBranchAll(orgId, missing).then(
      // A title no branch holds is not in the answer: it is kept as "nowhere", so it shows a dash, not a blank.
      (found) => setStock((s) => ({ ...s, ...Object.fromEntries(missing.map((id) => [id, found[id] ?? []])) })),
      (e) => {
        console.warn('availability', e);
        setStockFailed(true);
      },
    );
  }, [tab, waiting, orgId, stockFailed]);
  const showStock = tab === 'WAITING' && !stockFailed;
  const titlesElsewhere = new Set((waiting ?? []).filter((r) => shelvedElsewhere(stock[r.bookId], branchId)?.length).map((r) => r.bookId)).size;
  // A full page may not be the whole queue, so it is not shown as a count.
  const count = (list: Reservation[] | undefined) => (list && list.length < RESERVATIONS_PAGE ? list.length : undefined);
  return (
    <>
      {canReserve && (
        <div className="toolbar">
          <button type="button" className="btn btn-outlined" onClick={() => setReserving(true)}>
            {lt.placeReservation}
          </button>
        </div>
      )}
      {placed && <Notice tone="ok">{placed}</Notice>}
      <Tabs
        tabs={[
          { value: 'ALLOCATED', label: lt.awaitingPickup, count: count(lists.data?.ALLOCATED) },
          { value: 'WAITING', label: lt.waitingQueue, count: count(waiting) },
        ]}
        value={tab}
        onChange={setTab}
      />
      {lists.loading ? (
        <SkeletonRows rows={3} />
      ) : !rows.length ? (
        <EmptyState icon="bookmark" title={lt.noReservations} message="" />
      ) : (
        <>
          {showStock && titlesElsewhere > 0 && <Notice tone="ok">{lt.shelfElsewhereHint(titlesElsewhere)}</Notice>}
          <TableWrap>
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">{lt.reserveBook}</th>
                  <th scope="col">{lt.reserveFor}</th>
                  <th scope="col">{tab === 'ALLOCATED' ? lt.copy : 'Since'}</th>
                  {showStock && <th scope="col">{lt.shelfElsewhere}</th>}
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const elsewhere = shelvedElsewhere(stock[r.bookId], branchId);
                  return (
                    <tr key={r.id}>
                      <td>
                        {tab === 'WAITING' && <span className="muted small">#{i + 1} </span>}
                        <Link to={paths.adminBook(r.bookId)}>{r.bookTitle}</Link>
                      </td>
                      <td>
                        <Link to={paths.adminMember(r.memberId)}>{r.memberName}</Link> <span className="mono small">{r.memberCode}</span>
                      </td>
                      <td className="small">{tab === 'ALLOCATED' ? <><span className="mono">{r.allocatedCopyCode}</span> · {lt.holdUntil(when(r.holdUntil))}</> : day(r.queuedAt)}</td>
                      {showStock && (
                        <td className="small">
                          {/* Nothing while the counts load; a dash when no other branch has one on the shelf. */}
                          {elsewhere &&
                            (elsewhere.length ? (
                              <span className="stock">
                                {elsewhere.map((s) => (
                                  <span key={s.branchId} className="stock-chip ok" title={lt.stockAt(s.branchName, s.available, s.total)}>
                                    {s.branchName} {s.available}
                                  </span>
                                ))}
                              </span>
                            ) : (
                              '—'
                            ))}
                        </td>
                      )}
                      <td className="cell-actions">
                        {tab === 'ALLOCATED' && canHandOver && (
                          <Link className="btn btn-text" to={paths.adminDeskFor(r.memberId)}>
                            {lt.deskHandOver}
                          </Link>
                        )}
                        <button type="button" className="btn btn-text" onClick={() => setCancelling(r)}>
                          {lt.cancelReservation}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        </>
      )}
      {cancelling && (
        <ConfirmWithReason title={`${lt.cancelReservation}?`} body={`${cancelling.bookTitle} · ${cancelling.memberName}`} confirmLabel={lt.cancelReservation} onClose={() => setCancelling(null)}
          onConfirm={async (reason) => { await command('reservations-cancel', { orgId, reservationId: cancelling.id, reason }); lists.reload(); setCancelling(null); }} />
      )}
      {reserving && (
        <ReserveDialog
          orgId={orgId}
          branchId={branchId}
          onClose={() => setReserving(false)}
          onDone={(msg) => {
            setPlaced(msg);
            lists.reload();
          }}
        />
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
        <p className="muted">{lt.reservationsHint}</p>
      </header>
      {/* The counts kept per title belong to one organization. */}
      <NeedBranch>{(branchId) => org && <Queue key={org.id} orgId={org.id} branchId={branchId} />}</NeedBranch>
    </>
  );
}
