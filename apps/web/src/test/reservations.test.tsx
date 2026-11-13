import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Reservation } from '../data/circulation';
import type { BranchStock } from '../data/inventory';
import { lt } from '../strings/library';

// The Reservations page: both lists read once, and on Waiting, which other branch has each title on its shelf.
type Sent = Record<string, unknown> & { action: string };
const calls: Sent[] = [];
let respond: (data: Sent) => unknown = () => ({ books: {} });
let lists: Record<string, Reservation[]> = { ALLOCATED: [], WAITING: [] };
const reads: string[] = [];

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
vi.mock('../admin/Workspace', () => ({
  useWorkspace: () => ({ org: { id: 'o1' }, branch: { id: 'nth', name: 'North' }, branches: [], branchesLoading: false }),
}));
vi.mock('../data/circulation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../data/circulation')>()),
  branchReservations: async (_org: string, _branch: string, status: string) => {
    reads.push(status);
    return lists[status];
  },
}));

const { shelvedElsewhere, stockByBranchAll } = await import('../data/inventory');
const { ReservationsPage } = await import('../admin/circulation/Reservations');

const waiting = (n: number, bookId = `b${n}`): Reservation =>
  ({ id: `r${n}`, bookId, bookTitle: `Book ${bookId}`, memberId: `m${n}`, memberName: `Member ${n}`, memberCode: `M-${n}`, branchId: 'nth', status: 'WAITING', queuedAt: null }) as unknown as Reservation;
const held = (n: number): Reservation => ({ ...waiting(n), status: 'ALLOCATED', allocatedCopyCode: `COPY-${n}`, holdUntil: null }) as unknown as Reservation;
const at = (branchId: string, branchName: string, available: number, total = available): BranchStock => ({ branchId, branchName, available, total });
const open = () =>
  render(
    <MemoryRouter>
      <ReservationsPage />
    </MemoryRouter>,
  );
const tab = (name: string) => screen.getByRole('tab', { name: new RegExp(`^${name}`) });
const stockCalls = () => calls.filter((c) => c.action === 'copies-availabilityMany');

beforeEach(() => {
  calls.length = 0;
  reads.length = 0;
  respond = () => ({ books: {} });
  lists = { ALLOCATED: [], WAITING: [] };
});
afterEach(() => vi.restoreAllMocks());

describe('stock at other branches', () => {
  it('keeps only the other branches with a copy on the shelf, and tells "not loaded" from "nowhere"', () => {
    const stock = [at('nth', 'North', 3), at('cen', 'Central', 2, 5), at('est', 'East', 0, 4)];
    expect(shelvedElsewhere(stock, 'nth')).toEqual([at('cen', 'Central', 2, 5)]);
    expect(shelvedElsewhere([at('nth', 'North', 1)], 'nth')).toEqual([]);
    expect(shelvedElsewhere([], 'nth')).toEqual([]);
    expect(shelvedElsewhere(undefined, 'nth')).toBeUndefined();
  });

  it('asks for any number of titles in calls of 60, each title once', async () => {
    respond = (data) => ({ books: Object.fromEntries((data.bookIds as string[]).map((id) => [id, [at('cen', 'Central', 1)]])) });
    const ids = Array.from({ length: 130 }, (_, n) => `b${n}`);
    const found = await stockByBranchAll('o1', [...ids, 'b0', 'b1']);
    expect(stockCalls().map((c) => (c.bookIds as string[]).length)).toEqual([60, 60, 10]);
    expect(Object.keys(found)).toHaveLength(130);
    calls.length = 0;
    expect(await stockByBranchAll('o1', [])).toEqual({});
    expect(calls).toHaveLength(0);
  });
});

describe('Reservations page', () => {
  it('reads both lists once, counts them on the tabs, and only asks for stock when Waiting is opened', async () => {
    const user = userEvent.setup();
    lists = { ALLOCATED: [held(1)], WAITING: [waiting(2), waiting(3), waiting(4, 'b2'), waiting(5, 'b5')] };
    respond = () => ({
      books: {
        b2: [at('nth', 'North', 0, 1), at('cen', 'Central', 2, 3), at('est', 'East', 1)],
        b3: [at('cen', 'Central', 0, 2)],
        // b5 is held by no branch: the answer leaves it out.
      },
    });
    open();
    expect(await screen.findByText('Book b1')).toBeInTheDocument();
    expect(tab(lt.awaitingPickup)).toHaveTextContent('1');
    expect(tab(lt.waitingQueue)).toHaveTextContent('4');
    expect(screen.queryByRole('columnheader', { name: lt.shelfElsewhere })).toBeNull();
    expect(stockCalls()).toHaveLength(0);

    await user.click(tab(lt.waitingQueue));
    // No second read of the lists: the tab only changes what is shown.
    expect(reads.sort()).toEqual(['ALLOCATED', 'WAITING']);
    expect(await screen.findByText(lt.shelfElsewhereHint(1))).toBeInTheDocument();
    expect(stockCalls()).toHaveLength(1);
    expect(stockCalls()[0]).toMatchObject({ orgId: 'o1', bookIds: ['b2', 'b3', 'b5'] });
    const rows = screen.getAllByRole('row').slice(1);
    // Queue order is kept: oldest first, whatever the stock elsewhere.
    expect(rows.map((r) => within(r).getAllByRole('cell')[0].textContent)).toEqual(['#1 Book b2', '#2 Book b3', '#3 Book b2', '#4 Book b5']);
    // Other branches with a copy on the shelf; this branch and branches with none on the shelf are left out.
    expect(rows.map((r) => within(r).getAllByRole('cell')[3].textContent)).toEqual(['Central 2East 1', '—', 'Central 2East 1', '—']);
    expect(within(rows[0]).getByTitle(lt.stockAt('Central', 2, 3))).toBeInTheDocument();

    // Going back and forth asks for nothing more.
    await user.click(tab(lt.awaitingPickup));
    expect(screen.queryByText(lt.shelfElsewhereHint(1))).toBeNull();
    await user.click(tab(lt.waitingQueue));
    expect(screen.getByText(lt.shelfElsewhereHint(1))).toBeInTheDocument();
    expect(stockCalls()).toHaveLength(1);
    expect(reads).toHaveLength(2);
  });

  it('leaves a full page uncounted, and works without the stock when it can’t be read', async () => {
    const user = userEvent.setup();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    lists = { ALLOCATED: [], WAITING: Array.from({ length: 100 }, (_, n) => waiting(n)) };
    respond = () => new Error('offline');
    open();
    await waitFor(() => expect(tab(lt.awaitingPickup)).toHaveTextContent('0'));
    // 100 rows may not be the whole queue.
    expect(tab(lt.waitingQueue).textContent).toBe(lt.waitingQueue);
    await user.click(tab(lt.waitingQueue));
    expect(await screen.findByText('Book b99')).toBeInTheDocument();
    // 100 titles: two calls, and when they fail the column goes and the list stays.
    await waitFor(() => expect(screen.queryByRole('columnheader', { name: lt.shelfElsewhere })).toBeNull());
    expect(stockCalls().map((c) => (c.bookIds as string[]).length)).toEqual([60, 40]);
    expect(screen.getAllByRole('button', { name: lt.cancelReservation })).toHaveLength(100);
  });
});
