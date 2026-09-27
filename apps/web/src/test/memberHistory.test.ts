import { describe as suite, expect, it } from 'vitest';

import { describe } from '../admin/pages/MemberHistory';
import type { AuditEntry } from '../data/org';

const entry = (action: string, after: unknown = null): AuditEntry => ({
  id: 'x', actorUid: 'u', actorEmail: 'lib@stories.test', action, entityType: 'member', entityId: 'm', branchId: 'b',
  before: null, after, reason: null, at: new Date(),
});

suite('member audit trail wording', () => {
  it('describes circulation and payments in plain words', () => {
    expect(describe(entry('circulation.issue', { copies: ['COPY-1'], titles: ['Treasure Island'] }))).toBe('Borrowed Treasure Island');
    expect(describe(entry('circulation.issue', { copies: ['COPY-1'] }))).toBe('Borrowed COPY-1');
    expect(describe(entry('circulation.return', { copies: ['COPY-1'], titles: ['Kidnapped'] }))).toBe('Returned Kidnapped');
    expect(describe(entry('payment.recordOffline', { amountMinor: 229900, method: 'OFFLINE_CASH', endAt: '2026-12-27T00:00:00.000Z' }))).toMatch(/^Paid ₹2,299 \(Cash\) · active until 27 Dec 2026$/);
  });

  it('falls back to the action name for anything new', () => {
    expect(describe(entry('member.somethingNew'))).toBe('Member somethingNew');
  });
});
