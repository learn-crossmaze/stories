import { useEffect, useReducer, useRef, useState } from 'react';
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
 * ticks still waiting are sent when the tab is switched, and a checklist opened again meanwhile shows them and
 * knows they are not saved yet.
 */
interface Ticks {
  /** The tick sent last: the next one waits for it. */
  tail: Promise<void>;
  inFlight: number;
  /** Boxes shown ahead of the record, by `list/key`: the tick at once, taken out again if the server refuses. */
  ahead: Record<string, boolean>;
  /** Goes up when a tick fails: the ticks waiting behind it are dropped, not sent. */
  round: number;
  error: string | null;
  /** The record the boxes were last shown over. Once nothing is on its way, a newer one puts them back on the record. */
  record: Employee;
  /** The page behind, from the checklist that ticked or opened last (its callbacks still work once it has gone). */
  page: { current: { onChanged: () => void; onSaving?: (saving: boolean) => void } };
  /** Checklists on screen. */
  watchers: Set<() => void>;
}
const ticks = new Map<string, Ticks>();
const announce = (s: Ticks) => s.watchers.forEach((redraw) => redraw());
/** Forgotten once there is nothing to send, show or tell. */
const tidy = (queue: string) => {
  const s = ticks.get(queue);
  if (s && !s.inFlight && !s.watchers.size && !Object.keys(s.ahead).length) ticks.delete(queue);
};

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
  const queue = `${orgId}/${employee.id}`;
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  const latest = useRef({ onChanged, onSaving });
  latest.current = { onChanged, onSaving };
  const mine = (): Ticks => {
    const s = ticks.get(queue) ?? { tail: Promise.resolve(), inFlight: 0, ahead: {}, round: 0, error: null, record: employee, page: latest, watchers: new Set() };
    ticks.set(queue, s);
    return s;
  };
  const state = ticks.get(queue);
  // A fresh record with nothing on its way: the boxes follow the record again. (Not sooner, or a tick would flicker back.)
  const settled = !!state && !state.inFlight && state.record !== employee;
  const ahead = state && !settled ? state.ahead : {};
  const saving = !!state?.inFlight;

  useEffect(() => {
    const s = mine();
    s.watchers.add(redraw);
    // Opened while ticks made earlier are still on their way: this page waits for them too.
    if (editable) s.page = latest;
    if (s.inFlight) latest.current.onSaving?.(true);
    return () => {
      s.watchers.delete(redraw);
      if (!s.watchers.size) s.error = null;
      tidy(queue);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue]);
  useEffect(() => {
    const s = ticks.get(queue);
    if (!s || s.record === employee) return;
    s.record = employee;
    if (s.inFlight || !Object.keys(s.ahead).length) return;
    s.ahead = {};
    announce(s);
  }, [queue, employee]);

  const tick = (key: string, value: boolean) => {
    const s = mine();
    const box = `${list}/${key}`;
    const round = s.round;
    // Its own request each time: tick, untick, tick of one box must never replay the first answer.
    const requestId = crypto.randomUUID();
    const undo = () => {
      const { [box]: _, ...rest } = s.ahead;
      s.ahead = rest;
    };
    s.error = null;
    s.ahead = { ...s.ahead, [box]: value };
    s.record = employee;
    s.page = latest;
    s.inFlight += 1;
    if (s.inFlight === 1) s.page.current.onSaving?.(true);
    s.tail = s.tail
      .then(async () => {
        if (round !== s.round) return undo();
        try {
          await command('employees-checkItem', { orgId, employeeId: employee.id, list, key, done: value }, requestId);
        } catch (err) {
          s.round += 1;
          undo();
          // Said only to a checklist on screen: one opened later starts from what the server has.
          if (s.watchers.size) s.error = errorText(err);
        }
      })
      .then(() => {
        s.inFlight -= 1;
        if (!s.inFlight) {
          // Every tick made on this employee has been answered, whichever checklist took it.
          s.page.current.onSaving?.(false);
          // After a refusal this also puts the boxes back to what the server has.
          s.page.current.onChanged();
        }
        announce(s);
        tidy(queue);
      });
    announce(s);
  };
  const isDone = (i: ChecklistItem) => ahead[`${list}/${i.key}`] ?? i.done;
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
      <FormError error={state?.error ?? null} />
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
  // Start from the employee's own branch, when it is one the viewer may give (a branch outside their own would be
  // refused). Head office starts from all branches; a branch that cannot be given starts from nothing, so one must
  // be chosen ([] would read as head office and tick "All branches" unasked).
  const scope = branchScope(claims, org.id);
  const home = employee.branchId;
  const startBranches = !home ? [] : (scope === 'ALL' || scope.includes(home)) && branches.some((b) => b.id === home && b.status === 'ACTIVE') ? [home] : undefined;
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
