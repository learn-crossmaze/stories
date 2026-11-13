import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AttentionState, SetupWaiting } from '../admin/attention';
import type { StoriesClaims } from '../auth/claims';
import { paths } from '../paths';
import { t } from '../strings';
import { ct } from '../strings/control';
import { dt } from '../strings/delivery';

// The Dashboard's "Needs your attention" list beside the menu's counts: both are fed by the same reads.
const OWNER: StoriesClaims = { v: 1, sa: false, o: { corp: { r: ['OWN'], b: ['*'] } } };
const org = { id: 'corp', name: 'Corp' };
const branch = { id: 'cen', name: 'Central', status: 'ACTIVE' };
const world = vi.hoisted(() => ({ waitingNow: { counts: {}, total: 0, setup: {} } as unknown }));
const read = vi.hoisted(() => ({ deliveries: vi.fn(), branch: vi.fn(), unshelved: vi.fn() }));

vi.mock('../data/services', () => ({ services: () => ({ db: {}, fns: {} }) }));
vi.mock('firebase/functions', () => ({ httpsCallable: () => async () => ({ data: {} }) }));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ claims: OWNER, user: { uid: 'u1', displayName: 'Omar Khan', emailVerified: true } }) }));
vi.mock('../admin/Workspace', () => ({
  useWorkspace: () => ({ org, orgs: [org], orgsLoading: false, branches: [branch], branchesLoading: false, branch, myBranches: [branch] }),
}));
vi.mock('../admin/people/MyAttendance', () => ({ CheckInCard: () => null }));
vi.mock('../admin/people/OnboardingReminder', () => ({ useMyOnboarding: () => ({ data: null }) }));
vi.mock('../admin/attention', async (importOriginal) => {
  const real = await importOriginal<typeof import('../admin/attention')>();
  const none = async () => [];
  return {
    ...real,
    useWaiting: () => world.waitingNow,
    waiting: { branch: read.branch, unshelved: read.unshelved, deliveries: read.deliveries, corrections: none, lock: async () => ({ status: 'FINALIZED' }), leave: none, payroll: none },
  };
});
vi.mock('../data/circulation', async (orig) => ({ ...(await orig<typeof import('../data/circulation')>()), todayCounts: async () => ({ issuedToday: 0, exchangesToday: 0, holds: 0, waiting: 0 }) }));
vi.mock('../data/catalogue', async (orig) => ({ ...(await orig<typeof import('../data/catalogue')>()), catalogueCounts: async () => ({ titles: 10, addedThisMonth: 1 }) }));
vi.mock('../data/members', async (orig) => ({ ...(await orig<typeof import('../data/members')>()), memberCounts: async () => ({ ALL: 0, ACTIVE: 0, DUE: 0, EXPIRED: 0, NONE: 0 }) }));
vi.mock('../data/hrDocuments', async (orig) => ({
  ...(await orig<typeof import('../data/hrDocuments')>()),
  listDocumentTypes: async () => [],
  documentQueue: async () => ({ pending: [], expired: [], expiring: [] }),
}));
vi.mock('../data/org', async (orig) => ({
  ...(await orig<typeof import('../data/org')>()),
  listStaff: async () => [{ status: 'ACTIVE' }, { status: 'ACTIVE' }],
}));

const { attentionFrom } = await import('../admin/attention');
const { DashboardPage } = await import('../admin/dashboard/Dashboard');
const { clear } = await import('../shared/asyncCache');

const waitingWith = (setup: SetupWaiting | null): AttentionState => {
  const counts = attentionFrom({ setup });
  return { counts, total: Object.values(counts).reduce((a, n) => a + n, 0), setup };
};
const show = () =>
  render(
    <MemoryRouter>
      <DashboardPage />
    </MemoryRouter>,
  );
const todos = () => screen.getAllByRole('link').filter((a) => a.closest('.todo-list'));

beforeEach(() => {
  read.branch.mockResolvedValue({ inspection: 0, incoming: 0, approvals: 0 });
  read.unshelved.mockResolvedValue(0);
  read.deliveries.mockResolvedValue({ requested: 0, returning: 0 });
});
afterEach(() => {
  clear();
});

describe('Dashboard: what needs your attention', () => {
  it('names what waits under Master control, each line leading to its page, as the menu counts it', async () => {
    const setup: SetupWaiting = { holidayYears: ['2026', '2027'], noLeaveType: true, letterDrafts: 2, payrollUnconfirmed: true, whatsapp: 3, courierTests: 1, noAlertRecipients: true };
    world.waitingNow = waitingWith(setup);
    show();
    await waitFor(() => expect(screen.getByText(ct.todoHolidays('2026'))).toBeInTheDocument());
    const expected: [string, string][] = [
      [ct.todoHolidays('2026'), paths.adminSettingsSchedule],
      [ct.todoHolidays('2027'), paths.adminSettingsSchedule],
      [ct.todoLeaveTypes, paths.adminSettingsLeave],
      [ct.todoLetterDrafts(2), paths.adminSettingsLetters],
      [ct.todoPayrollSettings, paths.adminSettingsPayroll],
      [ct.todoWhatsApp(3), paths.adminSettingsWhatsApp],
      [ct.todoCourierTest(1), paths.adminSettingsDelivery],
      [ct.todoAlerts, paths.adminWebsiteConnections],
    ];
    expect(todos().map((a) => [a.textContent, a.getAttribute('href')])).toEqual(expected);
    // The menu and the list agree: a page has a count exactly when the list has a line for it.
    const counted = Object.keys(attentionFrom({ setup })).sort();
    expect([...new Set(expected.map(([, to]) => to))].sort()).toEqual(counted);
  });

  it('says all clear only once the Master control answer is in', async () => {
    world.waitingNow = waitingWith(null);
    const view = show();
    await waitFor(() => expect(read.deliveries).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Catalogue' })).toBeInTheDocument());
    expect(screen.queryByText(t.dashboardAllClear)).not.toBeInTheDocument();

    world.waitingNow = waitingWith({ holidayYears: [], noLeaveType: false, letterDrafts: 0, payrollUnconfirmed: false, whatsapp: null, courierTests: 0, noAlertRecipients: false });
    view.rerender(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText(t.dashboardAllClear)).toBeInTheDocument());
  });

  it('counts deliveries from the two numbers the menu uses, and opens the board on the bags coming back', async () => {
    world.waitingNow = waitingWith({});
    read.deliveries.mockResolvedValue({ requested: 2, returning: 1 });
    show();
    await waitFor(() => expect(screen.getByText(dt.todoReceive(1))).toBeInTheDocument());
    expect(read.deliveries).toHaveBeenCalledWith('u1', 'corp', 'cen');
    expect(screen.getByText(dt.todoDispatch(2)).closest('a')).toHaveAttribute('href', paths.opsDeliveries);
    expect(screen.getByText(dt.todoReceive(1)).closest('a')).toHaveAttribute('href', `${paths.opsDeliveries}?tab=RETURNING`);
    expect(read.branch).toHaveBeenCalledWith('u1', 'corp', 'cen', true, 'ALL');
  });
});
