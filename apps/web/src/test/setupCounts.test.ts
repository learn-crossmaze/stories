import { beforeEach, describe, expect, it, vi } from 'vitest';

// The small reads behind the Master control counts: one row or one count each, in the shapes the security rules
// are tested with (firebase/rules-tests/setupCounts.rules.test.mjs).
type Asked = { path: string; filters: { field: string; value: unknown }[] };
const world = vi.hoisted(() => ({
  rows: [] as Asked[],
  counts: [] as Asked[],
  /** How many documents a path holds for the question asked. */
  found: (() => 0) as (asked: Asked) => number,
}));

vi.mock('../data/services', () => ({ services: () => ({ db: {}, fns: {} }) }));
vi.mock('firebase/firestore', async (importOriginal) => ({
  ...(await importOriginal<typeof import('firebase/firestore')>()),
  collection: (_db: unknown, path: string) => ({ path }),
  query: (col: { path: string }, ...filters: unknown[]) => ({ path: col.path, filters }),
  where: (field: string, _op: string, value: unknown) => ({ field, value }),
  limit: (n: number) => ({ field: 'limit', value: n }),
  getDocs: async (q: Asked) => {
    world.rows.push(q);
    return { empty: world.found(q) === 0 };
  },
  getCountFromServer: async (q: Asked) => {
    world.counts.push(q);
    return { data: () => ({ count: world.found(q) }) };
  },
}));

const { draftTemplateCount, hasHolidays, payrollOnBuiltInValues } = await import('../data/setupCounts');

beforeEach(() => {
  world.rows.length = 0;
  world.counts.length = 0;
  world.found = () => 0;
});

describe('the reads behind the Master control counts', () => {
  it('asks for one holiday of the year, not the year’s list', async () => {
    world.found = (q) => (q.filters[0].value === '2026' ? 1 : 0);
    expect(await hasHolidays('o1', '2026')).toBe(true);
    expect(await hasHolidays('o1', '2027')).toBe(false);
    expect(world.rows[0]).toEqual({ path: 'orgs/o1/holidays', filters: [{ field: 'year', value: '2026' }, { field: 'limit', value: 1 }] });
  });

  it('counts the letter templates never published, without reading them', async () => {
    world.found = () => 3;
    expect(await draftTemplateCount('o1')).toBe(3);
    expect(world.counts).toEqual([{ path: 'orgs/o1/letterTemplates', filters: [{ field: 'status', value: 'DRAFT' }] }]);
    expect(world.rows).toEqual([]);
  });

  it('payroll settings saved: nothing more is asked', async () => {
    world.found = () => 1;
    expect(await payrollOnBuiltInValues('o1')).toBe(false);
    expect(world.rows).toEqual([{ path: 'orgs/o1/payrollSettings', filters: [{ field: 'limit', value: 1 }] }]);
  });

  it('payroll settings never saved: it matters only once somebody has a salary', async () => {
    world.found = (q) => (q.path.endsWith('/salaries') ? 1 : 0);
    expect(await payrollOnBuiltInValues('o1')).toBe(true);
    expect(world.rows.map((q) => q.path)).toEqual(['orgs/o1/payrollSettings', 'orgs/o1/salaries']);
    expect(world.rows[1].filters).toEqual([{ field: 'limit', value: 1 }]);
    world.found = () => 0;
    expect(await payrollOnBuiltInValues('o1')).toBe(false);
  });
});
