import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FirebaseError } from 'firebase/app';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Delivery } from '../data/delivery';
import type { Member } from '../data/members';
import { t } from '../strings';
import { dt } from '../strings/delivery';
import { lt } from '../strings/library';

// The Deliveries board with the server faked at the Cloud Functions boundary: what it asks for, and when.
type Sent = Record<string, unknown> & { action: string; requestId?: string };
const calls: Sent[] = [];
/** The server's answer to each call: a result, a thrown error, or a promise the test settles later. */
let respond: (data: Sent) => unknown = () => ({});

vi.mock('firebase/functions', () => ({
  httpsCallable: () => async (data: Sent) => {
    calls.push(data);
    const answer = await respond(data);
    if (answer instanceof Error) throw answer;
    return { data: answer };
  },
}));
vi.mock('../data/services', () => ({ services: () => ({ fns: {}, db: {} }) }));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ claims: { v: 1, sa: true, o: {} } }) }));
vi.mock('../admin/Workspace', () => ({ useWorkspace: () => ({ org: { id: 'o1' }, branch: { id: 'b1', name: 'Central' }, branchesLoading: false }) }));
const memberLoans = vi.fn(async () => [] as unknown[]);
const memberReservations = vi.fn(async () => [] as unknown[]);
let people: Member[] = [];
vi.mock('../data/circulation', () => ({ memberLoans: () => memberLoans(), memberReservations: () => memberReservations() }));
vi.mock('../data/members', () => ({ searchMembers: async () => people }));

const { DeliveriesPage } = await import('../admin/circulation/Deliveries');
const { deliveryCounts } = await import('../data/delivery');

const home = { line1: '12 MG Road', line2: '', landmark: '', city: 'Bengaluru', state: 'Karnataka', postalCode: '560001', geo: null };
const ravi = { uid: 'ravi', name: 'Ravi', phone: null };
const visit = (id: string, memberName: string, extra: Partial<Delivery> = {}): Delivery => ({
  id, branchId: 'b1', memberId: `m-${id}`, memberCode: `M-${id}`, memberName, phone: null, kind: 'DELIVER', status: 'REQUESTED', address: home,
  date: '2026-11-13', slot: null, note: '', holdIds: [], holdTitles: [], collectLoanIds: [], collectTitles: [], sent: [], collected: [],
  fee: { amountMinor: 0, status: 'FREE' }, method: null, rider: null, courier: null, provider: null, outcome: null, failReason: null,
  requestedBy: 'STAFF', requestedAt: '2026-11-12T04:00:00.000Z', ...extra,
});
const bag = (id: string, memberName: string, rider = ravi, books = 1) =>
  visit(id, memberName, {
    kind: 'PICKUP', status: 'RETURNING', method: 'OWN', rider, outcome: 'DELIVERED',
    collected: Array.from({ length: books }, (_, i) => ({ loanId: `ln-${id}-${i}`, copyId: `cp-${id}-${i}`, copyCode: `C-${id}-${i}`, bookTitle: `Book of ${memberName}` })),
  });
const view = {
  settings: { enabled: true, feeMinor: 0, pincodes: ['560001'], slots: [], location: null, methods: { OWN: true, MANUAL: true }, couriers: {} },
  couriers: [],
  riders: [{ uid: 'asha', name: 'Asha', delivery: true }, { uid: 'ravi', name: 'Ravi', delivery: true }],
  webhook: null,
  canConfigure: false,
};
const refusal = (reason: string, message: string) => Object.assign(new FirebaseError('functions/failed-precondition', message), { details: { reason } });

/** The board's own reads answered from `open` and `closed`; anything else goes to `other`. */
let open: Delivery[] = [];
let closed: Delivery[] = [];
function serve(other: (data: Sent) => unknown = () => ({})) {
  respond = (data) => {
    if (data.action === 'deliveries-settings') return view;
    if (data.action === 'deliveries-list') return { open, closed: data.closed ? closed : [] };
    return other(data);
  };
}
const sent = (action: string) => calls.filter((c) => c.action === action);
function show(at = '/ops/deliveries') {
  render(
    <MemoryRouter initialEntries={[at]}>
      <DeliveriesPage />
    </MemoryRouter>,
  );
}
const card = async (memberName: string) => (await screen.findByRole('heading', { name: new RegExp(`^${memberName}`) })).closest('li')!;
const dialog = () => within(screen.getByRole('dialog'));
/** A promise the test settles when it chooses, to play a slow answer. */
function later<T>() {
  let settle!: (v: T | Error) => void;
  const promise = new Promise<T | Error>((r) => (settle = r));
  return { promise, settle };
}

beforeEach(() => {
  calls.length = 0;
  open = [];
  closed = [];
  people = [];
  memberLoans.mockClear();
  memberReservations.mockClear();
  localStorage.clear();
});

describe('opening the board', () => {
  it('reads the open visits only, and the closed ones when their tab is opened', async () => {
    const user = userEvent.setup();
    open = [visit('a', 'Asha Rao', { kind: 'PICKUP' })];
    closed = [visit('z', 'Zoya Khan', { status: 'COMPLETED', outcome: 'DELIVERED' })];
    serve();
    show();
    await card('Asha Rao');
    expect(sent('deliveries-list')).toHaveLength(1);
    expect(sent('deliveries-list')[0]).not.toHaveProperty('closed');
    // No courier order is out: the courier is not asked for news.
    expect(sent('deliveries-sync')).toHaveLength(0);

    await user.click(screen.getByRole('tab', { name: dt.tabs.CLOSED }));
    await card('Zoya Khan');
    expect(sent('deliveries-list')).toHaveLength(2);
    expect(sent('deliveries-list')[1]).toMatchObject({ orgId: 'o1', branchId: 'b1', closed: true });
    // Leaving the tab reads nothing; coming back reads it afresh.
    await user.click(screen.getByRole('tab', { name: new RegExp(`^${dt.tabs.REQUESTED}`) }));
    await card('Asha Rao');
    expect(sent('deliveries-list')).toHaveLength(2);
    await user.click(screen.getByRole('tab', { name: dt.tabs.CLOSED }));
    await card('Zoya Khan');
    expect(sent('deliveries-list')).toHaveLength(3);
  });

  it('lands on the tab named in the address', async () => {
    open = [visit('a', 'Asha Rao'), bag('b', 'Ravi Kumar')];
    serve();
    show('/ops/deliveries?tab=RETURNING');
    await card('Ravi Kumar');
    expect(screen.getByRole('tab', { name: new RegExp(`^${dt.tabs.RETURNING}`) })).toHaveAttribute('aria-selected', 'true');
  });

  it('lands on the bags coming back when nothing waits to go out, and ignores a tab it does not have', async () => {
    open = [visit('o', 'Nita Shah', { status: 'OUT', method: 'OWN', rider: ravi }), bag('b', 'Ravi Kumar')];
    serve();
    show('/ops/deliveries?tab=NOPE');
    await card('Ravi Kumar');
    expect(screen.getByRole('tab', { name: new RegExp(`^${dt.tabs.RETURNING}`) })).toHaveAttribute('aria-selected', 'true');
  });

  it('asks the courier for news once, and only when a courier order is out', async () => {
    open = [visit('p', 'Asha Rao', { status: 'OUT', method: 'PORTER', provider: { key: 'PORTER', orderId: 'CRN1', status: 'BOOKED', raw: null, trackingUrl: null, fareMinor: null, partner: null, error: null } })];
    serve((data) => (data.action === 'deliveries-sync' ? { updated: { p: 'ASSIGNED' }, failed: 0 } : {}));
    show('/ops/deliveries?tab=OUT');
    await card('Asha Rao');
    // The news reloads the list; the reload does not ask the courier again.
    await waitFor(() => expect(sent('deliveries-list')).toHaveLength(2));
    await card('Asha Rao');
    expect(sent('deliveries-sync')).toEqual([expect.objectContaining({ orgId: 'o1', branchId: 'b1', deliveryId: null })]);
  });
});

describe('the waiting counts', () => {
  it('are one request for callers that ask at the same moment, and counted afresh the next time', async () => {
    let waiting = 2;
    serve((data) => (data.action === 'deliveries-counts' ? { requested: waiting, returning: 1 } : {}));
    // The menu and the dashboard ask together when the console opens.
    expect(await Promise.all([deliveryCounts('o1', 'b1'), deliveryCounts('o1', 'b1'), deliveryCounts('o1', 'b2')])).toEqual([
      { requested: 2, returning: 1 },
      { requested: 2, returning: 1 },
      { requested: 2, returning: 1 },
    ]);
    expect(sent('deliveries-counts').map((c) => c.branchId)).toEqual(['b1', 'b2']);
    // Nothing is kept: after a dispatch the next count is the server's.
    waiting = 1;
    expect(await deliveryCounts('o1', 'b1')).toEqual({ requested: 1, returning: 1 });
    expect(sent('deliveries-counts')).toHaveLength(3);
  });
});

describe('dispatching', () => {
  it('opens a pickup at once with no read, starts with the rider used last, and keeps the tab when the last visit goes', async () => {
    const user = userEvent.setup();
    localStorage.setItem('stories.dispatch.o1.b1', JSON.stringify({ method: 'OWN', riderUid: 'ravi' }));
    open = [visit('a', 'Asha Rao', { kind: 'PICKUP', collectTitles: ['Angry River'] })];
    serve();
    show();
    await user.click(within(await card('Asha Rao')).getByRole('button', { name: dt.dispatch }));
    expect(dialog().getByLabelText(dt.rider)).toHaveValue('ravi');
    expect(dialog().getByRole('button', { name: dt.dispatchBtn(0) })).toBeEnabled();
    expect(sent('deliveries-get')).toHaveLength(0);

    await user.selectOptions(dialog().getByLabelText(dt.rider), 'asha');
    open = [bag('b', 'Ravi Kumar')];
    await user.click(dialog().getByRole('button', { name: dt.dispatchBtn(0) }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(sent('deliveries-dispatch')).toEqual([expect.objectContaining({ deliveryId: 'a', barcodes: [], method: 'OWN', riderUid: 'asha', courier: null, waiveFee: false })]);
    expect(sent('deliveries-get')).toHaveLength(0);
    expect(JSON.parse(localStorage.getItem('stories.dispatch.o1.b1')!)).toEqual({ method: 'OWN', riderUid: 'asha' });
    // Nothing waits any more, but the board stays where staff were working.
    expect(await screen.findByText(dt.empty.REQUESTED)).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: new RegExp(`^${dt.tabs.REQUESTED}`) })).toHaveAttribute('aria-selected', 'true');
  });

  it('shows the form of a delivery while its reserved books are read, then adds them to what was scanned', async () => {
    const user = userEvent.setup();
    open = [visit('d', 'Dev Menon', { holdIds: ['h1', 'h2'], holdTitles: ['Angry River', 'Cherry Tree'] })];
    const read = later<unknown>();
    serve((data) => (data.action === 'deliveries-get' ? read.promise : {}));
    show();
    await user.click(within(await card('Dev Menon')).getByRole('button', { name: dt.dispatch }));
    // The whole form is there at once; only the Dispatch button waits for the reserved books.
    expect(dialog().getByLabelText(dt.how)).toBeInTheDocument();
    expect(dialog().getByText(dt.holdsLoading)).toBeInTheDocument();
    expect(dialog().getByRole('button', { name: dt.dispatchBtn(0) })).toBeDisabled();
    const scan = dialog().getByLabelText(dt.scanOut);
    await user.type(scan, 'c-extra{Enter}');
    await user.type(scan, 'C-H1{Enter}');
    await user.click(await dialog().findByRole('button', { name: `${dt.remove} C-H1` }));
    expect(dialog().getByRole('button', { name: dt.dispatchBtn(1) })).toBeDisabled();

    read.settle({ delivery: open[0], memberLoans: [], holds: [{ reservationId: 'h1', bookTitle: 'Angry River', copyCode: 'C-H1' }, { reservationId: 'h2', bookTitle: 'Cherry Tree', copyCode: 'C-H2' }] });
    const go = await dialog().findByRole('button', { name: dt.dispatchBtn(2) });
    await waitFor(() => expect(go).toBeEnabled());
    expect(dialog().queryByText(dt.holdsLoading)).not.toBeInTheDocument();
    expect(dialog().getByText('Cherry Tree')).toBeInTheDocument();
    // The copy staff took off the list stays off.
    expect(dialog().queryByRole('button', { name: `${dt.remove} C-H1` })).not.toBeInTheDocument();
    await user.click(go);
    await waitFor(() => expect(sent('deliveries-dispatch')).toHaveLength(1));
    expect(sent('deliveries-dispatch')[0]).toMatchObject({ deliveryId: 'd', barcodes: ['C-EXTRA', 'C-H2'] });
    expect(sent('deliveries-get')).toHaveLength(1);
  });

  it('lets staff scan and dispatch when the reserved books cannot be read', async () => {
    const user = userEvent.setup();
    open = [visit('d', 'Dev Menon', { note: 'Any two adventure books' })];
    serve((data) => (data.action === 'deliveries-get' ? new FirebaseError('functions/unavailable', 'unavailable') : {}));
    show();
    await user.click(within(await card('Dev Menon')).getByRole('button', { name: dt.dispatch }));
    expect(await dialog().findByText(dt.holdsFailed, { exact: false })).toBeInTheDocument();
    expect(dialog().getByRole('button', { name: t.retry })).toBeInTheDocument();
    expect(dialog().getByLabelText(dt.how)).toBeInTheDocument();
    await user.type(dialog().getByLabelText(dt.scanOut), 'C-1{Enter}');
    expect(await dialog().findByRole('button', { name: dt.dispatchBtn(1) })).toBeEnabled();
    // "Try again" goes away when pressed: focus goes to the scan field, not out of the dialog.
    await user.click(dialog().getByRole('button', { name: t.retry }));
    await waitFor(() => expect(sent('deliveries-get')).toHaveLength(2));
    expect(await dialog().findByRole('button', { name: t.retry })).toBeInTheDocument();
    expect(dialog().getByLabelText(dt.scanOut)).toHaveFocus();
  });

  it('sends the ticked visits with one rider after a confirmation, each as its own call, and marks the one left out', async () => {
    const user = userEvent.setup();
    open = [
      visit('p', 'Asha Rao', { kind: 'PICKUP', collectTitles: ['Angry River'] }),
      visit('h', 'Dev Menon', { holdIds: ['h1'], holdTitles: ['Cherry Tree'] }),
      visit('c', 'Maya Iyer', { holdIds: ['h2'], holdTitles: ['Rusty Runs Away'] }),
      visit('n', 'Nita Shah', { note: 'Any two adventure books' }),
    ];
    const live: Record<string, unknown[]> = {
      h: [{ reservationId: 'h1', bookTitle: 'Cherry Tree', copyCode: 'C-H1' }],
      // Another reserved book became ready since the visit was booked.
      c: [{ reservationId: 'h2', bookTitle: 'Rusty Runs Away', copyCode: 'C-H2' }, { reservationId: 'h9', bookTitle: 'The Night Train', copyCode: 'C-H9' }],
    };
    serve((data) => (data.action === 'deliveries-get' ? { delivery: null, memberLoans: [], holds: live[data.deliveryId as string] } : {}));
    show();
    // A request by note has to be opened: it has no tick box.
    expect(within(await card('Nita Shah')).queryByRole('checkbox')).not.toBeInTheDocument();
    const send = (n: number, rider: string) => screen.getByRole('button', { name: dt.runSend(n, rider) });
    expect(send(0, 'Asha')).toBeDisabled();
    for (const name of ['Asha Rao', 'Dev Menon', 'Maya Iyer']) await user.click(screen.getByRole('checkbox', { name: dt.runTickFor(name) }));
    await user.selectOptions(screen.getByLabelText(dt.runRider), 'ravi');
    await user.click(send(3, 'Ravi'));
    // Nothing goes out before the confirmation, which names the rider and the members.
    expect(sent('deliveries-dispatch')).toHaveLength(0);
    expect(screen.getByRole('dialog', { name: dt.runConfirmTitle(3, 'Ravi') })).toBeInTheDocument();
    for (const name of ['Asha Rao', 'Dev Menon', 'Maya Iyer']) expect(dialog().getByText(name)).toBeInTheDocument();
    open = [open[2], open[3]];
    await user.click(dialog().getByRole('button', { name: dt.runConfirm(3) }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    const dispatched = sent('deliveries-dispatch');
    expect(dispatched.map((c) => c.deliveryId).sort()).toEqual(['h', 'p']);
    expect(dispatched.find((c) => c.deliveryId === 'p')).toMatchObject({ barcodes: [], method: 'OWN', riderUid: 'ravi', courier: null, waiveFee: false });
    expect(dispatched.find((c) => c.deliveryId === 'h')).toMatchObject({ barcodes: ['C-H1'], method: 'OWN', riderUid: 'ravi' });
    expect(new Set(dispatched.map((c) => c.requestId)).size).toBe(2);
    // The pickup reads nothing; the board is read again once, at the end.
    expect(sent('deliveries-get').map((c) => c.deliveryId).sort()).toEqual(['c', 'h']);
    expect(sent('deliveries-list')).toHaveLength(2);
    expect(await screen.findByText(dt.runSome(2, 1))).toBeInTheDocument();
    expect(within(await card('Maya Iyer')).getByText(dt.runNeedsCheck)).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: dt.runTickFor('Maya Iyer') })).toBeChecked();
    expect(JSON.parse(localStorage.getItem('stories.dispatch.o1.b1')!)).toEqual({ method: 'OWN', riderUid: 'ravi' });
  });
});

describe('reporting from the board', () => {
  it('opens the report of a plain delivery with no read, and of a pickup at once while the member’s books arrive', async () => {
    const user = userEvent.setup();
    open = [
      visit('d', 'Dev Menon', { status: 'OUT', method: 'OWN', rider: ravi }),
      visit('p', 'Asha Rao', { kind: 'PICKUP', status: 'OUT', method: 'OWN', rider: ravi, collectLoanIds: ['l1'] }),
    ];
    const read = later<unknown>();
    serve((data) => (data.action === 'deliveries-get' ? read.promise : {}));
    show('/ops/deliveries?tab=OUT');
    await user.click(within(await card('Dev Menon')).getByRole('button', { name: dt.report }));
    expect(dialog().getByLabelText(dt.handedTo)).toBeInTheDocument();
    expect(dialog().queryByText(dt.collectedNow)).not.toBeInTheDocument();
    expect(dialog().getByRole('button', { name: t.save })).toBeEnabled();
    expect(sent('deliveries-get')).toHaveLength(0);
    await user.click(dialog().getByRole('button', { name: t.cancel }));

    await user.click(within(await card('Asha Rao')).getByRole('button', { name: dt.report }));
    expect(dialog().getByLabelText(dt.handedTo)).toBeInTheDocument();
    expect(sent('deliveries-get')).toHaveLength(1);
    // What was collected can't be saved unseen; "couldn't deliver" needs no books.
    expect(dialog().getByRole('button', { name: t.save })).toBeDisabled();
    expect(dialog().queryByText(dt.noLoans)).not.toBeInTheDocument();
    await user.click(dialog().getByRole('radio', { name: dt.notDelivered }));
    expect(dialog().getByRole('button', { name: t.save })).toBeEnabled();
    await user.click(dialog().getByRole('radio', { name: dt.delivered }));
    read.settle({ delivery: open[1], holds: [], memberLoans: [{ loanId: 'l1', copyCode: 'C-1', bookTitle: 'Angry River', deliveryId: null }, { loanId: 'l2', copyCode: 'C-2', bookTitle: 'Sent today', deliveryId: 'p' }] });
    expect(await dialog().findByRole('checkbox', { name: /Angry River/ })).toBeChecked();
    // A book this very visit brought is not offered for collection.
    expect(dialog().queryByRole('checkbox', { name: /Sent today/ })).not.toBeInTheDocument();
    expect(dialog().getByRole('button', { name: t.save })).toBeEnabled();
  });

  it('keeps focus in the report when the member’s books are read again after a failed read', async () => {
    const user = userEvent.setup();
    open = [visit('p', 'Asha Rao', { kind: 'PICKUP', status: 'OUT', method: 'OWN', rider: ravi, collectLoanIds: ['l1'] })];
    let read: () => unknown = () => new FirebaseError('functions/unavailable', 'unavailable');
    serve((data) => (data.action === 'deliveries-get' ? read() : {}));
    show('/ops/deliveries?tab=OUT');
    await user.click(within(await card('Asha Rao')).getByRole('button', { name: dt.report }));
    const retry = await dialog().findByRole('button', { name: t.retry });
    const again = later<unknown>();
    read = () => again.promise;
    await user.click(retry);
    // The button pressed goes away while the books are read: focus is on the group they will appear in.
    await waitFor(() => expect(dialog().queryByRole('button', { name: t.retry })).not.toBeInTheDocument());
    expect(dialog().getByRole('group', { name: dt.collectedNow })).toHaveFocus();
    again.settle({ delivery: open[0], holds: [], memberLoans: [{ loanId: 'l1', copyCode: 'C-1', bookTitle: 'Angry River', deliveryId: null }] });
    expect(await dialog().findByRole('checkbox', { name: /Angry River/ })).toBeChecked();
    expect(dialog().getByRole('group', { name: dt.collectedNow })).toHaveFocus();
  });
});

describe('bags coming back', () => {
  it('receives a rider’s bags together: an unticked bag is left, a failed one stays to be tried again, and the board is read once per go', async () => {
    const user = userEvent.setup();
    open = [bag('a', 'Asha Rao', ravi, 2), bag('b', 'Dev Menon'), bag('c', 'Maya Iyer'), bag('x', 'Nita Shah', { uid: 'asha', name: 'Asha', phone: null })];
    let answerC: () => unknown = () => refusal('COPY_NOT_AVAILABLE', 'That copy is not out on loan.');
    serve((data) => {
      if (data.action !== 'deliveries-receive') return {};
      return data.deliveryId === 'c' ? answerC() : { status: 'COMPLETED', returned: 2 };
    });
    show();
    // One button for the rider with several bags; none for the one with a single bag.
    await user.click(await screen.findByRole('button', { name: dt.receiveAll(3, 'Ravi') }));
    expect(screen.queryByRole('button', { name: /Asha$/ })).not.toBeInTheDocument();
    expect(dialog().getAllByRole('checkbox')).toHaveLength(3);
    expect(dialog().getByText(/Book of Asha Rao \(C-a-0\), Book of Asha Rao \(C-a-1\)/)).toBeInTheDocument();
    await user.click(dialog().getByRole('checkbox', { name: /Dev Menon/ }));
    await user.click(dialog().getByRole('button', { name: dt.receiveBags(2) }));

    expect(await dialog().findByText('That copy is not out on loan.')).toBeInTheDocument();
    const first = sent('deliveries-receive');
    expect(first.map((c) => c.deliveryId).sort()).toEqual(['a', 'c']);
    expect(first[0].requestId).not.toBe(first[1].requestId);
    await waitFor(() => expect(sent('deliveries-list')).toHaveLength(2));
    // Only the bag that failed is left in the dialog, with what was received so far.
    expect(dialog().getAllByRole('checkbox')).toHaveLength(1);
    expect(dialog().getByRole('checkbox', { name: /Maya Iyer/ })).toBeChecked();
    expect(dialog().getByText(dt.receivedBags(1, 2))).toBeInTheDocument();

    // Someone else received it meanwhile: that counts as done.
    answerC = () => refusal('NOT_RETURNING', 'There is nothing to receive for this delivery.');
    await user.click(dialog().getByRole('button', { name: dt.receiveBags(1) }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(sent('deliveries-receive').map((c) => c.deliveryId).sort()).toEqual(['a', 'c', 'c']);
    expect(sent('deliveries-list')).toHaveLength(3);
    expect(screen.getByText(dt.receivedBags(2, 2))).toBeInTheDocument();
  });
});

describe('booking a visit', () => {
  const member = (id: string, fullName: string, extra: Partial<Member> = {}) =>
    ({ id, code: id.toUpperCase(), fullName, address: { line1: '1 Old Street', line2: '', city: 'Bengaluru', state: 'Karnataka', postalCode: '560001' }, ...extra }) as Member;

  it('says at once when the member already has a visit open, and prefills the address of their last visit otherwise', async () => {
    const user = userEvent.setup();
    open = [visit('a', 'Asha Rao', { memberId: 'm1', kind: 'PICKUP' })];
    people = [member('m1', 'Asha Rao')];
    serve();
    show();
    await card('Asha Rao');
    await user.click(screen.getByRole('button', { name: dt.newDelivery }));
    await user.type(dialog().getByLabelText(lt.findMember), 'M1{Enter}');
    expect(await dialog().findByText(dt.alreadyBooked('Asha Rao', dt.kind.PICKUP, '13 Nov 2026'), { exact: false })).toBeInTheDocument();
    expect(memberLoans).not.toHaveBeenCalled();
    expect(memberReservations).not.toHaveBeenCalled();

    people = [member('m2', 'Dev Menon', { deliveryAddress: { ...home, line1: '7 New Road', landmark: 'Blue gate', postalCode: '560045', geo: { lat: 12.9, lng: 77.6 } } })];
    await user.click(dialog().getByRole('button', { name: dt.chooseAnother }));
    // The button pressed is gone: the next card can be scanned or typed without clicking into the field.
    expect(dialog().getByLabelText(lt.findMember)).toHaveFocus();
    await user.keyboard('M2{Enter}');
    expect(await dialog().findByLabelText(dt.address.line1)).toHaveValue('7 New Road');
    expect(dialog().getByLabelText(dt.address.landmark)).toHaveValue('Blue gate');
    expect(dialog().getByLabelText(dt.address.map)).toHaveValue('12.9, 77.6');
    // The branch's PIN codes are checked as the form opens.
    expect(dialog().getByLabelText(dt.address.postalCode)).toHaveAccessibleDescription(dt.address.pinOutside('560045'));
    expect(memberLoans).toHaveBeenCalledTimes(1);
    expect(memberReservations).toHaveBeenCalledTimes(1);
  });
});
