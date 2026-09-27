import { type FormEvent, useState } from 'react';
import { Link } from 'react-router';

import { callAction, toApiError } from '../data/api';
import { label } from '../data/library';
import { services } from '../data/services';
import { paths } from '../paths';
import { lt } from './libraryStrings';

/** A match from Google Books / Open Library (functions/src/catalog/lookup.ts). */
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
  subjects: string[];
  coverUrl: string | null;
  existingBookId: string | null;
}

/** "Find book details": search public catalogues by title or ISBN and pick a match. */
export function BookLookup({ onPick }: { onPick: (c: Candidate) => Promise<void> }) {
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<Candidate[] | null>(null);
  const [applying, setApplying] = useState<number | null>(null);

  const search = async (e?: FormEvent) => {
    e?.preventDefault();
    if (q.trim().length < 2 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await callAction<{ candidates: Candidate[] }>(services().fns, 'books-lookup', { q: q.trim() });
      setResults(res.candidates);
    } catch (err) {
      setError(toApiError(err).message || lt.lookupFailed);
      setResults(null);
    } finally {
      setBusy(false);
    }
  };

  const pick = async (c: Candidate, i: number) => {
    setApplying(i);
    setError(null);
    try {
      await onPick(c);
      setResults(null);
    } catch (err) {
      setError(toApiError(err).message || lt.lookupFailed);
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
      </div>
      <p className="muted small">{lt.lookupHint}</p>
      {error && <p className="field-error" role="alert">{error}</p>}
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
                <div className="muted small">{c.source}</div>
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
