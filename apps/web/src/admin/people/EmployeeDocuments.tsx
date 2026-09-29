// The Documents tab of an employee profile: required documents, the file on record, upload, verify, open.
import { useRef, useState } from 'react';

import { useAuth } from '../../auth/AuthContext';
import type { Employee } from '../../data/hr';
import {
  daysUntil,
  DOCUMENT_ACCEPT,
  type DocumentType,
  type EmployeeDocument,
  employeeDocuments,
  listDocumentTypes,
  MAX_DOCUMENT_BYTES,
  openDocument,
  uploadDocument,
} from '../../data/hrDocuments';
import { command } from '../../data/api';
import { day } from '../../shared/format';
import { ErrorState, Icon, SkeletonRows } from '../../shared/ui';
import { useAsync } from '../../shared/useAsync';
import { t } from '../../strings';
import { ht } from '../../strings/hr';
import { ConfirmWithReason, Dialog, DialogActions, FormError, SelectField, TextField, useSubmit } from '../components/Dialog';
import { Notice } from '../components/kit';

const TONE: Record<string, string> = { VERIFIED: 'ok', PENDING: 'info', REJECTED: 'danger', EXPIRED: 'danger', SUPERSEDED: 'muted', REMOVED: 'muted', MISSING: 'warn' };

export function DocumentBadge({ status }: { status: string }) {
  return <span className={`badge badge-${TONE[status] ?? 'muted'}`}>{ht.docStatus[status] ?? status}</span>;
}

/** Expiry line, highlighted once inside the reminder window. */
export function ExpiryNote({ doc, reminderDays = 30 }: { doc: Pick<EmployeeDocument, 'expiresOn' | 'status'>; reminderDays?: number }) {
  if (!doc.expiresOn) return null;
  const d = daysUntil(doc.expiresOn);
  const urgent = doc.status !== 'SUPERSEDED' && doc.status !== 'REMOVED' && d <= reminderDays;
  return (
    <span className={urgent ? 'expiry-warn' : 'muted small'}>
      {urgent && <Icon name="alert" />} {ht.expiresIn(d)} ({doc.expiresOn})
    </span>
  );
}

function UploadDialog({
  orgId,
  employee,
  types,
  initialType,
  onClose,
  onDone,
}: {
  orgId: string;
  employee: Employee;
  types: DocumentType[];
  initialType?: string;
  onClose: () => void;
  onDone: (status: string) => void;
}) {
  const [typeId, setTypeId] = useState(initialType ?? types[0]?.id ?? '');
  const [file, setFile] = useState<File | null>(null);
  const [number, setNumber] = useState('');
  const [issuedOn, setIssuedOn] = useState('');
  const [expiresOn, setExpiresOn] = useState('');
  const [touched, setTouched] = useState(false);
  const fileId = useRef(`doc-file-${Math.random().toString(36).slice(2)}`).current;
  const type = types.find((x) => x.id === typeId);
  const errors = {
    file: !file ? ht.chooseFile : !DOCUMENT_ACCEPT.split(',').includes(file.type) ? ht.fileWrongType : file.size > MAX_DOCUMENT_BYTES ? ht.fileTooLarge : undefined,
    expiresOn: type?.hasExpiry && !expiresOn ? t.required : undefined,
  };
  const { busy, error, submit } = useSubmit(async () => {
    setTouched(true);
    if (errors.file || errors.expiresOn || !file) return;
    const res = await uploadDocument({ orgId, employeeId: employee.id, typeId, file, number: number.trim(), issuedOn, expiresOn: type?.hasExpiry ? expiresOn : '' });
    onDone(res.status);
    onClose();
  });
  return (
    <Dialog title={`${ht.uploadDocument} · ${employee.fullName}`} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <div className="form-grid">
          <SelectField label={ht.documentType} value={typeId} onChange={setTypeId} options={types.map((x) => ({ value: x.id, label: x.name }))} />
          <div className="field">
            <label htmlFor={fileId}>{ht.documentFile}</label>
            <input
              id={fileId}
              type="file"
              accept={DOCUMENT_ACCEPT}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              aria-invalid={touched && !!errors.file}
              aria-describedby={`${fileId}-hint`}
            />
            <span id={`${fileId}-hint`} className={touched && errors.file ? 'field-error' : 'field-hint'}>
              {touched && errors.file ? errors.file : ht.documentFileHint}
            </span>
          </div>
          <TextField label={ht.documentNumber} value={number} onChange={setNumber} />
          <TextField label={ht.issuedOn} type="date" value={issuedOn} onChange={setIssuedOn} />
          {type?.hasExpiry && <TextField label={ht.expiresOn} type="date" value={expiresOn} onChange={setExpiresOn} error={touched ? errors.expiresOn : undefined} />}
        </div>
        <FormError error={error} />
        <DialogActions busy={busy} submitLabel={ht.uploadDocument} onCancel={onClose} />
      </form>
    </Dialog>
  );
}

/** Verify or reject a pending document (reason required to reject). */
export function useDocumentReview(orgId: string, onDone: () => void) {
  const [rejecting, setRejecting] = useState<EmployeeDocument | null>(null);
  const [error, setError] = useState<string | null>(null);
  const verify = async (d: EmployeeDocument) => {
    setError(null);
    try {
      await command('documents-review', { orgId, employeeId: d.employeeId, documentId: d.id, decision: 'VERIFY' });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : t.errorGeneric);
    }
  };
  const dialog = rejecting && (
    <ConfirmWithReason
      title={ht.rejectTitle(rejecting.typeName)}
      body={ht.rejectBody}
      confirmLabel={ht.reject}
      onClose={() => setRejecting(null)}
      onConfirm={async (reason) => {
        await command('documents-review', { orgId, employeeId: rejecting.employeeId, documentId: rejecting.id, decision: 'REJECT', reason });
        setRejecting(null);
        onDone();
      }}
    />
  );
  return { verify, reject: setRejecting, dialog, error };
}

/** `onChanged` refreshes the employee record (verifying a document can tick an onboarding item). */
export function EmployeeDocumentsPanel({
  orgId,
  employee,
  canManage,
  canVerify,
  onChanged,
}: {
  orgId: string;
  employee: Employee;
  canManage: boolean;
  canVerify: boolean;
  onChanged: () => void;
}) {
  const { user } = useAuth();
  const self = !!employee.uid && employee.uid === user?.uid;
  const data = useAsync(async () => {
    const [types, docs] = await Promise.all([listDocumentTypes(orgId), employeeDocuments(orgId, employee.id, canManage ? undefined : employee.uid ?? undefined)]);
    return { types, docs };
  }, [orgId, employee.id]);
  const [uploading, setUploading] = useState<string | 'any' | null>(null);
  const [removing, setRemoving] = useState<EmployeeDocument | null>(null);
  const [history, setHistory] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const refresh = () => {
    data.reload();
    onChanged();
  };
  const review = useDocumentReview(orgId, refresh);

  if (data.loading) return <SkeletonRows rows={3} />;
  if (data.error || !data.data) return <ErrorState message={data.error ?? t.errorGeneric} onRetry={data.reload} />;
  const { types, docs } = data.data;
  const active = types.filter((x) => x.status === 'ACTIVE');
  const uploadable = active.filter((x) => canManage || (self && x.selfUpload));
  const typeOf = new Map(types.map((x) => [x.id, x]));
  const current = docs.filter((d) => d.status !== 'SUPERSEDED' && d.status !== 'REMOVED');
  const shown = history ? docs : current;
  const rank: Record<string, number> = { VERIFIED: 4, PENDING: 3, REJECTED: 2, EXPIRED: 1 };
  const best = (typeId: string) => current.filter((d) => d.typeId === typeId).sort((a, b) => (rank[b.status] ?? 0) - (rank[a.status] ?? 0))[0];
  const required = active.filter((x) => x.required);
  const open = async (d: EmployeeDocument) => {
    setOpenError(null);
    try {
      await openDocument(orgId, employee.id, d.id);
    } catch (e) {
      setOpenError(e instanceof Error ? e.message : t.errorGeneric);
    }
  };

  return (
    <>
      {notice && <Notice tone="ok">{notice}</Notice>}
      <FormError error={openError ?? review.error} />
      {required.length > 0 && (
        <section className="card" aria-labelledby="req-docs">
          <h2 id="req-docs">{ht.requiredDocs}</h2>
          <ul className="doc-required">
            {required.map((x) => {
              const d = best(x.id);
              return (
                <li key={x.id}>
                  <span>{x.name}</span>
                  <DocumentBadge status={d?.status ?? 'MISSING'} />
                  {!d && uploadable.some((u) => u.id === x.id) && employee.status !== 'OFFBOARDED' && (
                    <button type="button" className="btn btn-text" onClick={() => setUploading(x.id)}>
                      {ht.uploadDocument}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className="section" aria-labelledby="docs-on-file">
        <div className="page-header-row">
          <h2 id="docs-on-file">{ht.allDocs}</h2>
          {uploadable.length > 0 && employee.status !== 'OFFBOARDED' && (
            <button type="button" className="btn btn-outlined" onClick={() => setUploading('any')}>
              <Icon name="plus" /> {ht.uploadDocument}
            </button>
          )}
        </div>
        {canVerify && <p className="muted small">{ht.verifyUploadedHint}</p>}
        <label className="check">
          <input type="checkbox" checked={history} onChange={(e) => setHistory(e.target.checked)} />
          {ht.showHistory}
        </label>
        {!shown.length ? (
          <p className="muted">{ht.noDocuments}</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">{ht.documentCol}</th>
                  <th scope="col">{ht.datesCol}</th>
                  <th scope="col">{ht.colStatus}</th>
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map((d) => {
                  const own = d.uploadedBy === user?.uid;
                  return (
                    <tr key={d.id}>
                      <td>
                        <div>{d.typeName}</div>
                        <div className="muted small">
                          {d.number && <span className="mono">{d.number} · </span>}
                          {d.fileName}
                        </div>
                      </td>
                      <td>
                        {d.issuedOn && <div className="small">{ht.issued(d.issuedOn)}</div>}
                        <ExpiryNote doc={d} reminderDays={typeOf.get(d.typeId)?.reminderDays} />
                        <div className="muted small">{ht.uploadedBy(d.selfUploaded ? d.employeeName : (d.uploadedByEmail ?? '—'), d.uploadedAt ? day(d.uploadedAt) : '')}</div>
                      </td>
                      <td>
                        <DocumentBadge status={d.status} />
                        {d.status === 'REJECTED' && d.rejectReason && <div className="small">{ht.rejectedBecause(d.rejectReason)}</div>}
                        {d.status === 'VERIFIED' && d.verifiedByEmail && <div className="muted small">{ht.verifiedBy(d.verifiedByEmail)}</div>}
                      </td>
                      <td className="cell-actions">
                        <button type="button" className="btn btn-text" onClick={() => void open(d)} aria-label={`${ht.open} ${d.typeName}`}>
                          {ht.open}
                        </button>
                        {d.status === 'PENDING' && canVerify && !own && (
                          <>
                            <button type="button" className="btn btn-text" onClick={() => void review.verify(d)} aria-label={`${ht.verify} ${d.typeName}`}>
                              {ht.verify}
                            </button>
                            <button type="button" className="btn btn-text" onClick={() => review.reject(d)} aria-label={`${ht.reject} ${d.typeName}`}>
                              {ht.reject}
                            </button>
                          </>
                        )}
                        {d.status !== 'REMOVED' && (canManage || (self && own && (d.status === 'PENDING' || d.status === 'REJECTED'))) && (
                          <button type="button" className="btn btn-text" onClick={() => setRemoving(d)} aria-label={`${ht.remove} ${d.typeName}`}>
                            {ht.remove}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {uploading && (
        <UploadDialog
          orgId={orgId}
          employee={employee}
          types={uploadable}
          initialType={uploading === 'any' ? undefined : uploading}
          onClose={() => setUploading(null)}
          onDone={(status) => {
            setNotice(`${ht.uploadDocument}: ${ht.docStatus[status] ?? status}`);
            refresh();
          }}
        />
      )}
      {review.dialog}
      {removing && (
        <ConfirmWithReason
          title={ht.removeTitle(removing.typeName)}
          body={ht.removeBody}
          confirmLabel={ht.remove}
          onClose={() => setRemoving(null)}
          onConfirm={async (reason) => {
            await command('documents-remove', { orgId, employeeId: employee.id, documentId: removing.id, reason });
            setRemoving(null);
            data.reload();
          }}
        />
      )}
    </>
  );
}
