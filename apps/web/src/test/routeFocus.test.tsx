import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type ReactNode, useEffect, useState } from 'react';
import { createMemoryRouter, Link, Outlet, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';

import { ScanInput } from '../admin/components/kit';
import { Dialog } from '../shared/Dialog';
import { useRouteFocus } from '../shared/useRouteFocus';

function Frame() {
  useRouteFocus('main');
  return (
    <>
      <Link to="/b">Go to B</Link>
      <main id="main">
        <Outlet />
      </main>
    </>
  );
}

/** Shows its children a moment later, as a page does once its data has loaded. */
function Late({ children, after = 150 }: { children: ReactNode; after?: number }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setReady(true), after);
    return () => window.clearTimeout(timer);
  }, [after]);
  return ready ? <>{children}</> : null;
}

function open(pageB: ReactNode, start = '/a') {
  const router = createMemoryRouter(
    [
      {
        element: <Frame />,
        children: [
          { path: '/a', element: <h1>Page A</h1> },
          { path: '/b', element: pageB },
        ],
      },
    ],
    { initialEntries: [start] },
  );
  render(<RouterProvider router={router} />);
  return userEvent.setup();
}
const goToB = (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getByRole('link', { name: 'Go to B' }));
const later = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('route focus: a page that names its first field', () => {
  it('focuses the field marked data-autofocus instead of the heading, and still names the tab', async () => {
    const user = open(
      <>
        <h1>Receive books</h1>
        <input aria-label="Shelf" />
        <input aria-label="ISBN, row 1" data-autofocus />
      </>,
    );
    await goToB(user);
    await waitFor(() => expect(screen.getByLabelText('ISBN, row 1')).toHaveFocus());
    expect(document.title).toBe('Receive books · Stories');
  });

  it('does the same for a scan field with autoFocus', async () => {
    const user = open(
      <>
        <h1>Desk</h1>
        <ScanInput label="Member" onScan={() => undefined} autoFocus />
      </>,
    );
    await goToB(user);
    await waitFor(() => expect(document.title).toBe('Desk · Stories'));
    expect(screen.getByLabelText('Member')).toHaveFocus();
  });

  it('focuses the field on the first load too', async () => {
    open(
      <>
        <h1>Receive books</h1>
        <input aria-label="ISBN, row 1" data-autofocus />
      </>,
      '/b',
    );
    await waitFor(() => expect(screen.getByLabelText('ISBN, row 1')).toHaveFocus());
    expect(document.title).toBe('Receive books · Stories');
  });

  it('moves on from the heading to a field that appears a moment later', async () => {
    const user = open(
      <>
        <h1>Receive books</h1>
        <Late>
          <input aria-label="ISBN, row 1" data-autofocus />
        </Late>
      </>,
    );
    await goToB(user);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Receive books' })).toHaveFocus());
    await waitFor(() => expect(screen.getByLabelText('ISBN, row 1')).toHaveFocus());
  });

  it('leaves focus alone when the person moved it before the field appeared', async () => {
    const user = open(
      <>
        <h1>Receive books</h1>
        <input aria-label="Shelf" />
        <Late>
          <input aria-label="ISBN, row 1" data-autofocus />
        </Late>
      </>,
    );
    await goToB(user);
    await user.click(screen.getByLabelText('Shelf'));
    await screen.findByLabelText('ISBN, row 1');
    await later(250);
    expect(screen.getByLabelText('Shelf')).toHaveFocus();
  });

  it('on the first load, leaves focus alone when the person is already somewhere else', async () => {
    open(
      <Late>
        <h1>Receive books</h1>
        <input aria-label="ISBN, row 1" data-autofocus />
      </Late>,
      '/b',
    );
    screen.getByRole('link', { name: 'Go to B' }).focus();
    await waitFor(() => expect(document.title).toBe('Receive books · Stories'));
    await later(250);
    expect(screen.getByRole('link', { name: 'Go to B' })).toHaveFocus();
  });

  it('skips a marked field that is disabled', async () => {
    const user = open(
      <>
        <h1>Receive books</h1>
        <input aria-label="ISBN, row 1" data-autofocus disabled />
        <input aria-label="ISBN, row 2" data-autofocus />
      </>,
    );
    await goToB(user);
    await waitFor(() => expect(screen.getByLabelText('ISBN, row 2')).toHaveFocus());
  });

  it('does not treat a plain autoFocus as the page naming its field: the heading is still announced', async () => {
    const user = open(
      <>
        <h1>Members</h1>
        <input aria-label="Search members" autoFocus />
      </>,
    );
    await goToB(user);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Members' })).toHaveFocus());
    await later(250);
    expect(screen.getByRole('heading', { name: 'Members' })).toHaveFocus();
  });
});

describe('route focus: a dialog that opens with the page', () => {
  it('keeps focus in the dialog when the heading appears late, and still names the tab', async () => {
    const user = open(
      <>
        <Late>
          <h1>Asha Rao</h1>
        </Late>
        <Dialog title="Subscribe" onClose={() => undefined}>
          <input aria-label="Plan" />
        </Dialog>
      </>,
    );
    await goToB(user);
    expect(screen.getByLabelText('Plan')).toHaveFocus();
    await waitFor(() => expect(document.title).toBe('Asha Rao · Stories'));
    await later(250);
    expect(screen.getByLabelText('Plan')).toHaveFocus();
  });

  it('keeps focus in a dialog that opens just after the heading was focused, even with a marked field on the page', async () => {
    const user = open(
      <>
        <h1>Transfers</h1>
        <Late>
          <Dialog title="New transfer" onClose={() => undefined}>
            <input aria-label="Note" />
            <ScanInput label="Items" onScan={() => undefined} autoFocus />
          </Dialog>
        </Late>
        <Late after={250}>
          <input aria-label="Filter" data-autofocus />
        </Late>
      </>,
    );
    await goToB(user);
    await waitFor(() => expect(screen.getByLabelText('Items')).toHaveFocus());
    await screen.findByLabelText('Filter');
    await later(250);
    expect(screen.getByLabelText('Items')).toHaveFocus();
  });
});
