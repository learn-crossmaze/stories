import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { ScanInput } from '../admin/components/kit';
import { Dialog, DialogActions } from '../shared/Dialog';
import { t } from '../strings';

describe('dialog focus', () => {
  it('leaves focus where it is when the page behind re-renders with a new onClose', async () => {
    const user = userEvent.setup();
    const closed = vi.fn();
    function Page() {
      const [count, setCount] = useState(0);
      return (
        // A new onClose on every render, as pages write it.
        <Dialog title="New transfer" onClose={() => closed(count)}>
          <select aria-label="To branch">
            <option>Central</option>
          </select>
          <input aria-label="Items" onChange={() => setCount((n) => n + 1)} />
        </Dialog>
      );
    }
    render(<Page />);
    expect(screen.getByLabelText('To branch')).toHaveFocus();
    await user.type(screen.getByLabelText('Items'), 'C-0001');
    expect(screen.getByLabelText('Items')).toHaveFocus();
    expect(screen.getByLabelText('Items')).toHaveValue('C-0001');
    // Escape still reaches the newest onClose.
    await user.keyboard('{Escape}');
    expect(closed).toHaveBeenCalledWith(6);
  });

  it('starts on the control marked data-autofocus instead of the first one', () => {
    render(
      <Dialog title="New transfer" onClose={() => undefined}>
        <select aria-label="To branch">
          <option>Central</option>
        </select>
        <ScanInput label="Items" onScan={() => undefined} autoFocus />
      </Dialog>,
    );
    expect(screen.getByLabelText('Items')).toHaveFocus();
  });

  it('skips a marked control that is disabled', () => {
    render(
      <Dialog title="New transfer" onClose={() => undefined}>
        <input aria-label="Note" />
        <ScanInput label="Items" onScan={() => undefined} autoFocus busy />
      </Dialog>,
    );
    expect(screen.getByLabelText('Note')).toHaveFocus();
  });

  it('returns focus to the button that opened it, even when a field inside focused itself first', async () => {
    const user = userEvent.setup();
    function Page() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            New transfer
          </button>
          {open && (
            <Dialog title="New transfer" onClose={() => setOpen(false)}>
              <ScanInput label="Items" onScan={() => undefined} autoFocus />
            </Dialog>
          )}
        </>
      );
    }
    render(<Page />);
    await user.click(screen.getByRole('button', { name: 'New transfer' }));
    expect(screen.getByLabelText('Items')).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: 'New transfer' })).toHaveFocus();
  });

  it('returns focus to the first opener when one dialog takes over from another', async () => {
    const user = userEvent.setup();
    function Page({ scanFirst }: { scanFirst?: boolean }) {
      const [step, setStep] = useState<'closed' | 'pick' | 'edit'>('closed');
      return (
        <>
          <button type="button" onClick={() => setStep('pick')}>
            Add
          </button>
          {step === 'pick' && (
            <Dialog title="Pick a message" onClose={() => setStep('closed')}>
              <button type="button" onClick={() => setStep('edit')}>
                Welcome
              </button>
            </Dialog>
          )}
          {step === 'edit' && (
            <Dialog title="Edit the message" onClose={() => setStep('closed')}>
              {scanFirst ? <ScanInput label="Text" onScan={() => undefined} autoFocus /> : <input aria-label="Text" />}
            </Dialog>
          )}
        </>
      );
    }
    for (const scanFirst of [false, true]) {
      const { unmount } = render(<Page scanFirst={scanFirst} />);
      await user.click(screen.getByRole('button', { name: 'Add' }));
      await user.click(screen.getByRole('button', { name: 'Welcome' }));
      expect(screen.getByRole('dialog', { name: 'Edit the message' })).toBeInTheDocument();
      expect(screen.getByLabelText('Text')).toHaveFocus();
      await user.keyboard('{Escape}');
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(screen.getByRole('button', { name: 'Add' })).toHaveFocus();
      unmount();
    }
  });

  it('returns focus into the dialog underneath when a second one opened on top of it', async () => {
    const user = userEvent.setup();
    function Page() {
      const [confirm, setConfirm] = useState(false);
      return (
        <Dialog title="Edit" onClose={() => undefined}>
          <button type="button" onClick={() => setConfirm(true)}>
            Delete
          </button>
          {confirm && (
            <Dialog title="Are you sure?" narrow onClose={() => setConfirm(false)}>
              <button type="button">Yes</button>
            </Dialog>
          )}
        </Dialog>
      );
    }
    render(<Page />);
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(screen.getByRole('button', { name: 'Yes' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.getByRole('button', { name: 'Delete' })).toHaveFocus();
  });
});

describe('dialog actions', () => {
  it('can hold back the submit button alone: Cancel stays usable and the label does not say "Saving"', () => {
    render(<DialogActions busy={false} disabled submitLabel="Dispatch 0" onCancel={() => undefined} />);
    expect(screen.getByRole('button', { name: 'Dispatch 0' })).toBeDisabled();
    expect(screen.getByRole('button', { name: t.cancel })).toBeEnabled();
  });

  it('is unchanged without it', () => {
    const { rerender } = render(<DialogActions busy={false} submitLabel="Save" onCancel={() => undefined} />);
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
    rerender(<DialogActions busy submitLabel="Save" onCancel={() => undefined} />);
    expect(screen.getByRole('button', { name: t.saving })).toBeDisabled();
    expect(screen.getByRole('button', { name: t.cancel })).toBeDisabled();
  });
});
