import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ScanInput } from '../admin/components/kit';
import { t } from '../strings';

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
