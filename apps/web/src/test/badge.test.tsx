import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { CopyStatusBadge } from '../admin/inventory/Inventory';
import { DayBadge } from '../admin/people/attendanceKit';
import { DocumentBadge } from '../admin/people/EmployeeDocuments';
import { LeaveBadge } from '../admin/people/leaveKit';
import { EmployeeStatusBadge } from '../admin/people/People';
import { RunBadge } from '../admin/people/payrollKit';
import { makeStatusBadge, StatusBadge } from '../shared/ui';
import { t } from '../strings';
import { ht } from '../strings/hr';

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

  it('keep the HR tones, words and muted fallback', () => {
    const { container } = render(
      <>
        <EmployeeStatusBadge status="NOTICE_PERIOD" />
        <DocumentBadge status="MISSING" />
        <DayBadge status="ABSENT" />
        <LeaveBadge status="APPROVED" />
        <RunBadge status="DRAFT" />
        <RunBadge status="SOMETHING_NEW" />
      </>,
    );
    expect(container.innerHTML).toBe(
      `<span class="badge badge-warn">${ht.status.NOTICE_PERIOD}</span>` +
        `<span class="badge badge-warn">${ht.docStatus.MISSING}</span>` +
        `<span class="badge badge-danger">${ht.dayStatus.ABSENT}</span>` +
        `<span class="badge badge-ok">${ht.leaveStatus.APPROVED}</span>` +
        `<span class="badge badge-info">${ht.runStatus.DRAFT}</span>` +
        '<span class="badge badge-muted">SOMETHING_NEW</span>',
    );
  });
});
