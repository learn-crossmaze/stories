import { describe, expect, it } from 'vitest';

import { DEFAULT_REQUIRED_FIELDS, hasField, needsSelfOnboarding } from '../data/selfOnboarding';

describe('self-onboarding', () => {
  it('counts a detail as filled only when all of it is there', () => {
    expect(hasField({ emergencyName: 'Suresh' }, 'emergency')).toBe(false);
    expect(hasField({ emergencyName: 'Suresh', emergencyPhone: '9812345678' }, 'emergency')).toBe(true);
    expect(hasField({}, 'bank')).toBe(false);
    expect(hasField({ bank: { accountHolder: 'D', bankName: 'HDFC', ifsc: 'HDFC0001234', last4: '7890' } }, 'bank')).toBe(true);
    expect(hasField({ pan: '' }, 'pan')).toBe(false);
    expect(hasField({ pan: 'ABCDE1234F' }, 'pan')).toBe(true);
    expect(hasField({}, 'photo', { photoUrl: null })).toBe(false);
    expect(hasField({}, 'photo', { photoUrl: 'https://example.test/p.jpg' })).toBe(true);
    expect(hasField({ aadhaarLast4: '2346' }, 'aadhaar')).toBe(true);
    expect(DEFAULT_REQUIRED_FIELDS).toEqual(expect.arrayContaining(['bank', 'aadhaar', 'photo']));
  });

  it('asks only people with a sign-in who still work here', () => {
    expect(needsSelfOnboarding({ status: 'ACTIVE', uid: 'u1' })).toBe(true);
    expect(needsSelfOnboarding({ status: 'ONBOARDING', uid: 'u1' })).toBe(true);
    expect(needsSelfOnboarding({ status: 'ACTIVE', uid: null })).toBe(false);
    expect(needsSelfOnboarding({ status: 'OFFBOARDING', uid: 'u1' })).toBe(false);
    expect(needsSelfOnboarding(null)).toBe(false);
  });
});
