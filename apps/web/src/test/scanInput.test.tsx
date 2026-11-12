import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type ComponentProps, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ScanInput } from '../admin/components/kit';
import { Dialog } from '../shared/Dialog';
import { t } from '../strings';

// The camera is stood in for by a button that "sees" one code.
vi.mock('../admin/components/CameraScanner', () => ({
  CameraScanner: ({ onDetect }: { onDetect: (text: string) => void }) => (
    <button type="button" onClick={() => onDetect('CAM-1')}>
      Camera sees a code
    </button>
  ),
}));

/** A dialog form around the scan box, as in "New transfer" and "Receive". */
function InForm({ onScan, onSubmit }: { onScan: (v: string) => void | Promise<void>; onSubmit: () => void }) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <ScanInput label="Items" onScan={onScan} />
      <button type="submit">Dispatch</button>
    </form>
  );
}

describe('ScanInput', () => {
  it("never submits the form it sits in: a scanner's Enter only adds the code", async () => {
    const user = userEvent.setup();
    const onScan = vi.fn();
    const onSubmit = vi.fn();
    render(<InForm onScan={onScan} onSubmit={onSubmit} />);
    const box = screen.getByLabelText('Items');
    await user.type(box, 'C-0001{Enter}');
    await user.type(box, 'C-0002{Enter}');
    expect(onScan.mock.calls).toEqual([['C-0001'], ['C-0002']]);
    await user.type(box, 'C-0003');
    await user.click(screen.getByRole('button', { name: t.scanAdd }));
    expect(onScan).toHaveBeenLastCalledWith('C-0003');
    expect(onSubmit).not.toHaveBeenCalled();
    expect(box).toHaveFocus();
  });

  it('shows a failed lookup inline and puts the code back to try again', async () => {
    const user = userEvent.setup();
    const onScan = vi.fn().mockRejectedValueOnce(Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' }));
    render(<InForm onScan={onScan} onSubmit={() => undefined} />);
    const box = screen.getByLabelText('Items');
    await user.type(box, 'C-0009{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent(t.errorForbidden);
    expect(screen.queryByText(/insufficient permissions/)).toBeNull();
    expect(box).toHaveValue('C-0009');
    expect(box).toHaveAttribute('aria-invalid', 'true');
    await user.type(box, '{Enter}');
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(onScan).toHaveBeenCalledTimes(2);
    expect(box).toHaveValue('');
  });

  it('is read-only while a scan is being looked up', async () => {
    const user = userEvent.setup();
    let finish!: () => void;
    const onScan = vi.fn(() => new Promise<void>((r) => (finish = r)));
    render(<InForm onScan={onScan} onSubmit={() => undefined} />);
    const box = screen.getByLabelText('Items');
    await user.type(box, 'C-0001{Enter}');
    expect(box).toHaveAttribute('readonly');
    await user.type(box, '{Enter}');
    expect(onScan).toHaveBeenCalledTimes(1);
    finish();
    await waitFor(() => expect(box).not.toHaveAttribute('readonly'));
  });
});

/** Lookups that stay pending until the test settles them, in any order. */
function deferred() {
  const settle: Record<string, { ok: () => void; fail: (e: unknown) => void }> = {};
  const onScan = vi.fn(
    (code: string) =>
      new Promise<void>((ok, fail) => {
        settle[code] = { ok, fail };
      }),
  );
  return { onScan, settle };
}

describe('ScanInput focus options', () => {
  it('leaves focus alone unless asked', () => {
    render(<ScanInput label="Items" onScan={() => undefined} />);
    expect(screen.getByLabelText('Items')).not.toHaveFocus();
    expect(screen.getByLabelText('Items')).not.toHaveAttribute('data-autofocus');
  });

  it('takes focus when it appears with autoFocus, and marks itself as the first focus of its page or dialog', () => {
    render(<ScanInput label="Items" onScan={() => undefined} autoFocus />);
    expect(screen.getByLabelText('Items')).toHaveFocus();
    expect(screen.getByLabelText('Items')).toHaveAttribute('data-autofocus');
  });

  it('takes focus back when the parent changes focusSignal', async () => {
    const user = userEvent.setup();
    function Page() {
      const [signal, setSignal] = useState(0);
      return (
        <>
          <ScanInput label="Items" onScan={() => undefined} focusSignal={signal} />
          <button type="button" onClick={() => setSignal((n) => n + 1)}>
            Shelve
          </button>
        </>
      );
    }
    render(<Page />);
    expect(screen.getByLabelText('Items')).not.toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Shelve' }));
    expect(screen.getByLabelText('Items')).toHaveFocus();
  });

  it('waits for busy to end when focusSignal changes during it', () => {
    const props = { label: 'Items', onScan: () => undefined };
    const { rerender } = render(<ScanInput {...props} busy focusSignal={0} />);
    rerender(<ScanInput {...props} busy focusSignal={1} />);
    expect(screen.getByLabelText('Items')).not.toHaveFocus();
    rerender(<ScanInput {...props} busy={false} focusSignal={1} />);
    expect(screen.getByLabelText('Items')).toHaveFocus();
  });

  it('gets focus back after busy when it had it, and not when focus was somewhere else', async () => {
    const user = userEvent.setup();
    function Page({ busy }: { busy: boolean }) {
      return (
        <>
          <ScanInput label="Items" onScan={() => undefined} busy={busy} />
          <button type="button">Elsewhere</button>
        </>
      );
    }
    const { rerender } = render(<Page busy={false} />);
    const box = screen.getByLabelText('Items');
    await user.click(box);
    rerender(<Page busy />);
    expect(box).toBeDisabled();
    // A browser takes focus off a field that becomes disabled; the test DOM needs it done by hand.
    const other = document.body.appendChild(document.createElement('button'));
    other.focus();
    other.remove();
    expect(document.body).toHaveFocus();
    rerender(<Page busy={false} />);
    expect(box).toHaveFocus();

    await user.click(screen.getByRole('button', { name: 'Elsewhere' }));
    rerender(<Page busy />);
    rerender(<Page busy={false} />);
    expect(screen.getByRole('button', { name: 'Elsewhere' })).toHaveFocus();
  });

  it('keeps a focusSignal asked during busy for the button that was pressed, and drops it when the person moves on', async () => {
    const user = userEvent.setup();
    function Page({ busy, signal }: { busy: boolean; signal: number }) {
      return (
        <>
          <ScanInput label="Items" onScan={() => undefined} busy={busy} focusSignal={signal} />
          <button type="button">Issue</button>
          <button type="button">Elsewhere</button>
        </>
      );
    }
    const { rerender } = render(<Page busy={false} signal={0} />);
    const box = screen.getByLabelText('Items');
    // Focus is still on the pressed button when the save ends: the field takes it, as asked.
    await user.click(screen.getByRole('button', { name: 'Issue' }));
    rerender(<Page busy signal={0} />);
    rerender(<Page busy signal={1} />);
    rerender(<Page busy={false} signal={1} />);
    expect(box).toHaveFocus();

    // The person went to another control while the save ran: focus stays with them.
    await user.click(screen.getByRole('button', { name: 'Issue' }));
    rerender(<Page busy signal={1} />);
    rerender(<Page busy signal={2} />);
    await user.click(screen.getByRole('button', { name: 'Elsewhere' }));
    rerender(<Page busy={false} signal={2} />);
    expect(screen.getByRole('button', { name: 'Elsewhere' })).toHaveFocus();
  });

  it('never takes focus from a dialog that has opened over it', async () => {
    const user = userEvent.setup();
    const { onScan, settle } = deferred();
    function Page({ busy = false, signal = 0, dialog = false }: { busy?: boolean; signal?: number; dialog?: boolean }) {
      return (
        <>
          <ScanInput label="Items" onScan={onScan} busy={busy} focusSignal={signal} />
          {dialog && (
            <Dialog title="Renew" onClose={() => undefined}>
              <p>Plan ended</p>
              <button type="button">Pay</button>
            </Dialog>
          )}
        </>
      );
    }
    const { rerender } = render(<Page />);
    const box = screen.getByLabelText('Items');
    const inDialog = () => expect(screen.getByRole('dialog').contains(document.activeElement) || document.activeElement === document.body).toBe(true);

    // The dialog opens during a save that began with focus in the field; then the save ends.
    await user.click(box);
    rerender(<Page busy />);
    rerender(<Page busy dialog />);
    expect(screen.getByRole('button', { name: 'Pay' })).toHaveFocus();
    // Even with focus on nothing (a click on the dialog's text), which the field would otherwise take as its own.
    (document.activeElement as HTMLElement).blur();
    rerender(<Page dialog />);
    expect(box).not.toHaveFocus();
    inDialog();

    // The page asks for focus while the dialog is open.
    rerender(<Page dialog signal={1} />);
    expect(box).not.toHaveFocus();

    // A lookup that began before the dialog ends under it.
    rerender(<Page signal={1} />);
    await user.type(box, 'C-0001{Enter}');
    rerender(<Page signal={1} dialog />);
    screen.getByRole('button', { name: 'Pay' }).focus();
    settle['C-0001'].ok();
    await waitFor(() => expect(box).not.toHaveAttribute('readonly'));
    expect(screen.getByRole('button', { name: 'Pay' })).toHaveFocus();
  });

  it('still takes focus inside its own dialog', async () => {
    const user = userEvent.setup();
    function Box() {
      const [signal, setSignal] = useState(0);
      return (
        <Dialog title="New transfer" onClose={() => undefined}>
          <button type="button" onClick={() => setSignal((n) => n + 1)}>
            Remove
          </button>
          <ScanInput label="Items" onScan={() => undefined} focusSignal={signal} />
        </Dialog>
      );
    }
    render(<Box />);
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    expect(screen.getByLabelText('Items')).toHaveFocus();
  });
});

describe('ScanInput queue mode', () => {
  it('stays open during a lookup and hands later scans over in order, one at a time', async () => {
    const user = userEvent.setup();
    const { onScan, settle } = deferred();
    render(<ScanInput label="Items" onScan={onScan} queue />);
    const box = screen.getByLabelText('Items');
    await user.type(box, 'C-0001{Enter}');
    expect(box).not.toHaveAttribute('readonly');
    await user.type(box, 'C-0002{Enter}');
    await user.type(box, 'C-0003');
    // The Add button stays usable while the first lookup runs.
    await user.click(screen.getByRole('button', { name: t.scanAdd }));
    expect(box).toHaveValue('');
    expect(box).toHaveFocus();
    expect(onScan.mock.calls).toEqual([['C-0001']]);
    settle['C-0001'].ok();
    await waitFor(() => expect(onScan.mock.calls).toEqual([['C-0001'], ['C-0002']]));
    settle['C-0002'].ok();
    await waitFor(() => expect(onScan.mock.calls).toEqual([['C-0001'], ['C-0002'], ['C-0003']]));
    settle['C-0003'].ok();
    await waitFor(() => expect(box.closest('.scan')).not.toHaveAttribute('aria-busy'));
  });

  it('gives a waiting scan to the handler of the latest render, not the one the queue started with', async () => {
    const user = userEvent.setup();
    const first = deferred();
    const later = vi.fn();
    const { rerender } = render(<ScanInput label="Items" onScan={first.onScan} queue />);
    const box = screen.getByLabelText('Items');
    await user.type(box, 'C-0001{Enter}');
    await user.type(box, 'C-0002{Enter}');
    rerender(<ScanInput label="Items" onScan={later} queue />);
    first.settle['C-0001'].ok();
    await waitFor(() => expect(later).toHaveBeenCalledWith('C-0002'));
    expect(first.onScan).toHaveBeenCalledTimes(1);
  });

  it('lists a failed code as "CODE: message", never puts it back, and keeps it while scanning goes on', async () => {
    const user = userEvent.setup();
    const { onScan, settle } = deferred();
    render(<ScanInput label="Items" onScan={onScan} queue />);
    const box = screen.getByLabelText('Items');
    await user.type(box, 'C-0009{Enter}');
    await user.type(box, 'C-0010{Enter}');
    settle['C-0009'].fail(Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(`C-0009: ${t.errorForbidden}`);
    expect(box).toHaveValue('');
    expect(box).not.toHaveAttribute('aria-invalid', 'true');
    await waitFor(() => expect(onScan).toHaveBeenCalledTimes(2));
    settle['C-0010'].ok();
    await waitFor(() => expect(box.closest('.scan')).not.toHaveAttribute('aria-busy'));
    expect(screen.getByRole('alert')).toHaveTextContent('C-0009');

    // Scanned again and found: its line goes.
    await user.type(box, 'C-0009{Enter}');
    settle['C-0009'].ok();
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });

  it('clears the failed list on request and returns to the field', async () => {
    const user = userEvent.setup();
    const onScan = vi.fn().mockRejectedValue(new Error('offline'));
    const report = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(<ScanInput label="Items" onScan={onScan} queue />);
    const box = screen.getByLabelText('Items');
    await user.type(box, 'C-0001{Enter}');
    await user.type(box, 'C-0002{Enter}');
    await waitFor(() => expect(screen.getAllByRole('alert')).toHaveLength(2));
    await user.click(screen.getByRole('button', { name: t.scanClearFailed }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(box).toHaveFocus();
    report.mockRestore();
  });

  it('says how many scans are still being looked up, and tells the page so it can hold its confirm button', async () => {
    const user = userEvent.setup();
    const { onScan, settle } = deferred();
    const counts: number[] = [];
    function Page() {
      const [pending, setPending] = useState(0);
      return (
        <>
          <ScanInput
            label="Items"
            onScan={onScan}
            queue
            onPendingChange={(n) => {
              counts.push(n);
              setPending(n);
            }}
          />
          <button type="button" disabled={pending > 0}>
            Issue
          </button>
        </>
      );
    }
    render(<Page />);
    const box = screen.getByLabelText('Items');
    const issue = screen.getByRole('button', { name: 'Issue' });
    expect(screen.queryByRole('status')).toBeNull();
    expect(issue).toBeEnabled();
    await user.type(box, 'C-0001{Enter}');
    expect(screen.getByRole('status')).toHaveTextContent(t.scanLookingUp(1));
    expect(issue).toBeDisabled();
    await user.type(box, 'C-0002{Enter}C-0003{Enter}');
    expect(screen.getByRole('status')).toHaveTextContent(t.scanLookingUp(3));
    settle['C-0001'].ok();
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(t.scanLookingUp(2)));
    expect(issue).toBeDisabled();
    settle['C-0002'].ok();
    await waitFor(() => expect(onScan).toHaveBeenCalledTimes(3));
    settle['C-0003'].ok();
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
    expect(issue).toBeEnabled();
    expect(counts).toEqual([1, 2, 3, 2, 1, 0]);
  });

  it('reports 1 then 0 for a lookup in the default mode, without the status line', async () => {
    const user = userEvent.setup();
    const { onScan, settle } = deferred();
    const onPendingChange = vi.fn();
    render(<ScanInput label="Items" onScan={onScan} onPendingChange={onPendingChange} />);
    await user.type(screen.getByLabelText('Items'), 'C-0001{Enter}');
    expect(screen.queryByRole('status')).toBeNull();
    expect(onPendingChange.mock.calls).toEqual([[1]]);
    settle['C-0001'].ok();
    await waitFor(() => expect(onPendingChange.mock.calls).toEqual([[1], [0]]));
  });

  it('drops what is still waiting when the field goes away, and the page hears 0 once the running lookup ends', async () => {
    const user = userEvent.setup();
    const { onScan, settle } = deferred();
    const onPendingChange = vi.fn();
    const { unmount } = render(<ScanInput label="Items" onScan={onScan} queue onPendingChange={onPendingChange} />);
    await user.type(screen.getByLabelText('Items'), 'C-0001{Enter}C-0002{Enter}');
    expect(onPendingChange).toHaveBeenLastCalledWith(2);
    unmount();
    settle['C-0001'].ok();
    await waitFor(() => expect(onPendingChange).toHaveBeenLastCalledWith(0));
    expect(onScan.mock.calls).toEqual([['C-0001']]);
  });

  it("still never submits the form it sits in, and a camera read during a lookup is dropped, not queued", async () => {
    const user = userEvent.setup();
    const { onScan, settle } = deferred();
    const onSubmit = vi.fn();
    render(
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
      >
        <ScanInput label="Items" onScan={onScan} queue />
        <button type="submit">Dispatch</button>
      </form>,
    );
    const box = screen.getByLabelText('Items');
    await user.type(box, 'C-0001{Enter}');
    await user.type(box, '{Enter}');
    await user.click(screen.getByRole('button', { name: 'Scan with the camera' }));
    await user.click(screen.getByRole('button', { name: 'Camera sees a code' }));
    settle['C-0001'].ok();
    await waitFor(() => expect(box.closest('.scan')).not.toHaveAttribute('aria-busy'));
    expect(onScan.mock.calls).toEqual([['C-0001']]);
    await user.click(screen.getByRole('button', { name: 'Camera sees a code' }));
    expect(onScan).toHaveBeenLastCalledWith('CAM-1');
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe('ScanInput Enter in the empty field', () => {
  // Time stands still unless the test moves it: a scanner's keys arrive within a moment, a person's Enter later.
  let now = 1_000_000;
  const clock = () => vi.spyOn(Date, 'now').mockImplementation(() => now);
  const pause = () => (now += 1000);
  afterEach(() => vi.restoreAllMocks());

  function setup(props: Partial<ComponentProps<typeof ScanInput>> = {}) {
    clock();
    const onEmptyEnter = vi.fn();
    const onScan = props.onScan ?? vi.fn();
    render(<ScanInput label="Items" onScan={onScan} onEmptyEnter={onEmptyEnter} {...props} />);
    return { user: userEvent.setup(), box: screen.getByLabelText('Items'), onEmptyEnter, onScan };
  }

  it('calls onEmptyEnter when the field is empty and idle', async () => {
    const { user, box, onEmptyEnter, onScan } = setup();
    await user.click(box);
    pause();
    await user.keyboard('{Enter}');
    expect(onEmptyEnter).toHaveBeenCalledTimes(1);
    expect(onScan).not.toHaveBeenCalled();
  });

  it('does nothing on an empty Enter when the option is not used', async () => {
    clock();
    const user = userEvent.setup();
    const onScan = vi.fn();
    render(<ScanInput label="Items" onScan={onScan} />);
    await user.click(screen.getByLabelText('Items'));
    pause();
    await user.keyboard('{Enter}');
    expect(onScan).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('scans, and does not confirm, when the field holds a code', async () => {
    const { user, box, onEmptyEnter, onScan } = setup();
    await user.click(box);
    pause();
    await user.keyboard('C-0001{Enter}');
    expect(onScan).toHaveBeenCalledWith('C-0001');
    expect(onEmptyEnter).not.toHaveBeenCalled();
  });

  it("ignores a scanner's second Enter (CR+LF) and an Enter that arrives with the focus", async () => {
    const { user, box, onEmptyEnter } = setup();
    // Focus has only just arrived.
    await user.click(box);
    await user.keyboard('{Enter}');
    expect(onEmptyEnter).not.toHaveBeenCalled();
    pause();
    // The handler answers at once, so nothing is in flight when the second Enter lands.
    await user.keyboard('C-0001{Enter}{Enter}');
    expect(onEmptyEnter).not.toHaveBeenCalled();
    pause();
    await user.keyboard('{Enter}');
    expect(onEmptyEnter).toHaveBeenCalledTimes(1);
  });

  it('ignores a held-down Enter', async () => {
    const { user, box, onEmptyEnter } = setup();
    await user.click(box);
    pause();
    fireEvent.keyDown(box, { key: 'Enter', repeat: true });
    expect(onEmptyEnter).not.toHaveBeenCalled();
  });

  it('does not confirm while a scan is looked up; keys lost meanwhile are reported as soon as that lookup ends', async () => {
    const { onScan, settle } = deferred();
    const { user, box, onEmptyEnter } = setup({ onScan });
    await user.click(box);
    pause();
    await user.keyboard('C-0001{Enter}');
    expect(box).toHaveAttribute('readonly');
    pause();
    // The next book is scanned into the read-only field: its characters are lost and its Enter must not confirm.
    await user.keyboard('C-0002{Enter}');
    expect(onEmptyEnter).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).toBeNull();
    settle['C-0001'].ok();
    await waitFor(() => expect(box).not.toHaveAttribute('readonly'));
    // Said at once, before any Enter.
    expect(screen.getByRole('alert')).toHaveTextContent(t.scanMissed);
    expect(box).toHaveAccessibleDescription(t.scanMissed);
    // The first Enter only takes note of the message, which stays; the next one confirms and clears it.
    pause();
    await user.keyboard('{Enter}');
    expect(onEmptyEnter).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(t.scanMissed);
    expect(onScan).toHaveBeenCalledTimes(1);
    pause();
    await user.keyboard('{Enter}');
    expect(onEmptyEnter).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('forgets the lost scan once it is scanned again: the next Enter confirms at the first press', async () => {
    const { onScan, settle } = deferred();
    const { user, box, onEmptyEnter } = setup({ onScan });
    await user.click(box);
    pause();
    await user.keyboard('C-0001{Enter}');
    await user.keyboard('C-0002{Enter}');
    settle['C-0001'].ok();
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(t.scanMissed));
    pause();
    await user.keyboard('C-0002{Enter}');
    expect(screen.queryByRole('alert')).toBeNull();
    settle['C-0002'].ok();
    await waitFor(() => expect(box).not.toHaveAttribute('readonly'));
    expect(screen.queryByRole('alert')).toBeNull();
    pause();
    await user.keyboard('{Enter}');
    expect(onEmptyEnter).toHaveBeenCalledTimes(1);
  });

  it("does not let the lost scan's own Enter, landing just after the lookup ends, take note of the message", async () => {
    const { onScan, settle } = deferred();
    const { user, box, onEmptyEnter } = setup({ onScan });
    await user.click(box);
    pause();
    await user.keyboard('C-0001{Enter}');
    await user.keyboard('C-0002');
    settle['C-0001'].ok();
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(t.scanMissed));
    // No time has passed: this is the scanner finishing C-0002.
    await user.keyboard('{Enter}');
    pause();
    await user.keyboard('{Enter}');
    expect(onEmptyEnter).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(t.scanMissed);
    pause();
    await user.keyboard('{Enter}');
    expect(onEmptyEnter).toHaveBeenCalledTimes(1);
  });

  it('shows the failed lookup and the lost scan together', async () => {
    const { onScan, settle } = deferred();
    const { user, box } = setup({ onScan });
    await user.click(box);
    await user.keyboard('C-0009{Enter}');
    await user.keyboard('C-0010{Enter}');
    settle['C-0009'].fail(Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' }));
    await waitFor(() => expect(screen.getAllByRole('alert')).toHaveLength(2));
    expect(box).toHaveValue('C-0009');
    expect(box).toHaveAccessibleDescription(`${t.errorForbidden} ${t.scanMissed}`);
  });

  it('says nothing about lost keys on pages that do not confirm with Enter', async () => {
    const user = userEvent.setup();
    const { onScan, settle } = deferred();
    render(<ScanInput label="Items" onScan={onScan} />);
    const box = screen.getByLabelText('Items');
    await user.type(box, 'C-0001{Enter}');
    await user.keyboard('C-0002{Enter}');
    settle['C-0001'].ok();
    await waitFor(() => expect(box).not.toHaveAttribute('readonly'));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('does not confirm while scans are still waiting in queue mode', async () => {
    const { onScan, settle } = deferred();
    const { user, box, onEmptyEnter } = setup({ onScan, queue: true });
    await user.click(box);
    pause();
    await user.keyboard('C-0001{Enter}C-0002{Enter}');
    pause();
    await user.keyboard('{Enter}');
    settle['C-0001'].ok();
    await waitFor(() => expect(onScan).toHaveBeenCalledTimes(2));
    pause();
    await user.keyboard('{Enter}');
    expect(onEmptyEnter).not.toHaveBeenCalled();
    settle['C-0002'].ok();
    await waitFor(() => expect(box.closest('.scan')).not.toHaveAttribute('aria-busy'));
    pause();
    await user.keyboard('{Enter}');
    expect(onEmptyEnter).toHaveBeenCalledTimes(1);
  });
});

