import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FirebaseError } from 'firebase/app';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { StoriesClaims } from '../auth/claims';
import { PERMISSION_CODES } from '../generated/rbac';
import { lt } from '../strings/library';

// Receive books: sending what was just received on to other branches, with the server faked at the Cloud
// Functions boundary.
interface Item {
  bookId?: string;
  quantity: number;
}
interface Sent {
  action: string;
  requestId: string;
  items?: Item[];
  orgId?: string;
  fromBranchId?: string;
  toBranchId?: string;
  copyIds?: string[];
  note?: string;
  dispatch?: boolean;
}
const calls: Sent[] = [];
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

const SUPER: StoriesClaims = { v: 1, sa: true, o: {} };
const world = vi.hoisted(() => ({
  claims: null as unknown,
  branches: [] as { id: string; name: string; status: string }[],
}));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ claims: world.claims }) }));
vi.mock('../admin/Workspace', () => ({
  useWorkspace: () => ({
    org: { id: 'o1', type: 'CORPORATE' },
    branch: { id: 'b1', name: 'Head office' },
    branches: world.branches,
    branchName: (id: string) => world.branches.find((b) => b.id === id)?.name ?? id,
  }),
}));
const reads = vi.hoisted(() => ({ listLocations: vi.fn(), getCopy: vi.fn() }));
vi.mock('../data/inventory', async (importOriginal) => ({ ...(await importOriginal<typeof import('../data/inventory')>()), ...reads }));
vi.mock('../data/bulkBooks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../data/bulkBooks')>()),
  // Every ISBN is a title already in the catalogue.
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
const [A, B] = isbns(2);
const titleOf = (isbn: string) => `Title ${isbn}`;
const ids = (isbn: string, from: number, to: number) => Array.from({ length: to - from + 1 }, (_, k) => `cp-bk${isbn}-${from + k}`);

/** What copies-receive answers; `extra` adds to every line (`held`) and `allocated` is the call's count. */
const received = (items: Item[], allocated = 0, extra: Record<string, unknown> = {}) => ({
  received: items.map((it) => ({
    bookId: it.bookId!, title: titleOf(it.bookId!.slice(2)), isNew: false,
    codes: Array.from({ length: it.quantity }, (_, k) => `C-${it.bookId}-${k + 1}`),
    copyIds: Array.from({ length: it.quantity }, (_, k) => `cp-${it.bookId}-${k + 1}`),
    ...extra,
  })),
  newTitles: [],
  copies: items.reduce((n, it) => n + it.quantity, 0),
  allocated,
});
const sends = () => calls.filter((c) => c.action === 'transfers-create');
const onShelf = (id: string) => ({ id, status: 'AVAILABLE', currentBranchId: 'b1' });

/** Opens the page and receives `quantities[i]` copies of the i-th title. */
async function receive(quantities: number[]) {
  const user = userEvent.setup();
  render(
    <MemoryRouter>
      <BulkAddBooksPage />
    </MemoryRouter>,
  );
  const list = isbns(quantities.length);
  await user.click(screen.getByLabelText(lt.bulkIsbnLabel(1)));
  await user.paste(list.join('\n'));
  for (const [i, q] of quantities.entries()) {
    const copies = await screen.findByLabelText(lt.receiveCopiesRow(i + 1));
    await user.clear(copies);
    await user.type(copies, String(q));
  }
  const total = quantities.reduce((n, q) => n + q, 0);
  await user.click(await screen.findByRole('button', { name: lt.receiveSubmit(total) }));
  await screen.findByRole('link', { name: lt.receiveLabels(total) });
  return user;
}
const cell = (isbn: string, branch: string) => screen.getByLabelText(lt.sendCell(titleOf(isbn), branch));
const rowOf = (isbn: string) => within(cell(isbn, 'North').closest('tr')!);
/** The grid of titles against branches (the page's second table). */
const grid = () => within(cell(A, 'North').closest('table')!);

beforeEach(() => {
  calls.length = 0;
  respond = (data) => (data.action === 'copies-receive' ? received(data.items!) : { transferId: `t${calls.length}` });
  world.claims = SUPER;
  world.branches = [
    { id: 'b1', name: 'Head office', status: 'ACTIVE' },
    { id: 'b2', name: 'North', status: 'ACTIVE' },
    { id: 'b3', name: 'South', status: 'ACTIVE' },
    { id: 'b4', name: 'Closed one', status: 'ARCHIVED' },
  ];
  reads.listLocations.mockReset().mockResolvedValue([]);
  reads.getCopy.mockReset().mockImplementation(async (_org: string, id: string) => onShelf(id));
  localStorage.clear();
});

describe('Receive books: send to branches', () => {
  it('sends the copies typed for each branch in one transfer per branch, already on its way, then offers labels per branch', async () => {
    const user = await receive([5, 3]);
    await user.click(screen.getByRole('button', { name: lt.sendTitle }));
    // The other open branches only: not this one, not a closed one.
    expect(grid().getAllByRole('columnheader').map((h) => h.textContent)).toEqual([lt.sendBook, lt.sendCanGo, 'North', 'South', lt.sendStays]);
    expect(screen.getByRole('button', { name: lt.sendSubmit(0) })).toBeDisabled();
    await user.type(cell(A, 'North'), '2');
    await user.type(cell(A, 'South'), '1');
    await user.type(cell(B, 'South'), '3');
    await user.click(screen.getByRole('button', { name: lt.sendSubmit(6) }));

    expect(await screen.findByText(lt.sendDone(4, 'South'))).toBeInTheDocument();
    expect(screen.getByText(lt.sendDone(2, 'North'))).toBeInTheDocument();
    // Nothing is scanned again and no copy is read: the copies are the ones the delivery just made, in code order.
    expect(reads.getCopy).not.toHaveBeenCalled();
    expect(sends().map(({ requestId: _, ...sent }) => sent)).toEqual([
      { action: 'transfers-create', orgId: 'o1', fromBranchId: 'b1', toBranchId: 'b2', copyIds: ids(A, 1, 2), note: '', dispatch: true },
      { action: 'transfers-create', orgId: 'o1', fromBranchId: 'b1', toBranchId: 'b3', copyIds: [...ids(A, 3, 3), ...ids(B, 1, 3)], note: '', dispatch: true },
    ]);

    // One sheet of labels per pile, in place of the one for everything.
    expect(screen.queryByRole('link', { name: lt.receiveLabels(8) })).toBeNull();
    const north = screen.getByRole('link', { name: lt.receiveLabelsFor(2, 'North') }).getAttribute('href')!;
    expect(north.split('copies=')[1].split(',')).toEqual(ids(A, 1, 2));
    const south = screen.getByRole('link', { name: lt.receiveLabelsFor(4, 'South') }).getAttribute('href')!;
    expect(south.split('copies=')[1].split(',')).toEqual([...ids(A, 3, 3), ...ids(B, 1, 3)]);
    const here = screen.getByRole('link', { name: lt.receiveLabelsHere(2) }).getAttribute('href')!;
    expect(here.split('copies=')[1].split(',')).toEqual(ids(A, 4, 5));

    // What was sent is no longer offered, and the numbers are cleared.
    expect(rowOf(A).getAllByRole('cell').map((c) => c.textContent)).toEqual([titleOf(A), '2', '', '', '2']);
    expect(cell(A, 'North')).toHaveValue('');
    expect(cell(B, 'South')).toBeDisabled();
  });

  it('never sends more of a title than can go, and takes whole numbers only', async () => {
    const user = await receive([3]);
    await user.click(screen.getByRole('button', { name: lt.sendTitle }));
    await user.type(cell(A, 'North'), '2');
    await user.type(cell(A, 'South'), '2');
    expect(screen.getByText(lt.sendOver(3))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: lt.sendSubmit(4) })).toBeDisabled();
    await user.clear(cell(A, 'South'));
    await user.type(cell(A, 'South'), '1.5');
    expect(screen.getByText(lt.sendWhole)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: lt.sendSubmit(0) })).toBeDisabled();
    await user.clear(cell(A, 'South'));
    await user.type(cell(A, 'South'), '1');
    expect(screen.getByRole('button', { name: lt.sendSubmit(3) })).toBeEnabled();
    expect(sends()).toHaveLength(0);
  });

  it('splits a branch that gets more than one transfer takes', async () => {
    const user = await receive([50, 10]);
    await user.click(screen.getByRole('button', { name: lt.sendTitle }));
    await user.type(cell(A, 'North'), '50');
    await user.type(cell(B, 'North'), '10');
    await user.click(screen.getByRole('button', { name: lt.sendSubmit(60) }));
    expect(await screen.findByText(lt.sendDone(60, 'North'))).toBeInTheDocument();
    expect(sends().map((c) => [c.toBranchId, c.copyIds!.length])).toEqual([['b2', 50], ['b2', 10]]);
    expect(sends()[0].copyIds).toEqual(ids(A, 1, 50));
    expect(sends()[1].copyIds).toEqual(ids(B, 1, 10));
  });

  it('says which branch was refused, sends the others, and leaves out the copy that was taken so the rest can go', async () => {
    const user = await receive([4]);
    await user.click(screen.getByRole('button', { name: lt.sendTitle }));
    await user.type(cell(A, 'North'), '2');
    await user.type(cell(A, 'South'), '1');
    // A member reserved the first copy meanwhile: the transfer to North is refused whole.
    const refusal = Object.assign(new FirebaseError('functions/failed-precondition', 'C-1 is not on the shelf.'), { details: { reason: 'COPY_NOT_AVAILABLE' } });
    respond = (data) => (data.toBranchId === 'b2' ? refusal : { transferId: 't' });
    reads.getCopy.mockImplementation(async (_org: string, id: string) => (id === ids(A, 1, 1)[0] ? { id, status: 'RESERVED', currentBranchId: 'b1' } : onShelf(id)));
    await user.click(screen.getByRole('button', { name: lt.sendSubmit(3) }));

    expect(await screen.findByText(lt.sendFailed('North', 'C-1 is not on the shelf.'))).toHaveAttribute('role', 'alert');
    expect(screen.getByText(lt.sendDone(1, 'South'))).toBeInTheDocument();
    expect(await screen.findByText(lt.sendGone(1))).toBeInTheDocument();
    // Only the copies not sent were read: 1, 2 and 4 (3 went to South).
    expect(reads.getCopy.mock.calls.map((c) => c[1]).sort()).toEqual([...ids(A, 1, 2), ...ids(A, 4, 4)]);
    expect(screen.getByText(lt.sendKept(1))).toBeInTheDocument();

    // North's number is still there; sending again takes the next free copies.
    expect(cell(A, 'North')).toHaveValue('2');
    respond = () => ({ transferId: 't' });
    await user.click(screen.getByRole('button', { name: lt.sendSubmit(2) }));
    expect(await screen.findByText(lt.sendDone(2, 'North'))).toBeInTheDocument();
    expect(sends().at(-1)).toMatchObject({ toBranchId: 'b2', copyIds: [...ids(A, 2, 2), ...ids(A, 4, 4)] });
    expect(screen.getByRole('link', { name: lt.receiveLabelsHere(1) })).toBeInTheDocument();
  });

  it('keeps back the copies the delivery gave to waiting members when the answer says how many', async () => {
    respond = (data) => (data.action === 'copies-receive' ? received(data.items!, 2, { held: 2 }) : { transferId: 't' });
    const user = await receive([5]);
    await user.click(screen.getByRole('button', { name: lt.sendTitle }));
    expect(screen.getByText(lt.sendKept(2))).toBeInTheDocument();
    expect(reads.getCopy).not.toHaveBeenCalled();
    await user.type(cell(A, 'North'), '4');
    expect(screen.getByText(lt.sendOver(3))).toBeInTheDocument();
    await user.clear(cell(A, 'North'));
    await user.type(cell(A, 'North'), '3');
    await user.click(screen.getByRole('button', { name: lt.sendSubmit(3) }));
    await waitFor(() => expect(sends()).toHaveLength(1));
    // The first copies are the members': never sent.
    expect(sends()[0].copyIds).toEqual(ids(A, 3, 5));
  });

  it('reads the copies first when the delivery served waiting members and the answer does not say which', async () => {
    respond = (data) => (data.action === 'copies-receive' ? received(data.items!, 1) : { transferId: 't' });
    reads.getCopy.mockImplementation(async (_org: string, id: string) => (id === ids(A, 1, 1)[0] ? { id, status: 'RESERVED', currentBranchId: 'b1' } : onShelf(id)));
    const user = await receive([3]);
    expect(reads.getCopy).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: lt.sendTitle }));
    expect(await screen.findByText(lt.sendKept(1))).toBeInTheDocument();
    expect(reads.getCopy).toHaveBeenCalledTimes(3);
    await user.type(cell(A, 'South'), '2');
    await user.click(screen.getByRole('button', { name: lt.sendSubmit(2) }));
    await waitFor(() => expect(sends()).toHaveLength(1));
    expect(sends()[0].copyIds).toEqual(ids(A, 2, 3));
  });

  it('is offered only to staff who may transfer from this branch, and only when another branch is open', async () => {
    // Looks after copies here, but may not transfer.
    world.claims = { v: 1, sa: false, o: { o1: { r: [], b: ['b1'], p: PERMISSION_CODES['copies.manage'] + PERMISSION_CODES['books.view'] } } };
    await receive([2]);
    expect(screen.queryByRole('button', { name: lt.sendTitle })).toBeNull();
  });

  it('is not offered when this is the only open branch', async () => {
    world.branches = world.branches.filter((b) => b.id === 'b1' || b.status !== 'ACTIVE');
    await receive([2]);
    expect(screen.queryByRole('button', { name: lt.sendTitle })).toBeNull();
  });
});
