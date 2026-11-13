import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FirebaseError } from 'firebase/app';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Location } from '../data/inventory';
import { remember } from '../shared/remember';
import { useRouteFocus } from '../shared/useRouteFocus';
import { lt } from '../strings/library';

// The Receive books page with the server faked at the Cloud Functions boundary.
interface Item {
  bookId?: string;
  book?: { isbn: string; ageGroup: string; readingLevel: string; genres: string[] };
  quantity: number;
}
interface Sent {
  action: string;
  items: Item[];
  requestId: string;
  locationId?: string | null;
  condition?: string;
  bookId?: string;
}
const calls: Sent[] = [];
/** The server's answer to each call (a thrown error, a result, or a promise of either). */
let respond: (data: Sent) => unknown = () => undefined;

vi.mock('firebase/functions', () => ({
  httpsCallable: () => async (data: Sent) => {
    calls.push(data);
    const answer = await respond(data);
    if (answer instanceof Error) throw answer;
    return { data: answer };
  },
}));
vi.mock('../data/services', () => ({ services: () => ({ fns: {}, db: {} }) }));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ claims: { v: 1, sa: true, o: {} } }) }));
vi.mock('../admin/Workspace', () => ({
  useWorkspace: () => ({ org: { id: 'o1', type: 'CORPORATE' }, branch: { id: 'b1', name: 'Central' }, branches: [{ id: 'b1', name: 'Central', status: 'ACTIVE' }], branchName: (id: string) => id }),
}));
const reads = vi.hoisted(() => ({ listLocations: vi.fn() }));
vi.mock('../data/inventory', async (importOriginal) => ({ ...(await importOriginal<typeof import('../data/inventory')>()), ...reads }));
/** What each ISBN turns out to be. */
const lookup = vi.hoisted(() => ({ of: (_isbn: string): unknown => null }));
vi.mock('../data/bulkBooks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../data/bulkBooks')>()),
  lookupIsbn: async (isbn: string) => lookup.of(isbn),
}));
// The camera is stood in for by a button that "sees" one code.
const camera = vi.hoisted(() => ({ sees: '' }));
vi.mock('../admin/components/CameraScanner', () => ({
  CameraScanner: ({ onDetect, hint }: { onDetect: (text: string) => void; hint?: string }) => (
    <div>
      <p>{hint}</p>
      <button type="button" onClick={() => onDetect(camera.sees)}>
        Camera sees a code
      </button>
    </div>
  ),
}));

const { BulkAddBooksPage } = await import('../admin/catalogue/BulkAddBooks');

/** n valid ISBN-13s, starting at the `from`-th. */
function isbns(n: number, from = 1) {
  return Array.from({ length: n }, (_, i) => {
    const body = `978000${String(i + from).padStart(6, '0')}`;
    const sum = [...body].reduce((s, d, j) => s + Number(d) * (j % 2 ? 3 : 1), 0);
    return body + ((10 - (sum % 10)) % 10);
  });
}

/** A title already in the catalogue: receiving adds copies only. */
const inCatalogue = (isbn: string) => ({
  source: 'catalogue', title: `Book ${isbn}`, subtitle: '', authors: ['A. Writer'], publisher: null, year: null, isbn,
  language: 'en', synopsis: '', genres: [], subjects: [], coverUrl: null, existingBookId: `bk${isbn}`,
});
/** A title found in the public catalogues, new to ours. */
const found = (isbn: string, over: Record<string, unknown> = {}) => ({
  source: 'Google Books', title: `New ${isbn}`, subtitle: '', authors: ['A. Writer'], publisher: null, year: null, isbn,
  language: 'en', synopsis: '', genres: [], subjects: [], coverUrl: `https://books.google.com/${isbn}.jpg`, existingBookId: null, ...over,
});

/** Copies made of each title so far: a later delivery of the same title makes the next ones. */
const made = new Map<string, number>();

/** What copies-receive answers for the items it was sent. */
const received = (items: Item[]) => {
  const lines = items.map((it) => {
    const bookId = it.bookId ?? `new${it.book!.isbn}`;
    const from = made.get(bookId) ?? 0;
    made.set(bookId, from + it.quantity);
    return { bookId, from, quantity: it.quantity, isNew: !it.bookId };
  });
  return {
    received: lines.map((l) => ({
      bookId: l.bookId, title: l.bookId, isNew: l.isNew,
      codes: Array.from({ length: l.quantity }, (_, k) => `C-${l.bookId}-${l.from + k + 1}`),
      copyIds: Array.from({ length: l.quantity }, (_, k) => `cp-${l.bookId}-${l.from + k + 1}`),
    })),
    newTitles: items.flatMap((it) => (it.book ? [{ isbn: it.book.isbn, bookId: `new${it.book.isbn}`, code: `B-${it.book.isbn}` }] : [])),
    copies: lines.reduce((n, l) => n + l.quantity, 0),
    allocated: 0,
  };
};

const shelves: Location[] = [
  { id: 'A', code: 'FIC-1', label: 'Fiction', kind: 'SHELF', status: 'ACTIVE' },
  { id: 'OLD', code: 'OLD-1', label: 'Old bay', kind: 'SHELF', status: 'ARCHIVED' },
];
const shelfKey = remember.key('receiveShelf', 'o1', 'b1');

function open() {
  const user = userEvent.setup();
  const view = render(
    <MemoryRouter>
      <BulkAddBooksPage />
    </MemoryRouter>,
  );
  return { user, ...view };
}
const isbnField = (n: number) => screen.getByLabelText(lt.bulkIsbnLabel(n));
const receiveCalls = () => calls.filter((c) => c.action === 'copies-receive');

beforeEach(() => {
  calls.length = 0;
  made.clear();
  respond = (data) => received(data.items);
  lookup.of = inCatalogue;
  reads.listLocations.mockReset().mockResolvedValue([]);
  localStorage.clear();
});

describe('Receive books', () => {
  it('keeps the titles a committed call received when a later call fails, and retries only the rest', async () => {
    const { user } = open();
    await user.click(isbnField(1));
    await user.paste(isbns(27).join('\n'));
    const submit = await screen.findByRole('button', { name: lt.receiveSubmit(27) });

    // 27 titles go in two calls (25 + 2): the first goes through, the second is refused.
    respond = (data) => (calls.length === 2 ? new FirebaseError('functions/failed-precondition', 'That shelf is closed.') : received(data.items));
    await user.click(submit);
    expect(await screen.findByText('That shelf is closed.')).toHaveAttribute('role', 'alert');
    expect(calls.map((c) => c.items.length)).toEqual([25, 2]);
    // The 25 received titles are marked done; only the last two are still to receive.
    expect(screen.getAllByRole('link', { name: /^1 copy: C-bk/ })).toHaveLength(25);
    expect(screen.getByText(lt.receiveDone(25, 25, 0, 0), { exact: false })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: lt.receiveLabels(25) })).toBeInTheDocument();
    const retry = screen.getByRole('button', { name: lt.receiveSubmit(2) });

    // Retrying sends only the two that weren't received, under that call's requestId.
    respond = (data) => received(data.items);
    await user.click(retry);
    await waitFor(() => expect(calls).toHaveLength(3));
    expect(calls[2].items.map((i) => i.bookId)).toEqual(calls[1].items.map((i) => i.bookId));
    expect(calls[2].requestId).toBe(calls[1].requestId);
    expect(calls[2].requestId).not.toBe(calls[0].requestId);
    await waitFor(() => expect(screen.getAllByRole('link', { name: /^1 copy: C-bk/ })).toHaveLength(27));
    expect(screen.getByRole('button', { name: lt.receiveSubmit(0) })).toBeDisabled();
    // The labels are for everything received, not only for what the retry brought.
    const labels = screen.getByRole('link', { name: lt.receiveLabels(27) });
    expect(labels.getAttribute('href')).toContain(`cp-bk${isbns(1)[0]}-1`);
    expect(labels.getAttribute('href')).toContain(`cp-bk${isbns(27)[26]}-1`);
  });

  it('shows the result and the labels at once, and fetches the covers behind, three at a time', async () => {
    lookup.of = (isbn) => found(isbn);
    const covers: ((answer: unknown) => void)[] = [];
    respond = (data) => (data.action === 'books-setCover' ? new Promise((answer) => covers.push(answer)) : received(data.items));
    const coverCalls = () => calls.filter((c) => c.action === 'books-setCover');
    const { user } = open();
    await user.click(isbnField(1));
    await user.paste(isbns(5, 101).join('\n'));
    await user.click(await screen.findByRole('button', { name: lt.receiveSubmit(5) }));

    // Nothing waits for the covers: the result, the labels and the next row are there while they are fetched.
    expect(await screen.findByText(lt.receiveDone(5, 5, 5, 0))).toBeInTheDocument();
    expect(screen.getByRole('link', { name: lt.receiveLabels(5) })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: lt.bulkAddRow })).toBeEnabled();
    await waitFor(() => expect(isbnField(6)).toHaveFocus());
    expect(isbnField(6)).toBeEnabled();
    expect(screen.getByText(lt.bulkCovers(0, 5))).toHaveAttribute('role', 'status');
    await waitFor(() => expect(coverCalls()).toHaveLength(3));
    expect(new Set(coverCalls().map((c) => c.bookId)).size).toBe(3);

    // One that can't be fetched is passed over quietly, and the next one starts.
    covers[0](new FirebaseError('functions/permission-denied', 'Not allowed.'));
    expect(await screen.findByText(lt.bulkCovers(1, 5))).toBeInTheDocument();
    await waitFor(() => expect(coverCalls()).toHaveLength(4));
    covers[1]({});
    covers[2]({});
    await waitFor(() => expect(coverCalls()).toHaveLength(5));
    expect(screen.getByText(lt.bulkCovers(3, 5))).toBeInTheDocument();
    covers[3]({});
    covers[4]({});
    await waitFor(() => expect(screen.queryByText(/^Adding covers/)).toBeNull());
    expect(coverCalls()).toHaveLength(5);
    expect(screen.queryByText('Not allowed.')).toBeNull();
  });

  it('opens with the cursor in the first ISBN field, moves it on after a delivery, and takes the same title again', async () => {
    function Shell() {
      useRouteFocus('main');
      return (
        <main id="main">
          <BulkAddBooksPage />
        </main>
      );
    }
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <Shell />
      </MemoryRouter>,
    );
    // The one field the page names for the first focus.
    expect(document.querySelectorAll('[data-autofocus]')).toHaveLength(1);
    await waitFor(() => expect(isbnField(1)).toHaveFocus());

    const [isbn] = isbns(1);
    await user.keyboard(`${isbn}{Enter}`);
    await user.click(await screen.findByRole('button', { name: lt.receiveSubmit(1) }));
    await screen.findByText(lt.receiveDone(1, 1, 0, 0));
    // Row 1 is done; the next scan goes into row 2 without a click.
    await waitFor(() => expect(isbnField(2)).toHaveFocus());
    expect(isbnField(2)).toHaveAttribute('data-autofocus');
    expect(document.querySelectorAll('[data-autofocus]')).toHaveLength(1);

    // The same title in the next carton is a new line, not "already in row 1".
    await user.keyboard(`${isbn}{Enter}`);
    expect(await screen.findByRole('button', { name: lt.receiveSubmit(1) })).toBeEnabled();
    expect(screen.queryByText(lt.bulkRepeat(1))).toBeNull();
    await user.click(screen.getByRole('button', { name: lt.receiveSubmit(1) }));
    // Both cartons' labels are offered together.
    expect(await screen.findByRole('link', { name: lt.receiveLabels(2) })).toBeInTheDocument();
    expect(receiveCalls()).toHaveLength(2);

    // A fresh list starts in row 1, and the labels go with the old one.
    await user.click(screen.getByRole('button', { name: lt.bulkClear }));
    await waitFor(() => expect(isbnField(1)).toHaveFocus());
    expect(isbnField(1)).toHaveValue('');
    expect(screen.queryByRole('link', { name: lt.receiveLabels(2) })).toBeNull();
  });

  it('leaves the cursor where it is when the delivery could not be saved', async () => {
    respond = () => new FirebaseError('functions/failed-precondition', 'That shelf is closed.');
    const { user } = open();
    await user.type(isbnField(1), `${isbns(1)[0]}{Enter}`);
    const submit = await screen.findByRole('button', { name: lt.receiveSubmit(1) });
    await user.click(submit);
    expect(await screen.findByText('That shelf is closed.')).toBeInTheDocument();
    expect(submit).toBeEnabled();
    expect(isbnField(2)).not.toHaveFocus();
  });

  it('offers the shelf last used at the branch again and sends it, but never a price or a condition', async () => {
    reads.listLocations.mockResolvedValue(shelves);
    localStorage.setItem(shelfKey, JSON.stringify('A'));
    const first = open();
    const shelf = screen.getByLabelText(lt.location) as HTMLSelectElement;
    await waitFor(() => expect(shelf).toHaveValue('A'));
    expect(screen.getByLabelText(lt.condition)).toHaveValue('NEW');
    expect(screen.getByLabelText(lt.receivePrice)).toHaveValue('');
    await first.user.type(isbnField(1), `${isbns(1)[0]}{Enter}`);
    // The shelf is named next to the button that confirms the delivery.
    expect(await screen.findByText(lt.receiveOnto('FIC-1'), { exact: false })).toBeInTheDocument();
    await first.user.click(await screen.findByRole('button', { name: lt.receiveSubmit(1) }));
    await waitFor(() => expect(receiveCalls()).toHaveLength(1));
    expect(receiveCalls()[0]).toMatchObject({ locationId: 'A', condition: 'NEW' });

    // Picking "not shelved" is remembered too; a price and a condition are not.
    await first.user.selectOptions(shelf, '');
    expect(localStorage.getItem(shelfKey)).toBeNull();
    await first.user.selectOptions(shelf, 'A');
    await first.user.selectOptions(screen.getByLabelText(lt.condition), 'FAIR');
    await first.user.type(screen.getByLabelText(lt.receivePrice), '250');
    first.unmount();
    open();
    await waitFor(() => expect(screen.getByLabelText(lt.location)).toHaveValue('A'));
    expect(screen.getByLabelText(lt.condition)).toHaveValue('NEW');
    expect(screen.getByLabelText(lt.receivePrice)).toHaveValue('');
  });

  it('drops a remembered shelf that is no longer in use', async () => {
    reads.listLocations.mockResolvedValue(shelves);
    localStorage.setItem(shelfKey, JSON.stringify('OLD'));
    const { user } = open();
    await waitFor(() => expect(reads.listLocations).toHaveBeenCalled());
    await user.type(isbnField(1), `${isbns(1)[0]}{Enter}`);
    await user.click(await screen.findByRole('button', { name: lt.receiveSubmit(1) }));
    await waitFor(() => expect(receiveCalls()).toHaveLength(1));
    expect(screen.getByLabelText(lt.location)).toHaveValue('');
    expect(receiveCalls()[0].locationId).toBeNull();
  });

  it('starts new titles from the choices last made, and sends them', async () => {
    localStorage.setItem(remember.key('newTitles'), JSON.stringify({ ageGroup: 'CHILDREN', readingLevel: 'BEGINNER', genre: 'COMICS', price: '99' }));
    lookup.of = (isbn) => found(isbn, { coverUrl: null });
    const { user } = open();
    const titles = within(screen.getByRole('group', { name: lt.receiveNewTitles }));
    expect(titles.getByLabelText(lt.ageGroup)).toHaveValue('CHILDREN');
    expect(titles.getByLabelText(lt.readingLevel)).toHaveValue('BEGINNER');
    expect(titles.getByLabelText(lt.bulkGenre)).toHaveValue('COMICS');
    const [isbn] = isbns(1, 201);
    await user.type(isbnField(1), `${isbn}{Enter}`);
    await user.click(await screen.findByRole('button', { name: lt.receiveSubmit(1) }));
    await waitFor(() => expect(receiveCalls()).toHaveLength(1));
    expect(receiveCalls()[0].items[0].book).toMatchObject({ isbn, ageGroup: 'CHILDREN', readingLevel: 'BEGINNER', genres: ['COMICS'] });

    // A choice made here is kept for next time.
    await user.selectOptions(titles.getByLabelText(lt.readingLevel), 'ADVANCED');
    expect(JSON.parse(localStorage.getItem(remember.key('newTitles'))!)).toMatchObject({ ageGroup: 'CHILDREN', readingLevel: 'ADVANCED', genre: 'COMICS' });
  });

  it("guesses a row's age group from the book details, and keeps a guess or a hand-picked one when the page's choice changes", async () => {
    const [kids, plain, other] = isbns(3, 301);
    lookup.of = (isbn) => found(isbn, { coverUrl: null, ageGroup: isbn === kids ? 'CHILDREN' : null });
    const { user } = open();
    await user.click(isbnField(1));
    await user.paste([kids, plain, other].join('\n'));
    const age = (n: number) => screen.getByLabelText(`${lt.ageGroup}, row ${n}`) as HTMLSelectElement;
    await waitFor(() => expect(age(1)).toHaveValue('CHILDREN'));
    expect(screen.getAllByText(lt.bulkAgeGuessed)).toHaveLength(1);
    expect(age(2)).toHaveValue('ADULTS');

    // Row 3 is set by hand; then the choice for the whole page changes.
    await user.selectOptions(age(3), 'CHILDREN');
    await user.selectOptions(within(screen.getByRole('group', { name: lt.receiveNewTitles })).getByLabelText(lt.ageGroup), 'TEENS');
    expect(age(1)).toHaveValue('CHILDREN');
    expect(age(2)).toHaveValue('TEENS');
    expect(age(3)).toHaveValue('CHILDREN');

    // Another ISBN typed over the guessed row: the guess goes with the book it was for.
    await user.clear(isbnField(1));
    await user.type(isbnField(1), isbns(1, 310)[0]);
    await waitFor(() => expect(age(1)).toHaveValue('TEENS'));
    expect(screen.queryByText(lt.bulkAgeGuessed)).toBeNull();
  });

  it('takes ISBNs read by the camera: a new one fills the first empty row, a repeat counts a copy, anything else is refused', async () => {
    const [a, b] = isbns(2, 401);
    const { user } = open();
    await user.click(screen.getByRole('button', { name: lt.receiveCamera }));
    expect(screen.getByRole('button', { name: lt.receiveCamera })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText(lt.camHintIsbn)).toBeInTheDocument();
    const sees = async (code: string) => {
      camera.sees = code;
      await user.click(screen.getByRole('button', { name: 'Camera sees a code' }));
    };
    await sees(a);
    expect(isbnField(1)).toHaveValue(a);
    expect(await screen.findByText(`Book ${a}`)).toBeInTheDocument();
    await sees(b);
    expect(isbnField(2)).toHaveValue(b);

    // The first book again, although its row is above the next empty one.
    await sees(a);
    expect(screen.getByLabelText(lt.receiveCopiesRow(1))).toHaveValue('2');
    expect(screen.getByText(lt.receiveBumped(1, '2'))).toBeInTheDocument();
    expect(isbnField(3)).toHaveValue('');

    // A price sticker or a copy label is not an ISBN.
    await sees('C-000123');
    expect(screen.getByText(lt.camNotIsbn)).toBeInTheDocument();
    expect(isbnField(3)).toHaveValue('');
    expect(await screen.findByRole('button', { name: lt.receiveSubmit(3) })).toBeEnabled();
  });
});
