import { useEffect, useState } from 'react';

import { toApiError } from '../../data/api';
import { memberLoans, memberReservations } from '../../data/circulation';
import {
  bookCourier,
  cancelDelivery,
  createDelivery,
  type Delivery,
  type DeliveryMethod,
  deliverySettings,
  dispatchDelivery,
  getDelivery,
  listDeliveries,
  mapsLink,
  type MemberLoan,
  myDeliveries,
  oneLine,
  quoteCourier,
  receiveDelivery,
  recordDeliveryFee,
  reportDelivery,
  type SettingsView,
  syncDeliveries,
} from '../../data/delivery';
import { type Member, searchMembers } from '../../data/members';
import { DeliveryRequestForm } from '../../shared/DeliveryRequestForm';
import { day, money, when } from '../../shared/format';
import { EmptyState, ErrorState, NoOrgState, SkeletonRows } from '../../shared/ui';
import { useAsync } from '../../shared/useAsync';
import { t } from '../../strings';
import { dt } from '../../strings/delivery';
import { lt } from '../../strings/library';
import { ConfirmWithReason, Dialog, DialogActions, FormError, SelectField, TextField, useSubmit } from '../components/Dialog';
import { NeedBranch, Notice, ScanInput, Tabs } from '../components/kit';
import { useAuth } from '../../auth/AuthContext';
import { branchScope } from '../../auth/claims';
import { useWorkspace } from '../Workspace';

// Operations → Circulation → Deliveries: the branch's home-delivery board
// (docs/DELIVERY.md), and Staff → My deliveries for riders.

const STATUS_TONE: Record<string, string> = {
  REQUESTED: 'warn',
  OUT: 'info',
  RETURNING: 'info',
  COMPLETED: 'ok',
  FAILED: 'danger',
  CANCELLED: 'muted',
};
const FEE_TONE: Record<string, string> = {
  FREE: 'muted',
  DUE: 'warn',
  PAID: 'ok',
};
type Tab = 'REQUESTED' | 'OUT' | 'RETURNING' | 'CLOSED';
const FEE_METHODS = ['OFFLINE_CASH', 'OFFLINE_UPI', 'OFFLINE_CARD'] as const;

// ------------------------------------------------------------------ pieces

function Contact({ d }: { d: Delivery }) {
  return (
    <span className="dl-contact">
      <a href={mapsLink(d.address)} target="_blank" rel="noreferrer">
        {dt.openMap}
      </a>
      {d.phone && (
        <a href={`tel:${d.phone}`} aria-label={`${dt.call} ${d.memberName}`}>
          {dt.call} {d.phone.replace(/^\+91/, '')}
        </a>
      )}
    </span>
  );
}

function Books({ d }: { d: Delivery }) {
  const out = d.sent.length ? d.sent.map((s) => `${s.bookTitle} (${s.copyCode})`) : (d.holdTitles ?? []);
  const back = d.collected.length ? d.collected.map((s) => `${s.bookTitle} (${s.copyCode})`) : (d.collectTitles ?? []);
  return (
    <>
      {out.length > 0 && (
        <p className="small">
          <strong>{dt.booksOut}:</strong> {out.join(', ')}
        </p>
      )}
      {back.length > 0 && (
        <p className="small">
          <strong>{dt.booksBack}:</strong> {back.join(', ')}
        </p>
      )}
      {d.note && (
        <p className="small muted">
          <strong>{dt.note}:</strong> {d.note}
        </p>
      )}
    </>
  );
}

function HowItGoes({ d }: { d: Delivery }) {
  if (!d.method) return null;
  const p = d.provider;
  return (
    <p className="small">
      <strong>{dt.method[d.method] ?? d.method}</strong>
      {d.rider && ` · ${d.rider.name}`}
      {d.courier && ` · ${[d.courier.name, d.courier.reference].filter(Boolean).join(' · ')}`}
      {p && (
        <>
          {' · '}
          <span className={`badge badge-${p.status === 'BOOKING_FAILED' || p.status === 'CANCELLED' ? 'danger' : 'info'}`}>{dt.courierStatus[p.status] ?? p.status}</span>
          {p.partner && ` ${dt.partner(p.partner.name, p.partner.phone, p.partner.vehicleNumber)}`}
          {p.fareMinor != null && ` · ${money(p.fareMinor)}`}
        </>
      )}
      {(p?.trackingUrl || d.courier?.trackingUrl) && (
        <>
          {' · '}
          <a href={(p?.trackingUrl ?? d.courier?.trackingUrl)!} target="_blank" rel="noreferrer">
            {dt.track}
          </a>
        </>
      )}
      {p?.error && <span className="field-error"> {p.error}</span>}
    </p>
  );
}

// ------------------------------------------------------------------ dialogs

function NewDeliveryDialog({ orgId, branchId, view, onClose, onSaved }: { orgId: string; branchId: string; view: SettingsView; onClose: () => void; onSaved: () => void }) {
  const { claims } = useAuth();
  const scope = branchScope(claims, orgId);
  const [matches, setMatches] = useState<Member[] | null>(null);
  const [member, setMember] = useState<Member | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const extras = useAsync(
    async () =>
      member
        ? {
            loans: await memberLoans(orgId, member.id, scope, true),
            holds: (await memberReservations(orgId, member.id, scope)).filter((r) => r.status === 'ALLOCATED' && r.branchId === branchId),
          }
        : null,
    [orgId, member?.id],
  );
  const lookup = async (q: string) => {
    setMsg(null);
    const found = await searchMembers(orgId, branchId, q);
    const exact = found.find((m) => m.code === q.trim().toUpperCase());
    if (exact || found.length === 1) setMember(exact ?? found[0]);
    else setMatches(found);
    if (!found.length) setMsg(lt.membersEmpty);
  };
  return (
    <Dialog title={dt.newDelivery} onClose={onClose}>
      {!member ? (
        <>
          <ScanInput label={lt.findMember} placeholder={lt.findMemberHint} onScan={lookup} />
          {msg && <Notice tone="warn">{msg}</Notice>}
          {matches && matches.length > 0 && (
            <ul className="desk-list">
              {matches.map((m) => (
                <li key={m.id}>
                  <button type="button" className="btn btn-text" onClick={() => setMember(m)}>
                    {m.fullName} <span className="mono small">{m.code}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="dialog-actions">
            <button type="button" className="btn btn-text" onClick={onClose}>
              {t.cancel}
            </button>
          </div>
        </>
      ) : extras.loading || !extras.data ? (
        <SkeletonRows rows={3} />
      ) : (
        <>
          <p>
            <strong>{member.fullName}</strong> <span className="mono small">{member.code}</span>
          </p>
          <DeliveryRequestForm
            branchId={branchId}
            memberId={member.id}
            choices={{
              slots: view.settings.slots,
              maxDaysAhead: 14,
              feeMinor: view.settings.feeMinor,
              holds: extras.data.holds.map((h) => ({
                id: h.id,
                title: h.bookTitle,
              })),
              loans: extras.data.loans.map((l) => ({
                id: l.id,
                title: `${l.bookTitle} (${l.copyCode})`,
              })),
              address: member.address,
            }}
            submitLabel={dt.newDelivery}
            onCancel={onClose}
            onSubmit={async (r) => {
              await createDelivery(orgId, r);
              onSaved();
              onClose();
            }}
          />
        </>
      )}
    </Dialog>
  );
}

function DispatchDialog({ orgId, delivery, view, onClose, onSaved }: { orgId: string; delivery: Delivery; view: SettingsView; onClose: () => void; onSaved: () => void }) {
  const info = useAsync(() => getDelivery(orgId, delivery.id), [orgId, delivery.id]);
  const s = view.settings;
  const courierOptions = view.couriers.filter(
    (c) => s.couriers[c.key]?.enabled && c.kinds.includes(delivery.kind === 'PICKUP' ? 'PICKUP' : 'DELIVER') && delivery.kind !== 'EXCHANGE',
  );
  const methods: { value: DeliveryMethod; label: string }[] = [
    ...(s.methods.OWN ? [{ value: 'OWN' as const, label: dt.method.OWN }] : []),
    ...courierOptions.map((c) => ({
      value: c.key as DeliveryMethod,
      label: c.label,
    })),
    ...(s.methods.MANUAL ? [{ value: 'MANUAL' as const, label: dt.method.MANUAL }] : []),
  ];
  const [method, setMethod] = useState<DeliveryMethod>(methods[0]?.value ?? 'OWN');
  const [riderUid, setRiderUid] = useState(view.riders[0]?.uid ?? '');
  const [courier, setCourier] = useState({
    name: '',
    reference: '',
    trackingUrl: '',
  });
  const [codes, setCodes] = useState<string[]>([]);
  const [waive, setWaive] = useState(false);
  const [fares, setFares] = useState<string | null>(null);
  const [farePending, setFarePending] = useState(false);
  const sends = delivery.kind !== 'PICKUP';
  useEffect(() => {
    if (info.data) setCodes(info.data.holds.map((h) => h.copyCode).filter((c): c is string => !!c));
  }, [info.data]);
  const isCourier = method !== 'OWN' && method !== 'MANUAL';
  const { busy, error, submit } = useSubmit(async () => {
    await dispatchDelivery(orgId, delivery.id, {
      barcodes: sends ? codes : [],
      method,
      riderUid: method === 'OWN' ? riderUid : null,
      courier: method === 'MANUAL' ? courier : null,
      waiveFee: waive,
    });
    onSaved();
    onClose();
  });
  return (
    <Dialog title={dt.dispatchTitle(delivery.memberName)} onClose={onClose}>
      {info.loading ? (
        <SkeletonRows rows={3} />
      ) : info.error ? (
        <ErrorState message={info.error} onRetry={info.reload} />
      ) : (
        <>
          <p className="small">
            {dt.kind[delivery.kind]} · {day(delivery.date)}
            {delivery.slot && `, ${delivery.slot}`} · {oneLine(delivery.address)}
          </p>
          {delivery.note && <p className="small muted">{delivery.note}</p>}
          {sends && (
            <>
              <ScanInput
                label={dt.scanOut}
                onScan={(v) => {
                  const code = v.trim().toUpperCase();
                  if (code) setCodes((x) => (x.includes(code) ? x : [...x, code]));
                }}
              />
              <ul className="desk-list">
                {codes.map((c) => (
                  <li key={c}>
                    <span className="mono">{c}</span> {info.data?.holds.find((h) => h.copyCode === c)?.bookTitle}
                    <button type="button" className="btn btn-text" onClick={() => setCodes((x) => x.filter((y) => y !== c))} aria-label={`${dt.remove} ${c}`}>
                      {dt.remove}
                    </button>
                  </li>
                ))}
              </ul>
              <p className="muted small">{dt.outList(codes.length)}</p>
            </>
          )}
          <form onSubmit={submit} noValidate>
            {(delivery.collectTitles ?? []).length > 0 && (
              <p className="small">
                <strong>{dt.booksBack}:</strong> {delivery.collectTitles!.join(', ')}
              </p>
            )}

            <SelectField label={dt.how} value={method} onChange={(v) => setMethod(v as DeliveryMethod)} options={methods} />
            {delivery.kind === 'EXCHANGE' && view.couriers.some((c) => s.couriers[c.key]?.enabled) && <p className="muted small">{dt.courierOneWay}</p>}
            {method === 'OWN' &&
              (view.riders.length ? (
                <SelectField
                  label={dt.rider}
                  value={riderUid}
                  onChange={setRiderUid}
                  options={view.riders.map((r) => ({
                    value: r.uid,
                    label: r.name,
                  }))}
                />
              ) : (
                <Notice tone="warn">{dt.noRiders}</Notice>
              ))}
            {method === 'MANUAL' && (
              <div className="form-grid">
                <TextField label={dt.courierName} value={courier.name} onChange={(name) => setCourier({ ...courier, name })} />
                <TextField label={dt.courierRef} value={courier.reference} onChange={(reference) => setCourier({ ...courier, reference })} />
                <div className="span-2">
                  <TextField label={dt.courierUrl} value={courier.trackingUrl} onChange={(trackingUrl) => setCourier({ ...courier, trackingUrl })} type="url" />
                </div>
              </div>
            )}
            {isCourier && (
              <div className="row">
                {!delivery.address.geo ? (
                  <Notice tone="warn">{dt.needsPin}</Notice>
                ) : (
                  <button
                    type="button"
                    className="btn btn-outlined"
                    disabled={farePending}
                    onClick={async () => {
                      setFarePending(true);
                      try {
                        const r = await quoteCourier(orgId, delivery.id, method);
                        setFares(r.fares.length ? r.fares.map((f) => dt.fare(f.vehicle, money(f.fareMinor), f.etaMinutes)).join(' · ') : dt.noFares);
                      } catch (e) {
                        setFares(toApiError(e).message);
                      } finally {
                        setFarePending(false);
                      }
                    }}
                  >
                    {farePending ? t.loading : dt.getQuote}
                  </button>
                )}
                {fares && <span className="small">{fares}</span>}
              </div>
            )}
            {delivery.fee.status === 'DUE' && (
              <label className="check">
                <input type="checkbox" checked={waive} onChange={(e) => setWaive(e.target.checked)} /> {dt.waiveFee} ({money(delivery.fee.amountMinor)})
              </label>
            )}
            <FormError error={error} />
            <DialogActions busy={busy} submitLabel={dt.dispatchBtn(sends ? codes.length : 0)} onCancel={onClose} />
          </form>
        </>
      )}
    </Dialog>
  );
}

/** How the visit went: by the rider at the door, or by the branch for them. */
export function ReportDialog({ orgId, delivery, loans, onClose, onSaved }: { orgId: string; delivery: Delivery; loans: MemberLoan[]; onClose: () => void; onSaved: () => void }) {
  const [outcome, setOutcome] = useState<'DELIVERED' | 'FAILED'>('DELIVERED');
  const [handedTo, setHandedTo] = useState('');
  const [collected, setCollected] = useState<string[]>(delivery.collectLoanIds);
  const [reason, setReason] = useState('');
  const [feeMethod, setFeeMethod] = useState<string>('');
  const [feeRef, setFeeRef] = useState('');
  const collects = delivery.kind !== 'DELIVER';
  const candidates = loans.filter((l) => l.deliveryId !== delivery.id);
  const { busy, error, submit } = useSubmit(async () => {
    await reportDelivery(orgId, delivery.id, {
      outcome,
      collectedLoanIds: outcome === 'DELIVERED' && collects ? collected : [],
      failReason: outcome === 'FAILED' ? reason.trim() : '',
      handedTo: handedTo.trim(),
      fee: outcome === 'DELIVERED' && feeMethod ? { method: feeMethod, reference: feeRef.trim() } : null,
    });
    onSaved();
    onClose();
  });
  return (
    <Dialog title={dt.reportTitle(delivery.memberName)} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <fieldset className="checklist">
          <legend>{dt.report}</legend>
          {(['DELIVERED', 'FAILED'] as const).map((o) => (
            <label key={o} className="check">
              <input type="radio" name="outcome" checked={outcome === o} onChange={() => setOutcome(o)} /> {o === 'DELIVERED' ? dt.delivered : dt.notDelivered}
            </label>
          ))}
        </fieldset>
        {outcome === 'DELIVERED' ? (
          <>
            <TextField label={dt.handedTo} value={handedTo} onChange={setHandedTo} />
            {collects && (
              <fieldset className="checklist">
                <legend>{dt.collectedNow}</legend>
                {candidates.length === 0 ? (
                  <p className="muted small">{dt.noLoans}</p>
                ) : (
                  candidates.map((l) => (
                    <label key={l.loanId} className="check">
                      <input
                        type="checkbox"
                        checked={collected.includes(l.loanId)}
                        onChange={(e) => setCollected(e.target.checked ? [...collected, l.loanId] : collected.filter((x) => x !== l.loanId))}
                      />
                      {l.bookTitle} <span className="mono small">{l.copyCode}</span>
                    </label>
                  ))
                )}
              </fieldset>
            )}
            {delivery.fee.status === 'DUE' && (
              <div className="form-grid">
                <SelectField
                  label={`${dt.collectFee} (${money(delivery.fee.amountMinor)})`}
                  value={feeMethod}
                  onChange={setFeeMethod}
                  options={[
                    { value: '', label: dt.feeNotCollected },
                    ...FEE_METHODS.map((m) => ({
                      value: m,
                      label: lt.paymentMethods[m],
                    })),
                  ]}
                />
                {feeMethod && feeMethod !== 'OFFLINE_CASH' && <TextField label={dt.feeRef} value={feeRef} onChange={setFeeRef} />}
              </div>
            )}
          </>
        ) : (
          <TextField label={dt.failReason} hint={dt.failHint} value={reason} onChange={setReason} />
        )}
        <FormError error={error} />
        <DialogActions busy={busy} submitLabel={t.save} onCancel={onClose} />
      </form>
    </Dialog>
  );
}

function FeeDialog({ orgId, delivery, onClose, onSaved }: { orgId: string; delivery: Delivery; onClose: () => void; onSaved: () => void }) {
  const [method, setMethod] = useState('OFFLINE_CASH');
  const [reference, setReference] = useState('');
  const { busy, error, submit } = useSubmit(async () => {
    await recordDeliveryFee(orgId, delivery.id, method, reference.trim());
    onSaved();
    onClose();
  });
  return (
    <Dialog title={`${dt.feeTitle} · ${money(delivery.fee.amountMinor)}`} onClose={onClose} narrow>
      <form onSubmit={submit} noValidate>
        <SelectField
          label={dt.feeMethod}
          value={method}
          onChange={setMethod}
          options={[
            ...FEE_METHODS.map((m) => ({
              value: m,
              label: lt.paymentMethods[m],
            })),
            { value: 'WAIVED', label: dt.waive },
          ]}
        />
        {method !== 'OFFLINE_CASH' && method !== 'WAIVED' && <TextField label={dt.feeRef} value={reference} onChange={setReference} />}
        <FormError error={error} />
        <DialogActions busy={busy} submitLabel={t.save} onCancel={onClose} />
      </form>
    </Dialog>
  );
}

// ------------------------------------------------------------------ board

type Open = {
  kind: 'dispatch' | 'report' | 'fee' | 'cancel' | 'receive';
  d: Delivery;
} | null;

function DeliveryCard({ orgId, branchId, d, onAct, onChanged }: { orgId: string; branchId: string; d: Delivery; onAct: (o: Open) => void; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      onChanged();
    } catch (e) {
      setMsg(toApiError(e).message);
    } finally {
      setBusy(false);
    }
  };
  const p = d.provider;
  return (
    <li className="card dl-card">
      <div className="dl-head">
        <div>
          <h2>
            {d.memberName} <span className="mono small">{d.memberCode}</span>
          </h2>
          <p className="muted small">
            {dt.kind[d.kind]} · {day(d.date)}
            {d.slot && `, ${d.slot}`} · {dt.requested(d.requestedBy)}
          </p>
        </div>
        <div className="dl-badges">
          <span className={`badge badge-${STATUS_TONE[d.status]}`}>
            {d.outcome && d.status !== 'REQUESTED' && d.status !== 'OUT' ? dt.outcome[d.outcome] : dt.status[d.status]}
          </span>
          {d.fee.amountMinor > 0 && <span className={`badge badge-${FEE_TONE[d.fee.status]}`}>{`${dt.fee[d.fee.status]} ${money(d.fee.amountMinor)}`}</span>}
        </div>
      </div>
      <p className="small">
        {oneLine(d.address)} · <Contact d={d} />
      </p>
      <Books d={d} />
      <HowItGoes d={d} />
      {d.failReason && <p className="small field-error">{d.failReason}</p>}
      {msg && <Notice tone="error">{msg}</Notice>}
      <div className="row">
        {d.status === 'REQUESTED' && (
          <button type="button" className="btn btn-filled" onClick={() => onAct({ kind: 'dispatch', d })}>
            {dt.dispatch}
          </button>
        )}
        {d.status === 'OUT' && (
          <button type="button" className="btn btn-outlined" onClick={() => onAct({ kind: 'report', d })}>
            {dt.report}
          </button>
        )}
        {d.status === 'OUT' && p?.orderId && (
          <button type="button" className="btn btn-text" disabled={busy} onClick={() => void run(() => syncDeliveries(orgId, branchId, d.id))}>
            {dt.refresh}
          </button>
        )}
        {d.status === 'OUT' && p && (p.status === 'BOOKING_FAILED' || p.status === 'CANCELLED' || !p.orderId) && (
          <button type="button" className="btn btn-text" disabled={busy} onClick={() => void run(() => bookCourier(orgId, d.id))}>
            {dt.bookAgain}
          </button>
        )}
        {d.status === 'RETURNING' && (
          <button type="button" className="btn btn-filled" onClick={() => onAct({ kind: 'receive', d })}>
            {dt.receive}
          </button>
        )}
        {d.fee.status === 'DUE' && d.status !== 'REQUESTED' && (
          <button type="button" className="btn btn-text" onClick={() => onAct({ kind: 'fee', d })}>
            {dt.recordFee}
          </button>
        )}
        {(d.status === 'REQUESTED' || d.status === 'OUT') && (
          <button type="button" className="btn btn-text danger" onClick={() => onAct({ kind: 'cancel', d })}>
            {dt.cancel}
          </button>
        )}
      </div>
    </li>
  );
}

function Board({ orgId, branchId }: { orgId: string; branchId: string }) {
  const [tab, setTab] = useState<Tab>('REQUESTED');
  const [open, setOpen] = useState<Open>(null);
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const view = useAsync(() => deliverySettings(orgId, branchId), [orgId, branchId]);
  const data = useAsync(() => listDeliveries(orgId, branchId), [orgId, branchId]);
  const reportLoans = useAsync(() => (open?.kind === 'report' ? getDelivery(orgId, open.d.id).then((r) => r.memberLoans) : Promise.resolve(null)), [orgId, open?.kind, open?.d.id]);
  // Courier orders: ask the courier for news when the board opens (at most once a minute per order).
  useEffect(() => {
    void syncDeliveries(orgId, branchId)
      .then((r) => Object.keys(r.updated).length && data.reload())
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, branchId]);
  if (view.loading || data.loading) return <SkeletonRows rows={5} />;
  if (view.error || data.error) return <ErrorState message={(view.error ?? data.error)!} onRetry={() => (view.reload(), data.reload())} />;
  const v = view.data!;
  const all = data.data!;
  const rows = tab === 'CLOSED' ? all.closed : all.open.filter((d) => d.status === tab);
  const count = (s: string) => all.open.filter((d) => d.status === s).length;
  const changed = () => data.reload();
  return (
    <>
      {!v.settings.enabled && <Notice tone="warn">{dt.settingsIntro}</Notice>}
      <div className="page-header-row">
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={(['REQUESTED', 'OUT', 'RETURNING', 'CLOSED'] as Tab[]).map((x) => ({
            value: x,
            label: dt.tabs[x],
            count: x === 'CLOSED' ? undefined : count(x),
          }))}
        />
        <button type="button" className="btn btn-filled" disabled={!v.settings.enabled} onClick={() => setAdding(true)}>
          {dt.newDelivery}
        </button>
      </div>
      {notice && <Notice tone="ok">{notice}</Notice>}
      {rows.length === 0 ? (
        <EmptyState icon="truck" title={dt.empty[tab]} message="" />
      ) : (
        <ul className="dl-list">
          {rows.map((d) => (
            <DeliveryCard key={d.id} orgId={orgId} branchId={branchId} d={d} onAct={setOpen} onChanged={changed} />
          ))}
        </ul>
      )}
      {adding && <NewDeliveryDialog orgId={orgId} branchId={branchId} view={v} onClose={() => setAdding(false)} onSaved={changed} />}
      {open?.kind === 'dispatch' && <DispatchDialog orgId={orgId} delivery={open.d} view={v} onClose={() => setOpen(null)} onSaved={changed} />}
      {open?.kind === 'report' && reportLoans.data && <ReportDialog orgId={orgId} delivery={open.d} loans={reportLoans.data} onClose={() => setOpen(null)} onSaved={changed} />}
      {open?.kind === 'fee' && <FeeDialog orgId={orgId} delivery={open.d} onClose={() => setOpen(null)} onSaved={changed} />}
      {open?.kind === 'cancel' && (
        <ConfirmWithReason
          title={dt.cancel}
          body={dt.cancelBody}
          confirmLabel={dt.cancel}
          onClose={() => setOpen(null)}
          onConfirm={async (reason) => {
            await cancelDelivery(orgId, open.d.id, reason);
            setOpen(null);
            changed();
          }}
        />
      )}
      {open?.kind === 'receive' && (
        <ReceiveDialog
          orgId={orgId}
          delivery={open.d}
          onClose={() => setOpen(null)}
          onDone={(n) => {
            setNotice(dt.received(n));
            changed();
          }}
        />
      )}
    </>
  );
}

function ReceiveDialog({ orgId, delivery, onClose, onDone }: { orgId: string; delivery: Delivery; onClose: () => void; onDone: (n: number) => void }) {
  const items = [...delivery.collected, ...(delivery.outcome === 'FAILED' ? delivery.sent : [])];
  const { busy, error, submit } = useSubmit(async () => {
    const r = await receiveDelivery(orgId, delivery.id);
    onDone(r.returned);
    onClose();
  });
  return (
    <Dialog title={`${dt.receive} · ${delivery.memberName}`} onClose={onClose} narrow>
      <form onSubmit={submit} noValidate>
        <p>{dt.receiveConfirm(items.length)}</p>
        <ul className="desk-list">
          {items.map((i) => (
            <li key={i.loanId}>
              {i.bookTitle} <span className="mono small">{i.copyCode}</span>
            </li>
          ))}
        </ul>
        <FormError error={error} />
        <DialogActions busy={busy} submitLabel={dt.receive} onCancel={onClose} />
      </form>
    </Dialog>
  );
}

export function DeliveriesPage() {
  const { org } = useWorkspace();
  if (!org) return <NoOrgState />;
  return (
    <>
      <header className="page-header">
        <h1>{dt.title}</h1>
        <p className="muted">{dt.intro}</p>
      </header>
      <NeedBranch>{(branchId) => <Board orgId={org.id} branchId={branchId} />}</NeedBranch>
    </>
  );
}

// ------------------------------------------------------------------ rider

export function MyDeliveriesPage() {
  const { org } = useWorkspace();
  const mine = useAsync(() => (org ? myDeliveries(org.id) : Promise.resolve({ deliveries: [] })), [org?.id]);
  const [open, setOpen] = useState<(Delivery & { memberLoans: MemberLoan[] }) | null>(null);
  if (!org) return <NoOrgState />;
  return (
    <>
      <header className="page-header">
        <h1>{dt.navMine}</h1>
        <p className="muted">{dt.mineIntro}</p>
      </header>
      {mine.loading ? (
        <SkeletonRows rows={3} />
      ) : mine.error ? (
        <ErrorState message={mine.error} onRetry={mine.reload} />
      ) : !mine.data?.deliveries.length ? (
        <EmptyState icon="truck" title={dt.mineEmpty} message="" />
      ) : (
        <ul className="dl-list">
          {mine.data.deliveries.map((d) => (
            <li key={d.id} className="card dl-card">
              <div className="dl-head">
                <div>
                  <h2>{d.memberName}</h2>
                  <p className="muted small">
                    {dt.kind[d.kind]} · {day(d.date)}
                    {d.slot && `, ${d.slot}`}
                    {d.dispatchedAt && ` · ${when(d.dispatchedAt)}`}
                  </p>
                </div>
                {d.fee.status === 'DUE' && <span className="badge badge-warn">{`${dt.fee.DUE} ${money(d.fee.amountMinor)}`}</span>}
              </div>
              <p className="small">
                {oneLine(d.address)} · <Contact d={d} />
              </p>
              <Books d={d} />
              <button type="button" className="btn btn-filled" onClick={() => setOpen(d)}>
                {dt.report}
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && <ReportDialog orgId={org.id} delivery={open} loans={open.memberLoans} onClose={() => setOpen(null)} onSaved={mine.reload} />}
    </>
  );
}
