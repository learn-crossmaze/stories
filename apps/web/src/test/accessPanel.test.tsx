import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { StoriesClaims } from '../auth/claims';
import type { Employee } from '../data/hr';
import type { Org } from '../data/org';
import { ROLES } from '../generated/rbac';
import { t } from '../strings';
import { ht } from '../strings/hr';

// The Access tab of an employee profile, with the server faked at the Cloud Functions boundary.
type Sent = { action: string; email?: string; roles?: string[]; branchIds?: string[] };
const calls: Sent[] = [];
vi.mock('firebase/functions', () => ({
  httpsCallable: () => async (data: Sent) => {
    calls.push(data);
    return { data: data.action === 'roles-list' ? { standard: [], custom: [] } : { ok: true } };
  },
}));
vi.mock('../data/services', () => ({ services: () => ({ fns: {}, db: {} }) }));
// A Senior Librarian at Central: gives roles there and adds people, but does not edit employee records.
let claims: StoriesClaims = { v: 1, sa: false, o: { o1: { r: ['SLIB'], b: ['b1'] } } };
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ claims, user: { uid: 'me' } }) }));
const branches = [
  { id: 'b1', code: 'CEN', name: 'Central', status: 'ACTIVE' },
  { id: 'b2', code: 'NOR', name: 'North', status: 'ACTIVE' },
];
vi.mock('../admin/Workspace', () => ({ useWorkspace: () => ({ org: { id: 'o1', type: 'CORPORATE' }, branches, branchName: (id: string) => branches.find((b) => b.id === id)?.name ?? id }) }));
const getStaffMember = vi.fn();
const listStaff = vi.fn(async () => []);
vi.mock('../data/org', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../data/org')>()),
  getStaffMember: (...args: unknown[]) => getStaffMember(...args),
  listStaff: () => listStaff(),
}));

const { resetBackendState } = await import('../data/api');
const { AccessPanel } = await import('../admin/people/employeePanels');

const org = { id: 'o1', name: 'Org', type: 'CORPORATE', status: 'ACTIVE' } as Org;
const employee = (over: Partial<Employee> = {}) => ({ id: 'e1', orgId: 'o1', code: 'EMP-1', uid: null, email: 'asha@example.test', fullName: 'Asha Rao', branchId: 'b1', status: 'ONBOARDING', ...over }) as Employee;
const panel = (e: Employee, onChanged = vi.fn()) => {
  render(
    <MemoryRouter>
      <AccessPanel org={org} employee={e} onChanged={onChanged} />
    </MemoryRouter>,
  );
  return onChanged;
};

beforeEach(() => {
  calls.length = 0;
  claims = { v: 1, sa: false, o: { o1: { r: ['SLIB'], b: ['b1'] } } };
  getStaffMember.mockReset();
  getStaffMember.mockResolvedValue(null);
  listStaff.mockClear();
  resetBackendState();
});

describe('employee profile → Access', () => {
  it('gives access in one step to someone not linked yet, also for a manager who cannot edit employee records', async () => {
    const user = userEvent.setup();
    const onChanged = panel(employee());

    // Link account needs the right to edit employees; giving roles does not.
    expect(screen.queryByRole('button', { name: ht.linkAccount })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: t.staffGiveAccess }));
    const dialog = within(screen.getByRole('dialog', { name: ht.giveAccessTitle }));
    // The record's own email, locked, and the employee's branch to start with.
    expect(dialog.getByLabelText(t.staffEmail)).toHaveValue('asha@example.test');
    expect(dialog.getByLabelText(t.staffEmail)).toBeDisabled();
    expect(dialog.getByRole('checkbox', { name: /Central/ })).toBeChecked();

    await user.click(dialog.getByRole('checkbox', { name: ROLES.LIBRARIAN.label }));
    await user.click(dialog.getByRole('button', { name: t.staffGiveAccess }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    // One command: the roles, which also link the account.
    expect(calls.filter((c) => c.action !== 'roles-list')).toEqual([
      expect.objectContaining({ action: 'staff-setRoles', email: 'asha@example.test', roles: ['LIBRARIAN'], branchIds: ['b1'] }),
    ]);
  });

  it('does not preset a branch the viewer cannot give', async () => {
    const user = userEvent.setup();
    panel(employee({ branchId: 'b2' }));
    await user.click(screen.getByRole('button', { name: t.staffGiveAccess }));
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByRole('checkbox', { name: /Central/ })).not.toBeChecked();
    // North is not theirs to give: not offered, and not sent unseen.
    expect(dialog.queryByRole('checkbox', { name: /North/ })).not.toBeInTheDocument();
    await user.click(dialog.getByRole('checkbox', { name: ROLES.LIBRARIAN.label }));
    await user.click(dialog.getByRole('button', { name: t.staffGiveAccess }));
    expect(await dialog.findByText('Choose at least one branch.')).toBeInTheDocument();
    expect(calls.some((c) => c.action === 'staff-setRoles')).toBe(false);
  });

  it('offers nothing in one step without an email on record, and keeps Link account for editors', () => {
    claims = { v: 1, sa: true, o: {} };
    panel(employee({ email: null }));
    expect(screen.queryByRole('button', { name: t.staffGiveAccess })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: ht.linkAccount })).toBeInTheDocument();
  });

  it('hides both for someone who has left', () => {
    claims = { v: 1, sa: true, o: {} };
    panel(employee({ status: 'OFFBOARDED' }));
    expect(screen.queryByRole('button', { name: t.staffGiveAccess })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: ht.linkAccount })).not.toBeInTheDocument();
  });

  it("reads only this person's roles, not the whole staff list", async () => {
    getStaffMember.mockResolvedValue({ uid: 'u1', orgId: 'o1', email: 'asha@example.test', displayName: 'Asha', roles: ['LIBRARIAN'], branchIds: ['b1'], status: 'ACTIVE' });
    panel(employee({ uid: 'u1', status: 'ACTIVE' }));
    expect(await screen.findByText(`${ROLES.LIBRARIAN.label} · Central`)).toBeInTheDocument();
    expect(getStaffMember).toHaveBeenCalledTimes(1);
    expect(getStaffMember).toHaveBeenCalledWith('o1', 'u1');
    expect(listStaff).not.toHaveBeenCalled();
    // Linked already: roles are managed, not given for the first time.
    expect(screen.queryByRole('button', { name: t.staffGiveAccess })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: ht.manageRoles })).toBeInTheDocument();
  });
});
