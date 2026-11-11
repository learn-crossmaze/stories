import { describe, expect, it } from 'vitest';

import { attentionFrom } from '../admin/attention';
import { paths } from '../paths';

describe('what waits for you (menu counts)', () => {
  it('puts each waiting thing beside the page where it is done', () => {
    expect(
      attentionFrom({
        branch: { inspection: 2, incoming: 1, approvals: 3 },
        unshelved: 4,
        deliveries: { requested: 1, returning: 2 },
        renewalsDue: 5,
        docs: { pending: 1, expired: 1 },
        corrections: 2,
        unfinalized: true,
        leave: 1,
        payroll: 0,
        website: { publishable: 3, reviews: 1, newSubmissions: 6 },
        onboardingMissing: 13,
      }),
    ).toEqual({
      [paths.adminDesk]: 2,
      [paths.adminShelve]: 4,
      [paths.adminTransfers]: 1,
      [paths.opsDeliveries]: 3,
      [paths.adminDeposits]: 3,
      [paths.adminMembers]: 5,
      [paths.adminDocuments]: 2,
      [paths.adminAttendance]: 3,
      [paths.adminLeave]: 1,
      [paths.adminWebsite]: 3,
      [paths.adminWebsiteBlog]: 1,
      [paths.adminWebsiteSubmissions]: 6,
      [paths.adminMyOnboarding]: 13,
    });
  });

  it('shows nothing where nothing waits, or the count isn’t this person’s', () => {
    expect(attentionFrom({})).toEqual({});
    expect(attentionFrom({ branch: { inspection: 0, incoming: 0, approvals: 0 }, website: { publishable: 0, reviews: 0, newSubmissions: null }, unfinalized: false })).toEqual({});
  });
});
