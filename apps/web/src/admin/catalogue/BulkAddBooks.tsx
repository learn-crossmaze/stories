// Operations → Collection → Receive books: a delivery (or just new titles) at once. Each row is checked as it is typed
// or scanned and looked up; staff who look after copies at the branch also set how many copies arrived, and one
// submit adds the new titles to the catalogue and every copy to the branch (copies-receive). Catalogue managers
// without a branch get the titles-only version (books-bulkCreate).
import { type ClipboardEvent, type KeyboardEvent, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';

import { useAuth } from '../../auth/AuthContext';
import { can } from '../../auth/claims';
import { bulkCreateBooks, type BulkItem, importCover, lookupIsbn, type ReceiveItem, receiveStock } from '../../data/bulkBooks';
import { AGE_GROUPS, type AgeGroup, CONDITIONS, type Condition, GENRES, type Genre, label, LANGUAGES, READING_LEVELS } from '../../data/common';
import { listLocations } from '../../data/inventory';
import { paths } from '../../paths';
import { normalizeIsbn, splitIsbns } from '../../shared/isbn';
import { toMinor } from '../../shared/format';
import { EmptyState, Icon, TableWrap } from '../../shared/ui';
import { useAsync } from '../../shared/useAsync';
import { t } from '../../strings';
import { lt } from '../../strings/library';
import { FormError } from '../components/Dialog';
import { Notice } from '../components/kit';
import type { Candidate } from './BookLookup';
import { useCanAddBooks } from './Catalogue';
import { useWorkspace } from '../Workspace';

type State = 'idle' | 'checking' | 'found' | 'notFound' | 'exists' | 'error' | 'added' | 'skipped';
type Level = (typeof READING_LEVELS)[number];

interface Row {
  key: number;
  raw: string;
  /** Set once the user has left the field (or pressed Enter), so half-typed ISBNs aren't flagged. */
  touched: boolean;
  /** The ISBN the current state belongs to. */
  checked: string | null;
  state: State;
  candidate: Candidate | null;
  genre: Genre;
  ageGroup: AgeGroup;
  author: string;
  /** Title typed in for an ISBN no public catalogue knows. */
  title: string;
  /** Copies that arrived (receiving). */
  quantity: string;
  /** Price per copy (₹); blank = the delivery's price. */
  price: string;
  message: string | null;
  code: string | null;
  bookId: string | null;
  /** Copy codes added (receiving). */
  copies: string[];
}

const START_ROWS = 5;
const MAX_LOOKUPS = 3;
let nextKey = 1;

/** Runs at most MAX_LOOKUPS lookups at a time, so a pasted list doesn't flood the search services. */
function usePool() {
  const running = useRef(0);
  const queue = useRef<(() => Promise<void>)[]>([]);
  const pump = () => {
    while (running.current < MAX_LOOKUPS && queue.current.length) {
      const job = queue.current.shift()!;
      running.current++;
      void job().finally(() => {
        running.current--;
        pump();
      });
    }
  };
  return (job: () => Promise<void>) => {
    queue.current.push(job);
    pump();
  };
}

const whole = (v: string) => /^\d+$/.test(v.trim());

/** A typed-in title, shown like a looked-up one once added. */
const typedIn = (r: Row): Candidate => ({
  source: 'manual', title: r.title.trim(), subtitle: '', authors: [r.author.trim()], publisher: null, year: null, isbn: normalizeIsbn(r.raw),
  language: null, synopsis: '', genres: [], subjects: [], coverUrl: null, existingBookId: null,
});

export function BulkAddBooksPage() {
  const canAdd = useCanAddBooks();
  const { claims } = useAuth();
  const { org, branch } = useWorkspace();
  // Receiving: staff who look after copies at the branch in use. Otherwise titles only (catalogue managers).
  const receiving = !!org && !!branch && can(claims, 'copies.manage', org.id, branch.id);
  const locations = useAsync(() => (receiving && org && branch ? listLocations(org.id, branch.id) : Promise.resolve([])), [receiving, org?.id, branch?.id]);
  const [delivery, setDelivery] = useState<{ locationId: string; condition: Condition; price: string }>({ locationId: '', condition: 'NEW', price: '' });
  const [labels, setLabels] = useState<string[]>([]);
  const [defaults, setDefaults] = useState<{ ageGroup: AgeGroup; readingLevel: Level; genre: Genre }>({ ageGroup: 'ADULTS', readingLevel: 'INTERMEDIATE', genre: 'FICTION' });
  const blank = (): Row => ({
    key: nextKey++, raw: '', touched: false, checked: null, state: 'idle', candidate: null, genre: defaults.genre, ageGroup: defaults.ageGroup, author: '', title: '',
    quantity: '1', price: '', message: null, code: null, bookId: null, copies: [],
  });
  const [rows, setRows] = useState<Row[]>(() => Array.from({ length: START_ROWS }, blank));
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const inputs = useRef(new Map<number, HTMLInputElement>());
  const [focusKey, setFocusKey] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const enqueue = usePool();

  useEffect(() => {
    if (focusKey !== null) {
      inputs.current.get(focusKey)?.focus();
      setFocusKey(null);
    }
  }, [focusKey, rows]);

  const patch = (key: number, change: Partial<Row> | ((r: Row) => Partial<Row>)) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...(typeof change === 'function' ? change(r) : change) } : r)));

  /**
   * Checks a row's ISBN and, when it's valid and new to the list, looks it up.
   * When receiving, scanning a book already on the list adds a copy to that
   * row instead (returns true: the row was emptied for the next scan).
   */
  const validate = (key: number, raw: string): boolean => {
    const isbn = normalizeIsbn(raw);
    const row = rowsRef.current.find((r) => r.key === key);
    if (!row || row.state === 'added') return false;
    if (!isbn) return void patch(key, { touched: !!raw.trim() }), false;
    const earlier = rowsRef.current.findIndex((r) => r.key !== key && normalizeIsbn(r.raw) === isbn && r.state !== 'added');
    const mine = rowsRef.current.findIndex((r) => r.key === key);
    if (earlier !== -1 && earlier < mine) {
      if (!receiving) return void patch(key, { touched: true }), false;
      const target = rowsRef.current[earlier];
      const next = String(Math.min(50, (Number(target.quantity) || 0) + 1));
      rowsRef.current = rowsRef.current.map((r) => (r.key === target.key ? { ...r, quantity: next } : r.key === key ? { ...r, raw: '', touched: false, checked: null, state: 'idle', candidate: null, message: null } : r));
      setRows(rowsRef.current);
      setNotice(lt.receiveBumped(earlier + 1, next));
      return true;
    }
    if (row.checked === isbn && row.state !== 'error') return void patch(key, { touched: true }), false;
    patch(key, { touched: true, checked: isbn, state: 'checking', candidate: null, message: null });
    enqueue(async () => {
      try {
        const c = await lookupIsbn(isbn, canAdd);
        patch(key, (r) => {
          if (r.checked !== isbn) return {};
          if (!c) return { state: 'notFound' };
          if (c.existingBookId) return { state: 'exists', candidate: c, bookId: c.existingBookId };
          return { state: 'found', candidate: c, genre: (c.genres[0] as Genre | undefined) ?? defaults.genre };
        });
      } catch (e) {
        patch(key, (r) => (r.checked === isbn ? { state: 'error', message: e instanceof Error ? e.message : t.errorGeneric } : {}));
      }
    });
    return false;
  };

  const onChange = (key: number, raw: string) => {
    patch(key, (r) => (r.raw === raw ? {} : { raw, touched: false, ...(normalizeIsbn(raw) === r.checked ? {} : { checked: null, state: 'idle' as State, candidate: null, message: null }) }));
    // A complete, valid ISBN (typed or scanned) is checked straight away.
    if (normalizeIsbn(raw)) validate(key, raw);
  };

  const focusNext = (key: number) => {
    const i = rowsRef.current.findIndex((r) => r.key === key);
    const next = rowsRef.current[i + 1];
    if (next) return setFocusKey(next.key);
    const row = blank();
    setRows((rs) => [...rs, row]);
    setFocusKey(row.key);
  };

  const onKeyDown = (key: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    // An emptied row (a repeat scan was counted on its first row) stays ready for the next scan.
    if (!e.currentTarget.value.trim() || validate(key, e.currentTarget.value)) return setFocusKey(key);
    focusNext(key);
  };

  /** A pasted list fills this row and the ones after it (adding rows as needed). */
  const onPaste = (key: number, e: ClipboardEvent<HTMLInputElement>) => {
    const pieces = splitIsbns(e.clipboardData.getData('text'));
    if (pieces.length < 2) return;
    e.preventDefault();
    const start = rowsRef.current.findIndex((r) => r.key === key);
    const current = [...rowsRef.current];
    const targets: { key: number; raw: string }[] = [];
    let i = start;
    for (const piece of pieces) {
      while (i < current.length && i !== start && current[i].raw.trim()) i++;
      if (i >= current.length) current.push(blank());
      current[i] = { ...current[i], raw: piece, touched: true, checked: null, state: 'idle', candidate: null, message: null };
      targets.push({ key: current[i].key, raw: piece });
      i++;
    }
    rowsRef.current = current;
    setRows(current);
    for (const target of targets) validate(target.key, target.raw);
  };

  const remove = (key: number) => setRows((rs) => (rs.length > 1 ? rs.filter((r) => r.key !== key) : [blank()]));

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
    const items: ReceiveItem[] = ready.map((v) => ({
      ...(v.r.state === 'exists' ? { bookId: v.r.bookId! } : { book: bookOf(v) }),
      quantity: Number(v.r.quantity),
      acquisitionCostMinor: v.price,
    }));
    try {
      setBusy(lt.receiveSaving(0, items.length));
      const res = await receiveStock({ orgId: org.id, branchId: branch.id, locationId: delivery.locationId || null, condition: delivery.condition }, items, (done) =>
        setBusy(lt.receiveSaving(done, items.length)),
      );
      const newByIsbn = new Map(res.newTitles.map((n) => [n.isbn, n]));
      const byBook = new Map(res.received.map((r) => [r.bookId, r]));
      const readyKeys = new Set(ready.map((v) => v.r.key));
      setRows((rs) =>
        rs.map((r) => {
          if (!readyKeys.has(r.key)) return r;
          const made = newByIsbn.get(normalizeIsbn(r.raw) ?? '');
          const bookId = made?.bookId ?? r.bookId;
          const got = bookId ? byBook.get(bookId) : undefined;
          return got ? { ...r, state: 'added', bookId, code: made?.code ?? null, copies: got.codes, candidate: r.candidate ?? typedIn(r) } : r;
        }),
      );
      await addCovers(res.newTitles);
      setLabels(res.received.flatMap((r) => r.copyIds));
      setNotice(lt.receiveDone(res.copies, res.received.length, res.newTitles.length, res.allocated));
    } catch (e) {
      setError(e instanceof Error ? e.message : t.errorGeneric);
    } finally {
      setBusy(null);
    }
  };

  const submit = async () => {
    if (!ready.length || busy) return;
    setError(null);
    setNotice(null);
    const items: BulkItem[] = ready.map(bookOf);
    try {
      setBusy(lt.bulkSaving(0, items.length));
      const res = await bulkCreateBooks(items, (done) => setBusy(lt.bulkSaving(done, items.length)));
      const byIsbn = new Map(res.created.map((c) => [c.isbn, c]));
      const skippedBy = new Map(res.skipped.map((s) => [s.isbn, s]));
      setRows((rs) =>
        rs.map((r) => {
          const isbn = normalizeIsbn(r.raw);
          const made = isbn ? byIsbn.get(isbn) : undefined;
          if (made) return { ...r, state: 'added', code: made.code, bookId: made.bookId, candidate: r.candidate ?? typedIn(r) };
          const skip = isbn ? skippedBy.get(isbn) : undefined;
          return skip ? { ...r, state: 'skipped', message: skip.reason } : r;
        }),
      );
      await addCovers(res.created);
      setNotice(`${lt.bulkDone(res.created.length, res.skipped.length)} ${lt.bulkNextStep}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : t.errorGeneric);
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
            {view.map(({ r, n, repeatOf, needsAuthor, manual, invalid, quantityOk, priceOk, newTitle }) => {
              const statusId = `bulk-status-${r.key}`;
              const done = r.state === 'added';
              const c = r.candidate;
              return (
                <tr key={r.key} className={done ? 'bulk-done' : undefined}>
                  <td className="num muted">{n}</td>
                  <td>
                    <input
                      ref={(el) => {
                        if (el) inputs.current.set(r.key, el);
                        else inputs.current.delete(r.key);
                      }}
                      className="bulk-isbn"
                      inputMode="numeric"
                      autoComplete="off"
                      value={r.raw}
                      disabled={done || !!busy}
                      aria-label={lt.bulkIsbnLabel(n)}
                      aria-describedby={statusId}
                      aria-invalid={invalid || repeatOf !== -1}
                      onChange={(e) => onChange(r.key, e.target.value)}
                      onBlur={(e) => validate(r.key, e.target.value)}
                      onKeyDown={(e) => onKeyDown(r.key, e)}
                      onPaste={(e) => onPaste(r.key, e)}
                    />
                  </td>
                  <td id={statusId}>
                    {invalid ? (
                      <span className="field-error">{lt.bulkInvalid}</span>
                    ) : repeatOf !== -1 ? (
                      <span className="field-error">{lt.bulkRepeat(repeatOf + 1)}</span>
                    ) : r.state === 'checking' ? (
                      <span className="muted">{lt.bulkChecking}</span>
                    ) : manual && !done ? (
                      <div className="bulk-manual">
                        <span className="warn-text small">
                          {r.state === 'error' ? (
                            <>
                              {r.message}{' '}
                              <button type="button" className="btn btn-text" onClick={() => validate(r.key, r.raw)}>
                                {lt.bulkRetry}
                              </button>{' '}
                              {lt.receiveOrType}
                            </>
                          ) : (
                            lt.receiveNotFound
                          )}
                        </span>
                        <input value={r.title} placeholder={lt.receiveTitleLabel} onChange={(e) => patch(r.key, { title: e.target.value })} aria-label={lt.receiveTitleRow(n)} />
                        <input value={r.author} placeholder={lt.receiveAuthorLabel} onChange={(e) => patch(r.key, { author: e.target.value })} aria-label={lt.bulkAuthor(n)} />
                      </div>
                    ) : r.state === 'notFound' ? (
                      <span className="warn-text">{lt.bulkNotFound}</span>
                    ) : r.state === 'error' ? (
                      <span className="field-error">
                        {r.message}{' '}
                        <button type="button" className="btn btn-text" onClick={() => validate(r.key, r.raw)}>
                          {lt.bulkRetry}
                        </button>
                      </span>
                    ) : c ? (
                      <div className="bulk-book">
                        {c.coverUrl ? <img src={c.coverUrl} alt="" className="bulk-cover" loading="lazy" /> : <span className="bulk-cover" aria-hidden="true" />}
                        <div>
                          <strong>{c.title}</strong>
                          {c.subtitle && <span className="muted"> · {c.subtitle}</span>}
                          <div className="muted small">{[c.authors.join(', '), c.publisher, c.year].filter(Boolean).join(' · ')}</div>
                          {r.state === 'exists' && (
                            <div className="small">
                              {receiving ? lt.receiveInCatalogue : lt.bulkExists} <Link to={paths.adminBook(r.bookId!)}>{lt.bulkOpenBook}</Link>
                            </div>
                          )}
                          {receiving && r.state === 'found' && !canAdd && <div className="small warn-text">{lt.receiveCannotAdd}</div>}
                          {r.state === 'skipped' && <div className="small warn-text">{r.message}</div>}
                          {done && (
                            <div className="small ok-text">
                              <Icon name="check" />{' '}
                              <Link to={paths.adminBook(r.bookId!)}>{r.copies.length ? lt.receiveAdded(r.copies, r.code) : lt.bulkAdded(r.code!)}</Link>
                            </div>
                          )}
                          {needsAuthor && r.state === 'found' && !done && (
                            <label className="small bulk-author">
                              {lt.bulkNeedsAuthor}
                              <input value={r.author} onChange={(e) => patch(r.key, { author: e.target.value })} aria-label={lt.bulkAuthor(n)} />
                            </label>
                          )}
                        </div>
                      </div>
                    ) : null}
                  </td>
                  <td>
                    {newTitle && !done && (
                      <select value={r.genre} disabled={!!busy} onChange={(e) => patch(r.key, { genre: e.target.value as Genre })} aria-label={`${lt.bulkGenre}, row ${n}`}>
                        {GENRES.map((g) => (
                          <option key={g} value={g}>
                            {label(g)}
                          </option>
                        ))}
                      </select>
                    )}
                  </td>
                  <td>
                    {newTitle && !done && (
                      <select value={r.ageGroup} disabled={!!busy} onChange={(e) => patch(r.key, { ageGroup: e.target.value as AgeGroup })} aria-label={`${lt.ageGroup}, row ${n}`}>
                        {AGE_GROUPS.map((a) => (
                          <option key={a} value={a}>
                            {label(a)}
                          </option>
                        ))}
                      </select>
                    )}
                  </td>
                  {receiving && (
                    <td>
                      {!done && r.state !== 'idle' && (
                        <input
                          className="receive-num"
                          inputMode="numeric"
                          value={r.quantity}
                          disabled={!!busy}
                          aria-label={lt.receiveCopiesRow(n)}
                          aria-invalid={!quantityOk}
                          onChange={(e) => patch(r.key, { quantity: e.target.value })}
                        />
                      )}
                      {done && <span>{r.copies.length}</span>}
                    </td>
                  )}
                  {receiving && (
                    <td>
                      {!done && r.state !== 'idle' && (
                        <input
                          className="receive-num"
                          inputMode="decimal"
                          value={r.price}
                          placeholder={delivery.price || '0'}
                          disabled={!!busy}
                          aria-label={lt.receivePriceRow(n)}
                          aria-invalid={!priceOk}
                          onChange={(e) => patch(r.key, { price: e.target.value })}
                        />
                      )}
                    </td>
                  )}
                  <td className="cell-actions">
                    {!done && (
                      <button type="button" className="btn btn-text btn-icon" onClick={() => remove(r.key)} aria-label={lt.bulkRemove(n)} disabled={!!busy}>
                        <Icon name="close" />
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableWrap>

      <div className="bulk-footer">
        <div className="row">
          <button type="button" className="btn btn-outlined" disabled={!!busy} onClick={() => setRows((rs) => [...rs, blank()])}>
            <Icon name="plus" /> {lt.bulkAddRow}
          </button>
          <button type="button" className="btn btn-text" disabled={!!busy} onClick={() => setRows(Array.from({ length: START_ROWS }, blank))}>
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
