import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FirebaseError } from 'firebase/app';
import { useState } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Transfer } from '../data/circulation';
import type { Copy } from '../data/inventory';
import { t } from '../strings';
import { lt } from '../strings/library';

// The transfer dialogs, with the server faked at the Cloud Functions boundary and the copy lookup held by the test.
type Sent = Record<string, unknown> & { action: string; requestId: string };
const calls: Sent[] = [];
let respond: (data: Sent) => unknown = () => ({});

vi.mock('firebase/functions', () => ({
  httpsCallable: () => async (data: Sent) => {
    calls.push(data);
    const answer = respond(data);
    if (answer instanceof Error) throw answer;
    return { data: answer };
  },
}));
vi.mock('../data/services', () => ({ services: () => ({ fns: {}, db: {} }) }));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ claims: { v: 1, sa: true, o: {} } }) }));

let branches = [
  { id: 'cen', name: 'Central', status: 'ACTIVE' },
  { id: 'nth', name: 'North', status: 'ACTIVE' },
  { id: 'est', name: 'East', status: 'ACTIVE' },
];
/** The branch the workspace is on. */
let here = { id: 'nth', name: 'North' };
vi.mock('../admin/Workspace', () => ({
  useWorkspace: () => ({
    org: { id: 'o1' },
    branch: here,
    branches,
    branchesLoading: false,
    branchName: (id: string) => branches.find((b) => b.id === id)?.name ?? id,
  }),
}));

/** Lookups the test answers when it chooses, to play a slow connection. */
const lookups: { scanned: string; answer: (copy: Copy | null | Error) => void }[] = [];
let locations: { id: string; code: string; label: string; kind: string; status: string }[] = [];
let incoming: Transfer[] = [];
vi.mock('../data/inventory', () => ({
  findCopy: (_org: string, _branch: string, scanned: string) =>
    new Promise<Copy | null>((resolve, reject) => lookups.push({ scanned, answer: (c) => (c instanceof Error ? reject(c) : resolve(c)) })),
  listLocations: async () => locations,
}));
vi.mock('../data/circulation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../data/circulation')>()),
  listTransfers: async (_org: string, _branch: string, dir: string) => (dir === 'in' ? incoming : []),
}));

const { NewTransferDialog, ReceiveDialog, TransfersPage } = await import('../admin/circulation/Transfers');

const copy = (n: number, extra: Partial<Copy> = {}) =>
  ({ id: `cp${n}`, code: `COPY-${n}`, barcode: `COPY-${n}`, bookTitle: `Book ${n}`, status: 'AVAILABLE', condition: 'NEW', ...extra }) as Copy;
/** Answers the lookup for a scanned value (by default with the copy of that number). */
async function found(scanned: string, result?: Copy | null | Error) {
  const at = lookups.findIndex((l) => l.scanned === scanned);
  expect(at).toBeGreaterThanOrEqual(0);
  const [lookup] = lookups.splice(at, 1);
  lookup.answer(result === undefined ? copy(Number(scanned.split('-')[1])) : result);
  // Let the dialog take the answer in.
  await waitFor(() => expect(screen.queryByText((_, el) => el?.tagName === 'LI' && !!el.textContent?.includes(scanned) && !!el.textContent?.includes(lt.transferChecking))).toBeNull());
}
const scanBox = () => screen.getByLabelText(lt.transferScan);
const dispatchButton = (n: number) => screen.getByRole('button', { name: `${lt.dispatch} ${n}` });
const rows = () => screen.queryAllByRole('listitem').map((li) => li.textContent ?? '');

/** The dialog under a page that re-renders (a new onClose and onSaved each time), as BranchTransfers does. */
function Sender({ onSaved = () => undefined }: { onSaved?: () => void }) {
  const [open, setOpen] = useState(true);
  const [saved, setSaved] = useState(0);
  return (
    <>
      <p>Saved {saved}</p>
      {open && (
        <NewTransferDialog
          orgId="o1"
          fromBranchId="cen"
          onClose={() => setOpen(false)}
          onSaved={() => {
            setSaved((n) => n + 1);
            onSaved();
          }}
        />
      )}
    </>
  );
}

beforeEach(() => {
  calls.length = 0;
  lookups.length = 0;
  respond = () => ({ transferId: 't1' });
  locations = [];
  incoming = [];
  branches = [
    { id: 'cen', name: 'Central', status: 'ACTIVE' },
    { id: 'nth', name: 'North', status: 'ACTIVE' },
    { id: 'est', name: 'East', status: 'ACTIVE' },
  ];
  here = { id: 'nth', name: 'North' };
  localStorage.clear();
});
afterEach(() => vi.restoreAllMocks());

describe('New transfer', () => {
  it('opens on the scan field, with nothing to send yet', () => {
    render(<Sender />);
    expect(scanBox()).toHaveFocus();
    expect(dispatchButton(0)).toBeDisabled();
    expect(screen.getByRole('button', { name: lt.transferAndAnother })).toBeDisabled();
    // Nothing to send is not a save in progress: Cancel works and the button keeps its name.
    expect(screen.getByRole('button', { name: t.cancel })).toBeEnabled();
    expect(screen.queryByRole('button', { name: t.saving })).toBeNull();
    expect(screen.getByLabelText(lt.toBranch)).toHaveValue('nth');
  });

  it('takes the next scan while the last one is still looked up, and lists them in scan order', async () => {
    const user = userEvent.setup();
    render(<Sender />);
    await user.type(scanBox(), 'copy-1{Enter}');
    await user.type(scanBox(), 'COPY-2{Enter}');
    expect(lookups.map((l) => l.scanned)).toEqual(['COPY-1', 'COPY-2']);
    expect(rows()).toHaveLength(2);
    expect(scanBox()).not.toHaveAttribute('readonly');
    // The second answer arrives first.
    await found('COPY-2');
    // One is still being looked up: nothing can be sent yet.
    expect(screen.getByRole('button', { name: `${lt.dispatch} 1` })).toBeDisabled();
    await found('COPY-1');
    expect(rows().map((r) => r.replace(lt.transferRemove, '').trim())).toEqual(['Book 1 COPY-1', 'Book 2 COPY-2']);
    expect(dispatchButton(2)).toBeEnabled();
    expect(scanBox()).toHaveFocus();
    expect(screen.getByText(lt.transferCount(2, 50))).toBeInTheDocument();
  });

  it('sends the copies in one command, already dispatched, and closes', async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    render(<Sender onSaved={onSaved} />);
    await user.selectOptions(screen.getByLabelText(lt.toBranch), 'est');
    await user.type(scanBox(), 'COPY-1{Enter}');
    await found('COPY-1');
    await user.type(scanBox(), 'COPY-2{Enter}');
    await found('COPY-2');
    await user.type(screen.getByLabelText(lt.note), ' For the fair ');
    await user.click(dispatchButton(2));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ action: 'transfers-create', orgId: 'o1', fromBranchId: 'cen', toBranchId: 'est', copyIds: ['cp1', 'cp2'], note: 'For the fair', dispatch: true });
    expect(calls[0]).not.toHaveProperty('barcodes');
    expect(onSaved).toHaveBeenCalledTimes(1);
    // The branch is remembered for the next transfer from here.
    render(<Sender />);
    expect(screen.getByLabelText(lt.toBranch)).toHaveValue('est');
  });

  it('keeps a row that can’t be sent until it is removed, and never sends it', async () => {
    const user = userEvent.setup();
    render(<Sender />);
    await user.type(scanBox(), 'COPY-1{Enter}');
    await found('COPY-1');
    await user.type(scanBox(), 'NOPE-9{Enter}');
    await found('NOPE-9', null);
    await user.type(scanBox(), 'COPY-3{Enter}');
    await found('COPY-3', copy(3, { status: 'ISSUED' }));
    // The warnings stay through later scans.
    await user.type(scanBox(), 'COPY-4{Enter}');
    await found('COPY-4');
    expect(rows()[1]).toContain(lt.copyNotFound);
    expect(rows()[2]).toContain(lt.transferCantSend('Issued'));
    expect(dispatchButton(2)).toBeDisabled();
    expect(screen.getByText(new RegExp(lt.transferFixRows))).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: lt.transferRemoveRow('NOPE-9') }));
    await user.click(screen.getByRole('button', { name: lt.transferRemoveRow('COPY-3') }));
    expect(rows()).toHaveLength(2);
    // Removing a row hands the keyboard back to the scan field.
    expect(scanBox()).toHaveFocus();
    await user.click(dispatchButton(2));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].copyIds).toEqual(['cp1', 'cp4']);
  });

  it('lists a copy once, however it was named, and ignores the answer for a row already removed', async () => {
    const user = userEvent.setup();
    render(<Sender />);
    // The same scan twice is refused straight away.
    await user.type(scanBox(), 'LABEL-7{Enter}');
    await user.type(scanBox(), 'LABEL-7{Enter}');
    expect(lookups).toHaveLength(1);
    expect(screen.getByText(lt.alreadyStaged)).toBeInTheDocument();
    // Its label scanned and its code typed, both still being looked up: one row once they are known.
    await user.type(scanBox(), 'COPY-7{Enter}');
    expect(rows()).toHaveLength(2);
    await found('LABEL-7', copy(7, { barcode: 'LABEL-7' }));
    await found('COPY-7', copy(7, { barcode: 'LABEL-7' }));
    expect(rows()).toHaveLength(1);
    expect(screen.getByText(lt.alreadyStaged)).toBeInTheDocument();
    // Once it is known, its other name is refused without a lookup.
    await user.type(scanBox(), 'COPY-7{Enter}');
    expect(lookups).toHaveLength(0);

    await user.type(scanBox(), 'COPY-8{Enter}');
    await user.click(screen.getByRole('button', { name: lt.transferRemoveRow('COPY-8') }));
    const [late] = lookups.splice(0, 1);
    late.answer(copy(8));
    await Promise.resolve();
    expect(rows()).toHaveLength(1);
    expect(dispatchButton(1)).toBeEnabled();
  });

  it('shows a failed lookup on its row, with a way to try again', async () => {
    const user = userEvent.setup();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(<Sender />);
    await user.type(scanBox(), 'COPY-1{Enter}');
    await found('COPY-1', Object.assign(new Error('offline'), { code: 'unavailable' }));
    expect(rows()[0]).toContain(t.errorNetwork);
    expect(dispatchButton(0)).toBeDisabled();
    await user.click(screen.getByRole('button', { name: t.retry }));
    await found('COPY-1');
    expect(dispatchButton(1)).toBeEnabled();
  });

  it('stops at the number of copies one transfer takes', async () => {
    const user = userEvent.setup();
    render(<Sender />);
    for (let n = 1; n <= 50; n++) {
      await user.click(scanBox());
      await user.paste(`COPY-${n}`);
      await user.keyboard('{Enter}');
    }
    expect(rows()).toHaveLength(50);
    await user.type(scanBox(), 'COPY-51{Enter}');
    expect(rows()).toHaveLength(50);
    expect(lookups).toHaveLength(50);
    expect(screen.getByText(lt.transferFull(50))).toBeInTheDocument();
  });

  it('asks before throwing a scanned list away', async () => {
    const user = userEvent.setup();
    const ask = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<Sender />);
    await user.type(scanBox(), 'COPY-1{Enter}');
    await found('COPY-1');
    await user.keyboard('{Escape}');
    await user.pointer({ keys: '[MouseLeft]', target: document.querySelector('.dialog-backdrop')! });
    await user.click(screen.getByRole('button', { name: t.cancel }));
    expect(ask).toHaveBeenCalledTimes(3);
    expect(ask).toHaveBeenCalledWith(lt.transferDiscard);
    expect(rows()).toHaveLength(1);
    ask.mockReturnValue(true);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closes without asking when nothing was scanned', async () => {
    const user = userEvent.setup();
    const ask = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<Sender />);
    await user.keyboard('{Escape}');
    expect(ask).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('“Dispatch and start another” sends, clears the list, keeps the branch and goes back to the scan field', async () => {
    const user = userEvent.setup();
    render(<Sender />);
    await user.type(scanBox(), 'COPY-1{Enter}');
    await found('COPY-1');
    await user.click(screen.getByRole('button', { name: lt.transferAndAnother }));
    expect(await screen.findByText(lt.transferSent(1, 'North'))).toBeInTheDocument();
    // The page behind re-rendered (onSaved); the dialog is still there and ready for the next box.
    expect(screen.getByText('Saved 1')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(rows()).toHaveLength(0);
    expect(screen.getByLabelText(lt.toBranch)).toHaveValue('nth');
    await waitFor(() => expect(scanBox()).toHaveFocus());
    expect(dispatchButton(0)).toBeDisabled();

    // The next transfer is a new request, and plain Dispatch closes as usual.
    await user.type(scanBox(), 'COPY-2{Enter}');
    await found('COPY-2');
    await user.click(dispatchButton(1));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(calls.map((c) => c.copyIds)).toEqual([['cp1'], ['cp2']]);
    expect(calls[0].requestId).not.toBe(calls[1].requestId);
  });

  it('after a refusal keeps the list, shows what the branch has sent, and the next press is one more create (never a second step)', async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    render(<Sender onSaved={onSaved} />);
    await user.type(scanBox(), 'COPY-1{Enter}');
    await found('COPY-1');
    await user.type(scanBox(), 'COPY-2{Enter}');
    await found('COPY-2');
    respond = () => Object.assign(new FirebaseError('functions/failed-precondition', "Copy COPY-2 is not on this branch's shelf."), { details: { reason: 'COPY_NOT_AVAILABLE' } });
    await user.click(dispatchButton(2));
    expect(await screen.findByText("Copy COPY-2 is not on this branch's shelf.")).toBeInTheDocument();
    // The Outgoing list behind is refreshed: the transfer may have gone through with the answer lost.
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(rows()).toHaveLength(2);

    respond = () => ({ transferId: 't2' });
    await user.click(screen.getByRole('button', { name: lt.transferRemoveRow('COPY-2') }));
    await user.click(dispatchButton(1));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(calls.map((c) => c.action)).toEqual(['transfers-create', 'transfers-create']);
    expect(calls[1].copyIds).toEqual(['cp1']);
    // The list changed, so this is a new request, not a replay of the refused one.
    expect(calls[1].requestId).not.toBe(calls[0].requestId);
  });

  it('keeps a scan out of the branch list: its keys pick nothing there, and a pick with the mouse goes back to the scan field', async () => {
    const user = userEvent.setup();
    render(<Sender />);
    const to = screen.getByLabelText(lt.toBranch);
    // With the keyboard on the list, a browser would pick the branch that starts with the scanned letters, and send on Enter.
    to.focus();
    for (const key of ['C', 'O', '-', '1', ' ', 'Enter']) expect(fireEvent.keyDown(to, { key }), key).toBe(false);
    // Choosing with the keyboard still works.
    for (const key of ['ArrowDown', 'ArrowUp', 'Tab']) expect(fireEvent.keyDown(to, { key }), key).toBe(true);
    expect(fireEvent.keyDown(to, { key: 'r', ctrlKey: true })).toBe(true);
    await user.keyboard('COPY-1{Enter}');
    expect(to).toHaveValue('nth');
    expect(calls).toHaveLength(0);

    // Picked with the mouse: the next scan is listed, not typed into the list.
    await user.selectOptions(to, 'est');
    expect(scanBox()).toHaveFocus();
    await user.keyboard('COPY-1{Enter}');
    await found('COPY-1');
    expect(to).toHaveValue('est');
    expect(rows()).toHaveLength(1);
    // The note is still a place where Enter sends.
    expect(fireEvent.keyDown(screen.getByLabelText(lt.note), { key: 'Enter' })).toBe(true);
  });

  it('names the only other branch instead of offering a choice, and says so when there is none', () => {
    branches = branches.slice(0, 2);
    const { unmount } = render(<Sender />);
    expect(screen.queryByLabelText(lt.toBranch)).toBeNull();
    expect(screen.getByText('North')).toBeInTheDocument();
    expect(scanBox()).toHaveFocus();
    unmount();
    branches = branches.slice(0, 1);
    render(<Sender />);
    expect(screen.getByText(lt.transferNoTargets)).toBeInTheDocument();
    expect(screen.queryByLabelText(lt.transferScan)).toBeNull();
  });
});

const transfer = (): Transfer => ({
  id: 't1',
  fromBranchId: 'cen',
  toBranchId: 'nth',
  status: 'IN_TRANSIT',
  itemCount: 4,
  note: null,
  createdAt: null,
  items: [
    { copyId: 'cp1', code: 'COPY-1', barcode: 'LABEL-1', bookTitle: 'Book 1', received: false, conditionOut: 'NEW', conditionIn: null },
    { copyId: 'cp2', code: 'COPY-2', barcode: 'COPY-2', bookTitle: 'Book 2', received: false, conditionOut: 'GOOD', conditionIn: null },
    // Sent before labels and conditions were kept on the transfer.
    { copyId: 'cp3', code: 'COPY-3', bookTitle: 'Book 3', received: false, conditionIn: null },
    { copyId: 'cp4', code: 'COPY-4', barcode: 'COPY-4', bookTitle: 'Book 4', received: true, conditionOut: 'NEW', conditionIn: 'NEW' },
  ],
});
const receiveScan = () => screen.getByLabelText(lt.arrivalScan);
const tick = (code: string) => screen.getByRole('checkbox', { name: new RegExp(`Book \\d ${code}`) });
const receipt = { transferId: 't1', complete: false, shelved: 0, allocated: [] };

describe('Receive a transfer', () => {
  it('lists what is still to come, refuses a scan that is not part of it, and lets a line be unticked', async () => {
    const user = userEvent.setup();
    render(<ReceiveDialog orgId="o1" transfer={transfer()} onClose={() => undefined} onSaved={() => undefined} />);
    // Three of the four are still on their way.
    expect(screen.getByRole('dialog', { name: lt.arrivalTitle(3) })).toBeInTheDocument();
    expect(receiveScan()).toHaveFocus();
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getByText(lt.arrivalCount(0, 3))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: lt.arrivalSubmit(0) })).toBeDisabled();
    expect(screen.getByRole('button', { name: t.cancel })).toBeEnabled();

    await user.type(receiveScan(), '9780306406157{Enter}');
    expect(screen.getByText(lt.arrivalNotInTransfer('9780306406157'))).toBeInTheDocument();
    expect(screen.getByText(lt.arrivalCount(0, 3))).toBeInTheDocument();
    // Already received in an earlier part: not part of what is left.
    await user.type(receiveScan(), 'COPY-4{Enter}');
    expect(screen.getByText(lt.arrivalNotInTransfer('COPY-4'))).toBeInTheDocument();

    // By its label, by its code, and a second scan of the same book.
    await user.type(receiveScan(), 'label-1{Enter}');
    expect(tick('COPY-1')).toBeChecked();
    expect(screen.queryByText(lt.arrivalNotInTransfer('COPY-4'))).toBeNull();
    await user.type(receiveScan(), 'COPY-1{Enter}');
    expect(screen.getByText(lt.alreadyStaged)).toBeInTheDocument();
    await user.type(receiveScan(), 'COPY-3{Enter}');
    expect(screen.getByText(lt.arrivalCount(2, 3))).toBeInTheDocument();

    await user.click(tick('COPY-3'));
    expect(tick('COPY-3')).not.toBeChecked();
    expect(screen.getByText(lt.arrivalCount(1, 3))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: lt.arrivalSubmit(1) })).toBeEnabled();
  });

  it('sends only what arrived, with a condition only where staff chose one, and a shelf only when one is picked', async () => {
    const user = userEvent.setup();
    locations = [
      { id: 's1', code: 'A-1', label: 'Fiction', kind: 'SHELF', status: 'ACTIVE' },
      { id: 's2', code: 'Z-9', label: 'Closed', kind: 'SHELF', status: 'ARCHIVED' },
    ];
    respond = () => ({ ...receipt, shelved: 2 });
    const onSaved = vi.fn();
    const onClose = vi.fn();
    render(<ReceiveDialog orgId="o1" transfer={transfer()} onClose={onClose} onSaved={onSaved} />);
    await user.type(receiveScan(), 'LABEL-1{Enter}');
    await user.click(tick('COPY-2'));
    await user.click(tick('COPY-3'));
    // The row shows the condition it was sent in, and one that came without is plain "as sent".
    expect(screen.getByLabelText(lt.arrivalConditionOf('COPY-1'))).toHaveDisplayValue(lt.arrivalAsSent('New'));
    expect(screen.getByLabelText(lt.arrivalConditionOf('COPY-3'))).toHaveDisplayValue(lt.arrivalAsSentUnknown);
    await user.selectOptions(screen.getByLabelText(lt.arrivalConditionOf('COPY-2')), 'FAIR');
    await user.click(screen.getByRole('checkbox', { name: lt.arrivalDamagedRow('COPY-3') }));
    const shelf = await screen.findByLabelText(lt.shelveShelf);
    expect(within(shelf).getAllByRole('option').map((o) => o.textContent)).toEqual([lt.noLocation, 'A-1 · Fiction']);
    expect(shelf).toHaveValue('');
    await user.selectOptions(shelf, 's1');
    await user.click(screen.getByRole('button', { name: lt.arrivalSubmit(3) }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ action: 'transfers-receive', orgId: 'o1', transferId: 't1', locationId: 's1' });
    // The label where the transfer has one; no condition on the rows left alone.
    expect(calls[0].items).toEqual([
      { barcode: 'LABEL-1', damaged: false },
      { barcode: 'COPY-2', damaged: false, condition: 'FAIR' },
      { barcode: 'COPY-3', damaged: true },
    ]);
    expect(onSaved).toHaveBeenCalledWith({ ...receipt, shelved: 2 }, 3);
  });

  it('takes the next scan after a line is ticked with the mouse', async () => {
    const user = userEvent.setup();
    locations = [{ id: 's1', code: 'C-1', label: 'Children', kind: 'SHELF', status: 'ACTIVE' }];
    const onClose = vi.fn();
    render(<ReceiveDialog orgId="o1" transfer={transfer()} onClose={onClose} onSaved={() => undefined} />);
    await user.click(tick('COPY-2'));
    // The keyboard is back on the scan field: the scanner's Enter must not press "Receive 1".
    expect(receiveScan()).toHaveFocus();
    await user.keyboard('COPY-3{Enter}');
    expect(tick('COPY-3')).toBeChecked();
    // The same after the other mouse changes on the way.
    await user.selectOptions(screen.getByLabelText(lt.arrivalConditionOf('COPY-2')), 'FAIR');
    expect(receiveScan()).toHaveFocus();
    await user.click(screen.getByRole('checkbox', { name: lt.arrivalDamagedRow('COPY-3') }));
    expect(receiveScan()).toHaveFocus();
    await user.selectOptions(await screen.findByLabelText(lt.shelveShelf), 's1');
    expect(receiveScan()).toHaveFocus();
    await user.click(tick('COPY-3'));
    expect(tick('COPY-3')).not.toBeChecked();
    expect(receiveScan()).toHaveFocus();
    await user.keyboard('LABEL-1{Enter}');
    expect(screen.getByText(lt.arrivalCount(2, 3))).toBeInTheDocument();
    expect(calls).toHaveLength(0);
    expect(onClose).not.toHaveBeenCalled();
    // A finger's tick leaves the scan field alone: focus there would bring up the on-screen keyboard.
    await user.pointer({ keys: '[TouchA]', target: tick('COPY-3') });
    expect(tick('COPY-3')).toBeChecked();
    expect(receiveScan()).not.toHaveFocus();
  });

  it('sends nothing when a scan lands on a tick box or a list, and leaves keyboard users where they are', async () => {
    const user = userEvent.setup();
    locations = [{ id: 's1', code: 'C-1', label: 'Children', kind: 'SHELF', status: 'ACTIVE' }];
    const onClose = vi.fn();
    render(<ReceiveDialog orgId="o1" transfer={transfer()} onClose={onClose} onSaved={() => undefined} />);
    // Ticked with the keyboard: focus stays, so Tab goes on to the line's condition.
    tick('COPY-2').focus();
    await user.keyboard(' ');
    expect(tick('COPY-2')).toBeChecked();
    expect(tick('COPY-2')).toHaveFocus();
    expect(screen.getByRole('button', { name: lt.arrivalSubmit(1) })).toBeEnabled();
    // A scan typed here ends with Enter, which a browser takes as "Receive 1".
    await user.keyboard('COPY-3{Enter}');
    expect(calls).toHaveLength(0);
    const condition = screen.getByLabelText(lt.arrivalConditionOf('COPY-2'));
    const damaged = screen.getByRole('checkbox', { name: lt.arrivalDamagedRow('COPY-2') });
    damaged.focus();
    await user.keyboard('COPY-3{Enter}');
    expect(calls).toHaveLength(0);
    const shelf = await screen.findByLabelText(lt.shelveShelf);
    for (const list of [condition, shelf]) {
      list.focus();
      // "G" would pick Good, and "C" the shelf C-1.
      for (const key of ['G', 'C', '-', '3', 'Enter']) expect(fireEvent.keyDown(list, { key }), key).toBe(false);
      expect(fireEvent.keyDown(list, { key: 'ArrowDown' })).toBe(true);
      await user.keyboard('COPY-3{Enter}');
    }
    expect(calls).toHaveLength(0);
    expect(onClose).not.toHaveBeenCalled();
    expect(tick('COPY-2')).toBeChecked();
    expect(condition).toHaveValue('');
    expect(shelf).toHaveValue('');
    // Space still ticks and unticks.
    damaged.focus();
    await user.keyboard(' ');
    expect(damaged).toBeChecked();
    expect(damaged).toHaveFocus();
  });

  it('sends no shelf when none is picked, and asks before closing over ticked lines', async () => {
    const user = userEvent.setup();
    const ask = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const onClose = vi.fn();
    render(<ReceiveDialog orgId="o1" transfer={transfer()} onClose={onClose} onSaved={() => undefined} />);
    await user.click(tick('COPY-2'));
    await user.keyboard('{Escape}');
    expect(ask).toHaveBeenCalledWith(lt.transferDiscard);
    expect(onClose).not.toHaveBeenCalled();
    respond = () => receipt;
    await user.click(screen.getByRole('button', { name: lt.arrivalSubmit(1) }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(calls[0]).not.toHaveProperty('locationId');
    expect(calls[0].items).toEqual([{ barcode: 'COPY-2', damaged: false }]);
  });

  it('says on the page which books to set aside for members, until it is closed', async () => {
    const user = userEvent.setup();
    incoming = [transfer()];
    respond = () => ({
      transferId: 't1', complete: false, shelved: 0,
      allocated: [
        { code: 'COPY-1', bookTitle: 'Book 1', memberName: 'Ava Rao', memberCode: 'M-0001' },
        { code: 'COPY-2', bookTitle: 'Book 2', memberName: null, memberCode: null },
      ],
    });
    render(
      <MemoryRouter>
        <TransfersPage />
      </MemoryRouter>,
    );
    await user.click(await screen.findByRole('button', { name: lt.receive }));
    await user.click(tick('COPY-1'));
    await user.click(tick('COPY-2'));
    await user.click(screen.getByRole('button', { name: lt.arrivalSubmit(2) }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const note = screen.getByText(new RegExp(lt.arrivalDone(2, 0).replace('.', '\\.'))).closest('.notice') as HTMLElement;
    expect(note).toHaveTextContent(lt.arrivalSetAside);
    // The member is named to staff who may see members; otherwise the book is only marked as held.
    expect(within(note).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Book 1 COPY-1 · Ava Rao (M-0001)', `Book 2 COPY-2 · ${lt.arrivalReserved}`]);
    // It stays while the list behind reloads, and goes when closed.
    expect(await screen.findByRole('button', { name: lt.receive })).toBeInTheDocument();
    expect(note).toBeInTheDocument();
    await user.click(within(note).getByRole('button', { name: t.close }));
    expect(screen.queryByText(lt.arrivalSetAside)).toBeNull();
  });

  it('does not show one branch’s receipt on another branch', async () => {
    const user = userEvent.setup();
    incoming = [transfer()];
    respond = () => ({ transferId: 't1', complete: false, shelved: 0, allocated: [{ code: 'COPY-1', bookTitle: 'Book 1', memberName: 'Ava Rao', memberCode: 'M-0001' }] });
    const page = () => (
      <MemoryRouter>
        <TransfersPage />
      </MemoryRouter>
    );
    const { rerender } = render(page());
    await user.click(await screen.findByRole('button', { name: lt.receive }));
    await user.click(tick('COPY-1'));
    await user.click(screen.getByRole('button', { name: lt.arrivalSubmit(1) }));
    expect(await screen.findByText(lt.arrivalSetAside)).toBeInTheDocument();
    // The workspace moves to another branch with the notice still open.
    here = { id: 'cen', name: 'Central' };
    incoming = [];
    rerender(page());
    expect(await screen.findByText(lt.transfersEmpty)).toBeInTheDocument();
    expect(screen.queryByText(lt.arrivalSetAside)).toBeNull();
    expect(screen.queryByText(/Ava Rao/)).toBeNull();
  });
});
