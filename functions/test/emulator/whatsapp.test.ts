import { createHmac } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as branches from '../../src/organization/branches.js';
import { db } from '../../src/core/firebase.js';
import * as members from '../../src/members/members.js';
import * as orgs from '../../src/organization/orgs.js';
import * as staff from '../../src/organization/staff.js';
import * as settings from '../../src/messaging/settings.js';
import { deliver, handleWebhook, queueRenewalReminders } from '../../src/messaging/outbox.js';
import { clearSwitchboardCache } from '../../src/messaging/whatsapp.js';
import { address, call, contact, createUser, failure, resetEmulators, type TestUser } from './helpers.js';

let sa: TestUser, bm: TestUser, lib: TestUser;
let org: string, central: string;
const CONN = { phoneNumberId: '1234567890', wabaId: '9876543210', accessToken: 'EAAG-test-token', appSecret: 'app-secret-1', language: 'en' };
const GRAPH = 'https://graph.facebook.com/v23.0';

/** Fake Graph API: records calls; `routes` answers by "METHOD path". Everything else (emulators) is real. */
function fakeMeta(routes: Record<string, (body: Record<string, unknown>) => { status?: number; json: unknown }> = {}) {
  const calls: { method: string; path: string; body: Record<string, unknown>; auth: string | null }[] = [];
  const real = globalThis.fetch;
  const all: Record<string, (body: Record<string, unknown>) => { status?: number; json: unknown }> = {
    [`GET /${CONN.phoneNumberId}`]: () => ({ json: { display_phone_number: '+91 98765 00000', verified_name: 'Stories Central' } }),
    [`GET /${CONN.wabaId}/phone_numbers`]: () => ({ json: { data: [{ id: CONN.phoneNumberId }] } }),
    [`POST /${CONN.phoneNumberId}/messages`]: () => ({ json: { messages: [{ id: `wamid.${calls.length}` }] } }),
    ...routes,
  };
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.startsWith(GRAPH)) return real(input, init);
    const method = init?.method ?? 'GET';
    const path = url.slice(GRAPH.length).split('?')[0];
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    calls.push({ method, path, body, auth: (init?.headers as Record<string, string>)?.Authorization ?? null });
    const route = all[`${method} ${path}`];
    if (!route) return Response.json({ error: { code: 100, message: 'Unsupported request' } }, { status: 400 });
    const r = route(body);
    return Response.json(r.json, { status: r.status ?? 200 });
  });
  return calls;
}

const connect = (extra: Record<string, unknown> = {}, by = bm) => call(settings.saveConnection, by, { orgId: org, branchId: central, enabled: true, ...CONN, ...extra });
const template = (event: string, extra: Record<string, unknown> = {}, by = bm) =>
  call(settings.saveTemplate, by, {
    orgId: org, branchId: central, event, enabled: true, name: `stories_${event}`, language: 'en',
    body: 'Hello {{member_name}}, welcome to {{branch_name}}! Your member ID is {{member_code}}.', ...extra,
  });
const outbox = async () => (await db.collection(`orgs/${org}/whatsappOutbox`).get()).docs;

function webhook(method: 'GET' | 'POST', body: unknown, query: Record<string, string> = {}, secret = CONN.appSecret) {
  const raw = Buffer.from(JSON.stringify(body ?? {}));
  const out = { status: 0, body: '' };
  const res = { status: (n: number) => ({ send: (b?: unknown) => void Object.assign(out, { status: n, body: String(b ?? '') }) }) };
  const signature = `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;
  return handleWebhook({ method, query: { o: org, b: central, ...query }, headers: { 'x-hub-signature-256': signature }, rawBody: raw } as never, res).then(() => out);
}

beforeEach(async () => {
  await resetEmulators();
  clearSwitchboardCache();
  sa = await createUser('sa@stories.test', { superAdmin: true });
  [bm, lib] = await Promise.all(['bm', 'lib'].map((n) => createUser(`${n}@stories.test`)));
  org = (await call<{ orgId: string }>(orgs.create, sa, { name: 'Stories Corporate', type: 'CORPORATE' })).orgId;
  central = (await call<{ branchId: string }>(branches.create, sa, { orgId: org, code: 'CEN', name: 'Central', address, contact })).branchId;
  await call(staff.setRoles, sa, { orgId: org, email: bm.email, roles: ['BRANCH_MANAGER'], branchIds: [central] });
  await call(staff.setRoles, sa, { orgId: org, email: lib.email, roles: ['LIBRARIAN'], branchIds: [central] });
});
afterEach(() => vi.restoreAllMocks());

describe('WhatsApp settings', () => {
  it('a branch manager connects the branch with three values; the token stays server-side', async () => {
    const calls = fakeMeta();
    expect(await failure(connect({}, lib))).toBe('FORBIDDEN');
    await connect();
    expect(calls[0]).toMatchObject({ method: 'GET', path: `/${CONN.phoneNumberId}`, auth: `Bearer ${CONN.accessToken}` });
    const branch = (await db.doc(`orgs/${org}/branches/${central}`).get()).data()!;
    expect(branch.whatsapp).toMatchObject({ enabled: true, phoneNumberId: CONN.phoneNumberId, displayPhone: '+91 98765 00000', verifiedName: 'Stories Central', hasAppSecret: true });
    expect(JSON.stringify(branch)).not.toContain(CONN.accessToken);
    const secret = (await db.doc(`orgs/${org}/branches/${central}/private/whatsapp`).get()).data()!;
    expect(secret).toMatchObject({ accessToken: CONN.accessToken, appSecret: CONN.appSecret });
    expect(secret.verifyToken).toMatch(/^[0-9a-f]{32}$/);
    // Leaving the token blank keeps it; a wrong token is reported in plain words.
    await connect({ accessToken: '' });
    expect((await db.doc(`orgs/${org}/branches/${central}/private/whatsapp`).get()).get('accessToken')).toBe(CONN.accessToken);
    vi.restoreAllMocks();
    fakeMeta({ [`GET /${CONN.phoneNumberId}`]: () => ({ status: 401, json: { error: { code: 190, message: 'Invalid OAuth access token' } } }) });
    expect(await failure(connect({ accessToken: 'bad' }))).toBe('WHATSAPP_ERROR');
    // A business account the token can't use, or one the number isn't in, is caught when saving.
    vi.restoreAllMocks();
    fakeMeta({ [`GET /${CONN.wabaId}/phone_numbers`]: () => ({ status: 400, json: { error: { code: 100, error_subcode: 33, message: 'Unsupported get request.' } } }) });
    expect(await failure(connect())).toBe('WHATSAPP_ERROR');
    vi.restoreAllMocks();
    fakeMeta({ [`GET /${CONN.wabaId}/phone_numbers`]: () => ({ json: { data: [{ id: '555' }] } }) });
    expect(await failure(connect())).toBe('INVALID_INPUT');
  });

  it('Check approvals resets templates Meta does not have, so they can be submitted again', async () => {
    fakeMeta({ [`GET /${CONN.wabaId}/message_templates`]: () => ({ json: { data: [] } }) });
    await connect();
    await template('member_welcome');
    await db.doc(`orgs/${org}/branches/${central}/whatsappTemplates/member_welcome`).update({ metaId: 'tpl_elsewhere', status: 'PENDING' });
    expect(await call(settings.syncTemplates, bm, { orgId: org, branchId: central }, null)).toMatchObject({ found: 0, missing: ['member_welcome'] });
    expect((await db.doc(`orgs/${org}/branches/${central}/whatsappTemplates/member_welcome`).get()).data()).toMatchObject({ status: 'NOT_SUBMITTED', metaId: null });
  });

  it('submits a rejected template afresh when Meta no longer lets it be edited', async () => {
    const calls = fakeMeta({
      [`POST /tpl_old`]: () => ({ status: 400, json: { error: { code: 100, error_subcode: 33, message: 'Unsupported post request.' } } }),
      [`POST /${CONN.wabaId}/message_templates`]: () => ({ json: { id: 'tpl_new', status: 'PENDING' } }),
    });
    await connect();
    await template('member_welcome');
    await db.doc(`orgs/${org}/branches/${central}/whatsappTemplates/member_welcome`).update({ metaId: 'tpl_old', status: 'REJECTED' });
    expect(await call(settings.submitTemplate, bm, { orgId: org, branchId: central, event: 'member_welcome' }, null)).toEqual({ status: 'PENDING' });
    expect(calls.map((c) => `${c.method} ${c.path}`)).toContain(`POST /${CONN.wabaId}/message_templates`);
    expect((await db.doc(`orgs/${org}/branches/${central}/whatsappTemplates/member_welcome`).get()).get('metaId')).toBe('tpl_new');
  });

  it('checks templates, submits them to Meta as {{1}}… with examples, and syncs the approval', async () => {
    const calls = fakeMeta({
      [`POST /${CONN.wabaId}/message_templates`]: () => ({ json: { id: 'tpl_1', status: 'PENDING', category: 'UTILITY' } }),
      [`GET /${CONN.wabaId}/message_templates`]: () => ({ json: { data: [{ id: 'tpl_1', name: 'stories_member_welcome', language: 'en', status: 'APPROVED' }] } }),
    });
    await connect();
    expect(await failure(template('member_welcome', { body: 'Hello {{member_name}}, your PIN is {{pin}} today.' }))).toBe('INVALID_INPUT');
    expect(await failure(template('member_welcome', { body: '{{member_name}} welcome to the library' }))).toBe('INVALID_INPUT');
    expect(await failure(template('member_welcome', { name: 'Bad Name' }))).toBe('INVALID_INPUT');
    await template('member_welcome');
    expect((await db.doc(`orgs/${org}/config/whatsapp`).get()).get(`branches.${central}`)).toEqual(['member_welcome']);

    expect(await call(settings.submitTemplate, bm, { orgId: org, branchId: central, event: 'member_welcome' }, null)).toEqual({ status: 'PENDING' });
    const sent = calls.find((c) => c.path === `/${CONN.wabaId}/message_templates` && c.method === 'POST')!;
    expect(sent.body).toMatchObject({
      name: 'stories_member_welcome', language: 'en', category: 'UTILITY',
      components: [{ type: 'BODY', text: 'Hello {{1}}, welcome to {{2}}! Your member ID is {{3}}.', example: { body_text: [['Asha Rao', 'Stories Central', 'CEN-M000123']] } }],
    });
    await call(settings.syncTemplates, bm, { orgId: org, branchId: central }, null);
    const overview = await call<{ events: { key: string; template: { status: string; metaId: string } }[] }>(settings.overview, bm, { orgId: org, branchId: central }, null);
    expect(overview.events.find((e) => e.key === 'member_welcome')!.template).toMatchObject({ status: 'APPROVED', metaId: 'tpl_1' });
    expect(overview.events).toHaveLength(9);
  });
});

describe('sending', () => {
  it('queues a welcome when a member registers and sends the approved template with their details', async () => {
    const calls = fakeMeta();
    await connect();
    await template('member_welcome');
    const { memberId } = await call<{ memberId: string }>(members.register, lib, { orgId: org, homeBranchId: central, fullName: 'Asha Rao', dob: '1990-05-01', phone: '98765 43210' });
    const [queued] = await outbox();
    expect(queued.data()).toMatchObject({ branchId: central, event: 'member_welcome', memberId, status: 'QUEUED' });

    expect(await deliver(org, queued.id)).toBe('SENT');
    const message = calls.find((c) => c.path === `/${CONN.phoneNumberId}/messages`)!;
    expect(message.body).toMatchObject({
      messaging_product: 'whatsapp', to: '919876543210', type: 'template',
      template: { name: 'stories_member_welcome', language: { code: 'en' }, components: [{ type: 'body', parameters: [{ type: 'text', text: 'Asha' }, { type: 'text', text: 'Central' }, { type: 'text', text: expect.stringMatching(/^CEN-M/) }] }] },
    });
    expect((await queued.ref.get()).data()).toMatchObject({ status: 'SENT', toMasked: '+91 ••••• 3210', recipientName: 'Asha Rao' });
    // Running again never sends twice.
    expect(await deliver(org, queued.id)).toBe('NOT_QUEUED');

    // Delivery updates arrive by webhook; a forged one is refused.
    const wamid = (await queued.ref.get()).get('wamid');
    const status = (s: string) => ({ entry: [{ changes: [{ value: { statuses: [{ id: wamid, status: s }] } }] }] });
    expect((await webhook('POST', status('delivered'), {}, 'wrong-secret')).status).toBe(401);
    expect((await webhook('POST', status('read'))).status).toBe(200);
    expect((await webhook('POST', status('delivered'))).status).toBe(200);
    expect((await queued.ref.get()).get('status')).toBe('READ');
  });

  it('drops messages for events a branch has switched off, and skips members who replied STOP', async () => {
    fakeMeta();
    await connect();
    await template('member_welcome', { enabled: false });
    const { memberId } = await call<{ memberId: string }>(members.register, lib, { orgId: org, homeBranchId: central, fullName: 'Asha Rao', dob: '1990-05-01', phone: '98765 43210' });
    const [first] = await outbox();
    expect(await deliver(org, first.id)).toBe('DROPPED');
    expect((await first.ref.get()).exists).toBe(false);

    await template('member_welcome');
    clearSwitchboardCache(); // (in production the switchboard cache refreshes within a minute)
    expect((await webhook('POST', { entry: [{ changes: [{ value: { messages: [{ from: '919876543210', text: { body: ' stop ' } }] } }] }] })).status).toBe(200);
    expect((await db.doc(`orgs/${org}/members/${memberId}`).get()).get('whatsappOptOut')).toBe(true);
    const again = await call<{ memberId: string }>(members.register, lib, { orgId: org, homeBranchId: central, fullName: 'Ravi', dob: '1990-05-01', phone: '98111 22222' });
    await db.doc(`orgs/${org}/members/${again.memberId}`).update({ whatsappOptOut: true });
    const next = (await outbox()).find((d) => d.get('memberId') === again.memberId)!;
    expect(await deliver(org, next.id)).toBe('SKIPPED');
    expect((await next.ref.get()).get('error')).toMatch(/asked not to/);
  });

  it("updates a template's status when Meta reviews it (webhook)", async () => {
    fakeMeta({ [`POST /${CONN.wabaId}/message_templates`]: () => ({ json: { id: '777', status: 'PENDING' } }) });
    await connect();
    await template('member_welcome');
    await call(settings.submitTemplate, bm, { orgId: org, branchId: central, event: 'member_welcome' }, null);
    const update = (event: string, reason: string) => ({
      entry: [{ changes: [{ field: 'message_template_status_update', value: { event, message_template_id: 777, message_template_name: 'stories_member_welcome', message_template_language: 'en', reason } }] }],
    });
    expect((await webhook('POST', update('REJECTED', 'INCORRECT_CATEGORY'))).status).toBe(200);
    const ref = db.doc(`orgs/${org}/branches/${central}/whatsappTemplates/member_welcome`);
    expect((await ref.get()).data()).toMatchObject({ status: 'REJECTED', reason: 'INCORRECT_CATEGORY' });
    await webhook('POST', update('APPROVED', 'NONE'));
    expect((await ref.get()).data()).toMatchObject({ status: 'APPROVED', reason: null });
  });

  it("answers Meta's webhook check with the branch's verify token", async () => {
    fakeMeta();
    await connect();
    const token = (await db.doc(`orgs/${org}/branches/${central}/private/whatsapp`).get()).get('verifyToken');
    expect(await webhook('GET', null, { 'hub.mode': 'subscribe', 'hub.verify_token': token, 'hub.challenge': '42' })).toEqual({ status: 200, body: '42' });
    expect((await webhook('GET', null, { 'hub.mode': 'subscribe', 'hub.verify_token': 'nope', 'hub.challenge': '42' })).status).toBe(403);
  });

  it('queues renewal reminders 7 days before a plan ends', async () => {
    fakeMeta();
    const memberRef = db.collection(`orgs/${org}/members`).doc();
    const subRef = db.collection(`orgs/${org}/subscriptions`).doc();
    const now = new Date('2026-10-01T03:30:00Z');
    await memberRef.set({ fullName: 'Asha', phone: '+919876543210', activeSubscriptionId: subRef.id, nextSubscriptionId: null, homeBranchId: central });
    await subRef.set({ memberId: memberRef.id, branchId: central, status: 'ACTIVE', planSnapshot: { name: 'Learner' }, endAt: new Date(now.getTime() + 7 * 86_400_000 + 600_000) });
    expect(await queueRenewalReminders(now)).toBe(1);
    const [r] = await outbox();
    expect(r.data()).toMatchObject({ event: 'renewal_reminder', memberId: memberRef.id, vars: { plan_name: 'Learner', days_left: '7' } });
  });
});
