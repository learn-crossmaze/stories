// Operations → Collection → Receive books: a delivery (or just new titles) at once. Each row is checked as it is typed
// or scanned and looked up; staff who look after copies at the branch also set how many copies arrived, and one
// submit adds the new titles to the catalogue and every copy to the branch (copies-receive). Catalogue managers
// without a branch get the titles-only version (books-bulkCreate).
import { useRef, useState } from 'react';
import { Link } from 'react-router';

import { useAuth } from '../../auth/AuthContext';
import { can } from '../../auth/claims';
import { errorText } from '../../data/api';
import { bulkCreateBooks, type BulkItem, type BulkResult, type ChunkRange, importCover, type ReceiveItem, type ReceiveResult, receiveStock } from '../../data/bulkBooks';
import { AGE_GROUPS, type AgeGroup, CONDITIONS, type Condition, GENRES, type Genre, label, LANGUAGES, READING_LEVELS } from '../../data/common';
import { listLocations } from '../../data/inventory';
import { paths } from '../../paths';
import { normalizeIsbn } from '../../shared/isbn';
import { toMinor } from '../../shared/format';
import { EmptyState, Icon, TableWrap } from '../../shared/ui';
import { useAsync } from '../../shared/useAsync';
import { t } from '../../strings';
import { lt } from '../../strings/library';
import { FormError } from '../components/Dialog';
import { Notice } from '../components/kit';
import { useCanAddBooks } from './Catalogue';
import { useWorkspace } from '../Workspace';
import { BulkRow, type Level, typedIn, useBulkRows, whole } from './bulkRows';

export function BulkAddBooksPage() {
  const canAdd = useCanAddBooks();
  const { claims } = useAuth();
  const { org, branch } = useWorkspace();
  // Receiving: staff who look after copies at the branch in use. Otherwise titles only (catalogue managers).
  const receiving = !!org && !!branch && can(claims, 'copies.manage', org.id, branch.id);
  const locations = useAsync(() => (receiving && org && branch ? listLocations(org.id, branch.id) : Promise.resolve([])), [receiving, org?.id, branch?.id]);
  const [notice, setNotice] = useState<string | null>(null);
  const [delivery, setDelivery] = useState<{ locationId: string; condition: Condition; price: string }>({ locationId: '', condition: 'NEW', price: '' });
  const [labels, setLabels] = useState<string[]>([]);
  const [defaults, setDefaults] = useState<{ ageGroup: AgeGroup; readingLevel: Level; genre: Genre }>({ ageGroup: 'ADULTS', readingLevel: 'INTERMEDIATE', genre: 'FICTION' });
  const bulk = useBulkRows({ canAdd, receiving, defaults, onNotice: setNotice });
  const { rows, setRows } = bulk;
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
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
    const repeatOf = isbn ? rows.findIndex((o, j) => j < i && normalizeIsbn(o.raw) === isbn) : -1;
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

  const addCovers = async (made: { bookId: string; isbn: string }[]) => {
    const covers = made.flatMap((c) => {
      const url = ready.find((v) => v.isbn === c.isbn)?.r.candidate?.coverUrl;
      return url ? [{ bookId: c.bookId, url }] : [];
    });
    for (const [i, c] of covers.entries()) {
      setBusy(lt.bulkCovers(i + 1, covers.length));
      await importCover(c.bookId, c.url);
    }
  };

  const receive = async () => {
    if (!ready.length || busy || !org || !branch) return;
    setError(null);
    setNotice(null);
    setLabels([]);
    const sent = ready;
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
    try {
      setBusy(lt.receiveSaving(0, items.length));
      await receiveStock({ orgId: org.id, branchId: branch.id, locationId: delivery.locationId || null, condition: delivery.condition }, items, {
        onChunk: committed,
        requestId: (range) => requestIdFor(keysOf(range)),
      });
    } catch (e) {
      setError(errorText(e));
    }
    try {
      if (got.copies || got.newTitles.length) {
        await addCovers(got.newTitles);
        setLabels(got.received.flatMap((r) => r.copyIds));
        setNotice(lt.receiveDone(got.copies, got.received.length, got.newTitles.length, got.allocated));
      }
    } finally {
      setBusy(null);
    }
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
    try {
      setBusy(lt.bulkSaving(0, items.length));
      await bulkCreateBooks(items, { onChunk: committed, requestId: (range) => requestIdFor(keysOf(range)) });
    } catch (e) {
      setError(errorText(e));
    }
    try {
      if (got.created.length || got.skipped.length) {
        await addCovers(got.created);
        setNotice(`${lt.bulkDone(got.created.length, got.skipped.length)} ${lt.bulkNextStep}`);
      }
    } finally {
      setBusy(null);
    }
  };

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
              <select value={delivery.locationId} onChange={(e) => setDelivery((d) => ({ ...d, locationId: e.target.value }))}>
                <option value="">{lt.noLocation}</option>
                {(locations.data ?? [])
                  .filter((l) => l.status === 'ACTIVE')
                  .map((l) => (
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
                setDefaults((d) => ({ ...d, ageGroup }));
                setRows((rs) => rs.map((r) => (r.state === 'added' ? r : { ...r, ageGroup })));
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
            <select value={defaults.readingLevel} onChange={(e) => setDefaults((d) => ({ ...d, readingLevel: e.target.value as Level }))}>
              {READING_LEVELS.map((l) => (
                <option key={l} value={l}>
                  {label(l)}
                </option>
              ))}
            </select>
          </label>
          <label className="field-inline">
            {lt.bulkGenre}
            <select value={defaults.genre} onChange={(e) => setDefaults((d) => ({ ...d, genre: e.target.value as Genre }))}>
              {GENRES.map((g) => (
                <option key={g} value={g}>
                  {label(g)}
                </option>
              ))}
            </select>
          </label>
        </div>
      </fieldset>

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
              <BulkRow key={v.r.key} view={v} rows={bulk} receiving={receiving} canAdd={canAdd} busy={!!busy} deliveryPrice={delivery.price} />
            ))}
          </tbody>
        </table>
      </TableWrap>

      <div className="bulk-footer">
        <div className="row">
          <button type="button" className="btn btn-outlined" disabled={!!busy} onClick={bulk.addRow}>
            <Icon name="plus" /> {lt.bulkAddRow}
          </button>
          <button type="button" className="btn btn-text" disabled={!!busy} onClick={bulk.clear}>
            {lt.bulkClear}
          </button>
        </div>
        <p className="muted" aria-live="polite">
          {busy ?? (receiving ? lt.receiveSummary(ready.length, readyCopies, attention) : lt.bulkSummary(ready.length, attention, known))}
        </p>
        <button type="button" className="btn btn-filled" disabled={!ready.length || !!busy} onClick={() => void (receiving ? receive() : submit())}>
          {receiving ? lt.receiveSubmit(readyCopies) : lt.bulkSubmit(ready.length)}
        </button>
      </div>
      <FormError error={error} />
      {notice && (
        <Notice tone="ok">
          {notice}{' '}
          {labels.length > 0 && (
            <Link to={`${paths.adminLabels}?copies=${labels.slice(0, 120).join(',')}`}>
              {lt.receiveLabels(Math.min(labels.length, 120))}
            </Link>
          )}
        </Notice>
      )}
    </>
  );
}
