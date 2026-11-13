import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, Outlet, RouterProvider, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../data/api';
import type { Book } from '../data/catalogue';
import type { Copy, CopyWhereabouts } from '../data/inventory';
import type { Member } from '../data/members';
import { PERMISSION_CODES, type Permission } from '../generated/rbac';
import { paths } from '../paths';
import { Dialog } from '../shared/Dialog';
import { setErrorSink } from '../shared/reportError';
import { useRouteFocus } from '../shared/useRouteFocus';
import { lt } from '../strings/library';

// The header's find box: when its shortcuts open it, where each kind of answer leads, what it leaves out for
// someone whose menu does not have a page, and that the page it opens still takes focus itself.
const world = vi.hoisted(() => ({
  claims: { v: 1, sa: true, o: {} } as unknown,
  branch: { id: 'b1', name: 'Central' } as { id: string; name: string } | null,
  copy: null as unknown,
  members: [] as unknown,
  titles: [] as unknown,
  whereabouts: null as unknown,
  /** Lookups wait for this: a test holds it to act while they are on their way. */
  gate: Promise.resolve(),
  asked: [] as string[],
}));

vi.mock('../data/services', () => ({ services: () => ({ fns: {}, db: {} }) }));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ claims: world.claims, user: { uid: 'me' } }) }));
vi.mock('../admin/Workspace', () => ({ useWorkspace: () => ({ org: { id: 'o1', name: 'Stories' }, branch: world.branch }) }));
const answer = async (kind: string, value: unknown) => {
  world.asked.push(kind);
  await world.gate;
  if (value instanceof Error) throw value;
  return value;
};
vi.mock('../data/inventory', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../data/inventory')>()),
  findCopy: (_org: string, branchId: string, v: string) => answer(`copy ${branchId} ${v}`, world.copy),
  locateCopy: (_org: string, v: string) => answer(`locate ${v}`, world.whereabouts),
}));
vi.mock('../data/members', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../data/members')>()),
  searchMembers: (_org: string, branchId: string, v: string) => answer(`members ${branchId} ${v}`, world.members),
}));
vi.mock('../data/catalogue', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../data/catalogue')>()),
  findBooks: (v: string, max: number) => answer(`titles ${v} ${max}`, world.titles),
}));

const { QuickFind } = await import('../admin/QuickFind');

const member = (id: string, fullName: string, code: string, more: Partial<Member> = {}) => ({ id, fullName, code, phone: null, status: 'ACTIVE', ...more }) as Member;
const title = (id: string, name: string, more: Partial<Book> = {}) => ({ id, title: name, code: `BOOK-${id}`, isbn: null, authorNames: ['Enid Blyton'], status: 'ACTIVE', ...more }) as Book;
const copy = (id: string, code: string) => ({ id, code, barcode: code, bookId: 'k1', bookTitle: 'Secret Seven' }) as Copy;
/** Claims of someone holding exactly these permissions at branch b1. */
const holding = (...perms: Permission[]) => ({ v: 1, sa: false, o: { o1: { r: [], b: ['b1'], p: perms.map((p) => PERMISSION_CODES[p]).join('') } } });

function Frame() {
  useRouteFocus('main');
  return (
    <>
      <header>
        <QuickFind />
      </header>
      <main id="main">
        <Outlet />
      </main>
    </>
  );
}
/** Stands for whichever page the find box opened: its heading is its address. */
function Where() {
  return <h1>{useLocation().pathname}</h1>;
}

function open(start = '/') {
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
                <input aria-label="Notes" />
                <textarea aria-label="Remarks" />
              </>
            ),
          },
          {
            path: '/busy',
            element: (
              <>
                <h1>Busy</h1>
                <Dialog title="Something else" onClose={() => undefined}>
                  <button type="button">OK</button>
                </Dialog>
              </>
            ),
          },
          { path: '*', element: <Where /> },
        ],
      },
    ],
    { initialEntries: [start] },
  );
  render(<RouterProvider router={router} />);
  return userEvent.setup();
}
const field = () => screen.getByLabelText(lt.findLabel);
const arrivedAt = (path: string) => screen.findByRole('heading', { level: 1, name: path });
/** Opens the box with its button, types (or scans) the text and presses Enter. */
async function find(user: ReturnType<typeof userEvent.setup>, text: string) {
  await user.click(screen.getByRole('button', { name: lt.find }));
  await user.type(field(), `${text}{Enter}`);
}

let reported: unknown[] = [];
let restoreSink: ReturnType<typeof setErrorSink>;
beforeEach(() => {
  Object.assign(world, { claims: { v: 1, sa: true, o: {} }, branch: { id: 'b1', name: 'Central' }, copy: null, members: [], titles: [], whereabouts: null, gate: Promise.resolve() });
  world.asked.length = 0;
  reported = [];
  restoreSink = setErrorSink((_report, error) => reported.push(error));
});
afterEach(() => setErrorSink(restoreSink));

describe('find box: opening', () => {
  it('is a named button that opens a dialog with the field focused, and gives focus back on Escape', async () => {
    const user = open();
    const button = screen.getByRole('button', { name: lt.find });
    expect(screen.queryByRole('dialog')).toBeNull();
    await user.click(button);
    expect(screen.getByRole('dialog', { name: lt.find })).toBeInTheDocument();
    expect(field()).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(button).toHaveFocus();
  });

  it('opens with "/" when no field has the keyboard, without typing the slash', async () => {
    const user = open();
    await user.keyboard('/');
    expect(field()).toHaveFocus();
    expect(field()).toHaveValue('');
  });

  it('leaves "/" alone while someone types in a field', async () => {
    const user = open();
    await user.type(screen.getByLabelText('Notes'), '12/05');
    await user.type(screen.getByLabelText('Remarks'), 'a/b');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByLabelText('Notes')).toHaveValue('12/05');
    expect(screen.getByLabelText('Remarks')).toHaveValue('a/b');
  });

  it('leaves "/" alone in the middle of a scan (keys arriving faster than a hand types)', () => {
    open();
    // A scanned web address with nothing focused: "…s:" then "//" within the same instant.
    fireEvent.keyDown(document.body, { key: ':' });
    fireEvent.keyDown(document.body, { key: '/' });
    fireEvent.keyDown(document.body, { key: '/' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens with Ctrl+K and with Cmd+K, also from inside a field', async () => {
    const user = open();
    await user.click(screen.getByLabelText('Notes'));
    await user.keyboard('{Control>}k{/Control}');
    expect(field()).toHaveFocus();
    await user.keyboard('{Escape}');
    await user.keyboard('{Meta>}k{/Meta}');
    expect(field()).toHaveFocus();
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
  });

  it('does not open over another dialog', async () => {
    const user = open('/busy');
    await waitFor(() => expect(screen.getByRole('button', { name: 'OK' })).toHaveFocus());
    await user.keyboard('/');
    await user.keyboard('{Control>}k{/Control}');
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(screen.getByRole('dialog', { name: 'Something else' })).toBeInTheDocument();
  });

  it('asks nothing until Enter', async () => {
    const user = open();
    await user.click(screen.getByRole('button', { name: lt.find }));
    await user.type(field(), 'secret seven');
    expect(world.asked).toEqual([]);
    // An empty box has nothing to look for.
    await user.clear(field());
    await user.keyboard('{Enter}');
    expect(world.asked).toEqual([]);
  });
});

describe('find box: where an answer leads', () => {
  it('opens the copy with that code at the branch, ahead of a member or a title', async () => {
    // A copy barcode can be a 13-digit number that is also a valid ISBN.
    world.copy = copy('c1', '9780306406157');
    world.members = [member('m1', 'Asha Rao', '9780306406157')];
    world.titles = [title('k1', 'Signals and Noise', { isbn: '9780306406157' })];
    const user = open();
    await find(user, '9780306406157');
    await arrivedAt(paths.adminCopy('c1'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(world.asked).toEqual(['copy b1 9780306406157', 'members b1 9780306406157', 'titles 9780306406157 6']);
  });

  it('opens the member whose code was typed in full, in any letter case', async () => {
    world.members = [member('m1', 'Asha Rao', 'KOR-M000124'), member('m2', 'Asha Rao', 'KOR-M000123')];
    world.titles = [title('k1', 'Kora and the Sea')];
    const user = open();
    await find(user, 'kor-m000123');
    await arrivedAt(paths.adminMember('m2'));
  });

  it('opens the title for a 13-digit ISBN even when a member matches too', async () => {
    world.members = [member('m1', 'Asha Rao', 'KOR-M000123')];
    world.titles = [title('k1', 'Signals and Noise', { isbn: '9780306406157' })];
    const user = open();
    await find(user, '978-0-306-40615-7');
    await arrivedAt(paths.adminBook('k1'));
  });

  it('opens the title for a 10-digit ISBN when no member matches', async () => {
    world.titles = [title('k1', 'Signals and Noise', { isbn: '9780306406157' }), title('k2', 'Signals')];
    const user = open();
    await find(user, '0306406152');
    await arrivedAt(paths.adminBook('k1'));
  });

  it('still finds the member when a mobile number happens to pass the ISBN check', async () => {
    // 9876500007 is a valid ISBN-10 (9789876500005) and a perfectly good mobile number.
    world.members = [member('m1', 'Asha Rao', 'KOR-M000123', { phone: '9876500007' }), member('m2', 'Vikram Rao', 'KOR-M000200', { phone: '9876500007' })];
    world.titles = [title('k1', 'Some Book', { isbn: '9789876500005' })];
    const user = open();
    await find(user, '9876500007');
    // Both are offered: the person chooses.
    const members = await screen.findByRole('region', { name: lt.membersTitle });
    expect(within(members).getAllByRole('link')).toHaveLength(2);
    expect(within(screen.getByRole('region', { name: lt.findTitles })).getByRole('link', { name: /Some Book/ })).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await user.click(within(members).getByRole('link', { name: /Vikram Rao/ }));
    await arrivedAt(paths.adminMember('m2'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens the only member for such a number when we have no title with that ISBN', async () => {
    world.members = [member('m1', 'Asha Rao', 'KOR-M000123', { phone: '9876500007' })];
    const user = open();
    await find(user, '98765 00007');
    await arrivedAt(paths.adminMember('m1'));
    // A number typed with a space is not a copy code, so no copy is looked for.
    expect(world.asked).toEqual(['members b1 98765 00007', 'titles 98765 00007 6']);
  });

  it('lists several matches by kind, as links, and says how many', async () => {
    world.members = [member('m1', 'Asha Rao', 'KOR-M000123', { phone: '9876543210' }), member('m2', 'Rao Stores', 'KOR-M000200', { status: 'SUSPENDED' })];
    world.titles = [title('k1', 'Rao and the River'), title('k2', 'Old Rao', { status: 'ARCHIVED' })];
    const user = open();
    await find(user, 'rao');
    expect(await screen.findByRole('status')).toHaveTextContent(lt.findChoose(4));
    const members = within(screen.getByRole('region', { name: lt.membersTitle }));
    expect(members.getByRole('link', { name: /Asha Rao.*KOR-M000123.*9876543210/ })).toHaveAttribute('href', paths.adminMember('m1'));
    // Status is said in words, not by colour.
    expect(members.getByRole('link', { name: /Rao Stores.*Suspended/ })).toBeInTheDocument();
    const titles = within(screen.getByRole('region', { name: lt.findTitles }));
    expect(titles.getByRole('link', { name: /Rao and the River.*Enid Blyton.*BOOK-k1/ })).toHaveAttribute('href', paths.adminBook('k1'));
    expect(titles.getByRole('link', { name: /Old Rao.*Archived/ })).toBeInTheDocument();
    // The typed text stays, to be refined.
    expect(field()).toHaveValue('rao');

    // Arrow keys walk from the field through the results and back.
    field().focus();
    await user.keyboard('{ArrowDown}');
    expect(members.getByRole('link', { name: /Asha Rao/ })).toHaveFocus();
    await user.keyboard('{ArrowUp}');
    expect(field()).toHaveFocus();
  });

  it('shows the first few titles and says there are more', async () => {
    world.titles = Array.from({ length: 6 }, (_, n) => title(`k${n}`, `Secret ${n}`));
    const user = open();
    await find(user, 'secret');
    const titles = within(await screen.findByRole('region', { name: lt.findTitles }));
    expect(titles.getAllByRole('link')).toHaveLength(5);
    expect(screen.getByRole('status')).toHaveTextContent(lt.findMore);
  });

  it('opens a single match straight away', async () => {
    world.titles = [title('k1', 'Secret Seven')];
    const user = open();
    await find(user, 'secret seven');
    await arrivedAt(paths.adminBook('k1'));
  });

  it('says so when nothing matches, without asking where a copy is for text that is no copy code', async () => {
    const user = open();
    await find(user, 'no such thing');
    expect(await screen.findByRole('status')).toHaveTextContent(lt.findNothing('no such thing'));
    expect(world.asked).toEqual(['members b1 no such thing', 'titles no such thing 6']);
  });
});

describe('find box: a copy that is not at this branch', () => {
  const elsewhere = (canOpen: boolean): CopyWhereabouts => ({
    copyId: 'c9', code: 'KOR-000009', bookId: 'k1', bookTitle: 'Secret Seven', status: 'AVAILABLE', currentBranchId: 'b2', currentBranchName: 'North', owningBranchName: 'North', canOpen,
  });

  it('asks the server only after nothing was found here, and opens the copy when the person may', async () => {
    world.whereabouts = elsewhere(true);
    const user = open();
    await find(user, 'KOR-000009');
    await arrivedAt(paths.adminCopy('c9'));
    expect(world.asked).toEqual(['copy b1 KOR-000009', 'members b1 KOR-000009', 'titles KOR-000009 6', 'locate KOR-000009']);
  });

  it('says where the copy is, with a link to the book, when the person may not open it', async () => {
    world.whereabouts = elsewhere(false);
    const user = open();
    await find(user, 'KOR-000009');
    expect(await screen.findByText(lt.copyElsewhere('KOR-000009', 'Secret Seven', 'North', 'Available'), { exact: false })).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: lt.viewBook }));
    await arrivedAt(paths.adminBook('k1'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('takes "no such copy" from the server as nothing found', async () => {
    world.whereabouts = new ApiError('Copy was not found.', 'NOT_FOUND');
    const user = open();
    await find(user, 'KOR-000404');
    expect(await screen.findByRole('status')).toHaveTextContent(lt.findNothing('KOR-000404'));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(reported).toEqual([]);
  });

  it('says the search did not fully work when the server could not tell', async () => {
    world.whereabouts = new ApiError('Check your connection.', 'NETWORK');
    const user = open();
    await find(user, 'KOR-000404');
    expect(await screen.findByRole('alert')).toHaveTextContent(lt.findPartFailed);
    expect(screen.queryByText(lt.findNothing('KOR-000404'))).toBeNull();
  });

  it('does not ask when something was found here', async () => {
    world.members = [member('m1', 'Kor Singh', 'KOR-M000001'), member('m2', 'Kor Kaur', 'KOR-M000002')];
    const user = open();
    await find(user, 'KOR-0000');
    await screen.findByRole('region', { name: lt.membersTitle });
    expect(world.asked.filter((a) => a.startsWith('locate'))).toEqual([]);
  });
});

describe('find box: only what the person may open', () => {
  it('looks up members only for someone without the catalogue', async () => {
    world.claims = holding('members.view');
    world.members = [member('m1', 'Asha Rao', 'KOR-M000123'), member('m2', 'Asha Rao', 'KOR-M000124')];
    const user = open();
    await find(user, 'KOR-000009');
    await screen.findByRole('region', { name: lt.membersTitle });
    expect(world.asked).toEqual(['members b1 KOR-000009']);
    expect(screen.getByText(lt.findHint([lt.findKindMember]))).toBeInTheDocument();
  });

  it('looks up copies and titles only for someone without the member list', async () => {
    world.claims = holding('books.view');
    const user = open();
    await find(user, 'KOR-000009');
    expect(await screen.findByRole('status')).toHaveTextContent(lt.findNothing('KOR-000009'));
    expect(world.asked).toEqual(['copy b1 KOR-000009', 'titles KOR-000009 6', 'locate KOR-000009']);
    expect(screen.getByText(lt.findHint([lt.findKindCopy, lt.findKindTitle]))).toBeInTheDocument();
  });

  it('is not there at all for someone with none of those pages', async () => {
    world.claims = holding('employees.view', 'attendance.view');
    const user = open();
    expect(screen.queryByRole('button', { name: lt.find })).toBeNull();
    await user.keyboard('/');
    await user.keyboard('{Control>}k{/Control}');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('with no working branch, looks up titles and where a copy is, nothing branch-bound', async () => {
    world.branch = null;
    world.whereabouts = new ApiError('Copy was not found.', 'NOT_FOUND');
    const user = open();
    await find(user, 'KOR-000009');
    expect(await screen.findByRole('status')).toHaveTextContent(lt.findNothing('KOR-000009'));
    expect(world.asked).toEqual(['titles KOR-000009 6', 'locate KOR-000009']);
    expect(screen.getByText(lt.findHint([lt.findKindCopy, lt.findKindTitle]))).toBeInTheDocument();
  });
});

describe('find box: failures and late answers', () => {
  it('keeps what the other lookups found when one fails, says so, and reports it', async () => {
    const broken = new Error('Missing or insufficient permissions.');
    world.members = broken;
    world.titles = [title('k1', 'Secret Seven')];
    const user = open();
    await find(user, 'secret');
    expect(await screen.findByRole('alert')).toHaveTextContent(lt.findPartFailed);
    // Not opened on its own: the lookup that failed might have had the better answer.
    expect(within(screen.getByRole('region', { name: lt.findTitles })).getByRole('link', { name: /Secret Seven/ })).toBeInTheDocument();
    expect(reported).toEqual([broken]);
  });

  it('does not open a title for ten digits on its own when the member lookup failed', async () => {
    // The number may be a mobile: with the members unknown, the title is offered, not opened.
    world.members = new ApiError('Check your connection.', 'NETWORK');
    world.titles = [title('k1', 'Some Book', { isbn: '9789876500005' })];
    const user = open();
    await find(user, '9876500007');
    expect(await screen.findByRole('alert')).toHaveTextContent(lt.findPartFailed);
    expect(within(screen.getByRole('region', { name: lt.findTitles })).getByRole('link', { name: /Some Book/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Home' })).toBeInTheDocument();
  });

  it('ignores an answer that arrives after the box was closed', async () => {
    let release = () => undefined as void;
    world.gate = new Promise<void>((r) => (release = r));
    world.titles = [title('k1', 'Secret Seven')];
    const user = open();
    await find(user, 'secret seven');
    expect(screen.getByRole('button', { name: lt.findLooking })).toBeDisabled();
    await user.keyboard('{Escape}');
    release();
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByRole('heading', { level: 1, name: 'Home' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('find box: the page it opens takes focus itself', () => {
  it('lands on the arriving page, not back on the header button', async () => {
    world.members = [member('m1', 'Asha Rao', 'KOR-M000123')];
    const user = open();
    await find(user, 'KOR-M000123');
    const heading = await arrivedAt(paths.adminMember('m1'));
    await waitFor(() => expect(heading).toHaveFocus());
    expect(document.title).toBe(`${paths.adminMember('m1')} · Stories`);
  });
});
