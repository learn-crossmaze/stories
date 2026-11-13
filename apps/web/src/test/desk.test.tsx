import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FirebaseError } from 'firebase/app';
import { Timestamp } from 'firebase/firestore';
import { MemoryRouter, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Plan, Subscription } from '../data/billing';
import type { Loan, Reservation } from '../data/circulation';
import type { Copy } from '../data/inventory';
import type { Member } from '../data/members';
import { paths } from '../paths';
import { t } from '../strings';
import { lt } from '../strings/library';

// The circulation desk with the server faked at the Cloud Functions boundary and the reads faked in the data layer.
type Sent = { action: string; requestId: string } & Record<string, unknown>;

const world = vi.hoisted(() => ({
  calls: [] as { action: string; requestId: string }[],
  /** The server's answer to each command (a thrown error, or a result). */
  respond: (() => undefined) as (data: never) => unknown,
  members: [] as unknown[],
  loans: [] as unknown[],
  /** The member's books are read only once this lets them: a test holds it to scan while they are still loading. */
  loansGate: Promise.resolve(),
  holds: [] as unknown[],
  subs: [] as unknown[] | Error,
  copies: {} as Record<string, unknown>,
  inspection: [] as unknown[],
  /** Lookups wait for this: a test holds it to scan faster than the lookups answer. */
  gate: Promise.resolve(),
}));
const calls = world.calls as Sent[];

const reads = vi.hoisted(() => ({
  findCopy: vi.fn(),
  getCopy: vi.fn(),
  listCopies: vi.fn(),
  getMember: vi.fn(),
  searchMembers: vi.fn(),
  memberSubscriptions: vi.fn(),
  listPlans: vi.fn(),
}));

vi.mock('firebase/functions', () => ({
  httpsCallable: () => async (data: Sent) => {
    world.calls.push(data);
    const answer = world.respond(data as never);
    if (answer instanceof Error) throw answer;
    return { data: answer };
  },
}));
vi.mock('../data/services', () => ({ services: () => ({ fns: {}, db: {} }) }));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ claims: { v: 1, sa: true, o: {} } }) }));
vi.mock('../admin/Workspace', () => ({
  useWorkspace: () => ({
    org: { id: 'o1', type: 'CORPORATE' },
    branch: { id: 'b1', name: 'Central' },
    branches: [{ id: 'b1', name: 'Central' }, { id: 'b2', name: 'North' }],
    branchesLoading: false,
  }),
}));
vi.mock('../data/inventory', async (importOriginal) => ({ ...(await importOriginal<typeof import('../data/inventory')>()), findCopy: reads.findCopy, getCopy: reads.getCopy, listCopies: reads.listCopies }));
vi.mock('../data/members', async (importOriginal) => ({ ...(await importOriginal<typeof import('../data/members')>()), searchMembers: reads.searchMembers, getMember: reads.getMember }));
vi.mock('../data/circulation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../data/circulation')>()),
  memberLoans: async () => {
    await world.loansGate;
    return world.loans;
  },
  memberReservations: async () => world.holds,
}));
vi.mock('../data/billing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../data/billing')>()),
  memberSubscriptions: reads.memberSubscriptions,
  listPlans: reads.listPlans,
  // No deposit yet: the plan chooser can work out the total to take.
  depositAccount: async () => null,
}));
vi.mock('../data/catalogue', async (importOriginal) => {
  // What the title picker finds, whatever is typed.
  const found = [{ id: 'bk9', title: 'Kidnapped', authorNames: ['R. L. Stevenson'], status: 'ACTIVE', coverUrl: null }];
  return { ...(await importOriginal<typeof import('../data/catalogue')>()), searchBooks: async () => ({ items: found }), findBooks: async () => found };
});

const { DeskPage } = await import('../admin/circulation/Desk');

const days = (n: number) => Timestamp.fromMillis(Date.now() + n * 86_400_000);
const member = (over: Partial<Member> = {}): Member => ({
  id: 'm1', code: 'MEM-0001', fullName: 'Asha Rao', dob: '1990-05-01', audience: 'ADULTS', isMinor: false, phone: null, email: null, address: null,
  homeBranchId: 'b1', status: 'ACTIVE', guardian: null, activeSubscriptionId: 's1', nextSubscriptionId: null, subscriptionEndsAt: null,
  activeLoanCount: 0, allocatedCount: 0, waitingCount: 0, lifetimeLoans: 0, lifetimeExchanges: 0, ...over,
});
const sub = (over: Partial<Subscription> = {}): Subscription => ({
  id: 's1', memberId: 'm1', planId: 'p1', planVersion: 1,
  planSnapshot: { name: 'Monthly Two', duration: 'MONTHLY', months: 1, priceMinor: 30000, depositMinor: 0, maxSimultaneousBooks: 2 },
  kind: 'NEW', status: 'ACTIVE', amountDue: { subscriptionMinor: 30000, depositMinor: 0, totalMinor: 30000 },
  startAt: days(-5), endAt: days(25), exchangesThisTerm: 0, ...over,
});
const plan: Plan = {
  id: 'p1', name: 'Monthly Two', description: '', options: [{ duration: 'MONTHLY', priceMinor: 30000 }], depositMinor: 0, maxSimultaneousBooks: 2,
  audiences: ['ADULTS'], deliveryEligible: false, renewalWindowDays: 7, status: 'ACTIVE', version: 1,
};
const copy = (n: number, over: Partial<Copy> = {}): Copy => ({
  id: `cp${n}`, code: `C-${n}`, barcode: `C-${n}`, bookId: `bk${n}`, bookCode: `BOOK-${n}`, bookTitle: `Book ${n}`, owningBranchId: 'b1', currentBranchId: 'b1',
  locationId: null, status: 'AVAILABLE', condition: 'GOOD', acquisitionCostMinor: 0, activeLoanId: null, activeReservationId: null, lifetimeLoans: 0, ...over,
});
const loan = (n: number): Loan => ({
  id: `l${n}`, memberId: 'm1', memberName: 'Asha Rao', memberCode: 'MEM-0001', copyId: `cp${n}`, copyCode: `C-${n}`, bookId: `bk${n}`, bookTitle: `Book ${n}`,
  branchId: 'b1', status: 'ACTIVE', issuedAt: days(-3), returnedAt: null, exchangeId: null,
});
/** Puts copies where a scan finds them, by barcode. */
const shelve = (...list: Copy[]) => Object.assign(world.copies, Object.fromEntries(list.map((c) => [c.barcode, c])));

/** A scanner: the code, then Enter, with no pause. */
function scan(box: HTMLElement, code: string) {
  fireEvent.change(box, { target: { value: code } });
  fireEvent.keyDown(box, { key: 'Enter' });
}
/** A person's Enter: the scan box ignores one that comes right behind a scan. */
const pause = () => new Promise((r) => setTimeout(r, 350));

/** The address the desk is at, to see what is left of a link once it was used. */
function Where() {
  const at = useLocation();
  return <output data-testid="where">{at.pathname + at.search}</output>;
}
function open(at: string = paths.adminDesk) {
  render(
    <MemoryRouter initialEntries={[at]}>
      <DeskPage />
      <Where />
    </MemoryRouter>,
  );
}
const held = (n: number, over: Partial<Reservation> = {}): Reservation => ({
  id: `r${n}`, memberId: 'm1', memberName: 'Asha Rao', memberCode: 'MEM-0001', bookId: `bk${n}`, bookTitle: `Book ${n}`, branchId: 'b1', status: 'ALLOCATED',
  allocatedCopyId: `cp${n}`, allocatedCopyCode: `C-${n}`, holdUntil: null, queuedAt: null, ...over,
});
/** Opens the desk and the member, as scanning their card does. */
async function openMember() {
  open();
  scan(await screen.findByLabelText(lt.findMember), 'MEM-0001');
  return screen.findByLabelText(lt.scanToIssue);
}

beforeEach(() => {
  calls.length = 0;
  world.respond = () => ({});
  world.members = [member()];
  world.loans = [];
  world.loansGate = Promise.resolve();
  world.holds = [];
  world.subs = [sub()];
  world.copies = {};
  world.inspection = [];
  world.gate = Promise.resolve();
  for (const read of Object.values(reads)) read.mockReset();
  reads.findCopy.mockImplementation(async (_org: string, _branch: string, code: string) => {
    await world.gate;
    return world.copies[code.trim().toUpperCase()] ?? null;
  });
  reads.getCopy.mockImplementation(async (_org: string, id: string) => Object.values(world.copies as Record<string, Copy>).find((c) => c.id === id) ?? null);
  reads.listCopies.mockImplementation(async () => ({ items: world.inspection, last: null }));
  reads.searchMembers.mockImplementation(async () => world.members);
  reads.getMember.mockImplementation(async (_org: string, id: string) => (world.members as Member[]).find((m) => m.id === id) ?? null);
  reads.listPlans.mockImplementation(async () => [plan]);
  reads.memberSubscriptions.mockImplementation(async () => {
    if (world.subs instanceof Error) throw world.subs;
    return world.subs;
  });
});

describe('member desk', () => {
  it('serves a member from the keyboard: card, book, Enter, and back to the next card', async () => {
    const user = userEvent.setup();
    shelve(copy(1));
    open();
    const finder = await screen.findByLabelText(lt.findMember);
    expect(finder).toHaveFocus();
    await user.keyboard('MEM-0001{Enter}');
    const box = await screen.findByLabelText(lt.scanToIssue);
    expect(box).toHaveFocus();

    // A scanner that ends each code with two Enters confirms nothing.
    await user.keyboard('C-1{Enter}{Enter}');
    const confirm = await screen.findByRole('button', { name: lt.pressEnter(lt.issueN(1)) });
    expect(calls).toHaveLength(0);
    expect(box).toHaveFocus();

    await pause();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({ action: 'circulation-issue', orgId: 'o1', branchId: 'b1', memberId: 'm1', barcodes: ['C-1'] });
    expect(confirm).not.toBeInTheDocument();

    // Back at the member finder, with what was done and a way back to the member.
    expect(await screen.findByText(lt.deskReceipt('Asha Rao', 'MEM-0001', 0, 1), { exact: false })).toBeInTheDocument();
    expect(screen.getByLabelText(lt.findMember)).toHaveFocus();
    expect(calls).toHaveLength(1);

    // "Open again" reads the member afresh (their counts changed) and opens them.
    expect(reads.getMember).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: lt.openAgain }));
    expect(await screen.findByLabelText(lt.scanToIssue)).toHaveFocus();
    expect(reads.getMember).toHaveBeenCalledWith('o1', 'm1');
  });

  it("ticks a returned book from the member's own list without looking it up; a label that differs is matched by the copy", async () => {
    const user = userEvent.setup();
    world.loans = [loan(1), loan(2)];
    shelve(copy(2, { barcode: 'LBL-2', status: 'ISSUED' }));
    const box = await openMember();
    await screen.findByRole('checkbox', { name: /Book 1/ });

    scan(box, 'c-1');
    await waitFor(() => expect(screen.getByRole('checkbox', { name: /Book 1/ })).toBeChecked());
    expect(reads.findCopy).not.toHaveBeenCalled();
    scan(box, 'LBL-2');
    await waitFor(() => expect(screen.getByRole('checkbox', { name: /Book 2/ })).toBeChecked());
    expect(reads.findCopy).toHaveBeenCalledTimes(1);

    await user.click(await screen.findByRole('button', { name: lt.pressEnter(lt.returnN(2)) }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({ action: 'circulation-return', barcodes: ['C-1', 'C-2'] });
    expect(await screen.findByText(lt.deskReceipt('Asha Rao', 'MEM-0001', 2, 0), { exact: false })).toBeInTheDocument();
  });

  it('a book scanned straight after the card waits for the member\'s books, and is ticked as a return', async () => {
    world.loans = [loan(1)];
    shelve(copy(1, { status: 'ISSUED' }));
    let release = () => {};
    world.loansGate = new Promise<void>((r) => (release = r));
    open();
    scan(await screen.findByLabelText(lt.findMember), 'MEM-0001');
    // The scan lands while the member's books are still being read: nothing is decided about it yet.
    scan(await screen.findByLabelText(lt.scanToIssue), 'C-1');
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole('checkbox', { name: /Book 1/ })).toBeNull();
    expect(reads.findCopy).not.toHaveBeenCalled();
    expect(screen.queryByText(lt.onLoanElsewhere, { exact: false })).toBeNull();
    expect(screen.getByRole('button', { name: lt.nothingStaged })).toBeDisabled();

    release();
    await waitFor(() => expect(screen.getByRole('checkbox', { name: /Book 1/ })).toBeChecked());
    expect(reads.findCopy).not.toHaveBeenCalled();
    expect(screen.queryByText(lt.onLoanElsewhere, { exact: false })).toBeNull();
    expect(screen.queryByText(`C-1: ${lt.onLoanElsewhere}`)).toBeNull();
  });

  it('loses no scan when books are scanned faster than they are looked up, and keeps every warning', async () => {
    const user = userEvent.setup();
    shelve(copy(3), copy(4), copy(5, { status: 'DAMAGED' }));
    const box = await openMember();
    scan(box, 'C-4');
    const confirm = await screen.findByRole('button', { name: lt.pressEnter(lt.issueN(1)) });

    // Four scans while the first of them is still being looked up: the same book twice, a code nobody knows, a damaged copy.
    let release = () => {};
    world.gate = new Promise<void>((r) => (release = r));
    for (const code of ['C-3', 'C-3', 'NOPE', 'C-5']) scan(box, code);
    expect(box).not.toHaveAttribute('readonly');
    // Nothing can be confirmed while a scan is still on its way.
    await waitFor(() => expect(screen.getByRole('button', { name: lt.issueN(1) })).toBeDisabled());
    release();

    expect(await screen.findByRole('button', { name: lt.pressEnter(lt.issueN(2)) })).toBeEnabled();
    expect(confirm).toBeInTheDocument();
    expect(screen.getAllByText('Book 3')).toHaveLength(1);
    expect(screen.getByText(`C-3: ${lt.alreadyStaged}`)).toBeInTheDocument();
    expect(screen.getByText(`NOPE: ${lt.copyNotFound}`)).toBeInTheDocument();
    expect(screen.getByText(`C-5: ${lt.notOnShelf('Damaged')}`)).toBeInTheDocument();
    expect(box).toHaveValue('');

    await user.click(screen.getByRole('button', { name: t.scanClearFailed }));
    expect(screen.queryByText(`NOPE: ${lt.copyNotFound}`)).toBeNull();
    await user.click(screen.getByRole('button', { name: lt.pressEnter(lt.issueN(2)) }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({ action: 'circulation-issue', barcodes: ['C-4', 'C-3'] });
  });

  it('keeps the member and the scanned books when the server refuses, and sends focus back to the scan box', async () => {
    const user = userEvent.setup();
    shelve(copy(1));
    const box = await openMember();
    scan(box, 'C-1');
    world.respond = () => new FirebaseError('functions/failed-precondition', 'Copy C-1 is not available (damaged).');
    await user.click(await screen.findByRole('button', { name: lt.pressEnter(lt.issueN(1)) }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Copy C-1 is not available (damaged).');
    expect(screen.getByText('Book 1')).toBeInTheDocument();
    await waitFor(() => expect(box).toHaveFocus());
  });

  it('says why books cannot go out before asking the server; a return on its own is never held back', async () => {
    const user = userEvent.setup();
    world.loans = [loan(1), loan(2)];
    shelve(copy(3));
    const box = await openMember();
    await screen.findByText(lt.held(2, 2), { exact: false });

    // The plan allows two and two are out: a third is held back until one comes in.
    scan(box, 'C-3');
    expect(await screen.findByText(lt.blockedLimit(2))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: lt.issueN(1) })).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: /Book 1/ }));
    expect(screen.queryByText(lt.blockedLimit(2))).toBeNull();
    expect(screen.getByRole('button', { name: lt.pressEnter(lt.exchangeN(1, 1)) })).toBeEnabled();
  });

  it('lets a lapsed member subscribe at the desk without losing the scanned books', async () => {
    const user = userEvent.setup();
    world.members = [member({ activeSubscriptionId: null })];
    world.subs = [];
    world.loans = [loan(1)];
    shelve(copy(3));
    const box = await openMember();
    expect(await screen.findByRole('button', { name: lt.subscribe })).toBeInTheDocument();
    expect(screen.getByText(lt.returnsOnly, { exact: false })).toBeInTheDocument();

    // A return alone goes ahead; a book to issue is held back with the reason.
    await user.click(await screen.findByRole('checkbox', { name: /Book 1/ }));
    expect(screen.getByRole('button', { name: lt.pressEnter(lt.returnN(1)) })).toBeEnabled();
    await user.click(screen.getByRole('checkbox', { name: /Book 1/ }));
    scan(box, 'C-3');
    expect(await screen.findByText(lt.blockedNoPlan)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: lt.issueN(1) })).toBeDisabled();

    // Subscribed here: the book stays scanned, and the payment can be taken next.
    await user.click(screen.getByRole('button', { name: lt.subscribe }));
    world.respond = () => {
      world.subs = [sub({ id: 's2', status: 'PENDING_PAYMENT' })];
      return { subscriptionId: 's2' };
    };
    await user.click(await within(screen.getByRole('dialog')).findByRole('button', { name: lt.saveUnpaid }));
    await waitFor(() => expect(calls.map((c) => c.action)).toEqual(['subscriptions-create']));
    expect(calls[0]).toMatchObject({ orgId: 'o1', memberId: 'm1', planId: 'p1', duration: 'MONTHLY' });
    expect(calls[0]).not.toHaveProperty('payment');
    expect((await screen.findAllByRole('button', { name: new RegExp(`^${lt.recordPayment}`) })).length).toBeGreaterThan(0);
    expect(screen.getByText('Book 3')).toBeInTheDocument();
    expect(screen.getByText(lt.blockedNoPlan)).toBeInTheDocument();
    // The Subscribe button went with the step it started: the keyboard is not left on nothing.
    await waitFor(() => expect(box).toHaveFocus());
  });

  it('takes a pending payment at the desk: the scanned books stay and can then be issued', async () => {
    const user = userEvent.setup();
    world.members = [member({ activeSubscriptionId: null })];
    world.subs = [sub({ id: 's2', status: 'PENDING_PAYMENT' })];
    shelve(copy(3));
    const box = await openMember();
    scan(box, 'C-3');
    expect(await screen.findByText(lt.blockedNoPlan)).toBeInTheDocument();

    await user.click(await screen.findByRole('button', { name: lt.recordPayment }));
    world.respond = () => {
      // The payment activates the subscription.
      world.subs = [sub({ id: 's2' })];
      world.members = [member({ activeSubscriptionId: 's2' })];
      return {};
    };
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: new RegExp(`^${lt.recordPayment} ·`) }));
    await waitFor(() => expect(calls.map((c) => c.action)).toEqual(['payments-recordOffline']));

    expect(await screen.findByRole('button', { name: lt.pressEnter(lt.issueN(1)) })).toBeEnabled();
    expect(screen.getByText('Book 3')).toBeInTheDocument();
    expect(screen.queryByText(lt.blockedNoPlan)).toBeNull();
    expect(screen.queryByRole('button', { name: lt.recordPayment })).toBeNull();
    expect(reads.getMember).toHaveBeenCalledWith('o1', 'm1');
    // Paid: the keyboard is back in the scan box, where Enter confirms.
    await waitFor(() => expect(box).toHaveFocus());
  });

  it('sends the keyboard back to the scan box after a payment taken while a term is still in force', async () => {
    const user = userEvent.setup();
    // An early renewal waiting for payment: the member can borrow, and the card is up for the payment only.
    world.subs = [sub(), sub({ id: 's2', status: 'PENDING_PAYMENT', kind: 'RENEWAL' })];
    shelve(copy(3));
    const box = await openMember();
    scan(box, 'C-3');
    await screen.findByRole('button', { name: lt.pressEnter(lt.issueN(1)) });

    await user.click(await screen.findByRole('button', { name: lt.recordPayment }));
    world.respond = () => {
      world.subs = [sub(), sub({ id: 's2', startAt: days(25), endAt: days(55) })];
      world.members = [member({ nextSubscriptionId: 's2' })];
      return {};
    };
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: new RegExp(`^${lt.recordPayment} ·`) }));
    await waitFor(() => expect(calls.map((c) => c.action)).toEqual(['payments-recordOffline']));
    // The card has gone with its button; Enter in the scan box issues the book that was waiting.
    await waitFor(() => expect(screen.queryByRole('button', { name: lt.recordPayment })).toBeNull());
    await waitFor(() => expect(box).toHaveFocus());
    await pause();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(calls.map((c) => c.action)).toEqual(['payments-recordOffline', 'circulation-issue']));
  });

  it('opens with the member a link names, and uses the link once', async () => {
    const user = userEvent.setup();
    open(paths.adminDeskFor('m1'));
    expect(await screen.findByLabelText(lt.scanToIssue)).toHaveFocus();
    expect(screen.getByRole('link', { name: 'Asha Rao' })).toBeInTheDocument();
    expect(reads.getMember).toHaveBeenCalledWith('o1', 'm1');
    expect(reads.searchMembers).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(new RegExp(`^${paths.adminDesk}$`)));

    // "Change member" goes to the find box and stays there.
    await user.click(screen.getByRole('button', { name: lt.changeMember }));
    expect(await screen.findByLabelText(lt.findMember)).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByLabelText(lt.scanToIssue)).toBeNull();
    expect(reads.getMember).toHaveBeenCalledTimes(1);
  });

  it("does not open another branch's member from a link, nor one that cannot be read", async () => {
    world.members = [member({ homeBranchId: 'b2' })];
    open(paths.adminDeskFor('m1'));
    expect(await screen.findByText(lt.deskOtherBranch('Asha Rao', 'North'))).toBeInTheDocument();
    expect(screen.getByLabelText(lt.findMember)).toBeInTheDocument();
    expect(screen.queryByLabelText(lt.scanToIssue)).toBeNull();
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(new RegExp(`^${paths.adminDesk}$`)));
  });

  it('lands on the find box with a notice when the linked member is missing or the read is refused', async () => {
    reads.getMember.mockImplementation(async () => {
      throw Object.assign(new Error('denied'), { code: 'permission-denied' });
    });
    open(paths.adminDeskFor('nobody'));
    expect(await screen.findByText(lt.deskMemberMissing)).toBeInTheDocument();
    expect(screen.getByLabelText(lt.findMember)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(new RegExp(`^${paths.adminDesk}$`)));
  });

  it('adds a book held for the member with one click, once, and only when it is held at this branch', async () => {
    const user = userEvent.setup();
    world.members = [member({ allocatedCount: 3 })];
    world.subs = [sub({ planSnapshot: { ...sub().planSnapshot, maxSimultaneousBooks: 3 } })];
    world.holds = [held(1), held(2, { branchId: 'b2' }), held(3)];
    shelve(copy(1, { status: 'RESERVED', activeReservationId: 'r1' }), copy(3, { status: 'AVAILABLE' }));
    const box = await openMember();
    const list = await screen.findByRole('list', { name: lt.holdsHere });
    expect(within(list).getByText('Book 2')).toBeInTheDocument();
    expect(within(list).getByText(lt.holdAt('North'), { exact: false })).toBeInTheDocument();
    // The hold at another branch has no button.
    expect(screen.queryByRole('button', { name: lt.holdAddTitle('Book 2') })).toBeNull();

    await user.click(screen.getByRole('button', { name: lt.holdAddTitle('Book 1') }));
    expect(await screen.findByRole('button', { name: lt.pressEnter(lt.issueN(1)) })).toBeEnabled();
    expect(reads.getCopy).toHaveBeenCalledWith('o1', 'cp1');
    expect(reads.findCopy).not.toHaveBeenCalled();
    // Staged once: its button is gone, and scanning the same book says it is already in the list.
    expect(screen.queryByRole('button', { name: lt.holdAddTitle('Book 1') })).toBeNull();
    await waitFor(() => expect(box).toHaveFocus());
    scan(box, 'C-1');
    expect(await screen.findByText(`C-1: ${lt.alreadyStaged}`)).toBeInTheDocument();

    // A hold that ran out since the list was read is not staged; the holds are read again.
    world.holds = [held(1), held(2, { branchId: 'b2' })];
    await user.click(screen.getByRole('button', { name: lt.holdAddTitle('Book 3') }));
    expect(await screen.findByText(`C-3: ${lt.holdGone}`)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('button', { name: lt.holdAddTitle('Book 3') })).toBeNull());

    await user.click(screen.getByRole('button', { name: lt.pressEnter(lt.issueN(1)) }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({ action: 'circulation-issue', memberId: 'm1', barcodes: ['C-1'] });
  });

  it('reserves a title for the member without losing the scanned books', async () => {
    const user = userEvent.setup();
    world.loans = [loan(1)];
    shelve(copy(3));
    const box = await openMember();
    scan(box, 'C-3');
    await user.click(await screen.findByRole('checkbox', { name: /Book 1/ }));
    await screen.findByRole('button', { name: lt.pressEnter(lt.exchangeN(1, 1)) });

    await user.click(screen.getByRole('button', { name: lt.placeReservation }));
    const dialog = await screen.findByRole('dialog', { name: lt.reserveTitleFor('Asha Rao') });
    world.respond = (data: Sent) => {
      if (data.action === 'copies-availability') return { branches: [{ branchId: 'b1', branchName: 'Central', available: 1, total: 2 }] };
      world.holds = [held(9, { bookTitle: 'Kidnapped' })];
      world.members = [member({ allocatedCount: 1 })];
      return { reservationId: 'r9', status: 'ALLOCATED', copyCode: 'C-9' };
    };
    await user.type(within(dialog).getByRole('searchbox'), 'kidn');
    await user.click(await within(dialog).findByRole('button', { name: /Kidnapped/ }));
    await user.click(within(dialog).getByRole('button', { name: lt.placeReservation }));
    await waitFor(() => expect(calls.some((c) => c.action === 'reservations-place')).toBe(true));
    expect(calls.find((c) => c.action === 'reservations-place')).toMatchObject({ orgId: 'o1', memberId: 'm1', bookId: 'bk9', branchId: 'b1' });
    await user.click(await within(dialog).findByRole('button', { name: lt.finished }));

    // Back at the desk: the member, the ticked return and the scanned book are as they were; the hold counts.
    expect(await screen.findByText(lt.reserveHeld('Kidnapped', 'C-9'))).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /Book 1/ })).toBeChecked();
    expect(screen.getByText('Book 3')).toBeInTheDocument();
    expect(await within(await screen.findByRole('list', { name: lt.holdsHere })).findByText('Kidnapped')).toBeInTheDocument();
    expect(reads.getMember).toHaveBeenCalledWith('o1', 'm1');
    await waitFor(() => expect(box).toHaveFocus());
    // One out, one back, one held: at the plan's limit of two, not over it.
    expect(await screen.findByText(lt.held(2, 2), { exact: false })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: lt.pressEnter(lt.exchangeN(1, 1)) })).toBeEnabled();
  });

  it('offers no reservation to a member who cannot borrow', async () => {
    world.members = [member({ activeSubscriptionId: null })];
    world.subs = [];
    await openMember();
    await screen.findByRole('button', { name: lt.subscribe });
    expect(screen.queryByRole('button', { name: lt.placeReservation })).toBeNull();
  });

  it('leaves the decision to the server when the subscriptions could not be read', async () => {
    world.subs = Object.assign(new Error('offline'), { code: 'unavailable' });
    shelve(copy(3));
    const box = await openMember();
    scan(box, 'C-3');
    expect(await screen.findByRole('button', { name: lt.pressEnter(lt.issueN(1)) })).toBeEnabled();
    expect(screen.getByText(t.errorNetwork)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: lt.subscribe })).toBeNull();
  });
});

describe('quick return', () => {
  async function openQuickReturn() {
    const user = userEvent.setup();
    open();
    await user.click(await screen.findByRole('tab', { name: lt.deskModeReturn }));
    return { user, box: await screen.findByLabelText(lt.scanToReturn) };
  }
  const pile = (n: number) => Array.from({ length: n }, (_, i) => copy(i + 1, { status: 'ISSUED' }));

  it('returns a pile of 31 in two calls, and keeps only the books of the call that failed', async () => {
    shelve(...pile(31));
    const { user, box } = await openQuickReturn();
    expect(box).toHaveFocus();
    for (let n = 1; n <= 31; n++) scan(box, `C-${n}`);
    const confirm = await screen.findByRole('button', { name: lt.pressEnter(lt.returnN(31)) });

    world.respond = () => (calls.length === 2 ? new FirebaseError('functions/failed-precondition', 'Copy C-31 is not on loan.') : {});
    await user.click(confirm);
    expect(await screen.findByRole('alert')).toHaveTextContent('Copy C-31 is not on loan.');
    expect(calls.map((c) => (c.barcodes as string[]).length)).toEqual([30, 1]);
    expect(calls[0].requestId).not.toBe(calls[1].requestId);
    expect(screen.getByText(lt.returnedSoFar(30))).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(screen.getByText('Book 31')).toBeInTheDocument();
    await waitFor(() => expect(box).toHaveFocus());

    // The stale copy is taken off the list by hand.
    await user.click(screen.getByRole('button', { name: t.cancel }));
    expect(screen.queryByText('Book 31')).toBeNull();
    expect(screen.getByRole('button', { name: lt.returnN(0) })).toBeDisabled();
  });

  it('confirms with Enter, says how many came back, and lists what could not be staged', async () => {
    shelve(...pile(2), copy(9));
    const { user, box } = await openQuickReturn();
    for (const code of ['C-1', 'C-9', 'C-2', 'C-1', 'NOPE']) scan(box, code);
    await screen.findByRole('button', { name: lt.pressEnter(lt.returnN(2)) });
    expect(screen.getByText('C-9: Available')).toBeInTheDocument();
    expect(screen.getByText(`NOPE: ${lt.copyNotFound}`)).toBeInTheDocument();

    await pause();
    await user.keyboard('{Enter}');
    expect(await screen.findByText(lt.returned(2))).toBeInTheDocument();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ action: 'circulation-return', orgId: 'o1', branchId: 'b1', barcodes: ['C-1', 'C-2'] });
    expect(screen.queryByRole('listitem')).toBeNull();
    expect(screen.queryByText('C-9: Available')).toBeNull();
    await waitFor(() => expect(box).toHaveFocus());
  });
});

describe('inspection', () => {
  it('passes every ticked book in one call, and names the ones someone else had already checked', async () => {
    const user = userEvent.setup();
    world.inspection = [1, 2, 3].map((n) => copy(n, { status: 'UNDER_INSPECTION' }));
    open();
    await user.click(await screen.findByRole('tab', { name: lt.deskModeInspect }));
    await screen.findByRole('button', { name: lt.passN(3) });
    await user.click(screen.getByRole('checkbox', { name: 'C-2 Book 2' }));

    world.respond = () => {
      world.inspection = [copy(2, { status: 'UNDER_INSPECTION' })];
      return { passed: ['cp1'], skipped: ['C-3'] };
    };
    await user.click(screen.getByRole('button', { name: lt.passN(2) }));
    expect(await screen.findByText(lt.inspectSkipped('C-3'), { exact: false })).toHaveTextContent(lt.inspectPassed(1));
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ action: 'copies-inspectMany', orgId: 'o1', branchId: 'b1', copyIds: ['cp1', 'cp3'] });
    // The handled rows are gone and the list was read again behind them; the unticked book is still waiting.
    expect(screen.queryByText('Book 1')).toBeNull();
    expect(screen.queryByText('Book 3')).toBeNull();
    expect(screen.getByText('Book 2')).toBeInTheDocument();
    await waitFor(() => expect(reads.listCopies).toHaveBeenCalledTimes(2));

    // A damaged book is still recorded on its own.
    world.respond = () => {
      world.inspection = [];
      return { copyId: 'cp2' };
    };
    await user.click(screen.getByRole('button', { name: lt.failInspection }));
    await waitFor(() => expect(calls[1]).toMatchObject({ action: 'copies-inspect', copyId: 'cp2', outcome: 'DAMAGED', condition: 'POOR' }));
    expect(await screen.findByText(lt.noInspections)).toBeInTheDocument();
  });

  it('reads the list again when the whole batch is refused, names the row that left, and the next click goes through', async () => {
    const user = userEvent.setup();
    world.inspection = [1, 2, 3].map((n) => copy(n, { status: 'UNDER_INSPECTION' }));
    open();
    await user.click(await screen.findByRole('tab', { name: lt.deskModeInspect }));

    // C-2 was passed by a colleague, issued and returned at another branch since the list was read.
    world.respond = () => {
      world.inspection = [1, 3].map((n) => copy(n, { status: 'UNDER_INSPECTION' }));
      return Object.assign(new FirebaseError('functions/failed-precondition', 'Copy C-2 is not at this branch.'), { details: { reason: 'OTHER_BRANCH' } });
    };
    await user.click(await screen.findByRole('button', { name: lt.passN(3) }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Copy C-2 is not at this branch.');
    expect(await screen.findByText(lt.inspectGone('C-2'))).toBeInTheDocument();
    await waitFor(() => expect(reads.listCopies).toHaveBeenCalledTimes(2));
    expect(screen.queryByText('Book 2')).toBeNull();

    world.respond = () => {
      world.inspection = [];
      return { passed: ['cp1', 'cp3'], skipped: [] };
    };
    await user.click(screen.getByRole('button', { name: lt.passN(2) }));
    expect(await screen.findByText(lt.inspectPassed(2))).toBeInTheDocument();
    expect(calls.map((c) => c.copyIds)).toEqual([['cp1', 'cp2', 'cp3'], ['cp1', 'cp3']]);
    expect(await screen.findByText(lt.noInspections)).toBeInTheDocument();
  });
});
