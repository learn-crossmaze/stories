import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';

import { useAuth } from '../../auth/AuthContext';
import { can } from '../../auth/claims';
import { ApiError, command } from '../../data/api';
import { catalogueByIsbn } from '../../data/bulkBooks';
import { type Book, importCoverInBackground, listRefs, newTitleDefaults, normalizeName, type RefItem, searchBooks } from '../../data/catalogue';
import { AGE_GROUPS, type AgeGroup, GENRES, label, LANGUAGES, READING_LEVELS } from '../../data/common';
import { type BranchStock, stockByBranch } from '../../data/inventory';
import { normalizeIsbn } from '../../shared/isbn';
import { useAsync } from '../../shared/useAsync';
import { useDebounced } from '../../shared/useDebounced';
import { usePagedQuery } from '../../shared/usePagedQuery';
import { toMinor } from '../../shared/format';
import { paths } from '../../paths';
import { t } from '../../strings';
import { EmptyState, ErrorState, Icon, SkeletonRows, StatusBadge } from '../../shared/ui';
import { ConfirmWithReason, Dialog, DialogActions, FormError, MultiPick, SelectField, TextArea, TextField, useSubmit } from '../components/Dialog';
import { BookCover, Tabs } from '../components/kit';
import { BookLookup, type Candidate } from './BookLookup';
import { lt } from '../../strings/library';
import { BookNumbering } from '../organization/NumberingDialogs';
import { useWorkspace } from '../Workspace';

/** The shared catalogue belongs to head office (server re-checks on every change). */
export function useCanEditCatalogue() {
  const { claims } = useAuth();
  const { org } = useWorkspace();
  return claims.sa || (!!org && org.type === 'CORPORATE' && can(claims, 'books.edit', org.id));
}

/** Adding titles: head office and branch managers of the corporate organization (server re-checks). */
export function useCanAddBooks() {
  const { claims } = useAuth();
  const { org } = useWorkspace();
  return claims.sa || (!!org && org.type === 'CORPORATE' && can(claims, 'books.create', org.id));
}

/** Permanently deleting archived titles: head office and catalogue managers (server re-checks). */
export function useCanDeleteBooks() {
  const { claims } = useAuth();
  const { org } = useWorkspace();
  return claims.sa || (!!org && org.type === 'CORPORATE' && can(claims, 'books.delete', org.id));
}

const csv = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);
const MAX_AUTHORS = 5;
/** Stands for "the publisher named in the form" in the publisher list (an id never contains "+"). */
const NAMED_PUBLISHER = '+named';

/**
 * The New book / Edit book form. A new book can name authors and a publisher we don't have yet (from a lookup
 * match, or typed in the authors list): they travel as names and books-create matches or adds them when the
 * book is saved, so filling the form sends nothing. Editing takes ids only.
 */
export function BookDialog({ book, onClose, onSaved }: { book?: Book; onClose: () => void; onSaved: (id: string) => void }) {
  const { claims } = useAuth();
  const { org, branch } = useWorkspace();
  const navigate = useNavigate();
  const refs = useAsync(async () => {
    const [authors, publishers, categories] = await Promise.all([listRefs('authors'), listRefs('publishers'), listRefs('categories')]);
    return { authors, publishers, categories };
  }, []);
  const [f, setF] = useState(() => {
    // A new book starts from the age group and reading level last chosen here; genres stay empty so someone chooses.
    const start = newTitleDefaults.get();
    return {
      title: book?.title ?? '',
      subtitle: book?.subtitle ?? '',
      isbn: book?.isbn ?? '',
      authorIds: book?.authorIds ?? [],
      newAuthors: [] as string[],
      publisherId: book?.publisherId ?? '',
      newPublisher: '',
      categoryIds: book?.categoryIds ?? [],
      language: book?.language ?? 'en',
      genres: (book?.genres ?? []) as string[],
      ageGroup: book?.ageGroup ?? start.ageGroup,
      /** What the age group was before a lookup match's guess replaced it; null once the person has chosen. */
      ageBeforeGuess: null as AgeGroup | null,
      minAge: book?.minAge != null ? String(book.minAge) : '',
      readingLevel: book?.readingLevel ?? start.readingLevel,
      synopsis: book?.synopsis ?? '',
      edition: book?.edition ?? '',
      year: book?.publicationYear ? String(book.publicationYear) : '',
      keywords: (book?.keywords ?? []).join(', '),
      contentTags: (book?.contentTags ?? []).join(', '),
      price: book ? String(book.replacementPriceMinor / 100) : '0',
    };
  });
  const [touched, setTouched] = useState(false);
  const [lookupCover, setLookupCover] = useState<{ url: string; source: string } | null>(null);
  const set = <K extends keyof typeof f>(k: K) => (v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }));
  const errors = {
    title: f.title.trim() ? undefined : t.required,
    authorIds: f.authorIds.length + f.newAuthors.length ? undefined : 'Choose at least one author.',
    genres: f.genres.length ? undefined : 'Choose at least one genre.',
    year: !f.year || /^\d{4}$/.test(f.year) ? undefined : 'Enter a 4-digit year.',
    price: Number.isFinite(toMinor(f.price)) && toMinor(f.price) >= 0 ? undefined : 'Enter an amount in rupees.',
  };
  const invalid = Object.values(errors).some(Boolean);
  /** Nothing typed yet: the one match for a searched ISBN may fill the form without a click. */
  const pristine = !f.title.trim() && !f.isbn.trim() && !f.authorIds.length && !f.newAuthors.length;

  // A new book whose ISBN we already have: say so under the field as soon as the ISBN is complete (typed or
  // scanned), with a link to the title, instead of after the whole form is filled. Saving refuses it either way.
  const isbn13 = book ? null : normalizeIsbn(f.isbn);
  const [ours, setOurs] = useState<{ isbn: string; id: string; title: string } | null>(null);
  /** The ISBN last looked for in our catalogue (by this effect, or by the lookup the form was filled from). */
  const checkedIsbn = useRef<string | null>(null);
  useEffect(() => {
    if (!isbn13 || isbn13 === checkedIsbn.current) return;
    let live = true;
    catalogueByIsbn(isbn13).then(
      (hit) => {
        if (!live) return; // the field has changed since: this answer is about another ISBN
        checkedIsbn.current = isbn13;
        if (hit?.existingBookId) setOurs({ isbn: isbn13, id: hit.existingBookId, title: hit.title });
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [isbn13]);
  const duplicate = ours && ours.isbn === isbn13 ? ours : null;

  const addRef = (kind: 'authors' | 'publishers' | 'categories', field: 'authorIds' | 'categoryIds' | 'publisherId') => async (name: string) => {
    const { id } = await command<{ id: string }>(`${kind}-create`, { name });
    refs.reload();
    if (field === 'publisherId') set('publisherId')(id);
    else set(field)([...(f[field] as string[]), id]);
  };

  /** The active author or publisher with this name in the loaded list (compared as the server compares names). */
  const known = (kind: 'authors' | 'publishers', name: string) =>
    (refs.data?.[kind] ?? []).find((i) => i.status === 'ACTIVE' && normalizeName(i.name) === normalizeName(name));

  /** Authors by name, split into the ones in the loaded list (ids) and the rest (names for the server), five in all. */
  const authorsFor = (names: string[], have: { authorIds: string[]; newAuthors: string[] } = { authorIds: [], newAuthors: [] }) => {
    const authorIds = [...have.authorIds];
    const newAuthors = [...have.newAuthors];
    for (const raw of names) {
      const name = raw.trim().slice(0, 100).trim();
      if (!normalizeName(name) || authorIds.length + newAuthors.length >= MAX_AUTHORS) continue;
      const hit = known('authors', name);
      if (hit ? authorIds.includes(hit.id) : newAuthors.some((n) => normalizeName(n) === normalizeName(name))) continue;
      if (hit) authorIds.push(hit.id);
      else newAuthors.push(name);
    }
    return { authorIds, newAuthors };
  };

  /** "+ name" in the authors list of a new book: no command, the name is added with the book. */
  const addAuthorName = async (name: string) => setF((s) => ({ ...s, ...authorsFor([name], s) }));

  // Removing a named author takes its button away with focus on it: focus goes to the next name's button (the
  // last one after the last name), or to the authors filter when no name is left, so it never falls out of the dialog.
  const authorsBox = useRef<HTMLDivElement>(null);
  const removedAt = useRef<number | null>(null);
  const removeAuthorName = (i: number) => {
    removedAt.current = i;
    setF((s) => ({ ...s, newAuthors: s.newAuthors.filter((_, j) => j !== i) }));
  };
  useEffect(() => {
    const i = removedAt.current;
    if (i === null) return;
    removedAt.current = null;
    const buttons = authorsBox.current?.querySelectorAll<HTMLElement>('.chips-removable button') ?? [];
    (buttons[Math.min(i, buttons.length - 1)] ?? authorsBox.current?.querySelector<HTMLElement>('.pick-filter input'))?.focus();
  }, [f.newAuthors]);

  /** Fills the form from a public-catalogue match; staff review everything before saving. Sends nothing. */
  const applyLookup = (c: Candidate) => {
    const authors = authorsFor(c.authors);
    const publisher = c.publisher && normalizeName(c.publisher) ? c.publisher.trim().slice(0, 100).trim() : '';
    const publisherId = publisher ? (known('publishers', publisher)?.id ?? '') : '';
    // The lookup has just checked this ISBN against our catalogue: no need to ask again.
    if (c.isbn && !c.existingBookId) checkedIsbn.current = normalizeIsbn(c.isbn);
    const guess = c.ageGroup && AGE_GROUPS.includes(c.ageGroup) ? c.ageGroup : null;
    setF((s) => ({
      ...s,
      title: c.title,
      subtitle: c.subtitle,
      isbn: c.isbn ?? '',
      ...(authors.authorIds.length + authors.newAuthors.length ? authors : {}),
      ...(publisher ? { publisherId, newPublisher: publisherId ? '' : publisher } : {}),
      language: c.language && c.language in LANGUAGES ? (c.language as Book['language']) : s.language,
      genres: c.genres.length ? c.genres : s.genres,
      // A guess from the subject headings, shown in the select for staff to confirm (never remembered as their choice).
      // A match with no guess puts back what an earlier match's guess replaced: that guess was about another book.
      ageGroup: guess ?? s.ageBeforeGuess ?? s.ageGroup,
      ageBeforeGuess: guess ? (s.ageBeforeGuess ?? s.ageGroup) : null,
      year: c.year ? String(c.year) : s.year,
      synopsis: c.synopsis || s.synopsis,
      keywords: s.keywords || c.subjects.filter((x) => !x.includes(',') && x.length <= 40).slice(0, 5).join(', '),
    }));
    setLookupCover(c.coverUrl ? { url: c.coverUrl, source: c.source } : null);
  };

  // After creating: straight on to adding its copies when this person can add copies at the branch in use.
  const canAddCopies = !book && !!org && !!branch && can(claims, 'copies.manage', org.id, branch.id);
  /** Where the save in progress goes next; "Create only" sets it for one submit. */
  const next = useRef<'copies' | 'list'>('copies');

  const { busy, error, submit } = useSubmit(async () => {
    const toCopies = canAddCopies && next.current === 'copies';
    next.current = 'copies';
    setTouched(true);
    if (invalid) return;
    const body = {
      title: f.title.trim(), subtitle: f.subtitle.trim(), isbn: f.isbn.trim(), authorIds: f.authorIds, publisherId: f.publisherId || null,
      categoryIds: f.categoryIds, language: f.language, genres: f.genres, ageGroup: f.ageGroup, minAge: f.minAge ? Number(f.minAge) : null,
      readingLevel: f.readingLevel, synopsis: f.synopsis.trim(), edition: f.edition.trim(), publicationYear: f.year ? Number(f.year) : null,
      keywords: csv(f.keywords), contentTags: csv(f.contentTags), replacementPriceMinor: toMinor(f.price),
    };
    if (book) {
      const res = await command<{ bookId: string }>('books-update', { bookId: book.id, ...body });
      onSaved(res.bookId);
      onClose();
      return;
    }
    let res: { bookId: string };
    try {
      // Names are sent only when there are some, so a book made of ids alone is the same request as it always was.
      res = await command<{ bookId: string }>('books-create', {
        ...body,
        ...(f.newAuthors.length ? { newAuthors: f.newAuthors } : {}),
        ...(f.newPublisher ? { newPublisher: f.newPublisher } : {}),
      });
    } catch (e) {
      // The ISBN turned out to be ours (it was not checked, or was added meanwhile): link to that title under the field.
      if (e instanceof ApiError && e.reason === 'DUPLICATE_ISBN' && isbn13) {
        const hit = await catalogueByIsbn(isbn13).catch(() => null);
        if (hit?.existingBookId) setOurs({ isbn: isbn13, id: hit.existingBookId, title: hit.title });
      }
      throw e;
    }
    // The book is saved; its cover is fetched without making anyone wait (one that can't be fetched can be added
    // from a photo later). From here on only the parent is touched: this dialog is closing.
    const cover = lookupCover ? importCoverInBackground(res.bookId, lookupCover.url) : null;
    onClose();
    if (toCopies) {
      // The catalogue page is being left, so its list is not reloaded; the book page shows the cover when it lands.
      navigate(`${paths.adminBook(res.bookId)}?acquire=1`);
      return;
    }
    onSaved(res.bookId);
    void cover?.then((added) => added && onSaved(res.bookId));
  });

  const opts = (items: RefItem[] | undefined) => (items ?? []).filter((i) => i.status === 'ACTIVE').map((i) => ({ value: i.id, label: i.name }));
  return (
    <Dialog title={book ? lt.editBook : lt.newBook} onClose={onClose}>
      <form onSubmit={submit} noValidate className="form-grid">
        {!book && <BookLookup onPick={applyLookup} pristine={pristine} />}
        {lookupCover && (
          <div className="span-2 lookup-cover-note">
            <img src={lookupCover.url} alt="" className="lookup-cover" />
            <span className="small">{lt.lookupCoverNote(lookupCover.source)}</span>
            <button type="button" className="btn btn-text" onClick={() => setLookupCover(null)}>
              {lt.lookupCoverSkip}
            </button>
          </div>
        )}
        <div className="span-2">
          <TextField label={lt.title} value={f.title} onChange={set('title')} error={touched ? errors.title : undefined} />
        </div>
        <TextField label={lt.subtitle} value={f.subtitle} onChange={set('subtitle')} />
        <div>
          <TextField label={lt.isbn} value={f.isbn} onChange={set('isbn')} hint={lt.isbnHint} />
          {duplicate && (
            <p className="muted small" role="status">
              {lt.isbnOurs(duplicate.title)} <Link to={paths.adminBook(duplicate.id)}>{lt.bulkOpenBook}</Link>
            </p>
          )}
        </div>
        <div className="span-2" ref={authorsBox}>
          <MultiPick
            legend={lt.authors}
            options={opts(refs.data?.authors)}
            value={f.authorIds}
            // Names count towards the five: the list can never tick more than what is left.
            onChange={(ids) => set('authorIds')(ids.slice(0, MAX_AUTHORS - f.newAuthors.length))}
            max={Math.max(1, MAX_AUTHORS - f.newAuthors.length)}
            error={touched ? errors.authorIds : undefined}
            onAdd={book ? addRef('authors', 'authorIds') : addAuthorName}
          />
          {f.newAuthors.length > 0 && (
            <>
              <p className="muted small">{lt.namedAuthors}</p>
              <ul className="chips chips-removable">
                {f.newAuthors.map((n, i) => (
                  <li key={n}>
                    {n}
                    <button type="button" className="btn btn-text" aria-label={lt.removeNamed(n)} title={lt.removeNamed(n)} onClick={() => removeAuthorName(i)}>
                      <Icon name="close" />
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
        <SelectField
          label={lt.publisher}
          value={f.newPublisher ? NAMED_PUBLISHER : f.publisherId}
          // Choosing from the list (or None) replaces a publisher named by a lookup match.
          onChange={(v) => v !== NAMED_PUBLISHER && setF((s) => ({ ...s, publisherId: v, newPublisher: '' }))}
          options={[
            { value: '', label: lt.noPublisher },
            ...(f.newPublisher ? [{ value: NAMED_PUBLISHER, label: lt.namedPublisher(f.newPublisher) }] : []),
            ...opts(refs.data?.publishers),
          ]}
        />
        <SelectField label={lt.language} value={f.language} onChange={set('language')} options={Object.entries(LANGUAGES).map(([value, l]) => ({ value: value as Book['language'], label: l }))} />
        <div className="span-2">
          <MultiPick legend={lt.genres} options={GENRES.map((g) => ({ value: g, label: label(g) }))} value={f.genres} onChange={set('genres')} max={3} error={touched ? errors.genres : undefined} />
        </div>
        <SelectField
          label={lt.ageGroup}
          value={f.ageGroup}
          onChange={(ageGroup) => {
            setF((s) => ({ ...s, ageGroup, ageBeforeGuess: null }));
            if (!book) newTitleDefaults.set({ ageGroup });
          }}
          options={AGE_GROUPS.map((a) => ({ value: a, label: label(a) }))}
        />
        <SelectField
          label={lt.readingLevel}
          value={f.readingLevel}
          onChange={(readingLevel) => {
            set('readingLevel')(readingLevel);
            if (!book) newTitleDefaults.set({ readingLevel });
          }}
          options={READING_LEVELS.map((r) => ({ value: r, label: label(r) }))}
        />
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
          {canAddCopies ? (
            // The one submit button (so Enter uses it) goes on to the copies; "Create only" stays on the catalogue.
            <div className="dialog-actions">
              <button type="button" className="btn btn-text" onClick={onClose} disabled={busy}>
                {t.cancel}
              </button>
              <button
                type="button"
                className="btn btn-outlined"
                disabled={busy}
                onClick={() => {
                  next.current = 'list';
                  void submit();
                }}
              >
                {lt.createOnly}
              </button>
              <button type="submit" className="btn btn-filled" disabled={busy}>
                {busy ? t.saving : lt.createAndCopies}
              </button>
            </div>
          ) : (
            <DialogActions busy={busy} submitLabel={book ? t.save : t.create} onCancel={onClose} />
          )}
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
    <Dialog title={t.rename} onClose={onClose} narrow>
      <form onSubmit={submit} noValidate>
        <TextField label={lt.refName} value={name} onChange={setName} />
        <FormError error={error} />
        <DialogActions busy={busy} submitLabel={t.save} onCancel={onClose} />
      </form>
    </Dialog>
  );
}

/** "Central 2/3 · North 0/1": where a title is, the user's own branch first. */
function StockLine({ stock, here }: { stock: BranchStock[] | undefined; here: string | undefined }) {
  if (!stock) return <span className="stock small muted">{lt.stockLoading}</span>;
  if (!stock.length) return <span className="stock small muted">{lt.stockNone}</span>;
  const sorted = [...stock].sort((a, b) => Number(b.branchId === here) - Number(a.branchId === here));
  return (
    <span className="stock small">
      {sorted.map((s) => (
        <span key={s.branchId} className={`stock-chip${s.available ? ' ok' : ''}${s.branchId === here ? ' here' : ''}`} title={lt.stockAt(s.branchName, s.available, s.total)}>
          {s.branchName} {s.available}/{s.total}
        </span>
      ))}
    </span>
  );
}

export function CataloguePage() {
  const canEdit = useCanEditCatalogue();
  const canAdd = useCanAddBooks();
  const [q, setQ] = useState('');
  const [age, setAge] = useState<AgeGroup | ''>('');
  const [status, setStatus] = useState<Book['status'] | ''>('');
  const debounced = useDebounced(q);
  const list = usePagedQuery<Book>((after) => searchBooks(debounced, age, after, status), [debounced, age, status]);
  const books = list.items;
  const [attempt, setAttempt] = useState(0);
  const [dialog, setDialog] = useState<'book' | 'refs' | 'numbering' | null>(null);
  const { org, branch } = useWorkspace();
  const [stock, setStock] = useState<Record<string, BranchStock[]>>({});
  const [stockFailed, setStockFailed] = useState(false);

  // Which branches hold each listed title (fetched for the titles not looked up yet).
  useEffect(() => {
    const missing = books.map((b) => b.id).filter((id) => !(id in stock));
    if (!org || !missing.length || stockFailed) return;
    let live = true;
    stockByBranch(org.id, missing.slice(0, 60))
      .then((found) => live && setStock((s) => ({ ...s, ...found })))
      .catch((e) => {
        // Branch counts are extra: the list still works without them.
        console.warn('availability', e);
        if (live) setStockFailed(true);
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [org?.id, books]);
  useEffect(() => {
    setStock({});
    setStockFailed(false);
  }, [org?.id, attempt]);

  const reload = () => {
    setAttempt((n) => n + 1);
    list.reload();
  };

  return (
    <>
      <header className="page-header page-header-row">
        <h1>{lt.catalogueTitle}</h1>
        {(canEdit || canAdd) && (
          <div className="row">
            {canEdit && (
              <>
                <button type="button" className="btn btn-outlined" onClick={() => setDialog('refs')}>
                  {lt.referenceData}
                </button>
                <button type="button" className="btn btn-outlined" onClick={() => setDialog('numbering')}>
                  {lt.numberingBookTitle}
                </button>
              </>
            )}
            <Link className="btn btn-outlined" to={paths.adminBooksBulk}>
              {lt.bulkNav}
            </Link>
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
        <select value={status} onChange={(e) => setStatus(e.target.value as Book['status'] | '')} aria-label={lt.status}>
          <option value="">{lt.allTitles}</option>
          <option value="ACTIVE">{lt.activeTitles}</option>
          <option value="ARCHIVED">{lt.archivedTitles}</option>
        </select>
      </div>
      {list.error && books.length === 0 ? (
        <ErrorState message={list.error} onRetry={reload} />
      ) : list.loading && books.length === 0 ? (
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
                    {!stockFailed && <StockLine stock={stock[b.id]} here={branch?.id} />}
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
          {list.error && <p className="form-error" role="alert">{list.error}</p>}
          {list.hasMore && (
            <button type="button" className="btn btn-outlined load-more" disabled={list.loading} onClick={list.loadMore}>
              {list.loading ? t.loading : t.loadMore}
            </button>
          )}
        </>
      )}
      {dialog === 'book' && <BookDialog onClose={() => setDialog(null)} onSaved={reload} />}
      {dialog === 'refs' && <RefDataDialog onClose={() => setDialog(null)} />}
      {dialog === 'numbering' && <BookNumbering onClose={() => setDialog(null)} />}
    </>
  );
}
