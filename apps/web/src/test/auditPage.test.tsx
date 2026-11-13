import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { t } from '../strings';

// The audit log narrowed to one branch and to one record: which question is put to the database (only shapes
// the rules allow and an index answers), and how the page keeps the choice in the address.
type Part = { kind: string; field?: string; op?: string; value?: unknown };
type Row = { id: string; entityId: string; branchId: string | null; action?: string };

const world = vi.hoisted(() => ({
  asked: [] as Part[][],
  rows: [] as Row[],
  claims: { v: 1, sa: false, o: {} } as { v: number; sa: boolean; o: Record<string, { r: string[]; b: string[] }> },
}));

vi.mock('../data/services', () => ({ services: () => ({ db: {}, fns: {} }) }));
vi.mock('firebase/firestore', async (importOriginal) => ({
  ...(await importOriginal<typeof import('firebase/firestore')>()),
  collection: (_db: unknown, path: string) => ({ kind: 'collection', value: path }),
  query: (base: Part, ...parts: Part[]) => [base, ...parts],
  where: (field: string, op: string, value: unknown) => ({ kind: 'where', field, op, value }),
  orderBy: (field: string, dir = 'asc') => ({ kind: 'orderBy', field, value: dir }),
  limit: (n: number) => ({ kind: 'limit', value: n }),
  startAfter: (snap: { id: string }) => ({ kind: 'startAfter', value: snap.id }),
  // Answers as the database would: only the rows the filters keep.
  getDocs: async (parts: Part[]) => {
    world.asked.push(parts);
    const keep = (r: Row) =>
      parts.every((p) => {
        if (p.kind !== 'where') return true;
        const have = r[p.field as 'entityId' | 'branchId'];
        return p.op === 'in' ? (p.value as unknown[]).includes(have) : have === p.value;
      });
    return { docs: world.rows.filter(keep).map((r) => ({ id: r.id, data: () => ({ action: 'copy.update', entityType: 'copy', actorUid: 'u1', actorEmail: 'asha@stories.test', before: null, after: null, reason: null, at: null, ...r }) })) };
  },
}));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ claims: world.claims }) }));
const branches = [
  { id: 'b1', name: 'Central', status: 'ACTIVE' },
  { id: 'b2', name: 'North', status: 'ACTIVE' },
  { id: 'b3', name: 'South', status: 'ACTIVE' },
];
vi.mock('../admin/Workspace', () => ({
  useWorkspace: () => {
    const b = world.claims.o.o1?.b ?? [];
    const all = world.claims.sa || b.includes('*');
    return { org: { id: 'o1' }, branchName: (id: string) => branches.find((x) => x.id === id)?.name ?? id, myBranches: branches.filter((x) => all || b.includes(x.id)) };
  },
}));

const { AUDIT_PAGE_SIZE, listAudit } = await import('../data/org');
const { AuditPage } = await import('../admin/organization/Audit');

const shape = (parts: Part[]) =>
  parts.slice(1).map((p) => (p.kind === 'where' ? `${p.field} ${p.op} ${JSON.stringify(p.value)}` : `${p.kind} ${p.field ?? ''} ${String(p.value)}`.replace('  ', ' ')));
const lastAsked = () => shape(world.asked.at(-1)!);
const page = [`orderBy at desc`, `limit ${AUDIT_PAGE_SIZE}`];

let address = '';
function Address() {
  const { pathname, search } = useLocation();
  address = pathname + search;
  return null;
}
function open(at = '/admin/audit') {
  render(
    <MemoryRouter initialEntries={[at]}>
      <AuditPage />
      <Address />
    </MemoryRouter>,
  );
  return userEvent.setup();
}

beforeEach(() => {
  world.asked.length = 0;
  world.claims = { v: 1, sa: false, o: { o1: { r: ['AU'], b: ['*'] } } };
  world.rows = [
    { id: 'a1', entityId: 'copy1', branchId: 'b1' },
    { id: 'a2', entityId: 'copy2', branchId: 'b2' },
    { id: 'a3', entityId: 'role1', branchId: null, action: 'role.update' },
    { id: 'a4', entityId: 'copy1', branchId: 'b2', action: 'copy.transfer' },
  ];
});

describe('listAudit', () => {
  it('asks for everything, newest first, when the reader sees all branches', async () => {
    await listAudit('o1', 'ALL');
    expect(world.asked[0][0]).toEqual({ kind: 'collection', value: 'orgs/o1/auditLogs' });
    expect(lastAsked()).toEqual(page);
  });

  it('always keeps a branch-scoped reader’s branches in the question, with or without a record', async () => {
    await listAudit('o1', ['b1', 'b2']);
    expect(lastAsked()).toEqual(['branchId in ["b1","b2"]', ...page]);
    await listAudit('o1', ['b1', 'b2'], undefined, { entityId: 'copy1' });
    expect(lastAsked()).toEqual(['entityId == "copy1"', 'branchId in ["b1","b2"]', ...page]);
  });

  it('filters by the record alone for a reader of all branches, and never by anything without an index', async () => {
    await listAudit('o1', 'ALL', undefined, { entityId: 'copy1' });
    expect(lastAsked()).toEqual(['entityId == "copy1"', ...page]);
    await listAudit('o1', 'ALL', undefined, {});
    expect(lastAsked()).toEqual(page);
    const fields = world.asked.flat().filter((p) => p.kind === 'where').map((p) => p.field);
    expect([...new Set(fields)]).toEqual(['entityId']);
  });
});

describe('the audit page', () => {
  it('shows every entry, also those without a branch, until a branch is chosen', async () => {
    const user = open();
    expect(await screen.findByText('role.update')).toBeInTheDocument();
    expect(lastAsked()).toEqual(page);
    const select = screen.getByRole('combobox', { name: t.branch });
    expect([...select.querySelectorAll('option')].map((o) => o.textContent)).toEqual([t.allBranches, 'Central', 'North', 'South']);

    await user.selectOptions(select, 'b2');
    await waitFor(() => expect(lastAsked()).toEqual(['branchId in ["b2"]', ...page]));
    expect(address).toBe('/admin/audit?branch=b2');
    await waitFor(() => expect(screen.queryByText('role.update')).not.toBeInTheDocument());
    expect(screen.getByText('copy.transfer')).toBeInTheDocument();

    await user.selectOptions(select, '');
    await waitFor(() => expect(lastAsked()).toEqual(page));
    expect(address).toBe('/admin/audit');
  });

  it('narrows to one record when its id is pressed, and back again', async () => {
    const user = open();
    await user.click((await screen.findAllByRole('button', { name: `${t.auditOnlyThis}: copy1` }))[0]);
    await waitFor(() => expect(lastAsked()).toEqual(['entityId == "copy1"', ...page]));
    expect(address).toBe('/admin/audit?record=copy1');
    expect(await screen.findByText(t.auditOneRecord, { exact: false })).toBeInTheDocument();
    expect(await screen.findByText('copy.transfer')).toBeInTheDocument();
    expect(screen.queryByText('role.update')).not.toBeInTheDocument();
    // The record's kind stays in view (an id is not unique to a kind), and its id is no longer a button.
    expect(screen.queryByRole('button', { name: `${t.auditOnlyThis}: copy1` })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: t.auditShowAll }));
    await waitFor(() => expect(lastAsked()).toEqual(page));
    expect(address).toBe('/admin/audit');
    expect(await screen.findByText('role.update')).toBeInTheDocument();
  });

  it('opens from a link with the record and the branch already chosen', async () => {
    open('/admin/audit?record=copy1&branch=b2');
    expect(await screen.findByText('copy.transfer')).toBeInTheDocument();
    expect(world.asked).toHaveLength(1);
    expect(lastAsked()).toEqual(['entityId == "copy1"', 'branchId in ["b2"]', ...page]);
    expect(screen.getByRole('combobox', { name: t.branch })).toHaveValue('b2');
  });

  it('says so when the choice has nothing recorded', async () => {
    open('/admin/audit?record=nothing');
    expect(await screen.findByRole('heading', { name: t.auditNoMatch })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t.auditShowAll })).toBeInTheDocument();
  });

  it('a branch-scoped reader chooses among their own branches only, and a branch from a link outside them is ignored', async () => {
    world.claims = { v: 1, sa: false, o: { o1: { r: ['BM'], b: ['b1', 'b2'] } } };
    const user = open('/admin/audit?branch=b3&record=copy1');
    expect(await screen.findByText('copy.transfer')).toBeInTheDocument();
    // b3 is not theirs: the read keeps to their branches (the rules would refuse anything else).
    expect(lastAsked()).toEqual(['entityId == "copy1"', 'branchId in ["b1","b2"]', ...page]);
    const select = screen.getByRole('combobox', { name: t.branch });
    expect(select).toHaveValue('');
    expect([...select.querySelectorAll('option')].map((o) => o.textContent)).toEqual([t.auditMyBranches, 'Central', 'North']);

    await user.selectOptions(select, 'b1');
    await waitFor(() => expect(lastAsked()).toEqual(['entityId == "copy1"', 'branchId in ["b1"]', ...page]));
    expect(world.asked.every((parts) => parts.some((p) => p.field === 'branchId' && p.op === 'in'))).toBe(true);
  });

  it('offers no branch choice to someone with a single branch', async () => {
    world.claims = { v: 1, sa: false, o: { o1: { r: ['BM'], b: ['b1'] } } };
    open();
    expect(await screen.findByText('copy.update')).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(lastAsked()).toEqual(['branchId in ["b1"]', ...page]);
  });
});
