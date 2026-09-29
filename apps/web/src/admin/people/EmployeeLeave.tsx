// The Leave tab of an employee profile: balances, requests and the ledger behind them.
import { useState } from 'react';

import { useAuth } from '../../auth/AuthContext';
import { branchScope } from '../../auth/claims';
import { todayIST } from '../../data/attendance';
import type { Employee } from '../../data/hr';
import { daysLabel, employeeRequests, leaveBalance, ledgerFor, listLeaveTypes, type LeaveRequest } from '../../data/leave';
import { ErrorState, SkeletonRows } from '../../shared/ui';
import { useAsync } from '../../shared/useAsync';
import { t } from '../../strings';
import { ht } from '../../strings/hr';
import { FormError } from '../components/Dialog';
import { Notice } from '../components/kit';
import { AdjustBalanceDialog, ApplyLeaveDialog, BalanceCards, CancelLeaveDialog, LedgerList, RequestTable, useLeaveDecision } from './leaveKit';

export function EmployeeLeavePanel({ orgId, employee, canApprove, canAdjust }: { orgId: string; employee: Employee; canApprove: boolean; canAdjust: boolean }) {
  const { claims, user } = useAuth();
  const self = !!employee.uid && employee.uid === user?.uid;
  const [year, setYear] = useState(todayIST().slice(0, 4));
  const own = self && !canApprove && !canAdjust ? employee.uid ?? undefined : undefined;
  const data = useAsync(async () => {
    const [types, balance, requests, ledger] = await Promise.all([
      listLeaveTypes(orgId),
      leaveBalance(orgId, employee.id, year),
      employeeRequests(orgId, employee.id, year, own ? { ownUid: own } : { scope: branchScope(claims, orgId) }),
      ledgerFor(orgId, employee.id, year, own ? { ownUid: own } : { scope: branchScope(claims, orgId) }),
    ]);
    return { types, balance, requests, ledger };
  }, [orgId, employee.id, year]);
  const [applying, setApplying] = useState(false);
  const [adjusting, setAdjusting] = useState(false);
  const [cancelling, setCancelling] = useState<LeaveRequest | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const decision = useLeaveDecision(orgId, data.reload);
  const now = Number(todayIST().slice(0, 4));
  const today = todayIST();
  const working = employee.status !== 'OFFBOARDED' && employee.status !== 'DRAFT';
  const mayCancel = (r: LeaveRequest) =>
    (r.status === 'PENDING' || r.status === 'APPROVED') && (self ? r.status === 'PENDING' || r.from > today : canAdjust);

  if (data.loading && !data.data) return <SkeletonRows />;
  if (data.error || !data.data) return <ErrorState message={data.error ?? t.errorGeneric} onRetry={data.reload} />;
  const d = data.data;
  return (
    <>
      {notice && <Notice tone="ok">{notice}</Notice>}
      <section className="section" aria-labelledby="leave-balance">
        <div className="page-header-row">
          <h2 id="leave-balance">{ht.balance}</h2>
          <div className="row">
            <label className="field-inline">
              {ht.yearLabel}
              <select value={year} onChange={(e) => setYear(e.target.value)}>
                {[now + 1, now, now - 1].map((y) => (
                  <option key={y} value={String(y)}>
                    {y}
                  </option>
                ))}
              </select>
            </label>
            {!self && canApprove && working && (
              <button type="button" className="btn btn-outlined" onClick={() => setApplying(true)}>
                {ht.applyOnBehalf}
              </button>
            )}
            {!self && canAdjust && working && (
              <button type="button" className="btn btn-outlined" onClick={() => setAdjusting(true)}>
                {ht.adjustBalance}
              </button>
            )}
          </div>
        </div>
        <BalanceCards types={d.types} balance={d.balance} />
      </section>
      <section className="section" aria-labelledby="leave-requests">
        <h2 id="leave-requests">{ht.tabRequests}</h2>
        <FormError error={decision.error} />
        <RequestTable
          requests={d.requests}
          empty={ht.leaveEmpty}
          actions={(r) => (
            <>
              {!self && canApprove && r.status === 'PENDING' && (
                <>
                  <button type="button" className="btn btn-text" onClick={() => void decision.approve(r)} aria-label={`${ht.approve} ${ht.leaveDates(r.from, r.to)}`}>
                    {ht.approve}
                  </button>
                  <button type="button" className="btn btn-text" onClick={() => decision.reject(r)} aria-label={`${ht.reject} ${ht.leaveDates(r.from, r.to)}`}>
                    {ht.reject}
                  </button>
                </>
              )}
              {mayCancel(r) && (
                <button type="button" className="btn btn-text" onClick={() => setCancelling(r)} aria-label={ht.cancelLeaveFor(r.from)}>
                  {ht.cancelLeave}
                </button>
              )}
            </>
          )}
        />
      </section>
      <section className="section" aria-labelledby="leave-ledger">
        <h2 id="leave-ledger">{ht.ledger}</h2>
        <LedgerList entries={d.ledger} types={d.types} />
      </section>
      {decision.dialog}
      {applying && (
        <ApplyLeaveDialog
          orgId={orgId}
          types={d.types}
          balance={d.balance}
          employee={employee}
          onClose={() => setApplying(false)}
          onDone={(days) => {
            setNotice(ht.leaveApplied(daysLabel(days)));
            data.reload();
          }}
        />
      )}
      {adjusting && <AdjustBalanceDialog orgId={orgId} employee={employee} types={d.types.filter((ty) => ty.status === 'ACTIVE')} year={year} onClose={() => setAdjusting(false)} onDone={data.reload} />}
      {cancelling && <CancelLeaveDialog orgId={orgId} request={cancelling} own={self} onClose={() => setCancelling(null)} onDone={data.reload} />}
    </>
  );
}
