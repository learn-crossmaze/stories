import { type FormEvent, useRef, useState } from 'react';
import { Link } from 'react-router';

import { call, errorText } from '../../data/api';
import { catalogueByIsbn } from '../../data/bulkBooks';
import { type AgeGroup, label } from '../../data/common';
import { paths } from '../../paths';
import { normalizeIsbn } from '../../shared/isbn';
import { Icon } from '../../shared/ui';
import { CameraScanner } from '../components/CameraScanner';
import { lt } from '../../strings/library';

/** A match from Google Books / Open Library (functions/src/catalogue/lookup.ts). */
export interface Candidate {
  source: string;
  title: string;
  subtitle: string;
  authors: string[];
  publisher: string | null;
  year: number | null;
  isbn: string | null;
  language: string | null;
  synopsis: string;
  genres: string[];
  /** The server's guess from the subject headings, when they say who the book is for (staff confirm it). */
  ageGroup?: AgeGroup | null;
  subjects: string[];
  coverUrl: string | null;
  existingBookId: string | null;
}

/**
 * "Find book details": an ISBN is looked for in our own catalogue first (one quick read, and it works when the
 * public catalogues are down); otherwise public catalogues are searched by title or ISBN, to pick a match.
 * `pristine` says nothing has been typed into the form yet: only then is the one match for a searched ISBN
 * filled in without a click (the other matches stay listed).
 */
export function BookLookup({ onPick, pristine = false }: { onPick: (c: Candidate) => void | Promise<void>; pristine?: boolean }) {
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<Candidate[] | null>(null);
  const [applying, setApplying] = useState<number | null>(null);
  const [applied, setApplied] = useState<string | null>(null);
  const [camera, setCamera] = useState(false);
  // Read when the search answers, not when it was started: someone may have begun typing in the form meanwhile.
  const untouched = useRef(pristine);
  untouched.current = pristine;

  const search = async (e?: FormEvent, term = q) => {
    e?.preventDefault();
    if (term.trim().length < 2 || busy) return;
    setBusy(true);
    setError(null);
    setApplied(null);
    try {
      const isbn = normalizeIsbn(term);
      // A failed read of our own catalogue must not stop the search: saving still refuses a duplicate ISBN.
      const ours = isbn ? await catalogueByIsbn(isbn).catch(() => null) : null;
      if (ours) {
        setResults([ours]);
        return;
      }
      const res = await call<{ candidates: Candidate[] }>('books-lookup', { q: term.trim() });
      setResults(res.candidates);
      // Open Library's ISBN is often another edition's, so "the one match" may not exist: the list is the fallback.
      const exact = isbn ? res.candidates.filter((c) => c.isbn === isbn) : [];
      if (exact.length === 1 && !exact[0].existingBookId && untouched.current) {
        await onPick(exact[0]);
        setApplied(exact[0].title);
      }
    } catch (err) {
      setError(errorText(err, lt.lookupFailed));
      setResults(null);
    } finally {
      setBusy(false);
    }
  };

  const pick = async (c: Candidate, i: number) => {
    setApplying(i);
    setError(null);
    setApplied(null);
    try {
      await onPick(c);
      setResults(null);
    } catch (err) {
      setError(errorText(err, lt.lookupFailed));
    } finally {
      setApplying(null);
    }
  };

  return (
    <div className="lookup span-2">
      {/* Not a nested <form>: the book form wraps this. Enter in the field searches. */}
      <div className="lookup-bar">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void search(e);
          }}
          placeholder={lt.lookupPlaceholder}
          aria-label={lt.lookupTitle}
        />
        <button type="button" className="btn btn-outlined" onClick={() => void search()} disabled={busy || q.trim().length < 2}>
          {busy ? lt.lookupSearching : lt.lookupButton}
        </button>
        <button type="button" className="btn btn-outlined btn-icon" onClick={() => setCamera((c) => !c)} aria-pressed={camera} aria-label={lt.camScanIsbn} title={lt.camScanIsbn}>
          <Icon name="camera" />
        </button>
      </div>
      {camera && (
        <CameraScanner
          continuous={false}
          onDetect={(text) => {
            setQ(text);
            void search(undefined, text);
          }}
          onClose={() => setCamera(false)}
        />
      )}
      <p className="muted small">{lt.lookupHint}</p>
      {error && <p className="field-error" role="alert">{error}</p>}
      {applied !== null && <p className="small" role="status">{lt.lookupApplied(applied)}</p>}
      {results && results.length === 0 && <p className="muted">{lt.lookupNone}</p>}
      {results && results.length > 0 && (
        <ul className="lookup-results">
          {results.map((c, i) => (
            <li key={`${c.source}-${c.isbn ?? c.title}-${i}`}>
              {c.coverUrl ? (
                <img
                  src={c.coverUrl}
                  alt=""
                  loading="lazy"
                  className="lookup-cover"
                  // Some catalogue entries point at an image that no longer exists: drop it rather than show a broken picture or import it.
                  onError={() => setResults((rs) => rs?.map((r, j) => (j === i ? { ...r, coverUrl: null } : r)) ?? rs)}
                />
              ) : (
                <span className="lookup-cover lookup-cover-none" />
              )}
              <div className="lookup-main">
                <strong>{c.title}</strong>
                {c.subtitle && <span className="muted"> · {c.subtitle}</span>}
                <div className="small">{c.authors.join(', ') || lt.lookupNoAuthor}</div>
                <div className="muted small">
                  {[c.publisher, c.year, c.isbn && `ISBN ${c.isbn}`, c.genres.map(label).join(', ')].filter(Boolean).join(' · ')}
                </div>
                <div className="muted small">{c.source === 'catalogue' ? lt.catalogueTitle : c.source}</div>
              </div>
              {c.existingBookId ? (
                <Link to={paths.adminBook(c.existingBookId)} className="btn btn-text">
                  {lt.lookupExisting}
                </Link>
              ) : (
                <button type="button" className="btn btn-filled" disabled={applying !== null} onClick={() => void pick(c, i)}>
                  {applying === i ? lt.lookupApplying : lt.lookupUse}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
