// HR settings: the document types HR collects from employees.
import { useState } from 'react';

import { command } from '../../data/api';
import type { ChecklistTemplateItem } from '../../data/hr';
import { DOCUMENT_CATEGORIES, type DocumentCategory, type DocumentType, listDocumentTypes } from '../../data/hrDocuments';
import { ErrorState, Icon, SkeletonRows, StatusBadge } from '../../shared/ui';
import { useAsync } from '../../shared/useAsync';
import { t } from '../../strings';
import { ht } from '../../strings/hr';
import { ConfirmWithReason, Dialog, DialogActions, FormError, SelectField, TextField, useSubmit } from '../components/Dialog';

function TypeDialog({
  orgId,
  type,
  checklist,
  onClose,
  onSaved,
}: {
  orgId: string;
  type?: DocumentType;
  checklist: ChecklistTemplateItem[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(type?.name ?? '');
  const [category, setCategory] = useState<DocumentCategory>(type?.category ?? 'OTHER');
  const [required, setRequired] = useState(type?.required ?? false);
  const [hasExpiry, setHasExpiry] = useState(type?.hasExpiry ?? false);
  const [reminderDays, setReminderDays] = useState(String(type?.reminderDays ?? 30));
  const [selfUpload, setSelfUpload] = useState(type?.selfUpload ?? true);
  const [checklistKey, setChecklistKey] = useState(type?.checklistKey ?? '');
  const [touched, setTouched] = useState(false);
  const days = Number(reminderDays);
  const errors = {
    name: name.trim().length >= 2 ? undefined : t.required,
    reminderDays: !hasExpiry || (Number.isInteger(days) && days >= 1 && days <= 365) ? undefined : 'Enter 1 to 365 days.',
  };
  const { busy, error, submit } = useSubmit(async () => {
    setTouched(true);
    if (errors.name || errors.reminderDays) return;
    await command('documentTypes-save', {
      orgId,
      ...(type ? { typeId: type.id } : {}),
      name: name.trim(),
      category,
      required,
      hasExpiry,
      reminderDays: hasExpiry ? days : 30,
      selfUpload,
      checklistKey: checklistKey || null,
    });
    onSaved();
    onClose();
  });
  return (
    <Dialog title={type ? ht.documentTypeEdit : ht.documentTypeNew} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <div className="form-grid">
          <TextField label={ht.documentTypeName} value={name} onChange={setName} error={touched ? errors.name : undefined} />
          <SelectField label={ht.documentCategory} value={category} onChange={setCategory} options={DOCUMENT_CATEGORIES.map((c) => ({ value: c, label: ht.categories[c] }))} />
          <SelectField
            label={ht.typeChecklist}
            value={checklistKey}
            onChange={setChecklistKey}
            options={[{ value: '', label: ht.typeChecklistNone }, ...checklist.map((i) => ({ value: i.key, label: i.label }))]}
          />
          {hasExpiry && (
            <TextField label={ht.typeReminderDays} type="number" value={reminderDays} onChange={setReminderDays} error={touched ? errors.reminderDays : undefined} />
          )}
        </div>
        <fieldset className="choices">
          <legend className="sr-only">{ht.documentTypes}</legend>
          <label className="check">
            <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} /> {ht.typeRequired}
          </label>
          <label className="check">
            <input type="checkbox" checked={hasExpiry} onChange={(e) => setHasExpiry(e.target.checked)} /> {ht.typeHasExpiry}
          </label>
          <label className="check">
            <input type="checkbox" checked={selfUpload} onChange={(e) => setSelfUpload(e.target.checked)} /> {ht.typeSelfUpload}
          </label>
        </fieldset>
        <FormError error={error} />
        <DialogActions busy={busy} submitLabel={t.save} onCancel={onClose} />
      </form>
    </Dialog>
  );
}

export function DocumentTypesSection({ orgId, checklist }: { orgId: string; checklist: ChecklistTemplateItem[] }) {
  const types = useAsync(() => listDocumentTypes(orgId), [orgId]);
  const [editing, setEditing] = useState<DocumentType | 'new' | null>(null);
  const [archiving, setArchiving] = useState<DocumentType | null>(null);
  return (
    <section className="section" aria-labelledby="doc-types">
      <div className="page-header-row">
        <h2 className="sr-only" id="doc-types">{ht.documentTypes}</h2>
        <button type="button" className="btn btn-outlined" onClick={() => setEditing('new')}>
          <Icon name="plus" /> {ht.documentTypeNew}
        </button>
      </div>
      <p className="muted">{ht.documentTypesIntro}</p>
      {types.loading ? (
        <SkeletonRows rows={3} />
      ) : types.error ? (
        <ErrorState message={types.error} onRetry={types.reload} />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{ht.documentTypeName}</th>
                <th scope="col">{ht.documentCategory}</th>
                <th scope="col">{ht.colStatus}</th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {(types.data ?? []).map((x) => (
                <tr key={x.id}>
                  <td>
                    {x.name}
                    <div className="muted small">
                      {[x.required && ht.typeFlags.required, x.hasExpiry && `${ht.typeFlags.expiry} (${x.reminderDays}d)`, x.selfUpload && ht.typeFlags.self]
                        .filter(Boolean)
                        .join(' · ')}
                    </div>
                  </td>
                  <td>{ht.categories[x.category]}</td>
                  <td>
                    <StatusBadge status={x.status} />
                  </td>
                  <td className="cell-actions">
                    {x.status === 'ACTIVE' && (
                      <>
                        <button type="button" className="btn btn-text" onClick={() => setEditing(x)} aria-label={`${t.edit} ${x.name}`}>
                          {t.edit}
                        </button>
                        <button type="button" className="btn btn-text" onClick={() => setArchiving(x)} aria-label={`${t.archive} ${x.name}`}>
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
      {editing && (
        <TypeDialog orgId={orgId} type={editing === 'new' ? undefined : editing} checklist={checklist} onClose={() => setEditing(null)} onSaved={types.reload} />
      )}
      {archiving && (
        <ConfirmWithReason
          title={ht.typeArchiveTitle(archiving.name)}
          body={ht.typeArchiveBody}
          confirmLabel={t.archive}
          onClose={() => setArchiving(null)}
          onConfirm={async (reason) => {
            await command('documentTypes-archive', { orgId, typeId: archiving.id, reason });
            setArchiving(null);
            types.reload();
          }}
        />
      )}
    </section>
  );
}
