import { describe, expect, it } from 'vitest';

import { aadhaarError, formatAadhaar, isAadhaar, maskAadhaar } from '../shared/aadhaar';

describe('Aadhaar numbers in forms', () => {
  it('checks the Verhoeff digit and ignores spaces', () => {
    expect(isAadhaar('2341 2341 2346')).toBe(true);
    expect(isAadhaar('234123412347')).toBe(false);
    expect(isAadhaar('123412341234')).toBe(false);
    expect(aadhaarError('')).toBe('');
    expect(aadhaarError('2341')).not.toBe('');
  });

  it('shows only the last four digits unless revealed', () => {
    expect(maskAadhaar('2346')).toBe('XXXX XXXX 2346');
    expect(formatAadhaar('234123412346')).toBe('2341 2341 2346');
  });
});
