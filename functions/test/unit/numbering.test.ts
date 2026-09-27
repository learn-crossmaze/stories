import { describe, expect, it } from 'vitest';

import { DEFAULT_PATTERNS, patternProblem, renderCode } from '../../src/core/numbering.js';

describe('numbering patterns', () => {
  it('accepts every default pattern', () => {
    for (const [kind, pattern] of Object.entries(DEFAULT_PATTERNS)) {
      expect(patternProblem(kind as keyof typeof DEFAULT_PATTERNS, pattern)).toBeNull();
    }
  });

  it('renders the defaults exactly as codes were numbered before', () => {
    expect(renderCode(DEFAULT_PATTERNS.book, {}, 12)).toBe('BOOK-000012');
    expect(renderCode(DEFAULT_PATTERNS.copy, { BOOK: '000012' }, 3)).toBe('COPY-000012-03');
    expect(renderCode(DEFAULT_PATTERNS.member, {}, 7)).toBe('MEM-000007');
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
