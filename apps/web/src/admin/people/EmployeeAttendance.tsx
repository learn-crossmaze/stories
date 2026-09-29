// The Attendance tab of an employee profile: shift, weekly offs and the month's days.
import { useState } from 'react';

import { useAuth } from '../../auth/AuthContext';
import { branchScope } from '../../auth/claims';
import { type AttendanceRecord, employeeMonth, listShifts, monthIST } from '../../data/attendance';
import type { Employee } from '../../data/hr';
import { ErrorState, SkeletonRows } from '../../shared/ui';
import { useAsync } from '../../shared/useAsync';
import { ht } from '../../strings/hr';
import { AdjustDialog, MonthRecords, ShiftDialog } from './attendanceKit';

export function EmployeeAttendancePanel({ orgId, employee, canManage, onChanged }: { orgId: string; employee: Employee; canManage: boolean; onChanged: () => void }) {
  const { claims, user } = useAuth();
  const self = !!employee.uid && employee.uid === user?.uid;
  const [month, setMonth] = useState(monthIST());
  const records = useAsync(
    () => employeeMonth(orgId, employee.id, month, self && !canManage ? { ownUid: employee.uid ?? undefined } : { scope: branchScope(claims, orgId) }),
    [orgId, employee.id, month],
  );
  const shifts = useAsync(() => (canManage ? listShifts(orgId) : Promise.resolve([])), [orgId, canManage]);
  const [adjusting, setAdjusting] = useState<AttendanceRecord | null>(null);
  const [editingShift, setEditingShift] = useState(false);
  const offs = employee.weeklyOffs?.map((d) => ht.weekdays[d]).join(', ') ?? ht.branchDefault;

  return (
    <>
      <section className="card" aria-labelledby="att-shift">
        <h2 id="att-shift">{ht.setShift}</h2>
        <dl className="facts">
          <dt>{ht.setShift}</dt>
          <dd>{employee.shiftName ?? ht.noShift}</dd>
          <dt>{ht.weeklyOffs}</dt>
          <dd>{offs}</dd>
        </dl>
        {canManage && employee.status !== 'OFFBOARDED' && (
          <div className="row">
            <button type="button" className="btn btn-outlined" onClick={() => setEditingShift(true)}>
              {ht.changeShift}
            </button>
          </div>
        )}
      </section>
      <section className="section" aria-labelledby="att-month">
        <div className="page-header-row">
          <h2 id="att-month">{ht.tabMonth}</h2>
          <label className="field-inline">
            {ht.monthLabel}
            <input type="month" value={month} max={monthIST()} onChange={(e) => e.target.value && setMonth(e.target.value)} />
          </label>
        </div>
        {records.loading ? (
          <SkeletonRows />
        ) : records.error ? (
          <ErrorState message={records.error} onRetry={records.reload} />
        ) : (
          <MonthRecords records={records.data ?? []} onAdjust={canManage && !self ? setAdjusting : undefined} />
        )}
      </section>
      {adjusting && <AdjustDialog orgId={orgId} employee={employee} date={adjusting.date} record={adjusting} onClose={() => setAdjusting(null)} onDone={records.reload} />}
      {editingShift && (
        <ShiftDialog orgId={orgId} employee={employee} shifts={shifts.data ?? []} onClose={() => setEditingShift(false)} onDone={onChanged} />
      )}
    </>
  );
}
