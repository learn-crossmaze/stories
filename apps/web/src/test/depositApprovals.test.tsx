import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FirebaseError } from 'firebase/app';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Adjustment } from '../data/billing';
import { money } from '../shared/format';
import { t } from '../strings';
import { lt } from '../strings/library';

// The deposit approvals queue with the server faked at the Cloud Functions boundary and the list faked in the data layer.
type Sent = { action: string; requestId: string; adjustmentId: string; decision: string; note: string };

const world = vi.hoisted(() => ({
  calls: [] as unknown[],
  /** The server's answer to each decision (a thrown error, a promise to hold it, or a result). */
  respond: (() => ({})) as (data: never) => unknown,
  pending: [] as unknown[],
  reads: 0,
}));
const calls = world.calls as Sent[];

vi.mock('firebase/functions', () => ({
  httpsCallable: () => async (data: Sent) => {
    world.calls.push(data);
    const answer = await world.respond(data as never);
    if (answer instanceof Error) throw answer;
    // Decided on the server: it is no longer pending.
    world.pending = (world.pending as Adjustment[]).filter((a) => a.id !== data.adjustmentId);
    return { data: answer };
  },
}));
vi.mock('../data/services', () => ({ services: () => ({ fns: {}, db: {} }) }));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ claims: { v: 1, sa: true, o: {} }, user: { uid: 'me' } }) }));
vi.mock('../admin/Workspace', () => ({ useWorkspace: () => ({ org: { id: 'o1' }, branchName: () => 'Central' }) }));
vi.mock('../data/billing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../data/billing')>()),
  pendingAdjustments: async () => {
    world.reads++;
    return [...world.pending];
  },
}));

const { DepositApprovalsPage } = await import('../admin/members/DepositApprovals');

/** Oldest first, as the page reads them. */
const adj = (n: number, memberId: string, deltaMinor: number, over: Partial<Adjustment> = {}): Adjustment => ({
  id: `a${n}`, memberId, memberCode: `MEM-${memberId}`, memberName: `Member ${memberId}`, branchId: 'b1', kind: deltaMinor < 0 ? 'DEDUCTION' : 'ADJUSTMENT',
  deltaMinor, reason: `Reason ${n}`, status: 'PENDING', proposedBy: 'someone', proposedByEmail: 'someone@stories.test', createdAt: null, ...over,
});
const refused = (reason: string, message: string) => Object.assign(new FirebaseError('functions/failed-precondition', message), { details: { reason } });
const box = (a: Adjustment) => screen.getByRole('checkbox', { name: lt.selectAdjustment(money(a.deltaMinor), a.memberName) });
/** The page's row of an adjustment (its reason is unique in these tests). */
const rowOf = (a: Adjustment) => screen.getByText(a.reason).closest('tr')!;

async function open() {
  render(
    <MemoryRouter>
      <DepositApprovalsPage />
    </MemoryRouter>,
  );
  await screen.findByRole('heading', { name: lt.approvalsTitle });
  await waitFor(() => expect(world.reads).toBeGreaterThan(0));
  return userEvent.setup();
}

beforeEach(() => {
  calls.length = 0;
  world.respond = () => ({});
  world.pending = [];
  world.reads = 0;
});

describe('deciding one adjustment', () => {
  it('approves without a typed reason: the note is sent empty and the row goes at once', async () => {
    const a = adj(1, 'm1', -25000);
    world.pending = [a, adj(2, 'm2', -5000)];
    const user = await open();
    await user.click(within(await waitFor(() => rowOf(a))).getByRole('button', { name: lt.approve }));
    const dialog = screen.getByRole('dialog', { name: lt.approveTitle(money(-25000), 'Member m1') });
    expect(within(dialog).getByText('Reason 1')).toBeInTheDocument();
    expect(within(dialog).getByLabelText(lt.note)).toHaveValue('');
    await user.click(within(dialog).getByRole('button', { name: lt.approve }));
    await waitFor(() => expect(screen.queryByRole('link', { name: 'Member m1' })).toBeNull());
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ action: 'deposits-decide', orgId: 'o1', adjustmentId: 'a1', decision: 'APPROVE', note: '' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('link', { name: 'Member m2' })).toBeInTheDocument();
  });

  it('sends the note when one is typed', async () => {
    const a = adj(1, 'm1', -25000);
    world.pending = [a];
    const user = await open();
    await user.click(within(await waitFor(() => rowOf(a))).getByRole('button', { name: lt.approve }));
    await user.type(screen.getByLabelText(lt.note), ' Seen the book {Enter}');
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({ decision: 'APPROVE', note: 'Seen the book' });
    expect(await screen.findByText(lt.approvalsEmpty)).toBeInTheDocument();
  });

  it('still needs a reason to reject', async () => {
    const a = adj(1, 'm1', -25000);
    world.pending = [a];
    const user = await open();
    await user.click(within(await waitFor(() => rowOf(a))).getByRole('button', { name: lt.reject }));
    const dialog = screen.getByRole('dialog', { name: lt.rejectTitle(money(-25000), 'Member m1') });
    await user.type(within(dialog).getByLabelText(t.reasonLabel), 'no');
    await user.click(within(dialog).getByRole('button', { name: lt.reject }));
    expect(await within(dialog).findByText(t.required)).toBeInTheDocument();
    expect(calls).toHaveLength(0);
    await user.type(within(dialog).getByLabelText(t.reasonLabel), 't the member’s fault');
    await user.click(within(dialog).getByRole('button', { name: lt.reject }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({ adjustmentId: 'a1', decision: 'REJECT', note: 'not the member’s fault' });
  });

  it('keeps the dialog and the row when the server refuses, and drops a row someone else decided', async () => {
    const [a, b] = [adj(1, 'm1', -25000), adj(2, 'm2', -5000)];
    world.pending = [a, b];
    const user = await open();
    world.respond = () => refused('DEPOSIT_CLOSED', 'The deposit has been settled and the account is closed. Reject this adjustment.');
    await user.click(within(await waitFor(() => rowOf(a))).getByRole('button', { name: lt.approve }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: lt.approve }));
    expect(await within(screen.getByRole('dialog')).findByText(/account is closed/)).toBeInTheDocument();
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: t.cancel }));
    expect(screen.getByRole('link', { name: 'Member m1' })).toBeInTheDocument();

    world.respond = () => refused('ALREADY_DECIDED', 'This adjustment has already been decided.');
    await user.click(within(rowOf(b)).getByRole('button', { name: lt.approve }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: lt.approve }));
    await waitFor(() => expect(screen.queryByRole('link', { name: 'Member m2' })).toBeNull());
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('approving several at once', () => {
  it('cannot select or approve one’s own proposal; "select all" takes the rest', async () => {
    const mine = adj(1, 'm1', -1000, { proposedBy: 'me' });
    const [b, c] = [adj(2, 'm2', -2000), adj(3, 'm3', 3000)];
    world.pending = [mine, b, c];
    const user = await open();
    await waitFor(() => rowOf(mine));
    expect(box(mine)).toBeDisabled();
    expect(within(rowOf(mine)).getByRole('button', { name: lt.approve })).toBeDisabled();
    expect(screen.getByRole('button', { name: lt.approveSelected(0) })).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: lt.selectAllApprovable }));
    expect(box(b)).toBeChecked();
    expect(box(c)).toBeChecked();
    expect(box(mine)).not.toBeChecked();
    expect(screen.getByRole('button', { name: lt.approveSelected(2) })).toBeEnabled();
    await user.click(screen.getByRole('checkbox', { name: lt.selectAllApprovable }));
    expect(box(b)).not.toBeChecked();
  });

  it('lists every row with deductions and credits added up apart, then sends one request each with the shared note', async () => {
    const rows = [adj(1, 'm1', -25000), adj(2, 'm2', -5000), adj(3, 'm3', 4000)];
    world.pending = rows;
    const user = await open();
    await waitFor(() => rowOf(rows[0]));
    await user.click(screen.getByRole('checkbox', { name: lt.selectAllApprovable }));
    await user.click(screen.getByRole('button', { name: lt.approveSelected(3) }));
    const dialog = screen.getByRole('dialog', { name: lt.approveManyTitle(3) });
    for (const a of rows) expect(within(dialog).getByText(a.reason)).toBeInTheDocument();
    expect(within(dialog).getByText(lt.deductionsTotal).nextElementSibling).toHaveTextContent(money(-30000));
    expect(within(dialog).getByText(lt.creditsTotal).nextElementSibling).toHaveTextContent(money(4000));
    const readsBefore = world.reads;
    await user.type(within(dialog).getByLabelText(lt.approveManyNote), 'Month end');
    await user.click(within(dialog).getByRole('button', { name: lt.approveSelected(3) }));

    expect(await screen.findByText(lt.approvalsEmpty)).toBeInTheDocument();
    expect(calls.map((c) => c.adjustmentId).sort()).toEqual(['a1', 'a2', 'a3']);
    for (const c of calls) expect(c).toMatchObject({ action: 'deposits-decide', decision: 'APPROVE', note: 'Month end' });
    expect(new Set(calls.map((c) => c.requestId)).size).toBe(3);
    // The list is read again once, when all are done.
    await waitFor(() => expect(world.reads).toBe(readsBefore + 1));
  });

  it('sends one member’s adjustments one after another, oldest first, and other members alongside', async () => {
    const rows = [adj(1, 'm1', -1000), adj(2, 'm2', -2000), adj(3, 'm1', -3000), adj(4, 'm1', -4000)];
    world.pending = rows;
    const held: Record<string, () => void> = {};
    world.respond = (data: Sent) => new Promise((resolve) => (held[data.adjustmentId] = () => resolve({}))) as never;
    const user = await open();
    await waitFor(() => rowOf(rows[1]));
    await user.click(screen.getByRole('checkbox', { name: lt.selectAllApprovable }));
    await user.click(screen.getByRole('button', { name: lt.approveSelected(4) }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: lt.approveSelected(4) }));

    // m1's first and m2's only one are on their way; m1's later ones wait for the first.
    await waitFor(() => expect(calls.map((c) => c.adjustmentId).sort()).toEqual(['a1', 'a2']));
    expect(screen.getByText(lt.approvingProgress(0, 4))).toBeInTheDocument();
    // Nothing else can be started meanwhile.
    expect(screen.getByRole('button', { name: lt.approveSelected(4) })).toBeDisabled();
    expect(within(rowOf(rows[3])).getByRole('button', { name: lt.reject })).toBeDisabled();
    held.a2();
    await waitFor(() => expect(screen.getByText(lt.approvingProgress(1, 4))).toBeInTheDocument());
    expect(calls).toHaveLength(2);
    held.a1();
    await waitFor(() => expect(calls.map((c) => c.adjustmentId)).toEqual(expect.arrayContaining(['a3'])));
    expect(calls).toHaveLength(3);
    held.a3();
    await waitFor(() => expect(calls).toHaveLength(4));
    expect(calls[3].adjustmentId).toBe('a4');
    held.a4();
    expect(await screen.findByText(lt.approvalsEmpty)).toBeInTheDocument();
  });

  it('keeps a row that failed, with the reason and still selected; one decided elsewhere just goes', async () => {
    const [a, b, c] = [adj(1, 'm1', -90000), adj(2, 'm1', -20000), adj(3, 'm2', -5000)];
    world.pending = [a, b, c];
    world.respond = (data: Sent) =>
      (data.adjustmentId === 'a2'
        ? refused('DEPOSIT_INSUFFICIENT', 'The deposit balance is not enough for this deduction.')
        : data.adjustmentId === 'a3'
          ? refused('ALREADY_DECIDED', 'This adjustment has already been decided.')
          : {}) as never;
    const user = await open();
    await waitFor(() => rowOf(a));
    const readsBefore = world.reads;
    await user.click(screen.getByRole('checkbox', { name: lt.selectAllApprovable }));
    await user.click(screen.getByRole('button', { name: lt.approveSelected(3) }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: lt.approveSelected(3) }));

    expect(await screen.findByText(lt.approvalsNotDone(1))).toBeInTheDocument();
    expect(screen.queryByText('Reason 1')).toBeNull();
    expect(screen.queryByText('Reason 3')).toBeNull();
    expect(within(screen.getByText('Reason 2').closest('tr')!).getByText('The deposit balance is not enough for this deduction.')).toBeInTheDocument();
    expect(box(b)).toBeChecked();
    expect(screen.getByRole('button', { name: lt.approveSelected(1) })).toBeEnabled();
    await waitFor(() => expect(world.reads).toBe(readsBefore + 1));
    // Trying again sends only what is left, as a new request.
    world.respond = () => ({}) as never;
    await user.click(screen.getByRole('button', { name: lt.approveSelected(1) }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: lt.approveSelected(1) }));
    expect(await screen.findByText(lt.approvalsEmpty)).toBeInTheDocument();
    expect(calls.map((c) => c.adjustmentId)).toEqual(expect.arrayContaining(['a1', 'a2', 'a3']));
    expect(calls.filter((c) => c.adjustmentId === 'a2')).toHaveLength(2);
    expect(new Set(calls.map((c) => c.requestId)).size).toBe(4);
  });
});
