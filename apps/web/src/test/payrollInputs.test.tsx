import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { MonthInputs, PayrollRun, Payslip } from '../data/payroll';
import { t } from '../strings';
import { ht } from '../strings/hr';

// Payroll inputs (TDS and extras) with the server faked at the Cloud Functions boundary and the reads in the data layer.
type Sent = Record<string, unknown> & { action: string; requestId: string };

const world = vi.hoisted(() => ({
  calls: [] as unknown[],
  run: null as unknown,
  slips: [] as unknown[],
  /** Saved inputs by "employeeId_month". */
  inputs: {} as Record<string, unknown>,
  /** Holds back the answer to reads of the inputs until it resolves. */
  gate: null as Promise<void> | null,
  /** The same for reads of the run. */
  runGate: null as Promise<void> | null,
  reads: { run: 0, slips: 0, inputs: [] as string[] },
}));
const calls = world.calls as Sent[];

vi.mock('firebase/functions', () => ({
  httpsCallable: () => async (data: Sent) => {
    world.calls.push(data);
    return { data: {} };
  },
}));
vi.mock('../data/services', () => ({ services: () => ({ fns: {}, db: {} }) }));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ claims: { v: 1, sa: true, o: {} }, user: { uid: 'me' } }) }));
vi.mock('../admin/Workspace', () => ({ useWorkspace: () => ({ org: { id: 'o1' }, branch: { id: 'b1', name: 'Central' }, myBranches: [{ id: 'b1', name: 'Central' }] }) }));
vi.mock('../data/attendance', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../data/attendance')>()),
  monthLock: async () => ({ status: 'FINALIZED' }),
}));
vi.mock('../data/payroll', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../data/payroll')>()),
  getRun: async () => {
    world.reads.run++;
    await world.runGate;
    return world.run;
  },
  runPayslips: async () => (world.reads.slips++, [...world.slips]),
  getInputs: async (_org: string, employeeId: string, month: string) => {
    world.reads.inputs.push(`${employeeId}_${month}`);
    await world.gate;
    return world.inputs[`${employeeId}_${month}`] ?? null;
  },
}));

const { previousMonth } = await import('../data/attendance');
const { monthName } = await import('../data/payroll');
const { PayrollPage } = await import('../admin/people/Payroll');
const { monthIST } = await import('../shared/dates');

const month = previousMonth(monthIST());
const before = previousMonth(month);
const run = (over: Partial<PayrollRun> = {}) =>
  ({ id: `${month}_b1`, month, branchId: 'b1', status: 'DRAFT', stale: false, employees: 1, totals: { gross: 30000, deductions: 2000, net: 28000, employerCost: 33000 }, problems: [], problemCount: 0, settingsFrom: '2000-01', preparedBy: 'someone', preparedByEmail: 'hr@stories.test', submittedBy: null, submittedByEmail: null, approvedByEmail: null, rejectNote: null, preparedAt: null, ...over }) as PayrollRun;
const slip = { id: `e1_${month}`, employeeId: 'e1', employeeName: 'Asha Rao', employeeUid: 'u1', month, days: { inMonth: 30, payable: 30 }, gross: 30000, deductions: 2000, net: 28000, tds: 0, missingSalary: false } as Payslip;
const title = ht.inputsTitle('Asha Rao', monthName(month));

async function open() {
  render(
    <MemoryRouter>
      <PayrollPage />
    </MemoryRouter>,
  );
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: `${ht.inputs} Asha Rao` }));
  return user;
}

beforeEach(() => {
  calls.length = 0;
  world.run = run();
  world.slips = [slip];
  world.inputs = {};
  world.gate = null;
  world.runGate = null;
  world.reads = { run: 0, slips: 0, inputs: [] };
});

describe('TDS and extras', () => {
  it('opens at once, reads this month and last month together, and offers last month’s TDS as unsaved', async () => {
    let letGo: () => void = () => undefined;
    world.gate = new Promise<void>((resolve) => (letGo = resolve));
    world.inputs[`e1_${before}`] = { tds: 1500, otherEarnings: [{ name: 'Diwali bonus', amount: 5000 }], otherDeductions: [] } as MonthInputs;
    const user = await open();
    // The dialog is there while the inputs are still on their way.
    const dialog = screen.getByRole('dialog', { name: title });
    expect(within(dialog).queryByLabelText(ht.tds)).toBeNull();
    expect(world.reads.inputs.sort()).toEqual([`e1_${before}`, `e1_${month}`].sort());

    letGo();
    const tds = await within(dialog).findByLabelText(ht.tds);
    expect(tds).toHaveValue(1500);
    await waitFor(() => expect(tds).toHaveFocus());
    expect(within(dialog).getByText(ht.tdsCopied(monthName(before)))).toBeInTheDocument();
    // One-off lines are never carried over.
    expect(within(dialog).queryByDisplayValue('Diwali bonus')).toBeNull();
    // Once changed it is no longer "copied".
    await user.clear(tds);
    await user.type(tds, '1800');
    expect(within(dialog).queryByText(ht.tdsCopied(monthName(before)))).toBeNull();
  });

  it('shows what is saved for the month, not last month’s', async () => {
    world.inputs[`e1_${before}`] = { tds: 1500, otherEarnings: [], otherDeductions: [] } as MonthInputs;
    world.inputs[`e1_${month}`] = { tds: 0, otherEarnings: [{ name: 'Arrears', amount: 900 }], otherDeductions: [] } as MonthInputs;
    await open();
    const dialog = screen.getByRole('dialog', { name: title });
    expect(await within(dialog).findByLabelText(ht.tds)).toHaveValue(0);
    expect(within(dialog).getByDisplayValue('Arrears')).toBeInTheDocument();
    expect(within(dialog).queryByText(ht.tdsCopied(monthName(before)))).toBeNull();
  });

  it('after a save the run is read again but not the payslips, and it counts as out of date at once', async () => {
    const user = await open();
    expect(screen.getByRole('button', { name: ht.submitRun })).toBeInTheDocument();
    expect(world.reads).toMatchObject({ run: 1, slips: 1 });
    const dialog = screen.getByRole('dialog', { name: title });
    const tds = await within(dialog).findByLabelText(ht.tds);
    await user.clear(tds);
    await user.type(tds, '1200');
    // The run is read again after the save; while that read is on its way the page must not offer Submit.
    let letGo: () => void = () => undefined;
    world.runGate = new Promise<void>((resolve) => (letGo = resolve));
    world.run = run({ stale: true });
    await user.click(within(dialog).getByRole('button', { name: t.save }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ action: 'payroll-setInputs', employeeId: 'e1', month, tds: 1200, otherEarnings: [], otherDeductions: [] });
    await waitFor(() => expect(world.reads.run).toBe(2));
    expect(screen.queryByRole('button', { name: ht.submitRun })).toBeNull();
    expect(screen.getByText(ht.runStale)).toBeInTheDocument();
    letGo();
    await waitFor(() => expect(screen.getByRole('button', { name: ht.prepareAgain })).toHaveClass('btn-filled'));
    expect(screen.queryByRole('button', { name: ht.submitRun })).toBeNull();
    expect(world.reads.slips).toBe(1);
    // The payslips stay on screen throughout.
    expect(screen.getByRole('link', { name: 'Asha Rao' })).toBeInTheDocument();
  });
});
