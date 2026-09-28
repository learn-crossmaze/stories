import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';

import { useAuth } from '../../auth/AuthContext';
import { can } from '../../auth/claims';
import { callAction, command, toApiError } from '../../data/api';
import { type Book, CONDITIONS, type Condition, copiesOfBook, getBook, label, LANGUAGES, listLocations } from '../../data/library';
import { services } from '../../data/services';
import { useAsync } from '../../data/useAsync';
import { money, toMinor } from '../../format';
import { paths } from '../../paths';
import { t } from '../../strings';
import { EmptyState, ErrorState, Icon, SkeletonRows, StatusBadge } from '../../ui';
import { ConfirmWithReason, Dialog, DialogActions, FormError, SelectField, TextArea, TextField, useSubmit } from '../Dialog';
import { CoverEditor } from '../CoverEditor';
import { Notice } from '../kit';
import { lt } from '../libraryStrings';
import { useWorkspace } from '../Workspace';
import { BookDialog, useCanAddBooks, useCanDeleteBooks, useCanEditCatalogue } from './Catalogue';
import { CopyStatusBadge } from './Inventory';

function AcquireDialog({ orgId, branchId, book, onClose, onDone }: { orgId: string; branchId: string; book: Book; onClose: () => void; onDone: (n: number) => void }) {
  const locations = useAsync(() => listLocations(orgId, branchId), [orgId, branchId]);
  const [f, setF] = useState({ quantity: '1', cost: book.replacementPriceMinor ? String(book.replacementPriceMinor / 100) : '', condition: 'NEW' as Condition, locationId: '', barcodes: '' });
  const [touched, setTouched] = useState(false);
  const set = <K extends keyof typeof f>(k: K) => (v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }));
  const quantity = Number(f.quantity);
  const barcodes = f.barcodes.split(/\s+/).map((b) => b.trim().toUpperCase()).filter(Boolean);
  const errors = {
    quantity: Number.isInteger(quantity) && quantity >= 1 && quantity <= 50 ? undefined : 'Between 1 and 50.',
    cost: f.cost && toMinor(f.cost) >= 0 ? undefined : 'Enter the cost in rupees.',
    barcodes: !barcodes.length || barcodes.length === quantity ? undefined : `Scan exactly ${quantity} barcodes, or leave empty.`,
  };
  const { busy, error, submit } = useSubmit(async () => {
    setTouched(true);
    if (Object.values(errors).some(Boolean)) return;
    await command('copies-acquire', { orgId, branchId, bookId: book.id, quantity, acquisitionCostMinor: toMinor(f.cost), condition: f.condition, locationId: f.locationId || null, barcodes });
    onDone(quantity);
    onClose();
  });
  return (
    <Dialog title={`${lt.addCopies} — ${book.title}`} onClose={onClose}>
      <form onSubmit={submit} noValidate className="form-grid">
        <TextField label={lt.quantity} type="number" value={f.quantity} onChange={set('quantity')} error={touched ? errors.quantity : undefined} />
        <TextField label={lt.cost} value={f.cost} onChange={set('cost')} error={touched ? errors.cost : undefined} />
        <SelectField label={lt.condition} value={f.condition} onChange={set('condition')} options={CONDITIONS.map((c) => ({ value: c, label: label(c) }))} />
        <SelectField
          label={lt.location}
          value={f.locationId}
          onChange={set('locationId')}
          options={[{ value: '', label: lt.noLocation }, ...(locations.data ?? []).filter((l) => l.status === 'ACTIVE').map((l) => ({ value: l.id, label: `${l.code} · ${l.label}` }))]}
        />
        <div className="span-2">
          <TextArea label={lt.ownBarcodes} value={f.barcodes} onChange={set('barcodes')} hint={lt.ownBarcodesHint} error={touched ? errors.barcodes : undefined} />
          <FormError error={error} />
          <DialogActions busy={busy} submitLabel={lt.addCopies} onCancel={onClose} />
        </div>
      </form>
    </Dialog>
  );
}

interface Availability {
  branches: { branchId: string; branchName: string; available: number; total: number }[];
}

export function BookDetailPage() {
  const { bookId = '' } = useParams();
  const { claims } = useAuth();
  const { org, branch } = useWorkspace();
  const canEdit = useCanEditCatalogue();
  const canDelete = useCanDeleteBooks();
  const canAdd = useCanAddBooks();
  const book = useAsync(() => getBook(bookId), [bookId]);
  const availability = useAsync(
    async () => (org ? await callAction<Availability>(services().fns, 'copies-availability', { orgId: org.id, bookId }) : { branches: [] }),
    [org?.id, bookId],
  );
  const copies = useAsync(() => (org && branch ? copiesOfBook(org.id, branch.id, bookId) : Promise.resolve([])), [org?.id, branch?.id, bookId]);
  const [dialog, setDialog] = useState<'edit' | 'acquire' | 'archive' | 'delete' | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const navigate = useNavigate();
  const [notice, setNotice] = useState<string | null>(null);

  if (book.loading) return <SkeletonRows rows={4} />;
  if (book.error) return <ErrorState message={book.error} onRetry={book.reload} />;
  const b = book.data;
  if (!b) return <EmptyState icon="book" title={t.notFoundTitle} message="" />;
  const canAcquire = !!org && !!branch && can(claims, 'copies.manage', org.id, branch.id) && b.status === 'ACTIVE';

  return (
    <>
      <p className="breadcrumb">
        <Link to={paths.adminBooks}>{lt.catalogueTitle}</Link> / <span className="mono">{b.code}</span>
      </p>
      <section className="book-hero">
        {/* Book creators may add a missing cover; changing or removing one is for catalogue editors. */}
        <CoverEditor book={b} canEdit={canEdit || (canAdd && !b.coverUrl && b.status === 'ACTIVE')} onChanged={book.reload} />
        <div className="book-facts">
          <h1>{b.title}</h1>
          {b.subtitle && <p className="muted">{b.subtitle}</p>}
          <p className="book-by">{b.authorNames.join(', ')}</p>
          <dl className="facts">
            <dt>{lt.ageGroup}</dt>
            <dd>{label(b.ageGroup)}{b.minAge != null ? ` (${b.minAge}+)` : ''} · {label(b.readingLevel)}</dd>
            <dt>{lt.genres.replace(' (up to 3)', '')}</dt>
            <dd>{b.genres.map(label).join(', ')}</dd>
            <dt>{lt.language}</dt>
            <dd>{LANGUAGES[b.language]}</dd>
            {b.isbn && (
              <>
                <dt>ISBN</dt>
                <dd className="mono">{b.isbn}</dd>
              </>
            )}
            {b.publisherName && (
              <>
                <dt>{lt.publisher}</dt>
                <dd>{b.publisherName}{b.publicationYear ? `, ${b.publicationYear}` : ''}{b.edition ? ` · ${b.edition}` : ''}</dd>
              </>
            )}
            {b.categoryNames.length > 0 && (
              <>
                <dt>{lt.categories}</dt>
                <dd>{b.categoryNames.join(', ')}</dd>
              </>
            )}
            <dt>{lt.replacementPrice.replace(' (₹)', '')}</dt>
            <dd>{b.replacementPriceMinor ? money(b.replacementPriceMinor) : '—'}</dd>
          </dl>
          {b.synopsis && <p className="synopsis">{b.synopsis}</p>}
          <div className="row">
            <StatusBadge status={b.status} />
            {canEdit && (
              <button type="button" className="btn btn-outlined" onClick={() => setDialog('edit')}>
                {t.edit}
              </button>
            )}
            {canEdit && b.status === 'ACTIVE' && (
              <button type="button" className="btn btn-text" onClick={() => setDialog('archive')}>
                {t.archive}
              </button>
            )}
            {canEdit && b.status === 'ARCHIVED' && (
              <button
                type="button"
                className="btn btn-text"
                disabled={restoring}
                onClick={async () => {
                  setRestoring(true);
                  setActionError(null);
                  try {
                    await command('books-restore', { bookId: b.id });
                    book.reload();
                  } catch (e) {
                    setActionError(toApiError(e).message);
                  } finally {
                    setRestoring(false);
                  }
                }}
              >
                {restoring ? t.saving : lt.restoreBook}
              </button>
            )}
            {canDelete && b.status === 'ARCHIVED' && (
              <button type="button" className="btn btn-text danger" onClick={() => setDialog('delete')}>
                {lt.deleteBook}
              </button>
            )}
          </div>
          {b.status === 'ARCHIVED' && <p className="muted small">{canDelete ? lt.archivedHintDelete : lt.archivedHint}</p>}
          {actionError && (
            <p className="field-error" role="alert">
              {actionError}
            </p>
          )}
        </div>
      </section>

      <section className="section">
        <h2>{lt.availability}</h2>
        {availability.loading ? (
          <SkeletonRows rows={2} />
        ) : !availability.data?.branches.length ? (
          <p className="muted">{lt.noStock}</p>
        ) : (
          <ul className="avail">
            {availability.data.branches.map((a) => (
              <li key={a.branchId}>
                <strong>{a.branchName}</strong>
                <span className={a.available ? 'ok' : 'muted'}>{lt.availableOf(a.available, a.total)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {branch && (
        <section className="section">
          <div className="page-header-row">
            <h2>
              {lt.copiesHere} <span className="muted">· {branch.name}</span>
            </h2>
            <div className="row">
              {!!copies.data?.length && (
                <Link className="btn btn-outlined" to={`${paths.adminLabels}?copies=${copies.data.map((c) => c.id).join(',')}`}>
                  <Icon name="print" /> {lt.printLabels}
                </Link>
              )}
              {canAcquire && (
                <button type="button" className="btn btn-filled" onClick={() => setDialog('acquire')}>
                  <Icon name="plus" /> {lt.addCopies}
                </button>
              )}
            </div>
          </div>
          {notice && <Notice tone="ok">{notice}</Notice>}
          {copies.loading ? (
            <SkeletonRows rows={2} />
          ) : copies.error ? (
            <ErrorState message={copies.error} onRetry={copies.reload} />
          ) : !copies.data?.length ? (
            <p className="muted">{lt.copiesEmpty}</p>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">{lt.copy}</th>
                    <th scope="col">{lt.status}</th>
                    <th scope="col">{lt.condition}</th>
                    <th scope="col">{lt.loans}</th>
                  </tr>
                </thead>
                <tbody>
                  {copies.data.map((c) => (
                    <tr key={c.id}>
                      <td>
                        <Link to={paths.adminCopy(c.id)} className="mono">
                          {c.code}
                        </Link>
                      </td>
                      <td>
                        <CopyStatusBadge status={c.status} />
                      </td>
                      <td>{label(c.condition)}</td>
                      <td>{c.lifetimeLoans}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {dialog === 'edit' && <BookDialog book={b} onClose={() => setDialog(null)} onSaved={() => book.reload()} />}
      {dialog === 'acquire' && org && branch && (
        <AcquireDialog
          orgId={org.id}
          branchId={branch.id}
          book={b}
          onClose={() => setDialog(null)}
          onDone={(n) => {
            setNotice(lt.added(n));
            copies.reload();
            availability.reload();
          }}
        />
      )}
      {dialog === 'archive' && (
        <ConfirmWithReason
          title={lt.archiveBook(b.title)}
          body={lt.archiveBookBody}
          confirmLabel={t.archive}
          onClose={() => setDialog(null)}
          onConfirm={async (reason) => {
            await command('books-archive', { bookId: b.id, reason });
            book.reload();
            setDialog(null);
          }}
        />
      )}
      {dialog === 'delete' && (
        <ConfirmWithReason
          title={lt.deleteBookTitle(b.title)}
          body={lt.deleteBookBody}
          confirmLabel={lt.deleteBook}
          onClose={() => setDialog(null)}
          onConfirm={async (reason) => {
            await command('books-delete', { bookId: b.id, reason });
            navigate(paths.adminBooks, { replace: true });
          }}
        />
      )}
    </>
  );
}
