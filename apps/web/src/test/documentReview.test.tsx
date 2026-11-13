import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FirebaseError } from 'firebase/app';
import { StrictMode } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { EmployeeDocument } from '../data/hrDocuments';
import { t } from '../strings';
import { ht } from '../strings/hr';

// The Documents page and its review dialog, with the server faked at the Cloud Functions boundary.
type Sent = { action: string; documentId?: string; decision?: string; reason?: string; requestId?: string };
const calls: Sent[] = [];
/** The server's answer to each call: a result, a thrown error, or a promise the test settles later. */
let respond: (data: Sent) => unknown = () => undefined;

vi.mock('firebase/functions', () => ({
  httpsCallable: () => async (data: Sent) => {
    calls.push(data);
    const answer = await respond(data);
    if (answer instanceof Error) throw answer;
    return { data: answer };
  },
}));
vi.mock('../data/services', () => ({ services: () => ({ fns: {}, db: {} }) }));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ claims: { v: 1, sa: true, o: {} }, user: { uid: 'me' } }) }));
vi.mock('../admin/Workspace', () => ({ useWorkspace: () => ({ org: { id: 'o1', type: 'CORPORATE' }, branchName: (id: string) => `Branch ${id}` }) }));

const doc = (id: string, over: Partial<EmployeeDocument> = {}): EmployeeDocument => ({
  id,
  orgId: 'o1',
  employeeId: `e-${id}`,
  employeeName: `Person ${id}`,
  employeeCode: `EMP-${id}`,
  employeeUid: null,
  branchId: 'b1',
  typeId: 'aadhaar',
  typeName: 'Aadhaar card',
  fileName: `${id}.jpg`,
  contentType: 'image/jpeg',
  size: 10,
  number: '',
  issuedOn: null,
  expiresOn: null,
  status: 'PENDING',
  uploadedBy: 'someone',
  uploadedByEmail: 'someone@example.test',
  selfUploaded: false,
  verifiedByEmail: null,
  rejectReason: null,
  uploadedAt: null,
  ...over,
});

/** What the queue read returns; the fake never changes it, as a read that began before a decision would not. */
let pending: EmployeeDocument[] = [];
const documentQueue = vi.fn(async () => ({ pending, expiring: [], expired: [] }));
vi.mock('../data/hrDocuments', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../data/hrDocuments')>()),
  listDocumentTypes: async () => [],
  documentQueue: () => documentQueue(),
}));

const { resetBackendState } = await import('../data/api');
const { DocumentsPage } = await import('../admin/people/Documents');
const { DocumentReviewDialog } = await import('../admin/people/EmployeeDocuments');

const file = (contentType = 'image/jpeg') => ({ fileName: 'scan', contentType, content: btoa('scan') });
const refused = (reason: string, message: string) =>
  Object.assign(new FirebaseError('functions/failed-precondition', message), { details: { reason } });
const opened = () => calls.filter((c) => c.action === 'documents-open').map((c) => c.documentId);
const reviews = () => calls.filter((c) => c.action === 'documents-review');
const place = (i: number, n: number, d: EmployeeDocument) => `${ht.reviewPosition(i, n)}: ${d.typeName}, ${d.employeeName}`;

let urls = 0;
const revoked: string[] = [];
beforeEach(() => {
  calls.length = 0;
  revoked.length = 0;
  urls = 0;
  documentQueue.mockClear();
  resetBackendState();
  respond = (data) => (data.action === 'documents-open' ? file() : { documentId: data.documentId, status: 'VERIFIED' });
  URL.createObjectURL = () => `blob:test/${++urls}`;
  URL.revokeObjectURL = (url: string) => void revoked.push(url);
});
afterEach(() => vi.restoreAllMocks());

describe('reviewing documents', () => {
  it('goes through the documents waiting for the viewer in one dialog, opening each once', async () => {
    const user = userEvent.setup();
    const [a, mine, b] = [doc('a'), doc('mine', { uploadedBy: 'me' }), doc('b')];
    pending = [a, mine, b];
    // The first file arrives when the test says so.
    let deliver: (v: unknown) => void = () => undefined;
    respond = (data) =>
      data.action !== 'documents-open'
        ? data.documentId === 'b'
          ? refused('NOT_PENDING', 'This document has already been reviewed.')
          : { documentId: data.documentId, status: 'VERIFIED' }
        : data.documentId === 'a'
          ? new Promise((r) => (deliver = r))
          : file();
    render(
      <StrictMode>
        <MemoryRouter>
          <DocumentsPage />
        </MemoryRouter>
      </StrictMode>,
    );

    // The viewer's own upload is not theirs to review: two of the three wait for them.
    await user.click(await screen.findByRole('button', { name: ht.reviewPending(2) }));
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByText(place(1, 2, a))).toHaveFocus();
    // Nothing can be decided before the file is on screen.
    expect(dialog.getByRole('button', { name: ht.verify })).toBeDisabled();
    expect(dialog.getByRole('button', { name: ht.reject })).toBeDisabled();
    deliver(file());
    expect(await dialog.findByRole('img', { name: ht.reviewPreview(a.typeName, a.employeeName) })).toBeInTheDocument();
    // One opening on the record, although development mounts everything twice.
    expect(opened()).toEqual(['a']);
    const reads = documentQueue.mock.calls.length;

    await user.click(dialog.getByRole('button', { name: ht.verify }));
    expect(await dialog.findByText(place(2, 2, b))).toHaveFocus();
    expect(dialog.getByRole('status')).toHaveTextContent(ht.reviewVerified(a.typeName, a.employeeName));
    expect(reviews()).toEqual([expect.objectContaining({ documentId: 'a', decision: 'VERIFY', requestId: expect.any(String) })]);
    // The file left behind is freed, and the next one is opened once (never ahead of time).
    expect(revoked).toEqual(['blob:test/1']);
    await dialog.findByRole('img', { name: ht.reviewPreview(b.typeName, b.employeeName) });
    expect(opened()).toEqual(['a', 'b']);

    // Someone else reviewed the second one meanwhile: it is dropped with a note, not shown as a failure.
    await user.click(dialog.getByRole('button', { name: ht.verify }));
    expect(await dialog.findByText(ht.reviewFinished(2, 0))).toBeInTheDocument();
    expect(dialog.getByRole('status')).toHaveTextContent(ht.reviewAlreadyDone(b.typeName, b.employeeName));
    expect(dialog.queryByRole('button', { name: ht.verify })).not.toBeInTheDocument();
    // No list was read again while reviewing; closing reads it once.
    expect(documentQueue.mock.calls.length).toBe(reads);
    await user.click(dialog.getByRole('button', { name: t.close }));
    await waitFor(() => expect(documentQueue.mock.calls.length).toBe(reads + 1));

    // That read still lists both as pending (it is the fake's fixed answer): they stay off the list all the same.
    await waitFor(() => expect(screen.getByRole('tab', { name: new RegExp(ht.queuePending) })).toHaveTextContent('1'));
    expect(screen.queryByText(a.employeeName)).not.toBeInTheDocument();
    expect(screen.queryByText(b.employeeName)).not.toBeInTheDocument();
    expect(screen.getByText(mine.employeeName)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: new RegExp(`^${ht.verify}`) })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: ht.reviewPending(1) })).not.toBeInTheDocument();
  });

  it('rejects with a reason, skips without deciding, and starts where it was opened', async () => {
    const user = userEvent.setup();
    const [a, b, c] = [doc('a'), doc('b', { contentType: 'application/pdf' }), doc('c')];
    respond = (data) => (data.action === 'documents-open' ? file(data.documentId === 'b' ? 'application/pdf' : 'image/jpeg') : { documentId: data.documentId, status: 'REJECTED' });
    const onReviewed = vi.fn();
    const onClose = vi.fn();
    const { unmount } = render(<DocumentReviewDialog orgId="o1" documents={[a, b, c]} start={1} onReviewed={onReviewed} onClose={onClose} />);

    // Opened from the second row: that one first (a PDF, shown in a frame), the earlier one comes round at the end.
    expect(screen.getByText(place(1, 3, b))).toHaveFocus();
    expect(await screen.findByTitle(ht.reviewPreview(b.typeName, b.employeeName))).toHaveAttribute('src', 'blob:test/1');
    // The same file in a new tab: a link to what is already here, not another opening.
    expect(screen.getByRole('link', { name: ht.reviewOpenTab })).toHaveAttribute('href', 'blob:test/1');

    await user.click(screen.getByRole('button', { name: ht.reject }));
    const reason = screen.getByLabelText(ht.reviewReason);
    expect(reason).toHaveFocus();
    await user.type(reason, 'no{Enter}');
    expect(screen.getByText(ht.reviewReasonShort)).toBeInTheDocument();
    expect(reviews()).toEqual([]);
    await user.type(reason, 't readable{Enter}');
    expect(await screen.findByText(place(2, 3, c))).toHaveFocus();
    expect(reviews()).toEqual([expect.objectContaining({ documentId: 'b', decision: 'REJECT', reason: 'not readable' })]);
    expect(onReviewed).toHaveBeenCalledWith(b);

    // Skip leaves the document as it is.
    await screen.findByRole('img', { name: ht.reviewPreview(c.typeName, c.employeeName) });
    await user.click(screen.getByRole('button', { name: ht.reviewSkip }));
    expect(await screen.findByText(place(3, 3, a))).toHaveFocus();
    expect(reviews()).toHaveLength(1);
    expect(onReviewed).toHaveBeenCalledTimes(1);
    expect(opened()).toEqual(['b', 'c', 'a']);

    // Closing frees the file still held.
    await screen.findByRole('img', { name: ht.reviewPreview(a.typeName, a.employeeName) });
    unmount();
    await waitFor(() => expect(revoked).toEqual(['blob:test/1', 'blob:test/2', 'blob:test/3']));
  });

  it('keeps Shift+Tab inside the dialog from the line that names the document', async () => {
    const user = userEvent.setup();
    const [a, b] = [doc('a'), doc('b')];
    render(
      <>
        <button type="button">Behind the dialog</button>
        <DocumentReviewDialog orgId="o1" documents={[a, b]} onReviewed={() => undefined} onClose={() => undefined} />
      </>,
    );
    await screen.findByRole('img', { name: ht.reviewPreview(a.typeName, a.employeeName) });
    expect(screen.getByText(place(1, 2, a))).toHaveFocus();
    // Going back from the line wraps to the last button, as it does from the first control.
    await user.tab({ shift: true });
    expect(screen.getByRole('button', { name: ht.verify })).toHaveFocus();

    // The same after moving on, when focus is put on the line again.
    await user.click(screen.getByRole('button', { name: ht.verify }));
    expect(await screen.findByText(place(2, 2, b))).toHaveFocus();
    await screen.findByRole('img', { name: ht.reviewPreview(b.typeName, b.employeeName) });
    await user.tab({ shift: true });
    expect(screen.getByRole('button', { name: ht.verify })).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Behind the dialog' })).not.toHaveFocus();
  });

  it('stays open on Escape and a click outside while a decision is on its way, so closing still refreshes once', async () => {
    const user = userEvent.setup();
    const [a, b] = [doc('a'), doc('b')];
    pending = [a, b];
    let answer: (v: unknown) => void = () => undefined;
    respond = (data) => (data.action === 'documents-open' ? file() : new Promise((r) => (answer = r)));
    render(
      <MemoryRouter>
        <DocumentsPage />
      </MemoryRouter>,
    );
    await user.click(await screen.findByRole('button', { name: ht.reviewPending(2) }));
    const dialog = within(screen.getByRole('dialog'));
    await dialog.findByRole('img', { name: ht.reviewPreview(a.typeName, a.employeeName) });
    const reads = documentQueue.mock.calls.length;

    await user.click(dialog.getByRole('button', { name: ht.verify }));
    await waitFor(() => expect(reviews()).toHaveLength(1));
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.mouseDown(screen.getByRole('dialog').parentElement!);
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    // The answer arrives in the dialog; closing after it reads the lists once, as for any sitting that decided something.
    answer({ documentId: 'a', status: 'VERIFIED' });
    expect(await dialog.findByText(place(2, 2, b))).toHaveFocus();
    expect(documentQueue.mock.calls.length).toBe(reads);
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(documentQueue.mock.calls.length).toBe(reads + 1));
    expect(screen.queryByText(a.employeeName)).not.toBeInTheDocument();

    // A sitting that decides nothing reads nothing: the earlier one left no mark behind.
    await user.click(screen.getByRole('button', { name: ht.reviewPending(1) }));
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(documentQueue.mock.calls.length).toBe(reads + 1);
  });

  it('keeps a document that could not be decided, with the reason, and can ask for a file again', async () => {
    const user = userEvent.setup();
    const a = doc('a');
    let opens = 0;
    respond = (data) =>
      data.action === 'documents-open'
        ? ++opens === 1
          ? new FirebaseError('functions/unavailable', 'unavailable')
          : file()
        : Object.assign(new FirebaseError('functions/permission-denied', "You can't verify a document you uploaded yourself."), { details: { reason: 'FORBIDDEN' } });
    const onReviewed = vi.fn();
    render(<DocumentReviewDialog orgId="o1" documents={[a]} onReviewed={onReviewed} onClose={() => undefined} />);

    await user.click(await screen.findByRole('button', { name: t.retry }));
    await screen.findByRole('img', { name: ht.reviewPreview(a.typeName, a.employeeName) });
    expect(opened()).toEqual(['a', 'a']);

    await user.click(screen.getByRole('button', { name: ht.verify }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent("You can't verify a document you uploaded yourself."));
    expect(screen.getByText(place(1, 1, a))).toBeInTheDocument();
    expect(onReviewed).not.toHaveBeenCalled();
  });
});
