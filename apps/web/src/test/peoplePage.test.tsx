import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Employee } from '../data/hr';
import { t } from '../strings';
import { ht } from '../strings/hr';

// People → Employees with the reads faked in the data layer and the server at the Cloud Functions boundary.
type Sent = { action: string; fullName: string; email: string; branchId: string | null; employmentType: string; joiningDate: string | null; managerId: string | null; requestId: string };
const calls: Sent[] = [];
/** When set, the server answers only once the test lets it. */
let hold: Promise<void> | null = null;

vi.mock('firebase/functions', () => ({
  httpsCallable: () => async (data: Sent) => {
    calls.push(data);
    const n = calls.length;
    await hold;
    return { data: { employeeId: `new${n}`, code: `EMP-00${n}`, linked: data.email === 'has.account@example.test' } };
  },
}));
vi.mock('../data/services', () => ({ services: () => ({ fns: {}, db: {} }) }));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ claims: { v: 1, sa: true, o: {} }, user: { uid: 'me' } }) }));
const branches = [
  { id: 'b1', code: 'CEN', name: 'Central', status: 'ACTIVE' },
  { id: 'b2', code: 'NOR', name: 'North', status: 'ACTIVE' },
];
vi.mock('../admin/Workspace', () => ({
  useWorkspace: () => ({ org: { id: 'o1', type: 'CORPORATE' }, branches, branchName: (id: string) => branches.find((b) => b.id === id)?.name ?? id }),
}));

const person = (id: string, fullName: string, over: Partial<Employee> = {}) =>
  ({ id, orgId: 'o1', code: id.toUpperCase(), uid: null, email: null, fullName, phone: '', branchId: 'b1', status: 'ACTIVE', employmentType: 'FULL_TIME', designationName: null, departmentName: null, joiningDate: null, ...over }) as Employee;

let directory: Employee[] = [];
const listEmployees = vi.fn(async () => directory);
const listStaff = vi.fn(async () => [] as { uid: string; status: string }[]);
/** The two lists of the dialog arrive when the test says so. */
let lists: { designations: (v: unknown) => void; departments: (v: unknown) => void };
const listDesignations = vi.fn(() => new Promise((r) => (lists.designations = r)));
const listDepartments = vi.fn(() => new Promise((r) => (lists.departments = r)));
vi.mock('../data/hr', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../data/hr')>()),
  listEmployees: () => listEmployees(),
  listDesignations: () => listDesignations(),
}));
vi.mock('../data/org', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../data/org')>()),
  listStaff: () => listStaff(),
  listDepartments: () => listDepartments(),
}));

const { resetBackendState } = await import('../data/api');
const { EmployeeDialog, PeoplePage } = await import('../admin/people/People');

beforeEach(() => {
  calls.length = 0;
  hold = null;
  directory = [person('e1', 'Asha Rao', { uid: 'u1' })];
  lists = { designations: () => undefined, departments: () => undefined };
  for (const f of [listEmployees, listStaff, listDesignations, listDepartments]) f.mockClear();
  listStaff.mockResolvedValue([]);
  resetBackendState();
});

const page = () =>
  render(
    <MemoryRouter>
      <PeoplePage />
    </MemoryRouter>,
  );

describe('People → Employees', () => {
  it('reads the directory and the roles once each, and counts staff without a record from them', async () => {
    listStaff.mockResolvedValue([
      { uid: 'u1', status: 'ACTIVE' },
      { uid: 'u2', status: 'ACTIVE' },
      { uid: 'u3', status: 'REVOKED' },
    ]);
    page();
    expect(await screen.findByRole('heading', { name: ht.backfillTitle(1) })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Asha Rao' })).toBeInTheDocument();
    expect(listEmployees).toHaveBeenCalledTimes(1);
    expect(listStaff).toHaveBeenCalledTimes(1);
  });

  it('shows the Add employee form at once, and adds several people in a row with one refresh at the end', async () => {
    const user = userEvent.setup();
    page();
    await screen.findByRole('link', { name: 'Asha Rao' });
    await user.click(screen.getByRole('button', { name: ht.addEmployee }));
    const dialog = within(screen.getByRole('dialog'));

    // The form is usable before its lists arrive: the name has focus, and only the boxes still loading wait.
    expect(dialog.getByLabelText(ht.fullName)).toHaveFocus();
    expect(dialog.getByLabelText(ht.department)).toBeDisabled();
    expect(dialog.getByLabelText(ht.designation)).toBeDisabled();
    // "Reports to" comes from the page's own list: no second read of the directory.
    expect(dialog.getByLabelText(ht.manager)).toBeEnabled();
    expect(dialog.getByRole('option', { name: 'Asha Rao (E1)' })).toBeInTheDocument();
    expect(listEmployees).toHaveBeenCalledTimes(1);
    lists.designations([]);
    lists.departments([]);
    await waitFor(() => expect(dialog.getByLabelText(ht.department)).toBeEnabled());

    await user.type(dialog.getByLabelText(ht.fullName), 'Bina Shah');
    await user.type(dialog.getByLabelText(ht.workEmail), 'bina@example.test');
    await user.selectOptions(dialog.getByLabelText(ht.branch), 'b2');
    await user.selectOptions(dialog.getByLabelText(ht.employmentTypeLabel), 'PART_TIME');
    await user.type(dialog.getByLabelText(ht.joiningDate), '2026-12-01');
    await user.click(dialog.getByRole('button', { name: ht.addAnother }));

    // Still open: who was added is said, the person's own fields are empty, the placement is kept, the name has focus.
    expect(await dialog.findByText(ht.addedOne('Bina Shah', 'EMP-001'))).toBeInTheDocument();
    expect(dialog.getByLabelText(ht.fullName)).toHaveValue('');
    expect(dialog.getByLabelText(ht.fullName)).toHaveFocus();
    expect(dialog.getByLabelText(ht.workEmail)).toHaveValue('');
    expect(dialog.getByLabelText(ht.branch)).toHaveValue('b2');
    expect(dialog.getByLabelText(ht.employmentTypeLabel)).toHaveValue('PART_TIME');
    expect(dialog.getByLabelText(ht.joiningDate)).toHaveValue('2026-12-01');

    // The next person can report to the one just added.
    await user.type(dialog.getByLabelText(ht.fullName), 'Chetan Iyer');
    await user.type(dialog.getByLabelText(ht.workEmail), 'has.account@example.test');
    await user.selectOptions(dialog.getByLabelText(ht.manager), 'new1');
    await user.click(dialog.getByRole('button', { name: ht.addAnother }));
    // They have an account: the access step is not offered in this mode, and the line says where to give it.
    expect(await dialog.findByText(ht.addedOneLinked('Chetan Iyer', 'EMP-002'))).toBeInTheDocument();

    expect(calls.map((c) => [c.action, c.fullName, c.branchId, c.employmentType, c.joiningDate, c.managerId])).toEqual([
      ['employees-create', 'Bina Shah', 'b2', 'PART_TIME', '2026-12-01', null],
      ['employees-create', 'Chetan Iyer', 'b2', 'PART_TIME', '2026-12-01', 'new1'],
    ]);
    // Two people, two requests: never one request id replayed.
    expect(new Set(calls.map((c) => c.requestId)).size).toBe(2);

    // Nothing was read again while adding; closing reads the directory once (the roles not at all).
    expect(listEmployees).toHaveBeenCalledTimes(1);
    await user.click(dialog.getByRole('button', { name: t.close }));
    await waitFor(() => expect(listEmployees).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(listStaff).toHaveBeenCalledTimes(1);
  });

  it('stays open on Escape while a person is being added, so the addition is said and the list read again', async () => {
    const user = userEvent.setup();
    let answer = () => undefined as void;
    hold = new Promise((r) => (answer = r));
    page();
    await screen.findByRole('link', { name: 'Asha Rao' });
    await user.click(screen.getByRole('button', { name: ht.addEmployee }));
    const dialog = within(screen.getByRole('dialog'));
    await user.type(dialog.getByLabelText(ht.fullName), 'Bina Shah');
    await user.click(dialog.getByRole('button', { name: ht.addAnother }));
    await waitFor(() => expect(calls).toHaveLength(1));

    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.mouseDown(screen.getByRole('dialog').parentElement!);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    answer();
    expect(await dialog.findByText(ht.addedOne('Bina Shah', 'EMP-001'))).toBeInTheDocument();
    expect(listEmployees).toHaveBeenCalledTimes(1);

    // Once the answer is in, Escape closes as usual and the directory is read again for the person added.
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(listEmployees).toHaveBeenCalledTimes(2));
  });

  it('keeps the current department, job title and manager on show while the lists load when editing', async () => {
    const employee = person('e9', 'Dev Nair', { departmentId: 'd1', departmentName: 'Circulation', designationId: 'g1', designationName: 'Librarian', managerId: 'e1', managerName: 'Asha Rao' });
    const onSaved = vi.fn();
    render(<EmployeeDialog org={{ id: 'o1', name: 'Org', type: 'CORPORATE', status: 'ACTIVE' }} employee={employee} onClose={() => undefined} onSaved={onSaved} />);

    expect(screen.getByLabelText(ht.department)).toHaveDisplayValue('Circulation');
    expect(screen.getByLabelText(ht.designation)).toHaveDisplayValue('Librarian');
    expect(screen.getByLabelText(ht.manager)).toHaveDisplayValue('Asha Rao');
    expect(screen.getByLabelText(ht.manager)).toBeDisabled();
    // Editing has one save button only, and reads the directory itself.
    expect(screen.queryByRole('button', { name: ht.addAnother })).not.toBeInTheDocument();
    expect(listEmployees).toHaveBeenCalledTimes(1);

    lists.designations([{ id: 'g1', name: 'Librarian', status: 'ACTIVE' }]);
    lists.departments([{ id: 'd1', name: 'Circulation', branchId: null, status: 'ACTIVE' }]);
    await waitFor(() => expect(screen.getByLabelText(ht.manager)).toBeEnabled());
    expect(screen.getByLabelText(ht.manager)).toHaveDisplayValue('Asha Rao (E1)');
    expect(screen.getByLabelText(ht.department)).toHaveDisplayValue('Circulation');
  });
});
