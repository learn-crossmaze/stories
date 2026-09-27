import type { DocumentSnapshot } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';

import { useAuth } from '../../auth/AuthContext';
import { can } from '../../auth/claims';
import { command } from '../../data/api';
import {
  AGE_GROUPS,
  type AgeGroup,
  type Book,
  GENRES,
  label,
  LANGUAGES,
  listRefs,
  READING_LEVELS,
  type RefItem,
  searchBooks,
} from '../../data/library';
import { useAsync } from '../../data/useAsync';
import { useDebounced } from '../../data/useDebounced';
import { toMinor } from '../../format';
import { paths } from '../../paths';
import { t } from '../../strings';
import { EmptyState, ErrorState, Icon, SkeletonRows, StatusBadge } from '../../ui';
import { ConfirmWithReason, Dialog, DialogActions, FormError, MultiPick, SelectField, TextArea, TextField, useSubmit } from '../Dialog';
import { BookCover, Tabs } from '../kit';
import { lt } from '../libraryStrings';
import { BookNumbering } from '../NumberingDialogs';
import { useWorkspace } from '../Workspace';

/** The shared catalogue belongs to head office (server re-checks on every change). */
export function useCanEditCatalogue() {
  const { claims } = useAuth();
  const { org } = useWorkspace();
  return claims.sa || (!!org && org.type === 'CORPORATE' && can(claims, 'books.edit', org.id));
}

const csv = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);

export function BookDialog({ book, onClose, onSaved }: { book?: Book; onClose: () => void; onSaved: (id: string) => void }) {
  const refs = useAsync(async () => ({ authors: await listRefs('authors'), publishers: await listRefs('publishers'), categories: await listRefs('categories') }), []);
  const [f, setF] = useState({
    title: book?.title ?? '',
    subtitle: book?.subtitle ?? '',
    isbn: book?.isbn ?? '',
    authorIds: book?.authorIds ?? [],
    publisherId: book?.publisherId ?? '',
    categoryIds: book?.categoryIds ?? [],
    language: book?.language ?? 'en',
    genres: (book?.genres ?? []) as string[],
    ageGroup: book?.ageGroup ?? 'ADULTS',
    minAge: book?.minAge != null ? String(book.minAge) : '',
    readingLevel: book?.readingLevel ?? 'INTERMEDIATE',
    synopsis: book?.synopsis ?? '',
    edition: book?.edition ?? '',
    year: book?.publicationYear ? String(book.publicationYear) : '',
    keywords: (book?.keywords ?? []).join(', '),
    contentTags: (book?.contentTags ?? []).join(', '),
    price: book ? String(book.replacementPriceMinor / 100) : '0',
  });
  const [touched, setTouched] = useState(false);
  const set = <K extends keyof typeof f>(k: K) => (v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }));
  const errors = {
    title: f.title.trim() ? undefined : t.required,
    authorIds: f.authorIds.length ? undefined : 'Choose at least one author.',
    genres: f.genres.length ? undefined : 'Choose at least one genre.',
    year: !f.year || /^\d{4}$/.test(f.year) ? undefined : 'Enter a 4-digit year.',
    price: Number.isFinite(toMinor(f.price)) && toMinor(f.price) >= 0 ? undefined : 'Enter an amount in rupees.',
  };
  const invalid = Object.values(errors).some(Boolean);

  const addRef = (kind: 'authors' | 'publishers' | 'categories', field: 'authorIds' | 'categoryIds' | 'publisherId') => async (name: string) => {
    const { id } = await command<{ id: string }>(`${kind}-create`, { name });
    refs.reload();
    if (field === 'publisherId') set('publisherId')(id);
    else set(field)([...(f[field] as string[]), id]);
  };

  const { busy, error, submit } = useSubmit(async () => {
    setTouched(true);
    if (invalid) return;
    const body = {
      title: f.title.trim(), subtitle: f.subtitle.trim(), isbn: f.isbn.trim(), authorIds: f.authorIds, publisherId: f.publisherId || null,
      categoryIds: f.categoryIds, language: f.language, genres: f.genres, ageGroup: f.ageGroup, minAge: f.minAge ? Number(f.minAge) : null,
      readingLevel: f.readingLevel, synopsis: f.synopsis.trim(), edition: f.edition.trim(), publicationYear: f.year ? Number(f.year) : null,
      keywords: csv(f.keywords), contentTags: csv(f.contentTags), replacementPriceMinor: toMinor(f.price),
    };
    const res = book ? await command<{ bookId: string }>('books-update', { bookId: book.id, ...body }) : await command<{ bookId: string }>('books-create', body);
    onSaved(res.bookId);
    onClose();
  });

  const opts = (items: RefItem[] | undefined) => (items ?? []).filter((i) => i.status === 'ACTIVE').map((i) => ({ value: i.id, label: i.name }));
  return (
    <Dialog title={book ? lt.editBook : lt.newBook} onClose={onClose}>
      <form onSubmit={submit} noValidate className="form-grid">
        <div className="span-2">
          <TextField label={lt.title} value={f.title} onChange={set('title')} error={touched ? errors.title : undefined} />
        </div>
        <TextField label={lt.subtitle} value={f.subtitle} onChange={set('subtitle')} />
        <TextField label={lt.isbn} value={f.isbn} onChange={set('isbn')} hint={lt.isbnHint} />
        <div className="span-2">
          <MultiPick legend={lt.authors} options={opts(refs.data?.authors)} value={f.authorIds} onChange={set('authorIds')} max={5} error={touched ? errors.authorIds : undefined} onAdd={addRef('authors', 'authorIds')} />
        </div>
        <SelectField label={lt.publisher} value={f.publisherId} onChange={set('publisherId')} options={[{ value: '', label: lt.noPublisher }, ...opts(refs.data?.publishers)]} />
        <SelectField label={lt.language} value={f.language} onChange={set('language')} options={Object.entries(LANGUAGES).map(([value, l]) => ({ value: value as Book['language'], label: l }))} />
        <div className="span-2">
          <MultiPick legend={lt.genres} options={GENRES.map((g) => ({ value: g, label: label(g) }))} value={f.genres} onChange={set('genres')} max={3} error={touched ? errors.genres : undefined} />
        </div>
        <SelectField label={lt.ageGroup} value={f.ageGroup} onChange={set('ageGroup')} options={AGE_GROUPS.map((a) => ({ value: a, label: label(a) }))} />
        <SelectField label={lt.readingLevel} value={f.readingLevel} onChange={set('readingLevel')} options={READING_LEVELS.map((r) => ({ value: r, label: label(r) }))} />
        <TextField label={lt.minAge} type="number" value={f.minAge} onChange={set('minAge')} />
        <TextField label={lt.year} value={f.year} onChange={set('year')} error={touched ? errors.year : undefined} />
        <TextField label={lt.edition} value={f.edition} onChange={set('edition')} />
        <TextField label={lt.replacementPrice} value={f.price} onChange={set('price')} hint={lt.replacementHint} error={touched ? errors.price : undefined} />
        <div className="span-2">
          <MultiPick legend={lt.categories} options={opts(refs.data?.categories)} value={f.categoryIds} onChange={set('categoryIds')} max={5} onAdd={addRef('categories', 'categoryIds')} />
        </div>
        <div className="span-2">
          <TextArea label={lt.synopsis} value={f.synopsis} onChange={set('synopsis')} rows={4} />
        </div>
        <TextField label={lt.keywords} value={f.keywords} onChange={set('keywords')} />
        <TextField label={lt.contentTags} value={f.contentTags} onChange={set('contentTags')} />
        <div className="span-2">
          <FormError error={error} />
          <DialogActions busy={busy} submitLabel={book ? t.save : t.create} onCancel={onClose} />
        </div>
      </form>
    </Dialog>
  );
}

type RefKind = 'authors' | 'publishers' | 'categories';

function RefDataDialog({ onClose }: { onClose: () => void }) {
  const [kind, setKind] = useState<RefKind>('authors');
  const items = useAsync(() => listRefs(kind), [kind]);
  const [name, setName] = useState('');
  const [renaming, setRenaming] = useState<RefItem | null>(null);
  const [archiving, setArchiving] = useState<RefItem | null>(null);
  const add = useSubmit(async () => {
    if (name.trim().length < 2) return;
    await command(`${kind}-create`, { name: name.trim() });
    setName('');
    items.reload();
  });
  return (
    <Dialog title={lt.referenceData} onClose={onClose}>
      <Tabs
        tabs={[
          { value: 'authors', label: lt.authorsTab },
          { value: 'publishers', label: lt.publishersTab },
          { value: 'categories', label: lt.categoriesTab },
        ]}
        value={kind}
        onChange={setKind}
      />
      <form onSubmit={add.submit} className="inline-form">
        <TextField label={lt.refName} value={name} onChange={setName} />
        <button type="submit" className="btn btn-filled" disabled={add.busy || name.trim().length < 2}>
          {lt.addNew}
        </button>
      </form>
      <FormError error={add.error} />
      {items.loading ? (
        <SkeletonRows rows={3} />
      ) : !items.data?.length ? (
        <p className="muted">{lt.refEmpty}</p>
      ) : (
        <ul className="plain-list">
          {items.data.map((i) => (
            <li key={i.id}>
              <span>{i.name}</span>
              <StatusBadge status={i.status} />
              {i.status === 'ACTIVE' && (
                <span className="cell-actions">
                  <button type="button" className="btn btn-text" onClick={() => setRenaming(i)}>
                    {t.rename}
                  </button>
                  <button type="button" className="btn btn-text" onClick={() => setArchiving(i)}>
                    {t.archive}
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="dialog-actions">
        <button type="button" className="btn btn-text" onClick={onClose}>
          {t.close}
        </button>
      </div>
      {renaming && <RenameDialog kind={kind} item={renaming} onClose={() => setRenaming(null)} onSaved={items.reload} />}
      {archiving && (
        <ConfirmWithReason
          title={`${t.archive} ${archiving.name}?`}
          body=""
          confirmLabel={t.archive}
          onClose={() => setArchiving(null)}
          onConfirm={async (reason) => {
            await command(`${kind}-archive`, { id: archiving.id, reason });
            items.reload();
            setArchiving(null);
          }}
        />
      )}
    </Dialog>
  );
}

function RenameDialog({ kind, item, onClose, onSaved }: { kind: RefKind; item: RefItem; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(item.name);
  const { busy, error, submit } = useSubmit(async () => {
    await command(`${kind}-rename`, { id: item.id, name: name.trim() });
    onSaved();
    onClose();
  });
  return (
    <Dialog title={t.rename} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <TextField label={lt.refName} value={name} onChange={setName} />
        <FormError error={error} />
        <DialogActions busy={busy} submitLabel={t.save} onCancel={onClose} />
      </form>
    </Dialog>
  );
}

export function CataloguePage() {
  const canEdit = useCanEditCatalogue();
  const [q, setQ] = useState('');
  const [age, setAge] = useState<AgeGroup | ''>('');
  const debounced = useDebounced(q);
  const [books, setBooks] = useState<Book[]>([]);
  const [cursor, setCursor] = useState<DocumentSnapshot | undefined>();
  const [state, setState] = useState<{ loading: boolean; error: string | null }>({ loading: true, error: null });
  const [attempt, setAttempt] = useState(0);
  const [dialog, setDialog] = useState<'book' | 'refs' | 'numbering' | null>(null);

  const load = async (after?: DocumentSnapshot) => {
    setState({ loading: true, error: null });
    try {
      const page = await searchBooks(debounced, age, after);
      setBooks((prev) => (after ? [...prev, ...page.items] : page.items));
      setCursor(page.cursor);
      setState({ loading: false, error: null });
    } catch (e) {
      console.error(e);
      setState({ loading: false, error: t.errorLoad });
    }
  };
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced, age, attempt]);

  return (
    <>
      <header className="page-header page-header-row">
        <h1>{lt.catalogueTitle}</h1>
        {canEdit && (
          <div className="row">
            <button type="button" className="btn btn-outlined" onClick={() => setDialog('refs')}>
              {lt.referenceData}
            </button>
            <button type="button" className="btn btn-outlined" onClick={() => setDialog('numbering')}>
              {lt.numberingBookTitle}
            </button>
            <button type="button" className="btn btn-filled" onClick={() => setDialog('book')}>
              <Icon name="plus" /> {lt.newBook}
            </button>
          </div>
        )}
      </header>
      <div className="toolbar">
        <input className="search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={lt.searchBooks} aria-label={lt.searchBooks} />
        <select value={age} onChange={(e) => setAge(e.target.value as AgeGroup | '')} aria-label={lt.ageGroup}>
          <option value="">{lt.allAges}</option>
          {AGE_GROUPS.map((a) => (
            <option key={a} value={a}>
              {label(a)}
            </option>
          ))}
        </select>
      </div>
      {state.error && books.length === 0 ? (
        <ErrorState message={state.error} onRetry={() => setAttempt((n) => n + 1)} />
      ) : state.loading && books.length === 0 ? (
        <SkeletonRows rows={6} />
      ) : books.length === 0 ? (
        <EmptyState icon="book" title={lt.booksEmpty} message={lt.booksEmptyHint} />
      ) : (
        <>
          <ul className="book-list">
            {books.map((b) => (
              <li key={b.id}>
                <Link to={paths.adminBook(b.id)} className="book-row">
                  <BookCover title={b.title} seed={b.id} url={b.coverUrl} size="sm" />
                  <span className="book-main">
                    <span className="book-title">{b.title}</span>
                    <span className="muted small">{b.authorNames.join(', ')}</span>
                  </span>
                  <span className="book-meta small">
                    <span className="mono">{b.code}</span>
                    <span>{label(b.ageGroup)} · {b.genres.map(label).join(', ')}</span>
                  </span>
                  {b.status !== 'ACTIVE' && <StatusBadge status={b.status} />}
                </Link>
              </li>
            ))}
          </ul>
          {cursor && (
            <button type="button" className="btn btn-outlined load-more" disabled={state.loading} onClick={() => load(cursor)}>
              {state.loading ? t.loading : t.loadMore}
            </button>
          )}
        </>
      )}
      {dialog === 'book' && <BookDialog onClose={() => setDialog(null)} onSaved={() => setAttempt((n) => n + 1)} />}
      {dialog === 'refs' && <RefDataDialog onClose={() => setDialog(null)} />}
      {dialog === 'numbering' && <BookNumbering onClose={() => setDialog(null)} />}
    </>
  );
}
