import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ScanInput } from '../admin/kit';

describe('camera scanning', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('offers the camera next to the scan box and explains when access is blocked', async () => {
    vi.stubGlobal('isSecureContext', true);
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: () => Promise.reject(Object.assign(new Error('denied'), { name: 'NotAllowedError' })), enumerateDevices: async () => [] },
    });
    render(<ScanInput label="Find a copy" onScan={() => undefined} />);
    await userEvent.click(screen.getByRole('button', { name: 'Scan with the camera' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Camera access is blocked/);
    await userEvent.click(screen.getAllByRole('button', { name: 'Stop camera' }).at(-1)!);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
