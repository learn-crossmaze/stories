import { describe, expect, it } from 'vitest';

import { aadhaarInput, aadhaarKey, isAadhaar } from '../../src/core/aadhaar.js';

describe('Aadhaar numbers', () => {
  it('accepts 12 digits with a valid Verhoeff check digit, and nothing else', () => {
    expect(isAadhaar('234123412346')).toBe(true);
    expect(isAadhaar('234123412347')).toBe(false); // wrong check digit
    expect(isAadhaar('123412341234')).toBe(false); // can't start with 1
    expect(isAadhaar('23412341234')).toBe(false); // 11 digits
  });

  it('ignores spaces and dashes, and allows leaving it empty', () => {
    expect(aadhaarInput.parse('2341 2341 2346')).toBe('234123412346');
    expect(aadhaarInput.parse('2341-2341-2346')).toBe('234123412346');
    expect(aadhaarInput.parse(undefined)).toBe('');
    expect(aadhaarInput.safeParse('2341 2341 2347').success).toBe(false);
  });

  it('keys the duplicate check per organization without keeping the number', () => {
    const k = aadhaarKey('org1', '234123412346');
    expect(k).toMatch(/^[0-9a-f]{64}$/);
    expect(k).not.toContain('2341');
    expect(aadhaarKey('org2', '234123412346')).not.toBe(k);
  });
});
