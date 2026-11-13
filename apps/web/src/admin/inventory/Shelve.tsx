import { type PointerEvent, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';

import { label } from '../../data/common';
import {
  type Copy,
  findCopy,
  listLocations,
  SHELVE_BATCH,
  shelveCopies,
  shelveGroups,
  unshelvedCopies,
  UNSHELVED_PAGE,
  usualShelf,
  usualShelfGroups,
} from '../../data/inventory';
import { useAsync } from '../../shared/useAsync';
import { paths } from '../../paths';
import { t } from '../../strings';
import { lt } from '../../strings/library';
import { EmptyState, ErrorState, SkeletonRows, TableWrap } from '../../shared/ui';
import { FormError, SelectField, useAction } from '../components/Dialog';
import { NeedBranch, Notice, ScanInput } from '../components/kit';
import { useWorkspace } from '../Workspace';
import { labelsLink } from './Inventory';

/** Copies that are in the building and may go on a shelf (as copies-shelve allows). */
const SHELVABLE = ['AVAILABLE', 'RESERVED', 'UNDER_INSPECTION', 'DAMAGED'];

/**
 * Collection → Shelve books: every copy at the branch that is available but
 * not on a shelf (new stock, returned books after inspection). A returned book
 * shows its usual shelf (the one it was issued from), and the ticked ones go
 * back to theirs in one step; the others are put on the shelf picked. Scanning
 * a copy ticks it, and also brings in a copy that is already shelved elsewhere,
 * to move it; scanning a shelf's code picks that shelf.
 *
 * The list is read once: what has been shelved is hidden here, not read again
 * shelf after shelf. The scan field keeps the keyboard, so a scanner never
 * types into the shelf list.
 */
function BranchShelving({ orgId, branchId }: { orgId: string; branchId: string }) {
  const waiting = useAsync(() => unshelvedCopies(orgId, branchId), [orgId, branchId]);
  const locations = useAsync(() => listLocations(orgId, branchId), [orgId, branchId]);
  const shelves = (locations.data ?? []).filter((l) => l.status === 'ACTIVE');
  const shelfIds = new Set(shelves.map((l) => l.id));
  const [shelf, setShelf] = useState('');
  const [extra, setExtra] = useState<Copy[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  // Shelved since the list was read.
  const [done, setDone] = useState<ReadonlySet<string>>(new Set());
  const [msg, setMsg] = useState<{ tone: 'ok' | 'warn'; text: string } | null>(null);
  const [focusSignal, setFocusSignal] = useState(0);
  const refocus = () => setFocusSignal((n) => n + 1);
  const { busy, pending, error, setError, run } = useAction();

  // A fresh list shows again what was hidden as shelved (a copy taken off its shelf again must show). Read again
  // for the same branch ("Check for more books", or after a save), it keeps the work in hand: the ticks on books
  // still listed, and the copies scanned in from other shelves. Another branch's list starts clean.
  const extraNow = useRef(extra);
  extraNow.current = extra;
  const listOf = useRef('');
  useEffect(() => {
    const scope = `${orgId}/${branchId}`;
    const same = listOf.current === scope;
    listOf.current = scope;
    const listed = new Set((waiting.data ?? []).map((c) => c.id));
    const scanned = same ? extraNow.current.filter((c) => !listed.has(c.id)) : [];
    const keep = new Set([...listed, ...scanned.map((c) => c.id)]);
    setExtra(scanned);
    setPicked((p) => (same ? p.filter((id) => keep.has(id)) : []));
    setDone(new Set());
  }, [waiting.data, orgId, branchId]);

  // Books with a usual shelf first, shelf by shelf, so the trolley can be read in the order of the shelves.
  const place = (c: Copy) => {
    const at = shelves.findIndex((l) => l.id === usualShelf(c, shelfIds));
    return at < 0 ? shelves.length : at;
  };
  const rows = [...extra, ...(waiting.data ?? []).filter((r) => !done.has(r.id)).sort((a, b) => place(a) - place(b))];
  const truncated = (waiting.data?.length ?? 0) >= UNSHELVED_PAGE;
  // A save ends against the list as it is then: books may have been scanned in while it ran.
  const latest = useRef({ rows, truncated });
  latest.current = { rows, truncated };

  const shelfOf = (id: string | null) => locations.data?.find((x) => x.id === id);
  const shelfName = (id: string | null) => {
    const l = shelfOf(id);
    return l ? `${l.code} · ${l.label}` : '—';
  };
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const ticked = rows.filter((r) => picked.includes(r.id));
  const allPicked = rows.length > 0 && ticked.length === rows.length;
  const usualGroups = usualShelfGroups(ticked, shelfIds);
  const usualCount = usualGroups.reduce((n, g) => n + g.copyIds.length, 0);
  const anyUsual = rows.some((r) => usualShelf(r, shelfIds));

  const onScan = async (value: string) => {
    setMsg(null);
    const v = value.trim().toUpperCase();
    const known = rows.find((r) => r.barcode === v || r.code === v);
    if (known) {
      setPicked((p) => (p.includes(known.id) ? p : [...p, known.id]));
      return;
    }
    // A book in the list is matched first, then a shelf, so a listed book is never read as a shelf.
    const s = shelves.find((l) => l.code === v);
    if (s) {
      setShelf(s.id);
      return setMsg({ tone: 'ok', text: lt.shelveShelfSet(`${s.code} · ${s.label}`) });
    }
    const c = await findCopy(orgId, branchId, v);
    if (!c) return setMsg({ tone: 'warn', text: lt.shelveNotHere(v) });
    if (!SHELVABLE.includes(c.status)) return setMsg({ tone: 'warn', text: lt.shelveCantShelve(c.code, label(c.status)) });
    setExtra((x) => (x.some((e) => e.id === c.id) ? x : [c, ...x]));
    setPicked((p) => (p.includes(c.id) ? p : [...p, c.id]));
    if (c.locationId) setMsg({ tone: 'ok', text: lt.shelveScannedOther(c.code, shelfName(c.locationId)) });
  };

  /**
   * After a save: hides what went on a shelf and keeps every other tick (books can be scanned while it runs).
   * The list is read again only when it can't be trusted as it is: it was cut at the page size, nothing is
   * left to show (so "every book is on a shelf" is said only once it is true), or `unsure`.
   */
  const settle = (ids: string[], unsure: boolean) => {
    const gone = new Set(ids);
    setDone((d) => new Set([...d, ...gone]));
    setExtra((x) => x.filter((c) => !gone.has(c.id)));
    setPicked((p) => p.filter((id) => !gone.has(id)));
    if (unsure || latest.current.truncated || latest.current.rows.every((r) => gone.has(r.id))) waiting.reload();
  };

  const shelveOnPicked = () =>
    run(async () => {
      setMsg(null);
      const ids = ticked.map((r) => r.id);
      try {
        await shelveCopies(orgId, branchId, shelf, ids);
      } catch (e) {
        // Sent a hundred at a time: the earlier hundreds may be on the shelf already. A single refused call
        // changed nothing, and the ticks are needed to put it right.
        if (ids.length > SHELVE_BATCH) waiting.reload();
        throw e;
      }
      setMsg({ tone: 'ok', text: lt.shelveDone(ids.length, shelfName(shelf)) });
      settle(ids, false);
    }, 'shelf').then(refocus);

  const putBack = () =>
    run(async () => {
      setMsg(null);
      const results = await shelveGroups(orgId, branchId, usualGroups);
      const back = results.filter((r) => !r.error);
      const refused = results.filter((r) => r.error);
      const ids = back.flatMap((r) => r.copyIds);
      // The rows go once shelved, so the notice says which shelf got how many.
      const where = back.length === 1 ? [shelfName(back[0].locationId)] : back.map((r) => `${shelfOf(r.locationId)?.code ?? '—'} (${r.copyIds.length})`);
      if (ids.length) setMsg({ tone: 'ok', text: lt.shelveBackDone(ids.length, where) });
      if (refused.length) setError(refused.map((r) => lt.shelveBackFailed(shelfName(r.locationId), r.error ?? '')).join(' '));
      settle(ids, refused.some((r) => r.copyIds.length > SHELVE_BATCH));
    }, 'usual').then(refocus);

  // While the list is being read again, a save waits: one that finished first would be undone on screen when the
  // older read landed, showing the books just shelved as not on a shelf.
  const saveHeld = busy || waiting.refreshing;

  // A pick made with the mouse hands the keyboard back to the scan field. One made with the keyboard does not:
  // a closed list changes on every arrow key, and focus must stay on it.
  const byMouse = useRef(false);

  if (waiting.error) return <ErrorState message={waiting.error} onRetry={waiting.reload} />;
  if (waiting.loading || locations.loading) return <SkeletonRows rows={5} />;

  return (
    <>
      {shelves.length === 0 ? (
        <Notice tone="warn">
          {lt.shelveNoShelves} <Link to={paths.adminInventory}>{lt.inventoryTitle}</Link>
        </Notice>
      ) : (
        <div className="card shelve-bar">
          <div
            onPointerDownCapture={(e: PointerEvent<HTMLDivElement>) => {
              // No scanner's keys follow a finger or a pen, and focus on the field there brings up the on-screen keyboard.
              byMouse.current = e.pointerType !== 'touch' && e.pointerType !== 'pen';
            }}
            onKeyDownCapture={() => {
              byMouse.current = false;
            }}
          >
            <SelectField
              label={lt.shelveShelf}
              value={shelf}
              onChange={(id) => {
                setShelf(id);
                if (byMouse.current) refocus();
              }}
              options={[{ value: '', label: lt.shelvePickShelf }, ...shelves.map((l) => ({ value: l.id, label: `${l.code} · ${l.label}` }))]}
            />
          </div>
          <ScanInput label={lt.shelveScan} onScan={onScan} autoFocus focusSignal={focusSignal} />
          <FormError error={error} />
          <div className="row">
            {anyUsual && (
              <button type="button" className="btn btn-filled" disabled={saveHeld || usualCount === 0} onClick={() => void putBack()}>
                {pending === 'usual' ? t.saving : lt.shelveBack(usualCount)}
              </button>
            )}
            <button
              type="button"
              className={`btn ${anyUsual ? 'btn-outlined' : 'btn-filled'}`}
              disabled={saveHeld || !shelf || ticked.length === 0}
              onClick={() => void shelveOnPicked()}
            >
              {pending === 'shelf' ? t.saving : lt.shelveSubmit(ticked.length, shelfOf(shelf)?.code)}
            </button>
            {/* A label that was lost or never printed: no shelf is needed for this. */}
            {ticked.length > 0 && (
              <Link className="btn btn-text" {...labelsLink(ticked.map((c) => ({ id: c.id, barcode: c.barcode, title: c.bookTitle })))}>
                {lt.shelveLabels(ticked.length)}
              </Link>
            )}
          </div>
        </div>
      )}
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}

      {rows.length > 0 ? (
        <>
          <TableWrap>
            <table className="table">
              <thead>
                <tr>
                  <th scope="col" className="check-col">
                    <input
                      type="checkbox"
                      aria-label={lt.shelveSelectAll}
                      checked={allPicked}
                      onChange={() => setPicked(allPicked ? [] : rows.map((r) => r.id))}
                    />
                  </th>
                  <th scope="col">{lt.copy}</th>
                  <th scope="col">{lt.title}</th>
                  <th scope="col">{lt.condition}</th>
                  <th scope="col">{lt.shelveUsual}</th>
                  <th scope="col">{lt.location}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => {
                  const usual = usualShelf(c, shelfIds);
                  return (
                    <tr key={c.id} className={picked.includes(c.id) ? 'row-selected' : undefined}>
                      <td className="check-col">
                        <input type="checkbox" aria-label={lt.shelveSelectRow(c.code)} checked={picked.includes(c.id)} onChange={() => toggle(c.id)} />
                      </td>
                      <td className="nowrap">
                        <Link to={paths.adminCopy(c.id)} state={{ copy: c }} className="mono">
                          {c.code}
                        </Link>
                      </td>
                      <td>{c.bookTitle}</td>
                      <td>{label(c.condition)}</td>
                      <td className={usual ? 'mono' : 'muted'}>{usual ? shelfName(usual) : lt.shelveNoUsual}</td>
                      <td className={c.locationId ? 'mono' : 'muted'}>{c.locationId ? shelfName(c.locationId) : lt.unshelved}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
          {truncated && <p className="muted">{lt.shelveMore(UNSHELVED_PAGE)}</p>}
        </>
      ) : waiting.refreshing ? (
        <SkeletonRows rows={3} />
      ) : (
        <EmptyState icon="check" title={lt.shelveEmpty} message="" />
      )}
      {/* Books inspected while the page is open only show after a fresh read. */}
      <div className="row">
        <button
          type="button"
          className="btn btn-text"
          disabled={busy || waiting.refreshing}
          onClick={() => {
            waiting.reload();
            refocus();
          }}
        >
          {waiting.refreshing ? t.loading : lt.shelveRefresh}
        </button>
      </div>
    </>
  );
}

export function ShelvePage() {
  const { org } = useWorkspace();
  return (
    <>
      <p className="breadcrumb">
        <Link to={paths.adminInventory}>{lt.inventoryTitle}</Link> / {lt.shelveTitle}
      </p>
      <header className="page-header">
        <h1>{lt.shelveTitle}</h1>
        <p className="muted">{lt.shelveIntro}</p>
      </header>
      <NeedBranch>{(branchId) => org && <BranchShelving orgId={org.id} branchId={branchId} />}</NeedBranch>
    </>
  );
}
