// The Documents tab of an employee profile: required documents, the file on record, upload, verify, open.
// Also the review dialog (file and details side by side, one document after another) it shares with the Documents page.
import { useEffect, useRef, useState } from 'react';

import { useAuth } from '../../auth/AuthContext';
import type { Employee } from '../../data/hr';
import { daysUntil } from '../../shared/dates';
import {
  DOCUMENT_ACCEPT,
  type DocumentType,
  type EmployeeDocument,
  employeeDocuments,
  fetchDocument,
  listDocumentTypes,
  MAX_DOCUMENT_BYTES,
  openDocument,
  uploadDocument,
} from '../../data/hrDocuments';
import { ApiError, command, errorText } from '../../data/api';
import type { FetchedFile } from '../../data/files';
import { day } from '../../shared/format';
import { ErrorState, Icon, makeStatusBadge, SkeletonRows, TableWrap } from '../../shared/ui';
import { useAsync } from '../../shared/useAsync';
import { t } from '../../strings';
import { ht } from '../../strings/hr';
import { ConfirmWithReason, Dialog, DialogActions, FormError, SelectField, TextField, useAction, useSubmit } from '../components/Dialog';
import { Notice } from '../components/kit';
import { useWorkspace } from '../Workspace';

export const DocumentBadge = makeStatusBadge<string>(
  { VERIFIED: 'ok', PENDING: 'info', REJECTED: 'danger', EXPIRED: 'danger', SUPERSEDED: 'muted', REMOVED: 'muted', MISSING: 'warn' },
  ht.docStatus,
);

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
    // A photo is made smaller on the way out (uploadDocument), and refused there if it is still too large.
    file: !file
      ? ht.chooseFile
      : !DOCUMENT_ACCEPT.split(',').includes(file.type)
        ? ht.fileWrongType
        : file.type === 'application/pdf' && file.size > MAX_DOCUMENT_BYTES
          ? ht.fileTooLarge
          : undefined,
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

/** Verify or reject a pending document (reason required to reject). `onDone` gets the document that was reviewed. */
export function useDocumentReview(orgId: string, onDone: (d: EmployeeDocument) => void) {
  const [rejecting, setRejecting] = useState<EmployeeDocument | null>(null);
  const { busy, error, run } = useAction();
  const verify = (d: EmployeeDocument) =>
    run(async () => {
      await command('documents-review', { orgId, employeeId: d.employeeId, documentId: d.id, decision: 'VERIFY' });
      onDone(d);
    });
  const dialog = rejecting && (
    <ConfirmWithReason
      title={ht.rejectTitle(rejecting.typeName)}
      body={ht.rejectBody}
      confirmLabel={ht.reject}
      onClose={() => setRejecting(null)}
      onConfirm={async (reason) => {
        await command('documents-review', { orgId, employeeId: rejecting.employeeId, documentId: rejecting.id, decision: 'REJECT', reason });
        setRejecting(null);
        onDone(rejecting);
      }}
    />
  );
  return { verify, reject: setRejecting, dialog, error, busy };
}

/** A document across the organization (ids are only unique within an employee's file). */
export const documentKey = (d: Pick<EmployeeDocument, 'employeeId' | 'id'>) => `${d.employeeId}/${d.id}`;

/**
 * Reviews pending documents one after another: the file beside its details, then Verify, Reject (with a reason)
 * or Skip, and on to the next. Each document shown is opened once (the server records every opening), and the
 * decision goes through the same `documents-review` command as the buttons in the table.
 */
export function DocumentReviewDialog({
  orgId,
  documents,
  start = 0,
  onReviewed,
  onClose,
}: {
  orgId: string;
  /** Pending documents the viewer may review (not their own uploads), in the order to go through them. */
  documents: EmployeeDocument[];
  /** Where to begin; the ones before it come round at the end. */
  start?: number;
  /** A document is no longer pending: verified or rejected here, or found already reviewed or removed. */
  onReviewed: (d: EmployeeDocument) => void;
  onClose: () => void;
}) {
  const { branchName } = useWorkspace();
  // The list as it was when the dialog opened: the page drops reviewed rows behind it, and that must not move the place.
  const [list] = useState(() => [...documents.slice(start), ...documents.slice(0, start)]);
  const [index, setIndex] = useState(0);
  const [reviewed, setReviewed] = useState(0);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'warn'; text: string } | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [reasonTouched, setReasonTouched] = useState(false);
  const [shown, setShown] = useState<{ key: string; file?: FetchedFile; error?: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const { busy, error, setError, run } = useAction();
  // One opening per document shown, however often this renders (development mounts everything twice).
  const files = useRef(new Map<string, Promise<FetchedFile>>());
  const dropAll = useRef<ReturnType<typeof setTimeout>>(undefined);
  const place = useRef<HTMLParagraphElement>(null);
  const reasonBox = useRef<HTMLDivElement>(null);

  const current = list[index] as EmployeeDocument | undefined;
  const key = current ? documentKey(current) : '';
  const file = shown?.key === key ? shown.file : undefined;
  const fileError = shown?.key === key ? shown.error : undefined;

  /** Frees a file held in memory (they can be several megabytes each). */
  const release = (k: string) => {
    const opening = files.current.get(k);
    files.current.delete(k);
    opening?.then(
      (f) => URL.revokeObjectURL(f.url),
      () => undefined,
    );
  };

  useEffect(() => {
    clearTimeout(dropAll.current);
    const held = files.current;
    return () => {
      // A tick later: when development unmounts and remounts at once, the file already asked for is kept, not asked for twice.
      dropAll.current = setTimeout(() => {
        for (const opening of held.values())
          opening.then(
            (f) => URL.revokeObjectURL(f.url),
            () => undefined,
          );
        held.clear();
      }, 0);
    };
  }, []);

  useEffect(() => {
    if (!current) return;
    let live = true;
    const opening = files.current.get(key) ?? fetchDocument(orgId, current.employeeId, current.id);
    files.current.set(key, opening);
    opening.then(
      (f) => {
        if (live) setShown({ key, file: f });
      },
      (e: unknown) => {
        // Forgotten, so that Retry asks again.
        if (files.current.get(key) === opening) files.current.delete(key);
        if (live) setShown({ key, error: errorText(e) });
      },
    );
    return () => {
      live = false;
    };
  }, [orgId, current, key, attempt]);

  // On to the next: focus goes to the line that names it, never to Verify (a second Enter must not verify it unseen).
  useEffect(() => {
    place.current?.focus();
  }, [index]);
  useEffect(() => {
    if (rejecting) reasonBox.current?.querySelector('input')?.focus();
  }, [rejecting]);

  const next = () => {
    release(key);
    setRejecting(false);
    setReason('');
    setReasonTouched(false);
    setIndex((i) => i + 1);
  };
  const decide = (decision: 'VERIFY' | 'REJECT') =>
    run(async () => {
      if (!current || !file) return;
      const [type, who] = [current.typeName, current.employeeName];
      try {
        await command('documents-review', {
          orgId,
          employeeId: current.employeeId,
          documentId: current.id,
          decision,
          ...(decision === 'REJECT' ? { reason: reason.trim() } : {}),
        });
        setNotice({ tone: 'ok', text: decision === 'VERIFY' ? ht.reviewVerified(type, who) : ht.reviewRejected(type, who) });
      } catch (e) {
        // Reviewed by someone else meanwhile, or removed: nothing is left to decide here.
        if (!(e instanceof ApiError) || (e.reason !== 'NOT_PENDING' && e.reason !== 'NOT_FOUND')) throw e;
        setNotice({ tone: 'warn', text: e.reason === 'NOT_PENDING' ? ht.reviewAlreadyDone(type, who) : ht.reviewGone(type, who) });
      }
      setReviewed((n) => n + 1);
      onReviewed(current);
      next();
    });
  const reasonError = reason.trim().length < 3 ? ht.reviewReasonShort : undefined;

  return (
    // Escape and a click outside wait for a decision on its way, as the Close button does: its answer still belongs to this sitting.
    <Dialog
      title={ht.reviewTitle}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <div className="doc-review">
        {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
        <p
          className="doc-review-place"
          tabIndex={-1}
          ref={place}
          data-autofocus
          onKeyDown={(e) => {
            // Not a control, so the dialog's Tab wrap does not know it: going back from here would land on the page behind.
            if (e.key !== 'Tab' || !e.shiftKey) return;
            const controls = e.currentTarget.closest('[role="dialog"]')?.querySelectorAll<HTMLElement>('a[href], button:not(:disabled), input:not(:disabled)');
            if (!controls?.length) return;
            e.preventDefault();
            controls[controls.length - 1].focus();
          }}
        >
          {current ? `${ht.reviewPosition(index + 1, list.length)}: ${current.typeName}, ${current.employeeName}` : ht.reviewFinished(reviewed, list.length - reviewed)}
        </p>
        {current && (
          <div className="doc-review-body">
            <div className="doc-review-file">
              {fileError ? (
                <ErrorState
                  message={fileError}
                  onRetry={() => {
                    setShown(null);
                    setAttempt((n) => n + 1);
                  }}
                />
              ) : !file ? (
                <p className="muted" role="status">
                  {ht.reviewLoading}
                </p>
              ) : file.contentType === 'image/jpeg' || file.contentType === 'image/png' ? (
                <img src={file.url} alt={ht.reviewPreview(current.typeName, current.employeeName)} />
              ) : file.contentType === 'application/pdf' ? (
                // No sandbox: the browser's PDF viewer does not load inside a sandboxed frame.
                <iframe src={file.url} title={ht.reviewPreview(current.typeName, current.employeeName)} />
              ) : (
                <p className="muted">{ht.reviewNoPreview}</p>
              )}
            </div>
            <div className="doc-review-facts">
              <dl className="facts">
                <dt>{ht.employeeCol}</dt>
                <dd>
                  {current.employeeName} <span className="mono muted">{current.employeeCode}</span>
                </dd>
                <dt>{ht.branch}</dt>
                <dd>{current.branchId ? branchName(current.branchId) : ht.headOffice}</dd>
                <dt>{ht.documentCol}</dt>
                <dd>{current.typeName}</dd>
                {current.number && (
                  <>
                    <dt>{ht.reviewNumber}</dt>
                    <dd className="mono">{current.number}</dd>
                  </>
                )}
                {current.issuedOn && (
                  <>
                    <dt>{ht.reviewIssued}</dt>
                    <dd>{current.issuedOn}</dd>
                  </>
                )}
                {current.expiresOn && (
                  <>
                    <dt>{ht.reviewExpires}</dt>
                    <dd>
                      <ExpiryNote doc={current} />
                    </dd>
                  </>
                )}
                <dt>{ht.reviewUploaded}</dt>
                <dd>
                  {ht.reviewUploadedBy(
                    current.selfUploaded ? current.employeeName : (current.uploadedByEmail ?? '—'),
                    current.uploadedAt ? day(current.uploadedAt) : '',
                  )}
                </dd>
              </dl>
              {/* The same file already in memory: opening it this way is not a second opening on the record. */}
              {file && (
                <a href={file.url} target="_blank" rel="noreferrer">
                  {ht.reviewOpenTab}
                </a>
              )}
            </div>
          </div>
        )}
        <FormError error={error} />
        {current && rejecting ? (
          <form
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              setReasonTouched(true);
              if (!reasonError) void decide('REJECT');
            }}
          >
            <div ref={reasonBox}>
              <TextField label={ht.reviewReason} hint={ht.rejectBody} value={reason} onChange={setReason} error={reasonTouched ? reasonError : undefined} />
            </div>
            <div className="dialog-actions">
              <button type="button" className="btn btn-text" disabled={busy} onClick={() => setRejecting(false)}>
                {ht.reviewBack}
              </button>
              <button type="submit" className="btn btn-danger" disabled={busy || !file}>
                {busy ? t.saving : ht.reviewRejectConfirm}
              </button>
            </div>
          </form>
        ) : (
          <div className="dialog-actions">
            <button type="button" className="btn btn-text" disabled={busy} onClick={onClose}>
              {t.close}
            </button>
            {current && (
              <>
                <button
                  type="button"
                  className="btn btn-text"
                  disabled={busy}
                  onClick={() => {
                    setError(null);
                    setNotice(null);
                    next();
                  }}
                >
                  {ht.reviewSkip}
                </button>
                {/* Both wait for the file: nothing is decided before it can be seen. */}
                <button type="button" className="btn btn-outlined" disabled={busy || !file} onClick={() => setRejecting(true)}>
                  {ht.reject}
                </button>
                <button type="button" className="btn btn-filled" disabled={busy || !file} onClick={() => void decide('VERIFY')}>
                  {busy ? t.saving : ht.verify}
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </Dialog>
  );
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
  // Where the review dialog starts, in the list of documents waiting for this viewer.
  const [reviewing, setReviewing] = useState<number | null>(null);
  const refresh = () => {
    data.reload();
    onChanged();
  };
  const review = useDocumentReview(orgId, refresh);

  if (data.loading) return <SkeletonRows rows={3} />;
  // A refresh that failed keeps what is on screen, and the review dialog open over it; the note below says so.
  if (!data.data) return <ErrorState message={data.error ?? t.errorGeneric} onRetry={data.reload} />;
  const { types, docs } = data.data;
  const active = types.filter((x) => x.status === 'ACTIVE');
  const uploadable = active.filter((x) => canManage || (self && x.selfUpload));
  const typeOf = new Map(types.map((x) => [x.id, x]));
  const current = docs.filter((d) => d.status !== 'SUPERSEDED' && d.status !== 'REMOVED');
  const shown = history ? docs : current;
  const rank: Record<string, number> = { VERIFIED: 4, PENDING: 3, REJECTED: 2, EXPIRED: 1 };
  const best = (typeId: string) => current.filter((d) => d.typeId === typeId).sort((a, b) => (rank[b.status] ?? 0) - (rank[a.status] ?? 0))[0];
  const required = active.filter((x) => x.required);
  // Never one's own upload: someone else verifies those (the server refuses it too).
  const reviewable = canVerify ? docs.filter((d) => d.status === 'PENDING' && d.uploadedBy !== user?.uid) : [];
  const open = async (d: EmployeeDocument) => {
    setOpenError(null);
    try {
      await openDocument(orgId, employee.id, d.id);
    } catch (e) {
      setOpenError(errorText(e));
    }
  };

  return (
    <>
      {notice && <Notice tone="ok">{notice}</Notice>}
      {data.error && (
        <Notice tone="error">
          {data.error}{' '}
          <button type="button" className="btn btn-text" onClick={data.reload}>
            {t.retry}
          </button>
        </Notice>
      )}
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
          <div className="row">
            {reviewable.length > 0 && (
              <button type="button" className="btn btn-filled" onClick={() => setReviewing(0)}>
                {ht.reviewPending(reviewable.length)}
              </button>
            )}
            {uploadable.length > 0 && employee.status !== 'OFFBOARDED' && (
              <button type="button" className="btn btn-outlined" onClick={() => setUploading('any')}>
                <Icon name="plus" /> {ht.uploadDocument}
              </button>
            )}
          </div>
        </div>
        {canVerify && <p className="muted small">{ht.verifyUploadedHint}</p>}
        <label className="check">
          <input type="checkbox" checked={history} onChange={(e) => setHistory(e.target.checked)} />
          {ht.showHistory}
        </label>
        {!shown.length ? (
          <p className="muted">{ht.noDocuments}</p>
        ) : (
          <TableWrap>
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
                            <button type="button" className="btn btn-text" onClick={() => setReviewing(Math.max(0, reviewable.indexOf(d)))} aria-label={`${ht.review} ${d.typeName}`}>
                              {ht.review}
                            </button>
                            <button type="button" className="btn btn-text" disabled={review.busy} onClick={() => void review.verify(d)} aria-label={`${ht.verify} ${d.typeName}`}>
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
          </TableWrap>
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
      {/* Each decision refreshes the tab behind: it can tick an onboarding item and replace an older copy. */}
      {reviewing !== null && <DocumentReviewDialog orgId={orgId} documents={reviewable} start={reviewing} onReviewed={refresh} onClose={() => setReviewing(null)} />}
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
