import { useState } from 'react';

import { useAuth } from '../../auth/AuthContext';
import { branchScope, can, permsIn } from '../../auth/claims';
import { type CustomRoleView, deleteRole, listRoles, saveRole } from '../../data/roles';
import { AREAS, CORPORATE_ONLY, ORG_WIDE, type Permission, ROLES, type Role, SUPER_ADMIN_ONLY } from '../../generated/rbac';

import { EmptyState, ErrorState, Icon, NoOrgState, SkeletonRows, TableWrap } from '../../shared/ui';
import { useAsync } from '../../shared/useAsync';
import { ct } from '../../strings/control';
import { Dialog, DialogActions, FormError, TextArea, TextField, useSubmit } from '../components/Dialog';
import { Notice } from '../components/kit';
import { useWorkspace } from '../Workspace';

// Master control → Roles (docs/RBAC.md §2.1, as LITMUS's Organisation → Roles): the ready-made roles with what they
// give, and roles of the organization's own, made permission by permission. The server checks everything again: a
// Branch Owner's role gives only what they hold, at their own branches.

type Draft = { roleId?: string; name: string; description: string; permissions: Set<Permission>; branchIds: string[]; wholeOrg: boolean; everyOrg: boolean };

const SUMMARY = (r: Role) => (ROLES[r] as { summary?: string }).summary ?? '';

function PermissionList({ on, editable, mine, onToggle }: { on: Set<Permission>; editable: boolean; mine: Set<Permission>; onToggle?: (p: Permission[], value: boolean) => void }) {
  return (
    <div className="role-areas">
      {AREAS.map((area) => {
        const perms = (Object.keys(area.permissions) as Permission[]).filter((p) => !SUPER_ADMIN_ONLY.includes(p));
        const shown = editable ? perms : perms.filter((p) => on.has(p));
        if (!shown.length) return null;
        const givable = perms.filter((p) => mine.has(p));
        const all = givable.length > 0 && givable.every((p) => on.has(p));
        return (
          <fieldset key={area.key} className="choices role-area">
            <legend>{area.name}</legend>
            {editable && givable.length > 1 && (
              <label className="check role-all">
                <input type="checkbox" checked={all} onChange={(e) => onToggle?.(givable, e.target.checked)} />
                {ct.selectAll(area.name)}
              </label>
            )}
            {shown.map((p) => {
              const held = mine.has(p);
              return (
                <label key={p} className={`check${editable && !held ? ' is-disabled' : ''}`}>
                  {editable ? (
                    <input type="checkbox" checked={on.has(p)} disabled={!held} onChange={(e) => onToggle?.([p], e.target.checked)} />
                  ) : (
                    <Icon name="check" />
                  )}
                  <span>
                    {area.permissions[p]}
                    {ORG_WIDE.includes(p) && <span className="muted"> · {ct.needsAll}</span>}
                    {CORPORATE_ONLY.includes(p) && <span className="muted"> · {ct.headOffice}</span>}
                    {editable && !held && <span className="muted"> · {ct.notYours}</span>}
                  </span>
                </label>
              );
            })}
          </fieldset>
        );
      })}
    </div>
  );
}

function RoleEditor({ orgId, draft: start, title, holders, onClose, onSaved }: { orgId: string; draft: Draft; title: string; holders: number; onClose: () => void; onSaved: (msg: string) => void }) {
  const { claims } = useAuth();
  const { branches } = useWorkspace();
  const mine = permsIn(claims, orgId);
  const scope = branchScope(claims, orgId);
  const [d, setD] = useState(start);
  const [touched, setTouched] = useState(false);
  const all = d.branchIds.includes('*');
  const branchChoices = branches.filter((b) => b.status === 'ACTIVE' && (scope === 'ALL' || scope.includes(b.id)));
  const errors = {
    name: d.name.trim().length >= 2 && d.name.trim().length <= 40 ? undefined : ct.nameRequired,
    permissions: d.permissions.size ? undefined : ct.permissionRequired,
    branches: d.branchIds.length ? undefined : ct.branchRequired,
  };
  const set = (patch: Partial<Draft>) => setD((x) => ({ ...x, ...patch }));
  const { busy, error, submit } = useSubmit(async () => {
    setTouched(true);
    if (errors.name || errors.permissions || errors.branches) return;
    await saveRole(orgId, {
      roleId: d.roleId,
      name: d.name.trim(),
      description: d.description.trim(),
      permissions: [...d.permissions],
      branchIds: d.wholeOrg || d.everyOrg ? ['*'] : d.branchIds,
      wholeOrg: d.wholeOrg,
      everyOrg: d.everyOrg,
    });
    onSaved(ct.saved);
    onClose();
  });
  return (
    <Dialog title={title} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        {holders > 0 && <Notice tone="warn">{ct.heldBy(holders)}</Notice>}
        <TextField label={ct.name} value={d.name} onChange={(name) => set({ name })} hint={ct.nameHint} error={touched ? errors.name : undefined} />
        <TextArea label={ct.description} value={d.description} onChange={(description) => set({ description })} rows={2} />
        <fieldset className="choices">
          <legend>{ct.where}</legend>
          <span className="field-hint">{ct.whereHint}</span>
          {claims.sa && !d.roleId && (
            <label className="check">
              <input type="checkbox" checked={d.everyOrg} onChange={(e) => set({ everyOrg: e.target.checked, branchIds: ['*'] })} />
              {ct.everyOrgOption}
            </label>
          )}
          {scope === 'ALL' && (
            <label className="check">
              <input type="checkbox" checked={d.wholeOrg} onChange={(e) => set({ wholeOrg: e.target.checked, branchIds: e.target.checked ? ['*'] : d.branchIds })} />
              {ct.wholeOrg}
            </label>
          )}
          {!d.everyOrg && !d.wholeOrg && (
            <>
              {scope === 'ALL' && (
                <label className="check">
                  <input type="checkbox" checked={all} onChange={(e) => set({ branchIds: e.target.checked ? ['*'] : [] })} />
                  {ct.allBranches}
                </label>
              )}
              {!all &&
                branchChoices.map((b) => (
                  <label key={b.id} className="check">
                    <input
                      type="checkbox"
                      checked={d.branchIds.includes(b.id)}
                      onChange={() => set({ branchIds: d.branchIds.includes(b.id) ? d.branchIds.filter((x) => x !== b.id) : [...d.branchIds, b.id] })}
                    />
                    {b.name} <span className="muted mono">{b.code}</span>
                  </label>
                ))}
            </>
          )}
          {touched && errors.branches && <span className="field-error">{errors.branches}</span>}
        </fieldset>
        <h2 className="h-section">{ct.permissions}</h2>
        <p className="muted small">
          {ct.permissionsHint} {ct.needsAllHint}
        </p>
        {touched && errors.permissions && <span className="field-error">{errors.permissions}</span>}
        <PermissionList
          on={d.permissions}
          editable
          mine={mine}
          onToggle={(ps, value) =>
            setD((x) => {
              const next = new Set(x.permissions);
              for (const p of ps) if (value) next.add(p);
              else next.delete(p);
              return { ...x, permissions: next };
            })
          }
        />
        <FormError error={error} />
        <DialogActions busy={busy} submitLabel="Save role" onCancel={onClose} />
      </form>
    </Dialog>
  );
}

export function RolesPage() {
  const { claims } = useAuth();
  const { org, branchName } = useWorkspace();
  const roles = useAsync(() => (org ? listRoles(org.id) : Promise.resolve(null)), [org?.id]);
  const [editing, setEditing] = useState<{ draft: Draft; title: string; holders: number } | null>(null);
  const [viewing, setViewing] = useState<{ name: string; permissions: Permission[] } | null>(null);
  const [deleting, setDeleting] = useState<CustomRoleView | null>(null);
  const [notice, setNotice] = useState('');
  const del = useSubmit(async () => {
    if (!org || !deleting) return;
    await deleteRole(org.id, deleting.id);
    setDeleting(null);
    setNotice(ct.deleted);
    roles.reload();
  });
  if (!org) return <NoOrgState />;
  const maker = can(claims, 'roles.manage', org.id);
  const mine = permsIn(claims, org.id);
  const scope = branchScope(claims, org.id);
  const blank = (): Draft => ({ name: '', description: '', permissions: new Set(), branchIds: scope === 'ALL' ? ['*'] : [...scope], wholeOrg: false, everyOrg: false });
  const where = (r: CustomRoleView) =>
    r.everyOrg ? ct.everyOrg : r.wholeOrg ? `${ct.allBranches} (${ct.wholeOrgShort})` : r.branchIds.includes('*') ? ct.allBranches : r.branchIds.map(branchName).join(', ');

  return (
    <>
      <header className="page-header page-header-row">
        <div>
          <h1>{ct.rolesTitle}</h1>
          <p className="muted">
            {ct.rolesIntro} {!claims.sa && maker && ct.rolesIntroOwner}
          </p>
        </div>
        {maker && (
          <button type="button" className="btn btn-filled" onClick={() => setEditing({ draft: blank(), title: ct.editorNew, holders: 0 })}>
            <Icon name="plus" /> {ct.newRole}
          </button>
        )}
      </header>
      {notice && <Notice tone="ok">{notice}</Notice>}
      {roles.loading ? (
        <SkeletonRows />
      ) : roles.error || !roles.data ? (
        <ErrorState message={roles.error ?? ''} onRetry={roles.reload} />
      ) : (
        <>
          <h2 className="h-section">{ct.ownRoles}</h2>
          {!roles.data.custom.length ? (
            <EmptyState icon="key" title={ct.ownEmpty} message="" />
          ) : (
            <TableWrap>
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">{ct.colRole}</th>
                    <th scope="col">{ct.colDoes}</th>
                    <th scope="col">{ct.colWhere}</th>
                    <th scope="col" className="num">
                      {ct.colPeople}
                    </th>
                    <th scope="col">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {roles.data.custom.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <strong>{r.name}</strong>
                      </td>
                      <td>
                        {r.description && <div>{r.description}</div>}
                        <div className="muted small">{ct.permissionCount(r.permissions.length)}</div>
                      </td>
                      <td>{where(r)}</td>
                      <td className="num">{ct.people(r.holders)}</td>
                      <td className="cell-actions">
                        <button type="button" className="btn btn-text" onClick={() => setViewing({ name: r.name, permissions: r.permissions })}>
                          {ct.seePermissions}
                        </button>
                        {r.canEdit && (
                          <>
                            <button
                              type="button"
                              className="btn btn-text"
                              onClick={() =>
                                setEditing({
                                  title: ct.editorEdit(r.name),
                                  holders: r.holders,
                                  draft: { roleId: r.id, name: r.name, description: r.description, permissions: new Set(r.permissions), branchIds: r.branchIds, wholeOrg: r.wholeOrg, everyOrg: r.everyOrg },
                                })
                              }
                            >
                              {ct.edit}
                            </button>
                            {r.holders === 0 && (
                              <button type="button" className="btn btn-text" onClick={() => setDeleting(r)}>
                                {ct.remove}
                              </button>
                            )}
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}

          <h2 className="h-section">{ct.readyMade}</h2>
          <TableWrap>
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">{ct.colRole}</th>
                  <th scope="col">{ct.colDoes}</th>
                  <th scope="col" className="num">
                    {ct.colPeople}
                  </th>
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    <strong>{ROLES.SUPER_ADMIN.label}</strong>
                  </td>
                  <td>{SUMMARY('SUPER_ADMIN')}</td>
                  <td className="num">—</td>
                  <td />
                </tr>
                {roles.data.standard.map((r) => (
                  <tr key={r.key}>
                    <td>
                      <strong>{ROLES[r.key].label}</strong>
                      {ROLES[r.key].scope === 'org' && <div className="muted small">{ct.allBranches}</div>}
                    </td>
                    <td>{SUMMARY(r.key)}</td>
                    <td className="num">{ct.people(r.holders)}</td>
                    <td className="cell-actions">
                      <button type="button" className="btn btn-text" onClick={() => setViewing({ name: ROLES[r.key].label, permissions: r.permissions })}>
                        {ct.seePermissions}
                      </button>
                      {maker && (
                        <button
                          type="button"
                          className="btn btn-text"
                          onClick={() =>
                            setEditing({
                              title: ct.editorCopy(ROLES[r.key].label),
                              holders: 0,
                              draft: { ...blank(), name: ct.editorCopy(ROLES[r.key].label), permissions: new Set(r.permissions.filter((p) => mine.has(p) && !SUPER_ADMIN_ONLY.includes(p))) },
                            })
                          }
                        >
                          {ct.copy}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </>
      )}
      {editing && (
        <RoleEditor
          orgId={org.id}
          draft={editing.draft}
          title={editing.title}
          holders={editing.holders}
          onClose={() => setEditing(null)}
          onSaved={(msg) => {
            setNotice(msg);
            roles.reload();
          }}
        />
      )}
      {viewing && (
        <Dialog title={ct.editorView(viewing.name)} onClose={() => setViewing(null)}>
          <PermissionList on={new Set(viewing.permissions)} editable={false} mine={mine} />
          <div className="dialog-actions">
            <button type="button" className="btn btn-filled" onClick={() => setViewing(null)}>
              Close
            </button>
          </div>
        </Dialog>
      )}
      {deleting && (
        <Dialog title={ct.deleteTitle(deleting.name)} onClose={() => setDeleting(null)} narrow>
          <form onSubmit={del.submit}>
            <p>{ct.deleteBody}</p>
            <FormError error={del.error} />
            <DialogActions busy={del.busy} submitLabel={ct.remove} onCancel={() => setDeleting(null)} danger />
          </form>
        </Dialog>
      )}
    </>
  );
}
