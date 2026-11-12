import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FirebaseError } from 'firebase/app';
import { Timestamp } from 'firebase/firestore';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Plan, Subscription } from '../data/billing';
import type { Loan } from '../data/circulation';
import type { Copy } from '../data/inventory';
import type { Member } from '../data/members';
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
  subs: [] as unknown[] | Error,
  copies: {} as Record<string, unknown>,
  inspection: [] as unknown[],
  /** Lookups wait for this: a test holds it to scan faster than the lookups answer. */
  gate: Promise.resolve(),
}));
const calls = world.calls as Sent[];

const reads = vi.hoisted(() => ({
  findCopy: vi.fn(),
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
  useWorkspace: () => ({ org: { id: 'o1', type: 'CORPORATE' }, branch: { id: 'b1', name: 'Central' }, branches: [{ id: 'b1', name: 'Central' }], branchesLoading: false }),
}));
vi.mock('../data/inventory', async (importOriginal) => ({ ...(await importOriginal<typeof import('../data/inventory')>()), findCopy: reads.findCopy, listCopies: reads.listCopies }));
vi.mock('../data/members', async (importOriginal) => ({ ...(await importOriginal<typeof import('../data/members')>()), searchMembers: reads.searchMembers, getMember: reads.getMember }));
vi.mock('../data/circulation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../data/circulation')>()),
  memberLoans: async () => world.loans,
  memberReservations: async () => [],
}));
vi.mock('../data/billing', async (importOriginal) => ({ ...(await importOriginal<typeof import('../data/billing')>()), memberSubscriptions: reads.memberSubscriptions, listPlans: reads.listPlans }));

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

function open() {
  render(
    <MemoryRouter>
      <DeskPage />
    </MemoryRouter>,
  );
}
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
  world.subs = [sub()];
  world.copies = {};
  world.inspection = [];
  world.gate = Promise.resolve();
  for (const read of Object.values(reads)) read.mockReset();
  reads.findCopy.mockImplementation(async (_org: string, _branch: string, code: string) => {
    await world.gate;
    return world.copies[code.trim().toUpperCase()] ?? null;
  });
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
    open();
    scan(await screen.findByLabelText(lt.findMember), 'MEM-0001');
    // The scan lands while the member's books are still being read.
    scan(await screen.findByLabelText(lt.scanToIssue), 'C-1');
    await waitFor(() => expect(screen.getByRole('checkbox', { name: /Book 1/ })).toBeChecked());
    expect(screen.queryByText(lt.onLoanElsewhere, { exact: false })).toBeNull();
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
    await user.click(await within(screen.getByRole('dialog')).findByRole('button', { name: t.create }));
    await waitFor(() => expect(calls.map((c) => c.action)).toEqual(['subscriptions-create']));
    expect(calls[0]).toMatchObject({ orgId: 'o1', memberId: 'm1', planId: 'p1', duration: 'MONTHLY' });
    expect((await screen.findAllByRole('button', { name: new RegExp(`^${lt.recordPayment}`) })).length).toBeGreaterThan(0);
    expect(screen.getByText('Book 3')).toBeInTheDocument();
    expect(screen.getByText(lt.blockedNoPlan)).toBeInTheDocument();
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
});
