import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FirebaseError } from 'firebase/app';
import { Timestamp } from 'firebase/firestore';
import { useState } from 'react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Plan, Subscription } from '../data/billing';
import type { Member } from '../data/members';
import type { Permission } from '../generated/rbac';
import { money } from '../shared/format';
import type { AsyncState } from '../shared/useAsync';
import { t } from '../strings';
import { lt } from '../strings/library';

// The subscription card of the member page and the desk: selling or renewing a plan and taking the counter
// payment in one step, and the plan chooser opening by itself for a member registered a moment ago.
// The server is faked at the Cloud Functions boundary; plans and the deposit are faked in the data layer.
type Sent = { action: string; requestId: string } & Record<string, unknown>;

const world = vi.hoisted(() => ({
  calls: [] as unknown[],
  respond: (() => ({})) as (data: never) => unknown,
  plans: [] as unknown[],
  deposit: null as unknown,
  planReads: 0,
  depositReads: 0,
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
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ claims: { v: 1, sa: true, o: {} } }) }));
vi.mock('../data/billing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../data/billing')>()),
  listPlans: async () => {
    world.planReads++;
    return world.plans;
  },
  depositAccount: async () => {
    world.depositReads++;
    if (world.deposit instanceof Error) throw world.deposit;
    return world.deposit;
  },
}));

const { SubscriptionCard } = await import('../admin/members/memberCards');

const days = (n: number) => Timestamp.fromMillis(Date.now() + n * 86_400_000);
const plan = (id: string, name: string, over: Partial<Plan> = {}): Plan => ({
  id, name, description: '', options: [{ duration: 'MONTHLY', priceMinor: 30000 }], depositMinor: 100000, maxSimultaneousBooks: 2,
  audiences: ['ADULTS'], deliveryEligible: false, renewalWindowDays: 30, status: 'ACTIVE', version: 1, ...over,
});
const member = (over: Partial<Member> = {}): Member => ({
  id: 'm1', code: 'MEM-0001', fullName: 'Asha Rao', dob: '1990-05-01', audience: 'ADULTS', isMinor: false, phone: null, email: null, address: null,
  homeBranchId: 'b1', status: 'ACTIVE', guardian: null, activeSubscriptionId: null, nextSubscriptionId: null, subscriptionEndsAt: null,
  activeLoanCount: 0, allocatedCount: 0, waitingCount: 0, lifetimeLoans: 0, lifetimeExchanges: 0, ...over,
});
const sub = (over: Partial<Subscription> = {}): Subscription => ({
  id: 's1', memberId: 'm1', planId: 'p2', planVersion: 1,
  planSnapshot: { name: 'Reader', duration: 'QUARTERLY', months: 3, priceMinor: 80000, depositMinor: 100000, maxSimultaneousBooks: 4 },
  kind: 'NEW', status: 'ACTIVE', amountDue: { subscriptionMinor: 80000, depositMinor: 0, totalMinor: 80000 },
  startAt: days(-85), endAt: days(5), exchangesThisTerm: 0, ...over,
});
const ALL: Permission[] = ['subscriptions.manage', 'payments.recordOffline', 'deposits.view'];
const changed = vi.fn();
const opened = vi.fn();

/** The card as a page holds it: the page stops asking for the chooser once it has opened by itself. */
function Card({ m = member(), subs = [], loading = false, perms = ALL, auto = false }: { m?: Member; subs?: Subscription[]; loading?: boolean; perms?: Permission[]; auto?: boolean }) {
  const [autoOpen, setAutoOpen] = useState(auto);
  const [notice, setNotice] = useState('');
  const state: AsyncState<Subscription[]> = { data: loading ? undefined : subs, error: null, loading, refreshing: false, reload: () => undefined };
  return (
    <MemoryRouter>
      <SubscriptionCard
        orgId="o1"
        m={m}
        subs={state}
        perm={(p) => perms.includes(p)}
        canCollectOnline={false}
        onChanged={changed}
        onNotice={setNotice}
        autoOpen={autoOpen}
        onAutoOpened={() => {
          opened();
          setAutoOpen(false);
        }}
      />
      <p>{notice}</p>
    </MemoryRouter>
  );
}
const refused = (message: string) => Object.assign(new FirebaseError('functions/invalid-argument', message), { details: { reason: 'INVALID_INPUT' } });
const pay = (minor: number) => lt.takePayment(money(minor));
const fact = (dialog: HTMLElement, name: string) => within(dialog).getByText(name, { selector: 'dt' }).nextElementSibling;

async function openDialog(user: ReturnType<typeof userEvent.setup>, button = lt.subscribe) {
  await user.click(screen.getByRole('button', { name: button }));
  return screen.getByRole('dialog', { name: button });
}

beforeEach(() => {
  calls.length = 0;
  world.respond = () => ({ subscriptionId: 's9', paymentId: 'pay9' });
  world.plans = [plan('p1', 'Monthly Two')];
  world.deposit = null;
  world.planReads = 0;
  world.depositReads = 0;
  changed.mockReset();
  opened.mockReset();
  localStorage.clear();
});

describe('selling a plan and taking the payment in one step', () => {
  it('shows the fee, the deposit and the total, and takes the payment with the sale', async () => {
    const user = userEvent.setup();
    render(<Card />);
    const dialog = await openDialog(user);
    expect(await within(dialog).findByRole('button', { name: pay(130000) })).toBeEnabled();
    expect(fact(dialog, lt.planFee)).toHaveTextContent(money(30000));
    expect(fact(dialog, lt.depositTopUp)).toHaveTextContent(money(100000));
    expect(fact(dialog, lt.total)).toHaveTextContent(money(130000));

    // UPI, card and bank payments need their reference; nothing is sent without it.
    await user.click(within(dialog).getByRole('button', { name: pay(130000) }));
    expect(await within(dialog).findByText(lt.referenceNeeded)).toBeInTheDocument();
    expect(calls).toHaveLength(0);
    await user.type(within(dialog).getByLabelText(lt.reference), ' UPI123456 ');
    await user.click(within(dialog).getByRole('button', { name: pay(130000) }));

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({
      action: 'subscriptions-create', orgId: 'o1', memberId: 'm1', planId: 'p1', duration: 'MONTHLY',
      payment: { method: 'OFFLINE_UPI', amountMinor: 130000, reference: 'UPI123456' },
    });
    expect(await screen.findByText(lt.paymentRecorded)).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it('charges only the deposit the balance does not cover, and remembers cash for the next sale', async () => {
    const user = userEvent.setup();
    world.deposit = { balanceMinor: 75000, status: 'OPEN' };
    const { unmount } = render(<Card />);
    const dialog = await openDialog(user);
    await within(dialog).findByRole('button', { name: pay(55000) });
    expect(fact(dialog, lt.depositTopUp)).toHaveTextContent(money(25000));
    await user.selectOptions(within(dialog).getByLabelText(lt.paymentMethod), 'OFFLINE_CASH');
    expect(within(dialog).queryByLabelText(lt.reference)).toBeNull();
    await user.click(within(dialog).getByRole('button', { name: pay(55000) }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].payment).toEqual({ method: 'OFFLINE_CASH', amountMinor: 55000, reference: '' });
    unmount();

    render(<Card />);
    const again = await openDialog(user);
    await within(again).findByRole('button', { name: pay(55000) });
    expect(within(again).getByLabelText(lt.paymentMethod)).toHaveValue('OFFLINE_CASH');
  });

  it('starts a renewal on the plan and option the member has, when they are still on offer', async () => {
    const user = userEvent.setup();
    const reader = plan('p2', 'Reader', { options: [{ duration: 'MONTHLY', priceMinor: 30000 }, { duration: 'QUARTERLY', priceMinor: 80000 }] });
    world.plans = [plan('p1', 'Monthly Two'), reader];
    world.deposit = { balanceMinor: 100000, status: 'OPEN' };
    const { unmount } = render(<Card m={member({ activeSubscriptionId: 's1' })} subs={[sub()]} />);
    const dialog = await openDialog(user, lt.renew);
    expect(await within(dialog).findByRole('button', { name: pay(80000) })).toBeEnabled(); // the deposit is already held
    expect(within(dialog).getByRole('radio', { name: /Reader/ })).toBeChecked();
    expect(within(dialog).getByRole('radio', { name: /Quarterly/ })).toBeChecked();
    // Another plan starts on its own first option, not on "quarterly".
    await user.click(within(dialog).getByRole('radio', { name: /Monthly Two/ }));
    expect(within(dialog).getByRole('button', { name: pay(30000) })).toBeEnabled();
    unmount();

    // The old plan is no longer sold: the first plan on offer, as for a new member.
    world.plans = [plan('p1', 'Monthly Two'), { ...reader, status: 'ARCHIVED' }];
    render(<Card m={member({ activeSubscriptionId: null })} subs={[sub({ status: 'EXPIRED', endAt: days(-2) })]} />);
    const fresh = await openDialog(user);
    expect(await within(fresh).findByRole('button', { name: pay(30000) })).toBeEnabled();
    expect(within(fresh).getByRole('radio', { name: /Monthly Two/ })).toBeChecked();
  });

  it('"Save unpaid" keeps the plan waiting for payment, as before', async () => {
    const user = userEvent.setup();
    render(<Card />);
    const dialog = await openDialog(user);
    await user.click(await within(dialog).findByRole('button', { name: lt.saveUnpaid }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({ action: 'subscriptions-create', orgId: 'o1', memberId: 'm1', planId: 'p1', duration: 'MONTHLY' });
    expect(calls[0]).not.toHaveProperty('payment');
    await waitFor(() => expect(changed).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(lt.paymentRecorded)).toBeNull();
  });

  it('people who may not take payments or see deposits keep the two steps, and the deposit is not read', async () => {
    const user = userEvent.setup();
    for (const perms of [['subscriptions.manage', 'deposits.view'], ['subscriptions.manage', 'payments.recordOffline']] as Permission[][]) {
      calls.length = 0;
      const { unmount } = render(<Card perms={perms} />);
      const dialog = await openDialog(user);
      await within(dialog).findByRole('radio', { name: /Monthly Two/ });
      expect(within(dialog).queryByText(lt.total)).toBeNull();
      expect(within(dialog).queryByRole('button', { name: lt.saveUnpaid })).toBeNull();
      await user.click(within(dialog).getByRole('button', { name: t.create }));
      await waitFor(() => expect(calls).toHaveLength(1));
      expect(calls[0]).not.toHaveProperty('payment');
      unmount();
    }
    expect(world.depositReads).toBe(0);
  });

  it('says why when the deposit is being settled or cannot be read, and does not take a payment', async () => {
    const user = userEvent.setup();
    world.deposit = { balanceMinor: 100000, status: 'SETTLING' };
    const { unmount } = render(<Card />);
    const dialog = await openDialog(user);
    expect(await within(dialog).findByText(lt.depositSettling)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: pay(30000) })).toBeDisabled();
    expect(within(dialog).queryByLabelText(lt.paymentMethod)).toBeNull();
    unmount();

    world.deposit = Object.assign(new Error('offline'), { code: 'unavailable' });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(<Card />);
    const unread = await openDialog(user);
    expect(await within(unread).findByText(lt.depositUnread, { exact: false })).toBeInTheDocument();
    expect(within(unread).queryByRole('button', { name: /Take payment/ })).toBeNull();
    await user.click(within(unread).getByRole('button', { name: t.create }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).not.toHaveProperty('payment');
    vi.restoreAllMocks();
  });

  it('when the server says the amount is different, reads the price and deposit again and shows the new total', async () => {
    const user = userEvent.setup();
    world.deposit = { balanceMinor: 100000, status: 'OPEN' };
    render(<Card />);
    const dialog = await openDialog(user);
    await user.selectOptions(await within(dialog).findByLabelText(lt.paymentMethod), 'OFFLINE_CASH');
    // The price went up after the dialog opened.
    world.plans = [plan('p1', 'Monthly Two', { options: [{ duration: 'MONTHLY', priceMinor: 35000 }] })];
    world.respond = () => refused('The amount must be exactly ₹350.00.');
    await user.click(within(dialog).getByRole('button', { name: pay(30000) }));

    expect(await within(dialog).findByText(lt.totalChanged, { exact: false })).toBeInTheDocument();
    expect(await within(dialog).findByRole('button', { name: pay(35000) })).toBeEnabled();
    expect(world.planReads).toBe(2);
    expect(world.depositReads).toBe(2);
    expect(changed).not.toHaveBeenCalled();
    world.respond = () => ({ subscriptionId: 's9', paymentId: 'pay9' });
    await user.click(within(dialog).getByRole('button', { name: pay(35000) }));
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1].payment).toEqual({ method: 'OFFLINE_CASH', amountMinor: 35000, reference: '' });
    expect(calls[1].requestId).not.toBe(calls[0].requestId);
    expect(await screen.findByText(lt.paymentRecorded)).toBeInTheDocument();
  });
});

describe('the plan chooser opening by itself after a registration', () => {
  it('opens once the subscriptions are read, and stays closed after it is closed', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Card auto loading />);
    expect(screen.queryByRole('dialog')).toBeNull();
    rerender(<Card auto />);
    const dialog = await screen.findByRole('dialog', { name: lt.subscribe });
    expect(opened).toHaveBeenCalledTimes(1);
    await user.click(await within(dialog).findByRole('button', { name: t.cancel }));
    expect(screen.queryByRole('dialog')).toBeNull();
    // A later refresh of the page does not bring it back.
    rerender(<Card auto subs={[]} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(opened).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: lt.subscribe })).toBeEnabled();
  });

  it('does not open where the Subscribe button would not show', async () => {
    const cases = [
      <Card key="perm" auto perms={['payments.recordOffline', 'deposits.view']} />,
      <Card key="pending" auto subs={[sub({ status: 'PENDING_PAYMENT' })]} />,
      <Card key="suspended" auto m={member({ status: 'SUSPENDED' })} />,
      <Card key="current" auto m={member({ activeSubscriptionId: 's1' })} subs={[sub()]} />,
    ];
    for (const card of cases) {
      const { unmount } = render(card);
      await new Promise((r) => setTimeout(r, 20));
      expect(screen.queryByRole('dialog')).toBeNull();
      unmount();
    }
    expect(opened).not.toHaveBeenCalled();
  });
});
