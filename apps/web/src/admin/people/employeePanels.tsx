import { useState } from 'react';
import { Link } from 'react-router';

import { useAuth } from '../../auth/AuthContext';
import { branchScope, can } from '../../auth/claims';
import { command } from '../../data/api';
import { type ChecklistItem, type Employee, type PrivateProfile } from '../../data/hr';
import { listStaff, type Org } from '../../data/org';
import { useAsync } from '../../shared/useAsync';
import { when } from '../../shared/format';
import { ROLES } from '../../generated/rbac';
import { paths } from '../../paths';
import { t } from '../../strings';
import { SkeletonRows } from '../../shared/ui';
import { Dialog, DialogActions, FormError, TextField, useSubmit } from '../components/Dialog';
import { ht } from '../../strings/hr';
import { useWorkspace } from '../Workspace';
import { RolesDialog } from '../organization/Staff';
import { BankDialog } from './employeeDialogs';

// Panels on the employee profile: facts list, checklist, bank account and system access.
export const Fact = ({ label, value }: { label: string; value: React.ReactNode }) => (
  <>
    <dt>{label}</dt>
    <dd>{value || <span className="muted">{ht.notSet}</span>}</dd>
  </>
);

export function Checklist({
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

export function BankPanel({
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

export function AccessPanel({ org, employee, onChanged }: { org: Org; employee: Employee; onChanged: () => void }) {
  const { claims } = useAuth();
  const { branchName } = useWorkspace();
  const canStaff = can(claims, 'staff.view', org.id);
  const membership = useAsync(async () => {
    if (!employee.uid || !canStaff) return null;
    // Branch-scoped staff may only list memberships at their branches (the rules allow that query shape).
    return (await listStaff(org.id, branchScope(claims, org.id)).catch(() => [])).find((m) => m.uid === employee.uid) ?? null;
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
