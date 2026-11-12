import { beforeEach, describe, expect, it, vi } from 'vitest';

// Member search: the words a query is turned into, how the matches are narrowed and ordered, and which
// questions are put to the database.
const world = vi.hoisted(() => ({ asked: [] as string[], answers: {} as Record<string, unknown[]> }));

vi.mock('../data/services', () => ({ services: () => ({ db: {} }) }));
vi.mock('firebase/firestore', async (importOriginal) => ({
  ...(await importOriginal<typeof import('firebase/firestore')>()),
  collection: () => ({}),
  query: (_collection: unknown, ...constraints: unknown[]) => constraints,
  where: (field: string, op: string, value: unknown) => ({ field, op, value }),
  limit: (n: number) => ({ limit: n }),
  getDocs: async (constraints: { field?: string; op?: string; value?: unknown; limit?: number }[]) => {
    // The rules read homeBranchId: every search must ask for one branch, and for 50 at most.
    expect(constraints).toContainEqual({ field: 'homeBranchId', op: '==', value: 'b1' });
    expect(constraints).toContainEqual({ limit: 50 });
    const word = constraints.find((c) => c.op === 'array-contains')!.value as string;
    world.asked.push(word);
    return { docs: (world.answers[word] ?? []).map((m) => ({ id: (m as { id: string }).id, data: () => m })) };
  },
}));

const { memberQueryWords, narrowMembers, searchMembers } = await import('../data/members');

/** The words the server stores for a member (functions/src/catalogue/search.ts): each word and its starts, 2 to 12 long. */
function tokens(...fields: string[]) {
  const out = new Set<string>();
  for (const field of fields) {
    for (const word of field.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(' ')) {
      if (!word) continue;
      out.add(word);
      for (let n = 2; n < Math.min(word.length, 13); n++) out.add(word.slice(0, n));
    }
  }
  return [...out];
}
const member = (id: string, fullName: string, code: string, phone = '') => ({ id, fullName, code, searchTokens: tokens(fullName, code, phone) });

beforeEach(() => {
  world.asked.length = 0;
  world.answers = {};
});

describe('member search words', () => {
  it('keeps a mobile number that itself starts with 91', () => {
    expect(memberQueryWords('9123456789')).toEqual(['9123456789']);
    expect(memberQueryWords('9198')).toEqual(['9198']);
    expect(memberQueryWords('91')).toEqual(['91']);
  });

  it('reads a mobile number as one word however it is typed, without the country code', () => {
    expect(memberQueryWords('+91 98765 43210')).toEqual(['9876543210']);
    expect(memberQueryWords('919876543210')).toEqual(['9876543210']);
    expect(memberQueryWords('09876543210')).toEqual(['9876543210']);
    expect(memberQueryWords('98765 43210')).toEqual(['9876543210']);
    expect(memberQueryWords('(98765) 432-10')).toEqual(['9876543210']);
    // Half typed: the country code goes as soon as it is clear, so the list narrows on every key.
    expect(memberQueryWords('+9198')).toEqual(['98']);
    expect(memberQueryWords('+91 9')).toEqual([]);
    expect(memberQueryWords('+')).toEqual([]);
  });

  it('leaves other countries’ numbers whole', () => {
    expect(memberQueryWords('+1 415 555 0123')).toEqual(['14155550123']);
    expect(memberQueryWords('+44 20 7946 0958 77')).toEqual(['442079460958']); // capped like the index
  });

  it('uses every word of a name or a code, longest first, and drops single letters', () => {
    expect(memberQueryWords('priya sharma')).toEqual(['sharma', 'priya']);
    expect(memberQueryWords('KOR-M000123')).toEqual(['m000123', 'kor']);
    expect(memberQueryWords('KOR-M')).toEqual(['kor']);
    expect(memberQueryWords('MEM-000123')).toEqual(['000123', 'mem']);
    expect(memberQueryWords('asha 98765')).toEqual(['98765', 'asha']); // not a phone number on its own: two words
    expect(memberQueryWords('Émile  émile x')).toEqual(['emile']);
    expect(memberQueryWords(' a ')).toEqual([]);
  });

  it('caps each word at the 12 characters the index keeps', () => {
    expect(memberQueryWords('Venkatanarasimharajuvaripeta')).toEqual(['venkatanaras']);
  });
});

describe('narrowing and order', () => {
  const rows = [
    member('1', 'Priya Sharma', 'KOR-M000002', '9876543210'),
    member('2', 'Anil Sharma', 'KOR-M000001', '9123456789'),
    member('3', 'Priya Nair', 'KOR-M000123'),
    member('4', 'Zoya Khan', 'KOR-M0001234'),
  ];
  const names = (q: string) => narrowMembers(rows, q).map((m) => m.fullName);

  it('keeps members who match every word, by name', () => {
    expect(names('sharma')).toEqual(['Anil Sharma', 'Priya Sharma']);
    expect(names('priya sharma')).toEqual(['Priya Sharma']);
    expect(names('sha pri')).toEqual(['Priya Sharma']);
    expect(names('priya 98765')).toEqual(['Priya Sharma']);
    expect(names('9123456789')).toEqual(['Anil Sharma']);
    expect(names('priya khan')).toEqual([]);
  });

  it('puts the member whose code was typed in full first', () => {
    expect(names('kor-m000123')).toEqual(['Priya Nair', 'Zoya Khan']);
    expect(names('KOR')).toEqual(['Anil Sharma', 'Priya Nair', 'Priya Sharma', 'Zoya Khan']);
  });

  it('drops a row without stored words rather than guess', () => {
    expect(narrowMembers([{ fullName: 'Old Row', code: 'X-1' }], 'old')).toEqual([]);
  });
});

describe('searching', () => {
  const kumars = Array.from({ length: 50 }, (_, n) => member(`k${n}`, `Kumar ${n} Kumar`, `KOR-M1${String(n).padStart(5, '0')}`));
  const anil = member('a1', 'Anil Kumar', 'KOR-M000777');

  it('asks the database for the longest word only, and narrows by the rest here', async () => {
    world.answers = { sharma: [member('1', 'Priya Sharma', 'KOR-M000002'), member('2', 'Anil Sharma', 'KOR-M000001')] };
    expect((await searchMembers('o1', 'b1', 'priya sharma')).map((m) => m.id)).toEqual(['1']);
    expect(world.asked).toEqual(['sharma']);
  });

  it('a scanned card never asks for the branch code, which every member matches', async () => {
    world.answers = { m000123: [member('3', 'Priya Nair', 'KOR-M000123')] };
    expect((await searchMembers('o1', 'b1', 'KOR-M000123')).map((m) => m.id)).toEqual(['3']);
    expect(world.asked).toEqual(['m000123']);
  });

  it('asks by the next word too when a common name fills the page', async () => {
    world.answers = { kumar: kumars, anil: [anil, member('a2', 'Anil Rao', 'KOR-M000778')] };
    expect((await searchMembers('o1', 'b1', 'anil kumar')).map((m) => m.id)).toEqual(['a1']);
    expect(world.asked).toEqual(['kumar', 'anil']);
  });

  it('asks nothing for a query with no word to search by', async () => {
    expect(await searchMembers('o1', 'b1', '+91')).toEqual([]);
    expect(await searchMembers('o1', 'b1', 'x')).toEqual([]);
    expect(world.asked).toEqual([]);
  });
});
