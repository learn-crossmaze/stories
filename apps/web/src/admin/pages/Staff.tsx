import { useState } from 'react';

import { useAuth } from '../../auth/AuthContext';
import { branchScope, can } from '../../auth/claims';
import { command } from '../../data/api';
import { listStaff, type Org, type StaffMembership } from '../../data/org';
import { useAsync } from '../../data/useAsync';
import { ROLES, type Role } from '../../generated/rbac';
import { t } from '../../strings';
import { EmptyState, ErrorState, Icon, SkeletonRows, StatusBadge } from '../../ui';
import { ConfirmWithReason, Dialog, DialogActions, FormError, TextField, useSubmit } from '../Dialog';
import { canManageMember, grantableRoles, isOrgWide } from '../grants';
import { useWorkspace } from '../Workspace';

function RolesDialog({ org, member, onClose, onSaved }: { org: Org; member?: StaffMembership; onClose: () => void; onSaved: () => void }) {
  const { claims } = useAuth();
  const { branches } = useWorkspace();
  const scope = branchScope(claims, org.id);
  const offered = grantableRoles(claims, org.id, org.type);
  const branchChoices = branches.filter((b) => b.status === 'ACTIVE' && (scope === 'ALL' || scope.includes(b.id)));

  const [email, setEmail] = useState(member?.email ?? '');
  const [roles, setRoles] = useState<Role[]>(member?.status === 'ACTIVE' ? member.roles : []);
  const [allBranches, setAllBranches] = useState(member ? member.branchIds.includes('*') : false);
  const [picked, setPicked] = useState<string[]>(member?.branchIds.filter((b) => b !== '*') ?? []);
  const [touched, setTouched] = useState(false);

  const orgWide = roles.some(isOrgWide);
  const all = orgWide || allBranches;
  const errors = {
    email: /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim()) ? undefined : 'Enter a valid email address.',
    roles: roles.length ? undefined : 'Choose at least one role.',
    branches: all || picked.length ? undefined : 'Choose at least one branch.',
  };
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  const { busy, error, submit } = useSubmit(async () => {
    setTouched(true);
    if (errors.email || errors.roles || errors.branches) return;
    await command('staff-setRoles', { orgId: org.id, email: email.trim(), roles, branchIds: all ? ['*'] : picked });
    onSaved();
    onClose();
  });

  return (
    <Dialog title={member ? t.staffEditRoles : t.staffAdd} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <TextField label={t.staffEmail} type="email" value={email} onChange={setEmail} hint={member ? undefined : t.staffEmailHint} error={touched ? errors.email : undefined} disabled={!!member} />
        <fieldset className="choices">
          <legend>{t.staffRoles}</legend>
          {offered.map((r) => (
            <label key={r} className="check">
              <input type="checkbox" checked={roles.includes(r)} onChange={() => setRoles(toggle(roles, r))} />
              {ROLES[r].label}
              {isOrgWide(r) && <span className="muted"> · {t.allBranches.toLowerCase()}</span>}
            </label>
          ))}
          {touched && errors.roles && <span className="field-error">{errors.roles}</span>}
        </fieldset>
        <fieldset className="choices">
          <legend>{t.staffBranches}</legend>
          {scope === 'ALL' && (
            <label className="check">
              <input type="checkbox" checked={all} disabled={orgWide} onChange={(e) => setAllBranches(e.target.checked)} />
              {t.allBranches}
            </label>
          )}
          {!all &&
            branchChoices.map((b) => (
              <label key={b.id} className="check">
                <input type="checkbox" checked={picked.includes(b.id)} onChange={() => setPicked(toggle(picked, b.id))} />
                {b.name} <span className="muted mono">{b.code}</span>
              </label>
            ))}
          {touched && errors.branches && <span className="field-error">{errors.branches}</span>}
        </fieldset>
        <FormError error={error} />
        <DialogActions busy={busy} submitLabel={t.save} onCancel={onClose} />
      </form>
    </Dialog>
  );
}

export function StaffPage() {
  const { claims, user } = useAuth();
  const { org, branchName } = useWorkspace();
  const scope = org ? branchScope(claims, org.id) : 'ALL';
  const staff = useAsync(() => (org ? listStaff(org.id, scope) : Promise.resolve([])), [org?.id, JSON.stringify(scope)]);
  const [editing, setEditing] = useState<StaffMembership | 'new' | null>(null);
  const [revoking, setRevoking] = useState<StaffMembership | null>(null);
  if (!org) return <EmptyState icon="building" title={t.noOrgTitle} message={t.noOrgMessage} />;
  const manage = can(claims, 'staff.manageRoles', org.id) && grantableRoles(claims, org.id, org.type).length > 0;

  return (
    <>
      <header className="page-header page-header-row">
        <h1>{t.staffTitle}</h1>
        {manage && (
          <button type="button" className="btn btn-filled" onClick={() => setEditing('new')}>
            <Icon name="plus" /> {t.staffAdd}
          </button>
        )}
      </header>
      {staff.loading ? (
        <SkeletonRows />
      ) : staff.error ? (
        <ErrorState message={staff.error} onRetry={staff.reload} />
      ) : !staff.data?.length ? (
        <EmptyState icon="people" title={t.staffEmpty} message="" />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">{t.staffRoles}</th>
                <th scope="col">{t.staffBranches}</th>
                <th scope="col">Status</th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {staff.data.map((m) => {
                const editable = manage && canManageMember(claims, user?.uid ?? '', org.id, org.type, m);
                return (
                  <tr key={m.uid}>
                    <td>
                      <div>{m.displayName ?? m.email}</div>
                      <div className="muted small">
                        {m.email}
                        {m.uid === user?.uid && ` · ${t.staffYou}`}
                      </div>
                    </td>
                    <td>{m.roles.map((r) => ROLES[r]?.label ?? r).join(', ') || '—'}</td>
                    <td>{m.branchIds.includes('*') ? t.allBranches : m.branchIds.map(branchName).join(', ')}</td>
                    <td>
                      <StatusBadge status={m.status} />
                    </td>
                    <td className="cell-actions">
                      {editable && (
                        <>
                          <button type="button" className="btn btn-text" onClick={() => setEditing(m)}>
                            {t.edit}
                          </button>
                          {m.status === 'ACTIVE' && (
                            <button type="button" className="btn btn-text" onClick={() => setRevoking(m)}>
                              {t.staffRevoke}
                            </button>
                          )}
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {editing && <RolesDialog org={org} member={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} onSaved={staff.reload} />}
      {revoking && (
        <ConfirmWithReason
          title={t.staffRevokeTitle(revoking.displayName ?? revoking.email ?? '')}
          body={t.staffRevokeBody}
          confirmLabel={t.staffRevoke}
          onClose={() => setRevoking(null)}
          onConfirm={async (reason) => {
            await command('staff-revoke', { orgId: org.id, uid: revoking.uid, reason });
            staff.reload();
            setRevoking(null);
          }}
        />
      )}
    </>
  );
}
