import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FirebaseError } from 'firebase/app';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChecklistItem, Employee } from '../data/hr';
import { t } from '../strings';

// The onboarding checklist on an employee profile, with the server faked at the Cloud Functions boundary.
type Sent = { action: string; employeeId: string; key: string; done: boolean; requestId: string };
const calls: Sent[] = [];
/** One per call, in order: the test settles each when it wants the server to answer. */
const answers: { resolve: (v: unknown) => void; reject: (e: Error) => void }[] = [];

vi.mock('firebase/functions', () => ({
  httpsCallable: () => (data: Sent) => {
    calls.push(data);
    return new Promise((resolve, reject) => answers.push({ resolve: (v) => resolve({ data: v }), reject }));
  },
}));
vi.mock('../data/services', () => ({ services: () => ({ fns: {}, db: {} }) }));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ claims: { v: 1, sa: true, o: {} }, user: { uid: 'me' } }) }));
vi.mock('../admin/Workspace', () => ({ useWorkspace: () => ({ org: { id: 'o1', type: 'CORPORATE' }, branches: [], branchName: (id: string) => id }) }));

const { resetBackendState } = await import('../data/api');
const { Checklist } = await import('../admin/people/employeePanels');

const item = (key: string, done = false): ChecklistItem => ({ key, label: `Item ${key}`, required: false, done, doneBy: null, doneAt: null });
const employee = (id: string, done: string[] = []) =>
  ({ id, orgId: 'o1', fullName: 'Asha Rao', onboarding: ['a', 'b', 'c'].map((k) => item(k, done.includes(k))) }) as Employee;
const box = (key: string) => screen.getByRole('checkbox', { name: new RegExp(`Item ${key}`) });
const refusal = () => Object.assign(new FirebaseError('functions/failed-precondition', 'This checklist is closed.'), { details: { reason: 'INVALID_STATE' } });

beforeEach(() => {
  calls.length = 0;
  answers.length = 0;
  resetBackendState();
});

describe('checklist', () => {
  it('takes ticks without waiting, sends them one after another, and refreshes once', async () => {
    const user = userEvent.setup();
    const onChanged = vi.fn();
    const onSaving = vi.fn();
    const { rerender } = render(<Checklist orgId="o1" employee={employee('e1')} list="onboarding" editable onChanged={onChanged} onSaving={onSaving} />);

    await user.click(box('a'));
    await user.click(box('b'));
    // Both show at once and nothing is locked, although the first is still on its way.
    expect(box('a')).toBeChecked();
    expect(box('b')).toBeChecked();
    for (const k of ['a', 'b', 'c']) expect(box(k)).toBeEnabled();
    expect(screen.getByRole('status')).toHaveTextContent(t.saving);
    expect(onSaving.mock.calls).toEqual([[true]]);
    // One at a time: the second waits for the first answer.
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({ action: 'employees-checkItem', employeeId: 'e1', key: 'a', done: true });

    answers[0].resolve({ ok: true });
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1]).toMatchObject({ key: 'b', done: true });
    expect(calls[1].requestId).not.toBe(calls[0].requestId);
    expect(onChanged).not.toHaveBeenCalled();

    answers[1].resolve({ ok: true });
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(onSaving.mock.calls).toEqual([[true], [false]]);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    // Still ticked until the fresh record arrives, and after it.
    expect(box('a')).toBeChecked();
    rerender(<Checklist orgId="o1" employee={employee('e1', ['a', 'b'])} list="onboarding" editable onChanged={onChanged} onSaving={onSaving} />);
    expect(box('a')).toBeChecked();
    expect(box('b')).toBeChecked();
    expect(box('c')).not.toBeChecked();
  });

  it('undoes a refused tick and the ones waiting behind it, says why, and shows what the server has', async () => {
    const user = userEvent.setup();
    const onChanged = vi.fn();
    render(<Checklist orgId="o1" employee={employee('e2')} list="onboarding" editable onChanged={onChanged} />);

    await user.click(box('a'));
    await user.click(box('b'));
    await user.click(box('c'));
    await waitFor(() => expect(calls).toHaveLength(1));
    answers[0].resolve({ ok: true });
    await waitFor(() => expect(calls).toHaveLength(2));
    answers[1].reject(refusal());

    expect(await screen.findByText('This checklist is closed.')).toBeInTheDocument();
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    // The third was never sent.
    expect(calls.map((c) => c.key)).toEqual(['a', 'b']);
    expect(box('a')).toBeChecked();
    expect(box('b')).not.toBeChecked();
    expect(box('c')).not.toBeChecked();

    // Ticking again is a new request, not a replay of the refused one.
    await user.click(box('b'));
    await waitFor(() => expect(calls).toHaveLength(3));
    expect(calls[2].requestId).not.toBe(calls[1].requestId);
    answers[2].resolve({ ok: true });
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(2));
  });

  it('still sends the ticks that were waiting when the tab is left', async () => {
    const user = userEvent.setup();
    const onChanged = vi.fn();
    const onSaving = vi.fn();
    const { unmount } = render(<Checklist orgId="o1" employee={employee('e3')} list="onboarding" editable onChanged={onChanged} onSaving={onSaving} />);

    await user.click(box('a'));
    await user.click(box('b'));
    await waitFor(() => expect(calls).toHaveLength(1));
    unmount();
    answers[0].resolve({ ok: true });
    await waitFor(() => expect(calls).toHaveLength(2));
    answers[1].resolve({ ok: true });
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(onSaving).toHaveBeenLastCalledWith(false);
  });

  it('shows ticks still on their way when the tab is opened again, and waits for all of them', async () => {
    const user = userEvent.setup();
    const record = employee('e5');
    const onChanged = vi.fn();
    const onSaving = vi.fn();
    const first = render(<Checklist orgId="o1" employee={record} list="onboarding" editable onChanged={onChanged} onSaving={onSaving} />);
    await user.click(box('a'));
    await user.click(box('b'));
    await waitFor(() => expect(calls).toHaveLength(1));
    first.unmount();

    // Back on the tab before the answers: the record is the old one, the boxes are not.
    render(<Checklist orgId="o1" employee={record} list="onboarding" editable onChanged={onChanged} onSaving={onSaving} />);
    expect(box('a')).toBeChecked();
    expect(box('b')).toBeChecked();
    expect(screen.getByRole('status')).toHaveTextContent(t.saving);
    expect(onSaving).toHaveBeenLastCalledWith(true);
    await user.click(box('c'));
    expect(box('c')).toBeChecked();

    // The earlier ticks are answered: the one made since still waits behind them, so nothing is called saved yet.
    answers[0].resolve({ ok: true });
    await waitFor(() => expect(calls).toHaveLength(2));
    answers[1].resolve({ ok: true });
    await waitFor(() => expect(calls).toHaveLength(3));
    expect(calls.map((c) => c.key)).toEqual(['a', 'b', 'c']);
    expect(onSaving).not.toHaveBeenCalledWith(false);
    expect(onChanged).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent(t.saving);

    answers[2].resolve({ ok: true });
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(onSaving).toHaveBeenLastCalledWith(false);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    for (const k of ['a', 'b', 'c']) expect(box(k)).toBeChecked();
  });

  it('drops a tick made after the tab was opened again when an earlier one is refused, and says why there', async () => {
    const user = userEvent.setup();
    const record = employee('e6');
    const onChanged = vi.fn();
    const first = render(<Checklist orgId="o1" employee={record} list="onboarding" editable onChanged={onChanged} />);
    await user.click(box('a'));
    await waitFor(() => expect(calls).toHaveLength(1));
    first.unmount();
    render(<Checklist orgId="o1" employee={record} list="onboarding" editable onChanged={onChanged} />);
    await user.click(box('b'));

    answers[0].reject(refusal());
    expect(await screen.findByText('This checklist is closed.')).toBeInTheDocument();
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(calls.map((c) => c.key)).toEqual(['a']);
    expect(box('a')).not.toBeChecked();
    expect(box('b')).not.toBeChecked();
  });

  it('follows a newer record when the tab is opened again after the ticks were saved', async () => {
    const user = userEvent.setup();
    const record = employee('e7');
    const onChanged = vi.fn();
    const first = render(<Checklist orgId="o1" employee={record} list="onboarding" editable onChanged={onChanged} />);
    await user.click(box('a'));
    await waitFor(() => expect(calls).toHaveLength(1));
    first.unmount();
    answers[0].resolve({ ok: true });
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));

    // The same old record: the tick still shows. A newer one (someone unticked it meanwhile) is believed.
    const again = render(<Checklist orgId="o1" employee={record} list="onboarding" editable onChanged={onChanged} />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(box('a')).toBeChecked();
    again.rerender(<Checklist orgId="o1" employee={employee('e7')} list="onboarding" editable onChanged={() => undefined} />);
    expect(box('a')).not.toBeChecked();
  });

  it('cannot be ticked when it is only shown', () => {
    render(<Checklist orgId="o1" employee={employee('e4', ['a'])} list="onboarding" editable={false} onChanged={() => undefined} />);
    for (const k of ['a', 'b', 'c']) expect(box(k)).toBeDisabled();
  });
});
