import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { lt } from '../strings/library';

// Receive books with the real camera panel (bulkReceive.test.tsx stands a button in for it).
vi.mock('../data/services', () => ({ services: () => ({ fns: {}, db: {} }) }));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ claims: { v: 1, sa: true, o: {} } }) }));
vi.mock('../admin/Workspace', () => ({
  useWorkspace: () => ({ org: { id: 'o1', type: 'CORPORATE' }, branch: { id: 'b1', name: 'Central' }, branches: [], branchName: (id: string) => id }),
}));
vi.mock('../data/inventory', async (importOriginal) => ({ ...(await importOriginal<typeof import('../data/inventory')>()), listLocations: async () => [] }));

const { BulkAddBooksPage } = await import('../admin/catalogue/BulkAddBooks');

describe('Receive books: the camera', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('asks to hold up the ISBN barcode, and says why when the camera cannot be used', async () => {
    vi.stubGlobal('isSecureContext', true);
    let refuse: (e: Error) => void = () => undefined;
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: () => new Promise((_, reject) => (refuse = reject)), enumerateDevices: async () => [] },
    });
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <BulkAddBooksPage />
      </MemoryRouter>,
    );
    const toggle = screen.getByRole('button', { name: lt.receiveCamera });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    // The back cover's barcode, not a copy label's QR code.
    expect(await screen.findByText(lt.camHintIsbn)).toBeInTheDocument();
    expect(screen.queryByText(lt.camHint)).toBeNull();

    refuse(Object.assign(new Error('denied'), { name: 'NotAllowedError' }));
    expect(await screen.findByText(/Camera access is blocked/)).toHaveAttribute('role', 'alert');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByText(/Camera access is blocked/)).toBeNull();
  });
});
