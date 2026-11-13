import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { OnboardingState } from '../data/selfOnboarding';
import { ht } from '../strings/hr';

// The signed-in person's own record and self-onboarding status: read once in the shell and shared by the banner,
// the menu count, the Dashboard, My profile and Complete my profile.
let org: { id: string } | null = { id: 'o1' };
let user: { uid: string } | null = { uid: 'u1' };
const load = vi.fn<(orgId: string, uid: string) => Promise<OnboardingState>>();

vi.mock('../data/services', () => ({ services: () => ({ db: {}, fns: {} }) }));
vi.mock('firebase/functions', () => ({ httpsCallable: () => async () => ({ data: {} }) }));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ user, claims: { v: 1, sa: false, o: {} } }) }));
vi.mock('../admin/Workspace', () => ({ useWorkspace: () => ({ org, branchName: (id: string) => id }) }));
vi.mock('../data/selfOnboarding', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../data/selfOnboarding')>()),
  myOnboardingState: (orgId: string, uid: string) => load(orgId, uid),
}));
// The page's heavier parts are not what is tested here.
vi.mock('../admin/people/EmployeeDocuments', () => ({ EmployeeDocumentsPanel: () => null }));
vi.mock('../admin/people/EmployeePhoto', () => ({ EmployeePhoto: () => null }));
vi.mock('../admin/people/employeeDialogs', () => ({ BankDialog: () => null }));

const { onboardingChanged } = await import('../data/selfOnboarding');
const { ONBOARDING_EVERY_MS, ONBOARDING_FRESH_MS, OnboardingProvider, useMyOnboarding, useMyOnboardingState } = await import('../admin/people/OnboardingReminder');
const { MyOnboardingPage } = await import('../admin/people/MyOnboarding');

const state = (missing: number, profile: Record<string, unknown> = {}, status = 'ACTIVE'): OnboardingState => {
  const employee = { id: 'e1', uid: 'u1', fullName: 'Asha Rao', status } as OnboardingState['employee'];
  const items = Array.from({ length: missing }, (_, i) => ({ key: `f${i}`, label: `Detail ${i}`, kind: 'field' as const, done: false, note: null }));
  return { employee, status: { employee: employee!, profile, required: ['personalPhone', 'pan'], items, missing: items, done: 0, total: missing } };
};

const show = (visibility: 'visible' | 'hidden') => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
  document.dispatchEvent(new Event('visibilitychange'));
};
/** Lets the reads under way answer. */
const settle = () => act(async () => undefined);

const seen: Record<string, ReturnType<typeof useMyOnboarding>> = {};
function Reader({ name }: { name: string }) {
  seen[name] = useMyOnboarding();
  return null;
}
let whole: ReturnType<typeof useMyOnboardingState>;
function RecordReader() {
  whole = useMyOnboardingState();
  return null;
}
const tree = (children: ReactNode) => <OnboardingProvider>{children}</OnboardingProvider>;
const three = () =>
  tree(
    <>
      <Reader name="banner" />
      <Reader name="menu" />
      <Reader name="dashboard" />
      <RecordReader />
    </>,
  );

beforeEach(() => {
  vi.useFakeTimers();
  org = { id: 'o1' };
  user = { uid: 'u1' };
  load.mockReset();
  load.mockResolvedValue(state(2));
  show('visible');
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('the shared self-onboarding status', () => {
  it('is read once, however many parts of the console show it', async () => {
    render(three());
    expect(seen.banner.loading).toBe(true);
    await settle();
    expect(load).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledWith('o1', 'u1');
    for (const name of ['banner', 'menu', 'dashboard']) expect(seen[name].data?.missing).toHaveLength(2);
    expect(whole.data?.employee?.id).toBe('e1');
  });

  it('is read again once when something is saved, with what is on screen kept meanwhile', async () => {
    render(three());
    await settle();
    let answer: (s: OnboardingState) => void = () => undefined;
    load.mockReturnValue(new Promise((r) => (answer = r)));
    // A photo upload announces itself twice (the page's own handler and the upload): still one read.
    act(() => {
      onboardingChanged();
      onboardingChanged();
    });
    expect(load).toHaveBeenCalledTimes(2);
    expect(seen.menu).toMatchObject({ loading: false, refreshing: true });
    expect(seen.menu.data?.missing).toHaveLength(2);
    await act(async () => answer(state(1)));
    // The banner, the menu count and the Dashboard change together.
    for (const name of ['banner', 'menu', 'dashboard']) expect(seen[name].data?.missing).toHaveLength(1);
    expect(seen.menu.refreshing).toBe(false);
  });

  it('keeps the record of someone who is leaving, with nothing to fill in', async () => {
    load.mockResolvedValue({ employee: { id: 'e1', status: 'OFFBOARDING' } as OnboardingState['employee'], status: null });
    render(three());
    await settle();
    expect(seen.banner).toMatchObject({ data: null, loading: false });
    expect(whole.data?.employee?.status).toBe('OFFBOARDING');
  });

  it('looks again when the tab comes back into view, unless it looked within 5 minutes', async () => {
    render(three());
    await settle();
    vi.advanceTimersByTime(ONBOARDING_FRESH_MS - 1_000);
    act(() => show('hidden'));
    act(() => show('visible'));
    expect(load).toHaveBeenCalledTimes(1);
    act(() => show('hidden'));
    vi.advanceTimersByTime(2_000);
    act(() => show('visible'));
    expect(load).toHaveBeenCalledTimes(2);
    await settle();
  });

  it('looks again every 10 minutes while the tab is in view, and not while it is out of view', async () => {
    render(three());
    await settle();
    await act(async () => vi.advanceTimersByTime(ONBOARDING_EVERY_MS));
    expect(load).toHaveBeenCalledTimes(2);
    show('hidden');
    await act(async () => vi.advanceTimersByTime(3 * ONBOARDING_EVERY_MS));
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('never shows one organization’s answer as another’s', async () => {
    const view = render(three());
    await settle();
    expect(seen.menu.data?.missing).toHaveLength(2);
    let answer: (s: OnboardingState) => void = () => undefined;
    load.mockReturnValue(new Promise((r) => (answer = r)));
    org = { id: 'o2' };
    view.rerender(three());
    expect(seen.menu.data).toBeUndefined();
    expect(whole.data).toBeUndefined();
    await act(async () => answer(state(0)));
    expect(load).toHaveBeenLastCalledWith('o2', 'u1');
    expect(seen.menu.data?.missing).toHaveLength(0);
  });

  it('shows nothing when the read fails (no banner, no count), and a later look can succeed', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    load.mockRejectedValueOnce(new Error('offline'));
    render(three());
    await settle();
    expect(seen.banner).toMatchObject({ data: undefined, loading: false });
    expect(seen.banner.error).toBeTruthy();
    act(() => onboardingChanged());
    await settle();
    expect(seen.banner.data?.missing).toHaveLength(2);
  });

  it('outside the shell there is simply no status', () => {
    render(<Reader name="alone" />);
    expect(seen.alone).toMatchObject({ data: null, loading: false, error: null });
    expect(load).not.toHaveBeenCalled();
  });
});

describe('Complete my profile on the shared status', () => {
  const phone = () => screen.getByLabelText(new RegExp(ht.personalPhone)) as HTMLInputElement;

  it('opens from the shell’s read without asking again', async () => {
    load.mockResolvedValue(state(2, { personalPhone: '9000000001' }));
    render(tree(<MyOnboardingPage />));
    await settle();
    expect(screen.getByRole('heading', { level: 1, name: ht.obTitle })).toBeInTheDocument();
    expect(phone().value).toBe('9000000001');
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('keeps what is being typed when the status is read again behind it', async () => {
    load.mockImplementation(async () => state(2, { personalPhone: '9000000001' }));
    render(tree(<MyOnboardingPage />));
    await settle();
    fireEvent.change(phone(), { target: { value: '98' } });
    // A document upload, the timer and coming back to the tab all read again: the same saved details come back.
    act(() => onboardingChanged());
    await settle();
    await act(async () => vi.advanceTimersByTime(ONBOARDING_EVERY_MS));
    await settle();
    expect(load.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(phone().value).toBe('98');
  });

  it('takes up saved details that really changed', async () => {
    load.mockResolvedValue(state(2, { personalPhone: '9000000001' }));
    render(tree(<MyOnboardingPage />));
    await settle();
    load.mockResolvedValue(state(1, { personalPhone: '9000000002' }));
    act(() => onboardingChanged());
    await settle();
    expect(phone().value).toBe('9000000002');
  });

  it('keeps the page when a read behind it fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    load.mockResolvedValueOnce(state(2, { personalPhone: '9000000001' }));
    render(tree(<MyOnboardingPage />));
    await settle();
    fireEvent.change(phone(), { target: { value: '98' } });
    load.mockRejectedValueOnce(new Error('offline'));
    act(() => onboardingChanged());
    await settle();
    expect(phone().value).toBe('98');
  });

  it('says so when the person has no employee record here', async () => {
    load.mockResolvedValue({ employee: null, status: null });
    render(tree(<MyOnboardingPage />));
    await settle();
    expect(screen.getByText(ht.noEmployeeRecord)).toBeInTheDocument();
  });
});
