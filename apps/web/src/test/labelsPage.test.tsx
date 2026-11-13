import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { lt } from '../strings/library';

// The label sheet: the labels come with the link that led there; opened any other way, the copies are read.
vi.mock('../data/services', () => ({ services: () => ({ fns: {}, db: {} }) }));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ claims: { v: 1, sa: true, o: {} } }) }));
vi.mock('../admin/Workspace', () => ({ useWorkspace: () => ({ org: { id: 'o1' }, branch: { id: 'b1', name: 'Central' }, branchName: (id: string) => id }) }));
const reads = vi.hoisted(() => ({ getCopy: vi.fn(), listLocations: vi.fn() }));
vi.mock('../data/inventory', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../data/inventory')>()),
  ...reads,
  listCopies: async () => ({ items: [] }),
  unshelvedCount: async () => 0,
}));

const { InventoryPage, LabelsPage, labelsLink, LABELS_IN_LINK } = await import('../admin/inventory/Inventory');

const copies = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `c${i + 1}`, barcode: `BC-${i + 1}`, title: `Book ${i + 1}` }));

function open(entry: string | { pathname: string; search: string; state: unknown }) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/ops/inventory" element={<InventoryPage />} />
        <Route path="/ops/labels" element={<LabelsPage />} />
      </Routes>
    </MemoryRouter>,
  );
}
const sheet = (view: { container: HTMLElement }) => [...view.container.querySelectorAll('.label')];

beforeEach(() => {
  reads.getCopy.mockReset().mockImplementation(async (_org: string, id: string) => ({ id, barcode: `READ-${id}`, bookTitle: `Read ${id}` }));
  reads.listLocations.mockReset().mockResolvedValue([
    { id: 'A', code: 'FIC-1', label: 'Fiction', kind: 'SHELF', status: 'ACTIVE' },
    { id: 'B', code: 'KID-1', label: 'Children', kind: 'SHELF', status: 'ACTIVE' },
    { id: 'OLD', code: 'OLD-1', label: 'Old bay', kind: 'SHELF', status: 'ARCHIVED' },
  ]);
});

describe('Labels', () => {
  it('prints the labels handed over with the link at once, however many, without reading a copy', () => {
    const link = labelsLink(copies(130));
    // The address carries what a new tab can read; the labels themselves travel with the link.
    expect(link.to.split('copies=')[1].split(',')).toHaveLength(LABELS_IN_LINK);
    const [pathname, search] = link.to.split('?');
    const view = open({ pathname, search: `?${search}`, state: link.state });
    expect(sheet(view)).toHaveLength(130);
    expect(sheet(view)[129]).toHaveTextContent('BC-130');
    expect(sheet(view)[129]).toHaveTextContent('Book 130');
    expect(screen.getByText(lt.labelsCount(130, 6), { exact: false })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: lt.print })).toBeEnabled();
    expect(reads.getCopy).not.toHaveBeenCalled();
  });

  it('reads the copies named in the address when nothing was handed over (a new tab, a pasted link)', async () => {
    const view = open('/ops/labels?copies=c1,c2,c3');
    expect(await screen.findByText(lt.labelsCount(3, 1), { exact: false })).toBeInTheDocument();
    expect(reads.getCopy.mock.calls.map((c) => c[1])).toEqual(['c1', 'c2', 'c3']);
    // The label holds the copy's own barcode.
    expect(sheet(view).map((l) => l.textContent)).toEqual([expect.stringContaining('READ-c1'), expect.stringContaining('READ-c2'), expect.stringContaining('READ-c3')]);
  });

  it('ignores a handed list that is not labels', async () => {
    open({ pathname: '/ops/labels', search: '?copies=c1', state: { labels: [{ barcode: 7 }] } });
    expect(await screen.findByText(lt.labelsCount(1, 1), { exact: false })).toBeInTheDocument();
    expect(reads.getCopy).toHaveBeenCalledTimes(1);
  });

  it('prints the copies it can read and says how many are left out', async () => {
    reads.getCopy.mockImplementation(async (_org: string, id: string) => {
      if (id === 'c2') throw Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' });
      return id === 'c3' ? null : { id, barcode: `READ-${id}`, bookTitle: `Read ${id}` };
    });
    const view = open('/ops/labels?copies=c1,c2,c3');
    expect(await screen.findByText(lt.labelsMissing(2))).toBeInTheDocument();
    expect(sheet(view)).toHaveLength(1);
  });

  it('says why when no copy could be read, and when there is nothing to print', async () => {
    reads.getCopy.mockRejectedValue(Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' }));
    const refused = open('/ops/labels?copies=c1,c2');
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(sheet(refused)).toHaveLength(0);
    refused.unmount();

    open('/ops/labels');
    expect(await screen.findByText(lt.labelsNone)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: lt.print })).toBeDisabled();
  });

  it('prints a label per shelf in use from Inventory, holding the code that picks the shelf on Shelve books', async () => {
    const view = open('/ops/inventory');
    await userEvent.click(await screen.findByRole('link', { name: lt.shelfLabels }));
    expect(sheet(view).map((l) => l.textContent)).toEqual([expect.stringContaining('FIC-1'), expect.stringContaining('KID-1')]);
    expect(sheet(view)[0]).toHaveTextContent('Fiction');
    expect(reads.getCopy).not.toHaveBeenCalled();
  });
});
