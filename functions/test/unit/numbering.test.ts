import type { Transaction } from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';

import { DEFAULT_PATTERNS, existingCodes, LEGACY_PATTERNS, patternProblem, renderCode, reserveCodeBatch } from '../../src/core/numbering.js';

describe('numbering patterns', () => {
  it('accepts every default pattern', () => {
    for (const [kind, pattern] of Object.entries(DEFAULT_PATTERNS)) {
      expect(patternProblem(kind as keyof typeof DEFAULT_PATTERNS, pattern)).toBeNull();
    }
  });

  it('renders the defaults', () => {
    expect(renderCode(DEFAULT_PATTERNS.book, {}, 12)).toBe('BOOK-000012');
    expect(renderCode(DEFAULT_PATTERNS.copy, { BOOK: '000012' }, 3)).toBe('BK000012-CP03');
    expect(renderCode(DEFAULT_PATTERNS.member, { BRANCH: 'CEN' }, 7)).toBe('CEN-M000007');
    expect(renderCode(DEFAULT_PATTERNS.location, { BRANCH: 'CEN', KIND: 'SH' }, 4)).toBe('CEN-SH-004');
    expect(renderCode(DEFAULT_PATTERNS.employee, { BRANCH: 'HO' }, 12)).toBe('HO-E0012');
  });

  it('still renders the earlier defaults exactly as codes were numbered before', () => {
    for (const [kind, pattern] of Object.entries(LEGACY_PATTERNS)) expect(patternProblem(kind as keyof typeof LEGACY_PATTERNS, pattern)).toBeNull();
    expect(renderCode(LEGACY_PATTERNS.copy, { BOOK: '000012' }, 3)).toBe('COPY-000012-03');
    expect(renderCode(LEGACY_PATTERNS.member, {}, 7)).toBe('MEM-000007');
  });

  it('fills branch, shelf type and date tokens (India date)', () => {
    const at = new Date('2026-12-31T20:00:00Z'); // 1 Jan 2027, 01:30 in India
    expect(renderCode('{BRANCH}-{YY}{MM}-{SEQ:4}', { BRANCH: 'KOR' }, 5, at)).toBe('KOR-2701-0005');
    expect(renderCode('{KIND}-{SEQ:3}', { KIND: 'SH' }, 42)).toBe('SH-042');
    expect(renderCode('E{SEQ}', {}, 1234)).toBe('E1234');
  });

  it('rejects patterns without exactly one running number', () => {
    expect(patternProblem('member', 'MEM-')).toMatch(/exactly once/);
    expect(patternProblem('member', 'M{SEQ}{SEQ}')).toMatch(/exactly once/);
  });

  it('rejects tokens that make no sense for the kind, and bad characters', () => {
    expect(patternProblem('member', 'M-{BOOK}-{SEQ}')).toMatch(/can't be used here/);
    expect(patternProblem('book', '{BRANCH}-{SEQ}')).toMatch(/can't be used here/);
    expect(patternProblem('copy', 'copy_{SEQ}')).toMatch(/capital letters/);
    expect(patternProblem('copy', '{SEQ:0}')).toMatch(/1 to 9/);
  });

  it('rejects patterns that can outgrow the field', () => {
    expect(patternProblem('location', '{BRANCH}-{KIND}-{SEQ:6}')).toMatch(/longer than 16/);
    expect(patternProblem('location', '{KIND}{SEQ:3}')).toBeNull();
  });
});

/**
 * A stand-in for the transaction: counter documents (path -> next number),
 * with what was read in each `getAll` and what was written.
 */
function fakeTx(next: Record<string, number> = {}) {
  const reads: string[][] = [];
  const writes: Record<string, unknown> = {};
  const tx = {
    getAll: async (...refs: { path: string }[]) => {
      if (!refs.length) throw new Error('getAll needs at least one document');
      reads.push(refs.map((r) => r.path));
      return refs.map((r) => ({ exists: r.path in next, get: () => next[r.path] }));
    },
    set: (ref: { path: string }, data: unknown) => {
      writes[ref.path] = data;
    },
  };
  return { tx: tx as unknown as Transaction, reads, writes };
}

describe('codes for several titles received together', () => {
  const base = 'orgs/o1/counters';
  const line = (book: number, count: number) => ({ values: { BRANCH: 'CEN', BOOK: String(book).padStart(6, '0') }, count, bookCode: `BOOK-${String(book).padStart(6, '0')}` });

  it('each title carries on from its own counter, read once however often the title is listed', async () => {
    const { tx, reads, writes } = fakeTx({ [`${base}/copies-BOOK-000007`]: 5 });
    const batch = await reserveCodeBatch(tx, { kind: 'copy', pattern: DEFAULT_PATTERNS.copy, base, requests: [line(7, 2), line(9, 3), line(7, 1), line(12, 1)] });
    expect(batch.codes).toEqual([
      ['BK000007-CP05', 'BK000007-CP06'],
      ['BK000009-CP01', 'BK000009-CP02', 'BK000009-CP03'],
      ['BK000007-CP07'],
      ['BK000012-CP01'],
    ]);
    expect(reads).toEqual([[`${base}/copies-BOOK-000007`, `${base}/copies-BOOK-000009`, `${base}/copies-BOOK-000012`]]);
    // Nothing is written until the write phase.
    expect(writes).toEqual({});
    batch.commit();
    expect(writes).toEqual({
      [`${base}/copies-BOOK-000007`]: { next: 8 },
      [`${base}/copies-BOOK-000009`]: { next: 4 },
      [`${base}/copies-BOOK-000012`]: { next: 2 },
    });
  });

  it('titles whose codes start the same share one running number, in the order listed', async () => {
    const counter = `${base}/copy:CEN-C#`;
    const { tx, reads, writes } = fakeTx({ [counter]: 11 });
    const batch = await reserveCodeBatch(tx, { kind: 'copy', pattern: '{BRANCH}-C{SEQ:4}', base, requests: [line(7, 2), line(9, 1), line(12, 3)] });
    expect(batch.codes).toEqual([['CEN-C0011', 'CEN-C0012'], ['CEN-C0013'], ['CEN-C0014', 'CEN-C0015', 'CEN-C0016']]);
    expect(reads).toEqual([[counter]]);
    batch.commit();
    expect(writes).toEqual({ [counter]: { next: 17 } });
  });

  it('refuses a code already in use, naming the first one, and writes nothing', async () => {
    const { tx, writes } = fakeTx();
    const asked: string[][] = [];
    const taken = async (codes: string[]) => {
      asked.push(codes);
      return codes.filter((c) => c === 'CEN-C0003' || c === 'CEN-C0002');
    };
    const attempt = reserveCodeBatch(tx, { kind: 'copy', pattern: '{BRANCH}-C{SEQ:4}', base, requests: [line(7, 2), line(9, 2)], taken });
    await expect(attempt).rejects.toMatchObject({ details: { reason: 'CODE_TAKEN' }, message: expect.stringContaining('produced CEN-C0002,') });
    expect(asked).toEqual([['CEN-C0001', 'CEN-C0002', 'CEN-C0003', 'CEN-C0004']]);
    expect(writes).toEqual({});
  });

  it('looks existing codes up 30 at a time, together, and reports them in the order asked', async () => {
    const codes = Array.from({ length: 65 }, (_, i) => `C${i}`);
    let queries = 0;
    const tx = {
      // The later a lookup is asked, the sooner it answers: the result must not follow arrival order.
      get: async () => {
        const n = queries++;
        await new Promise((done) => setTimeout(done, 30 - n * 10));
        return { docs: [{ get: () => `hit-${n}` }] };
      },
    } as unknown as Transaction;
    expect(await existingCodes(tx, 'orgs/o1/copies', codes)).toEqual(['hit-0', 'hit-1', 'hit-2']);
    expect(queries).toBe(3);
    expect(await existingCodes(tx, 'orgs/o1/copies', [])).toEqual([]);
    expect(queries).toBe(3);
  });
});
