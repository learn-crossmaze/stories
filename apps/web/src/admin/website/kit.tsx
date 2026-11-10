// Building blocks of the Website section's editors: pictures, repeatable lists, book picking, the status pill and
// the bar with Save / Preview / Publish that sits at the top of every editor.
import { type ReactNode, useEffect, useId, useRef, useState } from 'react';

import { errorText } from '../../data/api';
import { type Book, getBook, searchBooks } from '../../data/catalogue';
import { type BookRef, type Kind, type SiteImage, type SiteStatus, uploadSiteImage } from '../../data/site';
import { BookCover } from '../../shared/BookCover';
import { Badge, Icon, type Tone } from '../../shared/ui';
import { TextField } from '../../shared/fields';
import { st } from '../../strings/site';
import './website.css';

const TONE: Record<SiteStatus, Tone> = { NONE: 'muted', DRAFT: 'muted', IN_REVIEW: 'info', HIDDEN: 'muted', LIVE: 'ok', CHANGED: 'warn', UPCOMING: 'info', ENDED: 'muted' };
export function SiteStatusBadge({ status }: { status: SiteStatus }) {
  return <Badge tone={TONE[status]}>{st.status[status]}</Badge>;
}

/** One picture with its description (for screen readers and search engines). */
export function ImageField({ label, value, onChange, hint }: { label: string; value: SiteImage | null; onChange: (v: SiteImage | null) => void; hint?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pick = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) return setError(st.notAPicture);
    setBusy(true);
    setError(null);
    try {
      onChange({ url: await uploadSiteImage(file), alt: value?.alt ?? '' });
    } catch (e) {
      setError(errorText(e, st.uploadFailed));
    } finally {
      setBusy(false);
    }
  };
  return (
    <fieldset className="choices image-field">
      <legend>{label}</legend>
      {hint && <p className="muted small">{hint}</p>}
      <div className="image-row">
        {value ? <img className="image-thumb" src={value.url} alt="" /> : <span className="image-thumb empty" aria-hidden="true"><Icon name="camera" /></span>}
        <div className="image-actions">
          <input ref={input} type="file" accept="image/jpeg,image/png,image/webp,image/*" hidden aria-label={label} onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ''; }} />
          <button type="button" className="btn btn-outlined" disabled={busy} onClick={() => input.current?.click()}>
            {busy ? st.uploading : value ? st.changePicture : st.addPicture}
          </button>
          {value && (
            <button type="button" className="btn btn-text" onClick={() => onChange(null)}>
              {st.remove}
            </button>
          )}
        </div>
      </div>
      {value && <TextField label={st.altText} hint={st.altHint} value={value.alt} onChange={(alt) => onChange({ ...value, alt })} />}
      {error && <span className="field-error">{error}</span>}
    </fieldset>
  );
}

/** A list of pictures (the first is the cover), with descriptions, order and removal. */
export function ImagesField({ label, value, onChange, max, hint }: { label: string; value: SiteImage[]; onChange: (v: SiteImage[]) => void; max: number; hint?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const add = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    setError(null);
    try {
      const room = Math.max(0, max - value.length);
      const urls: SiteImage[] = [];
      for (const f of [...files].slice(0, room)) if (f.type.startsWith('image/')) urls.push({ url: await uploadSiteImage(f), alt: '' });
      onChange([...value, ...urls]);
    } catch (e) {
      setError(errorText(e, st.uploadFailed));
    } finally {
      setBusy(false);
    }
  };
  return (
    <fieldset className="choices">
      <legend>{label}</legend>
      {hint && <p className="muted small">{hint}</p>}
      <ul className="image-list">
        {value.map((img, i) => (
          <li key={img.url}>
            <img className="image-thumb" src={img.url} alt="" />
            <TextField label={`${st.altText} (${i + 1})`} value={img.alt} onChange={(alt) => onChange(value.map((x, j) => (j === i ? { ...x, alt } : x)))} />
            <span className="row-buttons">
              <button type="button" className="btn btn-text" disabled={i === 0} onClick={() => onChange(move(value, i, -1))} aria-label={st.moveUp}>↑</button>
              <button type="button" className="btn btn-text" disabled={i === value.length - 1} onClick={() => onChange(move(value, i, 1))} aria-label={st.moveDown}>↓</button>
              <button type="button" className="btn btn-text" onClick={() => onChange(value.filter((_, j) => j !== i))}>{st.remove}</button>
            </span>
          </li>
        ))}
      </ul>
      <input ref={input} type="file" accept="image/*" multiple hidden aria-label={label} onChange={(e) => { void add(e.target.files); e.target.value = ''; }} />
      {value.length < max && (
        <button type="button" className="btn btn-outlined align-start" disabled={busy} onClick={() => input.current?.click()}>
          <Icon name="plus" /> {busy ? st.uploading : st.addPictures}
        </button>
      )}
      {error && <span className="field-error">{error}</span>}
    </fieldset>
  );
}

export const move = <T,>(list: T[], i: number, by: number) => {
  const next = [...list];
  const [x] = next.splice(i, 1);
  next.splice(i + by, 0, x);
  return next;
};

/** A repeatable list of rows (FAQs, activities, notices…): add, remove and reorder. */
export function ListEditor<T>({ legend, items, onChange, make, max, addLabel, children, hint }: {
  legend: string;
  items: T[];
  onChange: (v: T[]) => void;
  make: () => T;
  max: number;
  addLabel: string;
  hint?: string;
  children: (item: T, set: (v: T) => void, index: number) => ReactNode;
}) {
  return (
    <fieldset className="choices list-editor">
      <legend>{legend}</legend>
      {hint && <p className="muted small">{hint}</p>}
      {items.map((item, i) => (
        <div className="list-row" key={i}>
          <div className="list-row-fields">{children(item, (v) => onChange(items.map((x, j) => (j === i ? v : x))), i)}</div>
          <span className="row-buttons">
            <button type="button" className="btn btn-text" disabled={i === 0} onClick={() => onChange(move(items, i, -1))} aria-label={st.moveUp}>↑</button>
            <button type="button" className="btn btn-text" disabled={i === items.length - 1} onClick={() => onChange(move(items, i, 1))} aria-label={st.moveDown}>↓</button>
            <button type="button" className="btn btn-text" onClick={() => onChange(items.filter((_, j) => j !== i))}>{st.remove}</button>
          </span>
        </div>
      ))}
      {items.length < max && (
        <button type="button" className="btn btn-outlined align-start" onClick={() => onChange([...items, make()])}>
          <Icon name="plus" /> {addLabel}
        </button>
      )}
    </fieldset>
  );
}

/** Free words as a list ("Kannada, English"), edited as one line. */
export function WordsField({ label, value, onChange, hint, max }: { label: string; value: string[]; onChange: (v: string[]) => void; hint?: string; max: number }) {
  const [text, setText] = useState(value.join(', '));
  useEffect(() => setText(value.join(', ')), [value]);
  return (
    <TextField
      label={label}
      hint={hint}
      value={text}
      onChange={(v) => {
        setText(v);
        onChange(v.split(',').map((x) => x.trim()).filter(Boolean).slice(0, max));
      }}
    />
  );
}

/** Text with the website's little formatting, and a reminder of it. */
export function RichField({ label, value, onChange, rows = 6, hint }: { label: string; value: string; onChange: (v: string) => void; rows?: number; hint?: string }) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <textarea id={id} rows={rows} value={value} onChange={(e) => onChange(e.target.value)} aria-describedby={`${id}-hint`} />
      <span id={`${id}-hint`} className="field-hint">
        {hint ? `${hint} ` : ''}
        {st.richHint}
      </span>
    </div>
  );
}

/** Pick books from the catalogue, each with a short note. */
export function BookPicker({ legend, value, onChange, max, hint, notes = true }: { legend: string; value: BookRef[]; onChange: (v: BookRef[]) => void; max: number; hint?: string; notes?: boolean }) {
  const [q, setQ] = useState('');
  const [found, setFound] = useState<Book[]>([]);
  const [known, setKnown] = useState<Record<string, Book>>({});
  const [busy, setBusy] = useState(false);
  // Books picked earlier: look their titles and covers up.
  useEffect(() => {
    const missing = value.map((v) => v.bookId).filter((id) => !known[id]);
    if (!missing.length) return;
    let live = true;
    void Promise.all(missing.map((id) => getBook(id).catch(() => null))).then((books) => {
      if (live) setKnown((k) => ({ ...k, ...Object.fromEntries(books.filter((b): b is Book => !!b).map((b) => [b.id, b])) }));
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.map((v) => v.bookId).join(',')]);
  const search = async () => {
    if (q.trim().length < 2) return;
    setBusy(true);
    try {
      setFound((await searchBooks(q, '', undefined, 'ACTIVE')).items.slice(0, 8));
    } finally {
      setBusy(false);
    }
  };
  const add = (b: Book) => {
    if (value.some((x) => x.bookId === b.id) || value.length >= max) return;
    setKnown((k) => ({ ...k, [b.id]: b }));
    onChange([...value, { bookId: b.id, note: '' }]);
  };
  return (
    <fieldset className="choices">
      <legend>{legend}</legend>
      {hint && <p className="muted small">{hint}</p>}
      <ul className="book-picks">
        {value.map((ref, i) => {
          const b = known[ref.bookId];
          return (
            <li key={ref.bookId}>
              {b ? <BookCover title={b.title} author={b.authorNames.join(', ')} seed={b.id} url={b.coverUrl} size="sm" /> : <span className="image-thumb empty" aria-hidden="true"><Icon name="book" /></span>}
              <div className="list-row-fields">
                <strong>{b ? b.title : st.bookFromCatalogue}</strong>
                {notes && <TextField label={st.bookNote} value={ref.note} onChange={(note) => onChange(value.map((x, j) => (j === i ? { ...x, note } : x)))} />}
              </div>
              <span className="row-buttons">
                <button type="button" className="btn btn-text" disabled={i === 0} onClick={() => onChange(move(value, i, -1))} aria-label={st.moveUp}>↑</button>
                <button type="button" className="btn btn-text" onClick={() => onChange(value.filter((_, j) => j !== i))}>{st.remove}</button>
              </span>
            </li>
          );
        })}
      </ul>
      {value.length < max && (
        <div className="toolbar">
          <input className="search" type="search" value={q} placeholder={st.findBook} aria-label={st.findBook} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), void search())} />
          <button type="button" className="btn btn-outlined" disabled={busy} onClick={() => void search()}>
            {st.search}
          </button>
        </div>
      )}
      {!!found.length && (
        <ul className="book-results">
          {found.map((b) => (
            <li key={b.id}>
              <button type="button" className="btn btn-text" disabled={value.some((x) => x.bookId === b.id)} onClick={() => add(b)}>
                <Icon name="plus" /> {b.title} <span className="muted small">{b.authorNames.join(', ')}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </fieldset>
  );
}

export interface EditorState {
  status: SiteStatus;
  dirty: boolean;
  busy: string | null;
  canPublish: boolean;
  isLive: boolean;
  changed: boolean;
  liveUrl?: string | null;
  previewUrl?: string | null;
  updated?: string | null;
}

/** The bar at the top of an editor: how it stands, and Save, Preview, Publish and the rest. */
export function PublishBar({ kind, state, onSave, onPublish, onUnpublish, onDiscard, onDelete, onReview, message }: {
  kind: Kind;
  state: EditorState;
  onSave: () => void;
  onPublish?: () => void;
  onUnpublish?: () => void;
  onDiscard?: () => void;
  onDelete?: () => void;
  onReview?: () => void;
  message?: { tone: 'ok' | 'error'; text: string } | null;
}) {
  const { status, dirty, busy, canPublish, isLive, changed } = state;
  return (
    <div className="publish-bar" role="region" aria-label={st.publishing}>
      <div className="publish-state">
        <SiteStatusBadge status={status} />
        <span className="muted small">{dirty ? st.unsaved : changed ? (isLive ? st.changedNotPublished : st.notPublished) : isLive ? st.upToDate : st.notPublished}</span>
        {state.updated && <span className="muted small">{state.updated}</span>}
      </div>
      <div className="publish-actions">
        {state.liveUrl && isLive && (
          <a className="btn btn-text" href={state.liveUrl} target="_blank" rel="noopener">
            {st.viewOnWebsite}
          </a>
        )}
        {state.previewUrl && (
          <a className={`btn btn-text${dirty ? ' disabled' : ''}`} href={state.previewUrl} target="_blank" rel="noopener" title={dirty ? st.saveToPreview : undefined}>
            {st.preview}
          </a>
        )}
        {onDiscard && changed && isLive && !dirty && (
          <button type="button" className="btn btn-text" disabled={!!busy} onClick={onDiscard}>
            {st.discard}
          </button>
        )}
        {onDelete && (
          <button type="button" className="btn btn-text" disabled={!!busy} onClick={onDelete}>
            {st.delete}
          </button>
        )}
        {onUnpublish && isLive && canPublish && (
          <button type="button" className="btn btn-text" disabled={!!busy} onClick={onUnpublish}>
            {st.unpublish}
          </button>
        )}
        <button type="button" className="btn btn-outlined" disabled={!!busy || !dirty} onClick={onSave}>
          {busy === 'save' ? st.saving : st.save}
        </button>
        {canPublish && onPublish ? (
          <button type="button" className="btn btn-filled" disabled={!!busy || (!changed && !dirty)} onClick={onPublish}>
            {busy === 'publish' ? st.publishingNow : dirty ? st.saveAndPublish : st.publish}
          </button>
        ) : (
          onReview && (
            <button type="button" className="btn btn-filled" disabled={!!busy || status === 'IN_REVIEW' || (!changed && !dirty)} onClick={onReview}>
              {status === 'IN_REVIEW' ? st.inReview : st.sendForReview}
            </button>
          )
        )}
      </div>
      {message && <p className={`notice notice-${message.tone === 'ok' ? 'ok' : 'error'} publish-message`} role={message.tone === 'error' ? 'alert' : 'status'}>{message.text}</p>}
      <span className="sr-only">{kind}</span>
    </div>
  );
}

/** Editor state shared by every editor: the draft, whether it was changed, and the actions with their messages. */
export function useEditor<D>(initial: D | null) {
  const [draft, setDraft] = useState<D | null>(initial);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  useEffect(() => {
    setDraft(initial);
    setDirty(false);
  }, [initial]);
  // Leaving with unsaved changes asks first.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    addEventListener('beforeunload', warn);
    return () => removeEventListener('beforeunload', warn);
  }, [dirty]);
  const update = (patch: Partial<D>) => {
    setDraft((d) => (d ? { ...d, ...patch } : d));
    setDirty(true);
    setMessage(null);
  };
  const run = async (key: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(key);
    setMessage(null);
    try {
      await fn();
      if (ok) setMessage({ tone: 'ok', text: ok });
      return true;
    } catch (e) {
      setMessage({ tone: 'error', text: errorText(e) });
      return false;
    } finally {
      setBusy(null);
    }
  };
  return { draft, setDraft, update, dirty, setDirty, busy, run, message, setMessage };
}

/** "Saved by Priya, 10 Nov, 4:05 pm". */
export function savedLine(by: string | null, at: string | null) {
  if (!at) return null;
  const when = new Date(at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  return by ? st.savedBy(by, when) : when;
}
