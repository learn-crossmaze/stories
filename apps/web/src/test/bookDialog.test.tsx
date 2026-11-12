import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FirebaseError } from 'firebase/app';
import { useState } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Candidate } from '../admin/catalogue/BookLookup';
import type { Book, RefItem } from '../data/catalogue';
import { t } from '../strings';
import { lt } from '../strings/library';

// The New book form and the book page it leads to, with the server faked at the Cloud Functions boundary and
// our own catalogue (the direct reads) held by the test.
type Sent = Record<string, unknown> & { action: string; requestId?: string };
const calls: Sent[] = [];
let respond: (data: Sent) => unknown = () => ({});

vi.mock('firebase/functions', () => ({
  httpsCallable: () => async (data: Sent) => {
    calls.push(data);
    const answer = await respond(data);
    if (answer instanceof Error) throw answer;
    return { data: answer };
  },
}));
vi.mock('../data/services', () => ({ services: () => ({ fns: {}, db: {} }) }));

/** Who is signed in: a Super Admin may do everything, the other one nothing (no copies, no catalogue edits). */
let claims = { v: 1, sa: true, o: {} };
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ claims }) }));
let branch: { id: string; name: string } | null = { id: 'b1', name: 'Central' };
vi.mock('../admin/Workspace', () => ({
  useWorkspace: () => ({ org: { id: 'o1', type: 'CORPORATE' }, branch, orgsLoading: false, branchesLoading: false }),
}));

/** Titles in our catalogue by ISBN; a thrown error plays a failed read. */
let ours: (isbn: string) => Candidate | null = () => null;
const catalogueReads: string[] = [];
vi.mock('../data/bulkBooks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../data/bulkBooks')>()),
  catalogueByIsbn: async (isbn: string) => {
    catalogueReads.push(isbn);
    return ours(isbn);
  },
}));
let lists: Record<'authors' | 'publishers' | 'categories', RefItem[]>;
let stored: Book | null = null;
let bookReads = 0;
vi.mock('../data/catalogue', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../data/catalogue')>()),
  listRefs: async (kind: 'authors' | 'publishers' | 'categories') => lists[kind],
  getBook: async () => {
    bookReads++;
    return stored;
  },
}));
vi.mock('../data/inventory', () => ({ listLocations: async () => [], copiesOfBook: async () => [] }));

const { BookDialog } = await import('../admin/catalogue/Catalogue');
const { BookDetailPage } = await import('../admin/catalogue/BookDetail');
const { importCoverInBackground, coverImportOf } = await import('../data/catalogue');

const ISBN = '9780306406157';
const candidate = (extra: Partial<Candidate> = {}): Candidate => ({
  source: 'Google Books', title: 'The Blue Umbrella', subtitle: '', authors: ['Ruskin Bond'], publisher: 'Rupa', year: 1980, isbn: ISBN, language: 'en',
  synopsis: 'A girl and her umbrella.', genres: ['FICTION'], ageGroup: null, subjects: [], coverUrl: null, existingBookId: null, ...extra,
});
const inCatalogue = (isbn: string): Candidate => candidate({ source: 'catalogue', title: 'Treasure Island', authors: ['Robert Louis Stevenson'], isbn, existingBookId: 'bk1' });
const sent = (action: string) => calls.filter((c) => c.action === action);

function Where() {
  const at = useLocation();
  return <p data-testid="where">{at.pathname + at.search}</p>;
}
const where = () => screen.getByTestId('where').textContent;

/** The dialog as the catalogue page holds it: closing it takes it off the screen. */
function Opened({ onClose, onSaved }: { onClose: () => void; onSaved: (id: string) => void }) {
  const [open, setOpen] = useState(true);
  const close = () => {
    onClose();
    setOpen(false);
  };
  return open ? <BookDialog onClose={close} onSaved={onSaved} /> : null;
}

function openDialog() {
  const onSaved = vi.fn();
  const onClose = vi.fn();
  const view = render(
    <MemoryRouter initialEntries={['/ops/books']}>
      <Opened onClose={onClose} onSaved={onSaved} />
      <Where />
    </MemoryRouter>,
  );
  return { onSaved, onClose, ...view };
}
const lookupField = () => screen.getByRole('searchbox', { name: lt.lookupTitle });
const field = (name: string) => screen.getByLabelText(name) as HTMLInputElement;
async function search(user: ReturnType<typeof userEvent.setup>, term: string) {
  await user.type(lookupField(), `${term}{Enter}`);
}

beforeEach(() => {
  calls.length = 0;
  catalogueReads.length = 0;
  respond = () => ({});
  ours = () => null;
  claims = { v: 1, sa: true, o: {} };
  branch = { id: 'b1', name: 'Central' };
  stored = null;
  bookReads = 0;
  lists = {
    authors: [
      { id: 'a1', name: 'Ruskin Bond', status: 'ACTIVE' },
      { id: 'a2', name: 'Gabriel García Márquez', status: 'ACTIVE' },
      { id: 'a3', name: 'Old Entry', status: 'ARCHIVED' },
    ],
    publishers: [{ id: 'p1', name: 'Penguin', status: 'ACTIVE' }],
    categories: [],
  };
  localStorage.clear();
});

describe('New book: find book details', () => {
  it('answers an ISBN we already have from our own catalogue, without the outside lookup', async () => {
    const user = userEvent.setup();
    ours = inCatalogue;
    openDialog();
    // An ISBN-10 is looked for in its ISBN-13 form, as titles are stored.
    await search(user, '0-306-40615-2');
    const link = await screen.findByRole('link', { name: lt.lookupExisting });
    expect(link).toHaveAttribute('href', '/ops/books/bk1');
    expect(screen.getByText('Treasure Island')).toBeInTheDocument();
    expect(catalogueReads).toEqual([ISBN]);
    expect(calls).toEqual([]);
    // Nothing was filled in: the title exists, there is nothing to create.
    expect(field(lt.title).value).toBe('');
  });

  it('looks a new ISBN up outside and fills the untouched form with its one match, sending no command', async () => {
    const user = userEvent.setup();
    respond = (data) =>
      data.action === 'books-lookup'
        ? { candidates: [candidate({ authors: ['ruskin  BOND', 'New Writer', 'Old Entry'], ageGroup: 'CHILDREN' }), candidate({ source: 'Open Library', title: 'Another edition', isbn: '9780141441900' })] }
        : { bookId: 'new1', code: 'BOOK-000009' };
    const { onSaved, onClose } = openDialog();
    await screen.findByRole('checkbox', { name: 'Ruskin Bond' });
    await search(user, ISBN);

    expect(await screen.findByRole('status')).toHaveTextContent(lt.lookupApplied('The Blue Umbrella'));
    expect(field(lt.title).value).toBe('The Blue Umbrella');
    expect(field(lt.isbn).value).toBe(ISBN);
    // The author we have is ticked; the others wait as names (an archived namesake does not count as ours).
    expect(screen.getByRole('checkbox', { name: 'Ruskin Bond' })).toBeChecked();
    expect(screen.getByRole('button', { name: lt.removeNamed('New Writer') })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: lt.removeNamed('Old Entry') })).toBeInTheDocument();
    expect((screen.getByLabelText(lt.publisher) as HTMLSelectElement).selectedOptions[0]).toHaveTextContent(lt.namedPublisher('Rupa'));
    expect(field(lt.ageGroup).value).toBe('CHILDREN');
    // The other match is still there to choose instead.
    expect(screen.getByText('Another edition')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: lt.lookupUse })).toHaveLength(2);
    // One lookup, nothing created yet, and the ISBN the lookup has just checked is not read again.
    expect(calls.map((c) => c.action)).toEqual(['books-lookup']);
    expect(calls[0]).toMatchObject({ q: ISBN });
    expect(calls[0]).not.toHaveProperty('exact');
    expect(catalogueReads).toEqual([ISBN]);

    // Saving sends the names with the book and goes straight on to adding its copies.
    await user.click(screen.getByRole('button', { name: lt.removeNamed('Old Entry') }));
    await user.click(screen.getByRole('button', { name: lt.createAndCopies }));
    await waitFor(() => expect(where()).toBe('/ops/books/new1?acquire=1'));
    expect(sent('books-create')).toHaveLength(1);
    expect(sent('books-create')[0]).toMatchObject({
      title: 'The Blue Umbrella', isbn: ISBN, authorIds: ['a1'], newAuthors: ['New Writer'], publisherId: null, newPublisher: 'Rupa', ageGroup: 'CHILDREN', genres: ['FICTION'],
    });
    expect(calls.map((c) => c.action)).toEqual(['books-lookup', 'books-create']);
    expect(onClose).toHaveBeenCalledTimes(1);
    // The catalogue list is being left: no reload of it.
    expect(onSaved).not.toHaveBeenCalled();
    // A guess is not the person's own choice: the next new book does not start from it.
    expect(JSON.parse(localStorage.getItem('stories.newTitles') ?? '{}')).not.toHaveProperty('ageGroup');
  });

  it('matches names as the server does: accents and case do not make a new author', async () => {
    const user = userEvent.setup();
    respond = () => ({ candidates: [candidate({ authors: ['Gabriel Garcia Marquez'], publisher: 'PENGUIN' })] });
    openDialog();
    await screen.findByRole('checkbox', { name: 'Ruskin Bond' });
    await search(user, ISBN);
    await screen.findByRole('status');
    expect(screen.getByRole('checkbox', { name: 'Gabriel García Márquez' })).toBeChecked();
    expect(screen.queryByText(lt.namedAuthors)).not.toBeInTheDocument();
    expect(field(lt.publisher).value).toBe('p1');
  });

  it('does not fill a form someone has started, nor when the ISBN has no single match', async () => {
    const user = userEvent.setup();
    respond = () => ({ candidates: [candidate()] });
    openDialog();
    await user.type(field(lt.title), 'My own title');
    await search(user, ISBN);
    const use = await screen.findByRole('button', { name: lt.lookupUse });
    expect(field(lt.title).value).toBe('My own title');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    // Choosing the match is still one click.
    await user.click(use);
    expect(field(lt.title).value).toBe('The Blue Umbrella');
    expect(screen.queryByRole('button', { name: lt.lookupUse })).not.toBeInTheDocument();
  });

  it('leaves the choice to the person when two matches carry the ISBN, or the only one is another edition', async () => {
    const user = userEvent.setup();
    respond = () => ({ candidates: [candidate({ title: 'Another edition', isbn: '9780141441900' })] });
    openDialog();
    await search(user, ISBN);
    await screen.findByRole('button', { name: lt.lookupUse });
    expect(field(lt.title).value).toBe('');
    // A title search never fills by itself either.
    respond = () => ({ candidates: [candidate()] });
    await user.clear(lookupField());
    await search(user, 'blue umbrella');
    await waitFor(() => expect(sent('books-lookup')).toHaveLength(2));
    await screen.findByText('The Blue Umbrella');
    expect(field(lt.title).value).toBe('');
    expect(catalogueReads).toEqual([ISBN]); // not for a title search
  });

  it('does not keep one match\'s age-group guess when a match without a guess is used instead', async () => {
    const user = userEvent.setup();
    localStorage.setItem('stories.newTitles', JSON.stringify({ ageGroup: 'TEENS' }));
    respond = () => ({ candidates: [candidate({ ageGroup: 'CHILDREN' }), candidate({ source: 'Open Library', title: 'Annotated edition', isbn: '9780141441900' })] });
    openDialog();
    expect(field(lt.ageGroup).value).toBe('TEENS');
    await search(user, ISBN);
    await screen.findByRole('status');
    expect(field(lt.ageGroup).value).toBe('CHILDREN');
    // The other listed match says nothing about who the book is for: back to what the form had before the guess.
    await user.click(screen.getAllByRole('button', { name: lt.lookupUse })[1]);
    expect(field(lt.title).value).toBe('Annotated edition');
    expect(field(lt.ageGroup).value).toBe('TEENS');

    // A guess the person has changed is their own choice: a later match without a guess leaves it alone.
    await user.type(lookupField(), '{Enter}');
    await user.click((await screen.findAllByRole('button', { name: lt.lookupUse }))[0]);
    expect(field(lt.ageGroup).value).toBe('CHILDREN');
    await user.selectOptions(field(lt.ageGroup), 'ADULTS');
    await user.type(lookupField(), '{Enter}');
    await user.click((await screen.findAllByRole('button', { name: lt.lookupUse }))[1]);
    expect(field(lt.title).value).toBe('Annotated edition');
    expect(field(lt.ageGroup).value).toBe('ADULTS');
  });

  it('still searches when our own catalogue cannot be read', async () => {
    const user = userEvent.setup();
    ours = () => {
      throw new Error('offline');
    };
    respond = () => ({ candidates: [candidate()] });
    openDialog();
    await search(user, ISBN);
    await waitFor(() => expect(field(lt.title).value).toBe('The Blue Umbrella'));
    expect(sent('books-lookup')).toHaveLength(1);
  });
});

describe('New book: the form', () => {
  it('says under the ISBN field that we already have the title, as soon as the ISBN is complete', async () => {
    const user = userEvent.setup();
    ours = (isbn) => (isbn === ISBN ? inCatalogue(isbn) : null);
    openDialog();
    await user.type(field(lt.isbn), '978030640615');
    expect(catalogueReads).toEqual([]);
    await user.type(field(lt.isbn), '7');
    const note = await screen.findByRole('status');
    expect(note).toHaveTextContent(lt.isbnOurs('Treasure Island'));
    expect(within(note).getByRole('link', { name: lt.bulkOpenBook })).toHaveAttribute('href', '/ops/books/bk1');
    // Another ISBN in the field: the note goes.
    await user.clear(field(lt.isbn));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(calls).toEqual([]);
  });

  it('links to the title when saving is refused because the ISBN is ours after all', async () => {
    const user = userEvent.setup();
    respond = (data) =>
      data.action === 'books-create'
        ? Object.assign(new FirebaseError('functions/failed-precondition', 'A book with this ISBN is already in the catalogue.'), { details: { reason: 'DUPLICATE_ISBN' } })
        : {};
    openDialog();
    await user.click(await screen.findByRole('checkbox', { name: 'Ruskin Bond' }));
    await user.type(field(lt.title), 'Treasure Island');
    await user.type(field(lt.isbn), ISBN);
    await user.click(screen.getByRole('checkbox', { name: 'Fiction' }));
    // Added by someone else between the check and the save.
    ours = inCatalogue;
    await user.click(screen.getByRole('button', { name: lt.createAndCopies }));
    expect(await screen.findByRole('alert')).toHaveTextContent('A book with this ISBN is already in the catalogue.');
    expect(within(await screen.findByRole('status')).getByRole('link', { name: lt.bulkOpenBook })).toHaveAttribute('href', '/ops/books/bk1');
    expect(where()).toBe('/ops/books');
  });

  it('adds a typed author as a name with the book, not with a command of its own, and counts names in the five', async () => {
    const user = userEvent.setup();
    respond = () => ({ bookId: 'new2', code: 'BOOK-000010' });
    openDialog();
    await screen.findByRole('checkbox', { name: 'Ruskin Bond' });
    const filter = screen.getByLabelText(`${lt.authors}: ${t.filterPlaceholder}`);
    for (const name of ['Zed One', 'Zed Two', 'ZED one', 'Zed Three', 'Zed Four', 'Zed Five', 'Zed Six']) {
      await user.type(filter, name);
      await user.click(screen.getByRole('button', { name: `+ ${name}` }));
    }
    expect(calls).toEqual([]);
    // The same name twice counts once, and a sixth author is not taken.
    expect(screen.getAllByRole('button', { name: /^Remove Zed/ })).toHaveLength(5);
    expect(screen.queryByRole('button', { name: lt.removeNamed('Zed Six') })).not.toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: 'Ruskin Bond' }));
    expect(screen.getByRole('checkbox', { name: 'Ruskin Bond' })).not.toBeChecked();
    await user.click(screen.getByRole('button', { name: lt.removeNamed('Zed Five') }));
    await user.click(screen.getByRole('checkbox', { name: 'Ruskin Bond' }));
    expect(screen.getByRole('checkbox', { name: 'Ruskin Bond' })).toBeChecked();

    await user.type(field(lt.title), 'Many hands');
    await user.click(screen.getByRole('checkbox', { name: 'Fiction' }));
    await user.click(screen.getByRole('button', { name: lt.createAndCopies }));
    await waitFor(() => expect(sent('books-create')).toHaveLength(1));
    expect(sent('books-create')[0]).toMatchObject({ authorIds: ['a1'], newAuthors: ['Zed One', 'Zed Two', 'Zed Three', 'Zed Four'], publisherId: null });
    expect(sent('books-create')[0]).not.toHaveProperty('newPublisher');
    expect(calls).toHaveLength(1);
  });

  it('keeps focus in the form when a named author is removed with the keyboard', async () => {
    const user = userEvent.setup();
    respond = () => ({ candidates: [candidate({ authors: ['First Writer', 'Second Writer', 'Third Writer'] })] });
    openDialog();
    await search(user, ISBN);
    await screen.findByRole('status');
    const remove = (name: string) => screen.getByRole('button', { name: lt.removeNamed(name) });
    // The next name's button takes focus; after the last name, the one before it.
    remove('Second Writer').focus();
    await user.keyboard('{Enter}');
    expect(screen.queryByRole('button', { name: lt.removeNamed('Second Writer') })).not.toBeInTheDocument();
    expect(remove('Third Writer')).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(remove('First Writer')).toHaveFocus();
    // No name left: the authors filter, ready for another one.
    await user.keyboard('{Enter}');
    expect(screen.queryByText(lt.namedAuthors)).not.toBeInTheDocument();
    expect(screen.getByLabelText(`${lt.authors}: ${t.filterPlaceholder}`)).toHaveFocus();
  });

  it('needs an author (a named one will do) and a genre before it sends anything', async () => {
    const user = userEvent.setup();
    openDialog();
    await user.type(field(lt.title), 'Nobody wrote this');
    await user.click(screen.getByRole('button', { name: lt.createAndCopies }));
    expect(await screen.findByText('Choose at least one author.')).toBeInTheDocument();
    expect(screen.getByText('Choose at least one genre.')).toBeInTheDocument();
    expect(calls).toEqual([]);
    await user.type(screen.getByLabelText(`${lt.authors}: ${t.filterPlaceholder}`), 'Some Body');
    await user.click(screen.getByRole('button', { name: '+ Some Body' }));
    expect(screen.queryByText('Choose at least one author.')).not.toBeInTheDocument();
  });
});

describe('New book: after Create', () => {
  /** A filled form whose lookup match has a cover; books-setCover (and, when held, books-create) is answered when the test says. */
  async function filled(user: ReturnType<typeof userEvent.setup>, holdCreate = false) {
    let landCover: (answer: unknown) => void = () => undefined;
    let landCreate: (answer: unknown) => void = () => undefined;
    const created = { bookId: 'new3', code: 'BOOK-000011' };
    respond = (data) => {
      if (data.action === 'books-lookup') return { candidates: [candidate({ coverUrl: 'https://covers.openlibrary.org/b/id/1-L.jpg' })] };
      if (data.action === 'books-setCover') return new Promise((resolve) => (landCover = resolve));
      return holdCreate ? new Promise((resolve) => (landCreate = resolve)) : created;
    };
    const dialog = openDialog();
    await screen.findByRole('checkbox', { name: 'Ruskin Bond' });
    await search(user, ISBN);
    await screen.findByText(lt.lookupCoverNote('Google Books'));
    return { ...dialog, landCover: (answer: unknown) => act(async () => landCover(answer)), landCreate: () => act(async () => landCreate(created)) };
  }

  it('"Create only" stays on the catalogue, reloads the list at once and again when the cover has landed', async () => {
    const user = userEvent.setup();
    const { onSaved, onClose, landCover } = await filled(user);
    await user.click(screen.getByRole('button', { name: lt.createOnly }));
    // Done while the cover is still being fetched: nobody waits for it.
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(onSaved).toHaveBeenCalledWith('new3');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(sent('books-setCover')).toHaveLength(1);
    expect(sent('books-setCover')[0]).toMatchObject({ bookId: 'new3', imageUrl: 'https://covers.openlibrary.org/b/id/1-L.jpg' });
    expect(where()).toBe('/ops/books');
    await landCover({ bookId: 'new3', coverUrl: 'https://example.test/c.jpg' });
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(2));
  });

  it('a cover that cannot be fetched changes nothing: the book is saved and the list is not reloaded again', async () => {
    const user = userEvent.setup();
    const { onSaved, landCover } = await filled(user);
    await user.click(screen.getByRole('button', { name: lt.createOnly }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    await landCover(new FirebaseError('functions/failed-precondition', "The cover couldn't be downloaded."));
    await act(async () => undefined);
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it('goes on to the copies without waiting for the cover either, and one click cannot create two titles', async () => {
    const user = userEvent.setup();
    const { onSaved, landCreate } = await filled(user, true);
    // Clicked twice (and "Create only" as well) while the first save is still on its way.
    await user.dblClick(screen.getByRole('button', { name: lt.createAndCopies }));
    expect(screen.getByRole('button', { name: lt.createOnly })).toBeDisabled();
    expect(sent('books-create')).toHaveLength(1);
    await landCreate();
    await waitFor(() => expect(where()).toBe('/ops/books/new3?acquire=1'));
    expect(sent('books-create')).toHaveLength(1);
    // The cover is still being fetched: the book page is already open.
    expect(sent('books-setCover')).toHaveLength(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('Enter in a field uses "Create and add copies"', async () => {
    const user = userEvent.setup();
    respond = () => ({ bookId: 'new4', code: 'BOOK-000012' });
    openDialog();
    await user.click(await screen.findByRole('checkbox', { name: 'Ruskin Bond' }));
    await user.click(screen.getByRole('checkbox', { name: 'Fiction' }));
    await user.type(field(lt.title), 'Typed by hand{Enter}');
    await waitFor(() => expect(where()).toBe('/ops/books/new4?acquire=1'));
    // A book made of ids alone is the request it always was: no names in it.
    expect(sent('books-create')[0]).toMatchObject({ title: 'Typed by hand', authorIds: ['a1'] });
    expect(sent('books-create')[0]).not.toHaveProperty('newAuthors');
    expect(sent('books-create')[0]).not.toHaveProperty('newPublisher');
  });

  it('offers plain Create to someone who cannot add copies here, or with no branch in use', async () => {
    const user = userEvent.setup();
    claims = { v: 1, sa: false, o: {} };
    respond = () => ({ bookId: 'new5', code: 'BOOK-000013' });
    const { onSaved, onClose, unmount } = openDialog();
    expect(screen.queryByRole('button', { name: lt.createAndCopies })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: lt.createOnly })).not.toBeInTheDocument();
    await user.click(await screen.findByRole('checkbox', { name: 'Ruskin Bond' }));
    await user.click(screen.getByRole('checkbox', { name: 'Fiction' }));
    await user.type(field(lt.title), 'Catalogued ahead');
    await user.click(screen.getByRole('button', { name: t.create }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith('new5'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(where()).toBe('/ops/books');
    unmount();

    claims = { v: 1, sa: true, o: {} };
    branch = null;
    openDialog();
    expect(screen.getByRole('button', { name: t.create })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: lt.createAndCopies })).not.toBeInTheDocument();
  });
});

describe('New book: what it starts from', () => {
  it('starts from the age group and reading level last chosen here, never from remembered genres', async () => {
    const user = userEvent.setup();
    const first = openDialog();
    expect(field(lt.ageGroup).value).toBe('ADULTS');
    expect(field(lt.readingLevel).value).toBe('INTERMEDIATE');
    await user.selectOptions(field(lt.ageGroup), 'TEENS');
    await user.selectOptions(field(lt.readingLevel), 'ADVANCED');
    first.unmount();

    openDialog();
    expect(field(lt.ageGroup).value).toBe('TEENS');
    expect(field(lt.readingLevel).value).toBe('ADVANCED');
    expect(screen.queryAllByRole('checkbox', { checked: true })).toHaveLength(0);
  });

  it('ignores a stored value that is not one of the choices', () => {
    localStorage.setItem('stories.newTitles', JSON.stringify({ ageGroup: 'EVERYONE', readingLevel: 'BEGINNER', genre: 7 }));
    openDialog();
    expect(field(lt.ageGroup).value).toBe('ADULTS');
    expect(field(lt.readingLevel).value).toBe('BEGINNER');
  });

  it('editing a book is unchanged: its own values, ids only, no lookup, no ISBN check against itself', async () => {
    const user = userEvent.setup();
    localStorage.setItem('stories.newTitles', JSON.stringify({ ageGroup: 'TEENS' }));
    ours = inCatalogue;
    respond = () => ({ bookId: 'bk1' });
    const book = {
      id: 'bk1', code: 'BOOK-000001', isbn: ISBN, title: 'Treasure Island', subtitle: '', authorIds: ['a1'], authorNames: ['Ruskin Bond'], publisherId: 'p1', publisherName: 'Penguin',
      categoryIds: [], categoryNames: [], language: 'en', genres: ['FICTION'], ageGroup: 'CHILDREN', minAge: null, readingLevel: 'BEGINNER', contentTags: [], synopsis: '', edition: '',
      publicationYear: null, keywords: [], replacementPriceMinor: 0, status: 'ACTIVE',
    } as Book;
    const onSaved = vi.fn();
    render(
      <MemoryRouter>
        <BookDialog book={book} onClose={() => undefined} onSaved={onSaved} />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('searchbox', { name: lt.lookupTitle })).not.toBeInTheDocument();
    expect(field(lt.ageGroup).value).toBe('CHILDREN');
    await user.selectOptions(field(lt.ageGroup), 'ADULTS');
    await user.click(screen.getByRole('button', { name: t.save }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith('bk1'));
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ action: 'books-update', bookId: 'bk1', authorIds: ['a1'], publisherId: 'p1', ageGroup: 'ADULTS' });
    expect(calls[0]).not.toHaveProperty('newAuthors');
    expect(calls[0]).not.toHaveProperty('newPublisher');
    expect(catalogueReads).toEqual([]);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    // An edit is not a choice for new titles.
    expect(JSON.parse(localStorage.getItem('stories.newTitles')!)).toEqual({ ageGroup: 'TEENS' });
  });
});

describe('Book page: arriving from "Create and add copies"', () => {
  const book = (status: Book['status'] = 'ACTIVE') =>
    ({
      id: 'bk1', code: 'BOOK-000001', isbn: null, title: 'Treasure Island', subtitle: '', authorIds: ['a1'], authorNames: ['Robert Louis Stevenson'], publisherId: null, publisherName: null,
      categoryIds: [], categoryNames: [], language: 'en', genres: ['FICTION'], ageGroup: 'ADULTS', minAge: null, readingLevel: 'INTERMEDIATE', contentTags: [], synopsis: '', edition: '',
      publicationYear: null, keywords: [], replacementPriceMinor: 0, status,
    }) as Book;
  const open = (at: string) =>
    render(
      <MemoryRouter initialEntries={[at]}>
        <Routes>
          <Route path="/ops/books/:bookId" element={<BookDetailPage />} />
        </Routes>
        <Where />
      </MemoryRouter>,
    );
  beforeEach(() => {
    respond = (data) => (data.action === 'copies-availability' ? { branches: [] } : { summary: null });
  });

  it('opens Add copies once the title has loaded, and drops the flag so a refresh does not open it again', async () => {
    stored = book();
    open('/ops/books/bk1?acquire=1&from=list');
    expect(await screen.findByRole('dialog', { name: `${lt.addCopies} — Treasure Island` })).toBeInTheDocument();
    await waitFor(() => expect(where()).toBe('/ops/books/bk1?from=list'));
    // Closing it leaves the page as it would be without the flag.
    await userEvent.setup().click(screen.getByRole('button', { name: t.cancel }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(where()).toBe('/ops/books/bk1?from=list');
    // No button opened the dialog, so focus goes where it would after opening it by hand: the page's Add copies.
    expect(screen.getByRole('button', { name: lt.addCopies })).toHaveFocus();
  });

  it('puts focus on the page\'s Add copies button after the copies are added, or Escape is pressed', async () => {
    const user = userEvent.setup();
    stored = book();
    const first = open('/ops/books/bk1?acquire=1');
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(lt.cost), '250');
    await user.click(within(dialog).getByRole('button', { name: lt.addCopies }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(sent('copies-acquire')).toHaveLength(1);
    expect(screen.getByRole('button', { name: lt.addCopies })).toHaveFocus();
    first.unmount();

    open('/ops/books/bk1?acquire=1');
    await screen.findByRole('dialog');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: lt.addCopies })).toHaveFocus();
  });

  it('does not open it for someone who may not add copies, or for an archived title', async () => {
    stored = book();
    claims = { v: 1, sa: false, o: {} };
    const first = open('/ops/books/bk1?acquire=1');
    await screen.findByRole('heading', { name: 'Treasure Island' });
    await waitFor(() => expect(where()).toBe('/ops/books/bk1'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    first.unmount();

    claims = { v: 1, sa: true, o: {} };
    stored = book('ARCHIVED');
    open('/ops/books/bk1?acquire=1');
    await screen.findByRole('heading', { name: 'Treasure Island' });
    await waitFor(() => expect(where()).toBe('/ops/books/bk1'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('does not open it without the flag', async () => {
    stored = book();
    open('/ops/books/bk1');
    await screen.findByRole('heading', { name: 'Treasure Island' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('reads the title again when its cover, still being fetched on arrival, has landed', async () => {
    let land: (answer: unknown) => void = () => undefined;
    respond = (data) => (data.action === 'books-setCover' ? new Promise((resolve) => (land = resolve)) : { branches: [] });
    stored = book();
    const importing = importCoverInBackground('bk1', 'https://covers.openlibrary.org/b/id/1-L.jpg');
    expect(coverImportOf('bk1')).toBe(importing);
    open('/ops/books/bk1');
    await screen.findByRole('heading', { name: 'Treasure Island' });
    expect(bookReads).toBe(1);
    await act(async () => land({ bookId: 'bk1', coverUrl: 'https://example.test/c.jpg' }));
    await waitFor(() => expect(bookReads).toBe(2));
    // Nothing is kept once it has settled.
    expect(coverImportOf('bk1')).toBeUndefined();
  });
});
