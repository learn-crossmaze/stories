import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The Website overview's shared read (data/site.ts), with the server faked at the data layer's own boundary.
const call = vi.fn();
const command = vi.fn();
vi.mock('../data/api', () => ({ call, command }));

const site = await import('../data/site');

const overviewOf = (n: number) => ({ counts: { newSubmissions: n, callsThisWeek: 0, openJobs: 0, alertRecipients: 1 }, rights: { manager: true, canWrite: true, branches: [] }, pending: [], reviews: [], recent: [] });
const overviewCalls = () => call.mock.calls.filter(([action]) => action === 'site-overview').length;

/** Every change in the Website section: each must make the next read of the overview a fresh one. */
const CHANGES: [string, () => Promise<unknown>][] = [
  ['site-save', () => site.saveSite('post', { title: 'A post' }, 'p1')],
  ['site-publish', () => site.publishSite('post', 'p1')],
  ['site-unpublish', () => site.unpublishSite('post', 'p1')],
  ['site-discard', () => site.discardSite('sections')],
  ['site-delete', () => site.deleteSite('post', 'p1')],
  ['site-requestReview', () => site.requestReview('p1')],
  ['site-publishAll', () => site.publishAll()],
  ['site-markHandled', () => site.markHandled('s1', true)],
  ['site-deleteSubmission', () => site.deleteSubmission('s1')],
];

let served = 0;

beforeEach(() => {
  vi.useFakeTimers();
  served = 0;
  call.mockReset().mockImplementation(async () => overviewOf(++served));
  command.mockReset().mockResolvedValue({ id: 'p1' });
  // Each test starts with nothing kept from the one before.
  site.invalidateSiteOverview();
});
afterEach(() => vi.useRealTimers());

describe('the shared Website overview', () => {
  it('serves the menu, the Publish button and the dashboard from one request', async () => {
    const [a, b, c] = await Promise.all([site.siteOverview('u1'), site.siteOverview('u1'), site.siteOverview('u1')]);
    expect(overviewCalls()).toBe(1);
    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(call).toHaveBeenCalledWith('site-overview', {});
  });

  it('reuses an answer for 30 seconds, then reads again', async () => {
    await site.siteOverview('u1');
    vi.advanceTimersByTime(29_000);
    expect((await site.siteOverview('u1')).counts.newSubmissions).toBe(1);
    expect(overviewCalls()).toBe(1);
    vi.advanceTimersByTime(2_000);
    expect((await site.siteOverview('u1')).counts.newSubmissions).toBe(2);
    expect(overviewCalls()).toBe(2);
  });

  it('never hands one person another person’s overview (signing out does not reload the page)', async () => {
    await site.siteOverview('u1');
    expect((await site.siteOverview('u2')).counts.newSubmissions).toBe(2);
    expect(overviewCalls()).toBe(2);
    // Without the person's id nothing is shared: a plain read each time.
    await site.siteOverview();
    await site.siteOverview(null);
    expect(overviewCalls()).toBe(4);
    expect((await site.siteOverview('u2')).counts.newSubmissions).toBe(2);
    expect(overviewCalls()).toBe(4);
  });

  it('does not keep a failure: Try again really reads again', async () => {
    call.mockRejectedValueOnce(new Error('offline'));
    await expect(site.siteOverview('u1')).rejects.toThrow('offline');
    expect((await site.siteOverview('u1')).counts.newSubmissions).toBe(1);
    expect(overviewCalls()).toBe(2);
  });

  it.each(CHANGES)('reads again after %s, and tells whoever shows it', async (action, change) => {
    const heard = vi.fn();
    const stop = site.onSiteOverviewChange(heard);
    const onWindow = vi.fn();
    window.addEventListener(site.SITE_CHANGED, onWindow);
    await site.siteOverview('u1');
    await change();
    expect(command.mock.calls.map(([name]) => name)).toEqual([action]);
    expect(heard).toHaveBeenCalledTimes(1);
    expect(onWindow).toHaveBeenCalledTimes(1);
    expect((await site.siteOverview('u1')).counts.newSubmissions).toBe(2);
    expect(overviewCalls()).toBe(2);
    // Once stopped, nothing more is heard.
    stop();
    window.removeEventListener(site.SITE_CHANGED, onWindow);
    await change();
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it.each(CHANGES)('reads again after %s failed too (it may have happened all the same)', async (_action, change) => {
    const heard = vi.fn();
    const stop = site.onSiteOverviewChange(heard);
    await site.siteOverview('u1');
    command.mockRejectedValueOnce(new Error('timeout'));
    await expect(change()).rejects.toThrow('timeout');
    expect(heard).toHaveBeenCalledTimes(1);
    await site.siteOverview('u1');
    expect(overviewCalls()).toBe(2);
    stop();
  });

  it('never serves a read that started before a change', async () => {
    let answerOld: (v: unknown) => void = () => undefined;
    call.mockImplementationOnce(() => new Promise((resolve) => (answerOld = resolve)));
    const early = site.siteOverview('u1');
    await site.saveSite('post', { title: 'A post' }, 'p1');
    // The earlier read is still on its way: the next caller must not be given it.
    const fresh = site.siteOverview('u1');
    expect(overviewCalls()).toBe(2);
    answerOld(overviewOf(99));
    expect((await early).counts.newSubmissions).toBe(99);
    expect((await fresh).counts.newSubmissions).toBe(1);
    // Nor is it kept once it lands.
    expect((await site.siteOverview('u1')).counts.newSubmissions).toBe(1);
    expect(overviewCalls()).toBe(2);
  });

  it('a failed read that was already replaced does not drop the newer one', async () => {
    let failOld: (e: Error) => void = () => undefined;
    call.mockImplementationOnce(() => new Promise((_resolve, reject) => (failOld = reject)));
    const early = site.siteOverview('u1');
    site.invalidateSiteOverview();
    await site.siteOverview('u1');
    failOld(new Error('offline'));
    await expect(early).rejects.toThrow('offline');
    await site.siteOverview('u1');
    expect(overviewCalls()).toBe(2);
  });
});

describe('what the website actions send', () => {
  it('saves and publishes in one request, and sends no note unless one is given', async () => {
    await site.saveSite('branch', { slug: 'central' }, 'b1', 'o1', true);
    await site.saveSite('sections', { faqs: [] });
    await site.markHandled('s1', true);
    await site.markHandled('s1', false, '');
    expect(command.mock.calls).toEqual([
      ['site-save', { kind: 'branch', draft: { slug: 'central' }, id: 'b1', orgId: 'o1', publish: true }],
      ['site-save', { kind: 'sections', draft: { faqs: [] } }],
      ['site-markHandled', { id: 's1', handled: true }],
      ['site-markHandled', { id: 's1', handled: false, note: '' }],
    ]);
    call.mockResolvedValueOnce({ items: [] }).mockResolvedValueOnce({ id: 's1' });
    await site.listSubmissions(true);
    await site.getSubmission('s1');
    expect(call.mock.calls).toEqual([['site-submissions', { open: true }], ['site-submission', { id: 's1' }]]);
  });
});
