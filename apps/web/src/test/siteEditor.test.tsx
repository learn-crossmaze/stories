import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation, useParams } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Item, ItemView } from '../data/site';
import { st } from '../strings/site';

// A Website editor (the shared hook and its bar) with the server faked at the data layer.
interface Draft {
  title: string;
  hidden: boolean;
}
const getSite = vi.fn();
const saveSite = vi.fn();
const publishSite = vi.fn();
const unpublishSite = vi.fn();
const discardSite = vi.fn();
const requestReview = vi.fn();
const deleteSite = vi.fn();
vi.mock('../data/site', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../data/site')>()),
  getSite, saveSite, publishSite, unpublishSite, discardSite, requestReview, deleteSite,
}));

const { PublishBar, useSiteItem } = await import('../admin/website/kit');

const view = (over: Partial<ItemView> = {}): ItemView => ({
  id: 'p1', exists: true, status: 'CHANGED', isLive: true, changed: true, liveSlug: null, liveOn: null, previewToken: null, review: null,
  updatedAt: '2026-11-12T10:00:00.000Z', updatedBy: 'Priya', publishedAt: null, publishedBy: null, canPublish: true, canDelete: true, ...over,
});
const stored = (draft: Draft, over: Partial<ItemView> = {}): Item<Draft> => ({ ...view(over), kind: 'promotion', orgId: null, branchName: null, createdBy: 'Priya', draft });

/** A promise the test settles when it chooses, to act while a request is on its way. */
function later<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<T>((res, rej) => ((resolve = res), (reject = rej)));
  return { promise, resolve, reject };
}

function Editor() {
  const { id } = useParams();
  const { pathname } = useLocation();
  const item = useSiteItem<Draft>({ kind: 'promotion', id, blank: () => ({ title: '', hidden: false }), pathOf: (x) => `/offers/${x}` });
  const d = item.e.draft;
  if (item.loading) return <p>Loading</p>;
  if (item.error || !d) return <p role="alert">{item.error}</p>;
  return (
    <>
      <PublishBar kind="promotion" message={item.e.message} state={item.state} onSave={item.save} onPublish={() => item.publish('Published.')} onUnpublish={item.saved ? item.unpublish : undefined} onDiscard={item.discard} />
      <label>
        Title
        <input value={d.title} onChange={(ev) => item.e.update({ title: ev.target.value })} />
      </label>
      <p data-testid="path">{pathname}</p>
    </>
  );
}

const open = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/offers/:id" element={<Editor />} />
      </Routes>
    </MemoryRouter>,
  );
const title = () => screen.findByLabelText<HTMLInputElement>('Title');
const button = (name: string) => screen.getByRole('button', { name });

beforeEach(() => {
  for (const fn of [getSite, saveSite, publishSite, unpublishSite, discardSite, requestReview, deleteSite]) fn.mockReset();
});

describe('a Website editor', () => {
  it('keeps what is typed while a save is on its way, and still calls it unsaved', async () => {
    const user = userEvent.setup();
    getSite.mockResolvedValue(stored({ title: 'Diwali', hidden: false }, { status: 'LIVE', changed: false }));
    open('/offers/p1');
    await user.type(await title(), ' offer');
    expect(screen.getByText(st.unsaved)).toBeInTheDocument();

    const saving = later<ItemView>();
    saveSite.mockReturnValueOnce(saving.promise);
    await user.click(button(st.save));
    expect(saveSite).toHaveBeenCalledWith('promotion', { title: 'Diwali offer', hidden: false }, 'p1', undefined, false);
    // The fields stay open during the save: more is typed before it answers.
    await user.type(await title(), ' 2026');
    saving.resolve(view());
    expect(await screen.findByText(st.saved)).toBeInTheDocument();
    expect((await title()).value).toBe('Diwali offer 2026');
    expect(screen.getByText(st.unsaved)).toBeInTheDocument();
    expect(button(st.save)).toBeEnabled();
    // The item was read once, when the editor opened: never again after a save.
    expect(getSite).toHaveBeenCalledTimes(1);

    // The next save sends the rest, and now nothing is unsaved: the bar shows what the save answered.
    saveSite.mockResolvedValueOnce(view());
    await user.click(button(st.save));
    expect(saveSite).toHaveBeenLastCalledWith('promotion', { title: 'Diwali offer 2026', hidden: false }, 'p1', undefined, false);
    expect(await screen.findByText(st.changedNotPublished)).toBeInTheDocument();
    expect(screen.getByText(st.status.CHANGED)).toBeInTheDocument();
    expect(button(st.save)).toBeDisabled();
    expect(getSite).toHaveBeenCalledTimes(1);
  });

  it('saves and publishes unsaved changes in one request; a saved draft is only published', async () => {
    const user = userEvent.setup();
    getSite.mockResolvedValue(stored({ title: 'Diwali', hidden: false }));
    open('/offers/p1');
    // Nothing typed, changes saved earlier: Publish alone.
    await title();
    publishSite.mockResolvedValueOnce({ ...view({ status: 'LIVE', changed: false }), result: 'publish' });
    await user.click(button(st.publish));
    expect(await screen.findByText('Published.')).toBeInTheDocument();
    expect(publishSite).toHaveBeenCalledWith('promotion', 'p1');
    expect(saveSite).not.toHaveBeenCalled();
    expect(screen.getByText(st.upToDate)).toBeInTheDocument();
    expect(button(st.publish)).toBeDisabled();

    // Typed since: one request saves and publishes.
    await user.type(await title(), '!');
    saveSite.mockResolvedValueOnce({ ...view({ status: 'LIVE', changed: false }), result: 'publish' });
    await user.click(button(st.saveAndPublish));
    await waitFor(() => expect(saveSite).toHaveBeenCalledWith('promotion', { title: 'Diwali!', hidden: false }, 'p1', undefined, true));
    expect(await screen.findByText(st.upToDate)).toBeInTheDocument();
    expect(publishSite).toHaveBeenCalledTimes(1);
    expect(getSite).toHaveBeenCalledTimes(1);
  });

  it('keeps the draft unsaved, with the server’s reason, when it cannot be published', async () => {
    const user = userEvent.setup();
    getSite.mockResolvedValue(stored({ title: 'Diwali', hidden: false }, { status: 'LIVE', changed: false }));
    open('/offers/p1');
    await user.type(await title(), '!');
    saveSite.mockRejectedValueOnce(new (await import('../data/api')).ApiError('Another item already uses this address.', 'SLUG_TAKEN'));
    await user.click(button(st.saveAndPublish));
    expect(await screen.findByRole('alert')).toHaveTextContent('Another item already uses this address.');
    expect(screen.getByText(st.unsaved)).toBeInTheDocument();
    expect((await title()).value).toBe('Diwali!');
    expect(button(st.save)).toBeEnabled();
  });

  it('gives a new item its address after the first save without reading it back', async () => {
    const user = userEvent.setup();
    open('/offers/new');
    await user.type(await title(), 'Summer');
    expect(getSite).not.toHaveBeenCalled();
    // Never saved: Publish saves and publishes in one request.
    expect(button(st.saveAndPublish)).toBeEnabled();

    const saving = later<ItemView>();
    saveSite.mockReturnValueOnce(saving.promise);
    await user.click(button(st.save));
    expect(saveSite).toHaveBeenCalledWith('promotion', { title: 'Summer', hidden: false }, undefined, undefined, false);
    await user.type(await title(), ' reading');
    saving.resolve(view({ id: 'abc', status: 'DRAFT', isLive: false }));
    await waitFor(() => expect(screen.getByTestId('path')).toHaveTextContent('/offers/abc'));
    // Same editor, same text, nothing read: the save's answer is all it needs.
    expect((await title()).value).toBe('Summer reading');
    expect(screen.getByText(st.unsaved)).toBeInTheDocument();
    expect(screen.getByText(st.status.DRAFT)).toBeInTheDocument();
    expect(getSite).not.toHaveBeenCalled();

    // From now on it is saved under its id.
    saveSite.mockResolvedValueOnce(view({ id: 'abc', status: 'DRAFT', isLive: false }));
    await user.click(button(st.save));
    await waitFor(() => expect(saveSite).toHaveBeenLastCalledWith('promotion', { title: 'Summer reading', hidden: false }, 'abc', undefined, false));
    expect(await screen.findByText(st.notPublished)).toBeInTheDocument();
    expect(getSite).not.toHaveBeenCalled();
  });

  it('puts the live copy back on screen after "Go back to the live version"', async () => {
    const user = userEvent.setup();
    getSite.mockResolvedValueOnce(stored({ title: 'Diwali, edited', hidden: false }));
    open('/offers/p1');
    expect((await title()).value).toBe('Diwali, edited');
    discardSite.mockResolvedValueOnce({ id: 'p1' });
    getSite.mockResolvedValueOnce(stored({ title: 'Diwali', hidden: false }, { status: 'LIVE', changed: false }));
    await user.click(button(st.discard));
    expect(await screen.findByText(st.discarded)).toBeInTheDocument();
    expect(discardSite).toHaveBeenCalledWith('promotion', 'p1');
    expect((await title()).value).toBe('Diwali');
    expect(screen.getByText(st.upToDate)).toBeInTheDocument();
    expect(getSite).toHaveBeenCalledTimes(2);
  });

  it('shows what taking it off the website answered, and says when an item is not there', async () => {
    const user = userEvent.setup();
    getSite.mockResolvedValueOnce(stored({ title: 'Diwali', hidden: false }, { status: 'LIVE', changed: false }));
    const first = open('/offers/p1');
    await title();
    unpublishSite.mockResolvedValueOnce({ ...view({ status: 'DRAFT', isLive: false, changed: true }), result: 'unpublish' });
    await user.click(button(st.unpublish));
    expect(await screen.findByText(st.takenDown)).toBeInTheDocument();
    expect(screen.getByText(st.status.DRAFT)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: st.unpublish })).not.toBeInTheDocument();
    expect(getSite).toHaveBeenCalledTimes(1);
    first.unmount();

    // An id nothing is stored under: the server answers with no draft.
    getSite.mockResolvedValueOnce({ ...stored({ title: '', hidden: false }), exists: false, draft: null });
    open('/offers/gone');
    expect(await screen.findByRole('alert')).toHaveTextContent(st.notFound);
  });
});
