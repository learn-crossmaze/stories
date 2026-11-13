import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FirebaseError } from 'firebase/app';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Employee } from '../data/hr';
import type { LeaveRequest, LeaveType } from '../data/leave';
import { t } from '../strings';
import { ht } from '../strings/hr';

// The Leave page with the server faked at the Cloud Functions boundary and the lists faked in the data layer.
type Sent = Record<string, unknown> & { action: string; requestId: string };

const world = vi.hoisted(() => ({
  calls: [] as unknown[],
  respond: (() => ({})) as (data: never) => unknown,
  pending: [] as unknown[],
  people: [] as unknown[],
  reads: 0,
}));
const calls = world.calls as Sent[];

vi.mock('firebase/functions', () => ({
  httpsCallable: () => async (data: Sent) => {
    world.calls.push(data);
    const answer = await world.respond(data as never);
    if (answer instanceof Error) throw answer;
    return { data: answer };
  },
}));
vi.mock('../data/services', () => ({ services: () => ({ fns: {}, db: {} }) }));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ claims: { v: 1, sa: true, o: {} }, user: { uid: 'me' } }) }));
vi.mock('../admin/Workspace', () => ({ useWorkspace: () => ({ org: { id: 'o1' }, branchName: () => 'Central' }) }));
vi.mock('../data/hr', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../data/hr')>()),
  listEmployees: async () => [...world.people],
}));
const TYPES = [{ id: 'casual', name: 'Casual leave', code: 'CL', paid: true, annualQuota: 12, accrual: 'MONTHLY', carryForwardMax: 0, allowHalfDay: true, unlimited: false, status: 'ACTIVE' }] as LeaveType[];
vi.mock('../data/leave', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../data/leave')>()),
  pendingLeave: async () => (world.reads++, [...world.pending]),
  balancesFor: async () => [],
  listLeaveTypes: async () => TYPES,
  approvedLeaveIn: async () => [],
}));

const { LeavePage } = await import('../admin/people/Leave');
const { ApplyLeaveDialog } = await import('../admin/people/leaveKit');

const request = (n: number, name: string, over: Partial<LeaveRequest> = {}) =>
  ({ id: `l${n}`, employeeId: `e${n}`, employeeName: name, employeeCode: `E${n}`, employeeUid: `u${n}`, branchId: 'b1', typeId: 'casual', typeName: 'Casual leave', typeCode: 'CL', paid: true, from: `2026-12-0${n}`, to: `2026-12-0${n}`, halfDay: 'NONE', dates: [`2026-12-0${n}`], days: 1, year: '2026', reason: `Reason ${n}`, status: 'PENDING', decidedByEmail: null, decisionNote: null, ...over }) as LeaveRequest;
const refused = (reason: string, message: string) => Object.assign(new FirebaseError('functions/failed-precondition', message), { details: { reason } });
const tick = (r: LeaveRequest) => screen.getByRole('checkbox', { name: ht.selectLeave(r.employeeName, ht.leaveDates(r.from, r.to)) });

const asha = request(1, 'Asha Rao');
const bela = request(2, 'Bela Shah');
const mine = request(3, 'Me Manager', { employeeUid: 'me' });

async function open() {
  render(
    <MemoryRouter>
      <LeavePage />
    </MemoryRouter>,
  );
  await screen.findByRole('heading', { name: ht.navLeave });
  await waitFor(() => expect(world.reads).toBeGreaterThan(0));
  return userEvent.setup();
}

beforeEach(() => {
  calls.length = 0;
  world.respond = () => ({});
  world.pending = [asha, bela, mine];
  world.people = [{ id: 'e1', uid: 'u1', fullName: 'Asha Rao', branchId: 'b1', status: 'ACTIVE' } as Employee];
  world.reads = 0;
});

describe('leave requests', () => {
  it('reads the waiting list once for the tab and its count, and never counts your own request', async () => {
    await open();
    expect(await screen.findByRole('link', { name: 'Bela Shah' })).toBeInTheDocument();
    expect(world.reads).toBe(1);
    expect(screen.getByRole('tab', { name: new RegExp(ht.tabRequests) })).toHaveTextContent(`${ht.tabRequests}2`);
    // Your own request is listed, with nothing to decide or tick.
    const own = screen.getByRole('link', { name: 'Me Manager' }).closest('tr')!;
    expect(within(own).queryByRole('button')).toBeNull();
    expect(within(own).queryByRole('checkbox')).toBeNull();
  });

  it('approving one: the row is busy, goes at once, and the list is read again once', async () => {
    let answer: (v: unknown) => void = () => undefined;
    world.respond = (() => new Promise((resolve) => (answer = resolve))) as never;
    const user = await open();
    await user.click(await screen.findByRole('button', { name: ht.approveLeave('Asha Rao') }));
    const busy = screen.getByRole('button', { name: ht.approveLeave('Asha Rao') });
    expect(busy).toBeDisabled();
    expect(busy).toHaveTextContent(t.saving);
    expect(screen.getByRole('button', { name: ht.rejectLeave('Asha Rao') })).toBeDisabled();
    expect(screen.getByRole('button', { name: ht.approveLeave('Bela Shah') })).toBeEnabled();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ action: 'leave-decide', leaveId: 'l1', decision: 'APPROVE' });

    world.pending = [bela, mine];
    answer({});
    await waitFor(() => expect(screen.queryByRole('link', { name: 'Asha Rao' })).toBeNull());
    await waitFor(() => expect(world.reads).toBe(2));
    expect(screen.getByRole('tab', { name: new RegExp(ht.tabRequests) })).toHaveTextContent(`${ht.tabRequests}1`);
  });

  it('approves the ticked requests side by side; a refused one stays ticked with its reason', async () => {
    const user = await open();
    await screen.findByRole('link', { name: 'Asha Rao' });
    expect(screen.getByRole('button', { name: ht.approveSelected(0) })).toBeDisabled();
    expect(tick(asha)).not.toBeChecked();
    await user.click(screen.getByRole('checkbox', { name: ht.selectAllDecidable }));
    expect(tick(asha)).toBeChecked();
    expect(tick(bela)).toBeChecked();
    world.respond = ((data: Sent) => (data.leaveId === 'l2' ? refused('MONTH_FINALIZED', 'Attendance for 2026-12 is finalized. Ask HR to reopen it.') : {})) as never;
    world.pending = [bela, mine]; // what the list holds once Asha's is approved
    await user.click(screen.getByRole('button', { name: ht.approveSelected(2) }));
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls.map((c) => [c.action, c.leaveId, c.decision])).toEqual([
      ['leave-decide', 'l1', 'APPROVE'],
      ['leave-decide', 'l2', 'APPROVE'],
    ]);
    expect(new Set(calls.map((c) => c.requestId)).size).toBe(2);
    await waitFor(() => expect(screen.queryByRole('link', { name: 'Asha Rao' })).toBeNull());
    expect(screen.getByText('Attendance for 2026-12 is finalized. Ask HR to reopen it.')).toBeInTheDocument();
    expect(screen.getByText(ht.notApproved(1))).toBeInTheDocument();
    expect(tick(bela)).toBeChecked();
    expect(screen.getByRole('button', { name: ht.approveSelected(1) })).toBeEnabled();
    // One more read of the list for the two decisions, and the refusal is still on its row after it.
    await waitFor(() => expect(world.reads).toBe(2));
    expect(screen.getByText('Attendance for 2026-12 is finalized. Ask HR to reopen it.')).toBeInTheDocument();
  });

  it('rejecting still asks for a reason, one request at a time', async () => {
    const user = await open();
    await user.click(await screen.findByRole('button', { name: ht.rejectLeave('Bela Shah') }));
    const dialog = screen.getByRole('dialog', { name: ht.rejectLeaveTitle('Bela Shah') });
    await user.type(within(dialog).getByLabelText(t.reasonLabel), 'No cover that week');
    world.pending = [asha, mine];
    await user.click(within(dialog).getByRole('button', { name: ht.reject }));
    await waitFor(() => expect(screen.queryByRole('link', { name: 'Bela Shah' })).toBeNull());
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ action: 'leave-decide', leaveId: 'l2', decision: 'REJECT', note: 'No cover that week' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('recording leave for someone', () => {
  const record = async (approve: boolean) => {
    const user = await open();
    await user.click(screen.getByRole('tab', { name: ht.tabBalances }));
    await user.click(await screen.findByRole('button', { name: ht.applyLeaveFor('Asha Rao') }));
    const dialog = screen.getByRole('dialog', { name: ht.applyLeaveFor('Asha Rao') });
    const box = within(dialog).getByRole('checkbox', { name: ht.approveNow });
    // Approving in the same step is the person's choice each time.
    expect(box).not.toBeChecked();
    if (approve) await user.click(box);
    await user.type(within(dialog).getByLabelText(ht.leaveReason), 'Called in sick');
    await user.click(within(dialog).getByRole('button', { name: ht.applyOnBehalf }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  };

  it('keeps it waiting unless asked: nothing new is sent, and the waiting list is read again', async () => {
    world.respond = (() => ({ leaveId: 'l9', days: 1, status: 'PENDING' })) as never;
    await record(false);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ action: 'leave-apply', employeeId: 'e1', typeId: 'casual', reason: 'Called in sick' });
    expect('approve' in calls[0]).toBe(false);
    expect(screen.getByText(ht.leaveApplied('1 day'))).toBeInTheDocument();
    await waitFor(() => expect(world.reads).toBe(2));
  });

  it('approves it in the same step when the box is ticked, and says so', async () => {
    world.respond = (() => ({ leaveId: 'l9', days: 2, status: 'APPROVED' })) as never;
    await record(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ action: 'leave-apply', employeeId: 'e1', approve: true });
    expect(screen.getByText(ht.leaveRecordedApproved('2 days'))).toBeInTheDocument();
    // Nothing new waits for a decision.
    expect(world.reads).toBe(1);
  });

  it('is never offered for your own leave', () => {
    render(<ApplyLeaveDialog orgId="o1" types={TYPES} balance={null} onClose={() => undefined} onDone={() => undefined} />);
    expect(screen.getByRole('dialog', { name: ht.applyLeave })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: ht.approveNow })).toBeNull();
  });
});
