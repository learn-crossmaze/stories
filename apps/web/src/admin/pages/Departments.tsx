import { useState } from 'react';

import { useAuth } from '../../auth/AuthContext';
import { branchScope, can } from '../../auth/claims';
import { command } from '../../data/api';
import { type Department, listDepartments } from '../../data/org';
import { useAsync } from '../../data/useAsync';
import { t } from '../../strings';
import { EmptyState, ErrorState, Icon, SkeletonRows, StatusBadge } from '../../ui';
import { ConfirmWithReason, Dialog, DialogActions, FormError, SelectField, TextField, useSubmit } from '../Dialog';
import { useWorkspace } from '../Workspace';

function DepartmentDialog({ orgId, dept, onClose, onSaved }: { orgId: string; dept?: Department; onClose: () => void; onSaved: () => void }) {
  const { branches } = useWorkspace();
  const [name, setName] = useState(dept?.name ?? '');
  const [branchId, setBranchId] = useState(dept?.branchId ?? '');
  const [touched, setTouched] = useState(false);
  const nameError = name.trim().length < 2 ? t.required : undefined;
  const { busy, error, submit } = useSubmit(async () => {
    setTouched(true);
    if (nameError) return;
    if (dept) await command('departments-rename', { orgId, departmentId: dept.id, name: name.trim() });
    else await command('departments-create', { orgId, name: name.trim(), branchId: branchId || null });
    onSaved();
    onClose();
  });
  return (
    <Dialog title={dept ? t.rename : t.departmentNew} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <TextField label={t.departmentName} value={name} onChange={setName} error={touched ? nameError : undefined} />
        <SelectField
          label={t.departmentScope}
          value={branchId}
          onChange={setBranchId}
          disabled={!!dept}
          options={[{ value: '', label: t.allBranches }, ...branches.filter((b) => b.status === 'ACTIVE').map((b) => ({ value: b.id, label: b.name }))]}
        />
        <FormError error={error} />
        <DialogActions busy={busy} submitLabel={dept ? t.save : t.create} onCancel={onClose} />
      </form>
    </Dialog>
  );
}

export function DepartmentsPage() {
  const { claims } = useAuth();
  const { org, branchName } = useWorkspace();
  // Branch staff see organization-wide departments and those of their own branches.
  const depts = useAsync(async () => {
    if (!org) return [];
    const all = await listDepartments(org.id);
    const scope = branchScope(claims, org.id);
    return scope === 'ALL' ? all : all.filter((d) => !d.branchId || scope.includes(d.branchId));
  }, [org?.id]);
  const [editing, setEditing] = useState<Department | 'new' | null>(null);
  const [archiving, setArchiving] = useState<Department | null>(null);
  if (!org) return <EmptyState icon="building" title={t.noOrgTitle} message={t.noOrgMessage} />;
  const manage = (d?: Department) => can(claims, 'departments.manage', org.id, d?.branchId ?? undefined);

  return (
    <>
      <header className="page-header page-header-row">
        <h1>{t.departmentsTitle}</h1>
        {manage() && (
          <button type="button" className="btn btn-filled" onClick={() => setEditing('new')}>
            <Icon name="plus" /> {t.departmentNew}
          </button>
        )}
      </header>
      {depts.loading ? (
        <SkeletonRows />
      ) : depts.error ? (
        <ErrorState message={depts.error} onRetry={depts.reload} />
      ) : !depts.data?.length ? (
        <EmptyState icon="folder" title={t.departmentsEmpty} message="" />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{t.departmentName}</th>
                <th scope="col">{t.departmentScope}</th>
                <th scope="col">Status</th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {depts.data.map((d) => (
                <tr key={d.id}>
                  <td>{d.name}</td>
                  <td>{d.branchId ? branchName(d.branchId) : t.allBranches}</td>
                  <td>
                    <StatusBadge status={d.status} />
                  </td>
                  <td className="cell-actions">
                    {manage(d) && d.status === 'ACTIVE' && (
                      <>
                        <button type="button" className="btn btn-text" onClick={() => setEditing(d)}>
                          {t.rename}
                        </button>
                        <button type="button" className="btn btn-text" onClick={() => setArchiving(d)}>
                          {t.archive}
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && <DepartmentDialog orgId={org.id} dept={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} onSaved={depts.reload} />}
      {archiving && (
        <ConfirmWithReason
          title={t.departmentArchiveTitle(archiving.name)}
          body=""
          confirmLabel={t.archive}
          onClose={() => setArchiving(null)}
          onConfirm={async (reason) => {
            await command('departments-archive', { orgId: org.id, departmentId: archiving.id, reason });
            depts.reload();
            setArchiving(null);
          }}
        />
      )}
    </>
  );
}
