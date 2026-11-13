// Operations → Collection → Receive books: a delivery (or just new titles) at once. Each row is checked as it is typed
// or scanned and looked up; staff who look after copies at the branch also set how many copies arrived, and one
// submit adds the new titles to the catalogue and every copy to the branch (copies-receive). Catalogue managers
// without a branch get the titles-only version (books-bulkCreate).
//
// The page opens with the cursor in the first ISBN field and puts it in the next empty row after a delivery, so
// carton after carton is scanned without the mouse. Covers of new titles are fetched behind the scenes, and what
// was received stays listed (labels, sending on to other branches) until "Clear list".
import { useEffect, useRef, useState } from 'react';

import { useAuth } from '../../auth/AuthContext';
import { can } from '../../auth/claims';
import { errorText } from '../../data/api';
import {
  bulkCreateBooks,
  type BulkItem,
  type BulkResult,
  type ChunkRange,
  coverProgress,
  onCoverProgress,
  queueCovers,
  type ReceiveItem,
  type ReceiveResult,
  receiveStock,
} from '../../data/bulkBooks';
import { newTitleDefaults, type NewTitleDefaults } from '../../data/catalogue';
import { AGE_GROUPS, type AgeGroup, CONDITIONS, type Condition, GENRES, type Genre, label, LANGUAGES, READING_LEVELS } from '../../data/common';
import { listLocations } from '../../data/inventory';
import { normalizeIsbn } from '../../shared/isbn';
import { toMinor } from '../../shared/format';
import { oneOf, remember } from '../../shared/remember';
import { EmptyState, Icon, TableWrap } from '../../shared/ui';
import { useAsync } from '../../shared/useAsync';
import { t } from '../../strings';
import { lt } from '../../strings/library';
import { CameraScanner } from '../components/CameraScanner';
import { FormError } from '../components/Dialog';
import { Notice } from '../components/kit';
import { useCanAddBooks } from './Catalogue';
import { useWorkspace } from '../Workspace';
import { BulkRow, type Level, typedIn, useBulkRows, whole } from './bulkRows';
import { type ReceivedCopy, ReceivedLabels, SendToBranches } from './ReceiveSend';

export function BulkAddBooksPage() {
  const canAdd = useCanAddBooks();
  const { claims } = useAuth();
  const { org, branch, branches, branchName } = useWorkspace();
  // Receiving: staff who look after copies at the branch in use. Otherwise titles only (catalogue managers).
  const receiving = !!org && !!branch && can(claims, 'copies.manage', org.id, branch.id);
  // The branch being received at. The shelves are read with it: after a switch of branch, the list still held
  // is the other branch's until the new one lands.
  const at = receiving && org && branch ? `${org.id}/${branch.id}` : '';
  const locations = useAsync(async () => ({ at, list: receiving && org && branch ? await listLocations(org.id, branch.id) : [] }), [at]);
  const shelves = at && locations.data?.at === at ? locations.data.list : null;
  const activeShelves = (shelves ?? []).filter((l) => l.status === 'ACTIVE');
  const [notice, setNotice] = useState<string | null>(null);
  const [delivery, setDelivery] = useState<{ locationId: string; condition: Condition; price: string }>({ locationId: '', condition: 'NEW', price: '' });
  // The shelf this branch last received onto is offered again (the condition and the price are not: a stale one
  // would be written to every copy). It is stored when it is picked, and applied once per branch, when that
  // branch's shelves have been read and only if the shelf is still in use.
  const shelfKey = remember.key('receiveShelf', org?.id ?? '', branch?.id ?? '');
  const shelfFor = useRef('');
  useEffect(() => {
    if (!at || shelfFor.current === at) return;
    if (!shelves) return setDelivery((d) => (d.locationId ? { ...d, locationId: '' } : d));
    shelfFor.current = at;
    const ids = shelves.filter((l) => l.status === 'ACTIVE').map((l) => l.id);
    setDelivery((d) => ({ ...d, locationId: remember.get(shelfKey, '', oneOf(ids)) }));
  }, [at, shelves, shelfKey]);
  /** Every copy received on this page since it was opened or cleared: for the labels, and for sending on. */
  const [received, setReceived] = useState<ReceivedCopy[]>([]);
  // Kept for this browser tab, so the list (and its label links, one per branch) is still here after printing a
  // sheet and coming back. Copies not yet sent on are read again before they are offered for sending.
  const keptKey = org ? `stories.received.${org.id}` : '';
  const kept = useRef({ key: '', restored: false });
  useEffect(() => {
    if (!keptKey || kept.current.key === keptKey) return;
    kept.current = { key: keptKey, restored: false };
    try {
      const list: unknown = JSON.parse(sessionStorage.getItem(keptKey) ?? 'null');
      const ok = (c: unknown): c is ReceivedCopy =>
        !!c && typeof c === 'object' && ['id', 'code', 'title', 'bookId', 'branchId'].every((k) => typeof (c as Record<string, unknown>)[k] === 'string');
      if (Array.isArray(list) && list.length && list.every(ok)) {
        kept.current.restored = true;
        setReceived((now) => (now.length ? now : list.map((c) => (c.to ? c : { ...c, unsure: true }))));
      }
    } catch {
      /* nothing kept, or storage unavailable */
    }
  }, [keptKey]);
  useEffect(() => {
    if (!keptKey || kept.current.key !== keptKey) return;
    if (kept.current.restored) {
      kept.current.restored = false; // this run still sees the list from before the restore
      return;
    }
    try {
      if (received.length) sessionStorage.setItem(keptKey, JSON.stringify(received));
      else sessionStorage.removeItem(keptKey);
    } catch {
      /* storage unavailable: the list just isn't kept */
    }
  }, [keptKey, received]);
  // What a new title starts as: the choices last made in this browser (shared with the New book form).
  const [defaults, setDefaults] = useState<NewTitleDefaults>(() => newTitleDefaults.get());
  const choose = (change: Partial<NewTitleDefaults>) => {
    setDefaults((d) => ({ ...d, ...change }));
    newTitleDefaults.set(change);
  };
  const bulk = useBulkRows({ canAdd, receiving, defaults, onNotice: setNotice });
  const { rows, setRows } = bulk;
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [camera, setCamera] = useState(false);
  // Covers still being fetched (data/bulkBooks.ts): they don't hold the page, and the count is the queue's own,
  // so it is right again when the page is opened while they run.
  const [covers, setCovers] = useState(coverProgress);
  useEffect(() => {
    setCovers(coverProgress());
    return onCoverProgress(setCovers);
  }, []);
  // One requestId per group of rows sent together, kept until that call is known to have
  // gone through: a retry of the same rows after an unknown outcome can't add them twice.
  const requestIds = useRef(new Map<string, string>());
  const requestIdFor = (keys: number[]) => {
    const k = keys.join(',');
    let id = requestIds.current.get(k);
    if (!id) requestIds.current.set(k, (id = crypto.randomUUID()));
    return id;
  };

  // What each row shows and whether it can be added.
  const defaultPrice = delivery.price.trim() ? toMinor(delivery.price) : 0;
  const view = rows.map((r, i) => {
    const isbn = normalizeIsbn(r.raw);
    // Rows already added don't count: the same title can arrive again in the next carton.
    const repeatOf = isbn && r.state !== 'added' ? rows.findIndex((o, j) => j < i && o.state !== 'added' && normalizeIsbn(o.raw) === isbn) : -1;
    // Unknown to the public catalogues, or they can't be reached: the title and author can be typed in.
    const manual = (r.state === 'notFound' || r.state === 'error') && canAdd;
    const needsAuthor = (r.state === 'found' && !r.candidate?.authors.length) || manual;
    const newTitle = r.state === 'found' || manual;
    const titleOk = r.state === 'found' ? !needsAuthor || r.author.trim().length >= 2 : manual && r.title.trim().length >= 1 && r.author.trim().length >= 2;
    const quantityOk = !receiving || (whole(r.quantity) && Number(r.quantity) >= 1 && Number(r.quantity) <= 50);
    const price = r.price.trim() ? toMinor(r.price) : defaultPrice;
    const priceOk = !receiving || (Number.isFinite(price) && price >= 0);
    const titleReady = newTitle ? canAdd && titleOk : receiving && r.state === 'exists';
    const ready = titleReady && repeatOf === -1 && quantityOk && priceOk;
    const invalid = !!r.raw.trim() && !isbn && r.touched;
    return { r, n: i + 1, isbn, repeatOf, needsAuthor, manual, ready, invalid, quantityOk, priceOk, price, newTitle };
  });
  const ready = view.filter((v) => v.ready);
  const readyCopies = ready.reduce((n, v) => n + Number(v.r.quantity), 0);
  const known = receiving ? 0 : view.filter((v) => v.r.state === 'exists' && v.repeatOf === -1).length;
  const attention = view.filter((v) => v.r.raw.trim() && !v.ready && !['added', 'skipped', 'checking', 'idle', ...(receiving ? [] : ['exists'])].includes(v.r.state)).length + view.filter((v) => v.invalid || (!receiving && v.repeatOf !== -1)).length;

  /** A new title as the server takes it (looked up, or typed in for an unknown ISBN). */
  const bookOf = ({ r, isbn }: (typeof view)[number]): BulkItem => {
    const c = r.candidate;
    return {
      isbn: isbn!,
      title: c?.title ?? r.title.trim(),
      subtitle: c?.subtitle ?? '',
      authors: c?.authors.length ? c.authors : [r.author.trim()],
      publisher: c?.publisher ?? null,
      language: c?.language && c.language in LANGUAGES ? c.language : 'en',
      genres: [r.genre],
      ageGroup: r.ageGroup,
      readingLevel: defaults.readingLevel,
      publicationYear: c?.year ?? null,
      synopsis: c?.synopsis ?? '',
    };
  };

  /** Hands the covers of the titles just made to the queue. From the rows as they were sent: once the page is free, rows can change. */
  const addCovers = (sent: typeof ready, made: { bookId: string; isbn: string }[]) =>
    queueCovers(
      made.flatMap((c) => {
        const url = sent.find((v) => v.isbn === c.isbn)?.r.candidate?.coverUrl;
        return url ? [{ bookId: c.bookId, url }] : [];
      }),
    );

  const receive = async () => {
    if (!ready.length || busy || !org || !branch) return;
    setError(null);
    setNotice(null);
    const sent = ready;
    const here = branch.id;
    const items: ReceiveItem[] = sent.map((v) => ({
      ...(v.r.state === 'exists' ? { bookId: v.r.bookId! } : { book: bookOf(v) }),
      quantity: Number(v.r.quantity),
      acquisitionCostMinor: v.price,
    }));
    const keysOf = (range: ChunkRange) => sent.slice(range.start, range.end).map((v) => v.r.key);
    const priceOf = new Map(sent.map((v) => [v.r.key, v.price]));
    // What has been received so far: every call that went through, even if a later one fails.
    const got: ReceiveResult = { received: [], newTitles: [], copies: 0, allocated: 0 };
    let done = 0;
    const committed = (res: ReceiveResult, range: ChunkRange) => {
      const keys = keysOf(range);
      requestIds.current.delete(keys.join(','));
      got.received.push(...res.received);
      got.newTitles.push(...res.newTitles);
      got.copies += res.copies;
      got.allocated += res.allocated;
      done += keys.length;
      setBusy(lt.receiveSaving(done, items.length));
      // Kept across calls and deliveries (a retry after a failure adds to what the first calls received).
      const arrived = res.received.flatMap((r) =>
        r.copyIds.map((id, k): ReceivedCopy => ({
          id, code: r.codes[k], bookId: r.bookId, title: r.title, branchId: here,
          // Members waiting here get the first copies of a title. Nobody waits for a title that is new, or when
          // the call served no one; otherwise, unless the answer says how many, the copy is read before it is sent on.
          kept: r.held !== undefined && k < r.held,
          unsure: r.held === undefined && res.allocated > 0 && !r.isNew,
        })),
      );
      setReceived((all) => {
        const known = new Set(all.map((c) => c.id));
        return [...all, ...arrived.filter((c) => !known.has(c.id))];
      });
      const newByIsbn = new Map(res.newTitles.map((n) => [n.isbn, n]));
      const byBook = new Map(res.received.map((r) => [r.bookId, r]));
      setRows((rs) =>
        rs.map((r) => {
          if (!keys.includes(r.key)) return r;
          const made = newByIsbn.get(normalizeIsbn(r.raw) ?? '');
          const bookId = made?.bookId ?? r.bookId;
          const arrived = bookId ? byBook.get(bookId) : undefined;
          return arrived ? { ...r, state: 'added', bookId, code: made?.code ?? null, copies: arrived.codes, pricePaid: priceOf.get(r.key) ?? null, candidate: r.candidate ?? typedIn(r) } : r;
        }),
      );
    };
    let failed = false;
    try {
      setBusy(lt.receiveSaving(0, items.length));
      await receiveStock({ orgId: org.id, branchId: branch.id, locationId: delivery.locationId || null, condition: delivery.condition }, items, {
        onChunk: committed,
        requestId: (range) => requestIdFor(keysOf(range)),
      });
    } catch (e) {
      failed = true;
      setError(errorText(e));
    }
    // What went through is shown at once, also when a later call failed; the covers follow on their own.
    if (got.copies || got.newTitles.length) {
      setNotice(lt.receiveDone(got.copies, got.received.length, got.newTitles.length, got.allocated));
      addCovers(sent, got.newTitles);
    }
    setBusy(null);
    // Ready for the next carton (in the same update as the fields coming free). After a failure the message and
    // the button to try again matter more.
    if (!failed) bulk.focusFirstEmpty();
  };

  const submit = async () => {
    if (!ready.length || busy) return;
    setError(null);
    setNotice(null);
    const sent = ready;
    const items: BulkItem[] = sent.map(bookOf);
    const keysOf = (range: ChunkRange) => sent.slice(range.start, range.end).map((v) => v.r.key);
    const got: BulkResult = { created: [], skipped: [] };
    let done = 0;
    const committed = (res: BulkResult, range: ChunkRange) => {
      const keys = keysOf(range);
      requestIds.current.delete(keys.join(','));
      got.created.push(...res.created);
      got.skipped.push(...res.skipped);
      done += keys.length;
      setBusy(lt.bulkSaving(done, items.length));
      const byIsbn = new Map(res.created.map((c) => [c.isbn, c]));
      const skippedBy = new Map(res.skipped.map((x) => [x.isbn, x]));
      setRows((rs) =>
        rs.map((r) => {
          if (!keys.includes(r.key)) return r;
          const isbn = normalizeIsbn(r.raw);
          const made = isbn ? byIsbn.get(isbn) : undefined;
          if (made) return { ...r, state: 'added', code: made.code, bookId: made.bookId, candidate: r.candidate ?? typedIn(r) };
          const skip = isbn ? skippedBy.get(isbn) : undefined;
          return skip ? { ...r, state: 'skipped', message: skip.reason } : r;
        }),
      );
    };
    let failed = false;
    try {
      setBusy(lt.bulkSaving(0, items.length));
      await bulkCreateBooks(items, { onChunk: committed, requestId: (range) => requestIdFor(keysOf(range)) });
    } catch (e) {
      failed = true;
      setError(errorText(e));
    }
    if (got.created.length || got.skipped.length) {
      setNotice(`${lt.bulkDone(got.created.length, got.skipped.length)} ${lt.bulkNextStep}`);
      addCovers(sent, got.created);
    }
    setBusy(null);
    if (!failed) bulk.focusFirstEmpty();
  };

  const firstOpen = rows.find((r) => r.state !== 'added')?.key;
  const shelf = activeShelves.find((l) => l.id === delivery.locationId);
  const summary = receiving ? lt.receiveSummary(ready.length, readyCopies, attention) : lt.bulkSummary(ready.length, attention, known);
  // Sending on: for staff who may transfer from this branch, when there is another open branch to send to.
  const targets = (branches ?? []).filter((b) => b.status === 'ACTIVE' && b.id !== branch?.id);
  const receivedHere = received.filter((c) => c.branchId === branch?.id);
  const canSend = receiving && !!org && !!branch && can(claims, 'books.transfer', org.id, branch.id) && targets.length > 0 && receivedHere.length > 0;

  if (!canAdd && !receiving) return <EmptyState page icon="book" title={t.noAccessTitle} message={t.noAccessMessage} />;

  return (
    <>
      <header className="page-header">
        <h1>{receiving ? lt.receiveTitle : lt.bulkTitle}</h1>
        <p className="muted">{receiving ? lt.receiveIntro(branch?.name ?? '', canAdd) : lt.bulkIntro}</p>
      </header>

      {receiving && (
        <fieldset className="choices bulk-defaults">
          <legend>{lt.receiveDelivery}</legend>
          <div className="row">
            <label className="field-inline">
              {lt.location}
              <select
                value={delivery.locationId}
                onChange={(e) => {
                  const locationId = e.target.value;
                  setDelivery((d) => ({ ...d, locationId }));
                  remember.set(shelfKey, locationId || undefined);
                }}
              >
                <option value="">{lt.noLocation}</option>
                {activeShelves.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.code} · {l.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field-inline">
              {lt.condition}
              <select value={delivery.condition} onChange={(e) => setDelivery((d) => ({ ...d, condition: e.target.value as Condition }))}>
                {CONDITIONS.map((c) => (
                  <option key={c} value={c}>
                    {label(c)}
                  </option>
                ))}
              </select>
            </label>
            <label className="field-inline">
              {lt.receivePrice}
              <input className="receive-num" inputMode="decimal" value={delivery.price} placeholder="0" onChange={(e) => setDelivery((d) => ({ ...d, price: e.target.value }))} />
            </label>
          </div>
        </fieldset>
      )}

      <fieldset className="choices bulk-defaults">
        <legend>{receiving ? lt.receiveNewTitles : lt.bulkDefaults}</legend>
        <div className="row">
          <label className="field-inline">
            {lt.ageGroup}
            <select
              value={defaults.ageGroup}
              onChange={(e) => {
                const ageGroup = e.target.value as AgeGroup;
                choose({ ageGroup });
                // Rows whose age group was guessed from the book details, or picked on the row, keep theirs.
                setRows((rs) => rs.map((r) => (r.state === 'added' || r.ageFrom !== 'page' ? r : { ...r, ageGroup })));
              }}
            >
              {AGE_GROUPS.map((a) => (
                <option key={a} value={a}>
                  {label(a)}
                </option>
              ))}
            </select>
          </label>
          <label className="field-inline">
            {lt.readingLevel}
            <select value={defaults.readingLevel} onChange={(e) => choose({ readingLevel: e.target.value as Level })}>
              {READING_LEVELS.map((l) => (
                <option key={l} value={l}>
                  {label(l)}
                </option>
              ))}
            </select>
          </label>
          <label className="field-inline">
            {lt.bulkGenre}
            <select value={defaults.genre} onChange={(e) => choose({ genre: e.target.value as Genre })}>
              {GENRES.map((g) => (
                <option key={g} value={g}>
                  {label(g)}
                </option>
              ))}
            </select>
          </label>
        </div>
      </fieldset>

      <div className="row">
        <button type="button" className={`btn ${camera ? 'btn-filled' : 'btn-outlined'}`} aria-pressed={camera} onClick={() => setCamera((c) => !c)}>
          <Icon name="camera" /> {lt.receiveCamera}
        </button>
      </div>
      {/* Nothing is taken while a delivery is being saved: its rows are held. */}
      {camera && <CameraScanner hint={lt.camHintIsbn} onDetect={(text) => (busy ? undefined : bulk.scan(text))} onClose={() => setCamera(false)} />}

      <TableWrap>
        <table className="table bulk-table">
          <thead>
            <tr>
              <th scope="col" className="num">
                #
              </th>
              <th scope="col">ISBN</th>
              <th scope="col">{lt.bulkBook}</th>
              <th scope="col">{lt.bulkGenre}</th>
              <th scope="col">{lt.ageGroup}</th>
              {receiving && <th scope="col">{lt.receiveCopies}</th>}
              {receiving && <th scope="col">{lt.receiveRowPrice}</th>}
              <th scope="col">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {view.map((v) => (
              <BulkRow key={v.r.key} view={v} rows={bulk} receiving={receiving} canAdd={canAdd} busy={!!busy} deliveryPrice={delivery.price} first={v.r.key === firstOpen} />
            ))}
          </tbody>
        </table>
      </TableWrap>

      <div className="bulk-footer">
        <div className="row">
          <button type="button" className="btn btn-outlined" disabled={!!busy} onClick={bulk.addRow}>
            <Icon name="plus" /> {lt.bulkAddRow}
          </button>
          <button
            type="button"
            className="btn btn-text"
            disabled={!!busy}
            onClick={() => {
              bulk.clear();
              setReceived([]);
            }}
          >
            {lt.bulkClear}
          </button>
        </div>
        <p className="muted" aria-live="polite">
          {/* The shelf is named where the delivery is confirmed: a remembered one is easy to overlook above. */}
          {busy ?? (shelf && ready.length ? `${summary} · ${lt.receiveOnto(shelf.code)}` : summary)}
        </p>
        <button type="button" className="btn btn-filled" disabled={!ready.length || !!busy} onClick={() => void (receiving ? receive() : submit())}>
          {receiving ? lt.receiveSubmit(readyCopies) : lt.bulkSubmit(ready.length)}
        </button>
      </div>
      <FormError error={error} />
      {notice && <Notice tone="ok">{notice}</Notice>}
      {covers.done < covers.total && (
        <p className="muted small" role="status">
          {lt.bulkCovers(covers.done, covers.total)}
        </p>
      )}
      {/* On their own, not inside the notice: the labels of what was received stay when the notice changes. */}
      <ReceivedLabels copies={received} branchName={branchName} />
      {canSend && org && branch && <SendToBranches orgId={org.id} branchId={branch.id} targets={targets} copies={receivedHere} update={setReceived} />}
    </>
  );
}
