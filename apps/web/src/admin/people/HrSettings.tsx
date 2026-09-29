import { useEffect, useState } from 'react';

import { command } from '../../data/api';
import { type ChecklistTemplateItem, type Designation, getChecklistTemplates, listDesignations } from '../../data/hr';
import { useAsync } from '../../shared/useAsync';
import { t } from '../../strings';
import { EmptyState, ErrorState, Icon, SkeletonRows, StatusBadge } from '../../shared/ui';
import { ConfirmWithReason, Dialog, DialogActions, FormError, TextField, useSubmit } from '../components/Dialog';
import { ht } from '../../strings/hr';
import { Notice } from '../components/kit';
import { useAuth } from '../../auth/AuthContext';
import { branchScope, can } from '../../auth/claims';
import { useWorkspace } from '../Workspace';
import { DocumentTypesSection } from './DocumentTypesSettings';
import { LeaveTypesSection } from './LeaveTypesSettings';
import { PayrollSettingsSection } from './PayrollSettings';
import { HolidaysSection, ShiftsSection } from './ScheduleSettings';

function DesignationDialog({ orgId, designation, onClose, onSaved }: { orgId: string; designation?: Designation; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(designation?.name ?? '');
  const [touched, setTouched] = useState(false);
  const nameError = name.trim().length < 2 ? t.required : undefined;
  const { busy, error, submit } = useSubmit(async () => {
    setTouched(true);
    if (nameError) return;
    if (designation) await command('designations-rename', { orgId, designationId: designation.id, name: name.trim() });
    else await command('designations-create', { orgId, name: name.trim() });
    onSaved();
    onClose();
  });
  return (
    <Dialog title={designation ? t.rename : ht.designationNew} onClose={onClose} narrow>
      <form onSubmit={submit} noValidate>
        <TextField label={ht.designationName} value={name} onChange={setName} error={touched ? nameError : undefined} />
        <FormError error={error} />
        <DialogActions busy={busy} submitLabel={designation ? t.save : t.create} onCancel={onClose} />
      </form>
    </Dialog>
  );
}

const slug = (label: string, taken: Set<string>) => {
  const base =
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 32) || 'item';
  let key = base;
  for (let i = 2; taken.has(key); i++) key = `${base}-${i}`;
  return key;
};

function ChecklistEditor({ title, items, onChange }: { title: string; items: ChecklistTemplateItem[]; onChange: (v: ChecklistTemplateItem[]) => void }) {
  const [draft, setDraft] = useState('');
  const update = (i: number, patch: Partial<ChecklistTemplateItem>) => onChange(items.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  return (
    <fieldset className="choices">
      <legend>{title}</legend>
      <div className="checklist-editor">
        {items.map((item, i) => (
          <div key={item.key} className="checklist-row">
            <input type="text" value={item.label} aria-label={`${ht.itemLabel} ${i + 1}`} onChange={(e) => update(i, { label: e.target.value })} />
            <label className="check">
              <input type="checkbox" checked={item.required} onChange={(e) => update(i, { required: e.target.checked })} />
              {ht.required}
            </label>
            <button type="button" className="btn btn-text" disabled={items.length <= 1} onClick={() => onChange(items.filter((_, j) => j !== i))}>
              {ht.removeItem}
            </button>
          </div>
        ))}
        <div className="checklist-row">
          <input type="text" value={draft} placeholder={ht.itemLabel} aria-label={ht.addItem} onChange={(e) => setDraft(e.target.value)} />
          <button
            type="button"
            className="btn btn-outlined"
            disabled={draft.trim().length < 2 || items.length >= 30}
            onClick={() => {
              onChange([...items, { key: slug(draft, new Set(items.map((x) => x.key))), label: draft.trim(), required: false }]);
              setDraft('');
            }}
          >
            <Icon name="plus" /> {ht.addItem}
          </button>
        </div>
      </div>
    </fieldset>
  );
}

export function HrSettingsPage() {
  const { org } = useWorkspace();
  const { claims } = useAuth();
  const designations = useAsync(() => (org ? listDesignations(org.id) : Promise.resolve([])), [org?.id]);
  const templates = useAsync(() => (org ? getChecklistTemplates(org.id) : Promise.resolve(null)), [org?.id]);
  const [editing, setEditing] = useState<Designation | 'new' | null>(null);
  const [archiving, setArchiving] = useState<Designation | null>(null);
  const [onboarding, setOnboarding] = useState<ChecklistTemplateItem[]>([]);
  const [offboarding, setOffboarding] = useState<ChecklistTemplateItem[]>([]);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (templates.data) {
      setOnboarding(templates.data.onboarding);
      setOffboarding(templates.data.offboarding);
    }
  }, [templates.data]);
  const save = useSubmit(async () => {
    if (!org) return;
    setSaved(false);
    const clean = (items: ChecklistTemplateItem[]) => items.filter((i) => i.label.trim().length >= 2).map((i) => ({ ...i, label: i.label.trim() }));
    await command('hr-setChecklists', { orgId: org.id, onboarding: clean(onboarding), offboarding: clean(offboarding) });
    setSaved(true);
  });
  if (!org) return <EmptyState icon="building" title={t.noOrgTitle} message={t.noOrgMessage} />;
  const canEditPayroll = can(claims, 'salary.edit', org.id) && branchScope(claims, org.id) === 'ALL';

  return (
    <>
      <header className="page-header">
        <h1>{ht.navHrSettings}</h1>
        <p className="muted">{ht.settingsIntro}</p>
      </header>

      <section className="section">
        <div className="page-header-row">
          <h2>{ht.designations}</h2>
          <button type="button" className="btn btn-outlined" onClick={() => setEditing('new')}>
            <Icon name="plus" /> {ht.designationNew}
          </button>
        </div>
        {designations.loading ? (
          <SkeletonRows rows={2} />
        ) : designations.error ? (
          <ErrorState message={designations.error} onRetry={designations.reload} />
        ) : !designations.data?.length ? (
          <p className="muted">{ht.designationsEmpty}</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">{ht.designationName}</th>
                  <th scope="col">Status</th>
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {designations.data.map((d) => (
                  <tr key={d.id}>
                    <td>{d.name}</td>
                    <td>
                      <StatusBadge status={d.status} />
                    </td>
                    <td className="cell-actions">
                      {d.status === 'ACTIVE' && (
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
      </section>

      <ShiftsSection orgId={org.id} />

      <HolidaysSection orgId={org.id} />

      <LeaveTypesSection orgId={org.id} />

      {canEditPayroll && <PayrollSettingsSection orgId={org.id} />}

      <DocumentTypesSection orgId={org.id} checklist={onboarding} />

      <section className="section">
        <h2>{ht.checklists}</h2>
        <p className="muted">{ht.checklistsIntro}</p>
        {templates.loading ? (
          <SkeletonRows rows={3} />
        ) : templates.error ? (
          <ErrorState message={templates.error} onRetry={templates.reload} />
        ) : (
          <form onSubmit={save.submit} noValidate>
            <ChecklistEditor title={ht.onboardingChecklist} items={onboarding} onChange={setOnboarding} />
            <ChecklistEditor title={ht.offboardingChecklist} items={offboarding} onChange={setOffboarding} />
            <FormError error={save.error} />
            {saved && <Notice tone="ok">{ht.saved}</Notice>}
            <div className="row">
              <button type="submit" className="btn btn-filled" disabled={save.busy}>
                {save.busy ? t.loading : ht.saveChecklists}
              </button>
            </div>
          </form>
        )}
      </section>

      {editing && (
        <DesignationDialog
          orgId={org.id}
          designation={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
          onSaved={designations.reload}
        />
      )}
      {archiving && (
        <ConfirmWithReason
          title={ht.designationArchiveTitle(archiving.name)}
          body=""
          confirmLabel={t.archive}
          onClose={() => setArchiving(null)}
          onConfirm={async (reason) => {
            await command('designations-archive', { orgId: org.id, designationId: archiving.id, reason });
            designations.reload();
            setArchiving(null);
          }}
        />
      )}
    </>
  );
}
