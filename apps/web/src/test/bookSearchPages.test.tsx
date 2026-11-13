import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { createMemoryRouter, Link, Outlet, RouterProvider } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Book } from '../data/catalogue';
import type { Membership } from '../data/me';
import { useRouteFocus } from '../shared/useRouteFocus';
import { t } from '../strings';
import { lt } from '../strings/library';

// The pages and the picker that search titles: what they show when a search of several words has matched
// nothing so far but has more to read, where the Catalogue lands the keyboard, and what the picker asks for.
// (How the search itself reads and narrows is in bookSearch.test.ts.)
interface Answer {
  items: Book[];
  cursor?: { id: string };
}
const world = vi.hoisted(() => ({
  /** One answer per call to the title search, in order; the last one repeats. */
  pages: [] as unknown[],
  searched: [] as { q: string; ageGroup: string; after: string | undefined; status: string }[],
  picked: [] as unknown[],
  found: [] as unknown[],
}));

vi.mock('../data/services', () => ({ services: () => ({ fns: {}, db: {} }) }));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ claims: { v: 1, sa: true, o: {} }, user: { uid: 'me' } }) }));
vi.mock('../admin/Workspace', () => ({ useWorkspace: () => ({ org: { id: 'o1', type: 'CORPORATE' }, branch: { id: 'b1', name: 'Central' } }) }));
vi.mock('../data/catalogue', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../data/catalogue')>()),
  searchBooks: async (q: string, ageGroup: string, after?: { id: string }, status = '') => {
    world.searched.push({ q, ageGroup, after: after?.id, status });
    return world.pages.length > 1 ? world.pages.shift() : world.pages[0];
  },
  findBooks: async (q: string, max: number, status?: string) => {
    world.picked.push([q, max, status]);
    return world.found;
  },
}));
vi.mock('../data/inventory', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../data/inventory')>()),
  stockByBranch: async () => ({}),
}));
// The member area's frame: one membership, already loaded.
const membership = { orgId: 'o1', memberId: 'm1', member: { audience: 'CHILDREN', status: 'ACTIVE' }, branch: { id: 'b1', name: 'Central' }, reservations: [] } as unknown as Membership;
vi.mock('../member/memberData', () => ({ useMemberData: () => ({ overview: { reload: () => undefined }, current: membership }) }));
vi.mock('../member/common', () => ({
  Page: ({ title, children }: { title: string; children: ReactNode }) => (
    <>
      <h1>{title}</h1>
      {children}
    </>
  ),
  WithMembership: ({ children }: { children: (m: Membership) => ReactNode }) => <>{children(membership)}</>,
}));

const { CataloguePage } = await import('../admin/catalogue/Catalogue');
const { BookPicker } = await import('../admin/catalogue/BookPicker');
const { ExplorePage } = await import('../member/ExplorePage');

const book = (id: string, title: string, more: Partial<Book> = {}) =>
  ({ id, title, code: `BOOK-${id}`, isbn: null, authorNames: ['Enid Blyton'], genres: ['FICTION'], ageGroup: 'CHILDREN', status: 'ACTIVE', synopsis: '', ...more }) as Book;
const answers = (...pages: Answer[]) => {
  world.pages = pages;
};

function Frame() {
  useRouteFocus('main');
  return (
    <main id="main">
      <Outlet />
    </main>
  );
}
function show(at: string) {
  const router = createMemoryRouter(
    [
      {
        element: <Frame />,
        children: [
          {
            path: '/',
            element: (
              <>
                <h1>Home</h1>
                <Link to="/books">Catalogue</Link>
              </>
            ),
          },
          { path: '/books', element: <CataloguePage /> },
          { path: '/explore', element: <ExplorePage /> },
          { path: '*', element: <h1>Elsewhere</h1> },
        ],
      },
    ],
    { initialEntries: [at] },
  );
  render(<RouterProvider router={router} />);
  return userEvent.setup();
}

beforeEach(() => {
  world.pages = [{ items: [] }];
  world.searched.length = 0;
  world.picked.length = 0;
  world.found = [];
});

describe('Catalogue page: search', () => {
  it('lands the keyboard in the search box when someone arrives from another page', async () => {
    answers({ items: [book('k1', 'Secret Seven')] });
    const user = show('/');
    await user.click(screen.getByRole('link', { name: 'Catalogue' }));
    await waitFor(() => expect(screen.getByRole('searchbox', { name: lt.searchBooks })).toHaveFocus());
    expect(document.title).toBe(`${lt.catalogueTitle} · ${t.appTitle}`);
  });

  it('offers to keep looking when nothing matched so far and there is more to read, then carries on from there', async () => {
    answers({ items: [], cursor: { id: 's199' } }, { items: [book('k1', 'Secret Seven')] });
    const user = show('/books');
    expect(await screen.findByRole('heading', { name: t.searchNoneYet })).toBeInTheDocument();
    expect(screen.getByText(t.searchNoneYetHint)).toBeInTheDocument();
    // Not "No books match": that would be wrong while titles are still unread.
    expect(screen.queryByText(lt.booksEmpty)).toBeNull();
    await user.click(screen.getByRole('button', { name: t.keepLooking }));
    expect(await screen.findByRole('link', { name: /Secret Seven/ })).toBeInTheDocument();
    expect(world.searched.map((s) => s.after)).toEqual([undefined, 's199']);
    expect(screen.queryByRole('button', { name: t.keepLooking })).toBeNull();
    expect(screen.queryByRole('button', { name: t.loadMore })).toBeNull();
  });

  it('says no books match once everything was read', async () => {
    answers({ items: [], cursor: { id: 's199' } }, { items: [] });
    const user = show('/books');
    await user.click(await screen.findByRole('button', { name: t.keepLooking }));
    expect(await screen.findByRole('heading', { name: lt.booksEmpty })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t.keepLooking })).toBeNull();
  });

  it('hands the whole typed text to the search, not one word of it', async () => {
    answers({ items: [book('k1', 'Secret Seven')] });
    const user = show('/books');
    await user.type(screen.getByRole('searchbox', { name: lt.searchBooks }), 'secret seven');
    await waitFor(() => expect(world.searched.at(-1)).toEqual({ q: 'secret seven', ageGroup: '', after: undefined, status: '' }));
  });
});

describe('Explore page (member area): search', () => {
  it('offers to keep looking instead of saying no books were found, within the member’s own titles', async () => {
    answers({ items: [], cursor: { id: 's199' } }, { items: [book('k1', 'Secret Seven')] });
    const user = show('/explore');
    expect(await screen.findByRole('heading', { name: t.searchNoneYet })).toBeInTheDocument();
    expect(screen.queryByText(t.meNoBooksFound)).toBeNull();
    await user.click(screen.getByRole('button', { name: t.keepLooking }));
    expect(await screen.findByRole('button', { name: /Secret Seven/ })).toBeInTheDocument();
    // Still only active titles for the member's age group, and from where the first search stopped.
    expect(world.searched).toEqual([
      { q: '', ageGroup: 'CHILDREN', after: undefined, status: 'ACTIVE' },
      { q: '', ageGroup: 'CHILDREN', after: 's199', status: 'ACTIVE' },
    ]);
  });

  it('says no books were found once everything was read', async () => {
    show('/explore');
    expect(await screen.findByRole('heading', { name: t.meNoBooksFound })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t.keepLooking })).toBeNull();
  });
});

describe('title picker (reserve dialog)', () => {
  it('asks for the best eight titles that can be picked, and lists what comes back as it is', async () => {
    world.found = [book('k1', 'Secret Seven'), book('k2', 'The Secret Garden')];
    const onPick = vi.fn();
    render(<BookPicker label="Title" onPick={onPick} />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Title'), 'secret se');
    await user.click(await screen.findByRole('button', { name: /The Secret Garden/ }));
    expect(onPick).toHaveBeenCalledWith(world.found[1]);
    // Active titles only, asked of the search itself, so archived ones take none of the eight places.
    expect(world.picked.at(-1)).toEqual(['secret se', 8, 'ACTIVE']);
  });

  it('asks nothing for a single character', async () => {
    render(<BookPicker label="Title" onPick={() => undefined} />);
    await userEvent.setup().type(screen.getByLabelText('Title'), 's');
    await new Promise((r) => setTimeout(r, 400));
    expect(world.picked).toEqual([]);
  });
});
