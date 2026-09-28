import type { DocumentSnapshot } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';

import { useAuth } from '../../auth/AuthContext';
import { can } from '../../auth/claims';
import { command } from '../../data/api';
import { CONDITIONS, type Condition, COPY_STATUSES, type CopyStatus, label } from '../../data/common';
import { type Copy, copyEvents, type CopyWhereabouts, findCopy, getCopy, listCopies, listLocations, locateCopy } from '../../data/inventory';
import { useAsync } from '../../shared/useAsync';
import { money, when } from '../../shared/format';
import { paths } from '../../paths';
import { t } from '../../strings';
import { EmptyState, ErrorState, Icon, SkeletonRows } from '../../shared/ui';
import { ConfirmWithReason, Dialog, DialogActions, FormError, SelectField, TextField, useSubmit } from '../components/Dialog';
import { NeedBranch, Notice, QrTag, ScanInput } from '../components/kit';
import { lt } from '../../strings/library';
import { useWorkspace } from '../Workspace';

const TONE: Record<CopyStatus, string> = {
  AVAILABLE: 'ok', RESERVED: 'info', ISSUED: 'info', IN_TRANSIT: 'info', UNDER_INSPECTION: 'warn', DAMAGED: 'warn', LOST: 'danger', RETIRED: 'muted',
};

/** Status chip with text (never colour alone). */
export function CopyStatusBadge({ status }: { status: CopyStatus }) {
  return <span className={`badge badge-${TONE[status]}`}>{label(status)}</span>;
}

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
  const [copies, setCopies] = useState<Copy[]>([]);
  const [cursor, setCursor] = useState<DocumentSnapshot | undefined>();
  const [state, setState] = useState<{ loading: boolean; error: string | null }>({ loading: true, error: null });
  const [attempt, setAttempt] = useState(0);
  const [scanMsg, setScanMsg] = useState<string | null>(null);
  const [elsewhere, setElsewhere] = useState<CopyWhereabouts | null>(null);
  const locations = useAsync(() => listLocations(orgId, branchId), [orgId, branchId]);
  const [newLoc, setNewLoc] = useState(false);
  const manage = can(claims, 'copies.manage', orgId, branchId);

  const load = async (after?: DocumentSnapshot) => {
    setState({ loading: true, error: null });
    try {
      const page = await listCopies(orgId, branchId, status, after);
      setCopies((prev) => (after ? [...prev, ...page.items] : page.items));
      setCursor(page.cursor);
      setState({ loading: false, error: null });
    } catch (e) {
      console.error(e);
      setState({ loading: false, error: t.errorLoad });
    }
  };
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, branchId, status, attempt]);

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
            if (c) return navigate(paths.adminCopy(c.id));
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
      {state.error && copies.length === 0 ? (
        <ErrorState message={state.error} onRetry={() => setAttempt((n) => n + 1)} />
      ) : state.loading && copies.length === 0 ? (
        <SkeletonRows rows={6} />
      ) : copies.length === 0 ? (
        <EmptyState icon="shelves" title={lt.copiesEmpty} message="" />
      ) : (
        <>
          <div className="table-wrap">
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
                      <Link to={paths.adminCopy(c.id)} className="mono">
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
                    <td className="mono">{locName(c.locationId)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {cursor && (
            <button type="button" className="btn btn-outlined load-more" disabled={state.loading} onClick={() => load(cursor)}>
              {state.loading ? t.loading : t.loadMore}
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
  const { org } = useWorkspace();
  return (
    <>
      <header className="page-header">
        <h1>{lt.inventoryTitle}</h1>
      </header>
      <NeedBranch>{(branchId) => org && <BranchInventory orgId={org.id} branchId={branchId} />}</NeedBranch>
    </>
  );
}

// ------------------------------------------------------------------ copy detail

type Action = 'inspect' | 'repair' | 'move' | 'condition' | 'lost' | 'found' | 'retire';

function ConditionDialog({ title, onClose, run, showOutcome, locations }: {
  title: string;
  onClose: () => void;
  run: (v: { condition: Condition; note: string; outcome: 'PASS' | 'DAMAGED'; locationId: string }) => Promise<void>;
  showOutcome?: boolean;
  locations?: { value: string; label: string }[];
}) {
  const [v, setV] = useState({ condition: 'GOOD' as Condition, note: '', outcome: 'PASS' as 'PASS' | 'DAMAGED', locationId: '' });
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
        <DialogActions busy={busy} submitLabel={t.save} onCancel={onClose} />
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
  const c = copy.data;
  const locations = useAsync(() => (orgId && c ? listLocations(orgId, c.currentBranchId) : Promise.resolve([])), [orgId, c?.currentBranchId]);
  const [action, setAction] = useState<Action | null>(null);

  if (copy.loading) return <SkeletonRows rows={4} />;
  if (copy.error) return <ErrorState message={copy.error} onRetry={copy.reload} />;
  if (!c) return <EmptyState icon="shelves" title={t.notFoundTitle} message="" />;
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
      <header className="page-header page-header-row">
        <div>
          <h1 className="mono">{c.code}</h1>
          <p>
            <Link to={paths.adminBook(c.bookId)}>{c.bookTitle}</Link>
          </p>
        </div>
        <QrTag value={c.barcode} code={c.barcode} title={c.bookTitle} className="qr-tag-card" />
      </header>
      <section className="card">
        <dl className="facts">
          <dt>{lt.status}</dt>
          <dd>
            <CopyStatusBadge status={c.status} />
          </dd>
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
        <div className="row">
          {buttons.filter(([, , show]) => show).map(([a, text]) => (
            <button key={a} type="button" className={`btn ${a === 'retire' || a === 'lost' ? 'btn-text' : 'btn-outlined'}`} onClick={() => setAction(a)}>
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

      {action === 'inspect' && <ConditionDialog title={lt.inspect} showOutcome onClose={() => setAction(null)} run={(v) => act('copies-inspect', { outcome: v.outcome, condition: v.condition, note: v.note })} />}
      {action === 'repair' && <ConditionDialog title={lt.repair} onClose={() => setAction(null)} run={(v) => act('copies-repair', { condition: v.condition, note: v.note })} />}
      {action === 'condition' && <ConditionDialog title={lt.recordCondition} onClose={() => setAction(null)} run={(v) => act('copies-recordCondition', { condition: v.condition, note: v.note })} />}
      {action === 'move' && <ConditionDialog title={lt.relocate} locations={locOptions} onClose={() => setAction(null)} run={(v) => act('copies-relocate', { locationId: v.locationId || null })} />}
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

/** Printable label sheet (A4, 3 × 8) for the copies in ?copies=id,id,… */
export function LabelsPage() {
  const [params] = useSearchParams();
  const { org } = useWorkspace();
  const ids = (params.get('copies') ?? '').split(',').filter(Boolean).slice(0, 120);
  const copies = useAsync(async () => (org ? (await Promise.all(ids.map((id) => getCopy(org.id, id)))).filter((c): c is Copy => !!c) : []), [org?.id, ids.join(',')]);
  return (
    <>
      <header className="page-header page-header-row no-print">
        <div>
          <h1>{lt.labelsTitle}</h1>
          <p className="muted">{lt.labelsHint}</p>
        </div>
        <button type="button" className="btn btn-filled" onClick={() => window.print()}>
          <Icon name="print" /> {lt.print}
        </button>
      </header>
      {copies.loading ? (
        <SkeletonRows rows={3} />
      ) : (
        <div className="label-sheet">
          {(copies.data ?? []).map((c) => (
            <div key={c.id} className="label">
              <QrTag value={c.barcode} code={c.barcode} title={c.bookTitle} brand={t.appTitle} className="qr-tag-label" />
            </div>
          ))}
        </div>
      )}
    </>
  );
}
