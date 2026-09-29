import { useState } from 'react';

import { command } from '../../data/api';
import type { Org, OrgType } from '../../data/org';
import { t } from '../../strings';
import { EmptyState, ErrorState, Icon, SkeletonRows, StatusBadge, TableWrap } from '../../shared/ui';
import { Dialog, DialogActions, FormError, SelectField, TextField, useSubmit } from '../components/Dialog';
import { useWorkspace } from '../Workspace';

function OrgDialog({ org, onClose, onSaved }: { org?: Org; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(org?.name ?? '');
  const [type, setType] = useState<OrgType>(org?.type ?? 'CORPORATE');
  const [status, setStatus] = useState(org?.status ?? 'ACTIVE');
  const [touched, setTouched] = useState(false);
  const nameError = name.trim().length < 2 ? t.required : undefined;
  const { busy, error, submit } = useSubmit(async () => {
    setTouched(true);
    if (nameError) return;
    if (org) await command('orgs-update', { orgId: org.id, name: name.trim(), status });
    else await command('orgs-create', { name: name.trim(), type });
    onSaved();
    onClose();
  });
  return (
    <Dialog title={org ? org.name : t.orgNew} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <TextField label={t.orgName} value={name} onChange={setName} error={touched ? nameError : undefined} />
        <SelectField
          label={t.orgType}
          value={type}
          onChange={setType}
          disabled={!!org}
          options={[
            { value: 'CORPORATE', label: t.orgCorporate },
            { value: 'FRANCHISE', label: t.orgFranchise },
          ]}
        />
        {org && (
          <SelectField
            label="Status"
            value={status}
            onChange={setStatus}
            options={[
              { value: 'ACTIVE', label: t.active },
              { value: 'SUSPENDED', label: t.suspended },
            ]}
          />
        )}
        <FormError error={error} />
        <DialogActions busy={busy} submitLabel={org ? t.save : t.create} onCancel={onClose} />
      </form>
    </Dialog>
  );
}

/** Super Admin: all organizations (corporate and franchise). */
export function OrganizationsPage() {
  const { orgs, orgsLoading, orgsError, reloadOrgs, setOrgId } = useWorkspace();
  const [editing, setEditing] = useState<Org | 'new' | null>(null);
  return (
    <>
      <header className="page-header page-header-row">
        <h1>{t.orgsTitle}</h1>
        <button type="button" className="btn btn-filled" onClick={() => setEditing('new')}>
          <Icon name="plus" /> {t.orgNew}
        </button>
      </header>
      {orgsLoading ? (
        <SkeletonRows />
      ) : orgsError ? (
        <ErrorState message={orgsError} onRetry={reloadOrgs} />
      ) : orgs.length === 0 ? (
        <EmptyState icon="building" title={t.noOrgTitle} message={t.noOrgMessage} />
      ) : (
        <TableWrap>
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{t.orgName}</th>
                <th scope="col">{t.orgType}</th>
                <th scope="col">Status</th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {orgs.map((o) => (
                <tr key={o.id}>
                  <td>
                    <button type="button" className="link" onClick={() => setOrgId(o.id)}>
                      {o.name}
                    </button>
                  </td>
                  <td>{o.type === 'CORPORATE' ? t.orgCorporate : t.orgFranchise}</td>
                  <td>
                    <StatusBadge status={o.status} />
                  </td>
                  <td className="cell-actions">
                    <button type="button" className="btn btn-text" onClick={() => setEditing(o)}>
                      {t.edit}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
      {editing && <OrgDialog org={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} onSaved={reloadOrgs} />}
    </>
  );
}
