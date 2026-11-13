import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../data/api';
import type { Submission } from '../data/site';
import { paths } from '../paths';
import { st } from '../strings/site';

// The Website section's enquiries, with the server faked at the data layer: `store` is what it holds.
let store: Submission[] = [];
const listSubmissions = vi.fn(async (open: boolean) => store.filter((s) => !open || !s.handled));
const getSubmission = vi.fn(async (id: string) => {
  const s = store.find((x) => x.id === id);
  if (!s) throw new ApiError('Submission was not found.', 'NOT_FOUND');
  return s;
});
const markHandled = vi.fn(async (id: string, handled: boolean, note?: string) => {
  store = store.map((s) => (s.id === id ? { ...s, handled, ...(note === undefined ? {} : { note }) } : s));
});
const deleteSubmission = vi.fn(async (id: string) => {
  store = store.filter((s) => s.id !== id);
});
vi.mock('../data/site', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../data/site')>()),
  listSubmissions, getSubmission, markHandled, deleteSubmission,
}));

const { SubmissionsPage, SubmissionPage } = await import('../admin/website/Submissions');

const enquiry = (id: string, name: string, over: Partial<Submission> = {}): Submission => ({
  id, form: 'MEMBERSHIP', name, phone: '9876543210', email: '', message: '', city: '', readers: '', experience: '', branchId: 'b1', branchName: 'Central',
  jobId: null, jobTitle: null, page: '/branches/central', resume: null, handled: false, createdAt: '2026-11-12T10:00:00.000Z', ...over,
});

const open = (path: string = paths.adminWebsiteSubmissions) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={paths.adminWebsiteSubmissions} element={<SubmissionsPage />} />
        <Route path={paths.adminWebsiteSubmission(':submissionId')} element={<SubmissionPage />} />
      </Routes>
    </MemoryRouter>,
  );
const rowOf = (name: string) => screen.getByRole('link', { name }).closest('tr')!;
const markButton = (name: string) => screen.getByRole('button', { name: st.markFollowedUpFor(name) });

beforeEach(() => {
  store = [enquiry('s1', 'Asha Rao', { note: 'Call back on Monday' }), enquiry('s2', 'Ravi Kumar')];
  for (const fn of [listSubmissions, getSubmission, markHandled, deleteSubmission]) fn.mockClear();
});

describe('enquiries: the list', () => {
  it('asks for the open ones only, and marks one followed up with one click, without touching its note', async () => {
    const user = userEvent.setup();
    open();
    await screen.findByRole('link', { name: 'Asha Rao' });
    expect(listSubmissions).toHaveBeenCalledWith(true);

    await user.click(markButton('Asha Rao'));
    // No note is sent: the one written on the enquiry's page stays.
    expect(markHandled).toHaveBeenCalledWith('s1', true);
    await waitFor(() => expect(screen.queryByRole('link', { name: 'Asha Rao' })).not.toBeInTheDocument());
    expect(screen.getByRole('link', { name: 'Ravi Kumar' })).toBeInTheDocument();
    expect(store.find((s) => s.id === 's1')).toMatchObject({ handled: true, note: 'Call back on Monday' });
    const notice = await screen.findByRole('status');
    expect(notice).toHaveTextContent(st.markedHandled('Asha Rao'));

    // A slip is put right at once.
    await user.click(within(notice).getByRole('button', { name: st.undo }));
    expect(markHandled).toHaveBeenLastCalledWith('s1', false);
    expect(await screen.findByRole('link', { name: 'Asha Rao' })).toBeInTheDocument();
    expect(screen.queryByText(st.markedHandled('Asha Rao'))).not.toBeInTheDocument();
    expect(store.find((s) => s.id === 's1')).toMatchObject({ handled: false, note: 'Call back on Monday' });
  });

  it('puts the row back and says why when marking fails', async () => {
    const user = userEvent.setup();
    open();
    await screen.findByRole('link', { name: 'Asha Rao' });
    markHandled.mockRejectedValueOnce(new ApiError('You don’t have permission to do this.', 'FORBIDDEN'));
    await user.click(markButton('Asha Rao'));
    expect(await screen.findByRole('alert')).toHaveTextContent('You don’t have permission to do this.');
    expect(screen.getByRole('link', { name: 'Asha Rao' })).toBeInTheDocument();
    expect(markButton('Asha Rao')).toBeEnabled();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('shows everything under All, handled ones without the button', async () => {
    const user = userEvent.setup();
    store = [enquiry('s1', 'Asha Rao', { handled: true }), enquiry('s2', 'Ravi Kumar')];
    open();
    await screen.findByRole('link', { name: 'Ravi Kumar' });
    expect(screen.queryByRole('link', { name: 'Asha Rao' })).not.toBeInTheDocument();
    await user.click(within(screen.getByRole('group', { name: st.show })).getByRole('button', { name: st.all }));
    await screen.findByRole('link', { name: 'Asha Rao' });
    expect(listSubmissions).toHaveBeenLastCalledWith(false);
    expect(within(rowOf('Asha Rao')).getByText(st.handled)).toBeInTheDocument();
    expect(within(rowOf('Asha Rao')).queryByRole('button')).not.toBeInTheDocument();
    // Marked here, the row stays and shows as handled.
    await user.click(markButton('Ravi Kumar'));
    await waitFor(() => expect(within(rowOf('Ravi Kumar')).getByText(st.handled)).toBeInTheDocument());
    expect(within(rowOf('Ravi Kumar')).queryByRole('button')).not.toBeInTheDocument();
  });
});

describe('enquiries: one enquiry', () => {
  it('reads that enquiry only, and saves the typed note when it is marked', async () => {
    const user = userEvent.setup();
    open(paths.adminWebsiteSubmission('s1'));
    expect(await screen.findByRole('heading', { name: 'Asha Rao' })).toBeInTheDocument();
    expect(getSubmission).toHaveBeenCalledWith('s1');
    expect(listSubmissions).not.toHaveBeenCalled();
    const note = screen.getByLabelText(st.note);
    expect(note).toHaveValue('Call back on Monday');
    await user.clear(note);
    await user.type(note, 'Joined on Tuesday');
    await user.click(screen.getByRole('button', { name: st.markHandled }));
    expect(markHandled).toHaveBeenCalledWith('s1', true, 'Joined on Tuesday');
    // Read again (this one enquiry): it now offers to reopen it.
    expect(await screen.findByRole('button', { name: st.markNotHandled })).toBeInTheDocument();
    expect(getSubmission).toHaveBeenCalledTimes(2);
    expect(listSubmissions).not.toHaveBeenCalled();
  });

  it('says so when the enquiry is not there (or is another branch’s)', async () => {
    open(paths.adminWebsiteSubmission('nope'));
    expect(await screen.findByText('Submission was not found.')).toBeInTheDocument();
  });
});
