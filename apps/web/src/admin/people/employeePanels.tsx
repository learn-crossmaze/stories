import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';

import { useAuth } from '../../auth/AuthContext';
import { branchScope, can } from '../../auth/claims';
import { call, command, errorText } from '../../data/api';
import { type ChecklistItem, type Employee, type PrivateProfile } from '../../data/hr';
import { getStaffMember, type Org } from '../../data/org';
import { useAsync } from '../../shared/useAsync';
import { when } from '../../shared/format';
import { ROLES } from '../../generated/rbac';
import { paths } from '../../paths';
import { t } from '../../strings';
import { Badge, SkeletonRows } from '../../shared/ui';
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

/**
 * Checklist ticks on their way to the server, per employee. They go one after another: each rewrites the whole
 * list from the record it reads, so two at once would only collide and retry. Kept outside the component, so
 * ticks still waiting are sent when the tab is switched.
 */
const tickQueues = new Map<string, Promise<void>>();

/**
 * `onChanged` refreshes the record: once after a burst of ticks, not after each. `onSaving` tells the page
 * while ticks are on their way (a status change pressed then would not see them yet).
 */
export function Checklist({
  orgId,
  employee,
  list,
  editable,
  onChanged,
  onSaving,
}: {
  orgId: string;
  employee: Employee;
  list: 'onboarding' | 'offboarding';
  editable: boolean;
  onChanged: () => void;
  onSaving?: (saving: boolean) => void;
}) {
  const items = (employee[list] ?? []) as ChecklistItem[];
  const [error, setError] = useState<string | null>(null);
  // Shows the tick at once; undone if the server refuses.
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(0);
  // Goes up when a tick fails: the ticks waiting behind it are dropped, not sent.
  const round = useRef(0);
  const latest = useRef({ onChanged, onSaving });
  latest.current = { onChanged, onSaving };
  // A fresh record with nothing on its way: the boxes follow the record again. (Not sooner, or a tick would flicker back.)
  useEffect(() => {
    if (!inFlight.current) setPending((p) => (Object.keys(p).length ? {} : p));
  }, [employee]);

  const tick = (key: string, value: boolean) => {
    const queue = `${orgId}/${employee.id}`;
    const mine = round.current;
    // Its own request each time: tick, untick, tick of one box must never replay the first answer.
    const requestId = crypto.randomUUID();
    const undo = () => setPending(({ [key]: _, ...rest }) => rest);
    setError(null);
    setPending((p) => ({ ...p, [key]: value }));
    inFlight.current += 1;
    if (inFlight.current === 1) {
      setSaving(true);
      latest.current.onSaving?.(true);
    }
    const sent = (tickQueues.get(queue) ?? Promise.resolve())
      .then(async () => {
        if (mine !== round.current) return undo();
        try {
          await command('employees-checkItem', { orgId, employeeId: employee.id, list, key, done: value }, requestId);
        } catch (err) {
          round.current += 1;
          undo();
          setError(errorText(err));
        }
      })
      .then(() => {
        if (tickQueues.get(queue) === sent) tickQueues.delete(queue);
        inFlight.current -= 1;
        if (inFlight.current) return;
        setSaving(false);
        latest.current.onSaving?.(false);
        // After a refusal this also puts the boxes back to what the server has.
        latest.current.onChanged();
      });
    tickQueues.set(queue, sent);
  };
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
              <input type="checkbox" checked={isDone(i)} disabled={!editable} onChange={(e) => tick(i.key, e.target.checked)} />
              <span>
                {i.label}
                {i.required && <Badge tone="warn"> {ht.required}</Badge>}
                {isDone(i) && i.doneBy && <span className="muted small"> · {ht.doneBy(i.doneBy, i.doneAt ? when(new Date(i.doneAt)) : '')}</span>}
              </span>
            </label>
          </li>
        ))}
      </ul>
      {saving && (
        <p className="muted small" role="status">
          {t.saving}
        </p>
      )}
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
    const res = await call<{ accountNumber: string }>('employees-revealBank', { orgId, employeeId: employee.id });
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
  const { branches, branchName } = useWorkspace();
  const canStaff = can(claims, 'staff.view', org.id);
  // This person's roles only: one document, not the whole staff list. Null also when the viewer may not see them.
  const membership = useAsync(
    () => (employee.uid && canStaff ? getStaffMember(org.id, employee.uid).catch(() => null) : Promise.resolve(null)),
    [org.id, employee.uid],
  );
  const [linking, setLinking] = useState(false);
  const [roles, setRoles] = useState(false);
  const [giving, setGiving] = useState(false);
  const [email, setEmail] = useState(employee.email ?? '');
  const canEdit = can(claims, 'employees.edit', org.id);
  const canRoles = can(claims, 'staff.manageRoles', org.id);
  // Roles in one step for someone with an email on record: saving them links the account too. Not tied to
  // editing employees, which branch managers may not do. Link account stays for a different sign-in email.
  const canGive = !employee.uid && !!employee.email && canRoles;
  // Start from the employee's own branch, when it is one the viewer may give (a branch outside their own would be refused).
  const scope = branchScope(claims, org.id);
  const home = employee.branchId;
  const startBranches = home && (scope === 'ALL' || scope.includes(home)) && branches.some((b) => b.id === home && b.status === 'ACTIVE') ? [home] : [];
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
      {!employee.uid && (canGive || canEdit) && employee.status !== 'OFFBOARDED' && (
        <div className="row">
          {canGive && (
            <button type="button" className="btn btn-filled" onClick={() => setGiving(true)}>
              {t.staffGiveAccess}
            </button>
          )}
          {canEdit && (
            <button type="button" className="btn btn-outlined" onClick={() => setLinking(true)}>
              {ht.linkAccount}
            </button>
          )}
        </div>
      )}
      {employee.uid && canStaff && (
        <>
          <h3>{ht.rolesHere}</h3>
          {membership.loading ? (
            <SkeletonRows rows={1} />
          ) : m && m.status === 'ACTIVE' && (m.roles.length || m.customRoleNames?.length) ? (
            <p>
              {[...m.roles.map((r) => ROLES[r]?.label ?? r), ...(m.customRoleNames ?? [])].join(', ')} · {m.branchIds.includes('*') ? t.allBranches : m.branchIds.map(branchName).join(', ')}
            </p>
          ) : (
            <p className="muted">{employee.status === 'OFFBOARDED' ? ht.rolesOffboarded : ht.noRoles}</p>
          )}
          {canRoles && employee.status !== 'OFFBOARDED' && (
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
          branchIds={m ? undefined : startBranches}
          onClose={() => setRoles(false)}
          onSaved={() => {
            membership.reload();
            onChanged();
          }}
        />
      )}
      {giving && (
        <RolesDialog
          org={org}
          email={employee.email ?? undefined}
          branchIds={startBranches}
          title={ht.giveAccessTitle}
          intro={ht.giveAccessIntro}
          cancelLabel={t.cancel}
          onClose={() => setGiving(false)}
          // The record is read again rather than assumed linked: the roles go to whoever signs in with this email.
          onSaved={onChanged}
        />
      )}
    </section>
  );
}
