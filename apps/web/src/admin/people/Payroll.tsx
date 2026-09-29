// People → Payroll: prepare a branch's month from finalized attendance, submit it, and approve it (someone else).
import { useState } from 'react';
import { Link } from 'react-router';

import { useAuth } from '../../auth/AuthContext';
import { branchScope, can } from '../../auth/claims';
import { command } from '../../data/api';
import { monthLock, previousMonth } from '../../data/attendance';
import { monthIST } from '../../shared/dates';
import { monthName, type Payslip, prepareRun, getRun, runPayslips, submitRun } from '../../data/payroll';
import type { Permission } from '../../generated/rbac';
import { paths } from '../../paths';
import { ErrorState, NoOrgState, SkeletonRows, TableWrap } from '../../shared/ui';
import { rupees } from '../../shared/format';
import { useAsync } from '../../shared/useAsync';
import { t } from '../../strings';
import { ht } from '../../strings/hr';
import { ConfirmWithReason, Dialog, DialogActions, FormError, useSubmit } from '../components/Dialog';
import { Notice } from '../components/kit';
import { useWorkspace } from '../Workspace';
import { InputsDialog, PayslipButton, RunBadge } from './payrollKit';

export function PayrollPage() {
  const { claims, user } = useAuth();
  const { org, myBranches, branch } = useWorkspace();
  const scope = org ? branchScope(claims, org.id) : 'ALL';
  const [month, setMonth] = useState(previousMonth(monthIST()));
  // Head-office staff (no branch) are paid in their own run, by org-wide staff.
  const choices = [...myBranches.map((b) => ({ value: b.id, label: b.name })), ...(scope === 'ALL' ? [{ value: 'HO', label: ht.headOffice }] : [])];
  // Follows the current branch until someone picks (branches load after the first render).
  const [picked, setWhere] = useState<string | null>(null);
  const where = picked ?? branch?.id ?? choices[0]?.value ?? 'HO';
  const branchId = where === 'HO' ? null : where;
  const orgId = org?.id ?? '';
  const perm = (p: Permission) => (branchId ? can(claims, p, orgId, branchId) : can(claims, p, orgId) && scope === 'ALL');
  const data = useAsync(async () => {
    if (!org) return null;
    const [run, lock, slips] = await Promise.all([getRun(org.id, month, branchId), monthLock(org.id, month, branchId), perm('payslips.viewAll') ? runPayslips(org.id, month, branchId) : Promise.resolve([] as Payslip[])]);
    return { run, finalized: lock?.status === 'FINALIZED', slips };
  }, [org?.id, month, where]);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [approving, setApproving] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [inputsFor, setInputsFor] = useState<Payslip | null>(null);
  if (!org) return <NoOrgState />;

  const run = data.data?.run ?? null;
  const status = run?.status ?? 'NONE';
  const canRun = perm('payroll.run');
  const canApprove = perm('payroll.approve');
  const ownRun = !!run && (run.preparedBy === user?.uid || run.submittedBy === user?.uid);
  const editable = status === 'NONE' || status === 'DRAFT';
  const whereLabel = choices.find((c) => c.value === where)?.label ?? '';
  const act = async (fn: () => Promise<string | null>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      setNotice(await fn());
      data.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : t.errorGeneric);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <header className="page-header">
        <h1>{ht.navPayroll}</h1>
        <p className="muted">{ht.payrollIntro}</p>
      </header>
      <div className="toolbar">
        <label className="field-inline">
          {ht.monthLabel}
          <input type="month" value={month} max={previousMonth(monthIST())} onChange={(e) => e.target.value && setMonth(e.target.value)} />
        </label>
        {choices.length > 1 && (
          <label className="field-inline">
            {ht.payrollFor}
            <select value={where} onChange={(e) => setWhere(e.target.value)}>
              {choices.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
        )}
        {canRun && editable && data.data?.finalized && (
          <button
            type="button"
            className={status === 'NONE' || run?.stale ? 'btn btn-filled' : 'btn btn-outlined'}
            disabled={busy}
            onClick={() =>
              void act(async () => {
                const res = await prepareRun(org.id, month, branchId);
                return ht.prepareDone(res.employees, res.problems);
              })
            }
          >
            {status === 'NONE' ? ht.prepareRun : ht.prepareAgain}
          </button>
        )}
        {canRun && status === 'DRAFT' && !run?.stale && !run?.problemCount && (
          <button type="button" className="btn btn-filled" disabled={busy} onClick={() => void act(async () => (await submitRun(org.id, month, branchId), null))}>
            {ht.submitRun}
          </button>
        )}
        {canApprove && status === 'SUBMITTED' && !ownRun && (
          <>
            <button type="button" className="btn btn-filled" onClick={() => setApproving(true)}>
              {ht.approveRun}
            </button>
            <button type="button" className="btn btn-outlined" onClick={() => setRejecting(true)}>
              {ht.rejectRun}
            </button>
          </>
        )}
      </div>
      {notice && <Notice tone="ok">{notice}</Notice>}
      <FormError error={error} />
      {data.loading && !data.data ? (
        <SkeletonRows />
      ) : data.error || !data.data ? (
        <ErrorState message={data.error ?? t.errorGeneric} onRetry={data.reload} />
      ) : (
        <>
          <section className="card section" aria-labelledby="run-title">
            <h2 id="run-title" className="row">
              {monthName(month)} · {whereLabel} <RunBadge status={status} />
            </h2>
            {!run ? (
              <p className="muted">{data.data.finalized ? ht.noRunYet : ht.needsFinalizedAttendance}</p>
            ) : (
              <>
                <dl className="run-summary">
                  <div>
                    <dt>{ht.totalsGross}</dt>
                    <dd>{rupees(run.totals.gross)}</dd>
                  </div>
                  <div>
                    <dt>{ht.totalsDeductions}</dt>
                    <dd>{rupees(run.totals.deductions)}</dd>
                  </div>
                  <div>
                    <dt>{ht.totalsNet}</dt>
                    <dd>{rupees(run.totals.net)}</dd>
                  </div>
                  <div>
                    <dt>{ht.totalsEmployerCost}</dt>
                    <dd>{rupees(run.totals.employerCost)}</dd>
                  </div>
                </dl>
                <p className="muted small">
                  {[ht.runPreparedBy(run.preparedByEmail), run.submittedByEmail && ht.runSubmittedBy(run.submittedByEmail), run.approvedByEmail && ht.runApprovedBy(run.approvedByEmail)].filter(Boolean).join(', ')} ·{' '}
                  {ht.settingsInForce(run.settingsFrom)}
                </p>
                {run.stale && editable && <Notice tone="warn">{ht.runStale}</Notice>}
                {run.rejectNote && status === 'DRAFT' && <Notice tone="warn">{ht.runRejected(run.rejectNote)}</Notice>}
                {status === 'SUBMITTED' && canApprove && ownRun && <p className="muted">{ht.ownRunNote}</p>}
                {run.problemCount > 0 && (
                  <div className="section">
                    <h3>{ht.problemsTitle}</h3>
                    <ul>
                      {run.problems.map((p, i) => (
                        <li key={i}>
                          <Link to={paths.adminEmployee(p.employeeId)}>{p.employeeName}</Link>: {p.message}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}
          </section>
          {data.data.slips.length > 0 && (
            <TableWrap>
              <table className="table compact">
                <thead>
                  <tr>
                    <th scope="col">{ht.colName}</th>
                    <th scope="col" className="num">
                      {ht.colPayable}
                    </th>
                    <th scope="col" className="num">
                      {ht.colGross}
                    </th>
                    <th scope="col" className="num">
                      {ht.colDeductions}
                    </th>
                    <th scope="col" className="num">
                      {ht.colNet}
                    </th>
                    <th scope="col">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.data.slips.map((s) => (
                    <tr key={s.id}>
                      <td>
                        <Link to={paths.adminEmployee(s.employeeId)}>{s.employeeName}</Link>
                        {s.missingSalary && <span className="badge badge-danger"> {ht.noSalary}</span>}
                        {s.tds > 0 && <div className="muted small">TDS {rupees(s.tds)}</div>}
                      </td>
                      <td className="num">
                        {s.days.payable}/{s.days.inMonth}
                      </td>
                      <td className="num">{rupees(s.gross)}</td>
                      <td className="num">{rupees(s.deductions)}</td>
                      <td className="num">
                        <strong>{rupees(s.net)}</strong>
                      </td>
                      <td className="cell-actions">
                        {canRun && editable && s.employeeUid !== user?.uid && (
                          <button type="button" className="btn btn-text" onClick={() => setInputsFor(s)} aria-label={`${ht.inputs} ${s.employeeName}`}>
                            {ht.inputs}
                          </button>
                        )}
                        {!s.missingSalary && <PayslipButton orgId={org.id} slip={s} />}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </>
      )}
      {inputsFor && (
        <InputsDialog orgId={org.id} employee={{ id: inputsFor.employeeId, fullName: inputsFor.employeeName }} month={month} onClose={() => setInputsFor(null)} onDone={data.reload} />
      )}
      {approving && run && <ApproveDialog orgId={org.id} month={month} branchId={branchId} employees={run.employees} net={run.totals.net} onClose={() => setApproving(false)} onDone={data.reload} />}
      {rejecting && (
        <ConfirmWithReason
          title={ht.rejectRunTitle(monthName(month))}
          body={ht.rejectRunBody}
          confirmLabel={ht.rejectRun}
          onClose={() => setRejecting(false)}
          onConfirm={async (note) => {
            await command('payroll-decide', { orgId: org.id, month, branchId, decision: 'REJECT', note });
            setRejecting(false);
            data.reload();
          }}
        />
      )}
    </>
  );
}

function ApproveDialog({ orgId, month, branchId, employees, net, onClose, onDone }: { orgId: string; month: string; branchId: string | null; employees: number; net: number; onClose: () => void; onDone: () => void }) {
  const { busy, error, submit } = useSubmit(async () => {
    await command('payroll-decide', { orgId, month, branchId, decision: 'APPROVE' });
    onDone();
    onClose();
  });
  return (
    <Dialog title={ht.approveRunTitle(monthName(month))} onClose={onClose} narrow>
      <form onSubmit={submit} noValidate>
        <p>{ht.approveRunBody(employees, rupees(net))}</p>
        <FormError error={error} />
        <DialogActions busy={busy} submitLabel={ht.approveRun} onCancel={onClose} />
      </form>
    </Dialog>
  );
}
