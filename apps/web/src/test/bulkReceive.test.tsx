import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FirebaseError } from 'firebase/app';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { lt } from '../strings/library';

// The Receive books page with the server faked at the Cloud Functions boundary.
interface Sent {
  action: string;
  items: { bookId: string }[];
  requestId: string;
}
const calls: Sent[] = [];
/** The server's answer to each call (a thrown error, or a result). */
let respond: (data: Sent) => unknown = () => undefined;

vi.mock('firebase/functions', () => ({
  httpsCallable: () => async (data: Sent) => {
    calls.push(data);
    const answer = respond(data);
    if (answer instanceof Error) throw answer;
    return { data: answer };
  },
}));
vi.mock('../data/services', () => ({ services: () => ({ fns: {}, db: {} }) }));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ claims: { v: 1, sa: true, o: {} } }) }));
vi.mock('../admin/Workspace', () => ({ useWorkspace: () => ({ org: { id: 'o1', type: 'CORPORATE' }, branch: { id: 'b1', name: 'Central' } }) }));
vi.mock('../data/inventory', () => ({ listLocations: async () => [] }));
vi.mock('../data/bulkBooks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../data/bulkBooks')>()),
  // Every ISBN is a title already in the catalogue: receiving adds copies only.
  lookupIsbn: async (isbn: string) => ({
    source: 'catalogue', title: `Book ${isbn}`, subtitle: '', authors: ['A. Writer'], publisher: null, year: null, isbn,
    language: 'en', synopsis: '', genres: [], subjects: [], coverUrl: null, existingBookId: `bk${isbn}`,
  }),
}));

const { BulkAddBooksPage } = await import('../admin/catalogue/BulkAddBooks');

/** n valid ISBN-13s. */
function isbns(n: number) {
  return Array.from({ length: n }, (_, i) => {
    const body = `978000${String(i + 1).padStart(6, '0')}`;
    const sum = [...body].reduce((s, d, j) => s + Number(d) * (j % 2 ? 3 : 1), 0);
    return body + ((10 - (sum % 10)) % 10);
  });
}

/** What copies-receive answers for the items it was sent: one copy each. */
const received = (items: { bookId: string }[]) => ({
  received: items.map((it) => ({ bookId: it.bookId, title: it.bookId, codes: [`C-${it.bookId}`], copyIds: [`cp-${it.bookId}`], isNew: false })),
  newTitles: [],
  copies: items.length,
  allocated: 0,
});

beforeEach(() => {
  calls.length = 0;
});

describe('Receive books', () => {
  it('keeps the titles a committed call received when a later call fails, and retries only the rest', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <BulkAddBooksPage />
      </MemoryRouter>,
    );
    await user.click(screen.getByLabelText(lt.bulkIsbnLabel(1)));
    await user.paste(isbns(27).join('\n'));
    const submit = await screen.findByRole('button', { name: lt.receiveSubmit(27) });

    // 27 titles go in two calls (25 + 2): the first goes through, the second is refused.
    respond = (data) => (calls.length === 2 ? new FirebaseError('functions/failed-precondition', 'That shelf is closed.') : received(data.items));
    await user.click(submit);
    expect(await screen.findByRole('alert')).toHaveTextContent('That shelf is closed.');
    expect(calls.map((c) => c.items.length)).toEqual([25, 2]);
    // The 25 received titles are marked done; only the last two are still to receive.
    expect(screen.getAllByRole('link', { name: /^1 copy: C-bk/ })).toHaveLength(25);
    expect(screen.getByText(lt.receiveDone(25, 25, 0, 0), { exact: false })).toBeInTheDocument();
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
  });
});
