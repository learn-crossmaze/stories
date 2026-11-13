import { randomUUID } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { db } from '../../src/core/firebase.js';
import { EVENT_KEYS, EVENTS } from '../../src/messaging/events.js';
import * as settings from '../../src/messaging/settings.js';
import { clearSwitchboardCache } from '../../src/messaging/whatsapp.js';
import * as branches from '../../src/organization/branches.js';
import * as orgs from '../../src/organization/orgs.js';
import * as staff from '../../src/organization/staff.js';
import { address, call, contact, createUser, failure, resetEmulators, type TestUser } from './helpers.js';

// Setting a branch's WhatsApp notifications up in one go: several added at once (switched off, default wording)
// and several switched on or off at once.

let sa: TestUser, bm: TestUser, lib: TestUser;
let org: string, central: string, north: string;
const CONN = { phoneNumberId: '1234567890', wabaId: '9876543210', accessToken: 'EAAG-test-token', appSecret: 'app-secret-1', language: 'hi' };
const GRAPH = 'https://graph.facebook.com/v23.0';
const WORDING = 'Hello {{member_name}}, a warm welcome to {{branch_name}}! Your member ID is {{member_code}}. Show it at the counter.';

/** Meta confirms the connection; nothing else is asked of it here. */
function fakeMeta() {
  const real = globalThis.fetch;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.startsWith(GRAPH)) return real(input, init);
    const path = url.slice(GRAPH.length).split('?')[0];
    if (path === `/${CONN.phoneNumberId}`) return Response.json({ display_phone_number: '+91 98765 00000', verified_name: 'Stories Central' });
    if (path === `/${CONN.wabaId}/phone_numbers`) return Response.json({ data: [{ id: CONN.phoneNumberId }] });
    return Response.json({ error: { code: 100, message: 'Unsupported request' } }, { status: 400 });
  });
}

const at = () => ({ orgId: org, branchId: central });
const connect = (enabled = true) => call(settings.saveConnection, bm, { ...at(), enabled, ...CONN });
const add = (events: string[], by = bm, requestId: string = randomUUID(), branchId = central) =>
  call<{ added: string[] }>(settings.addTemplates, by, { orgId: org, branchId, events }, requestId);
const turn = (events: string[], enabled: boolean, by = bm, requestId: string = randomUUID()) =>
  call<{ switched: string[] }>(settings.switchTemplates, by, { ...at(), events, enabled }, requestId);
const templates = async (branchId = central) =>
  Object.fromEntries((await db.collection(`orgs/${org}/branches/${branchId}/whatsappTemplates`).get()).docs.map((d) => [d.id, d.data()]));
const switchboard = async () => (await db.doc(`orgs/${org}/config/whatsapp`).get()).get(`branches.${central}`) as string[] | undefined;
const audits = async (action: string) => (await db.collection(`orgs/${org}/auditLogs`).where('action', '==', action).get()).docs.map((d) => d.data());

beforeEach(async () => {
  await resetEmulators();
  clearSwitchboardCache();
  sa = await createUser('sa@stories.test', { superAdmin: true });
  [bm, lib] = await Promise.all(['bm', 'lib'].map((n) => createUser(`${n}@stories.test`)));
  org = (await call<{ orgId: string }>(orgs.create, sa, { name: 'Stories Corporate', type: 'CORPORATE' })).orgId;
  central = (await call<{ branchId: string }>(branches.create, sa, { orgId: org, code: 'CEN', name: 'Central', address, contact })).branchId;
  north = (await call<{ branchId: string }>(branches.create, sa, { orgId: org, code: 'NOR', name: 'North', address, contact })).branchId;
  await call(staff.setRoles, sa, { orgId: org, email: bm.email, roles: ['SENIOR_LIBRARIAN'], branchIds: [central] });
  await call(staff.setRoles, sa, { orgId: org, email: lib.email, roles: ['LIBRARIAN'], branchIds: [central] });
});
afterEach(() => vi.restoreAllMocks());

describe('adding several notifications at once', () => {
  it('adds only the missing ones, switched off and not submitted, and leaves a reworded one alone', async () => {
    fakeMeta();
    await connect();
    await call(settings.saveTemplate, bm, { ...at(), event: 'member_welcome', enabled: true, name: 'central_welcome_v2', language: 'en', body: WORDING });
    expect(await switchboard()).toEqual(['member_welcome']);

    // Asked for twice in one call, and one the branch already has: each is added once, in the list's order.
    expect(await add(['books_returned', 'member_welcome', 'books_issued', 'books_issued'])).toEqual({ added: ['books_issued', 'books_returned'] });
    const saved = await templates();
    expect(Object.keys(saved).sort()).toEqual(['books_issued', 'books_returned', 'member_welcome']);
    expect(saved.member_welcome).toMatchObject({ enabled: true, name: 'central_welcome_v2', language: 'en', body: WORDING });
    for (const key of ['books_issued', 'books_returned']) {
      expect(saved[key]).toMatchObject({
        event: key, enabled: false, name: `stories_${key}`, language: 'hi', body: EVENTS.find((e) => e.key === key)!.body,
        status: 'NOT_SUBMITTED', reason: null, metaId: null, updatedBy: bm.uid,
      });
      expect(saved[key].updatedAt).toBeTruthy();
    }
    // Nothing new is switched on: the switchboard is as it was.
    expect(await switchboard()).toEqual(['member_welcome']);
    expect(await audits('whatsapp.template.add')).toMatchObject([{ entityType: 'branch', entityId: central, branchId: central, actorUid: bm.uid, after: { events: ['books_issued', 'books_returned'] } }]);

    const overview = await call<{ events: { key: string; added: boolean; template: { enabled: boolean; status: string } }[] }>(settings.overview, bm, at(), null);
    expect(overview.events).toHaveLength(22);
    expect(overview.events.filter((e) => e.added).map((e) => e.key).sort()).toEqual(['books_issued', 'books_returned', 'member_welcome']);
    expect(overview.events.find((e) => e.key === 'books_issued')!.template).toMatchObject({ enabled: false, status: 'NOT_SUBMITTED' });
  });

  it('adds every notification in one call, before the branch is connected', async () => {
    expect(await add([...EVENT_KEYS])).toEqual({ added: EVENT_KEYS });
    const saved = await templates();
    expect(Object.keys(saved)).toHaveLength(EVENT_KEYS.length);
    expect(Object.values(saved).every((t) => t.enabled === false && t.status === 'NOT_SUBMITTED' && t.language === 'en')).toBe(true);
    expect(await switchboard()).toBeUndefined();
    // A second go finds nothing to add and records nothing.
    expect(await add([...EVENT_KEYS])).toEqual({ added: [] });
    expect(await audits('whatsapp.template.add')).toHaveLength(1);
  });

  it('is refused for staff who cannot manage messaging, for another branch and for an unknown event', async () => {
    expect(await failure(add(['books_issued'], lib))).toBe('FORBIDDEN');
    expect(await failure(add(['books_issued'], bm, randomUUID(), north))).toBe('FORBIDDEN');
    // The permission is checked first: someone without it does not learn whether the branch exists.
    expect(await failure(add(['books_issued'], lib, randomUUID(), 'nobranch'))).toBe('FORBIDDEN');
    expect(await failure(add(['books_issued'], sa, randomUUID(), 'nobranch'))).toBe('NOT_FOUND');
    expect(await failure(add(['not_an_event']))).toBe('INVALID_INPUT');
    expect(await failure(add([]))).toBe('INVALID_INPUT');
    expect(await templates()).toEqual({});
  });

  it('a replay with the same requestId returns the same answer and adds nothing twice', async () => {
    const requestId = randomUUID();
    expect(await add(['books_issued', 'books_returned'], bm, requestId)).toEqual({ added: ['books_issued', 'books_returned'] });
    await db.doc(`orgs/${org}/branches/${central}/whatsappTemplates/books_issued`).delete();
    expect(await add(['books_issued', 'books_returned'], bm, requestId)).toEqual({ added: ['books_issued', 'books_returned'] });
    expect(Object.keys(await templates())).toEqual(['books_returned']);
    expect(await audits('whatsapp.template.add')).toHaveLength(1);
  });

  it('two people adding at the same moment end with each notification added once', async () => {
    const [a, b] = await Promise.all([add(['books_issued', 'books_returned']), add(['books_returned', 'book_lost'], sa)]);
    expect([...a.added, ...b.added].sort()).toEqual(['book_lost', 'books_issued', 'books_returned']);
    expect(Object.keys(await templates()).sort()).toEqual(['book_lost', 'books_issued', 'books_returned']);
  });
});

describe('switching several notifications on or off at once', () => {
  it('switches on only what the branch has added, and the switchboard lists exactly what is on', async () => {
    fakeMeta();
    await connect();
    await add(['books_issued', 'books_returned', 'book_lost']);
    expect(await switchboard()).toEqual([]);

    // reservation_ready was never added: it is ignored, not created.
    expect(await turn(['books_returned', 'reservation_ready', 'books_issued'], true)).toEqual({ switched: ['books_issued', 'books_returned'] });
    const saved = await templates();
    expect(Object.keys(saved).sort()).toEqual(['book_lost', 'books_issued', 'books_returned']);
    expect([saved.books_issued.enabled, saved.books_returned.enabled, saved.book_lost.enabled]).toEqual([true, true, false]);
    // Only the switch changed: wording, name and review status stay.
    expect(saved.books_issued).toMatchObject({ name: 'stories_books_issued', status: 'NOT_SUBMITTED', body: EVENTS.find((e) => e.key === 'books_issued')!.body });
    expect(await switchboard()).toEqual(['books_issued', 'books_returned']);
    expect(await audits('whatsapp.template.switch')).toMatchObject([{ entityId: central, branchId: central, after: { events: ['books_issued', 'books_returned'], enabled: true } }]);

    // One already on is left out of the answer; switching off takes it off the switchboard.
    expect(await turn(['books_issued', 'book_lost'], true)).toEqual({ switched: ['book_lost'] });
    expect(await switchboard()).toEqual(['book_lost', 'books_issued', 'books_returned']);
    expect(await turn(['books_issued'], false)).toEqual({ switched: ['books_issued'] });
    expect(await switchboard()).toEqual(['book_lost', 'books_returned']);

    // Nothing to change: no write, no audit entry.
    expect(await turn(['books_issued', 'reservation_ready'], false)).toEqual({ switched: [] });
    expect(await audits('whatsapp.template.switch')).toHaveLength(3);
  });

  it('keeps the switchboard empty while the branch is not sending', async () => {
    fakeMeta();
    await connect(false);
    await add(['books_issued']);
    expect(await turn(['books_issued'], true)).toEqual({ switched: ['books_issued'] });
    expect((await templates()).books_issued.enabled).toBe(true);
    expect(await switchboard()).toEqual([]);
    // Switching the branch on then lists what is on.
    await connect(true);
    expect(await switchboard()).toEqual(['books_issued']);
  });

  it('is refused without the permission, and a replay switches nothing twice', async () => {
    await add(['books_issued']);
    expect(await failure(turn(['books_issued'], true, lib))).toBe('FORBIDDEN');
    expect(await failure(turn(['not_an_event'], true))).toBe('INVALID_INPUT');
    const requestId = randomUUID();
    expect(await turn(['books_issued'], true, bm, requestId)).toEqual({ switched: ['books_issued'] });
    await turn(['books_issued'], false);
    expect(await turn(['books_issued'], true, bm, requestId)).toEqual({ switched: ['books_issued'] });
    expect((await templates()).books_issued.enabled).toBe(false);
    expect(await audits('whatsapp.template.switch')).toHaveLength(2);
  });
});
