import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Copy, Location } from '../data/inventory';
import { t } from '../strings';
import { lt } from '../strings/library';

// Shelve books while its list is read again ("Check for more books"), and the labels of the ticked books.
type Sent = { action: string; locationId: string; copyIds: string[]; requestId: string };
const calls: Sent[] = [];

vi.mock('firebase/functions', () => ({
  httpsCallable: () => async (data: Sent) => {
    calls.push(data);
    return { data: { shelved: data.copyIds.length, unchanged: 0 } };
  },
}));
vi.mock('../data/services', () => ({ services: () => ({ fns: {}, db: {} }) }));
vi.mock('../admin/Workspace', () => ({ useWorkspace: () => ({ org: { id: 'o1' }, branch: { id: 'b1', name: 'Central' }, branchesLoading: false }) }));

const reads = vi.hoisted(() => ({ unshelvedCopies: vi.fn(), listLocations: vi.fn(), findCopy: vi.fn() }));
vi.mock('../data/inventory', async (importOriginal) => ({ ...(await importOriginal<typeof import('../data/inventory')>()), ...reads }));

const { ShelvePage } = await import('../admin/inventory/Shelve');

const copy = (n: number, over: Partial<Copy> = {}): Copy => ({
  id: `c${n}`, code: `C-${n}`, barcode: `BC-${n}`, bookId: 'bk1', bookCode: 'B1', bookTitle: `Book ${n}`, owningBranchId: 'b1', currentBranchId: 'b1',
  locationId: null, status: 'AVAILABLE', condition: 'GOOD', acquisitionCostMinor: 0, activeLoanId: null, activeReservationId: null, lifetimeLoans: 0,
  ...over,
});
const shelves: Location[] = [
  { id: 'A', code: 'FIC-1', label: 'Fiction', kind: 'SHELF', status: 'ACTIVE' },
  { id: 'B', code: 'KID-1', label: 'Children', kind: 'SHELF', status: 'ACTIVE' },
];

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
/** A read the test answers when it chooses. */
function held<T>() {
  let answer: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolve) => (answer = resolve));
  return { promise, answer };
}

beforeEach(() => {
  calls.length = 0;
  reads.unshelvedCopies.mockReset();
  reads.findCopy.mockReset().mockResolvedValue(null);
  reads.listLocations.mockReset().mockResolvedValue(shelves);
});

describe('Shelve books: reading the list again', () => {
  it('keeps the ticks on books still listed and the copies scanned in from other shelves', async () => {
    const { user, scan } = await open([copy(1), copy(2), copy(3)]);
    await user.click(tick('C-1'));
    await user.click(tick('C-2'));
    // A copy from another shelf, scanned in to move it.
    reads.findCopy.mockResolvedValue(copy(9, { locationId: 'B' }));
    await user.type(scan, 'BC-9{Enter}');
    await waitFor(() => expect(tick('C-9')).toBeChecked());

    // A colleague inspected two more, and shelved C-2 meanwhile.
    reads.unshelvedCopies.mockResolvedValue([copy(1), copy(3), copy(4), copy(5)]);
    await user.click(screen.getByRole('button', { name: lt.shelveRefresh }));
    expect(await screen.findByLabelText(lt.shelveSelectRow('C-5'))).toBeInTheDocument();
    expect(tick('C-1')).toBeChecked();
    expect(tick('C-9')).toBeChecked();
    expect(tick('C-3')).not.toBeChecked();
    expect(tick('C-4')).not.toBeChecked();
    expect(row('C-2')).toBeNull();
    // The tick of the book that left the list went with it: two books are in hand, not three.
    expect(screen.getByRole('link', { name: lt.shelveLabels(2) })).toBeInTheDocument();
  });

  it('holds both save buttons while the list is read again, so an older read cannot undo a save on screen', async () => {
    const { user, shelf } = await open([copy(1, { lastLocationId: 'A' }), copy(2)]);
    await user.click(tick('C-1'));
    await user.selectOptions(shelf, 'A');
    const back = screen.getByRole('button', { name: lt.shelveBack(1) });
    const put = screen.getByRole('button', { name: lt.shelveSubmit(1, 'FIC-1') });
    expect(back).toBeEnabled();
    expect(put).toBeEnabled();

    const again = held<Copy[]>();
    reads.unshelvedCopies.mockReturnValue(again.promise);
    await user.click(screen.getByRole('button', { name: lt.shelveRefresh }));
    expect(await screen.findByRole('button', { name: t.loading })).toBeDisabled();
    expect(back).toBeDisabled();
    expect(put).toBeDisabled();
    await user.click(put);
    expect(calls).toHaveLength(0);

    again.answer([copy(1, { lastLocationId: 'A' }), copy(2)]);
    await waitFor(() => expect(put).toBeEnabled());
    expect(back).toBeEnabled();
    // The tick was kept, so the save is one click away; the shelved book then stays off the list.
    await user.click(put);
    await waitFor(() => expect(row('C-1')).toBeNull());
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ action: 'copies-shelve', locationId: 'A', copyIds: ['c1'] });
    expect(row('C-2')).not.toBeNull();
    expect(reads.unshelvedCopies).toHaveBeenCalledTimes(2);
  });

  it('prints labels for the ticked books from what is on the page, with no shelf picked', async () => {
    const { user } = await open([copy(1), copy(2), copy(3)]);
    expect(screen.queryByRole('link', { name: /^Print labels/ })).toBeNull();
    await user.click(tick('C-1'));
    await user.click(tick('C-3'));
    const link = screen.getByRole('link', { name: lt.shelveLabels(2) });
    expect(link.getAttribute('href')!.split('copies=')[1].split(',')).toEqual(['c1', 'c3']);
  });
});
