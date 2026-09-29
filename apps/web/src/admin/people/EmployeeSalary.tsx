// The Salary tab of an employee profile: salary versions and payslips.
import { useState } from 'react';

import { useAuth } from '../../auth/AuthContext';
import { branchScope } from '../../auth/claims';
import type { Employee } from '../../data/hr';
import { employeePayslips, money, salaryHistory } from '../../data/payroll';
import { ErrorState, SkeletonRows } from '../../shared/ui';
import { useAsync } from '../../shared/useAsync';
import { t } from '../../strings';
import { ht } from '../../strings/hr';
import { PayslipList, SalaryDialog } from './payrollKit';

export function EmployeeSalaryPanel({ orgId, employee, canView, canEdit, canSeePayslips }: { orgId: string; employee: Employee; canView: boolean; canEdit: boolean; canSeePayslips: boolean }) {
  const { claims, user } = useAuth();
  const self = !!employee.uid && employee.uid === user?.uid;
  const scope = branchScope(claims, orgId);
  const data = useAsync(async () => {
    const [salaries, slips] = await Promise.all([
      salaryHistory(orgId, employee.id, canView ? { scope } : { ownUid: employee.uid ?? undefined }),
      employeePayslips(orgId, employee.id, canSeePayslips ? { scope } : { ownUid: employee.uid ?? undefined }),
    ]);
    return { salaries, slips };
  }, [orgId, employee.id]);
  const [editing, setEditing] = useState(false);

  if (data.loading && !data.data) return <SkeletonRows />;
  if (data.error || !data.data) return <ErrorState message={data.error ?? t.errorGeneric} onRetry={data.reload} />;
  const { salaries, slips } = data.data;
  return (
    <>
      <section className="section" aria-labelledby="salary-title">
        <div className="page-header-row">
          <h2 id="salary-title">{ht.salary}</h2>
          {canEdit && !self && employee.status !== 'OFFBOARDED' && (
            <button type="button" className="btn btn-outlined" onClick={() => setEditing(true)}>
              {ht.salaryNew}
            </button>
          )}
        </div>
        {!salaries.length ? (
          <p className="muted">{ht.salaryEmpty}</p>
        ) : (
          salaries.map((s, i) => (
            <div key={s.id} className={i === 0 ? 'card' : 'card muted'}>
              <h3 className="row">
                {ht.salaryVersionFrom(s.effectiveFrom)} · {ht.monthlyGross(money(s.monthlyGross))}
              </h3>
              <dl className="facts">
                {s.earnings.map((c) => (
                  <div key={c.code} style={{ display: 'contents' }}>
                    <dt>
                      {c.name} ({c.code})
                    </dt>
                    <dd>{money(c.amount)}</dd>
                  </div>
                ))}
              </dl>
              <p className="muted small">
                {[ht.statutoryOptOut(s.pf, s.esi, s.pt), s.reason, s.updatedByEmail].filter(Boolean).join(' · ')}
              </p>
            </div>
          ))
        )}
      </section>
      <section className="section" aria-labelledby="payslips-title">
        <h2 id="payslips-title">{ht.payslips}</h2>
        <PayslipList orgId={orgId} slips={slips} />
      </section>
      {editing && <SalaryDialog orgId={orgId} employee={employee} latest={salaries[0] ?? null} onClose={() => setEditing(false)} onDone={data.reload} />}
    </>
  );
}
