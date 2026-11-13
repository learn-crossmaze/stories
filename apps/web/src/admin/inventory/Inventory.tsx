import { useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router';

import { useAuth } from '../../auth/AuthContext';
import { can } from '../../auth/claims';
import { command } from '../../data/api';
import { CONDITIONS, type Condition, COPY_STATUSES, type CopyStatus, label } from '../../data/common';
import { type Copy, copyEvents, type CopyWhereabouts, findCopy, getCopy, listCopies, listLocations, locateCopy, searchCopiesByTitle, unshelvedCount } from '../../data/inventory';
import { getBook } from '../../data/catalogue';
import { BookCover } from '../../shared/BookCover';
import { useDebounced } from '../../shared/useDebounced';
import { usePagedQuery } from '../../shared/usePagedQuery';
import { useAsync } from '../../shared/useAsync';
import { money, when } from '../../shared/format';
import { paths } from '../../paths';
import { t } from '../../strings';
import { EmptyState, ErrorState, Icon, makeStatusBadge, SkeletonRows, TableWrap } from '../../shared/ui';
import { ConfirmWithReason, Dialog, DialogActions, FormError, SelectField, TextField, useSubmit } from '../components/Dialog';
import { NeedBranch, Notice, QrTag, ScanInput } from '../components/kit';
import { lt } from '../../strings/library';
import { useWorkspace } from '../Workspace';

/** Status chip with text (never colour alone). */
export const CopyStatusBadge = makeStatusBadge<CopyStatus>(
  { AVAILABLE: 'ok', RESERVED: 'info', ISSUED: 'info', IN_TRANSIT: 'info', UNDER_INSPECTION: 'warn', DAMAGED: 'warn', LOST: 'danger', RETIRED: 'muted' },
  label,
);

function LocationDialog({ orgId, branchId, onClose, onSaved }: { orgId: string; branchId: string; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ code: '', label: '', kind: 'SHELF' as 'SHELF' | 'DISPLAY' | 'DESK' | 'BACKROOM' });
  const { busy, error, submit } = useSubmit(async () => {
    await command('locations-create', { orgId, branchId, ...f, code: f.code.trim() });
    onSaved();
    onClose();
  });
  return (
    <Dialog title={lt.newLocation} onClose={onClose} narrow>
      <form onSubmit={submit} noValidate>
        <TextField label={lt.code} value={f.code} onChange={(code) => setF({ ...f, code })} hint={`e.g. A-03-2. ${lt.locationCodeAuto}`} />
        <TextField label={lt.labelText} value={f.label} onChange={(l) => setF({ ...f, label: l })} hint="e.g. Children · bay 3 · shelf 2" />
        <SelectField label={lt.kind} value={f.kind} onChange={(kind) => setF({ ...f, kind })} options={['SHELF', 'DISPLAY', 'DESK', 'BACKROOM'].map((k) => ({ value: k as typeof f.kind, label: label(k) }))} />
        <FormError error={error} />
        <DialogActions busy={busy} submitLabel={t.create} onCancel={onClose} />
      </form>
    </Dialog>
  );
}

function BranchInventory({ orgId, branchId }: { orgId: string; branchId: string }) {
  const { claims } = useAuth();
  const navigate = useNavigate();
  const [status, setStatus] = useState<CopyStatus | ''>('');
  const [q, setQ] = useState('');
  const title = useDebounced(q.trim());
  const searching = title.length >= 2;
  const [scanMsg, setScanMsg] = useState<string | null>(null);
  const [elsewhere, setElsewhere] = useState<CopyWhereabouts | null>(null);
  const locations = useAsync(() => listLocations(orgId, branchId), [orgId, branchId]);
  const [newLoc, setNewLoc] = useState(false);
  const manage = can(claims, 'copies.manage', orgId, branchId);

  const list = usePagedQuery<Copy>(
    async (after) => {
      if (!searching) return listCopies(orgId, branchId, status, after);
      // Title search: every matching copy at once, filtered by status here.
      const found = await searchCopiesByTitle(orgId, branchId, title);
      return { items: status ? found.filter((c) => c.status === status) : found };
    },
    [orgId, branchId, status, title],
  );
  const copies = list.items;

  const locName = (id: string | null) => (id ? (locations.data?.find((l) => l.id === id)?.code ?? '—') : '—');

  return (
    <>
      <div className="toolbar">
        <ScanInput
          label={lt.findCopy}
          onScan={async (v) => {
            setScanMsg(null);
            setElsewhere(null);
            const c = await findCopy(orgId, branchId, v);
            // The copy just read goes along, so its page paints at once (CopyDetailPage).
            if (c) return navigate(paths.adminCopy(c.id), { state: { copy: c } });
            // Not here: find which branch holds it (staff can't open other branches' copies directly).
            try {
              const w = await locateCopy(orgId, v);
              if (w?.canOpen) navigate(paths.adminCopy(w.copyId));
              else if (w) setElsewhere(w);
              else setScanMsg(lt.copyNotFound);
            } catch (e) {
              console.warn('locate copy', e);
              setScanMsg(lt.copyNotFound);
            }
          }}
        />
        <input className="search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={lt.searchCopiesByTitle} aria-label={lt.searchCopiesByTitle} />
        <select value={status} onChange={(e) => setStatus(e.target.value as CopyStatus | '')} aria-label={lt.status}>
          <option value="">{lt.allStatuses}</option>
          {COPY_STATUSES.map((s) => (
            <option key={s} value={s}>
              {label(s)}
            </option>
          ))}
        </select>
      </div>
      {scanMsg && <Notice tone="warn">{scanMsg}</Notice>}
      {elsewhere && (
        <Notice tone="ok">
          {lt.copyElsewhere(elsewhere.code, elsewhere.bookTitle, elsewhere.currentBranchName, label(elsewhere.status))}{' '}
          <Link to={paths.adminBook(elsewhere.bookId)}>{lt.viewBook}</Link>
        </Notice>
      )}
      {list.error && copies.length === 0 ? (
        <ErrorState message={list.error} onRetry={list.reload} />
      ) : list.loading && copies.length === 0 ? (
        <SkeletonRows rows={6} />
      ) : copies.length === 0 ? (
        <EmptyState icon="shelves" title={searching ? lt.noCopiesMatch(title) : lt.copiesEmpty} message="" />
      ) : (
        <>
          <TableWrap>
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">{lt.copy}</th>
                  <th scope="col">{lt.title}</th>
                  <th scope="col">{lt.status}</th>
                  <th scope="col">{lt.condition}</th>
                  <th scope="col">{lt.location}</th>
                </tr>
              </thead>
              <tbody>
                {copies.map((c) => (
                  <tr key={c.id}>
                    <td className="nowrap">
                      <Link to={paths.adminCopy(c.id)} state={{ copy: c }} className="mono">
                        {c.code}
                      </Link>
                    </td>
                    <td>
                      <Link to={paths.adminBook(c.bookId)}>{c.bookTitle}</Link>
                    </td>
                    <td>
                      <CopyStatusBadge status={c.status} />
                    </td>
                    <td>{label(c.condition)}</td>
                    {c.locationId || c.status !== 'AVAILABLE' ? (
                      <td className="mono">{locName(c.locationId)}</td>
                    ) : (
                      <td className="muted">{lt.unshelved}</td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
          {list.error && <p className="form-error" role="alert">{list.error}</p>}
          {list.hasMore && (
            <button type="button" className="btn btn-outlined load-more" disabled={list.loading} onClick={list.loadMore}>
              {list.loading ? t.loading : t.loadMore}
            </button>
          )}
        </>
      )}

      <section className="section">
        <div className="page-header-row">
          <h2>{lt.locations}</h2>
          {manage && (
            <button type="button" className="btn btn-outlined" onClick={() => setNewLoc(true)}>
              <Icon name="plus" /> {lt.newLocation}
            </button>
          )}
        </div>
        {!locations.data?.length ? (
          <p className="muted">{lt.refEmpty}</p>
        ) : (
          <ul className="chips">
            {locations.data.filter((l) => l.status === 'ACTIVE').map((l) => (
              <li key={l.id}>
                <span className="mono">{l.code}</span> {l.label}
              </li>
            ))}
          </ul>
        )}
      </section>
      {newLoc && <LocationDialog orgId={orgId} branchId={branchId} onClose={() => setNewLoc(false)} onSaved={locations.reload} />}
    </>
  );
}

export function InventoryPage() {
  const { org, branch } = useWorkspace();
  const { claims } = useAuth();
  const canReceive = !!org && !!branch && can(claims, 'copies.manage', org.id, branch.id);
  const unshelved = useAsync(() => (org && branch && canReceive ? unshelvedCount(org.id, branch.id) : Promise.resolve(0)), [org?.id, branch?.id, canReceive]);
  return (
    <>
      <header className="page-header page-header-row">
        <h1>{lt.inventoryTitle}</h1>
        {canReceive && (
          <div className="row">
            <Link className="btn btn-outlined" to={paths.adminShelve}>
              <Icon name="shelves" /> {lt.shelveButton(unshelved.data ?? 0)}
            </Link>
            <Link className="btn btn-filled" to={paths.adminBooksBulk}>
              <Icon name="plus" /> {lt.bulkNav}
            </Link>
          </div>
        )}
      </header>
      <NeedBranch>{(branchId) => org && <BranchInventory orgId={org.id} branchId={branchId} />}</NeedBranch>
    </>
  );
}

// ------------------------------------------------------------------ copy detail

type Action = 'inspect' | 'repair' | 'move' | 'condition' | 'lost' | 'found' | 'retire';

interface ConditionValues {
  condition: Condition;
  note: string;
  outcome: 'PASS' | 'DAMAGED';
  locationId: string;
}

function ConditionDialog({ title, onClose, run, showOutcome, locations, initial, unchanged }: {
  title: string;
  onClose: () => void;
  run: (v: ConditionValues) => Promise<void>;
  showOutcome?: boolean;
  locations?: { value: string; label: string }[];
  /** What the copy has now, to start from (GOOD and no shelf otherwise). */
  initial?: { condition?: Condition; locationId?: string };
  /** Nothing to save as it stands (a move to the shelf the copy is on). */
  unchanged?: (v: ConditionValues) => boolean;
}) {
  const [v, setV] = useState<ConditionValues>({ condition: initial?.condition ?? 'GOOD', note: '', outcome: 'PASS', locationId: initial?.locationId ?? '' });
  const { busy, error, submit } = useSubmit(() => run(v).then(onClose));
  return (
    <Dialog title={title} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        {showOutcome && (
          <SelectField label={lt.inspect} value={v.outcome} onChange={(outcome) => setV({ ...v, outcome })} options={[{ value: 'PASS', label: lt.passInspection }, { value: 'DAMAGED', label: lt.failInspection }]} />
        )}
        {locations ? (
          <SelectField label={lt.location} value={v.locationId} onChange={(locationId) => setV({ ...v, locationId })} options={[{ value: '', label: lt.noLocation }, ...locations]} />
        ) : (
          <SelectField label={lt.condition} value={v.condition} onChange={(condition) => setV({ ...v, condition })} options={CONDITIONS.map((c) => ({ value: c, label: label(c) }))} />
        )}
        {!locations && <TextField label={lt.note} value={v.note} onChange={(note) => setV({ ...v, note })} />}
        <FormError error={error} />
        <DialogActions busy={busy} disabled={unchanged?.(v)} submitLabel={t.save} onCancel={onClose} />
      </form>
    </Dialog>
  );
}

export function CopyDetailPage() {
  const { copyId = '' } = useParams();
  const { claims } = useAuth();
  const { org, branchName } = useWorkspace();
  const orgId = org?.id ?? '';
  const copy = useAsync(() => (orgId ? getCopy(orgId, copyId) : Promise.resolve(null)), [orgId, copyId]);
  const events = useAsync(() => (orgId ? copyEvents(orgId, copyId) : Promise.resolve([])), [orgId, copyId]);
  // Opened from a scan or a list row, the copy read there shows while this page reads it afresh: only then, and
  // only for this copy (history keeps the state through Back, Forward and a reload, so it can be hours old).
  const seed = (useLocation().state as { copy?: Copy } | null)?.copy;
  const c = !copy.loading ? copy.data : seed?.id === copyId ? seed : undefined;
  const locations = useAsync(() => (orgId && c ? listLocations(orgId, c.currentBranchId) : Promise.resolve([])), [orgId, c?.currentBranchId]);
  // The title's cover and authors (a generated cover when there is no photo).
  const book = useAsync(() => (c ? getBook(c.bookId) : Promise.resolve(null)), [c?.bookId]);
  const authors = book.data?.authorNames?.join(', ') ?? '';
  const [action, setAction] = useState<Action | null>(null);

  if (copy.loading && !c) return <SkeletonRows rows={4} />;
  if (copy.error) return <ErrorState message={copy.error} onRetry={copy.reload} />;
  if (!c) return <EmptyState page icon="shelves" title={t.notFoundTitle} message="" />;
  const refresh = () => {
    copy.reload();
    events.reload();
  };
  const manage = can(claims, 'copies.manage', orgId, c.currentBranchId);
  const writeOff = can(claims, 'copies.writeOff', orgId, c.currentBranchId);
  const act = (name: string, body: Record<string, unknown>) => command(name, { orgId, copyId: c.id, ...body }).then(refresh);
  const buttons: [Action, string, boolean][] = [
    ['inspect', lt.inspect, manage && c.status === 'UNDER_INSPECTION'],
    ['repair', lt.repair, manage && c.status === 'DAMAGED'],
    ['move', lt.relocate, manage && ['AVAILABLE', 'RESERVED', 'DAMAGED', 'UNDER_INSPECTION'].includes(c.status)],
    ['condition', lt.recordCondition, manage && ['AVAILABLE', 'RESERVED', 'UNDER_INSPECTION', 'DAMAGED'].includes(c.status)],
    ['found', lt.found, manage && c.status === 'LOST'],
    ['lost', lt.markLost, writeOff && ['AVAILABLE', 'DAMAGED'].includes(c.status)],
    ['retire', lt.retire, writeOff && ['AVAILABLE', 'DAMAGED', 'LOST'].includes(c.status)],
  ];
  const locOptions = (locations.data ?? []).filter((l) => l.status === 'ACTIVE').map((l) => ({ value: l.id, label: `${l.code} · ${l.label}` }));

  return (
    <>
      <p className="breadcrumb">
        <Link to={paths.adminInventory}>{lt.inventoryTitle}</Link> / <span className="mono">{c.code}</span>
      </p>
      <section className="card copy-card">
        <div className="copy-summary">
          <div className="copy-main">
            <header className="copy-head">
              <h1 className="mono">{c.code}</h1>
              <p className="copy-title">
                <Link to={paths.adminBook(c.bookId)}>{c.bookTitle}</Link>
              </p>
              {authors && <p className="muted">{authors}</p>}
              <CopyStatusBadge status={c.status} />
            </header>
            <dl className="facts">
              <dt>{lt.condition}</dt>
              <dd>{label(c.condition)}</dd>
              <dt>{lt.currentlyAt}</dt>
              <dd>
                {branchName(c.currentBranchId)} · <span className="mono">{locOptions.find((l) => l.value === c.locationId)?.label ?? lt.noLocation}</span>
              </dd>
              <dt>{lt.owner}</dt>
              <dd>{branchName(c.owningBranchId)}</dd>
              <dt>{lt.cost.replace(' per copy (₹)', '')}</dt>
              <dd>{money(c.acquisitionCostMinor)}</dd>
              <dt>{lt.loans}</dt>
              <dd>{c.lifetimeLoans}</dd>
            </dl>
          </div>
          <div className="copy-media">
            <BookCover title={c.bookTitle} author={authors} seed={c.bookId} url={book.data?.coverUrl} size="lg" />
            <QrTag value={c.barcode} code={c.barcode} title={c.bookTitle} className="qr-tag-card qr-tag-large" />
          </div>
        </div>
        <div className="row">
          {buttons.filter(([, , show]) => show).map(([a, text]) => (
            // Held while the copy shown is the one carried here: a form opened then would start from what the copy was.
            <button key={a} type="button" className={`btn ${a === 'retire' || a === 'lost' ? 'btn-text' : 'btn-outlined'}`} disabled={copy.loading} onClick={() => setAction(a)}>
              {text}
            </button>
          ))}
        </div>
      </section>

      <section className="section">
        <h2>{lt.history}</h2>
        {events.loading ? (
          <SkeletonRows rows={3} />
        ) : (
          <ol className="timeline">
            {(events.data ?? []).map((e) => (
              <li key={e.id}>
                <span className="timeline-when">{when(e.at)}</span>
                <span className="timeline-what">
                  <strong>{label(e.type)}</strong>
                  {e.fromStatus !== e.toStatus && (
                    <span className="muted">
                      {' '}
                      {e.fromStatus ? `${label(e.fromStatus)} → ` : ''}
                      {label(e.toStatus)}
                    </span>
                  )}
                  {e.note && <span className="muted"> · {e.note}</span>}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>

      {action === 'inspect' && (
        <ConditionDialog title={lt.inspect} showOutcome initial={{ condition: c.condition }} onClose={() => setAction(null)} run={(v) => act('copies-inspect', { outcome: v.outcome, condition: v.condition, note: v.note })} />
      )}
      {action === 'repair' && <ConditionDialog title={lt.repair} onClose={() => setAction(null)} run={(v) => act('copies-repair', { condition: v.condition, note: v.note })} />}
      {action === 'condition' && (
        <ConditionDialog title={lt.recordCondition} initial={{ condition: c.condition }} onClose={() => setAction(null)} run={(v) => act('copies-recordCondition', { condition: v.condition, note: v.note })} />
      )}
      {/* Opens once the shelves are read, so it starts on the copy's own shelf (one since archived is not in the list). */}
      {action === 'move' && !locations.loading && (
        <ConditionDialog
          title={lt.relocate}
          locations={locOptions}
          initial={{ locationId: locOptions.some((l) => l.value === c.locationId) ? (c.locationId ?? '') : '' }}
          unchanged={(v) => (v.locationId || null) === (c.locationId ?? null)}
          onClose={() => setAction(null)}
          run={(v) => act('copies-relocate', { locationId: v.locationId || null })}
        />
      )}
      {action === 'found' && <ConditionDialog title={lt.found} onClose={() => setAction(null)} run={(v) => act('copies-found', { note: v.note })} />}
      {action === 'lost' && (
        <ConfirmWithReason title={lt.lostTitle(c.code)} body={lt.lostBody} confirmLabel={lt.markLost} onClose={() => setAction(null)} onConfirm={(reason) => act('copies-markLost', { reason }).then(() => setAction(null))} />
      )}
      {action === 'retire' && (
        <ConfirmWithReason title={lt.retireTitle(c.code)} body={lt.retireBody} confirmLabel={lt.retire} onClose={() => setAction(null)} onConfirm={(reason) => act('copies-retire', { reason }).then(() => setAction(null))} />
      )}
    </>
  );
}

// ------------------------------------------------------------------ labels

/** What one printed label shows. */
export interface LabelData {
  barcode: string;
  title: string;
}

/** Copy ids the labels link carries in its address (what a new tab, or a pasted link, can print). */
export const LABELS_IN_LINK = 120;
/** Labels on one A4 sheet (3 × 8). */
const LABELS_PER_SHEET = 24;

/**
 * Where a "Print labels" link goes, for copies already in hand: the labels travel with the link (router state), so
 * the sheet shows at once, however many there are. The address also carries the first copy ids, which is what a
 * new tab reads instead. `barcode` is what the label holds: the copy's own barcode, never just its code.
 */
export function labelsLink(copies: (LabelData & { id: string })[]) {
  return {
    to: `${paths.adminLabels}?copies=${copies.slice(0, LABELS_IN_LINK).map((c) => c.id).join(',')}`,
    state: { labels: copies.map(({ barcode, title }): LabelData => ({ barcode, title })) },
  };
}

const handedLabels = (state: unknown): LabelData[] | null => {
  const list = (state as { labels?: unknown } | null)?.labels;
  const ok = Array.isArray(list) && list.length > 0 && list.every((l: unknown) => !!l && typeof (l as LabelData).barcode === 'string' && typeof (l as LabelData).title === 'string');
  return ok ? (list as LabelData[]) : null;
};

/**
 * Printable label sheet (A4, 3 × 8). The labels come with the link that led here (`labelsLink`); opened any
 * other way, the copies in ?copies=id,id,… are read (the first 120).
 */
export function LabelsPage() {
  const [params] = useSearchParams();
  const { org } = useWorkspace();
  const handed = handedLabels(useLocation().state);
  const ids = handed ? [] : (params.get('copies') ?? '').split(',').filter(Boolean).slice(0, LABELS_IN_LINK);
  const read = useAsync(async () => {
    if (!org || !ids.length) return { labels: [] as LabelData[], missing: 0 };
    // One copy that can't be read (it has moved to another branch) must not blank the whole sheet.
    const settled = await Promise.allSettled(ids.map((id) => getCopy(org.id, id)));
    const found = settled.flatMap((s) => (s.status === 'fulfilled' && s.value ? [{ barcode: s.value.barcode, title: s.value.bookTitle }] : []));
    const refused = settled.find((s) => s.status === 'rejected');
    if (!found.length && refused) throw refused.reason;
    return { labels: found, missing: ids.length - found.length };
  }, [org?.id, ids.join(',')]);
  const labels = handed ?? read.data?.labels ?? [];
  const loading = !handed && read.loading;
  return (
    <>
      <header className="page-header page-header-row no-print">
        <div>
          <h1>{lt.labelsTitle}</h1>
          <p className="muted">
            {lt.labelsHint} {!loading && labels.length > 0 && lt.labelsCount(labels.length, Math.ceil(labels.length / LABELS_PER_SHEET))}
          </p>
        </div>
        <button type="button" className="btn btn-filled" disabled={!labels.length} onClick={() => window.print()}>
          <Icon name="print" /> {lt.print}
        </button>
      </header>
      {loading ? (
        <SkeletonRows rows={3} />
      ) : !handed && read.error ? (
        <ErrorState message={read.error} onRetry={read.reload} />
      ) : labels.length === 0 ? (
        <EmptyState icon="print" title={lt.labelsNone} message="" />
      ) : (
        <>
          {!handed && !!read.data?.missing && (
            <div className="no-print">
              <Notice tone="warn">{lt.labelsMissing(read.data.missing)}</Notice>
            </div>
          )}
          <div className="label-sheet">
            {labels.map((l) => (
              <div key={l.barcode} className="label">
                <QrTag value={l.barcode} code={l.barcode} title={l.title} brand={t.appTitle} className="qr-tag-label" />
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}
