import { describe, expect, it } from 'vitest';

import { attentionFrom, countsWebsite, courierTestsWaiting, holidayYearsDue, noActiveLeaveType, noAlertRecipients, whatsappWaiting } from '../admin/attention';
import { isGroup, MENU } from '../admin/nav';
import type { StoriesClaims } from '../auth/claims';
import type { Overview } from '../data/site';
import type { MessageEvent } from '../data/whatsapp';
import { paths } from '../paths';

describe('what waits for you (menu counts)', () => {
  it('puts each waiting thing beside the page where it is done', () => {
    expect(
      attentionFrom({
        branch: { inspection: 2, incoming: 1, approvals: 3 },
        unshelved: 4,
        deliveries: { requested: 1, returning: 2 },
        renewalsDue: 5,
        docs: { pending: 1, expired: 1 },
        corrections: 2,
        unfinalized: true,
        leave: 1,
        payroll: 0,
        website: { publishable: 3, reviews: 1, newSubmissions: 6 },
        onboardingMissing: 13,
      }),
    ).toEqual({
      [paths.adminDesk]: 2,
      [paths.adminShelve]: 4,
      [paths.adminTransfers]: 1,
      [paths.opsDeliveries]: 3,
      [paths.adminDeposits]: 3,
      [paths.adminMembers]: 5,
      [paths.adminDocuments]: 2,
      [paths.adminAttendance]: 3,
      [paths.adminLeave]: 1,
      [paths.adminWebsite]: 3,
      [paths.adminWebsiteBlog]: 1,
      [paths.adminWebsiteSubmissions]: 6,
      [paths.adminMyOnboarding]: 13,
    });
  });

  it('shows nothing where nothing waits, or the count isn’t this person’s', () => {
    expect(attentionFrom({})).toEqual({});
    expect(attentionFrom({ branch: { inspection: 0, incoming: 0, approvals: 0 }, website: { publishable: 0, reviews: 0, newSubmissions: null }, unfinalized: false })).toEqual({});
  });
});

describe('what waits under Master control', () => {
  const setup = { holidayYears: ['2026', '2027'], noLeaveType: true, letterDrafts: 3, payrollUnconfirmed: true, whatsapp: 4, courierTests: 1, noAlertRecipients: true };

  it('puts each count beside its Master control page', () => {
    expect(attentionFrom({ setup })).toEqual({
      [paths.adminSettingsSchedule]: 2,
      [paths.adminSettingsLeave]: 1,
      [paths.adminSettingsLetters]: 3,
      [paths.adminSettingsPayroll]: 1,
      [paths.adminSettingsWhatsApp]: 4,
      [paths.adminSettingsDelivery]: 1,
      [paths.adminWebsiteConnections]: 1,
    });
  });

  it('adds into the Master control group and the overall total like every other count', () => {
    const counts = attentionFrom({ unshelved: 2, setup });
    const group = MENU.filter(isGroup).find((g) => g.id === 'settings')!;
    expect(group.items.reduce((a, i) => a + (counts[i.to] ?? 0), 0)).toBe(13);
    expect(Object.values(counts).reduce((a, n) => a + n, 0)).toBe(15);
  });

  it('shows nothing where all is in order, not loaded, or not this person’s', () => {
    expect(attentionFrom({ setup: null })).toEqual({});
    expect(attentionFrom({ setup: { holidayYears: [], noLeaveType: false, letterDrafts: 0, payrollUnconfirmed: false, whatsapp: 0, courierTests: 0, noAlertRecipients: false } })).toEqual({});
    expect(attentionFrom({ setup: { holidayYears: null, noLeaveType: null, letterDrafts: null, payrollUnconfirmed: null, whatsapp: null, courierTests: null, noAlertRecipients: null } })).toEqual({});
  });

  it('gives no count to Roles, Library rules, Job titles & checklists or Document types', () => {
    const counts = attentionFrom({ setup });
    for (const to of [paths.adminRoles, paths.adminLibraryRules, paths.adminHrSettings, paths.adminSettingsDocuments]) expect(counts[to]).toBeUndefined();
  });

  it('asks for this year’s holidays, and from December for next year’s too (the date is India’s)', () => {
    expect(holidayYearsDue('2026-01-01')).toEqual(['2026']);
    expect(holidayYearsDue('2026-11-30')).toEqual(['2026']);
    expect(holidayYearsDue('2026-12-01')).toEqual(['2026', '2027']);
    expect(holidayYearsDue('2026-12-31')).toEqual(['2026', '2027']);
  });

  it('counts leave types only when none is active', () => {
    expect(noActiveLeaveType([])).toBe(true);
    expect(noActiveLeaveType([{ status: 'ARCHIVED' }, { status: 'ARCHIVED' }])).toBe(true);
    expect(noActiveLeaveType([{ status: 'ARCHIVED' }, { status: 'ACTIVE' }])).toBe(false);
  });

  const event = (key: string, status: string, enabled: boolean, added = true) => ({ key, added, template: { status, enabled } }) as unknown as MessageEvent;

  it('counts WhatsApp notifications Meta turned down, switched on or not, each once', () => {
    const events = [
      event('a', 'REJECTED', false),
      event('b', 'PAUSED', true),
      event('c', 'DISABLED', false),
      event('d', 'APPROVED', true),
      event('e', 'APPROVED', false), // Off on purpose, perhaps.
      event('f', 'PENDING', true), // Meta's turn.
      event('g', 'FLAGGED', true), // Another word from Meta: not one of the three.
      event('h', 'REJECTED', true, false), // Not one this branch added.
    ];
    expect(whatsappWaiting(events, true)).toBe(3);
    expect(whatsappWaiting(events, false)).toBe(3);
  });

  it('counts notifications switched on but never sent to Meta only while WhatsApp is switched on', () => {
    const events = [event('a', 'NOT_SUBMITTED', true), event('b', 'NOT_SUBMITTED', false), event('c', 'REJECTED', true), event('d', 'NOT_SUBMITTED', true, false)];
    expect(whatsappWaiting(events, true)).toBe(2);
    expect(whatsappWaiting(events, false)).toBe(1);
    expect(whatsappWaiting([], true)).toBe(0);
  });

  it('counts courier apps on their test account only while home delivery is on', () => {
    const couriers = { PORTER: { enabled: true, environment: 'TEST' as const, hasKey: true } };
    expect(courierTestsWaiting({ enabled: true, couriers })).toBe(1);
    expect(courierTestsWaiting({ enabled: false, couriers })).toBe(0);
    expect(courierTestsWaiting({ enabled: true, couriers: { PORTER: { enabled: true, environment: 'LIVE', hasKey: true } } })).toBe(0);
    expect(courierTestsWaiting({ enabled: true, couriers: { PORTER: { enabled: false, environment: 'TEST', hasKey: true } } })).toBe(0);
    expect(courierTestsWaiting({ enabled: true, couriers: {} })).toBe(0);
    expect(courierTestsWaiting(undefined)).toBe(0);
  });

  it('counts a missing enquiry alerts list for website managers only', () => {
    const overview = (manager: boolean, alertRecipients: number | null) =>
      ({ rights: { manager }, counts: { newSubmissions: 0, callsThisWeek: 0, openJobs: 0, alertRecipients } }) as unknown as Overview;
    expect(noAlertRecipients(overview(true, 0))).toBe(true);
    expect(noAlertRecipients(overview(true, 2))).toBe(false);
    expect(noAlertRecipients(overview(false, null))).toBe(false);
    expect(noAlertRecipients(overview(false, 0))).toBe(false);
    // An older backend sends no number: nothing is claimed.
    expect(noAlertRecipients(overview(true, null))).toBe(false);
  });
});

describe('who the menu asks the Website counts for', () => {
  const claims = (o: StoriesClaims['o'], sa = false): StoriesClaims => ({ v: 1, sa, o });

  it('doesn’t ask for someone who only writes blog posts', () => {
    expect(countsWebsite(claims({ corp: { r: ['LIB'], b: ['cen'] } }), 'corp')).toBe(false);
    expect(countsWebsite(claims({ corp: { r: ['EMP'], b: ['cen'] } }), 'corp')).toBe(false);
  });

  it('asks for those who manage the website or a branch’s pages', () => {
    expect(countsWebsite(claims({ corp: { r: ['SLIB'], b: ['cen'] } }), 'corp')).toBe(true);
    expect(countsWebsite(claims({ corp: { r: ['OWN'], b: ['*'] } }), 'corp')).toBe(true);
    expect(countsWebsite(claims({ corp: { r: ['WEB'], b: ['*'] } }), 'corp')).toBe(true);
    expect(countsWebsite(claims({}, true), 'corp')).toBe(true);
  });

  it('asks for a blog writer here who looks after a branch’s pages in another organization (the server counts across all)', () => {
    const c = claims({ corp: { r: ['LIB'], b: ['cen'] }, fran: { r: ['SLIB'], b: ['fr1'] } });
    expect(countsWebsite(c, 'corp')).toBe(true);
    expect(countsWebsite(c, 'fran')).toBe(true);
  });

  it('doesn’t ask where the person sees no Website pages at all', () => {
    expect(countsWebsite(claims({ corp: { r: ['HR'], b: ['*'] }, fran: { r: ['SLIB'], b: ['fr1'] } }), 'corp')).toBe(false);
    expect(countsWebsite(claims({ corp: { r: ['SLIB'], b: ['cen'] } }), null)).toBe(false);
  });
});
