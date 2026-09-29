// A staff member's own leave: balances, requests and applying (account menu → My leave).
import { useState } from 'react';

import { useAuth } from '../../auth/AuthContext';
import { todayIST } from '../../data/attendance';
import { myEmployee } from '../../data/hr';
import { daysLabel, employeeRequests, leaveBalance, ledgerFor, listLeaveTypes, type LeaveRequest } from '../../data/leave';
import { EmptyState, ErrorState, SkeletonRows } from '../../shared/ui';
import { useAsync } from '../../shared/useAsync';
import { t } from '../../strings';
import { ht } from '../../strings/hr';
import { Notice } from '../components/kit';
import { useWorkspace } from '../Workspace';
import { ApplyLeaveDialog, BalanceCards, CancelLeaveDialog, LedgerList, RequestTable } from './leaveKit';

const WORKING = ['ONBOARDING', 'ACTIVE', 'NOTICE_PERIOD', 'OFFBOARDING'];

export function MyLeavePage() {
  const { user } = useAuth();
  const { org } = useWorkspace();
  const [year, setYear] = useState(todayIST().slice(0, 4));
  const [applying, setApplying] = useState(false);
  const [cancelling, setCancelling] = useState<LeaveRequest | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const me = useAsync(() => (org && user ? myEmployee(org.id, user.uid) : Promise.resolve(null)), [org?.id, user?.uid]);
  const data = useAsync(async () => {
    if (!org || !user || !me.data) return null;
    const [types, balance, requests, ledger] = await Promise.all([
      listLeaveTypes(org.id),
      leaveBalance(org.id, me.data.id, year),
      employeeRequests(org.id, me.data.id, year, { ownUid: user.uid }),
      ledgerFor(org.id, me.data.id, year, { ownUid: user.uid }),
    ]);
    return { types, balance, requests, ledger };
  }, [org?.id, me.data?.id, year]);
  if (!org) return <EmptyState icon="building" title={t.noOrgTitle} message={t.noOrgMessage} />;
  const today = todayIST();
  const cancellable = (r: LeaveRequest) => r.status === 'PENDING' || (r.status === 'APPROVED' && r.from > today);
  const working = !!me.data && WORKING.includes(me.data.status);

  return (
    <>
      <header className="page-header page-header-row">
        <div>
          <h1>{ht.navMyLeave}</h1>
          <p className="muted">{ht.myLeaveIntro}</p>
        </div>
        {working && data.data && (
          <button type="button" className="btn btn-filled" onClick={() => setApplying(true)}>
            {ht.applyLeave}
          </button>
        )}
      </header>
      {notice && <Notice tone="ok">{notice}</Notice>}
      {me.loading ? (
        <SkeletonRows />
      ) : !me.data ? (
        <EmptyState icon="calendar" title={ht.noEmployeeRecord} message="" />
      ) : data.loading && !data.data ? (
        <SkeletonRows />
      ) : data.error || !data.data ? (
        <ErrorState message={data.error ?? t.errorGeneric} onRetry={data.reload} />
      ) : (
        <>
          <section className="section" aria-labelledby="my-balance">
            <div className="page-header-row">
              <h2 id="my-balance">{ht.balance}</h2>
              <label className="field-inline">
                {ht.yearLabel}
                <select value={year} onChange={(e) => setYear(e.target.value)}>
                  {[Number(today.slice(0, 4)) + 1, Number(today.slice(0, 4)), Number(today.slice(0, 4)) - 1].map((y) => (
                    <option key={y} value={String(y)}>
                      {y}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <BalanceCards types={data.data.types} balance={data.data.balance} />
          </section>
          <section className="section" aria-labelledby="my-requests">
            <h2 id="my-requests">{ht.tabRequests}</h2>
            <RequestTable
              requests={data.data.requests}
              empty={ht.leaveEmpty}
              actions={(r) =>
                cancellable(r) && (
                  <button type="button" className="btn btn-text" onClick={() => setCancelling(r)} aria-label={ht.cancelLeaveFor(r.from)}>
                    {ht.cancelLeave}
                  </button>
                )
              }
            />
          </section>
          <section className="section" aria-labelledby="my-ledger">
            <h2 id="my-ledger">{ht.ledger}</h2>
            <LedgerList entries={data.data.ledger} types={data.data.types} />
          </section>
        </>
      )}
      {applying && data.data && (
        <ApplyLeaveDialog
          orgId={org.id}
          types={data.data.types}
          balance={data.data.balance}
          onClose={() => setApplying(false)}
          onDone={(days) => {
            setNotice(ht.leaveApplied(daysLabel(days)));
            data.reload();
          }}
        />
      )}
      {cancelling && <CancelLeaveDialog orgId={org.id} request={cancelling} own onClose={() => setCancelling(null)} onDone={data.reload} />}
    </>
  );
}
