// Receive books: what was received on the page, its label links, and sending it on to other branches without
// scanning every copy again (BulkAddBooks.tsx).
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';

import { ApiError, errorText } from '../../data/api';
import { assignCopies, type SendPlan, sendToBranch, transferLoads } from '../../data/bulkBooks';
import { getCopy } from '../../data/inventory';
import { TableWrap } from '../../shared/ui';
import { t } from '../../strings';
import { lt } from '../../strings/library';
import { Notice } from '../components/kit';
import { labelsLink } from '../inventory/Inventory';

/** A copy received on this page. Its label carries its code (copies-receive makes the barcode from it). */
export interface ReceivedCopy {
  id: string;
  code: string;
  bookId: string;
  title: string;
  /** The branch it was received at. */
  branchId: string;
  /** The branch it has been sent on to. */
  to?: string;
  /** It can't be sent on: it is held for a member waiting here, or is no longer on the shelf. */
  kept?: boolean;
  /** It may be held for a waiting member (the delivery served some): read before it is offered for sending. */
  unsure?: boolean;
}

/**
 * "Print labels" for what was received: one link for everything, or, once copies have been sent on, one per
 * branch they went to and one for the books staying. The books of a title are alike until labelled, so each
 * pile must get the labels of the copies that were sent there.
 */
export function ReceivedLabels({ copies, branchName }: { copies: ReceivedCopy[]; branchName: (id: string) => string }) {
  if (!copies.length) return null;
  const link = (list: ReceivedCopy[], text: string) => (
    <Link className="btn btn-outlined" {...labelsLink(list.map((c) => ({ id: c.id, barcode: c.code, title: c.title })))}>
      {text}
    </Link>
  );
  const sentTo = [...new Set(copies.flatMap((c) => (c.to ? [c.to] : [])))];
  const staying = copies.filter((c) => !c.to);
  return (
    <div className="row">
      {sentTo.length === 0 ? (
        link(copies, lt.receiveLabels(copies.length))
      ) : (
        <>
          {sentTo.map((to) => {
            const list = copies.filter((c) => c.to === to);
            return <span key={to}>{link(list, lt.receiveLabelsFor(list.length, branchName(to)))}</span>;
          })}
          {staying.length > 0 && link(staying, lt.receiveLabelsHere(staying.length))}
        </>
      )}
    </div>
  );
}

/**
 * Sends copies just received on to other branches: a number per title and branch, then one transfer per branch
 * (several when a branch gets more than a transfer takes), each created already on its way. The receiving branch
 * still scans every book in, which is the check that the right books arrived.
 *
 * `copies` are the ones received at this branch; `update` changes the page's list (a copy sent, or found to be
 * held or gone).
 */
export function SendToBranches({
  orgId,
  branchId,
  targets,
  copies,
  update,
}: {
  orgId: string;
  branchId: string;
  targets: { id: string; name: string }[];
  copies: ReceivedCopy[];
  update: (change: (all: ReceivedCopy[]) => ReceivedCopy[]) => void;
}) {
  const [open, setOpen] = useState(false);
  /** What is typed in each cell: `[bookId][branchId]`. */
  const [plan, setPlan] = useState<Record<string, Record<string, string>>>({});
  const [check, setCheck] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });
  const [recheck, setRecheck] = useState(0);
  const [sending, setSending] = useState<string | null>(null);
  const running = useRef(false);
  const [results, setResults] = useState<{ branchId: string; sent: number; error?: string }[]>([]);
  const [gone, setGone] = useState(0);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const nameOf = (id: string) => targets.find((b) => b.id === id)?.name ?? id;

  /** Reads the copies and marks those that can't be sent (not on this branch's shelf any more); returns how many. */
  const readStatus = async (which: ReceivedCopy[]): Promise<number> => {
    const read = await Promise.all(which.map((c) => getCopy(orgId, c.id)));
    const asked = new Set(which.map((c) => c.id));
    const off = new Set(which.filter((_, i) => read[i]?.status !== 'AVAILABLE' || read[i]?.currentBranchId !== branchId).map((c) => c.id));
    update((all) => all.map((c) => (asked.has(c.id) ? { ...c, unsure: false, kept: c.kept || off.has(c.id) } : c)));
    return off.size;
  };

  // Copies that may be held for a waiting member are read before they are offered (also those of a delivery
  // received while this is open).
  const unsure = open ? copies.filter((c) => c.unsure && !c.to) : [];
  const unsureKey = unsure.map((c) => c.id).join(',');
  useEffect(() => {
    if (!unsureKey) return;
    let current = true;
    setCheck({ busy: true, error: null });
    readStatus(unsure).then(
      () => current && setCheck({ busy: false, error: null }),
      (e: unknown) => current && setCheck({ busy: false, error: errorText(e, t.errorLoad) }),
    );
    return () => {
      current = false;
      // A check given up half-way (the panel was closed) must not leave "Checking…" up when it is opened again.
      setCheck((c) => (c.busy ? { busy: false, error: null } : c));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unsureKey, recheck]);

  // One row per title, in the order received.
  const lines = [...new Map(copies.map((c) => [c.bookId, c.title]))].map(([bookId, title]) => {
    const mine = copies.filter((c) => c.bookId === bookId);
    return { bookId, title, kept: mine.filter((c) => c.kept && !c.to).length, free: mine.filter((c) => !c.to && !c.kept) };
  });
  const typed = (bookId: string, to: string) => (plan[bookId]?.[to] ?? '').trim();
  const numberOf = (bookId: string, to: string) => {
    const v = typed(bookId, to);
    return v === '' ? 0 : /^\d+$/.test(v) ? Number(v) : NaN;
  };
  const rows = lines.map((l) => {
    const asked = targets.reduce((n, b) => n + numberOf(l.bookId, b.id), 0);
    return { ...l, asked, wrong: Number.isNaN(asked), over: asked > l.free.length };
  });
  const total = rows.reduce((n, r) => n + (r.asked || 0), 0);
  const anyFree = rows.some((r) => r.free.length > 0);
  const held = check.busy || !!check.error || sending !== null;
  const ready = !held && total > 0 && rows.every((r) => !r.wrong && !r.over);

  const send = async () => {
    if (!ready || running.current) return;
    running.current = true;
    setResults([]);
    setGone(0);
    const numbers: SendPlan = Object.fromEntries(rows.map((r) => [r.bookId, Object.fromEntries(targets.map((b) => [b.id, numberOf(r.bookId, b.id)]))]));
    const loads = assignCopies(rows.map((r) => ({ bookId: r.bookId, title: r.title, copies: r.free })), targets.map((b) => b.id), numbers);
    const out: { branchId: string; sent: number; error?: string }[] = [];
    const sentIds = new Set<string>();
    let taken = false;
    try {
      for (const to of loads) {
        // The page was cleared or left: nothing more is started.
        if (!live.current) return;
        setSending(nameOf(to.branchId));
        const result: (typeof out)[number] = { branchId: to.branchId, sent: 0 };
        try {
          for (const load of transferLoads(to.copies)) {
            await sendToBranch(orgId, branchId, to.branchId, load.map((c) => c.id));
            result.sent += load.length;
            for (const c of load) sentIds.add(c.id);
            update((all) => all.map((c) => (sentIds.has(c.id) && !c.to ? { ...c, to: to.branchId } : c)));
            // What is left to send of each cell: a branch that failed part-way is sent only its rest next time.
            setPlan((p) => {
              const next = { ...p };
              for (const c of load) {
                const left = Number(next[c.bookId]?.[to.branchId] ?? 0) - 1;
                next[c.bookId] = { ...next[c.bookId], [to.branchId]: left > 0 ? String(left) : '' };
              }
              return next;
            });
          }
        } catch (e) {
          result.error = errorText(e);
          // A copy was taken meanwhile (held for a member, issued at the desk): the transfer was refused whole.
          if (e instanceof ApiError && e.reason === 'COPY_NOT_AVAILABLE') taken = true;
        }
        out.push(result);
        setResults([...out]);
      }
      if (taken && live.current) {
        // Find which copies went, so the others can be sent in their place.
        const left = copies.filter((c) => !c.to && !c.kept && !sentIds.has(c.id));
        setGone(await readStatus(left).catch(() => 0));
      }
    } finally {
      running.current = false;
      setSending(null);
    }
  };

  return (
    <section className="section">
      <button type="button" className="btn btn-outlined" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {lt.sendTitle}
      </button>
      {open && (
        <div className="card">
          <p className="muted">{lt.sendIntro}</p>
          {check.busy ? (
            <p className="muted" role="status">
              {lt.sendChecking}
            </p>
          ) : check.error ? (
            <p className="form-error" role="alert">
              {check.error}{' '}
              <button type="button" className="btn btn-text" onClick={() => setRecheck((n) => n + 1)}>
                {t.retry}
              </button>
            </p>
          ) : !anyFree ? (
            <p className="muted">{lt.sendNothing}</p>
          ) : (
            <>
              <TableWrap>
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">{lt.sendBook}</th>
                      <th scope="col" className="num">
                        {lt.sendCanGo}
                      </th>
                      {targets.map((b) => (
                        <th key={b.id} scope="col">
                          {b.name}
                        </th>
                      ))}
                      <th scope="col" className="num">
                        {lt.sendStays}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.bookId}>
                        <td>
                          {r.title}
                          {r.kept > 0 && <div className="small muted">{lt.sendKept(r.kept)}</div>}
                          {r.wrong ? <div className="field-error">{lt.sendWhole}</div> : r.over && <div className="field-error">{lt.sendOver(r.free.length)}</div>}
                        </td>
                        <td className="num">{r.free.length}</td>
                        {targets.map((b) => (
                          <td key={b.id}>
                            <input
                              className="receive-num"
                              inputMode="numeric"
                              placeholder="0"
                              value={plan[r.bookId]?.[b.id] ?? ''}
                              disabled={sending !== null || r.free.length === 0}
                              aria-label={lt.sendCell(r.title, b.name)}
                              aria-invalid={r.wrong || r.over}
                              onChange={(e) => setPlan((p) => ({ ...p, [r.bookId]: { ...p[r.bookId], [b.id]: e.target.value } }))}
                            />
                          </td>
                        ))}
                        <td className="num">{r.wrong ? '' : Math.max(0, r.free.length - r.asked) + r.kept}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
              <div className="row">
                <button type="button" className="btn btn-filled" disabled={!ready} onClick={() => void send()}>
                  {sending !== null ? lt.sendSaving(sending) : lt.sendSubmit(total)}
                </button>
              </div>
            </>
          )}
          {results.map((r) => (
            <div key={r.branchId}>
              {r.sent > 0 && <Notice tone="ok">{lt.sendDone(r.sent, nameOf(r.branchId))}</Notice>}
              {r.error && (
                <p className="form-error" role="alert">
                  {lt.sendFailed(nameOf(r.branchId), r.error)}
                </p>
              )}
            </div>
          ))}
          {gone > 0 && <Notice tone="warn">{lt.sendGone(gone)}</Notice>}
        </div>
      )}
    </section>
  );
}
