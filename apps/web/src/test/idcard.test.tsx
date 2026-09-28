import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { IdCard } from '../IdCard';

describe('member ID card', () => {
  it('shows the name, member code and a QR code of the member code', async () => {
    render(<IdCard info={{ orgName: 'Stories Corporate', branchName: 'Central', fullName: 'Asha Rao', code: 'MEM-000001', validUntil: '2026-12-28T00:00:00Z', guardianName: null }} />);
    expect(screen.getByRole('img', { name: /Asha Rao, member code MEM-000001/ })).toBeInTheDocument();
    expect(screen.getByText('MEM-000001')).toBeInTheDocument();
    expect(screen.getByText(/Plan valid until 28 Dec 2026/)).toBeInTheDocument();
    expect(await screen.findByRole('img', { name: 'QR code MEM-000001' })).toBeInTheDocument();
  });
});
