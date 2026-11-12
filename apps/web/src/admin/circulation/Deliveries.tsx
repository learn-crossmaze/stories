import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';

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
  type ReadyHold,
  receiveDelivery,
  recordDeliveryFee,
  reportDelivery,
  type SettingsView,
  syncDeliveries,
} from '../../data/delivery';
import { type Member, searchMembers } from '../../data/members';
import { DeliveryRequestForm } from '../../shared/DeliveryRequestForm';
import { day, money, when } from '../../shared/format';
import { Badge, EmptyState, ErrorState, NoOrgState, SkeletonRows, type Tone } from '../../shared/ui';
import { useAsync } from '../../shared/useAsync';
import { t } from '../../strings';
import { dt } from '../../strings/delivery';
import { lt } from '../../strings/library';
import { ConfirmWithReason, Dialog, DialogActions, FormError, SelectField, TextField, useAction, useSubmit } from '../components/Dialog';
import { NeedBranch, Notice, ScanInput, Tabs } from '../components/kit';
import { useAuth } from '../../auth/AuthContext';
import { branchScope, can } from '../../auth/claims';
import { useWorkspace } from '../Workspace';
import {
  bagItems,
  BOARD_TABS,
  type BoardTab,
  canJoinRun,
  carrierGroups,
  landingTab,
  type LastDispatch,
  readLastDispatch,
  receiveBags,
  saveLastDispatch,
  sendRun,
  startingChoice,
  tabFrom,
  withDispatch,
} from './deliveryRun';

// Operations → Circulation → Deliveries: the branch's home-delivery board
// (docs/DELIVERY.md), and Staff → My deliveries for riders.

const STATUS_TONE: Record<string, Tone> = {
  REQUESTED: 'warn',
  OUT: 'info',
  RETURNING: 'info',
  COMPLETED: 'ok',
  FAILED: 'danger',
  CANCELLED: 'muted',
};
const FEE_TONE: Record<string, Tone> = {
  FREE: 'muted',
  DUE: 'warn',
  PAID: 'ok',
};
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
          <Badge tone={p.status === 'BOOKING_FAILED' || p.status === 'CANCELLED' ? 'danger' : 'info'}>{dt.courierStatus[p.status] ?? p.status}</Badge>
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

function NewDeliveryDialog({
  orgId,
  branchId,
  view,
  open,
  onClose,
  onSaved,
}: {
  orgId: string;
  branchId: string;
  view: SettingsView;
  /** The branch's open visits, as the board has them: a member with one is told so before any form is filled in. */
  open: Delivery[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { claims } = useAuth();
  const scope = branchScope(claims, orgId);
  const [matches, setMatches] = useState<Member[] | null>(null);
  const [member, setMember] = useState<Member | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  // The server refuses a second open visit anyway (DELIVERY_OPEN); this only saves filling in the form to find out.
  const booked = member ? open.find((d) => d.memberId === member.id) : undefined;
  const extras = useAsync(async () => {
    if (!member || booked) return null;
    const [loans, holds] = await Promise.all([memberLoans(orgId, member.id, scope, true), memberReservations(orgId, member.id, scope)]);
    return { loans, holds: holds.filter((r) => r.status === 'ALLOCATED' && r.branchId === branchId) };
  }, [orgId, member?.id]);
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
          {/* Takes focus each time it appears: "Choose another member" removes the button that had it. */}
          <ScanInput label={lt.findMember} placeholder={lt.findMemberHint} onScan={lookup} autoFocus />
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
      ) : booked ? (
        <>
          <Notice tone="warn">{dt.alreadyBooked(member.fullName, dt.kind[booked.kind], day(booked.date))}</Notice>
          <div className="dialog-actions">
            <button type="button" className="btn btn-text" onClick={onClose}>
              {t.cancel}
            </button>
            <button
              type="button"
              className="btn btn-outlined"
              onClick={() => {
                setMember(null);
                setMatches(null);
              }}
            >
              {dt.chooseAnother}
            </button>
          </div>
        </>
      ) : extras.loading ? (
        <SkeletonRows rows={3} />
      ) : extras.error || !extras.data ? (
        <>
          <ErrorState message={extras.error ?? t.errorLoad} onRetry={extras.reload} />
          <div className="dialog-actions">
            <button type="button" className="btn btn-text" onClick={onClose}>
              {t.cancel}
            </button>
          </div>
        </>
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
              // Where the last visit went (landmark and map pin included), else the address on the profile.
              address: member.deliveryAddress ?? member.address,
              pincodes: view.settings.pincodes,
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

/**
 * Reads the member's reserved books that are ready, behind the open dispatch dialog (mounted only for a visit that
 * sends books). Says so while it reads; a failed read leaves staff free to scan instead. "Try again" goes away
 * when pressed: `onRetry` is for moving focus somewhere that stays.
 */
function ReadyHolds({
  orgId,
  deliveryId,
  onChange,
  onRetry,
}: {
  orgId: string;
  deliveryId: string;
  onChange: (holds: ReadyHold[] | null, settled: boolean) => void;
  onRetry: () => void;
}) {
  const info = useAsync(() => getDelivery(orgId, deliveryId).then((r) => r.holds), [orgId, deliveryId]);
  const tell = useRef(onChange);
  tell.current = onChange;
  useEffect(() => tell.current(info.data ?? null, !info.loading), [info.data, info.loading]);
  if (info.loading) {
    return (
      <p className="muted small" role="status">
        {dt.holdsLoading}
      </p>
    );
  }
  if (!info.error) return null;
  return (
    <Notice tone="warn">
      {dt.holdsFailed}{' '}
      <button
        type="button"
        className="link"
        onClick={() => {
          onRetry();
          info.reload();
        }}
      >
        {t.retry}
      </button>
    </Notice>
  );
}

function DispatchDialog({
  orgId,
  delivery,
  view,
  last,
  onClose,
  onSaved,
  onDispatched,
}: {
  orgId: string;
  delivery: Delivery;
  view: SettingsView;
  /** What the branch's last dispatch used: the starting method, rider and courier name. */
  last: LastDispatch;
  onClose: () => void;
  onSaved: () => void;
  onDispatched: (used: { method: DeliveryMethod; riderUid: string | null; courierName: string }) => void;
}) {
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
  const [start] = useState(() => startingChoice(last, methods.map((m) => m.value), view.riders));
  const [method, setMethod] = useState<DeliveryMethod>(start.method);
  const [riderUid, setRiderUid] = useState(start.riderUid);
  const [courier, setCourier] = useState({
    name: start.courierName,
    reference: '',
    trackingUrl: '',
  });
  const sends = delivery.kind !== 'PICKUP';
  const [codes, setCodes] = useState<string[]>([]);
  // The reserved books read behind the form (a pickup sends none, so nothing is read for it).
  const [ready, setReady] = useState<{ holds: ReadyHold[]; settled: boolean }>({ holds: [], settled: !sends });
  // Codes staff took off the list: the reserved books arriving later must not put them back.
  const removed = useRef(new Set<string>());
  const onHolds = (holds: ReadyHold[] | null, settled: boolean) => {
    setReady((r) => ({ holds: holds ?? r.holds, settled }));
    // Added after whatever was scanned meanwhile.
    if (holds) setCodes((x) => [...x, ...holds.map((h) => h.copyCode).filter((c): c is string => !!c && !x.includes(c) && !removed.current.has(c))]);
  };
  // Counts the retries of the reserved books: each sends focus to the scan field.
  const [toScan, setToScan] = useState(0);
  const [waive, setWaive] = useState(false);
  const [fares, setFares] = useState<string | null>(null);
  const quote = useAction();
  const isCourier = method !== 'OWN' && method !== 'MANUAL';
  const { busy, error, submit } = useSubmit(async () => {
    // Not before the reserved books are in: one left behind would stay set aside and later lapse.
    if (!ready.settled) return;
    await dispatchDelivery(orgId, delivery.id, {
      barcodes: sends ? codes : [],
      method,
      riderUid: method === 'OWN' ? riderUid : null,
      courier: method === 'MANUAL' ? courier : null,
      waiveFee: waive,
    });
    onDispatched({ method, riderUid: method === 'OWN' ? riderUid : null, courierName: courier.name });
    onSaved();
    onClose();
  });
  return (
    <Dialog title={dt.dispatchTitle(delivery.memberName)} onClose={onClose}>
      <p className="small">
        {dt.kind[delivery.kind]} · {day(delivery.date)}
        {delivery.slot && `, ${delivery.slot}`} · {oneLine(delivery.address)}
      </p>
      {delivery.note && <p className="small muted">{delivery.note}</p>}
      {sends && (
        <>
          <ScanInput
            label={dt.scanOut}
            focusSignal={toScan}
            onScan={(v) => {
              const code = v.trim().toUpperCase();
              if (!code) return;
              removed.current.delete(code);
              setCodes((x) => (x.includes(code) ? x : [...x, code]));
            }}
          />
          <ul className="desk-list">
            {codes.map((c) => (
              <li key={c}>
                <span className="mono">{c}</span> {ready.holds.find((h) => h.copyCode === c)?.bookTitle}
                <button
                  type="button"
                  className="btn btn-text"
                  onClick={() => {
                    removed.current.add(c);
                    setCodes((x) => x.filter((y) => y !== c));
                  }}
                  aria-label={`${dt.remove} ${c}`}
                >
                  {dt.remove}
                </button>
              </li>
            ))}
          </ul>
          <ReadyHolds orgId={orgId} deliveryId={delivery.id} onChange={onHolds} onRetry={() => setToScan((n) => n + 1)} />
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
                disabled={quote.busy}
                onClick={() => {
                  setFares(null);
                  void quote.run(async () => {
                    const r = await quoteCourier(orgId, delivery.id, method);
                    setFares(r.fares.length ? r.fares.map((f) => dt.fare(f.vehicle, money(f.fareMinor), f.etaMinutes)).join(' · ') : dt.noFares);
                  });
                }}
              >
                {quote.busy ? t.loading : dt.getQuote}
              </button>
            )}
            {fares && <span className="small">{fares}</span>}
            {quote.error && <span className="small field-error">{quote.error}</span>}
          </div>
        )}
        {delivery.fee.status === 'DUE' && (
          <label className="check">
            <input type="checkbox" checked={waive} onChange={(e) => setWaive(e.target.checked)} /> {dt.waiveFee} ({money(delivery.fee.amountMinor)})
          </label>
        )}
        <FormError error={error} />
        <DialogActions busy={busy} disabled={!ready.settled} submitLabel={dt.dispatchBtn(sends ? codes.length : 0)} onCancel={onClose} />
      </form>
    </Dialog>
  );
}

type ReportProps = { orgId: string; delivery: Delivery; onClose: () => void; onSaved: () => void };

/** How the visit went: by the rider at the door, or by the branch for them. */
export function ReportDialog({ loans, ...props }: ReportProps & { loans: MemberLoan[] }) {
  return (
    <Dialog title={dt.reportTitle(props.delivery.memberName)} onClose={props.onClose}>
      <ReportForm {...props} loans={loans} />
    </Dialog>
  );
}

/**
 * The report from the board for a visit that collects books: the form opens at once and the member's books
 * arrive behind it. (A plain delivery collects nothing and uses ReportDialog with no books, so it reads nothing.)
 */
function BoardReportDialog(props: ReportProps) {
  const loans = useAsync(() => getDelivery(props.orgId, props.delivery.id).then((r) => r.memberLoans), [props.orgId, props.delivery.id]);
  return (
    <Dialog title={dt.reportTitle(props.delivery.memberName)} onClose={props.onClose}>
      <ReportForm {...props} loans={loans.loading ? null : (loans.data ?? null)} loansError={loans.loading ? null : loans.error} onRetryLoans={loans.reload} />
    </Dialog>
  );
}

/** `loans` is null while the member's books are still being read (or could not be): never an empty list for "not known yet". */
function ReportForm({
  orgId,
  delivery,
  loans,
  loansError,
  onRetryLoans,
  onClose,
  onSaved,
}: ReportProps & { loans: MemberLoan[] | null; loansError?: string | null; onRetryLoans?: () => void }) {
  const [outcome, setOutcome] = useState<'DELIVERED' | 'FAILED'>('DELIVERED');
  const [handedTo, setHandedTo] = useState('');
  const [collected, setCollected] = useState<string[]>(delivery.collectLoanIds);
  const [reason, setReason] = useState('');
  const [feeMethod, setFeeMethod] = useState<string>('');
  const [feeRef, setFeeRef] = useState('');
  const collects = delivery.kind !== 'DELIVER';
  // "Try again" goes away when pressed: focus moves to the group it was in, where the books then appear.
  const books = useRef<HTMLFieldSetElement>(null);
  const candidates = (loans ?? []).filter((l) => l.deliveryId !== delivery.id);
  // What was collected can't be saved unseen: a delivered visit waits for the member's books. "Couldn't deliver" need not.
  const waiting = outcome === 'DELIVERED' && collects && loans === null;
  const { busy, error, submit } = useSubmit(async () => {
    if (waiting) return;
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
            <fieldset className="checklist" ref={books} tabIndex={-1}>
              <legend>{dt.collectedNow}</legend>
              {loans === null ? (
                loansError ? (
                  <p className="field-error small" role="alert">
                    {dt.loansFailed}{' '}
                    <button
                      type="button"
                      className="link"
                      onClick={() => {
                        books.current?.focus();
                        onRetryLoans?.();
                      }}
                    >
                      {t.retry}
                    </button>
                  </p>
                ) : (
                  <SkeletonRows rows={2} />
                )
              ) : candidates.length === 0 ? (
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
      <DialogActions busy={busy} disabled={waiting} submitLabel={t.save} onCancel={onClose} />
    </form>
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

function DeliveryCard({
  orgId,
  branchId,
  d,
  onAct,
  onChanged,
  problem,
  locked,
  tick,
}: {
  orgId: string;
  branchId: string;
  d: Delivery;
  onAct: (o: Open) => void;
  onChanged: () => void;
  /** Why the visit was left out when several were sent together. */
  problem?: string;
  /** Several visits are being sent: nothing else may start meanwhile. */
  locked?: boolean;
  /** The visit can go out with others: whether it is ticked. */
  tick?: { on: boolean; set: (on: boolean) => void };
}) {
  const action = useAction();
  const busy = action.busy || !!locked;
  const run = (fn: () => Promise<unknown>) =>
    action.run(async () => {
      await fn();
      onChanged();
    });
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
          <Badge tone={STATUS_TONE[d.status]}>{d.outcome && d.status !== 'REQUESTED' && d.status !== 'OUT' ? dt.outcome[d.outcome] : dt.status[d.status]}</Badge>
          {d.fee.amountMinor > 0 && <Badge tone={FEE_TONE[d.fee.status]}>{`${dt.fee[d.fee.status]} ${money(d.fee.amountMinor)}`}</Badge>}
        </div>
      </div>
      <p className="small">
        {oneLine(d.address)} · <Contact d={d} />
      </p>
      <Books d={d} />
      <HowItGoes d={d} />
      {d.failReason && <p className="small field-error">{d.failReason}</p>}
      {action.error && <Notice tone="error">{action.error}</Notice>}
      {problem && <Notice tone="warn">{problem}</Notice>}
      <div className="row">
        {tick && (
          <label className="check">
            <input type="checkbox" checked={tick.on} disabled={locked} onChange={(e) => tick.set(e.target.checked)} aria-label={dt.runTickFor(d.memberName)} />
            {dt.runTick}
          </label>
        )}
        {d.status === 'REQUESTED' && (
          <button type="button" className="btn btn-filled" disabled={locked} onClick={() => onAct({ kind: 'dispatch', d })}>
            {dt.dispatch}
          </button>
        )}
        {d.status === 'OUT' && (
          <button type="button" className="btn btn-outlined" disabled={locked} onClick={() => onAct({ kind: 'report', d })}>
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
          <button type="button" className="btn btn-filled" disabled={locked} onClick={() => onAct({ kind: 'receive', d })}>
            {dt.receive}
          </button>
        )}
        {d.fee.status === 'DUE' && d.status !== 'REQUESTED' && (
          <button type="button" className="btn btn-text" disabled={locked} onClick={() => onAct({ kind: 'fee', d })}>
            {dt.recordFee}
          </button>
        )}
        {(d.status === 'REQUESTED' || d.status === 'OUT') && (
          <button type="button" className="btn btn-text danger" disabled={locked} onClick={() => onAct({ kind: 'cancel', d })}>
            {dt.cancel}
          </button>
        )}
      </div>
    </li>
  );
}

function Board({ orgId, branchId }: { orgId: string; branchId: string }) {
  const { claims } = useAuth();
  const [params] = useSearchParams();
  // The tab named in the address (the dashboard's "bags to receive" link); otherwise chosen once, when the list
  // first arrives, and kept: the board must not jump tabs when the last waiting visit is dispatched.
  const [picked, setPicked] = useState<BoardTab | null>(() => tabFrom(params.get('tab')));
  const [open, setOpen] = useState<Open>(null);
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'warn'; text: string } | null>(null);
  const [last, setLast] = useState(() => readLastDispatch(orgId, branchId));
  // Sending several visits with one rider: the ticked visits, the rider, and what held a visit back.
  const [ticked, setTicked] = useState<string[]>([]);
  const [runRider, setRunRider] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [problems, setProblems] = useState<Record<string, string>>({});
  const run = useAction();
  const [bags, setBags] = useState<{ carrier: string; bags: Delivery[] } | null>(null);
  const view = useAsync(() => deliverySettings(orgId, branchId), [orgId, branchId]);
  const data = useAsync(() => listDeliveries(orgId, branchId), [orgId, branchId]);
  useEffect(() => {
    if (data.data) setPicked((p) => p ?? landingTab(data.data!.open));
  }, [data.data]);
  const tab = picked ?? (data.data ? landingTab(data.data.open) : 'REQUESTED');
  // What closed in the last two weeks is read only while its tab shows, afresh each time it is opened (visits
  // are closed from the other tabs). Its own read: the tab must not be an input of the open list above, or every
  // switch would blank the board.
  const showClosed = tab === 'CLOSED';
  const closed = useAsync(() => (showClosed ? listDeliveries(orgId, branchId, true).then((r) => r.closed) : Promise.resolve(null)), [orgId, branchId, showClosed]);
  const changed = () => {
    data.reload();
    if (showClosed) closed.reload();
  };
  const refresh = useRef(changed);
  refresh.current = changed;
  // Courier orders: ask the courier for news once per board, and only when the list (of this branch) shows one
  // out with a courier app. Each card keeps its own Refresh.
  const asked = useRef('');
  useEffect(() => {
    const here = `${orgId}/${branchId}`;
    if (asked.current === here || data.loading || !data.data) return;
    asked.current = here;
    if (!data.data.open.some((d) => d.status === 'OUT' && d.provider?.orderId)) return;
    void syncDeliveries(orgId, branchId)
      .then((r) => Object.keys(r.updated).length && refresh.current())
      .catch(() => undefined);
  }, [orgId, branchId, data.loading, data.data]);
  if (view.loading || data.loading) return <SkeletonRows rows={5} />;
  // Only a board with nothing to show gives way to the error: a failed refresh keeps the board (and an open dialog).
  if (!view.data || !data.data) return <ErrorState message={view.error ?? data.error ?? t.errorLoad} onRetry={() => (view.reload(), data.reload())} />;
  const v = view.data;
  const all = data.data;
  const closedRows = showClosed && !closed.loading ? (closed.data ?? null) : null;
  const refreshError = view.error ?? data.error ?? (closedRows ? closed.error : null);
  // Bags coming back are kept together by who carries them.
  const groups = tab === 'RETURNING' ? carrierGroups(all.open.filter((d) => d.status === 'RETURNING')) : [];
  const rows = showClosed ? (closedRows ?? []) : tab === 'RETURNING' ? groups.flatMap((g) => g.bags) : all.open.filter((d) => d.status === tab);
  const count = (s: string) => all.open.filter((d) => d.status === s).length;
  const carrierName = (g: (typeof groups)[number]) => g.name ?? (g.bags[0].provider ? (dt.method[g.bags[0].provider.key] ?? g.bags[0].provider.key) : dt.otherCarrier);

  const remembered = (next: LastDispatch) => {
    setLast(next);
    saveLastDispatch(orgId, branchId, next);
  };
  // Several visits with the branch's own rider. The server checks delivery.assign again for each visit.
  const canRun = tab === 'REQUESTED' && v.settings.enabled && v.settings.methods.OWN && v.riders.length > 0 && can(claims, 'delivery.assign', orgId, branchId);
  const joinable = canRun ? rows.filter(canJoinRun) : [];
  const chosen = joinable.filter((d) => ticked.includes(d.id));
  // The rider picked here, else the one remembered, while they still work at the branch (a wrong rider can't be undone).
  const rider = v.riders.find((r) => r.uid === runRider) ?? v.riders.find((r) => r.uid === startingChoice(last, ['OWN'], v.riders).riderUid);
  const sendTicked = () =>
    run.run(async () => {
      if (!rider || !chosen.length) return;
      const result = await sendRun(
        chosen,
        rider.uid,
        { holds: (id) => getDelivery(orgId, id).then((r) => r.holds), dispatch: (id, input) => dispatchDelivery(orgId, id, input) },
        dt.runNeedsCheck,
      );
      const left = chosen.length - result.sent.length;
      setProblems(result.problems);
      setTicked((x) => x.filter((id) => !result.sent.includes(id)));
      if (result.sent.length) remembered(withDispatch(last, { method: 'OWN', riderUid: rider.uid, courierName: '' }));
      setNotice(left ? { tone: 'warn', text: dt.runSome(result.sent.length, left) } : { tone: 'ok', text: dt.runDone(result.sent.length) });
      setConfirming(false);
      changed();
    });
  return (
    <>
      {!v.settings.enabled && <Notice tone="warn">{dt.settingsIntro}</Notice>}
      <div className="page-header-row">
        <Tabs
          value={tab}
          onChange={setPicked}
          tabs={BOARD_TABS.map((x) => ({
            value: x,
            label: dt.tabs[x],
            count: x === 'CLOSED' ? undefined : count(x),
          }))}
        />
        <button type="button" className="btn btn-filled" disabled={!v.settings.enabled} onClick={() => setAdding(true)}>
          {dt.newDelivery}
        </button>
      </div>
      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
      {refreshError && <Notice tone="error">{refreshError}</Notice>}
      {joinable.length > 0 && rider && (
        <section className="card dl-run" aria-label={dt.runTitle}>
          <p className="muted small">{dt.runHint}</p>
          <div className="row">
            <SelectField label={dt.runRider} value={rider.uid} onChange={setRunRider} disabled={run.busy} options={v.riders.map((r) => ({ value: r.uid, label: r.name }))} />
            <button type="button" className="btn btn-filled" disabled={run.busy || chosen.length === 0} onClick={() => setConfirming(true)}>
              {dt.runSend(chosen.length, rider.name)}
            </button>
          </div>
        </section>
      )}
      {groups.some((g) => g.bags.length > 1) && (
        <div className="row">
          {groups
            .filter((g) => g.bags.length > 1)
            .map((g) => (
              <button key={g.key} type="button" className="btn btn-outlined" onClick={() => setBags({ carrier: carrierName(g), bags: g.bags })}>
                {dt.receiveAll(g.bags.length, carrierName(g))}
              </button>
            ))}
        </div>
      )}
      {showClosed && !closedRows ? (
        // The rest of the board stays while the closed visits are read.
        closed.error && !closed.loading ? (
          <ErrorState message={closed.error} onRetry={closed.reload} />
        ) : (
          <SkeletonRows rows={3} />
        )
      ) : rows.length === 0 ? (
        <EmptyState icon="truck" title={dt.empty[tab]} message="" />
      ) : (
        <ul className="dl-list">
          {rows.map((d) => (
            <DeliveryCard
              key={d.id}
              orgId={orgId}
              branchId={branchId}
              d={d}
              onAct={setOpen}
              onChanged={changed}
              problem={d.status === 'REQUESTED' ? problems[d.id] : undefined}
              locked={run.busy}
              tick={joinable.includes(d) ? { on: ticked.includes(d.id), set: (on) => setTicked((x) => (on ? [...x.filter((id) => id !== d.id), d.id] : x.filter((id) => id !== d.id))) } : undefined}
            />
          ))}
        </ul>
      )}
      {adding && <NewDeliveryDialog orgId={orgId} branchId={branchId} view={v} open={all.open} onClose={() => setAdding(false)} onSaved={changed} />}
      {open?.kind === 'dispatch' && (
        <DispatchDialog
          orgId={orgId}
          delivery={open.d}
          view={v}
          last={last}
          onClose={() => setOpen(null)}
          onSaved={changed}
          onDispatched={(used) => remembered(withDispatch(last, used))}
        />
      )}
      {/* A plain delivery collects nothing: its report needs no read at all. */}
      {open?.kind === 'report' &&
        (open.d.kind === 'DELIVER' ? (
          <ReportDialog orgId={orgId} delivery={open.d} loans={[]} onClose={() => setOpen(null)} onSaved={changed} />
        ) : (
          <BoardReportDialog orgId={orgId} delivery={open.d} onClose={() => setOpen(null)} onSaved={changed} />
        ))}
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
            setNotice({ tone: 'ok', text: dt.received(n) });
            changed();
          }}
        />
      )}
      {confirming && rider && (
        <Dialog title={dt.runConfirmTitle(chosen.length, rider.name)} onClose={() => !run.busy && setConfirming(false)} narrow>
          <form
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              void sendTicked();
            }}
          >
            <p className="muted">{dt.runConfirmBody}</p>
            <ul className="desk-list">
              {chosen.map((d) => (
                <li key={d.id}>
                  {d.memberName} <span className="muted small">{dt.kind[d.kind]}</span>
                </li>
              ))}
            </ul>
            <FormError error={run.error} />
            <DialogActions busy={run.busy} disabled={!chosen.length} submitLabel={dt.runConfirm(chosen.length)} onCancel={() => setConfirming(false)} />
          </form>
        </Dialog>
      )}
      {bags && (
        <ReceiveAllDialog
          orgId={orgId}
          carrier={bags.carrier}
          bags={bags.bags}
          onClose={() => setBags(null)}
          onSettled={changed}
          onDone={(n, books) => setNotice({ tone: 'ok', text: dt.receivedBags(n, books) })}
        />
      )}
    </>
  );
}

function ReceiveDialog({ orgId, delivery, onClose, onDone }: { orgId: string; delivery: Delivery; onClose: () => void; onDone: (n: number) => void }) {
  const items = bagItems(delivery);
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

/**
 * Several bags from one rider or courier, received in one go. Receiving is the check that the books are back
 * (the loan closes and the member is told), so every bag is listed with its books and can be unticked. Each bag
 * is still its own command: one that fails stays here to be tried again, the others are done.
 */
function ReceiveAllDialog({
  orgId,
  carrier,
  bags,
  onClose,
  onSettled,
  onDone,
}: {
  orgId: string;
  carrier: string;
  bags: Delivery[];
  onClose: () => void;
  /** Every call has answered (whatever the answers): the board is out of date. */
  onSettled: () => void;
  onDone: (bags: number, books: number) => void;
}) {
  // Bags still to receive: all of them, then only those that failed.
  const [left, setLeft] = useState(bags);
  const [ticked, setTicked] = useState(() => bags.map((b) => b.id));
  const [problems, setProblems] = useState<Record<string, string>>({});
  const [done, setDone] = useState({ bags: 0, books: 0 });
  const chosen = left.filter((b) => ticked.includes(b.id));
  const { busy, error, submit } = useSubmit(async () => {
    if (!chosen.length) return;
    const r = await receiveBags(chosen, (id) => receiveDelivery(orgId, id));
    onSettled();
    const total = { bags: done.bags + r.done.length, books: done.books + r.books };
    const failed = chosen.filter((b) => r.problems[b.id]);
    if (!failed.length) {
      onDone(total.bags, total.books);
      return onClose();
    }
    setDone(total);
    setProblems(r.problems);
    setLeft(failed);
    setTicked(failed.map((b) => b.id));
  });
  // Closing after some bags went through still says what was received.
  const close = () => {
    if (busy) return;
    if (done.bags) onDone(done.bags, done.books);
    onClose();
  };
  return (
    <Dialog title={dt.receiveAllTitle(carrier)} onClose={close}>
      <form onSubmit={submit} noValidate>
        {done.bags > 0 && <Notice tone="ok">{dt.receivedBags(done.bags, done.books)}</Notice>}
        {left.some((b) => problems[b.id]) ? <Notice tone="error">{dt.bagsFailed}</Notice> : <p className="muted">{dt.receiveAllIntro}</p>}
        <ul className="checklist">
          {left.map((b) => {
            const items = bagItems(b);
            return (
              <li key={b.id}>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={ticked.includes(b.id)}
                    disabled={busy}
                    onChange={(e) => setTicked((x) => (e.target.checked ? [...x, b.id] : x.filter((id) => id !== b.id)))}
                  />
                  <span>
                    <strong>{b.memberName}</strong> <span className="mono small">{b.memberCode}</span>
                    <br />
                    <span className="small">{items.length ? items.map((i) => `${i.bookTitle} (${i.copyCode})`).join(', ') : dt.bagEmpty}</span>
                  </span>
                </label>
                {problems[b.id] && <p className="field-error small">{problems[b.id]}</p>}
              </li>
            );
          })}
        </ul>
        <FormError error={error} />
        <DialogActions busy={busy} disabled={!chosen.length} submitLabel={dt.receiveBags(chosen.length)} onCancel={close} />
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
      {/* A new board for each branch: the tab, ticks and open dialogs belong to the branch they were made for. */}
      <NeedBranch>{(branchId) => <Board key={`${org.id}/${branchId}`} orgId={org.id} branchId={branchId} />}</NeedBranch>
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
                {d.fee.status === 'DUE' && <Badge tone="warn">{`${dt.fee.DUE} ${money(d.fee.amountMinor)}`}</Badge>}
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
