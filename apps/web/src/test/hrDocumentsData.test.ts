import { beforeEach, describe, expect, it, vi } from 'vitest';

// The documents queue in the data layer: the counts for the menu ask the same questions as the lists (so the
// same database indexes answer them), and a person's roles are read as one document.
type Part = { kind: string; field?: string; op?: string; value?: unknown };
const world = vi.hoisted(() => ({
  /** Every question put to the database: 'count' or 'list', and what it filtered and ordered by. */
  asked: [] as { how: 'count' | 'list'; parts: Part[] }[],
  /** Counts answered, by the status asked for. */
  counts: {} as Record<string, number>,
  /** Answers held back, to see that the questions are put together and not one after another. */
  hold: [] as (() => void)[] | null,
  member: null as null | Record<string, unknown> | Error,
}));

vi.mock('../data/services', () => ({ services: () => ({ db: {}, fns: {} }) }));
vi.mock('firebase/firestore', async (importOriginal) => ({
  ...(await importOriginal<typeof import('firebase/firestore')>()),
  collectionGroup: (_db: unknown, name: string) => ({ kind: 'group', value: name }),
  doc: (_db: unknown, path: string) => path,
  query: (base: Part, ...parts: Part[]) => [base, ...parts],
  where: (field: string, op: string, value: unknown) => ({ kind: 'where', field, op, value }),
  orderBy: (field: string, dir = 'asc') => ({ kind: 'orderBy', field, value: dir }),
  limit: (n: number) => ({ kind: 'limit', value: n }),
  getCountFromServer: async (parts: Part[]) => {
    world.asked.push({ how: 'count', parts });
    if (world.hold) await new Promise<void>((go) => world.hold!.push(go));
    const status = String(parts.find((p) => p.field === 'status')?.value);
    return { data: () => ({ count: world.counts[status] ?? 0 }) };
  },
  getDocs: async (parts: Part[]) => {
    world.asked.push({ how: 'list', parts });
    return { docs: [{ id: 'd1', data: () => ({ status: 'PENDING', uploadedBy: 'someone' }) }] };
  },
  getDoc: async () => {
    if (world.member instanceof Error) throw world.member;
    return { exists: () => !!world.member, data: () => world.member };
  },
}));

const { documentQueueCounts, pendingDocuments } = await import('../data/hrDocuments');
const { getStaffMember } = await import('../data/org');
const { todayIST } = await import('../shared/dates');

const shape = (parts: Part[]) => parts.map((p) => (p.kind === 'where' ? `${p.field} ${p.op} ${JSON.stringify(p.value)}` : `${p.kind} ${p.field ?? ''} ${String(p.value)}`.replace('  ', ' ')));

beforeEach(() => {
  world.asked.length = 0;
  world.counts = {};
  world.hold = null;
  world.member = null;
});

describe('documentQueueCounts', () => {
  it('counts what waits and what has expired in one go, without reading the documents', async () => {
    world.counts = { PENDING: 4, EXPIRED: 2, VERIFIED: 1 };
    world.hold = [];
    const counting = documentQueueCounts('o1', 'ALL');
    // All three questions are out before any is answered.
    await vi.waitFor(() => expect(world.hold).toHaveLength(3));
    world.hold.forEach((go) => go());
    // Expired: marked so, plus verified ones whose date has passed and that the nightly job has not marked yet.
    expect(await counting).toEqual({ pending: 4, expired: 3 });
    expect(world.asked.every((a) => a.how === 'count')).toBe(true);
    // Each keeps the ordering of the list it counts (the indexes serve these shapes only), and the lists' cap.
    expect(world.asked.map((a) => shape(a.parts))).toEqual([
      ['group documents', 'orgId == "o1"', 'status == "PENDING"', 'orderBy uploadedAt asc', 'limit 200'],
      ['group documents', 'orgId == "o1"', 'status == "EXPIRED"', 'orderBy expiresOn desc', 'limit 200'],
      ['group documents', 'orgId == "o1"', 'status == "VERIFIED"', `expiresOn < "${todayIST()}"`, 'orderBy expiresOn asc', 'limit 200'],
    ]);
  });

  it("keeps a branch-scoped viewer's questions to their branches", async () => {
    await documentQueueCounts('o1', ['b1', 'b2']);
    for (const a of world.asked) expect(shape(a.parts)).toContain('branchId in ["b1","b2"]');
  });
});

describe('pendingDocuments', () => {
  it('reads the waiting documents only, in the order of the queue', async () => {
    const docs = await pendingDocuments('o1', 'ALL');
    expect(docs.map((d) => d.id)).toEqual(['d1']);
    expect(world.asked.map((a) => [a.how, shape(a.parts)])).toEqual([
      ['list', ['group documents', 'orgId == "o1"', 'status == "PENDING"', 'orderBy uploadedAt asc', 'limit 200']],
    ]);
  });
});

describe('getStaffMember', () => {
  it("returns the person's roles", async () => {
    world.member = { uid: 'u1', orgId: 'o1', roles: ['LIBRARIAN'], branchIds: ['b1'], status: 'ACTIVE' };
    expect(await getStaffMember('o1', 'u1')).toMatchObject({ uid: 'u1', roles: ['LIBRARIAN'] });
  });

  it('reads no roles, or roles the viewer may not see, as none', async () => {
    expect(await getStaffMember('o1', 'u1')).toBeNull();
    // A membership that is not there is refused by the rules rather than reported missing.
    world.member = Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' });
    expect(await getStaffMember('o1', 'u1')).toBeNull();
  });

  it('passes any other failure on', async () => {
    world.member = Object.assign(new Error('offline'), { code: 'unavailable' });
    await expect(getStaffMember('o1', 'u1')).rejects.toThrow('offline');
  });
});
