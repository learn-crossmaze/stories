import { useState } from 'react';
import { Link, useParams } from 'react-router';

import { useAuth } from '../../auth/AuthContext';
import { branchScope, can } from '../../auth/claims';
import { command } from '../../data/api';
import {
  type ChecklistItem,
  type Employee,
  getEmployee,
  getPrivateProfile,
  listHistory,
  NEXT_STEPS,
  type PrivateProfile,
  type Transition,
} from '../../data/hr';
import { listStaff, type Org } from '../../data/org';
import { useAsync } from '../../data/useAsync';
import { day, when } from '../../format';
import { ROLES } from '../../generated/rbac';
import type { Permission } from '../../generated/rbac';
import { paths } from '../../paths';
import { t } from '../../strings';
import { EmptyState, ErrorState, SkeletonRows } from '../../ui';
import { Dialog, DialogActions, FormError, SelectField, TextArea, TextField, useSubmit } from '../Dialog';
import { ht } from '../hrStrings';
import { Notice, Tabs } from '../kit';
import { lt } from '../libraryStrings';
import { useWorkspace } from '../Workspace';
import { EmployeeDialog, EmployeeStatusBadge } from './People';
import { RolesDialog } from './Staff';

type Tab = 'overview' | 'personal' | 'bank' | 'lifecycle' | 'history' | 'access';

const Fact = ({ label, value }: { label: string; value: React.ReactNode }) => (
  <>
    <dt>{label}</dt>
    <dd>{value || <span className="muted">{ht.notSet}</span>}</dd>
  </>
);

function PersonalDialog({
  orgId,
  employee,
  profile,
  onClose,
  onSaved,
}: {
  orgId: string;
  employee: Employee;
  profile: PrivateProfile;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [f, setF] = useState({
    dob: profile.dob ?? '',
    gender: profile.gender ?? '',
    bloodGroup: profile.bloodGroup ?? '',
    personalEmail: profile.personalEmail ?? '',
    personalPhone: profile.personalPhone ?? '',
    currentAddress: profile.currentAddress ?? '',
    permanentAddress: profile.permanentAddress ?? '',
    emergencyName: profile.emergencyName ?? '',
    emergencyRelation: profile.emergencyRelation ?? '',
    emergencyPhone: profile.emergencyPhone ?? '',
    pan: profile.pan ?? '',
    uan: profile.uan ?? '',
    esiNumber: profile.esiNumber ?? '',
  });
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));
  const { busy, error, submit } = useSubmit(async () => {
    await command('employees-setPrivate', { orgId, employeeId: employee.id, ...Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v.trim()])) });
    onSaved();
    onClose();
  });
  return (
    <Dialog title={ht.editPersonal} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <div className="form-grid">
          <TextField label={ht.dob} type="date" value={f.dob} onChange={set('dob')} />
          <SelectField
            label={ht.gender}
            value={f.gender}
            onChange={set('gender')}
            options={Object.entries(ht.genders).map(([value, label]) => ({ value, label }))}
          />
          <TextField label={ht.bloodGroup} value={f.bloodGroup} onChange={set('bloodGroup')} />
          <TextField label={ht.personalEmail} type="email" value={f.personalEmail} onChange={set('personalEmail')} />
          <TextField label={ht.personalPhone} type="tel" value={f.personalPhone} onChange={set('personalPhone')} />
          <TextField label={ht.pan} value={f.pan} onChange={set('pan')} />
          <TextField label={ht.uan} value={f.uan} onChange={set('uan')} />
          <TextField label={ht.esiNumber} value={f.esiNumber} onChange={set('esiNumber')} />
          <TextField label={ht.emergencyName} value={f.emergencyName} onChange={set('emergencyName')} />
          <TextField label={ht.emergencyRelation} value={f.emergencyRelation} onChange={set('emergencyRelation')} />
          <TextField label={ht.emergencyPhone} type="tel" value={f.emergencyPhone} onChange={set('emergencyPhone')} />
        </div>
        <TextArea label={ht.currentAddress} value={f.currentAddress} onChange={set('currentAddress')} rows={2} />
        <TextArea label={ht.permanentAddress} value={f.permanentAddress} onChange={set('permanentAddress')} rows={2} />
        <FormError error={error} />
        <DialogActions busy={busy} submitLabel={t.save} onCancel={onClose} />
      </form>
    </Dialog>
  );
}

function BankDialog({
  orgId,
  employee,
  profile,
  onClose,
  onSaved,
}: {
  orgId: string;
  employee: Employee;
  profile: PrivateProfile;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [accountHolder, setHolder] = useState(profile.bank?.accountHolder ?? employee.fullName);
  const [accountNumber, setNumber] = useState('');
  const [ifsc, setIfsc] = useState(profile.bank?.ifsc ?? '');
  const [bankName, setBankName] = useState(profile.bank?.bankName ?? '');
  const [touched, setTouched] = useState(false);
  const errors = {
    accountHolder: accountHolder.trim().length >= 2 ? undefined : t.required,
    accountNumber: /^\d{9,18}$/.test(accountNumber.trim()) ? undefined : 'Enter 9–18 digits.',
    ifsc: /^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc.trim().toUpperCase()) ? undefined : 'Enter a valid IFSC, e.g. HDFC0001234.',
    bankName: bankName.trim().length >= 2 ? undefined : t.required,
  };
  const { busy, error, submit } = useSubmit(async () => {
    setTouched(true);
    if (Object.values(errors).some(Boolean)) return;
    await command('employees-setBank', {
      orgId,
      employeeId: employee.id,
      accountHolder: accountHolder.trim(),
      accountNumber: accountNumber.trim(),
      ifsc: ifsc.trim().toUpperCase(),
      bankName: bankName.trim(),
    });
    onSaved();
    onClose();
  });
  return (
    <Dialog title={profile.bank ? ht.bankEdit : ht.bankAdd} onClose={onClose} narrow>
      <form onSubmit={submit} noValidate>
        <TextField label={ht.accountHolder} value={accountHolder} onChange={setHolder} error={touched ? errors.accountHolder : undefined} />
        <TextField label={ht.accountNumber} value={accountNumber} onChange={setNumber} autoComplete="off" error={touched ? errors.accountNumber : undefined} />
        <TextField label={ht.ifsc} value={ifsc} onChange={setIfsc} error={touched ? errors.ifsc : undefined} />
        <TextField label={ht.bankName} value={bankName} onChange={setBankName} error={touched ? errors.bankName : undefined} />
        <FormError error={error} />
        <DialogActions busy={busy} submitLabel={t.save} onCancel={onClose} />
      </form>
    </Dialog>
  );
}

function TransitionDialog({
  orgId,
  employee,
  step,
  onClose,
  onDone,
}: {
  orgId: string;
  employee: Employee;
  step: Transition;
  onClose: () => void;
  onDone: () => void;
}) {
  const dateLabel = ht.stepDate[step];
  const needsReason = step === 'RESIGN' || step === 'START_OFFBOARDING';
  const initialDate = step === 'ACTIVATE' ? (employee.joiningDate ?? '') : step === 'START_OFFBOARDING' ? (employee.noticeEndDate ?? '') : '';
  const [date, setDate] = useState(initialDate);
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const dateRequired = step === 'RESIGN' || step === 'ACTIVATE' || step === 'START_OFFBOARDING';
  const errors = {
    date: dateRequired && !date ? t.required : undefined,
    reason: needsReason && reason.trim().length < 3 ? t.required : undefined,
  };
  const { busy, error, submit } = useSubmit(async () => {
    setTouched(true);
    if (errors.date || errors.reason) return;
    await command('employees-transition', { orgId, employeeId: employee.id, transition: step, ...(date ? { date } : {}), reason: reason.trim() });
    onDone();
    onClose();
  });
  return (
    <Dialog title={`${ht.steps[step]} · ${employee.fullName}`} onClose={onClose} narrow>
      <form onSubmit={submit} noValidate>
        <p className="muted">{ht.stepHelp[step]}</p>
        {dateLabel && <TextField label={dateLabel} type="date" value={date} onChange={setDate} error={touched ? errors.date : undefined} />}
        {(needsReason || step === 'WITHDRAW_RESIGNATION' || step === 'REHIRE') && (
          <TextField label={needsReason ? ht.reason : ht.changeNote} value={reason} onChange={setReason} error={touched ? errors.reason : undefined} />
        )}
        <FormError error={error} />
        <DialogActions busy={busy} submitLabel={ht.steps[step]} onCancel={onClose} danger={step === 'COMPLETE_OFFBOARDING'} />
      </form>
    </Dialog>
  );
}

function Checklist({
  orgId,
  employee,
  list,
  editable,
  onChanged,
}: {
  orgId: string;
  employee: Employee;
  list: 'onboarding' | 'offboarding';
  editable: boolean;
  onChanged: () => void;
}) {
  const items = (employee[list] ?? []) as ChecklistItem[];
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Shows the tick at once; undone if the server refuses.
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const isDone = (i: ChecklistItem) => pending[i.key] ?? i.done;
  const done = items.filter(isDone).length;
  return (
    <section className="card">
      <h2>
        {list === 'onboarding' ? ht.onboardingChecklist : ht.offboardingChecklist}{' '}
        <span className="muted small">
          {done}/{items.length}
        </span>
      </h2>
      <ul className="checklist">
        {items.map((i) => (
          <li key={i.key}>
            <label className="check">
              <input
                type="checkbox"
                checked={isDone(i)}
                disabled={!editable || busyKey !== null}
                onChange={async (e) => {
                  const value = e.target.checked;
                  setBusyKey(i.key);
                  setError(null);
                  setPending((p) => ({ ...p, [i.key]: value }));
                  try {
                    await command('employees-checkItem', { orgId, employeeId: employee.id, list, key: i.key, done: value });
                    onChanged();
                  } catch (err) {
                    setPending(({ [i.key]: _, ...rest }) => rest);
                    setError(err instanceof Error ? err.message : t.errorGeneric);
                  } finally {
                    setBusyKey(null);
                  }
                }}
              />
              <span>
                {i.label}
                {i.required && <span className="badge badge-warn"> {ht.required}</span>}
                {isDone(i) && i.doneBy && <span className="muted small"> · {ht.doneBy(i.doneBy, i.doneAt ? when(new Date(i.doneAt)) : '')}</span>}
              </span>
            </label>
          </li>
        ))}
      </ul>
      <FormError error={error} />
    </section>
  );
}

function BankPanel({
  orgId,
  employee,
  profile,
  canEdit,
  onSaved,
}: {
  orgId: string;
  employee: Employee;
  profile: PrivateProfile;
  canEdit: boolean;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [full, setFull] = useState<string | null>(null);
  const reveal = useSubmit(async () => {
    const res = await command<{ accountNumber: string }>('employees-revealBank', { orgId, employeeId: employee.id });
    setFull(res.accountNumber);
  });
  const bank = profile.bank;
  return (
    <section className="card">
      <h2>{ht.bankTitle}</h2>
      {bank ? (
        <dl className="facts">
          <Fact label={ht.accountHolder} value={bank.accountHolder} />
          <Fact label={ht.accountNumber} value={<span className="mono">{full ?? ht.masked(bank.last4)}</span>} />
          <Fact label={ht.ifsc} value={<span className="mono">{bank.ifsc}</span>} />
          <Fact label={ht.bankName} value={bank.bankName} />
        </dl>
      ) : (
        <p className="muted">{ht.bankNone}</p>
      )}
      {canEdit && (
        <div className="row">
          <button type="button" className="btn btn-outlined" onClick={() => setEditing(true)}>
            {bank ? ht.bankEdit : ht.bankAdd}
          </button>
          {bank &&
            (full ? (
              <button type="button" className="btn btn-text" onClick={() => setFull(null)}>
                {ht.hide}
              </button>
            ) : (
              <button type="button" className="btn btn-text" disabled={reveal.busy} onClick={() => reveal.submit()} title={ht.revealNote}>
                {ht.reveal}
              </button>
            ))}
        </div>
      )}
      {canEdit && bank && !full && <p className="muted small">{ht.revealNote}</p>}
      <FormError error={reveal.error} />
      {editing && <BankDialog orgId={orgId} employee={employee} profile={profile} onClose={() => setEditing(false)} onSaved={onSaved} />}
    </section>
  );
}

function AccessPanel({ org, employee, onChanged }: { org: Org; employee: Employee; onChanged: () => void }) {
  const { claims } = useAuth();
  const { branchName } = useWorkspace();
  const canStaff = can(claims, 'staff.view', org.id);
  const membership = useAsync(async () => {
    if (!employee.uid || !canStaff) return null;
    return (await listStaff(org.id, 'ALL').catch(() => [])).find((m) => m.uid === employee.uid) ?? null;
  }, [org.id, employee.uid]);
  const [linking, setLinking] = useState(false);
  const [roles, setRoles] = useState(false);
  const [email, setEmail] = useState(employee.email ?? '');
  const canEdit = can(claims, 'employees.edit', org.id);
  const link = useSubmit(async () => {
    await command('employees-linkAccount', { orgId: org.id, employeeId: employee.id, email: email.trim() });
    setLinking(false);
    onChanged();
  });
  const m = membership.data;
  return (
    <section className="card">
      <h2>{ht.accessTitle}</h2>
      <p>{employee.uid ? ht.accountLinked(employee.email ?? '') : ht.accountNotLinked}</p>
      {!employee.uid && canEdit && employee.status !== 'OFFBOARDED' && (
        <div className="row">
          <button type="button" className="btn btn-outlined" onClick={() => setLinking(true)}>
            {ht.linkAccount}
          </button>
        </div>
      )}
      {employee.uid && canStaff && (
        <>
          <h3>{ht.rolesHere}</h3>
          {membership.loading ? (
            <SkeletonRows rows={1} />
          ) : m && m.status === 'ACTIVE' && m.roles.length ? (
            <p>
              {m.roles.map((r) => ROLES[r]?.label ?? r).join(', ')} · {m.branchIds.includes('*') ? t.allBranches : m.branchIds.map(branchName).join(', ')}
            </p>
          ) : (
            <p className="muted">{employee.status === 'OFFBOARDED' ? ht.rolesOffboarded : ht.noRoles}</p>
          )}
          {can(claims, 'staff.manageRoles', org.id) && employee.status !== 'OFFBOARDED' && (
            <div className="row">
              <button type="button" className="btn btn-outlined" onClick={() => setRoles(true)}>
                {ht.manageRoles}
              </button>
              <Link className="btn btn-text" to={paths.adminStaff}>
                {t.navStaff}
              </Link>
            </div>
          )}
        </>
      )}
      {linking && (
        <Dialog title={ht.linkAccount} onClose={() => setLinking(false)} narrow>
          <form onSubmit={link.submit} noValidate>
            <TextField label={ht.linkEmail} type="email" value={email} onChange={setEmail} hint={ht.linkHint} />
            <FormError error={link.error} />
            <DialogActions busy={link.busy} submitLabel={ht.linkAccount} onCancel={() => setLinking(false)} />
          </form>
        </Dialog>
      )}
      {roles && (
        <RolesDialog
          org={org}
          member={m ?? undefined}
          email={m ? undefined : (employee.email ?? undefined)}
          onClose={() => setRoles(false)}
          onSaved={() => {
            membership.reload();
            onChanged();
          }}
        />
      )}
    </section>
  );
}

const show = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : (ht.status[String(v)] ?? ht.employmentType[String(v)] ?? String(v)));

export function EmployeeProfilePage() {
  const { employeeId = '' } = useParams();
  const { claims, user } = useAuth();
  const { org, branchName } = useWorkspace();
  const orgId = org?.id ?? '';
  const employee = useAsync(() => (orgId ? getEmployee(orgId, employeeId) : Promise.resolve(null)), [orgId, employeeId]);
  const e = employee.data;
  // Records without a branch (head office) need the permission across all branches.
  const perm = (p: Permission) => !!e && (e.branchId ? can(claims, p, orgId, e.branchId) : can(claims, p, orgId) && branchScope(claims, orgId) === 'ALL');
  const canPrivate = !!e && perm('employees.privateData');
  const canBank = !!e && perm('employees.bank');
  const profile = useAsync(
    () => (e && (canPrivate || canBank) ? getPrivateProfile(orgId, e.id) : Promise.resolve({} as PrivateProfile)),
    [orgId, e?.id, canPrivate, canBank],
  );
  const history = useAsync(() => (e ? listHistory(orgId, e.id) : Promise.resolve([])), [orgId, e?.id, employee.data]);
  const [tab, setTab] = useState<Tab>('overview');
  const [dialog, setDialog] = useState<'edit' | 'personal' | Transition | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (!org) return <EmptyState icon="building" title={t.noOrgTitle} message={t.noOrgMessage} />;
  if (employee.loading) return <SkeletonRows rows={5} />;
  if (employee.error) return <ErrorState message={employee.error} onRetry={employee.reload} />;
  if (!e) return <EmptyState icon="person" title={t.notFoundTitle} message="" />;

  const canEdit = perm('employees.edit') && e.status !== 'OFFBOARDED';
  const canLifecycle = perm('employees.lifecycle');
  const refresh = () => {
    employee.reload();
    profile.reload();
  };
  const p = profile.data ?? {};
  const openList = e.status === 'ONBOARDING' ? 'onboarding' : e.status === 'OFFBOARDING' ? 'offboarding' : null;

  return (
    <>
      <p className="breadcrumb">
        <Link to={paths.adminPeople}>{ht.employeesTitle}</Link> / <span className="mono">{e.code}</span>
      </p>
      <header className="page-header page-header-row">
        <div>
          <h1>{e.fullName}</h1>
          <p className="muted">
            <span className="mono">{e.code}</span> · {e.designationName ?? ht.notSet} · {e.branchId ? branchName(e.branchId) : ht.headOffice}
          </p>
          {e.status === 'NOTICE_PERIOD' && e.noticeEndDate && <p>{ht.noticeUntil(e.noticeEndDate)}</p>}
          {(e.status === 'OFFBOARDING' || e.status === 'OFFBOARDED') && e.exitDate && <p>{ht.exitOn(e.exitDate)}</p>}
        </div>
        <div className="row">
          <EmployeeStatusBadge status={e.status} />
          {canEdit && (
            <button type="button" className="btn btn-outlined" onClick={() => setDialog('edit')}>
              {ht.editDetails}
            </button>
          )}
        </div>
      </header>
      {notice && <Notice tone="ok">{notice}</Notice>}

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'overview' as const, label: ht.tabOverview },
          ...(canPrivate || e.uid === user?.uid ? [{ value: 'personal' as const, label: ht.tabPersonal }] : []),
          ...(canBank ? [{ value: 'bank' as const, label: ht.tabBank }] : []),
          { value: 'lifecycle' as const, label: ht.tabLifecycle },
          { value: 'history' as const, label: ht.tabHistory, count: history.data?.length },
          { value: 'access' as const, label: ht.tabAccess },
        ]}
      />

      {tab === 'overview' && (
        <div className="panels">
          <section className="card">
            <h2>{ht.job}</h2>
            <dl className="facts">
              <Fact label={ht.designation} value={e.designationName} />
              <Fact label={ht.department} value={e.departmentName} />
              <Fact label={ht.branch} value={e.branchId ? branchName(e.branchId) : ht.headOffice} />
              <Fact label={ht.manager} value={e.managerId ? <Link to={paths.adminEmployee(e.managerId)}>{e.managerName}</Link> : null} />
              <Fact label={ht.employmentTypeLabel} value={ht.employmentType[e.employmentType]} />
              <Fact label={ht.joiningDate} value={e.joiningDate} />
            </dl>
          </section>
          <section className="card">
            <h2>{ht.contact}</h2>
            <dl className="facts">
              <Fact label={ht.workEmail} value={e.email} />
              <Fact label={ht.phone} value={e.phone} />
              <Fact label={lt.employeeId} value={<span className="mono">{e.code}</span>} />
            </dl>
          </section>
        </div>
      )}

      {tab === 'personal' && (
        <section className="card">
          <h2>{ht.personalTitle}</h2>
          {profile.loading ? (
            <SkeletonRows rows={3} />
          ) : profile.error ? (
            <ErrorState message={profile.error} onRetry={profile.reload} />
          ) : (
            <dl className="facts">
              <Fact label={ht.dob} value={p.dob ? day(new Date(p.dob)) : null} />
              <Fact label={ht.gender} value={p.gender ? ht.genders[p.gender] : null} />
              <Fact label={ht.bloodGroup} value={p.bloodGroup} />
              <Fact label={ht.personalEmail} value={p.personalEmail} />
              <Fact label={ht.personalPhone} value={p.personalPhone} />
              <Fact label={ht.currentAddress} value={p.currentAddress} />
              <Fact label={ht.permanentAddress} value={p.permanentAddress} />
              <Fact
                label={ht.emergency}
                value={p.emergencyName ? `${p.emergencyName}${p.emergencyRelation ? ` (${p.emergencyRelation})` : ''} · ${p.emergencyPhone ?? ''}` : null}
              />
              <Fact label={ht.pan} value={p.pan && <span className="mono">{p.pan}</span>} />
              <Fact label={ht.uan} value={p.uan && <span className="mono">{p.uan}</span>} />
              <Fact label={ht.esiNumber} value={p.esiNumber && <span className="mono">{p.esiNumber}</span>} />
            </dl>
          )}
          {canPrivate && e.status !== 'OFFBOARDED' && (
            <div className="row">
              <button type="button" className="btn btn-outlined" onClick={() => setDialog('personal')}>
                {ht.editPersonal}
              </button>
            </div>
          )}
        </section>
      )}

      {tab === 'bank' && canBank && <BankPanel orgId={orgId} employee={e} profile={p} canEdit={e.status !== 'OFFBOARDED'} onSaved={refresh} />}

      {tab === 'lifecycle' && (
        <>
          <section className="card">
            <h2>
              {ht.colStatus}: <EmployeeStatusBadge status={e.status} />
            </h2>
            {canLifecycle ? (
              <div className="row">
                {NEXT_STEPS[e.status].map((step, i) => (
                  <button
                    key={step}
                    type="button"
                    className={`btn ${i === 0 ? 'btn-filled' : 'btn-outlined'}`}
                    onClick={() => setDialog(step)}
                    disabled={e.uid === user?.uid && !claims.sa}
                  >
                    {ht.steps[step]}
                  </button>
                ))}
              </div>
            ) : (
              <p className="muted">{ht.noLifecycleAccess}</p>
            )}
          </section>
          {openList ? (
            <Checklist orgId={orgId} employee={e} list={openList} editable={canLifecycle} onChanged={employee.reload} />
          ) : (
            <>
              <p className="muted">{ht.checklistClosed}</p>
              {e.onboarding && e.status !== 'DRAFT' && <Checklist orgId={orgId} employee={e} list="onboarding" editable={false} onChanged={employee.reload} />}
              {e.offboarding && <Checklist orgId={orgId} employee={e} list="offboarding" editable={false} onChanged={employee.reload} />}
            </>
          )}
        </>
      )}

      {tab === 'history' &&
        (history.loading ? (
          <SkeletonRows />
        ) : history.error ? (
          <ErrorState message={history.error} onRetry={history.reload} />
        ) : !history.data?.length ? (
          <EmptyState icon="history" title={ht.historyEmpty} message="" />
        ) : (
          <ol className="timeline">
            {history.data.map((h) => (
              <li key={h.id}>
                <strong>{ht.historyType[h.type] ?? h.type}</strong> <span className="muted small">{ht.effective(h.effectiveDate)}</span>
                <div className="small">
                  {Object.entries(h.changes).map(([k, v]) => (
                    <div key={k}>
                      {ht.field[k] ?? k}: {k === 'branchId' ? (v.from ? branchName(String(v.from)) : ht.headOffice) : show(v.from)} →{' '}
                      {k === 'branchId' ? (v.to ? branchName(String(v.to)) : ht.headOffice) : show(v.to)}
                    </div>
                  ))}
                </div>
                {h.note && <p className="small">{h.note}</p>}
                <p className="muted small">
                  {h.byEmail ?? ''} · {h.at ? when(h.at) : ''}
                </p>
              </li>
            ))}
          </ol>
        ))}

      {tab === 'access' && <AccessPanel org={org} employee={e} onChanged={employee.reload} />}

      {dialog === 'edit' && (
        <EmployeeDialog
          org={org}
          employee={e}
          onClose={() => setDialog(null)}
          onSaved={() => {
            employee.reload();
            history.reload();
          }}
        />
      )}
      {dialog === 'personal' && <PersonalDialog orgId={orgId} employee={e} profile={p} onClose={() => setDialog(null)} onSaved={profile.reload} />}
      {dialog && dialog !== 'edit' && dialog !== 'personal' && (
        <TransitionDialog
          orgId={orgId}
          employee={e}
          step={dialog}
          onClose={() => setDialog(null)}
          onDone={() => {
            setNotice(`${ht.steps[dialog]} ✓`);
            employee.reload();
          }}
        />
      )}
    </>
  );
}
