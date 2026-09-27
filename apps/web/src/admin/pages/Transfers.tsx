import { useState } from 'react';

import { useAuth } from '../../auth/AuthContext';
import { can } from '../../auth/claims';
import { ApiError, command } from '../../data/api';
import { CONDITIONS, type Condition, type Copy, findCopy, label, listTransfers, type Transfer } from '../../data/library';
import { useAsync } from '../../data/useAsync';
import { day } from '../../format';
import { t } from '../../strings';
import { EmptyState, Icon, SkeletonRows } from '../../ui';
import { ConfirmWithReason, Dialog, DialogActions, FormError, SelectField, TextField, useSubmit } from '../Dialog';
import { NeedBranch, Notice, ScanInput, Tabs } from '../kit';
import { lt } from '../libraryStrings';
import { useWorkspace } from '../Workspace';

const TONE: Record<Transfer['status'], string> = { DRAFT: 'muted', IN_TRANSIT: 'info', RECEIVED: 'ok', CANCELLED: 'muted' };

function NewTransferDialog({ orgId, fromBranchId, onClose, onSaved }: { orgId: string; fromBranchId: string; onClose: () => void; onSaved: () => void }) {
  const { branches } = useWorkspace();
  const targets = branches.filter((b) => b.status === 'ACTIVE' && b.id !== fromBranchId);
  const [to, setTo] = useState(targets[0]?.id ?? '');
  const [note, setNote] = useState('');
  const [copies, setCopies] = useState<Copy[]>([]);
  const [scanMsg, setScanMsg] = useState<string | null>(null);
  const { busy, error, submit } = useSubmit(async () => {
    const { transferId } = await command<{ transferId: string }>('transfers-create', { orgId, fromBranchId, toBranchId: to, barcodes: copies.map((c) => c.barcode), note: note.trim() });
    await command('transfers-dispatch', { orgId, transferId });
    onSaved();
    onClose();
  });
  return (
    <Dialog title={lt.newTransfer} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <SelectField label={lt.toBranch} value={to} onChange={setTo} options={targets.map((b) => ({ value: b.id, label: b.name }))} />
        <TextField label={lt.note} value={note} onChange={setNote} />
        <ScanInput
          label={lt.items}
          onScan={async (v) => {
            setScanMsg(null);
            const c = await findCopy(orgId, fromBranchId, v);
            if (!c) return setScanMsg(lt.copyNotFound);
            if (c.status !== 'AVAILABLE') return setScanMsg(lt.notOnShelf(label(c.status)));
            setCopies((x) => (x.some((y) => y.id === c.id) ? x : [...x, c]));
          }}
        />
        {scanMsg && <Notice tone="warn">{scanMsg}</Notice>}
        <ul className="desk-list">
          {copies.map((c) => (
            <li key={c.id}>
              {c.bookTitle} <span className="mono small">{c.code}</span>
            </li>
          ))}
        </ul>
        <FormError error={error} />
        <DialogActions busy={busy} submitLabel={`${lt.dispatch} ${copies.length}`} onCancel={onClose} />
      </form>
    </Dialog>
  );
}

function ReceiveDialog({ orgId, transfer, onClose, onSaved }: { orgId: string; transfer: Transfer; onClose: () => void; onSaved: () => void }) {
  const pending = transfer.items.filter((i) => !i.received);
  const [items, setItems] = useState<{ barcode: string; code: string; title: string; condition: Condition; damaged: boolean }[]>([]);
  const [scanMsg, setScanMsg] = useState<string | null>(null);
  const { busy, error, submit } = useSubmit(async () => {
    await command('transfers-receive', { orgId, transferId: transfer.id, items: items.map(({ barcode, condition, damaged }) => ({ barcode, condition, damaged })) });
    onSaved();
    onClose();
  });
  return (
    <Dialog title={`${lt.receive} · ${transfer.itemCount} ${lt.items.toLowerCase()}`} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <ScanInput
          label={lt.scanToReturn.replace('returned', 'arriving')}
          onScan={(v) => {
            setScanMsg(null);
            const value = v.trim().toUpperCase();
            // Pre-printed barcodes can differ from copy codes; the server checks membership of the transfer.
            const line = pending.find((i) => i.code === value);
            if (items.some((x) => x.barcode === value || (line && x.code === line.code))) return setScanMsg(lt.alreadyStaged);
            setItems((x) => [...x, { barcode: value, code: line?.code ?? value, title: line?.bookTitle ?? '', condition: 'GOOD', damaged: false }]);
          }}
        />
        {scanMsg && <Notice tone="warn">{scanMsg}</Notice>}
        <ul className="desk-list">
          {items.map((it, idx) => (
            <li key={it.code}>
              <span>
                {it.title} <span className="mono small">{it.code}</span>
              </span>
              <span className="row">
                <select aria-label={lt.condition} value={it.condition} onChange={(e) => setItems((x) => x.map((y, j) => (j === idx ? { ...y, condition: e.target.value as Condition } : y)))}>
                  {CONDITIONS.map((c) => (
                    <option key={c} value={c}>
                      {label(c)}
                    </option>
                  ))}
                </select>
                <label className="check">
                  <input type="checkbox" checked={it.damaged} onChange={(e) => setItems((x) => x.map((y, j) => (j === idx ? { ...y, damaged: e.target.checked } : y)))} />
                  {lt.damaged}
                </label>
              </span>
            </li>
          ))}
        </ul>
        <p className="muted small">
          {lt.staged}: {items.length} / {pending.length}
        </p>
        <FormError error={error} />
        <DialogActions busy={busy || !items.length} submitLabel={lt.receive} onCancel={onClose} />
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
  const [cancelling, setCancelling] = useState<Transfer | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const manage = can(claims, 'books.transfer', orgId, branchId);
  return (
    <>
      <div className="page-header-row">
        <Tabs tabs={[{ value: 'in', label: lt.incoming }, { value: 'out', label: lt.outgoing }]} value={dir} onChange={setDir} />
        {manage && (
          <button type="button" className="btn btn-filled" onClick={() => setCreating(true)}>
            <Icon name="plus" /> {lt.newTransfer}
          </button>
        )}
      </div>
      {msg && <Notice tone="error">{msg}</Notice>}
      {list.loading ? (
        <SkeletonRows rows={3} />
      ) : !list.data?.length ? (
        <EmptyState icon="truck" title={lt.transfersEmpty} message="" />
      ) : (
        <div className="table-wrap">
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
                    <span className={`badge badge-${TONE[tr.status]}`}>{label(tr.status)}</span>
                  </td>
                  <td className="nowrap small">{day(tr.createdAt)}</td>
                  <td className="cell-actions">
                    {dir === 'in' && tr.status === 'IN_TRANSIT' && manage && (
                      <button type="button" className="btn btn-outlined" onClick={() => setReceiving(tr)}>
                        {lt.receive}
                      </button>
                    )}
                    {dir === 'out' && tr.status === 'DRAFT' && manage && (
                      <>
                        <button
                          type="button"
                          className="btn btn-outlined"
                          onClick={async () => {
                            setMsg(null);
                            try {
                              await command('transfers-dispatch', { orgId, transferId: tr.id });
                              list.reload();
                            } catch (e) {
                              setMsg(e instanceof ApiError ? e.message : t.errorGeneric);
                            }
                          }}
                        >
                          {lt.dispatch}
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
        </div>
      )}
      {creating && <NewTransferDialog orgId={orgId} fromBranchId={branchId} onClose={() => setCreating(false)} onSaved={() => { setDir('out'); list.reload(); }} />}
      {receiving && <ReceiveDialog orgId={orgId} transfer={receiving} onClose={() => setReceiving(null)} onSaved={list.reload} />}
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
      <NeedBranch>{(branchId) => org && <BranchTransfers orgId={org.id} branchId={branchId} />}</NeedBranch>
    </>
  );
}
