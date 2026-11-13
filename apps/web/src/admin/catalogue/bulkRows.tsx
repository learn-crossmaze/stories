// The rows of the Receive books page (BulkAddBooks.tsx): their state, the ISBN checks and lookups, and the table row.
import { type ClipboardEvent, type KeyboardEvent, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';

import { errorText } from '../../data/api';
import { lookupIsbn } from '../../data/bulkBooks';
import { AGE_GROUPS, type AgeGroup, GENRES, type Genre, label, READING_LEVELS } from '../../data/common';
import { paths } from '../../paths';
import { money } from '../../shared/format';
import { normalizeIsbn, splitIsbns } from '../../shared/isbn';
import { Icon } from '../../shared/ui';
import { lt } from '../../strings/library';
import type { Candidate } from './BookLookup';

export type State = 'idle' | 'checking' | 'found' | 'notFound' | 'exists' | 'error' | 'added' | 'skipped';
export type Level = (typeof READING_LEVELS)[number];

export interface Row {
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
  /**
   * Where the age group comes from: the page's "For new titles" choice (it follows a change there), a guess from
   * the looked-up book details, or the row's own list (neither is overwritten by the page's choice).
   */
  ageFrom: 'page' | 'guess' | 'row';
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
  /** Price per copy the copies were received at (paise), shown once added. */
  pricePaid: number | null;
}

export const START_ROWS = 5;
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

export const whole = (v: string) => /^\d+$/.test(v.trim());

/** A typed-in title, shown like a looked-up one once added. */
export const typedIn = (r: Row): Candidate => ({
  source: 'manual', title: r.title.trim(), subtitle: '', authors: [r.author.trim()], publisher: null, year: null, isbn: normalizeIsbn(r.raw),
  language: null, synopsis: '', genres: [], subjects: [], coverUrl: null, existingBookId: null,
});

/**
 * The rows of ISBNs: typing, scanning and pasting, each ISBN checked and looked
 * up as it is completed; Enter moves to the next row (adding one at the end).
 * When receiving, scanning a title already on the list counts another copy on
 * its row (`onNotice` says which).
 */
export function useBulkRows({ canAdd, receiving, defaults, onNotice }: { canAdd: boolean; receiving: boolean; defaults: { ageGroup: AgeGroup; genre: Genre }; onNotice: (text: string) => void }) {
  // The page's choices as they are now: a lookup answers later, and must not bring back what they were when it began.
  const now = useRef(defaults);
  now.current = defaults;
  const blank = (): Row => ({
    key: nextKey++, raw: '', touched: false, checked: null, state: 'idle', candidate: null, genre: now.current.genre, ageGroup: now.current.ageGroup, ageFrom: 'page', author: '', title: '',
    quantity: '1', price: '', message: null, code: null, bookId: null, copies: [], pricePaid: null,
  });
  const [rows, setRows] = useState<Row[]>(() => Array.from({ length: START_ROWS }, blank));
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const inputs = useRef(new Map<number, HTMLInputElement>());
  const [focusKey, setFocusKey] = useState<number | null>(null);
  const enqueue = usePool();

  // After every render: a field that is not there yet, or is held while a save runs, is focused once it can be.
  useEffect(() => {
    if (focusKey === null) return;
    const el = inputs.current.get(focusKey);
    if (!el || el.disabled) return;
    el.focus();
    setFocusKey(null);
  });

  /** A row's ISBN is gone or replaced: what was found for it goes, and so does an age group guessed from it. */
  const unchecked = (r: Row): Partial<Row> => ({
    checked: null, state: 'idle', candidate: null, message: null,
    ...(r.ageFrom === 'guess' ? { ageGroup: now.current.ageGroup, ageFrom: 'page' as const } : {}),
  });

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
      rowsRef.current = rowsRef.current.map((r) => (r.key === target.key ? { ...r, quantity: next } : r.key === key ? { ...r, raw: '', touched: false, ...unchecked(r) } : r));
      setRows(rowsRef.current);
      onNotice(lt.receiveBumped(earlier + 1, next));
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
          // The age group is taken from the book details only when they say who the book is for; a guess left
          // from another ISBN goes back to the page's choice.
          const guess = c.ageGroup
            ? { ageGroup: c.ageGroup, ageFrom: 'guess' as const }
            : r.ageFrom === 'guess'
              ? { ageGroup: now.current.ageGroup, ageFrom: 'page' as const }
              : {};
          return { state: 'found', candidate: c, genre: (c.genres[0] as Genre | undefined) ?? now.current.genre, ...guess };
        });
      } catch (e) {
        patch(key, (r) => (r.checked === isbn ? { state: 'error', message: errorText(e) } : {}));
      }
    });
    return false;
  };

  const onChange = (key: number, raw: string) => {
    patch(key, (r) => (r.raw === raw ? {} : { raw, touched: false, ...(normalizeIsbn(raw) === r.checked ? {} : unchecked(r)) }));
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
      current[i] = { ...current[i], raw: piece, touched: true, ...unchecked(current[i]) };
      targets.push({ key: current[i].key, raw: piece });
      i++;
    }
    rowsRef.current = current;
    setRows(current);
    for (const target of targets) validate(target.key, target.raw);
  };

  const remove = (key: number) => setRows((rs) => (rs.length > 1 ? rs.filter((r) => r.key !== key) : [blank()]));

  const inputRef = (key: number, el: HTMLInputElement | null) => {
    if (el) inputs.current.set(key, el);
    else inputs.current.delete(key);
  };
  const addRow = () => setRows((rs) => [...rs, blank()]);
  /** A fresh list, with the cursor in its first row. */
  const clear = () => {
    const fresh = Array.from({ length: START_ROWS }, blank);
    rowsRef.current = fresh;
    setRows(fresh);
    setFocusKey(fresh[0].key);
  };

  const open = (r: Row) => r.state !== 'added' && !r.raw.trim();
  /** Puts the cursor in the first empty row (adding one when there is none), ready for the next scan. */
  const focusFirstEmpty = () => {
    const first = rowsRef.current.find(open);
    if (first) return setFocusKey(first.key);
    const row = blank();
    setRows((rs) => [...rs, row]);
    setFocusKey(row.key);
  };

  /**
   * A code read by the camera. Only an ISBN is taken (a book's back cover carries other barcodes too). A title
   * already on the list counts another copy on its row when receiving, wherever that row is; otherwise the ISBN
   * goes into the first empty row and is looked up like a typed one, and an empty row is kept at the end.
   */
  const scan = (raw: string) => {
    const isbn = normalizeIsbn(raw);
    if (!isbn) return onNotice(lt.camNotIsbn);
    const at = rowsRef.current.findIndex((r) => r.state !== 'added' && normalizeIsbn(r.raw) === isbn);
    if (at !== -1) {
      if (!receiving) return onNotice(lt.bulkRepeat(at + 1));
      const next = String(Math.min(50, (Number(rowsRef.current[at].quantity) || 0) + 1));
      rowsRef.current = rowsRef.current.map((r, i) => (i === at ? { ...r, quantity: next } : r));
      setRows(rowsRef.current);
      return onNotice(lt.receiveBumped(at + 1, next));
    }
    const current = [...rowsRef.current];
    let i = current.findIndex(open);
    if (i === -1) i = current.push(blank()) - 1;
    current[i] = { ...current[i], raw: isbn, touched: true, ...unchecked(current[i]) };
    if (!current.slice(i + 1).some(open)) current.push(blank());
    rowsRef.current = current;
    setRows(current);
    validate(current[i].key, isbn);
  };

  return { rows, setRows, patch, validate, onChange, onKeyDown, onPaste, remove, inputRef, addRow, clear, focusFirstEmpty, scan };
}

export type BulkRows = ReturnType<typeof useBulkRows>;

/** What a row shows and whether it can be added (worked out by the page). */
export interface RowView {
  r: Row;
  n: number;
  repeatOf: number;
  needsAuthor: boolean;
  manual: boolean;
  invalid: boolean;
  quantityOk: boolean;
  priceOk: boolean;
  newTitle: boolean;
}

/** One row of the table: the ISBN, what it was found to be, and (receiving) copies and price. */
export function BulkRow({
  view: { r, n, repeatOf, needsAuthor, manual, invalid, quantityOk, priceOk, newTitle },
  rows,
  receiving,
  canAdd,
  busy,
  deliveryPrice,
  first = false,
}: {
  view: RowView;
  rows: BulkRows;
  receiving: boolean;
  canAdd: boolean;
  busy: boolean;
  deliveryPrice: string;
  /** The first row still to fill: where the cursor goes when the page opens (shared/useRouteFocus.ts). */
  first?: boolean;
}) {
  const statusId = `bulk-status-${r.key}`;
  const done = r.state === 'added';
  const c = r.candidate;
  return (
    <tr className={done ? 'bulk-done' : undefined}>
      <td className="num muted">{n}</td>
      <td>
        <input
          ref={(el) => rows.inputRef(r.key, el)}
          className="bulk-isbn"
          inputMode="numeric"
          autoComplete="off"
          value={r.raw}
          disabled={done || busy}
          data-autofocus={first || undefined}
          aria-label={lt.bulkIsbnLabel(n)}
          aria-describedby={statusId}
          aria-invalid={invalid || repeatOf !== -1}
          onChange={(e) => rows.onChange(r.key, e.target.value)}
          onBlur={(e) => rows.validate(r.key, e.target.value)}
          onKeyDown={(e) => rows.onKeyDown(r.key, e)}
          onPaste={(e) => rows.onPaste(r.key, e)}
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
                  <button type="button" className="btn btn-text" onClick={() => rows.validate(r.key, r.raw)}>
                    {lt.bulkRetry}
                  </button>{' '}
                  {lt.receiveOrType}
                </>
              ) : (
                lt.receiveNotFound
              )}
            </span>
            <input value={r.title} placeholder={lt.receiveTitleLabel} onChange={(e) => rows.patch(r.key, { title: e.target.value })} aria-label={lt.receiveTitleRow(n)} />
            <input value={r.author} placeholder={lt.receiveAuthorLabel} onChange={(e) => rows.patch(r.key, { author: e.target.value })} aria-label={lt.bulkAuthor(n)} />
          </div>
        ) : r.state === 'notFound' ? (
          <span className="warn-text">{lt.bulkNotFound}</span>
        ) : r.state === 'error' ? (
          <span className="field-error">
            {r.message}{' '}
            <button type="button" className="btn btn-text" onClick={() => rows.validate(r.key, r.raw)}>
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
                  <input value={r.author} onChange={(e) => rows.patch(r.key, { author: e.target.value })} aria-label={lt.bulkAuthor(n)} />
                </label>
              )}
            </div>
          </div>
        ) : null}
      </td>
      <td>
        {(done || r.state === 'exists') && <span className="muted">{r.code ? label(r.genre) : (r.candidate?.genres ?? []).map(label).join(', ')}</span>}
        {newTitle && !done && (
          <select value={r.genre} disabled={busy} onChange={(e) => rows.patch(r.key, { genre: e.target.value as Genre })} aria-label={`${lt.bulkGenre}, row ${n}`}>
            {GENRES.map((g) => (
              <option key={g} value={g}>
                {label(g)}
              </option>
            ))}
          </select>
        )}
      </td>
      <td>
        {done && r.code && <span className="muted">{label(r.ageGroup)}</span>}
        {newTitle && !done && (
          <select value={r.ageGroup} disabled={busy} onChange={(e) => rows.patch(r.key, { ageGroup: e.target.value as AgeGroup, ageFrom: 'row' })} aria-label={`${lt.ageGroup}, row ${n}`}>
            {AGE_GROUPS.map((a) => (
              <option key={a} value={a}>
                {label(a)}
              </option>
            ))}
          </select>
        )}
        {newTitle && !done && r.ageFrom === 'guess' && <div className="small muted">{lt.bulkAgeGuessed}</div>}
      </td>
      {receiving && (
        <td>
          {!done && r.state !== 'idle' && (
            <input
              className="receive-num"
              inputMode="numeric"
              value={r.quantity}
              disabled={busy}
              aria-label={lt.receiveCopiesRow(n)}
              aria-invalid={!quantityOk}
              onChange={(e) => rows.patch(r.key, { quantity: e.target.value })}
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
              placeholder={deliveryPrice || '0'}
              disabled={busy}
              aria-label={lt.receivePriceRow(n)}
              aria-invalid={!priceOk}
              onChange={(e) => rows.patch(r.key, { price: e.target.value })}
            />
          )}
          {done && r.pricePaid !== null && <span>{money(r.pricePaid)}</span>}
        </td>
      )}
      <td className="cell-actions">
        {!done && (
          <button type="button" className="btn btn-text btn-icon" onClick={() => rows.remove(r.key)} aria-label={lt.bulkRemove(n)} disabled={busy}>
            <Icon name="close" />
          </button>
        )}
      </td>
    </tr>
  );
}
