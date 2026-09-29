import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, Link, Outlet, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';

import { Dialog } from '../admin/components/Dialog';
import { isGroup, MENUS, movedTo, navItemFor, VIEW_ORDER } from '../admin/nav';
import { useRouteFocus } from '../shared/useRouteFocus';

describe('dialog', () => {
  it('keeps Tab inside the dialog and closes on Escape', async () => {
    const user = userEvent.setup();
    let closed = false;
    render(
      <>
        <button type="button">Outside</button>
        <Dialog title="Edit" onClose={() => (closed = true)}>
          <input aria-label="Name" />
          <button type="button">Save</button>
        </Dialog>
      </>,
    );
    expect(screen.getByLabelText('Name')).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Save' })).toHaveFocus();
    await user.tab();
    expect(screen.getByLabelText('Name')).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.getByRole('button', { name: 'Save' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(closed).toBe(true);
  });
});

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

describe('route focus', () => {
  it('names the tab after the page and moves focus to its heading after navigating', async () => {
    const user = userEvent.setup();
    const router = createMemoryRouter(
      [
        {
          element: <Frame />,
          children: [
            { path: '/a', element: <h1>Page A</h1> },
            { path: '/b', element: <h1>Page B</h1> },
          ],
        },
      ],
      { initialEntries: ['/a'] },
    );
    render(<RouterProvider router={router} />);
    await waitFor(() => expect(document.title).toBe('Page A · Stories'));
    expect(screen.getByRole('heading', { name: 'Page A' })).not.toHaveFocus();
    await user.click(screen.getByRole('link', { name: 'Go to B' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Page B' })).toHaveFocus());
    expect(document.title).toBe('Page B · Stories');
  });
});

describe('menu', () => {
  it('gives every entry in a view its own icon, and nests one level at most', () => {
    for (const view of VIEW_ORDER) {
      const icons = MENUS[view].map((e) => e.icon);
      expect(new Set(icons).size, view).toBe(icons.length);
      for (const e of MENUS[view]) if (isGroup(e)) expect(e.items.every((i) => !isGroup(i as never))).toBe(true);
    }
  });

  it('finds the menu item for detail pages and view homes', () => {
    expect(navItemFor('/ops/members/abc')?.label).toBe('Members');
    expect(navItemFor('/admin/people/x1')?.label).toBe('Employees');
    expect(navItemFor('/admin')?.label).toBe('Dashboard');
    expect(navItemFor('/ops')?.label).toBe('Today');
    expect(navItemFor('/me')?.label).toBe('Home');
    expect(navItemFor('/admin/settings/leave')?.label).toBe('Leave types');
  });

  it('sends old addresses to where the page lives now', () => {
    expect(movedTo('/admin/books/b1', '?tab=copies')).toBe('/ops/books/b1?tab=copies');
    expect(movedTo('/admin/my-leave')).toBe('/me/leave');
    expect(movedTo('/admin/hr-settings')).toBe('/admin/settings/jobs');
    expect(movedTo('/admin/people')).toBeNull();
  });
});
