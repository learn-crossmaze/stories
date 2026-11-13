import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FirebaseError } from 'firebase/app';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { MessageEvent } from '../data/whatsapp';
import { t } from '../strings';
import { wt } from '../strings/messaging';

// Settings → WhatsApp, setting a branch's notifications up in one go: several added at once, saved and sent to
// Meta with one button, all sent to Meta together, and the approved ones switched on together.
type Sent = Record<string, unknown> & { action: string; event?: string; events?: string[]; enabled?: boolean };
/** `metaId`: Meta has a template for it (sent from here, or linked by "Check approvals"). */
type Saved = { status: string; enabled: boolean; body?: string; metaId?: string | null };

const world = vi.hoisted(() => ({
  calls: [] as Sent[],
  connected: true,
  /** The notifications the branch has added. */
  saved: {} as Record<string, Saved>,
  /** What "Check approvals" finds at Meta (by event): it links those, adding the ones the branch has not. */
  atMeta: {} as Record<string, string>,
  /** Events Meta refuses, with its message. */
  refuse: {} as Record<string, string>,
  /** Submissions held back until the test lets them go. */
  hold: null as null | (() => void)[],
  /** How many submissions were with Meta at the same moment, at most. */
  together: 0,
  running: 0,
  reloadBranches: vi.fn(),
}));

const EVENTS: Pick<MessageEvent, 'key' | 'label' | 'group' | 'audience'>[] = [
  { key: 'member_welcome', label: 'Welcome', group: 'MEMBERSHIP', audience: 'MEMBER' },
  { key: 'member_renewed', label: 'Plan renewed', group: 'MEMBERSHIP', audience: 'MEMBER' },
  { key: 'books_issued', label: 'Books issued', group: 'BORROWING', audience: 'MEMBER' },
  { key: 'books_returned', label: 'Books returned', group: 'BORROWING', audience: 'MEMBER' },
  { key: 'book_lost', label: 'Book lost', group: 'BORROWING', audience: 'MEMBER' },
  { key: 'leave_decided', label: 'Leave decided', group: 'STAFF', audience: 'STAFF' },
];
const BODY = 'Hello {{member_name}}, this is a plain update about your account at the library.';

const overview = () => ({
  settings: world.connected ? { enabled: true, phoneNumberId: '123456', wabaId: '654321', displayPhone: '+91 98765 00000', verifiedName: 'Central', hasAppSecret: true, language: 'en' } : null,
  webhook: null,
  events: EVENTS.map((e) => {
    const own = world.saved[e.key];
    return {
      ...e,
      when: 'When it happens',
      variables: [{ key: 'member_name', label: 'Member', sample: 'Asha' }],
      body: BODY,
      added: !!own,
      template: { event: e.key, enabled: own?.enabled ?? false, name: `stories_${e.key}`, language: 'en', body: own?.body ?? BODY, status: own?.status ?? 'NOT_SUBMITTED', reason: null, metaId: own?.metaId ?? null },
    };
  }),
});

async function answer(data: Sent): Promise<unknown> {
  world.calls.push(data);
  switch (data.action) {
    case 'whatsapp-overview':
      return overview();
    case 'whatsapp-log':
      return { messages: [] };
    case 'whatsapp-saveConnection':
      world.connected = true;
      return { displayPhone: '+91 98765 00000', verifiedName: 'Central' };
    case 'whatsapp-addTemplates': {
      const added = data.events!.filter((k) => !world.saved[k]);
      for (const k of added) world.saved[k] = { status: 'NOT_SUBMITTED', enabled: false };
      return { added };
    }
    case 'whatsapp-switchTemplates': {
      const switched = data.events!.filter((k) => world.saved[k] && world.saved[k].enabled !== data.enabled);
      for (const k of switched) world.saved[k].enabled = data.enabled!;
      return { switched };
    }
    case 'whatsapp-saveTemplate': {
      // As the server does: new wording means "not submitted" again, and the link to Meta's template stays.
      const own = world.saved[data.event!];
      const status = !own || (own.body ?? BODY) !== data.body ? 'NOT_SUBMITTED' : own.status;
      world.saved[data.event!] = { status, enabled: data.enabled!, body: data.body as string, metaId: own?.metaId ?? null };
      return { status };
    }
    case 'whatsapp-syncTemplates': {
      // As the server does: one reworded since Meta saw it (not submitted, yet linked) keeps its status.
      const statuses = Object.fromEntries(Object.entries(world.atMeta).filter(([k]) => !(world.saved[k]?.status === 'NOT_SUBMITTED' && world.saved[k].metaId)));
      for (const [k, status] of Object.entries(statuses)) world.saved[k] = { ...world.saved[k], enabled: world.saved[k]?.enabled ?? false, status, metaId: `tpl_${k}` };
      return { statuses, found: Object.keys(world.atMeta).length, missing: [] };
    }
    case 'whatsapp-submitTemplate': {
      world.together = Math.max(world.together, ++world.running);
      if (world.hold) await new Promise<void>((go) => world.hold!.push(go));
      else await Promise.resolve();
      world.running--;
      const refused = world.refuse[data.event!];
      if (refused) throw Object.assign(new FirebaseError('functions/failed-precondition', refused), { details: { reason: 'WHATSAPP_ERROR' } });
      world.saved[data.event!] = { ...world.saved[data.event!], status: 'PENDING', metaId: `tpl_${data.event!}` };
      return { status: 'PENDING' };
    }
    default:
      throw new Error(`unexpected ${data.action}`);
  }
}

vi.mock('firebase/functions', () => ({ httpsCallable: () => async (data: Sent) => ({ data: await answer(data) }) }));
vi.mock('../data/services', () => ({ services: () => ({ fns: { region: 'asia-south1', app: { options: { projectId: 'demo' } } }, db: {} }) }));
vi.mock('../admin/Workspace', () => ({
  useWorkspace: () => ({ org: { id: 'o1' }, branch: { id: 'b1', name: 'Central' }, branchesLoading: false, reloadBranches: world.reloadBranches }),
}));

const { submitAllTemplates, templateActions, templatesNeedingAction } = await import('../data/whatsapp');
const { WhatsAppPage } = await import('../admin/organization/WhatsApp');

const sent = (action: string) => world.calls.filter((c) => c.action === action);
const add = (...keys: string[]) => keys.forEach((k) => (world.saved[k] = { status: 'NOT_SUBMITTED', enabled: false }));

async function open() {
  render(<WhatsAppPage />);
  await screen.findByRole('heading', { name: wt.messages });
  return userEvent.setup();
}

beforeEach(() => {
  world.calls.length = 0;
  world.connected = true;
  world.saved = {};
  world.atMeta = {};
  world.refuse = {};
  world.hold = null;
  world.together = 0;
  world.running = 0;
  world.reloadBranches.mockClear();
});

describe('what a branch’s notifications wait for', () => {
  it('sorts the added ones into to submit, to fix and to switch on, and counts the first two for the menu', async () => {
    add('member_welcome', 'books_issued');
    world.saved.member_renewed = { status: 'REJECTED', enabled: false };
    world.saved.books_returned = { status: 'APPROVED', enabled: false };
    world.saved.book_lost = { status: 'APPROVED', enabled: true };
    const actions = templateActions(overview().events as MessageEvent[]);
    expect(actions.toSubmit.map((e) => e.key)).toEqual(['member_welcome', 'books_issued']);
    expect(actions.toFix.map((e) => e.key)).toEqual(['member_renewed']);
    expect(actions.toSwitchOn.map((e) => e.key)).toEqual(['books_returned']);
    // leave_decided was never added: it waits for nobody.
    expect(await templatesNeedingAction('o1', 'b1')).toBe(3);
    expect(sent('whatsapp-overview')).toHaveLength(1);
  });
});

describe('submitAllTemplates', () => {
  it('checks with Meta first, then sends only what is added and still not submitted, three at a time', async () => {
    add('member_welcome', 'member_renewed', 'books_issued', 'books_returned', 'book_lost');
    // Meta already has two of them (one approved, one rejected) and one the branch never added.
    world.atMeta = { member_welcome: 'APPROVED', member_renewed: 'REJECTED', leave_decided: 'APPROVED' };
    world.refuse = { books_returned: 'WhatsApp: There is already English content for this template.' };
    world.hold = [];
    const progress: string[] = [];
    const run = submitAllTemplates('o1', 'b1', (done, total) => progress.push(`${done}/${total}`));
    await waitFor(() => expect(world.hold).toHaveLength(3));
    expect(world.calls.map((c) => c.action).slice(0, 2)).toEqual(['whatsapp-syncTemplates', 'whatsapp-overview']);
    world.hold.forEach((go) => go());
    world.hold = null;
    const result = await run;
    expect(sent('whatsapp-submitTemplate').map((c) => c.event).sort()).toEqual(['book_lost', 'books_issued', 'books_returned']);
    expect(world.together).toBe(3);
    expect(result.sent.sort()).toEqual(['book_lost', 'books_issued']);
    expect(result.failed).toEqual([{ event: 'books_returned', label: 'Books returned', error: 'WhatsApp: There is already English content for this template.' }]);
    expect(progress[0]).toBe('0/3');
    expect(progress.at(-1)).toBe('3/3');
  });

  it('never has more than three with Meta at once, and sends nothing when nothing is left', async () => {
    add(...EVENTS.map((e) => e.key));
    const all = await submitAllTemplates('o1', 'b1');
    expect(all.sent).toHaveLength(6);
    expect(world.together).toBeLessThanOrEqual(3);
    world.calls.length = 0;
    expect(await submitAllTemplates('o1', 'b1')).toEqual({ sent: [], failed: [] });
    expect(sent('whatsapp-submitTemplate')).toHaveLength(0);
  });
});

describe('the WhatsApp page', () => {
  it('adds every notification with one press', async () => {
    add('member_welcome');
    const user = await open();
    await user.click(screen.getByRole('button', { name: wt.add }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: wt.addAll(5) }));
    await waitFor(() => expect(sent('whatsapp-addTemplates')).toHaveLength(1));
    expect(sent('whatsapp-addTemplates')[0].events).toEqual(['member_renewed', 'books_issued', 'books_returned', 'book_lost', 'leave_decided']);
    expect(await screen.findByText(wt.addedMany(5))).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(await screen.findByRole('button', { name: `${wt.edit}: Leave decided` })).toBeInTheDocument();
  });

  it('adds one group with one press', async () => {
    const user = await open();
    await user.click(screen.getByRole('button', { name: wt.add }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: `${wt.addThese}: ${wt.groups.BORROWING}` }));
    await waitFor(() => expect(sent('whatsapp-addTemplates')).toHaveLength(1));
    expect(sent('whatsapp-addTemplates')[0].events).toEqual(['books_issued', 'books_returned', 'book_lost']);
  });

  it('saves a notification and sends it to Meta with one button, then closes', async () => {
    const user = await open();
    await user.click(screen.getByRole('button', { name: wt.add }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /Welcome/ }));
    await user.click(await screen.findByRole('button', { name: wt.saveAndSubmit }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const order = world.calls.map((c) => c.action).filter((a) => a === 'whatsapp-saveTemplate' || a === 'whatsapp-submitTemplate');
    expect(order).toEqual(['whatsapp-saveTemplate', 'whatsapp-submitTemplate']);
    expect(world.saved.member_welcome.status).toBe('PENDING');
  });

  it('keeps the dialog open with Meta’s message when the wording is saved but Meta refuses it', async () => {
    world.refuse = { member_welcome: 'WhatsApp: Template name is already in use.' };
    const user = await open();
    await user.click(screen.getByRole('button', { name: wt.add }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /Welcome/ }));
    await user.click(await screen.findByRole('button', { name: wt.saveAndSubmit }));
    expect(await screen.findByText('WhatsApp: Template name is already in use.')).toBeInTheDocument();
    expect(screen.getByText(wt.savedNotSubmitted)).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(world.saved.member_welcome).toMatchObject({ status: 'NOT_SUBMITTED', enabled: false });
  });

  it('locks the buttons of a notification while one of them waits for Meta', async () => {
    world.saved.member_welcome = { status: 'REJECTED', enabled: false, metaId: 'tpl_member_welcome' };
    world.hold = [];
    const user = await open();
    await user.click(screen.getByRole('button', { name: `${wt.edit}: Welcome` }));
    let dialog = await screen.findByRole('dialog');
    const button = (name: string) => within(dialog).getByRole('button', { name });
    await user.type(within(dialog).getByLabelText(wt.testTo), '9876543210');
    for (const name of [wt.submit, wt.sendTest, wt.remove, wt.saveAndSubmit, t.save]) expect(button(name)).toBeEnabled();

    // "Save and submit to Meta" is with Meta: a second send, a test or a removal must wait for it.
    await user.click(button(wt.saveAndSubmit));
    await waitFor(() => expect(world.hold).toHaveLength(1));
    for (const name of [wt.submit, wt.sendTest, wt.remove]) expect(button(name)).toBeDisabled();
    world.hold.forEach((go) => go());
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(sent('whatsapp-submitTemplate')).toHaveLength(1);

    // The other way round: "Submit to Meta" below is with Meta, so nothing can be saved or sent from above.
    await screen.findByText(wt.status.PENDING);
    world.hold = [];
    await user.click(screen.getByRole('button', { name: `${wt.edit}: Welcome` }));
    dialog = await screen.findByRole('dialog');
    await user.click(button(wt.submit));
    await waitFor(() => expect(world.hold).toHaveLength(1));
    for (const name of [wt.saveAndSubmit, t.save, wt.remove]) expect(button(name)).toBeDisabled();
    world.hold.forEach((go) => go());
    world.hold = null;
    expect(await within(dialog).findByText(wt.submitted('PENDING'))).toBeInTheDocument();
    for (const name of [wt.saveAndSubmit, t.save, wt.remove]) expect(button(name)).toBeEnabled();
    expect(sent('whatsapp-submitTemplate')).toHaveLength(2);
    expect(sent('whatsapp-removeTemplate')).toHaveLength(0);
  });

  it('sends a notification again with "Submit all to Meta" once it was reworded, whatever Meta said of the old wording', async () => {
    // Meta rejected the first wording of one and approved the first wording of another; a third it has never seen.
    world.saved.books_issued = { status: 'REJECTED', enabled: false, metaId: 'tpl_books_issued' };
    world.saved.books_returned = { status: 'APPROVED', enabled: false, metaId: 'tpl_books_returned' };
    world.atMeta = { books_issued: 'REJECTED', books_returned: 'APPROVED', member_welcome: 'APPROVED' };
    add('member_welcome');
    const user = await open();
    for (const label of ['Books issued', 'Books returned']) {
      await user.click(screen.getByRole('button', { name: `${wt.edit}: ${label}` }));
      const dialog = await screen.findByRole('dialog');
      await user.type(within(dialog).getByLabelText(wt.body, { exact: false }), ' Thank you for reading with us.');
      await user.click(within(dialog).getByRole('button', { name: t.save }));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    }
    // Both reworded ones and the never-sent one are counted, and the reworded ones are really sent.
    await user.click(await screen.findByRole('button', { name: wt.submitAll(3) }));
    expect(await screen.findByText(wt.submittedAll(2, 0))).toBeInTheDocument();
    expect(sent('whatsapp-submitTemplate').map((c) => c.event).sort()).toEqual(['books_issued', 'books_returned']);
    expect(world.saved.books_issued).toMatchObject({ status: 'PENDING', body: `${BODY} Thank you for reading with us.` });
    expect(world.saved.books_returned.status).toBe('PENDING');
    // The one Meta already had under that name is linked, not sent again; it is the only one to switch on.
    expect(world.saved.member_welcome.status).toBe('APPROVED');
    expect(await screen.findByRole('button', { name: wt.switchOnApproved(1) })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Submit all to Meta/ })).not.toBeInTheDocument();
  });

  it('switches on every approved notification with one press', async () => {
    add('member_welcome');
    world.saved.books_issued = { status: 'APPROVED', enabled: false };
    world.saved.books_returned = { status: 'APPROVED', enabled: false };
    world.saved.book_lost = { status: 'APPROVED', enabled: true };
    const user = await open();
    await user.click(screen.getByRole('button', { name: wt.switchOnApproved(2) }));
    expect(await screen.findByText(wt.switchedOn(2))).toBeInTheDocument();
    expect(sent('whatsapp-switchTemplates')).toMatchObject([{ events: ['books_issued', 'books_returned'], enabled: true }]);
    await waitFor(() => expect(screen.queryByRole('button', { name: /Switch on all approved/ })).not.toBeInTheDocument());
  });

  it('sends everything to Meta with one press, says what Meta did not take, and locks the list meanwhile', async () => {
    add('member_welcome', 'books_issued', 'books_returned');
    world.refuse = { books_issued: 'WhatsApp: Too many templates created. Try again later.' };
    world.hold = [];
    const user = await open();
    await user.click(screen.getByRole('button', { name: wt.submitAll(3) }));
    await waitFor(() => expect(world.hold).toHaveLength(3));
    // While it runs nothing may be added, edited, switched or checked: each send writes the notification back as it read it.
    expect(screen.getByRole('button', { name: wt.submittingAll(0, 3) })).toBeDisabled();
    expect(screen.getByRole('button', { name: wt.add })).toBeDisabled();
    expect(screen.getByRole('button', { name: wt.checkApprovals })).toBeDisabled();
    expect(screen.getByRole('button', { name: `${wt.edit}: Welcome` })).toBeDisabled();
    expect(screen.getByRole('switch', { name: `${wt.sendThis}: Welcome` })).toBeDisabled();
    world.hold.forEach((go) => go());
    world.hold = null;
    expect(await screen.findByText(wt.submittedAll(2, 1))).toBeInTheDocument();
    expect(screen.getByText(wt.submitFailed(1))).toBeInTheDocument();
    expect(screen.getByText('WhatsApp: Too many templates created. Try again later.')).toBeInTheDocument();
    // The one Meta refused is still waiting: the button offers it again.
    expect(await screen.findByRole('button', { name: wt.submitAll(1) })).toBeEnabled();
    expect(screen.getByRole('button', { name: wt.add })).toBeEnabled();
  });

  it('offers no sending to Meta before the branch is connected, and reads the branches again once it is', async () => {
    world.connected = false;
    add('member_welcome');
    const user = await open();
    expect(screen.queryByRole('button', { name: /Submit all to Meta/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: wt.checkApprovals })).not.toBeInTheDocument();
    await user.type(screen.getByLabelText(wt.phoneNumberId), '123456');
    await user.type(screen.getByLabelText(wt.wabaId), '654321');
    await user.type(screen.getByLabelText(wt.token), 'token');
    await user.click(screen.getByRole('button', { name: wt.saveConnection }));
    await waitFor(() => expect(world.reloadBranches).toHaveBeenCalledTimes(1));
    expect(sent('whatsapp-saveConnection')).toHaveLength(1);
    expect(await screen.findByRole('button', { name: wt.submitAll(1) })).toBeInTheDocument();
  });
});
