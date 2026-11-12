import { type KeyboardEvent, type PointerEvent, useEffect, useRef, useState } from 'react';

import { useAuth } from '../../auth/AuthContext';
import { can } from '../../auth/claims';
import { ApiError, command, errorText } from '../../data/api';
import { listTransfers, type Transfer, TRANSFER_MAX, type TransferReceipt } from '../../data/circulation';
import { CONDITIONS, type Condition, label } from '../../data/common';
import { type Copy, findCopy, listLocations } from '../../data/inventory';
import { useAsync } from '../../shared/useAsync';
import { day } from '../../shared/format';
import { oneOf, remember } from '../../shared/remember';
import { reportError } from '../../shared/reportError';
import { t } from '../../strings';
import { EmptyState, Icon, makeStatusBadge, SkeletonRows, TableWrap } from '../../shared/ui';
import { ConfirmWithReason, Dialog, DialogActions, FormError, SelectField, TextField, useAction, useSubmit } from '../components/Dialog';
import { NeedBranch, Notice, ScanInput, Tabs } from '../components/kit';
import { lt } from '../../strings/library';
import { useWorkspace } from '../Workspace';

const TransferStatusBadge = makeStatusBadge<Transfer['status']>({ DRAFT: 'muted', IN_TRANSIT: 'info', RECEIVED: 'ok', CANCELLED: 'muted' }, label);

/**
 * A scanner types into whatever has the keyboard and ends with Enter. In these dialogs only the scan field may take
 * that: on a tick box or a list, Enter would press the dialog's main button, and the letters would pick another
 * option of the list. So those keys do nothing there (arrow keys still choose, Space still ticks), and a change made
 * with the mouse hands the keyboard back to the scan field. A change made with the keyboard leaves focus where it is.
 */
function useScanGuard() {
  const [focusSignal, setFocusSignal] = useState(0);
  const byMouse = useRef(false);
  const refocus = () => setFocusSignal((n) => n + 1);
  return {
    focusSignal,
    refocus,
    /** Call after a tick or a pick. */
    changed: () => {
      if (byMouse.current) refocus();
    },
    /** For the dialog's form. */
    form: {
      // No scanner's keys follow a finger or a pen, and focus on the field there would bring the on-screen keyboard up over the list.
      onPointerDownCapture: (e: PointerEvent<HTMLFormElement>) => {
        byMouse.current = e.pointerType !== 'touch' && e.pointerType !== 'pen';
      },
      onKeyDownCapture: (e: KeyboardEvent<HTMLFormElement>) => {
        byMouse.current = false;
        // Browser shortcuts stay.
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        const list = e.target instanceof HTMLSelectElement;
        const tick = e.target instanceof HTMLInputElement && e.target.type === 'checkbox';
        if (e.key === 'Enter' ? list || tick : list && e.key.length === 1) e.preventDefault();
      },
    },
  };
}

/** One scan in the New transfer list. It is listed at once and looked up behind, so the next book can be scanned straight away. */
interface Row {
  key: number;
  scanned: string;
  state: 'checking' | 'ok' | 'warn' | 'error';
  copy?: Copy;
  text?: string;
}

/**
 * Sends shelf copies to another branch in one command (transfers-create with `dispatch`). The command takes no
 * request id of its own: the list can change between two presses, and a fixed id would answer "done" for the
 * earlier list.
 */
export function NewTransferDialog({ orgId, fromBranchId, onClose, onSaved }: { orgId: string; fromBranchId: string; onClose: () => void; onSaved: () => void }) {
  const { branches, branchName } = useWorkspace();
  const targets = branches.filter((b) => b.status === 'ACTIVE' && b.id !== fromBranchId);
  // Where this branch last sent books, when that branch is still open.
  const lastTo = remember.key('transferTo', orgId, fromBranchId);
  const [to, setTo] = useState(() => remember.get(lastTo, targets[0]?.id ?? '', oneOf(targets.map((b) => b.id))));
  const [note, setNote] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  // The list as it is now, for lookups that answer later and out of order.
  const list = useRef<Row[]>([]);
  const change = (fn: (rows: Row[]) => Row[]) => {
    list.current = fn(list.current);
    setRows(list.current);
  };
  const nextKey = useRef(0);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'warn'; text: string } | null>(null);
  const guard = useScanGuard();
  // Set by "Dispatch and start another" for the submit it starts.
  const another = useRef(false);

  const check = async (key: number, scanned: string) => {
    let found: Copy | null;
    try {
      found = await findCopy(orgId, fromBranchId, scanned);
    } catch (e) {
      // ScanInput can't show this one: the lookup outlives the scan.
      if (!(e instanceof ApiError)) reportError(e, 'scan');
      if (live.current) change((x) => x.map((r) => (r.key === key ? { ...r, state: 'error', text: errorText(e, t.errorLoad) } : r)));
      return;
    }
    // The dialog closed, or the row was removed while it was looked up.
    if (!live.current || !list.current.some((r) => r.key === key)) return;
    const copy = found;
    if (copy && list.current.some((r) => r.key !== key && r.copy?.id === copy.id)) {
      // Its label was scanned and its code typed: one copy, one row.
      change((x) => x.filter((r) => r.key !== key));
      setNotice({ tone: 'warn', text: lt.alreadyStaged });
      return;
    }
    change((x) =>
      x.map((r): Row => {
        if (r.key !== key) return r;
        if (!copy) return { ...r, state: 'warn', text: lt.copyNotFound };
        if (copy.status !== 'AVAILABLE') return { ...r, state: 'warn', copy, text: lt.transferCantSend(label(copy.status)) };
        return { ...r, state: 'ok', copy, text: undefined };
      }),
    );
  };

  // Not async on purpose: ScanInput holds its field while a handler's promise is pending, and a book scanned then is lost.
  const stage = (raw: string) => {
    const scanned = raw.trim().toUpperCase();
    if (!scanned) return;
    if (list.current.some((r) => r.scanned === scanned || r.copy?.code === scanned || r.copy?.barcode === scanned)) return setNotice({ tone: 'warn', text: lt.alreadyStaged });
    if (list.current.length >= TRANSFER_MAX) return setNotice({ tone: 'warn', text: lt.transferFull(TRANSFER_MAX) });
    setNotice(null);
    const key = nextKey.current++;
    change((x) => [...x, { key, scanned, state: 'checking' }]);
    void check(key, scanned);
  };
  const retry = (r: Row) => {
    change((x) => x.map((y) => (y.key === r.key ? { ...y, state: 'checking', text: undefined } : y)));
    void check(r.key, r.scanned);
  };
  const remove = (key: number) => {
    change((x) => x.filter((r) => r.key !== key));
    // The button that had focus is gone with its row.
    guard.refocus();
  };

  const { busy, error, submit } = useSubmit(async () => {
    const stay = another.current;
    another.current = false;
    const sent = list.current.filter((r) => r.state === 'ok');
    try {
      await command('transfers-create', { orgId, fromBranchId, toBranchId: to, copyIds: sent.map((r) => r.copy!.id), note: note.trim(), dispatch: true });
    } catch (e) {
      // It may have gone through with the answer lost on the way: show what this branch has sent.
      onSaved();
      guard.refocus();
      throw e;
    }
    remember.set(lastTo, to);
    onSaved();
    if (!stay) return onClose();
    // The destination stays as it is, and is said out loud: changing it silently could send the next box to the wrong branch.
    change(() => []);
    setNote('');
    setNotice({ tone: 'ok', text: lt.transferSent(sent.length, branchName(to)) });
    guard.refocus();
  });

  // Escape, a click outside and Cancel all ask before a scanned list is thrown away.
  const close = () => {
    if (list.current.length && !confirm(lt.transferDiscard)) return;
    onClose();
  };

  if (!targets.length) {
    return (
      <Dialog title={lt.newTransfer} onClose={onClose} narrow>
        <Notice tone="warn">{lt.transferNoTargets}</Notice>
        <div className="dialog-actions">
          <button type="button" className="btn btn-filled" onClick={onClose}>
            {t.close}
          </button>
        </div>
      </Dialog>
    );
  }
  const sendable = rows.filter((r) => r.state === 'ok').length;
  const problems = rows.some((r) => r.state === 'warn' || r.state === 'error');
  // Every row must be a copy that can go, so what is sent is what is in the box.
  const ready = !!to && sendable > 0 && sendable === rows.length;
  return (
    <Dialog title={lt.newTransfer} onClose={close}>
      <form onSubmit={submit} noValidate {...guard.form}>
        {targets.length === 1 ? (
          <p>
            {lt.toBranch}: <strong>{targets[0].name}</strong>
          </p>
        ) : (
          <SelectField
            label={lt.toBranch}
            value={to}
            onChange={(v) => {
              setTo(v);
              guard.changed();
            }}
            options={targets.map((b) => ({ value: b.id, label: b.name }))}
          />
        )}
        <ScanInput label={lt.transferScan} onScan={stage} busy={busy} autoFocus focusSignal={guard.focusSignal} />
        {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
        {rows.length > 0 && (
          <ul className="desk-list">
            {rows.map((r) => (
              <li key={r.key}>
                <span>
                  {r.copy ? (
                    <>
                      {r.copy.bookTitle} <span className="mono small">{r.copy.code}</span>
                    </>
                  ) : (
                    <span className="mono small">{r.scanned}</span>
                  )}
                  {r.state === 'checking' && <span className="muted small"> {lt.transferChecking}</span>}
                  {r.text && <span className="warn-text small"> {r.text}</span>}
                </span>
                <span className="row">
                  {r.state === 'error' && (
                    <button type="button" className="btn btn-text" onClick={() => retry(r)}>
                      {t.retry}
                    </button>
                  )}
                  <button type="button" className="btn btn-text" aria-label={lt.transferRemoveRow(r.copy?.code ?? r.scanned)} disabled={busy} onClick={() => remove(r.key)}>
                    {lt.transferRemove}
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="muted small" role="status">
          {lt.transferCount(rows.length, TRANSFER_MAX)}
          {problems && ` · ${lt.transferFixRows}`}
        </p>
        <TextField label={lt.note} value={note} onChange={setNote} />
        <FormError error={error} />
        {/* Three buttons, so not DialogActions. Dispatch stays the form's own button: Enter in the note sends and closes. */}
        <div className="dialog-actions">
          <button type="button" className="btn btn-text" onClick={close} disabled={busy}>
            {t.cancel}
          </button>
          <button
            type="button"
            className="btn btn-outlined"
            disabled={busy || !ready}
            onClick={() => {
              another.current = true;
              void submit();
            }}
          >
            {lt.transferAndAnother}
          </button>
          <button type="submit" className="btn btn-filled" disabled={busy || !ready}>
            {busy ? t.saving : `${lt.dispatch} ${sendable}`}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

/** What staff said about one arriving copy. No `condition` means it was not touched: the copy keeps the one it has. */
interface Line {
  arrived: boolean;
  condition: Condition | '';
  damaged: boolean;
}
const NOT_ARRIVED: Line = { arrived: false, condition: '', damaged: false };

/**
 * Receives a transfer from its own list of copies: the destination can't read a copy while it travels, so scans
 * are matched against the labels and codes kept on the transfer. A scan that matches nothing is refused at once.
 */
export function ReceiveDialog({
  orgId,
  transfer,
  onClose,
  onSaved,
}: {
  orgId: string;
  transfer: Transfer;
  onClose: () => void;
  onSaved: (receipt: TransferReceipt, count: number) => void;
}) {
  const { claims } = useAuth();
  const pending = transfer.items.filter((i) => !i.received);
  const [lines, setLines] = useState<Record<string, Line>>({});
  const line = (copyId: string) => lines[copyId] ?? NOT_ARRIVED;
  const set = (copyId: string, next: Partial<Line>) => setLines((x) => ({ ...x, [copyId]: { ...(x[copyId] ?? NOT_ARRIVED), ...next } }));
  const guard = useScanGuard();
  /** A change made on the row itself, not by a scan. */
  const mark = (copyId: string, next: Partial<Line>) => {
    set(copyId, next);
    guard.changed();
  };
  const [scanMsg, setScanMsg] = useState<string | null>(null);
  // Shelving is its own permission, and the server asks for it only when a shelf is sent.
  const canShelve = can(claims, 'copies.manage', orgId, transfer.toBranchId);
  const locations = useAsync(() => (canShelve ? listLocations(orgId, transfer.toBranchId) : Promise.resolve([])), [orgId, transfer.toBranchId, canShelve]);
  const shelves = (locations.data ?? []).filter((l) => l.status === 'ACTIVE');
  const [shelf, setShelf] = useState('');
  const arrived = pending.filter((i) => line(i.copyId).arrived);

  const { busy, error, submit } = useSubmit(async () => {
    const receipt = await command<TransferReceipt>('transfers-receive', {
      orgId,
      transferId: transfer.id,
      ...(shelf ? { locationId: shelf } : {}),
      items: arrived.map((i) => {
        const { condition, damaged } = line(i.copyId);
        // An untouched row sends no condition, so the server keeps the copy's own.
        return { barcode: i.barcode ?? i.code, damaged, ...(condition ? { condition } : {}) };
      }),
    });
    onSaved(receipt, arrived.length);
    onClose();
  });
  const scan = (raw: string) => {
    const value = raw.trim().toUpperCase();
    // Transfers made before labels were kept on them match by copy code only.
    const hit = pending.find((i) => i.barcode?.toUpperCase() === value) ?? pending.find((i) => i.code.toUpperCase() === value);
    if (!hit) return setScanMsg(lt.arrivalNotInTransfer(value));
    if (line(hit.copyId).arrived) return setScanMsg(lt.alreadyStaged);
    setScanMsg(null);
    set(hit.copyId, { arrived: true });
  };
  const close = () => {
    if (arrived.length && !confirm(lt.transferDiscard)) return;
    onClose();
  };
  return (
    <Dialog title={lt.arrivalTitle(pending.length)} onClose={close}>
      <form onSubmit={submit} noValidate {...guard.form}>
        <ScanInput label={lt.arrivalScan} onScan={scan} busy={busy} autoFocus focusSignal={guard.focusSignal} />
        {scanMsg && <Notice tone="warn">{scanMsg}</Notice>}
        <p className="field-hint">{lt.arrivalHint}</p>
        <ul className="desk-list">
          {pending.map((i) => {
            const l = line(i.copyId);
            return (
              <li key={i.copyId}>
                <label className="check">
                  <input type="checkbox" checked={l.arrived} disabled={busy} onChange={(e) => mark(i.copyId, e.target.checked ? { arrived: true } : NOT_ARRIVED)} />
                  <span>
                    {i.bookTitle} <span className="mono small">{i.code}</span>
                  </span>
                </label>
                {l.arrived ? (
                  <span className="row">
                    <select aria-label={lt.arrivalConditionOf(i.code)} value={l.condition} onChange={(e) => mark(i.copyId, { condition: e.target.value as Condition | '' })}>
                      <option value="">{i.conditionOut ? lt.arrivalAsSent(label(i.conditionOut)) : lt.arrivalAsSentUnknown}</option>
                      {CONDITIONS.map((c) => (
                        <option key={c} value={c}>
                          {label(c)}
                        </option>
                      ))}
                    </select>
                    <label className="check">
                      <input type="checkbox" aria-label={lt.arrivalDamagedRow(i.code)} checked={l.damaged} onChange={(e) => mark(i.copyId, { damaged: e.target.checked })} />
                      {lt.damaged}
                    </label>
                  </span>
                ) : (
                  i.conditionOut && <span className="muted small">{label(i.conditionOut)}</span>
                )}
              </li>
            );
          })}
        </ul>
        <p className="muted small" role="status">
          {lt.arrivalCount(arrived.length, pending.length)}
        </p>
        {shelves.length > 0 && (
          <SelectField
            label={lt.shelveShelf}
            value={shelf}
            onChange={(v) => {
              setShelf(v);
              guard.changed();
            }}
            options={[{ value: '', label: lt.noLocation }, ...shelves.map((s) => ({ value: s.id, label: `${s.code} · ${s.label}` }))]}
            hint={lt.arrivalShelfHint}
          />
        )}
        <FormError error={error} />
        <DialogActions busy={busy} disabled={!arrived.length} submitLabel={lt.arrivalSubmit(arrived.length)} onCancel={close} />
      </form>
    </Dialog>
  );
}

function BranchTransfers({ orgId, branchId }: { orgId: string; branchId: string }) {
  const { claims } = useAuth();
  const { branchName } = useWorkspace();
  const [dir, setDir] = useState<'out' | 'in'>('in');
  const list = useAsync(() => listTransfers(orgId, branchId, dir), [orgId, branchId, dir]);
  const [creating, setCreating] = useState(false);
  const [receiving, setReceiving] = useState<Transfer | null>(null);
  // What the last receipt did, kept here because its dialog is gone: shown until dismissed or the next transfer is opened.
  const [receipt, setReceipt] = useState<{ count: number; result: TransferReceipt } | null>(null);
  const [cancelling, setCancelling] = useState<Transfer | null>(null);
  const action = useAction();
  const manage = can(claims, 'books.transfer', orgId, branchId);
  return (
    <>
      <div className="page-header-row">
        <Tabs tabs={[{ value: 'in', label: lt.incoming }, { value: 'out', label: lt.outgoing }]} value={dir} onChange={setDir} />
        {manage && (
          <button
            type="button"
            className="btn btn-filled"
            onClick={() => {
              setReceipt(null);
              setCreating(true);
            }}
          >
            <Icon name="plus" /> {lt.newTransfer}
          </button>
        )}
      </div>
      {action.error && <Notice tone="error">{action.error}</Notice>}
      {receipt && (
        <div className="notice notice-ok" role="status">
          {lt.arrivalDone(receipt.count, receipt.result.shelved)}
          {receipt.result.allocated.length > 0 && (
            <>
              {' '}
              <strong>{lt.arrivalSetAside}</strong>
              <ul>
                {receipt.result.allocated.map((a) => (
                  <li key={a.code}>
                    {a.bookTitle} <span className="mono small">{a.code}</span> · {a.memberName ? `${a.memberName} (${a.memberCode})` : lt.arrivalReserved}
                  </li>
                ))}
              </ul>
            </>
          )}{' '}
          <button type="button" className="btn btn-text" onClick={() => setReceipt(null)}>
            {t.close}
          </button>
        </div>
      )}
      {list.loading ? (
        <SkeletonRows rows={3} />
      ) : !list.data?.length ? (
        <EmptyState icon="truck" title={lt.transfersEmpty} message="" />
      ) : (
        <TableWrap>
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{dir === 'in' ? 'From' : lt.toBranch}</th>
                <th scope="col">{lt.items}</th>
                <th scope="col">{lt.status}</th>
                <th scope="col">Created</th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {list.data.map((tr) => (
                <tr key={tr.id}>
                  <td>{branchName(dir === 'in' ? tr.fromBranchId : tr.toBranchId)}</td>
                  <td className="small">
                    {tr.items.map((i) => `${i.code}${i.received ? ' ✓' : ''}`).join(', ')}
                  </td>
                  <td>
                    <TransferStatusBadge status={tr.status} />
                  </td>
                  <td className="nowrap small">{day(tr.createdAt)}</td>
                  <td className="cell-actions">
                    {dir === 'in' && tr.status === 'IN_TRANSIT' && manage && (
                      <button
                        type="button"
                        className="btn btn-outlined"
                        onClick={() => {
                          setReceipt(null);
                          setReceiving(tr);
                        }}
                      >
                        {lt.receive}
                      </button>
                    )}
                    {dir === 'out' && tr.status === 'DRAFT' && manage && (
                      <>
                        <button
                          type="button"
                          className="btn btn-outlined"
                          disabled={action.busy}
                          onClick={() =>
                            void action.run(async () => {
                              await command('transfers-dispatch', { orgId, transferId: tr.id });
                              list.reload();
                            }, tr.id)
                          }
                        >
                          {action.pending === tr.id ? t.saving : lt.dispatch}
                        </button>
                        <button type="button" className="btn btn-text" onClick={() => setCancelling(tr)}>
                          {t.cancel}
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
      {creating && <NewTransferDialog orgId={orgId} fromBranchId={branchId} onClose={() => setCreating(false)} onSaved={() => { setDir('out'); list.reload(); }} />}
      {receiving && (
        <ReceiveDialog
          orgId={orgId}
          transfer={receiving}
          onClose={() => setReceiving(null)}
          onSaved={(result, count) => {
            setReceipt({ result, count });
            list.reload();
          }}
        />
      )}
      {cancelling && (
        <ConfirmWithReason title={`${t.cancel}?`} body="" confirmLabel={t.cancel} onClose={() => setCancelling(null)}
          onConfirm={async (reason) => { await command('transfers-cancel', { orgId, transferId: cancelling.id, reason }); list.reload(); setCancelling(null); }} />
      )}
    </>
  );
}

export function TransfersPage() {
  const { org } = useWorkspace();
  return (
    <>
      <header className="page-header">
        <h1>{lt.transfersTitle}</h1>
      </header>
      {/* Keyed: a receipt notice, an error or an open tab of one branch must not stay on screen for the next. */}
      <NeedBranch>{(branchId) => org && <BranchTransfers key={`${org.id}/${branchId}`} orgId={org.id} branchId={branchId} />}</NeedBranch>
    </>
  );
}
