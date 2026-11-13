import { act, renderHook } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { StoriesClaims } from '../auth/claims';
import type { Branch } from '../data/org';
import { paths } from '../paths';

// The menu's waiting counts as the shell loads them: when it asks, what it asks for, and what it never loses.
const world = vi.hoisted(() => ({
  claims: { v: 1, sa: false, o: {} } as StoriesClaims,
  user: { uid: 'u1' } as { uid: string } | null,
  org: { id: 'corp' } as { id: string } | null,
  branch: null as Branch | null,
  orgsLoading: false,
  branchesLoading: false,
  pathname: '/admin',
  missing: 0,
}));
const read = vi.hoisted(() => ({
  waitingCounts: vi.fn(),
  unshelvedCount: vi.fn(),
  deliveryCounts: vi.fn(),
  renewalsDueCount: vi.fn(),
  documentQueueCounts: vi.fn(),
  pendingCorrections: vi.fn(),
  monthLock: vi.fn(),
  pendingLeave: vi.fn(),
  submittedRuns: vi.fn(),
  siteOverview: vi.fn(),
  hasHolidays: vi.fn(),
  listLeaveTypes: vi.fn(),
  draftTemplateCount: vi.fn(),
  payrollOnBuiltInValues: vi.fn(),
  loadOverview: vi.fn(),
}));

vi.mock('../data/services', () => ({ services: () => ({ db: {}, fns: {} }) }));
vi.mock('firebase/functions', () => ({ httpsCallable: () => async () => ({ data: {} }) }));
vi.mock('react-router', async (importOriginal) => ({ ...(await importOriginal<typeof import('react-router')>()), useLocation: () => ({ pathname: world.pathname }) }));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ claims: world.claims, user: world.user }) }));
vi.mock('../admin/Workspace', () => ({
  useWorkspace: () => ({ org: world.org, branch: world.branch, orgsLoading: world.orgsLoading, branchesLoading: world.branchesLoading }),
}));
vi.mock('../admin/people/OnboardingReminder', () => ({
  useMyOnboarding: () => ({ data: world.missing ? { missing: Array.from({ length: world.missing }) } : null }),
}));
const over = <M extends object>(importOriginal: () => Promise<M>, part: Record<string, unknown>) => importOriginal().then((m) => ({ ...m, ...part }));
vi.mock('../data/circulation', (orig) => over(orig, { waitingCounts: read.waitingCounts }));
vi.mock('../data/inventory', (orig) => over(orig, { unshelvedCount: read.unshelvedCount }));
vi.mock('../data/delivery', (orig) => over(orig, { deliveryCounts: read.deliveryCounts }));
vi.mock('../data/members', (orig) => over(orig, { renewalsDueCount: read.renewalsDueCount }));
vi.mock('../data/hrDocuments', (orig) => over(orig, { documentQueueCounts: read.documentQueueCounts }));
vi.mock('../data/attendance', (orig) => over(orig, { pendingCorrections: read.pendingCorrections, monthLock: read.monthLock }));
vi.mock('../data/leave', (orig) => over(orig, { pendingLeave: read.pendingLeave, listLeaveTypes: read.listLeaveTypes }));
vi.mock('../data/payroll', (orig) => over(orig, { submittedRuns: read.submittedRuns }));
vi.mock('../data/setupCounts', () => ({ hasHolidays: read.hasHolidays, draftTemplateCount: read.draftTemplateCount, payrollOnBuiltInValues: read.payrollOnBuiltInValues }));
vi.mock('../data/whatsapp', (orig) => over(orig, { loadOverview: read.loadOverview }));
vi.mock('../data/site', (orig) => over(orig, { siteOverview: read.siteOverview }));

const { HIDDEN_MS, REFRESH_MS, SETUP_MS, TICK_MS, useAttention } = await import('../admin/attention');
const { forget } = await import('../data/shared');
const { invalidateSiteOverview } = await import('../data/site');

const OWNER: StoriesClaims = { v: 1, sa: false, o: { corp: { r: ['OWN'], b: ['*'] } } };
const LIBRARIAN: StoriesClaims = { v: 1, sa: false, o: { corp: { r: ['LIB'], b: ['cen'] } } };
const HR: StoriesClaims = { v: 1, sa: false, o: { corp: { r: ['HR'], b: ['*'] } } };
const branch = (id: string, more: Partial<Branch> = {}) => ({ id, code: id, name: id, status: 'ACTIVE', ...more }) as Branch;
const overview = (alertRecipients: number | null = 2, publishable = 0) => ({
  rights: { manager: true },
  counts: { newSubmissions: 0, callsThisWeek: 0, openJobs: 0, alertRecipients },
  pending: Array.from({ length: publishable }, () => ({ canPublish: true })),
  reviews: [],
});
const template = (key: string, status: string, enabled: boolean) => ({ key, added: true, template: { status, enabled } });

const show = (visibility: 'visible' | 'hidden') => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
  document.dispatchEvent(new Event('visibilitychange'));
};
/** Lets the reads under way answer. */
const settle = () => act(async () => undefined);
const pass = (ms: number) => act(async () => vi.advanceTimersByTime(ms));
/** A read answered by hand. */
function pending<T>() {
  let resolve: (v: T) => void = () => undefined;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}
const everyday = () => [read.waitingCounts, read.unshelvedCount, read.deliveryCounts, read.renewalsDueCount, read.documentQueueCounts, read.pendingCorrections, read.monthLock, read.pendingLeave, read.submittedRuns, read.siteOverview];
const setupReads = () => [read.hasHolidays, read.listLeaveTypes, read.draftTemplateCount, read.payrollOnBuiltInValues];
const mount = () => renderHook(() => useAttention());
/** Moves to another page (the shell renders again with the new address). */
const go = (view: ReturnType<typeof mount>, pathname: string) => {
  world.pathname = pathname;
  view.rerender();
};

beforeEach(() => {
  // A day outside December, so one year's holidays are asked for.
  vi.useFakeTimers({ now: new Date('2026-06-15T06:00:00Z') });
  forget();
  Object.assign(world, { claims: OWNER, user: { uid: 'u1' }, org: { id: 'corp' }, branch: branch('cen'), orgsLoading: false, branchesLoading: false, pathname: '/admin', missing: 0 });
  for (const f of Object.values(read)) f.mockReset();
  read.waitingCounts.mockResolvedValue({ inspection: 2, incoming: 1, approvals: 0 });
  read.unshelvedCount.mockResolvedValue(4);
  read.deliveryCounts.mockResolvedValue({ requested: 1, returning: 2 });
  read.renewalsDueCount.mockResolvedValue(5);
  read.documentQueueCounts.mockResolvedValue({ pending: 1, expired: 0 });
  read.pendingCorrections.mockResolvedValue([{ employeeUid: 'u1' }, { employeeUid: 'u2' }]);
  read.monthLock.mockResolvedValue({ status: 'FINALIZED' });
  read.pendingLeave.mockResolvedValue([]);
  read.submittedRuns.mockResolvedValue([]);
  read.siteOverview.mockResolvedValue(overview());
  read.hasHolidays.mockResolvedValue(true);
  read.listLeaveTypes.mockResolvedValue([{ status: 'ACTIVE' }]);
  read.draftTemplateCount.mockResolvedValue(0);
  read.payrollOnBuiltInValues.mockResolvedValue(false);
  read.loadOverview.mockResolvedValue({ settings: { enabled: true }, events: [] });
  show('visible');
});
afterEach(() => {
  vi.useRealTimers();
});

describe('the everyday counts', () => {
  it('waits for the branches, then asks once: one run at the start, not two', async () => {
    Object.assign(world, { branch: null, branchesLoading: true });
    const view = mount();
    await settle();
    for (const f of [...everyday(), ...setupReads()]) expect(f).not.toHaveBeenCalled();
    expect(view.result.current).toMatchObject({ counts: {}, total: 0, setup: null });

    Object.assign(world, { branch: branch('cen'), branchesLoading: false });
    view.rerender();
    await settle();
    for (const f of everyday()) expect(f).toHaveBeenCalledTimes(1);
    expect(view.result.current.counts).toMatchObject({
      [paths.adminDesk]: 2,
      [paths.adminTransfers]: 1,
      [paths.adminShelve]: 4,
      [paths.opsDeliveries]: 3,
      [paths.adminMembers]: 5,
      [paths.adminDocuments]: 1,
      // One's own correction request is not one's own to decide.
      [paths.adminAttendance]: 1,
    });
    expect(view.result.current.total).toBe(17);
  });

  it('still asks once when React runs every effect twice (development)', async () => {
    const view = renderHook(() => useAttention(), { wrapper: StrictMode });
    await settle();
    for (const f of [...everyday(), ...setupReads()]) expect(f).toHaveBeenCalledTimes(1);
    expect(view.result.current.counts[paths.adminMembers]).toBe(5);
    expect(view.result.current.setup).not.toBeNull();
  });

  it('asks only for what the menu shows, with the person and the place in each question', async () => {
    mount();
    await settle();
    expect(read.waitingCounts).toHaveBeenCalledWith('corp', 'cen', true, 'ALL');
    expect(read.renewalsDueCount).toHaveBeenCalledWith('corp', 'cen');
    expect(read.deliveryCounts).toHaveBeenCalledWith('corp', 'cen');
    expect(read.documentQueueCounts).toHaveBeenCalledWith('corp', 'ALL');
    // The Website overview is the read shared with the Publish button (one per person).
    expect(read.siteOverview).toHaveBeenCalledWith('u1');
  });

  it('asks nobody for a count their menu doesn’t show', async () => {
    world.claims = LIBRARIAN;
    const view = mount();
    await settle();
    expect(read.waitingCounts).toHaveBeenCalledWith('corp', 'cen', false, ['cen']);
    expect(read.renewalsDueCount).toHaveBeenCalledTimes(1);
    // A librarian only writes blog posts: every Website count would be zero, so it isn't asked.
    expect(read.deliveryCounts).toHaveBeenCalledTimes(1);
    for (const f of [read.siteOverview, read.documentQueueCounts, read.pendingCorrections, read.monthLock, read.pendingLeave, read.submittedRuns, ...setupReads(), read.loadOverview]) {
      expect(f).not.toHaveBeenCalled();
    }
    expect(view.result.current.counts[paths.adminDesk]).toBe(2);
  });

  it('keeps the answer of a run under way when the person moves to another page', async () => {
    const slow = pending<{ inspection: number; incoming: number; approvals: number }>();
    read.waitingCounts.mockReturnValue(slow.promise);
    const view = mount();
    // A quick first click, before the counts have arrived.
    go(view, paths.adminMembers);
    go(view, paths.adminDesk);
    await act(async () => slow.resolve({ inspection: 7, incoming: 0, approvals: 0 }));
    expect(view.result.current.counts[paths.adminDesk]).toBe(7);
    expect(read.waitingCounts).toHaveBeenCalledTimes(1);
  });

  it('shows each count as its own read answers, without waiting for a slow one', async () => {
    const slow = pending<ReturnType<typeof overview>>();
    read.siteOverview.mockReturnValue(slow.promise);
    const view = mount();
    await settle();
    expect(view.result.current.counts[paths.adminShelve]).toBe(4);
    expect(view.result.current.counts[paths.adminWebsite]).toBeUndefined();
    await act(async () => slow.resolve(overview(2, 3)));
    expect(view.result.current.counts[paths.adminWebsite]).toBe(3);
  });

  it('a count that can’t load just doesn’t show; the others do', async () => {
    read.unshelvedCount.mockRejectedValue(new Error('offline'));
    read.monthLock.mockRejectedValue(new Error('offline'));
    const view = mount();
    await settle();
    expect(view.result.current.counts[paths.adminShelve]).toBeUndefined();
    expect(view.result.current.counts[paths.adminDesk]).toBe(2);
    // A lock that couldn't be read is not taken for "not finalized".
    expect(view.result.current.counts[paths.adminAttendance]).toBe(1);
  });

  it('counts a month that was never finalized', async () => {
    read.monthLock.mockResolvedValue(null);
    const view = mount();
    await settle();
    expect(view.result.current.counts[paths.adminAttendance]).toBe(2);
  });

  it('counts again on moving between pages, at most every 30 seconds', async () => {
    const view = mount();
    await settle();
    await pass(REFRESH_MS - 1_000);
    go(view, paths.adminMembers);
    await settle();
    expect(read.unshelvedCount).toHaveBeenCalledTimes(1);
    await pass(2_000);
    go(view, paths.adminDesk);
    await settle();
    expect(read.unshelvedCount).toHaveBeenCalledTimes(2);
  });

  it('counts every 2 minutes while the tab is in view', async () => {
    mount();
    await settle();
    await pass(TICK_MS);
    expect(read.unshelvedCount).toHaveBeenCalledTimes(2);
    await pass(TICK_MS);
    expect(read.unshelvedCount).toHaveBeenCalledTimes(3);
  });

  it('slows to every 10 minutes while the tab is out of view, and never stops (the total is in the tab’s title)', async () => {
    mount();
    await settle();
    act(() => show('hidden'));
    await pass(HIDDEN_MS - TICK_MS);
    expect(read.unshelvedCount).toHaveBeenCalledTimes(1);
    await pass(TICK_MS);
    expect(read.unshelvedCount).toHaveBeenCalledTimes(2);
    await pass(HIDDEN_MS);
    expect(read.unshelvedCount).toHaveBeenCalledTimes(3);
  });

  it('counts straight away when the tab comes back into view, unless it counted within 30 seconds', async () => {
    mount();
    await settle();
    act(() => show('hidden'));
    await pass(REFRESH_MS - 5_000);
    act(() => show('visible'));
    await settle();
    expect(read.unshelvedCount).toHaveBeenCalledTimes(1);
    act(() => show('hidden'));
    await pass(10_000);
    act(() => show('visible'));
    await settle();
    expect(read.unshelvedCount).toHaveBeenCalledTimes(2);
  });

  it('forgets the old counts on a new branch and never shows a late answer for the old one', async () => {
    const old = pending<number>();
    read.unshelvedCount.mockImplementation((_o: string, b: string) => (b === 'cen' ? old.promise : Promise.resolve(9)));
    const view = mount();
    await settle();
    expect(view.result.current.counts[paths.adminDesk]).toBe(2);
    read.waitingCounts.mockResolvedValue({ inspection: 0, incoming: 0, approvals: 0 });
    world.branch = branch('nth');
    view.rerender();
    // At once, before anything has answered for the new branch: nothing of the old one is left.
    expect(view.result.current.counts[paths.adminDesk]).toBeUndefined();
    await settle();
    expect(read.unshelvedCount).toHaveBeenLastCalledWith('corp', 'nth');
    expect(view.result.current.counts[paths.adminShelve]).toBe(9);
    await act(async () => old.resolve(40));
    expect(view.result.current.counts[paths.adminShelve]).toBe(9);
  });

  it('shows the self-onboarding count from the shell’s shared status, with no read of its own', async () => {
    world.missing = 3;
    const view = mount();
    expect(view.result.current.counts[paths.adminMyOnboarding]).toBe(3);
    // Saved: the count changes with the banner, in the same render.
    world.missing = 1;
    view.rerender();
    expect(view.result.current.counts[paths.adminMyOnboarding]).toBe(1);
  });

  it('reads only the Website counts again when something there is saved or published', async () => {
    read.siteOverview.mockResolvedValue(overview(2, 3));
    const view = mount();
    await settle();
    expect(view.result.current.counts[paths.adminWebsite]).toBe(3);
    read.siteOverview.mockResolvedValue(overview(2, 0));
    act(() => invalidateSiteOverview());
    await settle();
    expect(read.siteOverview).toHaveBeenCalledTimes(2);
    expect(read.unshelvedCount).toHaveBeenCalledTimes(1);
    expect(view.result.current.counts[paths.adminWebsite]).toBeUndefined();
    expect(view.result.current.counts[paths.adminShelve]).toBe(4);
  });

  it('an overview read before a change there never replaces the one read after it', async () => {
    const before = pending<ReturnType<typeof overview>>();
    read.siteOverview.mockReturnValueOnce(before.promise).mockResolvedValue(overview(2, 0));
    const view = mount();
    act(() => invalidateSiteOverview());
    await settle();
    await act(async () => before.resolve(overview(2, 5)));
    expect(view.result.current.counts[paths.adminWebsite]).toBeUndefined();
  });
});

describe('the Master control counts', () => {
  const wrong = () => {
    read.hasHolidays.mockResolvedValue(false);
    read.listLeaveTypes.mockResolvedValue([{ status: 'ARCHIVED' }]);
    read.draftTemplateCount.mockResolvedValue(3);
    read.payrollOnBuiltInValues.mockResolvedValue(true);
    read.loadOverview.mockResolvedValue({ settings: { enabled: true }, events: [template('a', 'REJECTED', false), template('b', 'NOT_SUBMITTED', true), template('c', 'APPROVED', true)] });
    read.siteOverview.mockResolvedValue(overview(0));
    world.branch = branch('cen', {
      whatsapp: { phoneNumberId: '123', enabled: true },
      delivery: { enabled: true, couriers: { PORTER: { enabled: true, environment: 'TEST', hasKey: true } } },
    } as unknown as Partial<Branch>);
  };

  it('show beside each page what is missing or broken there, and add into the total', async () => {
    wrong();
    const view = mount();
    await settle();
    expect(read.hasHolidays.mock.calls).toEqual([['corp', '2026']]);
    expect(read.loadOverview).toHaveBeenCalledWith('corp', 'cen');
    expect(view.result.current.counts).toMatchObject({
      [paths.adminSettingsSchedule]: 1,
      [paths.adminSettingsLeave]: 1,
      [paths.adminSettingsLetters]: 3,
      [paths.adminSettingsPayroll]: 1,
      [paths.adminSettingsWhatsApp]: 2,
      [paths.adminSettingsDelivery]: 1,
      [paths.adminWebsiteConnections]: 1,
    });
    // The same answer goes to the Dashboard's list.
    expect(view.result.current.setup).toMatchObject({ holidayYears: ['2026'], noLeaveType: true, letterDrafts: 3, payrollUnconfirmed: true, whatsapp: 2, courierTests: 1, noAlertRecipients: true });
    expect(view.result.current.total).toBe(Object.values(view.result.current.counts).reduce((a, n) => a + n, 0));
  });

  it('show nothing when all is in order', async () => {
    const view = mount();
    await settle();
    for (const to of [paths.adminSettingsSchedule, paths.adminSettingsLeave, paths.adminSettingsLetters, paths.adminSettingsPayroll, paths.adminSettingsWhatsApp, paths.adminSettingsDelivery, paths.adminWebsiteConnections]) {
      expect(view.result.current.counts[to]).toBeUndefined();
    }
    expect(view.result.current.setup).not.toBeNull();
  });

  it('ask for next year’s holidays too from December (India’s date)', async () => {
    // 19:00 UTC on 30 November is already 1 December in India.
    vi.setSystemTime(new Date('2026-11-30T19:00:00Z'));
    read.hasHolidays.mockImplementation(async (_o: string, year: string) => year === '2026');
    const view = mount();
    await settle();
    expect(read.hasHolidays.mock.calls).toEqual([['corp', '2026'], ['corp', '2027']]);
    expect(view.result.current.counts[paths.adminSettingsSchedule]).toBe(1);
    expect(view.result.current.setup?.holidayYears).toEqual(['2027']);
  });

  it('are asked only of people who see the page', async () => {
    wrong();
    world.claims = HR;
    const view = mount();
    await settle();
    for (const f of setupReads()) expect(f).toHaveBeenCalled();
    // HR runs neither WhatsApp nor delivery nor the website.
    expect(read.loadOverview).not.toHaveBeenCalled();
    expect(read.siteOverview).not.toHaveBeenCalled();
    expect(view.result.current.counts[paths.adminSettingsLetters]).toBe(3);
    for (const to of [paths.adminSettingsWhatsApp, paths.adminSettingsDelivery, paths.adminWebsiteConnections]) expect(view.result.current.counts[to]).toBeUndefined();
  });

  it('ask about WhatsApp only when the branch is connected', async () => {
    wrong();
    world.branch = branch('cen');
    const view = mount();
    await settle();
    expect(read.loadOverview).not.toHaveBeenCalled();
    expect(view.result.current.counts[paths.adminSettingsWhatsApp]).toBeUndefined();
  });

  it('count a notification never sent to Meta only while WhatsApp is switched on at the branch', async () => {
    wrong();
    read.loadOverview.mockResolvedValue({ settings: { enabled: false }, events: [template('a', 'REJECTED', false), template('b', 'NOT_SUBMITTED', true)] });
    const view = mount();
    await settle();
    expect(view.result.current.counts[paths.adminSettingsWhatsApp]).toBe(1);
  });

  it('one that fails shows no count; the rest do', async () => {
    wrong();
    read.payrollOnBuiltInValues.mockRejectedValue(new Error('permission-denied'));
    read.loadOverview.mockRejectedValue(new Error('offline'));
    const view = mount();
    await settle();
    expect(view.result.current.counts[paths.adminSettingsPayroll]).toBeUndefined();
    expect(view.result.current.counts[paths.adminSettingsWhatsApp]).toBeUndefined();
    expect(view.result.current.counts[paths.adminSettingsLetters]).toBe(3);
    expect(view.result.current.setup).toMatchObject({ payrollUnconfirmed: null, whatsapp: null, letterDrafts: 3 });
  });

  it('are not part of the 30-second and 2-minute cycle', async () => {
    const view = mount();
    await settle();
    await pass(REFRESH_MS + 1_000);
    go(view, paths.adminMembers);
    await settle();
    await pass(TICK_MS);
    await pass(TICK_MS);
    expect(read.unshelvedCount.mock.calls.length).toBeGreaterThanOrEqual(3);
    for (const f of [...setupReads(), read.loadOverview]) expect(f.mock.calls.length).toBeLessThanOrEqual(1);
    expect(read.draftTemplateCount).toHaveBeenCalledTimes(1);
  });

  it('are read again at most every 10 minutes', async () => {
    mount();
    await settle();
    await pass(SETUP_MS - TICK_MS);
    expect(read.draftTemplateCount).toHaveBeenCalledTimes(1);
    await pass(TICK_MS);
    expect(read.draftTemplateCount).toHaveBeenCalledTimes(2);
  });

  it('are read again on leaving a Master control page, so a fix shows at once', async () => {
    wrong();
    const view = mount();
    await settle();
    go(view, paths.adminSettingsLetters);
    await settle();
    // Arriving there, and moving about inside the page, asks nothing.
    go(view, `${paths.adminSettingsLetters}/t1`);
    await settle();
    expect(read.draftTemplateCount).toHaveBeenCalledTimes(1);
    expect(view.result.current.counts[paths.adminSettingsLetters]).toBe(3);

    read.draftTemplateCount.mockResolvedValue(0);
    go(view, '/admin');
    await settle();
    expect(read.draftTemplateCount).toHaveBeenCalledTimes(2);
    expect(view.result.current.counts[paths.adminSettingsLetters]).toBeUndefined();
    // Moving on between other pages asks nothing more.
    go(view, paths.adminMembers);
    await settle();
    expect(read.draftTemplateCount).toHaveBeenCalledTimes(2);
  });

  it('are read again on going from one Master control page to another', async () => {
    const view = mount();
    await settle();
    go(view, paths.adminSettingsLeave);
    await settle();
    go(view, paths.adminSettingsSchedule);
    await settle();
    expect(read.listLeaveTypes).toHaveBeenCalledTimes(2);
  });

  it('ask the Website overview afresh on leaving Connections (the alerts list is saved there)', async () => {
    read.siteOverview.mockResolvedValue(overview(0));
    const view = mount();
    await settle();
    expect(view.result.current.counts[paths.adminWebsiteConnections]).toBe(1);
    go(view, paths.adminWebsiteConnections);
    await settle();
    read.siteOverview.mockResolvedValue(overview(1));
    go(view, '/admin');
    await settle();
    expect(view.result.current.counts[paths.adminWebsiteConnections]).toBeUndefined();
  });

  it('are read again for a new branch, and the courier check follows the branch at once with no read', async () => {
    wrong();
    const view = mount();
    await settle();
    expect(view.result.current.counts[paths.adminSettingsDelivery]).toBe(1);
    world.branch = branch('nth', { whatsapp: { phoneNumberId: '456', enabled: true } } as unknown as Partial<Branch>);
    view.rerender();
    expect(view.result.current.counts[paths.adminSettingsDelivery]).toBeUndefined();
    expect(view.result.current.setup).toBeNull();
    await settle();
    expect(read.loadOverview).toHaveBeenLastCalledWith('corp', 'nth');
    expect(read.draftTemplateCount).toHaveBeenCalledTimes(2);
    // The courier went live and the settings page reloaded the branches: the count goes without waiting for a cycle.
    world.branch = branch('nth', { delivery: { enabled: true, couriers: { PORTER: { enabled: true, environment: 'TEST', hasKey: true } } } } as unknown as Partial<Branch>);
    view.rerender();
    expect(view.result.current.counts[paths.adminSettingsDelivery]).toBe(1);
    world.branch = branch('nth', { delivery: { enabled: true, couriers: { PORTER: { enabled: true, environment: 'LIVE', hasKey: true } } } } as unknown as Partial<Branch>);
    view.rerender();
    expect(view.result.current.counts[paths.adminSettingsDelivery]).toBeUndefined();
  });
});
