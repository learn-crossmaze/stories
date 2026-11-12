import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider, useParams } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Member } from '../data/members';
import { paths } from '../paths';
import { t } from '../strings';
import { lt } from '../strings/library';

// The Members page and the way into a member: Enter (or a scanned card) opens the match, the list starts
// without asking the server anything first, and a new registration lands on the plan chooser.
type Sent = { action: string; requestId: string } & Record<string, unknown>;

const world = vi.hoisted(() => ({
  calls: [] as unknown[],
  respond: (() => ({})) as (data: never) => unknown,
  members: [] as unknown[],
  /** Searches wait for this: a test holds it to act while a lookup is on its way. */
  gate: Promise.resolve(),
  searches: [] as string[],
}));
const calls = world.calls as Sent[];

vi.mock('firebase/functions', () => ({
  httpsCallable: () => async (data: Sent) => {
    world.calls.push(data);
    const answer = world.respond(data as never);
    if (answer instanceof Error) throw answer;
    return { data: answer };
  },
}));
vi.mock('../data/services', () => ({ services: () => ({ fns: {}, db: {} }) }));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ claims: { v: 1, sa: true, o: {} }, user: { uid: 'me' } }) }));
vi.mock('../admin/Workspace', () => ({
  useWorkspace: () => ({ org: { id: 'o1', name: 'Stories' }, branch: { id: 'b1', name: 'Central' }, branches: [{ id: 'b1', name: 'Central', contact: { phone: '' } }], branchesLoading: false, branchName: () => 'Central' }),
}));
vi.mock('../data/members', async (importOriginal) => {
  const real = await importOriginal<typeof import('../data/members')>();
  return {
    ...real,
    listMembers: async () => ({ items: world.members }),
    memberCounts: async () => ({ ALL: world.members.length, ACTIVE: 0, DUE: 0, EXPIRED: 0, NONE: world.members.length }),
    searchMembers: async (_org: string, _branch: string, q: string) => {
      world.searches.push(q);
      await world.gate;
      return real.narrowMembers(world.members as Member[], q);
    },
    getMember: async (_org: string, id: string) => (world.members as Member[]).find((m) => m.id === id) ?? null,
    wardsOf: async () => [],
  };
});
vi.mock('../data/billing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../data/billing')>()),
  memberSubscriptions: async () => [],
  listPlans: async () => [],
  depositAccount: async () => null,
  ledger: async () => [],
  memberAdjustments: async () => [],
}));
vi.mock('../data/circulation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../data/circulation')>()),
  memberLoans: async () => [],
  memberReservations: async () => [],
}));

const { MembersPage } = await import('../admin/members/Members');
const { MemberDetailPage } = await import('../admin/members/MemberDetail');

const words = (...fields: string[]) => fields.flatMap((f) => f.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)).flatMap((w) => Array.from({ length: w.length - 1 }, (_, n) => w.slice(0, n + 2)));
const member = (id: string, fullName: string, code: string): Member => ({
  id, code, fullName, dob: '1990-05-01', audience: 'ADULTS', isMinor: false, phone: null, email: null, address: null, homeBranchId: 'b1', status: 'ACTIVE',
  guardian: null, activeSubscriptionId: null, nextSubscriptionId: null, subscriptionEndsAt: null, activeLoanCount: 0, allocatedCount: 0, waitingCount: 0,
  lifetimeLoans: 0, lifetimeExchanges: 0, searchTokens: words(fullName, code),
});

function Opened() {
  return <h1>Opened {useParams().memberId}</h1>;
}
function open(memberPage = <Opened />) {
  const router = createMemoryRouter(
    [
      { path: paths.adminMembers, element: <MembersPage /> },
      { path: paths.adminMember(':memberId'), element: memberPage },
    ],
    { initialEntries: [paths.adminMembers] },
  );
  render(<RouterProvider router={router} />);
  return router;
}
/** A card scanner: the code, then Enter, with no pause. */
function scan(box: HTMLElement, code: string) {
  fireEvent.change(box, { target: { value: code } });
  fireEvent.keyDown(box, { key: 'Enter' });
}

beforeEach(() => {
  calls.length = 0;
  world.respond = () => ({});
  world.members = [member('m1', 'Priya Sharma', 'CEN-M000012'), member('m2', 'Anil Sharma', 'CEN-M000123'), member('m3', 'Zoya Khan', 'CEN-M0001234')];
  world.gate = Promise.resolve();
  world.searches.length = 0;
});

describe('Members page', () => {
  it('lists the members straight away, with nothing asked of the server first', async () => {
    open();
    expect(await screen.findByRole('link', { name: 'Priya Sharma' })).toBeInTheDocument();
    expect(calls).toEqual([]);
  });

  it('a scanned card opens its member, also when other codes start the same way', async () => {
    open();
    scan(await screen.findByRole('searchbox', { name: lt.searchMembers }), 'cen-m000123');
    expect(await screen.findByRole('heading', { name: 'Opened m2' })).toBeInTheDocument();
  });

  it('Enter opens the only match, and leaves the list when there are several', async () => {
    const router = open();
    const box = await screen.findByRole('searchbox', { name: lt.searchMembers });
    scan(box, 'sharma');
    await waitFor(() => expect(world.searches).toContain('sharma'));
    await new Promise((r) => setTimeout(r, 50));
    expect(router.state.location.pathname).toBe(paths.adminMembers);
    scan(box, 'priya sharma');
    expect(await screen.findByRole('heading', { name: 'Opened m1' })).toBeInTheDocument();
  });

  it('does not open a member when the box changed while the lookup was on its way', async () => {
    const router = open();
    const box = await screen.findByRole('searchbox', { name: lt.searchMembers });
    let release = () => {};
    world.gate = new Promise<void>((r) => (release = r));
    scan(box, 'zoya');
    fireEvent.keyDown(box, { key: 'Enter' }); // a second Enter does not look again
    fireEvent.change(box, { target: { value: '' } });
    release();
    await new Promise((r) => setTimeout(r, 50));
    expect(world.searches.filter((q) => q === 'zoya')).toHaveLength(1);
    expect(router.state.location.pathname).toBe(paths.adminMembers);
  });
});

describe('after registering a member', () => {
  it('opens the new member on the plan chooser, once', async () => {
    const user = userEvent.setup();
    const router = open(<MemberDetailPage />);
    await user.click(await screen.findByRole('button', { name: lt.registerMember }));
    const form = screen.getByRole('dialog', { name: lt.registerMember });
    await user.type(within(form).getByLabelText(lt.fullName), 'Meera Rao');
    fireEvent.change(within(form).getByLabelText(lt.dob), { target: { value: '1990-05-01' } });
    await user.type(within(form).getByLabelText(lt.mobile), '9876543210');
    world.respond = () => {
      world.members = [...world.members, member('m9', 'Meera Rao', 'CEN-M000999')];
      return { memberId: 'm9', code: 'CEN-M000999' };
    };
    await user.click(within(form).getByRole('button', { name: lt.registerMember }));

    const chooser = await screen.findByRole('dialog', { name: lt.subscribe });
    expect(screen.getByRole('heading', { name: 'Meera Rao' })).toBeInTheDocument();
    expect(calls.map((c) => c.action)).toEqual(['members-register']);
    // Forgotten in the history, so Reload, Back and Forward do not open it again.
    await waitFor(() => expect(router.state.location.state).toBeNull());
    expect(router.state.location.pathname).toBe(paths.adminMember('m9'));

    await user.click(await within(chooser).findByRole('button', { name: t.cancel }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: lt.subscribe })).toBeEnabled();
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opening a member any other way does not open the chooser', async () => {
    const router = open(<MemberDetailPage />);
    await screen.findByRole('link', { name: 'Priya Sharma' });
    await router.navigate(paths.adminMember('m1'));
    expect(await screen.findByRole('button', { name: lt.subscribe })).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
