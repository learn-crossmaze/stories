import { act, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Employee } from '../data/hr';
import type { OnboardingState } from '../data/selfOnboarding';
import { ht } from '../strings/hr';

// My profile shows the person's own record from the shell's one shared read; whatever changes it there makes
// everything showing it read again once.
const load = vi.fn<(orgId: string, uid: string) => Promise<OnboardingState>>();
const myEmployee = vi.fn();
const seen = vi.hoisted(() => ({ card: null as { me?: unknown; onPunched?: unknown } | null, documents: null as null | (() => void), checklist: null as null | { list: string; onChanged: () => void } }));

vi.mock('../data/services', () => ({ services: () => ({ db: {}, fns: {} }) }));
vi.mock('firebase/functions', () => ({ httpsCallable: () => async () => ({ data: {} }) }));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ user: { uid: 'u1' }, claims: { v: 1, sa: false, o: {} } }) }));
vi.mock('../admin/Workspace', () => ({ useWorkspace: () => ({ org: { id: 'o1' }, branchName: (id: string) => id }) }));
vi.mock('../data/selfOnboarding', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../data/selfOnboarding')>()),
  myOnboardingState: (orgId: string, uid: string) => load(orgId, uid),
}));
vi.mock('../data/hr', async (importOriginal) => ({ ...(await importOriginal<typeof import('../data/hr')>()), myEmployee: (...a: unknown[]) => myEmployee(...a) }));
vi.mock('../data/attendance', async (o) => ({ ...(await o<typeof import('../data/attendance')>()), employeeMonth: async () => [] }));
vi.mock('../data/leave', async (o) => ({ ...(await o<typeof import('../data/leave')>()), listLeaveTypes: async () => [], leaveBalance: async () => null, employeeRequests: async () => [] }));
vi.mock('../data/payroll', async (o) => ({ ...(await o<typeof import('../data/payroll')>()), employeePayslips: async () => [] }));
vi.mock('../admin/people/MyAttendance', () => ({
  CheckInCard: (props: { me?: unknown; onPunched?: unknown }) => {
    seen.card = props;
    return null;
  },
}));
vi.mock('../admin/people/EmployeeDocuments', () => ({
  EmployeeDocumentsPanel: ({ onChanged }: { onChanged: () => void }) => {
    seen.documents = onChanged;
    return null;
  },
}));
vi.mock('../admin/people/employeePanels', () => ({
  Checklist: (props: { list: string; onChanged: () => void }) => {
    seen.checklist = props;
    return null;
  },
}));
vi.mock('../admin/people/EmployeePhoto', () => ({ EmployeePhoto: () => null }));
vi.mock('../admin/people/payrollKit', () => ({ PayslipButton: () => null }));

const { OnboardingProvider } = await import('../admin/people/OnboardingReminder');
const { MyProfilePage } = await import('../admin/people/MyProfile');

const employee = (more: Partial<Employee> = {}) => ({ id: 'e1', uid: 'u1', code: 'EMP-1', fullName: 'Asha Rao', status: 'ACTIVE', employmentType: 'FULL_TIME', ...more }) as Employee;
const show = () =>
  render(
    <MemoryRouter>
      <OnboardingProvider>
        <MyProfilePage />
      </OnboardingProvider>
    </MemoryRouter>,
  );
const settle = () => act(async () => undefined);

beforeEach(() => {
  load.mockReset();
  myEmployee.mockReset();
  Object.assign(seen, { card: null, documents: null, checklist: null });
});

describe('My profile on the shared record', () => {
  it('opens from the shell’s read, with no read of the record of its own, and hands it to the check-in card', async () => {
    const e = employee();
    load.mockResolvedValue({ employee: e, status: null });
    show();
    await settle();
    expect(screen.getByRole('heading', { level: 1, name: 'Asha Rao' })).toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(1);
    expect(myEmployee).not.toHaveBeenCalled();
    expect(seen.card?.me).toBe(e);
    expect(typeof seen.card?.onPunched).toBe('function');
  });

  it('still shows someone who is leaving, with their checklist', async () => {
    load.mockResolvedValue({ employee: employee({ status: 'OFFBOARDING', offboarding: [{ key: 'a' }] as Employee['offboarding'] }), status: null });
    show();
    await settle();
    expect(screen.getByRole('heading', { level: 1, name: 'Asha Rao' })).toBeInTheDocument();
    expect(seen.checklist?.list).toBe('offboarding');
  });

  it('says so when there is no employee record', async () => {
    load.mockResolvedValue({ employee: null, status: null });
    show();
    await settle();
    expect(screen.getByText(ht.noEmployeeRecord)).toBeInTheDocument();
  });

  it('reads the shared record again once after a document or checklist change, keeping the page', async () => {
    load.mockResolvedValue({ employee: employee({ status: 'ONBOARDING', onboarding: [{ key: 'a' }] as Employee['onboarding'] }), status: null });
    show();
    await settle();
    load.mockResolvedValue({ employee: employee({ status: 'ONBOARDING', fullName: 'Asha R. Rao', onboarding: [{ key: 'a' }] as Employee['onboarding'] }), status: null });
    act(() => seen.documents!());
    expect(screen.getByRole('heading', { level: 1, name: 'Asha Rao' })).toBeInTheDocument();
    await settle();
    expect(load).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('heading', { level: 1, name: 'Asha R. Rao' })).toBeInTheDocument();
    act(() => seen.checklist!.onChanged());
    await settle();
    expect(load).toHaveBeenCalledTimes(3);
  });
});
