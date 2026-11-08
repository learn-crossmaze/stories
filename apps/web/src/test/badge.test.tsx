import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { CopyStatusBadge } from '../admin/inventory/Inventory';
import { makeStatusBadge, StatusBadge } from '../shared/ui';
import { t } from '../strings';

describe('status chips', () => {
  it('render the same chip markup as before: words plus a tone class', () => {
    const Chip = makeStatusBadge<'OPEN' | 'SHUT'>({ OPEN: 'ok', SHUT: 'danger' }, { OPEN: 'Open', SHUT: 'Shut' });
    const { container } = render(
      <>
        <Chip status="SHUT" className="nowrap" />
        <StatusBadge status="SUSPENDED" />
        <StatusBadge status="SOMETHING_NEW" />
        <CopyStatusBadge status="UNDER_INSPECTION" />
      </>,
    );
    expect(container.innerHTML).toBe(
      '<span class="badge badge-danger nowrap">Shut</span>' +
        `<span class="badge badge-warn">${t.suspended}</span>` +
        '<span class="badge badge-muted">SOMETHING_NEW</span>' +
        `<span class="badge badge-warn">${screen.getByText(/inspection/i).textContent}</span>`,
    );
  });
});
