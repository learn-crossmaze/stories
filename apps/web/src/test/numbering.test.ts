import { describe, expect, it } from 'vitest';

import { DEFAULT_PATTERNS, patternProblem, previewCode } from '../admin/numbering';

describe('numbering preview', () => {
  it('accepts the defaults and previews them like the server numbers them', () => {
    for (const [kind, p] of Object.entries(DEFAULT_PATTERNS)) expect(patternProblem(kind as keyof typeof DEFAULT_PATTERNS, p)).toBeNull();
    expect(previewCode(DEFAULT_PATTERNS.copy, {}, 3)).toBe('COPY-000123-03');
    expect(previewCode('{BRANCH}-{KIND}{SEQ:2}', { BRANCH: 'NTH' }, 1)).toBe('NTH-SH01');
    expect(previewCode('M{YY}-{SEQ:4}', {}, 7, new Date('2026-12-31T20:00:00Z'))).toBe('M27-0007');
  });

  it('explains what is wrong with a pattern', () => {
    expect(patternProblem('member', 'MEM-')).toMatch(/exactly once/);
    expect(patternProblem('member', 'M-{BOOK}-{SEQ}')).toMatch(/can't be used here/);
    expect(patternProblem('copy', 'copy-{SEQ}')).toMatch(/capital letters/);
    expect(patternProblem('location', '{BRANCH}-{KIND}-{SEQ:6}')).toMatch(/longer than 16/);
  });
});
