import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Copy, Location } from '../data/inventory';
import { lt } from '../strings/library';

// A copy's page painted from the copy carried with the link (it can be hours old: history keeps it through Back
// and a reload): its forms open only once the page's own read has answered.
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
vi.mock('../admin/Workspace', () => ({ useWorkspace: () => ({ org: { id: 'o1' }, branch: { id: 'b1', name: 'Central' }, branchesLoading: false, branchName: (id: string) => id }) }));

const reads = vi.hoisted(() => ({ getCopy: vi.fn(), copyEvents: vi.fn(), listLocations: vi.fn(), getBook: vi.fn() }));
vi.mock('../data/inventory', async (importOriginal) => ({ ...(await importOriginal<typeof import('../data/inventory')>()), getCopy: reads.getCopy, copyEvents: reads.copyEvents, listLocations: reads.listLocations }));
vi.mock('../data/catalogue', async (importOriginal) => ({ ...(await importOriginal<typeof import('../data/catalogue')>()), getBook: reads.getBook }));

const { CopyDetailPage } = await import('../admin/inventory/Inventory');

const copy = (over: Partial<Copy> = {}): Copy => ({
  id: 'c1', code: 'C-1', barcode: 'C-1', bookId: 'bk1', bookCode: 'B1', bookTitle: 'A book', owningBranchId: 'b1', currentBranchId: 'b1',
  locationId: 'A', status: 'AVAILABLE', condition: 'FAIR', acquisitionCostMinor: 0, activeLoanId: null, activeReservationId: null, lifetimeLoans: 0,
  ...over,
});
const shelves: Location[] = [
  { id: 'A', code: 'FIC-1', label: 'Fiction', kind: 'SHELF', status: 'ACTIVE' },
  { id: 'B', code: 'KID-1', label: 'Children', kind: 'SHELF', status: 'ACTIVE' },
];

beforeEach(() => {
  calls.length = 0;
  reads.getCopy.mockReset();
  reads.copyEvents.mockReset().mockResolvedValue([]);
  reads.listLocations.mockReset().mockResolvedValue(shelves);
  reads.getBook.mockReset().mockResolvedValue(null);
});

describe('Copy page opened with a carried copy', () => {
  it('holds its forms until its own read answers, and then starts them from what the copy has now', async () => {
    let answer: (c: Copy | null) => void = () => undefined;
    reads.getCopy.mockReturnValue(new Promise<Copy | null>((resolve) => (answer = resolve)));
    const user = userEvent.setup();
    // Carried: Fair, on shelf A. Since then it was recorded as Poor and moved to shelf B.
    render(
      <MemoryRouter initialEntries={[{ pathname: '/ops/inventory/c1', state: { copy: copy() } }]}>
        <Routes>
          <Route path="/ops/inventory/:copyId" element={<CopyDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );
    const record = screen.getByRole('button', { name: lt.recordCondition });
    const move = screen.getByRole('button', { name: lt.relocate });
    await waitFor(() => expect(reads.listLocations).toHaveBeenCalled());
    expect(record).toBeDisabled();
    expect(move).toBeDisabled();
    await user.click(record);
    expect(screen.queryByRole('dialog')).toBeNull();

    answer(copy({ condition: 'POOR', locationId: 'B' }));
    await waitFor(() => expect(screen.getByRole('button', { name: lt.recordCondition })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: lt.recordCondition }));
    expect(screen.getByLabelText(lt.condition)).toHaveValue('POOR');
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: lt.relocate }));
    expect(await screen.findByLabelText(lt.location)).toHaveValue('B');
    expect(calls).toHaveLength(0);
  });
});
