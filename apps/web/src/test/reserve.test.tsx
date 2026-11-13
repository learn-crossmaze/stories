import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FirebaseError } from 'firebase/app';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Book } from '../data/catalogue';
import type { Reservation } from '../data/circulation';
import type { Member } from '../data/members';
import { paths } from '../paths';
import { t } from '../strings';
import { lt } from '../strings/library';

// Reserving a title: the dialog itself (it stays open, says what the shelf holds, finds the member when none is
// given), and the ways into it from the book page and the Reservations page. The server is faked at the Cloud
// Functions boundary and the reads in the data layer.
type Sent = { action: string; requestId?: string } & Record<string, unknown>;

const world = vi.hoisted(() => ({
  calls: [] as unknown[],
  respond: (() => ({})) as (data: never) => unknown,
  claims: { v: 1, sa: true, o: {} } as unknown,
  branch: { id: 'b1', name: 'Central' } as { id: string; name: string } | null,
  book: null as unknown,
  held: [] as unknown[],
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
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ claims: world.claims }) }));
vi.mock('../admin/Workspace', () => ({
  useWorkspace: () => ({ org: { id: 'o1', type: 'CORPORATE' }, branch: world.branch, branches: [], orgsLoading: false, branchesLoading: false }),
}));
vi.mock('../data/catalogue', async (importOriginal) => {
  const titles = [
    { id: 'bk1', title: 'Treasure Island', authorNames: ['R. L. Stevenson'], status: 'ACTIVE', coverUrl: null },
    { id: 'bk2', title: 'Kidnapped', authorNames: ['R. L. Stevenson'], status: 'ACTIVE', coverUrl: null },
  ];
  const find = (q: string) => titles.filter((b) => b.title.toLowerCase().includes(q.trim().toLowerCase()));
  return {
    ...(await importOriginal<typeof import('../data/catalogue')>()),
    searchBooks: async (q: string) => ({ items: find(q) }),
    findBooks: async (q: string) => find(q),
    getBook: async () => world.book,
  };
});
vi.mock('../data/members', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../data/members')>()),
  searchMembers: async () => [{ id: 'm1', code: 'MEM-0001', fullName: 'Asha Rao', phone: null, isMinor: false, status: 'ACTIVE', homeBranchId: 'b1' } as Member],
}));
vi.mock('../data/inventory', async (importOriginal) => ({ ...(await importOriginal<typeof import('../data/inventory')>()), copiesOfBook: async () => [], listLocations: async () => [] }));
vi.mock('../data/circulation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../data/circulation')>()),
  branchReservations: async (_org: string, _branch: string, status: string) => (status === 'ALLOCATED' ? world.held : []),
}));

const { ReserveDialog } = await import('../admin/members/memberDialogs');
const { BookDetailPage } = await import('../admin/catalogue/BookDetail');
const { ReservationsPage } = await import('../admin/circulation/Reservations');

const stock = (here: number, north = 0) => ({
  branches: [
    { branchId: 'b1', branchName: 'Central', available: here, total: 3 },
    { branchId: 'b2', branchName: 'North', available: north, total: 2 },
  ],
});
const placed = () => calls.filter((c) => c.action === 'reservations-place');
/** A person holding only these permissions, at these branches. */
async function signInWith(permissions: string[], branches = ['b1']) {
  const { PERMISSIONS } = await import('../generated/rbac');
  const bits = new Uint8Array(Math.ceil(PERMISSIONS.length / 8));
  for (const p of permissions) {
    const at = (PERMISSIONS as readonly string[]).indexOf(p);
    if (at < 0) throw new Error(`unknown permission ${p}`);
    bits[at >> 3] |= 1 << (at & 7);
  }
  world.claims = { v: 1, o: { o1: { r: [], b: branches, p: btoa(String.fromCharCode(...bits)) } } };
}
const page = (path: string, element: React.ReactNode, at: string) =>
  render(<RouterProvider router={createMemoryRouter([{ path, element }, { path: '*', element: <p>elsewhere</p> }], { initialEntries: [at] })} />);

beforeEach(() => {
  calls.length = 0;
  world.respond = () => ({});
  world.claims = { v: 1, sa: true, o: {} };
  world.branch = { id: 'b1', name: 'Central' };
  world.book = { id: 'bk1', code: 'BOOK-000001', title: 'Treasure Island', subtitle: '', authorNames: ['R. L. Stevenson'], genres: [], categoryNames: [], language: 'en', ageGroup: 'ADULTS', readingLevel: 'INTERMEDIATE', status: 'ACTIVE' } as unknown as Book;
  world.held = [];
});

describe('the reserve dialog', () => {
  it('says what the shelf holds before saving, stays open for the next title, and sends each as its own request', async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    const onClose = vi.fn();
    render(<ReserveDialog orgId="o1" branchId="b1" member={{ id: 'm1', fullName: 'Asha Rao' }} onClose={onClose} onDone={onDone} />);
    const dialog = screen.getByRole('dialog', { name: lt.reserveTitleFor('Asha Rao') });
    const save = within(dialog).getByRole('button', { name: lt.placeReservation });
    expect(save).toBeDisabled();
    expect(within(dialog).getByRole('searchbox')).toHaveFocus();

    world.respond = (data: Sent) => (data.action === 'copies-availability' ? stock(1) : { reservationId: 'r1', status: 'ALLOCATED', copyCode: 'CEN-000007' });
    await user.type(within(dialog).getByRole('searchbox'), 'treasure');
    await user.click(await within(dialog).findByRole('button', { name: /Treasure Island/ }));
    expect(await within(dialog).findByText(lt.reserveStockHere(1))).toBeInTheDocument();
    expect(calls.find((c) => c.action === 'copies-availability')).toMatchObject({ orgId: 'o1', bookId: 'bk1' });
    // The title is picked: Enter (or a click) on the button saves it.
    await waitFor(() => expect(save).toHaveFocus());
    await user.click(save);

    // Saved, and ready for the next title: the result is said, the search box is back with the keyboard in it.
    expect(await within(dialog).findByText(lt.reserveHeld('Treasure Island', 'CEN-000007'))).toBeInTheDocument();
    expect(onDone).toHaveBeenCalledWith(lt.reserveHeld('Treasure Island', 'CEN-000007'));
    expect(onClose).not.toHaveBeenCalled();
    await waitFor(() => expect(within(dialog).getByRole('searchbox')).toHaveFocus());
    expect(within(dialog).getByRole('button', { name: lt.finished })).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: t.cancel })).toBeNull();

    world.respond = (data: Sent) => (data.action === 'copies-availability' ? stock(0, 2) : { reservationId: 'r2', status: 'WAITING', copyCode: null });
    await user.type(within(dialog).getByRole('searchbox'), 'kidn');
    await user.click(await within(dialog).findByRole('button', { name: /Kidnapped/ }));
    expect(await within(dialog).findByText(`${lt.reserveStockNone} ${lt.reserveStockElsewhere('North (2)')}`)).toBeInTheDocument();
    await user.click(save);
    expect(await within(dialog).findByText(lt.reserveWaiting('Kidnapped'))).toBeInTheDocument();
    expect(within(dialog).getByText(lt.reserveHeld('Treasure Island', 'CEN-000007'))).toBeInTheDocument();

    expect(placed().map((c) => [c.orgId, c.memberId, c.bookId, c.branchId])).toEqual([['o1', 'm1', 'bk1', 'b1'], ['o1', 'm1', 'bk2', 'b1']]);
    expect(placed()[0].requestId).toBeTruthy();
    expect(placed()[0].requestId).not.toBe(placed()[1].requestId);
    expect(onDone).toHaveBeenCalledTimes(2);
    await user.click(within(dialog).getByRole('button', { name: lt.finished }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps the title and says why when the server refuses', async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    render(<ReserveDialog orgId="o1" branchId="b1" member={{ id: 'm1', fullName: 'Asha Rao' }} book={{ id: 'bk1', title: 'Treasure Island' }} onClose={() => undefined} onDone={onDone} />);
    const dialog = screen.getByRole('dialog');
    // Member and title both known: the keyboard starts on the button.
    expect(within(dialog).getByRole('button', { name: lt.placeReservation })).toHaveFocus();
    world.respond = (data: Sent) =>
      data.action === 'copies-availability'
        ? stock(0)
        : Object.assign(new FirebaseError('functions/failed-precondition', 'Asha Rao already has a reservation for this title.'), { details: { reason: 'ALREADY_RESERVED' } });
    await user.click(within(dialog).getByRole('button', { name: lt.placeReservation }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Asha Rao already has a reservation for this title.');
    expect(within(dialog).getByText('Treasure Island')).toBeInTheDocument();
    expect(onDone).not.toHaveBeenCalled();
    expect(within(dialog).getByRole('button', { name: t.cancel })).toBeInTheDocument();
  });
});

describe('reserving from a book’s page', () => {
  const open = () => page(paths.adminBook(':bookId'), <BookDetailPage />, paths.adminBook('bk1'));

  it('finds the member, then reserves this title for them at the branch being worked at', async () => {
    const user = userEvent.setup();
    world.respond = (data: Sent) => (data.action === 'copies-availability' ? stock(2) : data.action === 'reservations-place' ? { reservationId: 'r1', status: 'ALLOCATED', copyCode: 'CEN-000007' } : {});
    open();
    await user.click(await screen.findByRole('button', { name: lt.reserveForMember }));
    const dialog = await screen.findByRole('dialog', { name: lt.placeReservation });
    expect(within(dialog).getByText('Treasure Island')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: lt.placeReservation })).toBeDisabled();

    await user.type(within(dialog).getByLabelText(lt.reserveFor), 'asha');
    await user.click(await within(dialog).findByRole('button', { name: /Asha Rao/ }));
    expect(await screen.findByRole('dialog', { name: lt.reserveTitleFor('Asha Rao') })).toBeInTheDocument();
    const save = within(dialog).getByRole('button', { name: lt.placeReservation });
    await waitFor(() => expect(save).toHaveFocus());
    await user.click(save);
    await waitFor(() => expect(placed()).toHaveLength(1));
    expect(placed()[0]).toMatchObject({ orgId: 'o1', memberId: 'm1', bookId: 'bk1', branchId: 'b1' });
    await user.click(await within(dialog).findByRole('button', { name: lt.finished }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText(lt.reserveHeld('Treasure Island', 'CEN-000007'))).toBeInTheDocument();
  });

  it('is offered only with a branch chosen, for a title in the catalogue, to someone who may reserve and see members there', async () => {
    const shown = async () => {
      const view = open();
      await screen.findByRole('heading', { name: 'Treasure Island' });
      await screen.findByRole('heading', { name: lt.availability });
      const there = !!screen.queryByRole('button', { name: lt.reserveForMember });
      view.unmount();
      return there;
    };
    expect(await shown()).toBe(true);
    await signInWith(['books.view', 'reservations.manage', 'members.view']);
    expect(await shown()).toBe(true);
    await signInWith(['books.view', 'reservations.manage']);
    expect(await shown()).toBe(false);
    await signInWith(['books.view', 'members.view']);
    expect(await shown()).toBe(false);
    await signInWith(['books.view', 'reservations.manage', 'members.view'], ['b2']);
    expect(await shown()).toBe(false);

    world.claims = { v: 1, sa: true, o: {} };
    world.branch = null;
    expect(await shown()).toBe(false);
    world.branch = { id: 'b1', name: 'Central' };
    world.book = { ...(world.book as Book), status: 'ARCHIVED' };
    expect(await shown()).toBe(false);
  });
});

describe('the Reservations page', () => {
  const held = (n: number): Reservation =>
    ({ id: `r${n}`, bookId: `bk${n}`, bookTitle: `Book ${n}`, memberId: `m${n}`, memberName: `Member ${n}`, memberCode: `M-${n}`, branchId: 'b1', status: 'ALLOCATED', allocatedCopyId: `cp${n}`, allocatedCopyCode: `C-${n}`, holdUntil: null, queuedAt: null }) as Reservation;
  const open = () => page(paths.adminReservations, <ReservationsPage />, paths.adminReservations);

  it('leads from a book ready for pickup to the desk with its member chosen', async () => {
    world.held = [held(1), held(2)];
    open();
    const links = await screen.findAllByRole('link', { name: lt.deskHandOver });
    expect(links.map((a) => a.getAttribute('href'))).toEqual([paths.adminDeskFor('m1'), paths.adminDeskFor('m2')]);
    expect(paths.adminDeskFor('m1')).toBe('/ops/desk?member=m1');
    expect(screen.getByText(lt.reservationsHint)).toBeInTheDocument();
  });

  it('shows the way to the desk only to those who may issue, and the reserve button only to those who may reserve and see members', async () => {
    world.held = [held(1)];
    await signInWith(['reservations.manage']);
    const view = open();
    await screen.findByText('Book 1');
    expect(screen.queryByRole('link', { name: lt.deskHandOver })).toBeNull();
    expect(screen.queryByRole('button', { name: lt.placeReservation })).toBeNull();
    expect(screen.getByRole('button', { name: lt.cancelReservation })).toBeInTheDocument();
    view.unmount();

    await signInWith(['reservations.manage', 'members.view', 'loans.issue']);
    open();
    expect(await screen.findByRole('link', { name: lt.deskHandOver })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: lt.placeReservation })).toBeInTheDocument();
  });

  it('reserves a title from here: member first, then the title, and the lists are read again', async () => {
    const user = userEvent.setup();
    world.respond = (data: Sent) => (data.action === 'copies-availability' ? stock(0) : { reservationId: 'r9', status: 'WAITING', copyCode: null });
    open();
    await user.click(await screen.findByRole('button', { name: lt.placeReservation }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(lt.reserveFor), 'asha');
    await user.click(await within(dialog).findByRole('button', { name: /Asha Rao/ }));
    await user.type(await within(dialog).findByLabelText(lt.reserveBook), 'kidn');
    await user.click(await within(dialog).findByRole('button', { name: /Kidnapped/ }));
    expect(await within(dialog).findByText(lt.reserveStockNone)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: lt.placeReservation }));
    await waitFor(() => expect(placed()).toHaveLength(1));
    expect(placed()[0]).toMatchObject({ orgId: 'o1', memberId: 'm1', bookId: 'bk2', branchId: 'b1' });
    await user.click(await within(dialog).findByRole('button', { name: lt.finished }));
    expect(screen.getByText(lt.reserveWaiting('Kidnapped'))).toBeInTheDocument();
  });
});
