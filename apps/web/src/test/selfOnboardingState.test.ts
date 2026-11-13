import { beforeEach, describe, expect, it, vi } from 'vitest';

// What the shell's one shared read asks for: the person's own record, and what is missing only while there is
// something for them to fill in.
const read = vi.hoisted(() => ({
  myEmployee: vi.fn(),
  forgetMyEmployee: vi.fn(),
  getPrivateProfile: vi.fn(),
  employeeDocuments: vi.fn(),
  listDocumentTypes: vi.fn(),
  config: vi.fn(),
}));

vi.mock('../data/services', () => ({ services: () => ({ db: {}, fns: {} }) }));
vi.mock('firebase/functions', () => ({ httpsCallable: () => async () => ({ data: {} }) }));
vi.mock('firebase/firestore', async (importOriginal) => ({
  ...(await importOriginal<typeof import('firebase/firestore')>()),
  doc: (_db: unknown, path: string) => ({ path }),
  getDoc: async (ref: { path: string }) => ({ data: () => read.config(ref.path) }),
}));
vi.mock('../data/hr', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../data/hr')>()),
  myEmployee: read.myEmployee,
  forgetMyEmployee: read.forgetMyEmployee,
  getPrivateProfile: read.getPrivateProfile,
}));
vi.mock('../data/hrDocuments', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../data/hrDocuments')>()),
  employeeDocuments: read.employeeDocuments,
  listDocumentTypes: read.listDocumentTypes,
}));

const { myOnboarding, myOnboardingState, ONBOARDING_CHANGED, onboardingChanged } = await import('../data/selfOnboarding');

beforeEach(() => {
  for (const f of Object.values(read)) f.mockReset();
  read.myEmployee.mockResolvedValue({ id: 'e1', uid: 'u1', status: 'ACTIVE', photoUrl: null });
  read.getPrivateProfile.mockResolvedValue({ pan: 'ABCDE1234F' });
  read.config.mockReturnValue({ selfOnboardingFields: ['pan', 'photo'] });
  read.listDocumentTypes.mockResolvedValue([
    { id: 'pan-card', name: 'PAN card', status: 'ACTIVE', required: true, selfUpload: true },
    { id: 'medical', name: 'Medical certificate', status: 'ACTIVE', required: false, selfUpload: true },
  ]);
  read.employeeDocuments.mockResolvedValue([{ typeId: 'pan-card', status: 'REJECTED', rejectReason: 'Blurred' }]);
});

describe('the person’s own record and self-onboarding status', () => {
  it('gives the record together with what is still missing', async () => {
    const s = await myOnboardingState('o1', 'u1');
    expect(s.employee?.id).toBe('e1');
    expect(s.status).toMatchObject({ total: 3, done: 1 });
    expect(s.status?.missing.map((i) => i.key)).toEqual(['photo', 'doc:pan-card']);
    expect(s.status?.missing[1].note).toContain('Blurred');
    // The person's own documents are asked for by account, as the rules require.
    expect(read.employeeDocuments).toHaveBeenCalledWith('o1', 'e1', 'u1');
    expect(await myOnboarding('o1', 'u1')).toMatchObject({ total: 3 });
  });

  it('keeps the record of someone who is leaving and reads nothing more (My profile still shows it)', async () => {
    read.myEmployee.mockResolvedValue({ id: 'e1', uid: 'u1', status: 'OFFBOARDING' });
    expect(await myOnboardingState('o1', 'u1')).toEqual({ employee: { id: 'e1', uid: 'u1', status: 'OFFBOARDING' }, status: null });
    for (const f of [read.getPrivateProfile, read.config, read.listDocumentTypes, read.employeeDocuments]) expect(f).not.toHaveBeenCalled();
  });

  it('has nothing for someone with no employee record here', async () => {
    read.myEmployee.mockResolvedValue(null);
    expect(await myOnboardingState('o1', 'u1')).toEqual({ employee: null, status: null });
    expect(await myOnboarding('o1', 'u1')).toBeNull();
  });

  it('a save forgets the record kept from before, then tells everyone showing it to read again', () => {
    const order: string[] = [];
    read.forgetMyEmployee.mockImplementation(() => order.push('forget'));
    const heard = () => order.push('event');
    window.addEventListener(ONBOARDING_CHANGED, heard);
    onboardingChanged();
    window.removeEventListener(ONBOARDING_CHANGED, heard);
    expect(order).toEqual(['forget', 'event']);
  });
});
