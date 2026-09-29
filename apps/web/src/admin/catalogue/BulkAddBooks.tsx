// Operations → Collection → Add by ISBN: many titles at once. Each row is checked as it is typed or scanned,
// looked up in public catalogues, and every good row is added with one submit.
import { type ClipboardEvent, type KeyboardEvent, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';

import { bulkCreateBooks, type BulkItem, importCover, lookupIsbn } from '../../data/bulkBooks';
import { AGE_GROUPS, type AgeGroup, GENRES, type Genre, label, LANGUAGES, READING_LEVELS } from '../../data/common';
import { paths } from '../../paths';
import { normalizeIsbn, splitIsbns } from '../../shared/isbn';
import { EmptyState, Icon, TableWrap } from '../../shared/ui';
import { t } from '../../strings';
import { lt } from '../../strings/library';
import { FormError } from '../components/Dialog';
import { Notice } from '../components/kit';
import type { Candidate } from './BookLookup';
import { useCanAddBooks } from './Catalogue';

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
  message: string | null;
  code: string | null;
  bookId: string | null;
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

export function BulkAddBooksPage() {
  const canAdd = useCanAddBooks();
  const [defaults, setDefaults] = useState<{ ageGroup: AgeGroup; readingLevel: Level; genre: Genre }>({ ageGroup: 'ADULTS', readingLevel: 'INTERMEDIATE', genre: 'FICTION' });
  const blank = (): Row => ({
    key: nextKey++, raw: '', touched: false, checked: null, state: 'idle', candidate: null, genre: defaults.genre, ageGroup: defaults.ageGroup, author: '', message: null, code: null, bookId: null,
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

  /** Checks a row's ISBN and, when it's valid and new to the list, looks it up. */
  const validate = (key: number, raw: string) => {
    const isbn = normalizeIsbn(raw);
    const row = rowsRef.current.find((r) => r.key === key);
    if (!row || row.state === 'added') return;
    if (!isbn) return patch(key, { touched: !!raw.trim() });
    const earlier = rowsRef.current.findIndex((r) => r.key !== key && normalizeIsbn(r.raw) === isbn);
    const mine = rowsRef.current.findIndex((r) => r.key === key);
    if (earlier !== -1 && earlier < mine) return patch(key, { touched: true });
    if (row.checked === isbn && row.state !== 'error') return patch(key, { touched: true });
    patch(key, { touched: true, checked: isbn, state: 'checking', candidate: null, message: null });
    enqueue(async () => {
      try {
        const c = await lookupIsbn(isbn);
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
    validate(key, e.currentTarget.value);
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
  const view = rows.map((r, i) => {
    const isbn = normalizeIsbn(r.raw);
    const repeatOf = isbn ? rows.findIndex((o, j) => j < i && normalizeIsbn(o.raw) === isbn) : -1;
    const needsAuthor = r.state === 'found' && !r.candidate?.authors.length;
    const ready = r.state === 'found' && repeatOf === -1 && (!needsAuthor || r.author.trim().length >= 2);
    const invalid = !!r.raw.trim() && !isbn && r.touched;
    return { r, n: i + 1, isbn, repeatOf, needsAuthor, ready, invalid };
  });
  const ready = view.filter((v) => v.ready);
  const known = view.filter((v) => v.r.state === 'exists' && v.repeatOf === -1).length;
  const attention = view.filter((v) => v.r.raw.trim() && !v.ready && !['exists', 'added', 'skipped', 'checking', 'idle'].includes(v.r.state)).length + view.filter((v) => v.invalid || v.repeatOf !== -1).length;

  const submit = async () => {
    if (!ready.length || busy) return;
    setError(null);
    setNotice(null);
    const items: BulkItem[] = ready.map(({ r, isbn }) => {
      const c = r.candidate!;
      return {
        isbn: isbn!,
        title: c.title,
        subtitle: c.subtitle,
        authors: c.authors.length ? c.authors : [r.author.trim()],
        publisher: c.publisher,
        language: c.language && c.language in LANGUAGES ? c.language : 'en',
        genres: [r.genre],
        ageGroup: r.ageGroup,
        readingLevel: defaults.readingLevel,
        publicationYear: c.year,
        synopsis: c.synopsis,
      };
    });
    try {
      setBusy(lt.bulkSaving(0, items.length));
      const res = await bulkCreateBooks(items, (done) => setBusy(lt.bulkSaving(done, items.length)));
      const byIsbn = new Map(res.created.map((c) => [c.isbn, c]));
      const skippedBy = new Map(res.skipped.map((s) => [s.isbn, s]));
      setRows((rs) =>
        rs.map((r) => {
          const isbn = normalizeIsbn(r.raw);
          const made = isbn ? byIsbn.get(isbn) : undefined;
          if (made) return { ...r, state: 'added', code: made.code, bookId: made.bookId };
          const skip = isbn ? skippedBy.get(isbn) : undefined;
          return skip ? { ...r, state: 'skipped', message: skip.reason } : r;
        }),
      );
      const covers = res.created.flatMap((c) => {
        const url = ready.find((v) => v.isbn === c.isbn)?.r.candidate?.coverUrl;
        return url ? [{ bookId: c.bookId, url }] : [];
      });
      for (const [i, c] of covers.entries()) {
        setBusy(lt.bulkCovers(i + 1, covers.length));
        await importCover(c.bookId, c.url);
      }
      setNotice(`${lt.bulkDone(res.created.length, res.skipped.length)} ${lt.bulkNextStep}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : t.errorGeneric);
    } finally {
      setBusy(null);
    }
  };

  if (!canAdd) return <EmptyState icon="book" title={t.noAccessTitle} message={t.noAccessMessage} />;

  return (
    <>
      <header className="page-header">
        <h1>{lt.bulkTitle}</h1>
        <p className="muted">{lt.bulkIntro}</p>
      </header>

      <fieldset className="choices bulk-defaults">
        <legend>{lt.bulkDefaults}</legend>
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
              <th scope="col">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {view.map(({ r, n, repeatOf, needsAuthor, invalid }) => {
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
                              {lt.bulkExists} <Link to={paths.adminBook(r.bookId!)}>{lt.bulkOpenBook}</Link>
                            </div>
                          )}
                          {r.state === 'skipped' && <div className="small warn-text">{r.message}</div>}
                          {done && (
                            <div className="small ok-text">
                              <Icon name="check" /> <Link to={paths.adminBook(r.bookId!)}>{lt.bulkAdded(r.code!)}</Link>
                            </div>
                          )}
                          {needsAuthor && !done && (
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
                    {r.state === 'found' && (
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
                    {r.state === 'found' && (
                      <select value={r.ageGroup} disabled={!!busy} onChange={(e) => patch(r.key, { ageGroup: e.target.value as AgeGroup })} aria-label={`${lt.ageGroup}, row ${n}`}>
                        {AGE_GROUPS.map((a) => (
                          <option key={a} value={a}>
                            {label(a)}
                          </option>
                        ))}
                      </select>
                    )}
                  </td>
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
          {busy ?? lt.bulkSummary(ready.length, attention, known)}
        </p>
        <button type="button" className="btn btn-filled" disabled={!ready.length || !!busy} onClick={() => void submit()}>
          {lt.bulkSubmit(ready.length)}
        </button>
      </div>
      <FormError error={error} />
      {notice && <Notice tone="ok">{notice}</Notice>}
    </>
  );
}
