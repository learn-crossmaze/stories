import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';

import { useAuth } from '../../auth/AuthContext';
import { branchScope, can } from '../../auth/claims';
import { command } from '../../data/api';
import { type Employee, EMPLOYEE_STATUSES, EMPLOYMENT_TYPES, type EmploymentType, listDesignations, listEmployees } from '../../data/hr';
import { listDepartments, listStaff, type Org } from '../../data/org';
import { todayIST } from '../../shared/dates';
import { useAsync } from '../../shared/useAsync';
import { paths } from '../../paths';
import { t } from '../../strings';
import { EmptyState, ErrorState, Icon, NoOrgState, SkeletonRows, TableWrap } from '../../shared/ui';
import { Dialog, DialogActions, FormError, SelectField, TextField, useSubmit } from '../components/Dialog';
import { ht } from '../../strings/hr';
import { Notice } from '../components/kit';
import { lt } from '../../strings/library';
import { grantableRoles } from '../grants';
import { RolesDialog } from '../organization/Staff';
import { useWorkspace } from '../Workspace';

const STATUS_TONE: Record<string, string> = {
  DRAFT: 'muted',
  ONBOARDING: 'info',
  ACTIVE: 'ok',
  NOTICE_PERIOD: 'warn',
  OFFBOARDING: 'warn',
  OFFBOARDED: 'muted',
};

export function EmployeeStatusBadge({ status }: { status: string }) {
  return <span className={`badge badge-${STATUS_TONE[status] ?? 'muted'}`}>{ht.status[status] ?? status}</span>;
}

const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);

/** Create (DRAFT record) or edit an employee's details and job placement. */
export function EmployeeDialog({
  org,
  employee,
  onClose,
  onSaved,
}: {
  org: Org;
  employee?: Employee;
  onClose: () => void;
  /** For a new record, also its email, branch and whether a Stories account was linked. */
  onSaved: (id: string, added?: { email: string; branchId: string | null; linked: boolean }) => void;
}) {
  const { claims } = useAuth();
  const { branches } = useWorkspace();
  const scope = branchScope(claims, org.id);
  const lists = useAsync(async () => {
    const [designations, departments, people] = await Promise.all([listDesignations(org.id), listDepartments(org.id), listEmployees(org.id, scope)]);
    return { designations, departments, people };
  }, [org.id]);

  const [fullName, setFullName] = useState(employee?.fullName ?? '');
  const [email, setEmail] = useState(employee?.email ?? '');
  const [phone, setPhone] = useState(employee?.phone ?? '');
  const [code, setCode] = useState('');
  const [branchId, setBranchId] = useState(employee ? (employee.branchId ?? '') : scope === 'ALL' ? '' : scope[0]);
  const [departmentId, setDepartmentId] = useState(employee?.departmentId ?? '');
  const [designationId, setDesignationId] = useState(employee?.designationId ?? '');
  const [managerId, setManagerId] = useState(employee?.managerId ?? '');
  const [employmentType, setEmploymentType] = useState<EmploymentType>(employee?.employmentType ?? 'FULL_TIME');
  const [joiningDate, setJoiningDate] = useState(employee?.joiningDate ?? '');
  const [effectiveDate, setEffectiveDate] = useState(todayIST);
  const [note, setNote] = useState('');
  const [touched, setTouched] = useState(false);

  const linked = !!employee?.uid;
  const errors = {
    fullName: fullName.trim().length >= 2 ? undefined : t.required,
    email: !email.trim() || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim()) ? undefined : 'Enter a valid email address.',
    phone: !phone.trim() || /^\+?[0-9 ]{8,16}$/.test(phone.trim()) ? undefined : 'Enter a valid phone number.',
    code: !code.trim() || /^[A-Za-z0-9-]{2,24}$/.test(code.trim()) ? undefined : 'Use 2–24 letters, digits or dashes.',
    joiningDate: !joiningDate || isDate(joiningDate) ? undefined : 'Enter a date.',
  };
  const branchChoices = branches.filter((b) => b.status === 'ACTIVE' && (scope === 'ALL' || scope.includes(b.id)));
  const departments = (lists.data?.departments ?? []).filter(
    (d) => (d.status === 'ACTIVE' || d.id === departmentId) && (!d.branchId || d.branchId === branchId),
  );
  const designations = (lists.data?.designations ?? []).filter((d) => d.status === 'ACTIVE' || d.id === designationId);
  const managers = (lists.data?.people ?? []).filter((p) => p.id !== employee?.id && p.status !== 'OFFBOARDED');

  const { busy, error, submit } = useSubmit(async () => {
    setTouched(true);
    if (Object.values(errors).some(Boolean)) return;
    const body = {
      orgId: org.id,
      fullName: fullName.trim(),
      email: linked ? '' : email.trim(),
      phone: phone.trim(),
      branchId: branchId || null,
      departmentId: departmentId || null,
      designationId: designationId || null,
      managerId: managerId || null,
      employmentType,
      joiningDate: joiningDate || null,
    };
    if (employee) {
      await command('employees-update', { ...body, employeeId: employee.id, effectiveDate, note: note.trim() });
      onSaved(employee.id);
    } else {
      const res = await command<{ employeeId: string; linked: boolean }>('employees-create', { ...body, employeeId: code.trim().toUpperCase() });
      onSaved(res.employeeId, { email: body.email, branchId: body.branchId, linked: res.linked });
    }
    onClose();
  });

  return (
    <Dialog title={employee ? ht.editDetails : ht.addEmployee} onClose={onClose}>
      {lists.loading ? (
        <SkeletonRows rows={4} />
      ) : (
        <form onSubmit={submit} noValidate>
          <div className="form-grid">
            <TextField label={ht.fullName} value={fullName} onChange={setFullName} error={touched ? errors.fullName : undefined} autoComplete="off" />
            {employee ? (
              <TextField
                label={ht.workEmail}
                type="email"
                value={email}
                onChange={setEmail}
                disabled={linked}
                hint={linked ? ht.linkedEmailHint : undefined}
                error={touched ? errors.email : undefined}
              />
            ) : (
              <TextField
                label={ht.workEmail}
                type="email"
                value={email}
                onChange={setEmail}
                hint={ht.workEmailHint}
                error={touched ? errors.email : undefined}
              />
            )}
            <TextField label={ht.phone} type="tel" value={phone} onChange={setPhone} error={touched ? errors.phone : undefined} />
            {!employee && (
              <TextField label={lt.employeeId} value={code} onChange={setCode} hint={ht.employeeIdHint} error={touched ? errors.code : undefined} />
            )}
            <SelectField
              label={ht.branch}
              value={branchId}
              onChange={(v) => {
                setBranchId(v);
                setDepartmentId('');
              }}
              options={[...(scope === 'ALL' ? [{ value: '', label: ht.headOffice }] : []), ...branchChoices.map((b) => ({ value: b.id, label: b.name }))]}
            />
            <SelectField
              label={ht.department}
              value={departmentId}
              onChange={setDepartmentId}
              options={[{ value: '', label: ht.none }, ...departments.map((d) => ({ value: d.id, label: d.name }))]}
            />
            <SelectField
              label={ht.designation}
              value={designationId}
              onChange={setDesignationId}
              options={[{ value: '', label: ht.none }, ...designations.map((d) => ({ value: d.id, label: d.name }))]}
            />
            <SelectField
              label={ht.manager}
              value={managerId}
              onChange={setManagerId}
              options={[{ value: '', label: ht.none }, ...managers.map((p) => ({ value: p.id, label: `${p.fullName} (${p.code})` }))]}
            />
            <SelectField
              label={ht.employmentTypeLabel}
              value={employmentType}
              onChange={setEmploymentType}
              options={EMPLOYMENT_TYPES.map((v) => ({ value: v, label: ht.employmentType[v] }))}
            />
            <TextField label={ht.joiningDate} type="date" value={joiningDate} onChange={setJoiningDate} error={touched ? errors.joiningDate : undefined} />
            {employee && (
              <>
                <TextField label={ht.effectiveDate} type="date" value={effectiveDate} onChange={setEffectiveDate} hint={ht.effectiveHint} />
                <TextField label={ht.changeNote} value={note} onChange={setNote} />
              </>
            )}
          </div>
          <FormError error={error ?? lists.error} />
          <DialogActions busy={busy} submitLabel={employee ? t.save : ht.addEmployee} onCancel={onClose} />
        </form>
      )}
    </Dialog>
  );
}

export function PeoplePage() {
  const { claims } = useAuth();
  const { org, branches, branchName } = useWorkspace();
  const navigate = useNavigate();
  const scope = org ? branchScope(claims, org.id) : 'ALL';
  const people = useAsync(() => (org ? listEmployees(org.id, scope) : Promise.resolve([])), [org?.id, JSON.stringify(scope)]);
  const canEdit = !!org && can(claims, 'employees.edit', org.id);
  const canAdd = !!org && can(claims, 'employees.add', org.id);
  // After adding someone with a Stories account: the optional "give access" step.
  const [access, setAccess] = useState<{ id: string; email: string; branchId: string | null } | null>(null);
  const canGrant = !!org && can(claims, 'staff.manageRoles', org.id) && grantableRoles(claims, org.id, org.type).length > 0;
  // Staff with roles but no record (added before People existed); org-wide editors can fix it.
  const unrecorded = useAsync(async () => {
    if (!org || !canEdit || scope !== 'ALL' || !can(claims, 'staff.view', org.id)) return 0;
    const [staff, recs] = await Promise.all([listStaff(org.id, 'ALL'), listEmployees(org.id, 'ALL')]);
    const have = new Set(recs.map((r) => r.uid));
    return staff.filter((s) => s.status === 'ACTIVE' && !have.has(s.uid)).length;
  }, [org?.id, people.data]);

  const [q, setQ] = useState('');
  const [status, setStatus] = useState<string>('CURRENT');
  const [branchFilter, setBranchFilter] = useState('');
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const backfill = useSubmit(async () => {
    if (!org) return;
    const res = await command<{ created: number; linked: number }>('employees-backfill', { orgId: org.id });
    setNotice(ht.backfillDone(res.created, res.linked));
    people.reload();
  });

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const p of people.data ?? []) c[p.status] = (c[p.status] ?? 0) + 1;
    return c;
  }, [people.data]);
  const shown = (people.data ?? []).filter((p) => {
    if (status === 'CURRENT' ? p.status === 'OFFBOARDED' : status && p.status !== status) return false;
    if (branchFilter && (branchFilter === 'HO' ? p.branchId !== null : p.branchId !== branchFilter)) return false;
    const s = q.trim().toLowerCase();
    return !s || p.fullName.toLowerCase().includes(s) || p.code.toLowerCase().includes(s) || (p.email ?? '').includes(s);
  });

  if (!org) return <NoOrgState />;
  const branchOptions = branches.filter((b) => scope === 'ALL' || scope.includes(b.id));

  return (
    <>
      <header className="page-header page-header-row">
        <div>
          <h1>{ht.employeesTitle}</h1>
          <p className="muted">{ht.employeesIntro}</p>
        </div>
        {canAdd && (
          <button type="button" className="btn btn-filled" onClick={() => setAdding(true)}>
            <Icon name="plus" /> {ht.addEmployee}
          </button>
        )}
      </header>
      {notice && <Notice tone="ok">{notice}</Notice>}
      {!!unrecorded.data && (
        <section className="card callout">
          <h2>{ht.backfillTitle(unrecorded.data)}</h2>
          <p className="muted">{ht.backfillBody}</p>
          <div className="row">
            <button type="button" className="btn btn-filled" disabled={backfill.busy} onClick={() => backfill.submit()}>
              {backfill.busy ? t.loading : ht.backfillAction}
            </button>
          </div>
          <FormError error={backfill.error} />
        </section>
      )}

      <div className="filter-chips" role="group" aria-label={ht.colStatus}>
        {(['CURRENT', ...EMPLOYEE_STATUSES] as string[]).map((s) => (
          <button key={s} type="button" className="chip" aria-pressed={status === s} onClick={() => setStatus(s)}>
            {s === 'CURRENT' ? ht.allStatuses : ht.status[s]}
            <span className="chip-count">{s === 'CURRENT' ? (people.data ?? []).filter((p) => p.status !== 'OFFBOARDED').length : (counts[s] ?? 0)}</span>
          </button>
        ))}
      </div>
      <div className="toolbar">
        <input
          className="search"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={ht.searchEmployees}
          aria-label={ht.searchEmployees}
        />
        {branchOptions.length > 1 || scope === 'ALL' ? (
          <select value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)} aria-label={ht.branch}>
            <option value="">{ht.allBranchesFilter}</option>
            {scope === 'ALL' && <option value="HO">{ht.headOffice}</option>}
            {branchOptions.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        ) : null}
      </div>

      {people.loading ? (
        <SkeletonRows />
      ) : people.error ? (
        <ErrorState message={people.error} onRetry={people.reload} />
      ) : !shown.length ? (
        <EmptyState icon="people" title={people.data?.length ? ht.noEmployees : ht.noEmployeesYet} message="" />
      ) : (
        <TableWrap>
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{ht.colName}</th>
                <th scope="col">{lt.employeeId}</th>
                <th scope="col">{ht.colDesignation}</th>
                <th scope="col">{ht.colBranch}</th>
                <th scope="col">{ht.colJoined}</th>
                <th scope="col">{ht.colStatus}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((p) => (
                <tr key={p.id}>
                  <td>
                    <Link to={paths.adminEmployee(p.id)}>{p.fullName}</Link>
                    <div className="muted small">{p.email ?? ''}</div>
                  </td>
                  <td className="mono nowrap">{p.code}</td>
                  <td>
                    {p.designationName ?? '—'}
                    {p.departmentName && <div className="muted small">{p.departmentName}</div>}
                  </td>
                  <td>{p.branchId ? branchName(p.branchId) : ht.headOffice}</td>
                  <td className="nowrap">{p.joiningDate ?? '—'}</td>
                  <td>
                    <EmployeeStatusBadge status={p.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
      {adding && (
        <EmployeeDialog
          org={org}
          onClose={() => setAdding(false)}
          onSaved={(id, added) => (added?.linked && added.email && canGrant ? setAccess({ id, email: added.email, branchId: added.branchId }) : navigate(paths.adminEmployee(id)))}
        />
      )}
      {access && (
        <RolesDialog
          org={org}
          email={access.email}
          branchIds={access.branchId ? [access.branchId] : []}
          title={ht.accessStepTitle}
          intro={ht.accessStepIntro}
          cancelLabel={ht.accessStepSkip}
          onClose={() => navigate(paths.adminEmployee(access.id))}
          onSaved={() => undefined}
        />
      )}
    </>
  );
}
