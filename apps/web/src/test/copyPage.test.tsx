import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Copy, Location } from '../data/inventory';
import { t } from '../strings';
import { lt } from '../strings/library';

// A copy's page: opened with the copy a scan or a list row just read, and its dialogs starting from what the copy has.
type Sent = Record<string, unknown> & { action: string };
const calls: Sent[] = [];

vi.mock('firebase/functions', () => ({
  httpsCallable: () => async (data: Sent) => {
    calls.push(data);
    return { data: {} };
  },
}));
vi.mock('../data/services', () => ({ services: () => ({ fns: {}, db: {} }) }));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ claims: { v: 1, sa: true, o: {} } }) }));
vi.mock('../admin/Workspace', () => ({
  useWorkspace: () => ({ org: { id: 'o1' }, branch: { id: 'b1', name: 'Central' }, branchesLoading: false, branchName: (id: string) => (id === 'b1' ? 'Central' : id) }),
}));

const reads = vi.hoisted(() => ({ getCopy: vi.fn(), copyEvents: vi.fn(), listLocations: vi.fn(), getBook: vi.fn(), findCopy: vi.fn() }));
vi.mock('../data/inventory', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../data/inventory')>()),
  getCopy: reads.getCopy,
  copyEvents: reads.copyEvents,
  listLocations: reads.listLocations,
  findCopy: reads.findCopy,
  listCopies: async () => ({ items: [] }),
  unshelvedCount: async () => 0,
}));
vi.mock('../data/catalogue', async (importOriginal) => ({ ...(await importOriginal<typeof import('../data/catalogue')>()), getBook: reads.getBook }));

const { CopyDetailPage, InventoryPage } = await import('../admin/inventory/Inventory');

const copy = (over: Partial<Copy> = {}): Copy => ({
  id: 'c1', code: 'C-1', barcode: 'C-1', bookId: 'bk1', bookCode: 'B1', bookTitle: 'A book', owningBranchId: 'b1', currentBranchId: 'b1',
  locationId: 'A', status: 'AVAILABLE', condition: 'FAIR', acquisitionCostMinor: 0, activeLoanId: null, activeReservationId: null, lifetimeLoans: 0,
  ...over,
});
const shelves: Location[] = [
  { id: 'A', code: 'FIC-1', label: 'Fiction', kind: 'SHELF', status: 'ACTIVE' },
  { id: 'B', code: 'KID-1', label: 'Children', kind: 'SHELF', status: 'ACTIVE' },
  { id: 'OLD', code: 'OLD-1', label: 'Old bay', kind: 'SHELF', status: 'ARCHIVED' },
];

/** Opens /ops/inventory/c1, as a scan or a row link does when `carried` is given. */
function open(carried?: Copy) {
  render(
    <MemoryRouter initialEntries={[{ pathname: '/ops/inventory/c1', state: carried ? { copy: carried } : null }]}>
      <Routes>
        <Route path="/ops/inventory/:copyId" element={<CopyDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
  return userEvent.setup();
}
/** A read the test answers when it chooses. */
function held<T>() {
  let answer: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolve) => (answer = resolve));
  return { promise, answer };
}

beforeEach(() => {
  calls.length = 0;
  reads.getCopy.mockReset();
  reads.copyEvents.mockReset().mockResolvedValue([]);
  reads.listLocations.mockReset().mockResolvedValue(shelves);
  reads.getBook.mockReset().mockResolvedValue(null);
  reads.findCopy.mockReset().mockResolvedValue(null);
});

describe('Copy page', () => {
  it('shows the copy it was opened with at once, reads its shelves and book alongside, then shows the fresh read', async () => {
    const fresh = held<Copy | null>();
    reads.getCopy.mockReturnValue(fresh.promise);
    open(copy());
    // No wait for the copy: the page is up, and the shelves and the book are already being read.
    expect(screen.getByRole('heading', { level: 1, name: 'C-1' })).toBeInTheDocument();
    expect(screen.getByText('Available')).toBeInTheDocument();
    await waitFor(() => expect(reads.listLocations).toHaveBeenCalledWith('o1', 'b1'));
    expect(reads.getBook).toHaveBeenCalledWith('bk1');

    fresh.answer(copy({ status: 'DAMAGED' }));
    expect(await screen.findByText('Damaged')).toBeInTheDocument();
    expect(screen.queryByText('Available')).toBeNull();
    expect(reads.getCopy).toHaveBeenCalledTimes(1);
    expect(reads.listLocations).toHaveBeenCalledTimes(1);
    expect(reads.getBook).toHaveBeenCalledTimes(1);
  });

  it('opens a scanned copy with what the scan read, without waiting for a second read', async () => {
    reads.findCopy.mockResolvedValue(copy());
    reads.getCopy.mockReturnValue(held<Copy | null>().promise);
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/ops/inventory']}>
        <Routes>
          <Route path="/ops/inventory" element={<InventoryPage />} />
          <Route path="/ops/inventory/:copyId" element={<CopyDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await user.type(await screen.findByLabelText(lt.findCopy), 'C-1{Enter}');
    expect(await screen.findByRole('heading', { level: 1, name: 'C-1' })).toBeInTheDocument();
    expect(reads.getCopy).toHaveBeenCalledWith('o1', 'c1');
  });

  it('trusts the fresh read over the copy it was opened with', async () => {
    // Kept in the browser history, the copy can be long gone (or out of this branch) when the page is opened again.
    reads.getCopy.mockResolvedValue(null);
    open(copy());
    expect(await screen.findByRole('heading', { name: t.notFoundTitle })).toBeInTheDocument();
    expect(screen.queryByText('C-1')).toBeNull();
  });

  it('never shows another copy while its own is read', async () => {
    const fresh = held<Copy | null>();
    reads.getCopy.mockReturnValue(fresh.promise);
    open(copy({ id: 'c2', code: 'C-2' }));
    expect(screen.queryByText('C-2')).toBeNull();
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
    fresh.answer(copy());
    expect(await screen.findByRole('heading', { level: 1, name: 'C-1' })).toBeInTheDocument();
  });

  it("starts the condition dialogs from the copy's own condition, but a repair from Good", async () => {
    reads.getCopy.mockResolvedValue(copy({ status: 'DAMAGED', condition: 'POOR' }));
    const user = open();
    await user.click(await screen.findByRole('button', { name: lt.recordCondition }));
    let dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByLabelText(lt.condition)).toHaveValue('POOR');
    await user.click(dialog.getByRole('button', { name: t.save }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({ action: 'copies-recordCondition', copyId: 'c1', condition: 'POOR' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    await user.click(screen.getByRole('button', { name: lt.repair }));
    dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByLabelText(lt.condition)).toHaveValue('GOOD');
  });

  it('starts an inspection from the condition the copy came back in', async () => {
    reads.getCopy.mockResolvedValue(copy({ status: 'UNDER_INSPECTION', condition: 'FAIR', locationId: null }));
    const user = open();
    await user.click(await screen.findByRole('button', { name: lt.inspect }));
    expect(within(screen.getByRole('dialog')).getByLabelText(lt.condition)).toHaveValue('FAIR');
  });

  it("starts a move on the copy's shelf and saves only a real move", async () => {
    reads.getCopy.mockResolvedValue(copy());
    const user = open();
    await user.click(await screen.findByRole('button', { name: lt.relocate }));
    const dialog = within(await screen.findByRole('dialog'));
    const shelf = dialog.getByLabelText(lt.location);
    expect(shelf).toHaveValue('A');
    expect(dialog.getByRole('button', { name: t.save })).toBeDisabled();
    await user.selectOptions(shelf, 'B');
    await user.click(dialog.getByRole('button', { name: t.save }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({ action: 'copies-relocate', copyId: 'c1', locationId: 'B' });
  });

  it('starts a move at "not shelved" when the copy sits on a shelf that is no longer in use', async () => {
    reads.getCopy.mockResolvedValue(copy({ locationId: 'OLD' }));
    const user = open();
    await user.click(await screen.findByRole('button', { name: lt.relocate }));
    const dialog = within(await screen.findByRole('dialog'));
    expect(dialog.getByLabelText(lt.location)).toHaveValue('');
    // Taking it off the closed shelf is a real change, so it can be saved as it stands.
    expect(dialog.getByRole('button', { name: t.save })).toBeEnabled();
  });
});
