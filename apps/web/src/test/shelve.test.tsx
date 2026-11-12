import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FirebaseError } from 'firebase/app';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Copy, Location } from '../data/inventory';
import { lt } from '../strings/library';

// The Shelve books page, with the server faked at the Cloud Functions boundary and the reads held by the test.
type Sent = { action: string; locationId: string; copyIds: string[]; requestId: string };
const calls: Sent[] = [];
/** The server's answer to each copies-shelve (a thrown error, a result, or a promise of one). */
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
vi.mock('../admin/Workspace', () => ({ useWorkspace: () => ({ org: { id: 'o1' }, branch: { id: 'b1', name: 'Central' }, branchesLoading: false }) }));

const reads = vi.hoisted(() => ({ unshelvedCopies: vi.fn(), listLocations: vi.fn(), findCopy: vi.fn() }));
vi.mock('../data/inventory', async (importOriginal) => ({ ...(await importOriginal<typeof import('../data/inventory')>()), ...reads }));

const { ShelvePage } = await import('../admin/inventory/Shelve');

const copy = (n: number, over: Partial<Copy> = {}): Copy => ({
  id: `c${n}`, code: `C-${n}`, barcode: `C-${n}`, bookId: 'bk1', bookCode: 'B1', bookTitle: `Book ${n}`, owningBranchId: 'b1', currentBranchId: 'b1',
  locationId: null, status: 'AVAILABLE', condition: 'GOOD', acquisitionCostMinor: 0, activeLoanId: null, activeReservationId: null, lifetimeLoans: 0,
  ...over,
});
const shelves: Location[] = [
  { id: 'A', code: 'FIC-1', label: 'Fiction', kind: 'SHELF', status: 'ACTIVE' },
  { id: 'B', code: 'KID-1', label: 'Children', kind: 'SHELF', status: 'ACTIVE' },
  { id: 'OLD', code: 'OLD-1', label: 'Old bay', kind: 'SHELF', status: 'ARCHIVED' },
];
const shelved = (data: Sent) => ({ shelved: data.copyIds.length, unchanged: 0 });

async function open(waiting: Copy[]) {
  reads.unshelvedCopies.mockResolvedValue(waiting);
  const user = userEvent.setup();
  render(
    <MemoryRouter>
      <ShelvePage />
    </MemoryRouter>,
  );
  const scan = await screen.findByLabelText(lt.shelveScan);
  return { user, scan, shelf: screen.getByLabelText(lt.shelveShelf) as HTMLSelectElement };
}
const tick = (code: string) => screen.getByLabelText(lt.shelveSelectRow(code)) as HTMLInputElement;
const row = (code: string) => screen.queryByLabelText(lt.shelveSelectRow(code));
/** The copy codes listed, top to bottom. */
const listed = () => within(screen.getByRole('table')).getAllByRole('link').map((a) => a.textContent);

beforeEach(() => {
  calls.length = 0;
  respond = shelved;
  reads.unshelvedCopies.mockReset();
  reads.findCopy.mockReset().mockResolvedValue(null);
  reads.listLocations.mockReset().mockResolvedValue(shelves);
});

describe('Shelve books', () => {
  it('reads the list once for shelf after shelf, hides what was shelved, and keeps the keyboard in the scan box', async () => {
    const { user, scan, shelf } = await open([copy(1), copy(2), copy(3)]);
    expect(scan).toHaveFocus();

    // Picked with the mouse: the scan box takes the keyboard back.
    await user.selectOptions(shelf, 'A');
    expect(scan).toHaveFocus();
    await user.keyboard('c-1{Enter}');
    expect(tick('C-1')).toBeChecked();
    await user.click(screen.getByRole('button', { name: lt.shelveSubmit(1, 'FIC-1') }));
    expect(await screen.findByText(lt.shelveDone(1, 'FIC-1 · Fiction'))).toBeInTheDocument();
    expect(row('C-1')).toBeNull();
    expect(listed()).toEqual(['C-2', 'C-3']);
    await waitFor(() => expect(scan).toHaveFocus());

    // The next shelf is picked by its code, typed or scanned: no copy is looked up for it.
    await user.keyboard('C-2{Enter}kid-1{Enter}');
    expect(shelf).toHaveValue('B');
    expect(screen.getByText(lt.shelveShelfSet('KID-1 · Children'))).toBeInTheDocument();
    expect(reads.findCopy).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: lt.shelveSubmit(1, 'KID-1') }));
    expect(await screen.findByText(lt.shelveDone(1, 'KID-1 · Children'))).toBeInTheDocument();
    expect(listed()).toEqual(['C-3']);
    expect(tick('C-3')).not.toBeChecked();
    await waitFor(() => expect(scan).toHaveFocus());

    expect(calls.map((c) => [c.action, c.locationId, c.copyIds])).toEqual([
      ['copies-shelve', 'A', ['c1']],
      ['copies-shelve', 'B', ['c2']],
    ]);
    expect(reads.unshelvedCopies).toHaveBeenCalledTimes(1);
  });

  it('leaves the keyboard on the shelf list when the shelf is picked with the keyboard', async () => {
    const { scan, shelf } = await open([copy(1)]);
    shelf.focus();
    fireEvent.keyDown(shelf, { key: 'ArrowDown' });
    fireEvent.change(shelf, { target: { value: 'A' } });
    expect(shelf).toHaveValue('A');
    expect(shelf).toHaveFocus();
    expect(scan).not.toHaveFocus();
  });

  it('keeps a book scanned while a save is running ticked', async () => {
    let finish: (answer: unknown) => void = () => undefined;
    respond = () => new Promise((resolve) => (finish = resolve));
    const { user, scan, shelf } = await open([copy(1), copy(2), copy(3)]);
    await user.selectOptions(shelf, 'A');
    await user.keyboard('C-1{Enter}');
    await user.click(screen.getByRole('button', { name: lt.shelveSubmit(1, 'FIC-1') }));
    await waitFor(() => expect(calls).toHaveLength(1));

    await user.click(scan);
    await user.keyboard('C-2{Enter}');
    expect(tick('C-2')).toBeChecked();
    finish({ shelved: 1, unchanged: 0 });

    await waitFor(() => expect(row('C-1')).toBeNull());
    expect(tick('C-2')).toBeChecked();
    expect(tick('C-3')).not.toBeChecked();
    expect(calls[0].copyIds).toEqual(['c1']);
    expect(reads.unshelvedCopies).toHaveBeenCalledTimes(1);
  });

  it('puts the ticked books back on their usual shelves in one click, one call per shelf', async () => {
    reads.findCopy.mockResolvedValue(copy(9, { locationId: 'B', lastLocationId: 'A' }));
    // C-5 was lent from a shelf of another branch, C-6 from a shelf since archived, C-4 is new stock.
    const { user, scan } = await open([copy(1, { lastLocationId: 'B' }), copy(2, { lastLocationId: 'A' }), copy(3, { lastLocationId: 'B' }), copy(4), copy(5, { lastLocationId: 'ELSEWHERE' }), copy(6, { lastLocationId: 'OLD' })]);
    // Shelf by shelf, in the order of the shelves; the books with no usual shelf come last.
    expect(listed()).toEqual(['C-2', 'C-1', 'C-3', 'C-4', 'C-5', 'C-6']);
    const usual = (code: string) => within(tick(code).closest('tr')!).getAllByRole('cell')[4];
    expect(usual('C-1')).toHaveTextContent('KID-1 · Children');
    expect(usual('C-2')).toHaveTextContent('FIC-1 · Fiction');
    for (const code of ['C-4', 'C-5', 'C-6']) expect(usual(code)).toHaveTextContent(lt.shelveNoUsual);

    // A copy scanned in from another shelf is there to be moved: it is ticked, but not swept back.
    await user.keyboard('C-9{Enter}');
    expect(await screen.findByText(lt.shelveScannedOther('C-9', 'KID-1 · Children'))).toBeInTheDocument();
    await user.click(screen.getByLabelText(lt.shelveSelectAll));
    expect(screen.getByRole('button', { name: lt.shelveSubmit(7) })).toBeDisabled();

    respond = (data) => (data.locationId === 'A' ? new FirebaseError('functions/failed-precondition', 'Copy C-2 is issued.') : shelved(data));
    await user.click(screen.getByRole('button', { name: lt.shelveBack(3) }));
    expect(await screen.findByText(lt.shelveBackDone(2, ['KID-1 · Children']))).toBeInTheDocument();
    expect(screen.getByText(lt.shelveBackFailed('FIC-1 · Fiction', 'Copy C-2 is issued.'))).toBeInTheDocument();
    expect(calls.map((c) => [c.action, c.locationId, c.copyIds])).toEqual([
      ['copies-shelve', 'A', ['c2']],
      ['copies-shelve', 'B', ['c1', 'c3']],
    ]);
    expect(new Set(calls.map((c) => c.requestId)).size).toBe(2);

    // The refused shelf's book stays, ticked, with the ones that had nowhere to go back to.
    expect(listed()).toEqual(['C-9', 'C-2', 'C-4', 'C-5', 'C-6']);
    for (const code of ['C-9', 'C-2', 'C-4', 'C-5', 'C-6']) expect(tick(code)).toBeChecked();
    expect(screen.getByRole('button', { name: lt.shelveBack(1) })).toBeEnabled();
    expect(reads.unshelvedCopies).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(scan).toHaveFocus());
  });

  it('reports every shelf when several go back at once', async () => {
    const { user } = await open([copy(1, { lastLocationId: 'B' }), copy(2, { lastLocationId: 'A' }), copy(3, { lastLocationId: 'B' }), copy(4)]);
    await user.click(screen.getByLabelText(lt.shelveSelectAll));
    await user.click(screen.getByRole('button', { name: lt.shelveBack(3) }));
    expect(await screen.findByText(lt.shelveBackDone(3, ['FIC-1 (1)', 'KID-1 (2)']))).toBeInTheDocument();
    expect(listed()).toEqual(['C-4']);
    // Nothing left has a usual shelf, so only the shelf picker's button remains.
    expect(screen.queryByRole('button', { name: lt.shelveBack(0) })).toBeNull();
  });

  it('reads the list again before saying that every book is on a shelf', async () => {
    const { user, shelf } = await open([copy(1)]);
    let answer: (list: Copy[]) => void = () => undefined;
    reads.unshelvedCopies.mockReturnValue(new Promise<Copy[]>((resolve) => (answer = resolve)));
    await user.selectOptions(shelf, 'A');
    await user.click(tick('C-1'));
    await user.click(screen.getByRole('button', { name: lt.shelveSubmit(1, 'FIC-1') }));
    expect(await screen.findByText(lt.shelveDone(1, 'FIC-1 · Fiction'))).toBeInTheDocument();
    await waitFor(() => expect(reads.unshelvedCopies).toHaveBeenCalledTimes(2));
    expect(screen.queryByText(lt.shelveEmpty)).toBeNull();

    // A book inspected meanwhile shows; "every book is on a shelf" would have been wrong.
    answer([copy(7)]);
    expect(await screen.findByLabelText(lt.shelveSelectRow('C-7'))).toBeInTheDocument();
    expect(screen.queryByText(lt.shelveEmpty)).toBeNull();
  });

  it('keeps the ticks when a shelf refuses, and reads the list again only when part of a long list may have gone on', async () => {
    respond = () => new FirebaseError('functions/failed-precondition', 'Copy C-1 is issued.');
    const { user, scan, shelf } = await open(Array.from({ length: 101 }, (_, i) => copy(i + 1)));
    await user.selectOptions(shelf, 'A');
    await user.click(tick('C-1'));
    await user.click(screen.getByRole('button', { name: lt.shelveSubmit(1, 'FIC-1') }));
    expect(await screen.findByText('Copy C-1 is issued.')).toBeInTheDocument();
    expect(tick('C-1')).toBeChecked();
    expect(reads.unshelvedCopies).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(scan).toHaveFocus());

    // 101 books go in two calls: the first hundred are on the shelf when the second call is refused.
    respond = (data) => (calls.length === 2 ? shelved(data) : new FirebaseError('functions/failed-precondition', 'Copy C-101 is issued.'));
    reads.unshelvedCopies.mockResolvedValue([copy(101)]);
    await user.click(screen.getByLabelText(lt.shelveSelectAll));
    await user.click(screen.getByRole('button', { name: lt.shelveSubmit(101, 'FIC-1') }));
    expect(await screen.findByText('Copy C-101 is issued.')).toBeInTheDocument();
    await waitFor(() => expect(listed()).toEqual(['C-101']));
    expect(reads.unshelvedCopies).toHaveBeenCalledTimes(2);
    expect(calls.map((c) => c.copyIds.length)).toEqual([1, 100, 1]);
  });

  it('reads the list again after shelving when it was cut at the page size', async () => {
    const { UNSHELVED_PAGE } = await import('../data/inventory');
    const { user, shelf } = await open(Array.from({ length: UNSHELVED_PAGE }, (_, i) => copy(i + 1)));
    expect(screen.getByText(lt.shelveMore(UNSHELVED_PAGE))).toBeInTheDocument();
    reads.unshelvedCopies.mockResolvedValue([copy(2), copy(999)]);
    await user.selectOptions(shelf, 'A');
    await user.click(tick('C-1'));
    await user.click(screen.getByRole('button', { name: lt.shelveSubmit(1, 'FIC-1') }));
    // The rest of the queue, which did not fit before, shows.
    expect(await screen.findByLabelText(lt.shelveSelectRow('C-999'))).toBeInTheDocument();
    expect(reads.unshelvedCopies).toHaveBeenCalledTimes(2);
  });

  it('shows books inspected since the page was opened when asked to check', async () => {
    const { user, scan } = await open([copy(1)]);
    reads.unshelvedCopies.mockResolvedValue([copy(1), copy(2)]);
    await user.click(screen.getByRole('button', { name: lt.shelveRefresh }));
    expect(await screen.findByLabelText(lt.shelveSelectRow('C-2'))).toBeInTheDocument();
    await waitFor(() => expect(scan).toHaveFocus());
  });
});
