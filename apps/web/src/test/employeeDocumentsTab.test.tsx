import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Employee } from '../data/hr';
import type { EmployeeDocument } from '../data/hrDocuments';
import { setErrorSink } from '../shared/reportError';
import { t } from '../strings';
import { ht } from '../strings/hr';

// The Documents tab of an employee profile, with the reads faked in the data layer and the server at the Cloud
// Functions boundary.
type Sent = { action: string; documentId?: string };
const calls: Sent[] = [];
vi.mock('firebase/functions', () => ({
  httpsCallable: () => async (data: Sent) => {
    calls.push(data);
    return { data: data.action === 'documents-open' ? { fileName: 'scan', contentType: 'image/jpeg', content: btoa('scan') } : { documentId: data.documentId, status: 'VERIFIED' } };
  },
}));
vi.mock('../data/services', () => ({ services: () => ({ fns: {}, db: {} }) }));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ claims: { v: 1, sa: true, o: {} }, user: { uid: 'me' } }) }));
vi.mock('../admin/Workspace', () => ({ useWorkspace: () => ({ org: { id: 'o1', type: 'CORPORATE' }, branches: [], branchName: (id: string) => `Branch ${id}` }) }));

const record = { id: 'e1', orgId: 'o1', code: 'EMP-1', uid: 'u1', email: 'asha@example.test', fullName: 'Asha Rao', branchId: 'b1', status: 'ONBOARDING', employmentType: 'FULL_TIME' } as Employee;
const doc = (id: string): EmployeeDocument => ({
  id,
  orgId: 'o1',
  employeeId: 'e1',
  employeeName: 'Asha Rao',
  employeeCode: 'EMP-1',
  employeeUid: 'u1',
  branchId: 'b1',
  typeId: id,
  typeName: `Paper ${id}`,
  fileName: `${id}.jpg`,
  contentType: 'image/jpeg',
  size: 10,
  number: '',
  issuedOn: null,
  expiresOn: null,
  status: 'PENDING',
  uploadedBy: 'u1',
  uploadedByEmail: 'asha@example.test',
  selfUploaded: true,
  verifiedByEmail: null,
  rejectReason: null,
  uploadedAt: null,
});

/** Reads fail while this is set, as on a connection that drops for a moment. */
let offline = false;
const read = <T,>(value: T) => (offline ? Promise.reject(new Error('offline')) : Promise.resolve(value));
const getEmployee = vi.fn(() => read(record));
const employeeDocuments = vi.fn(() => read([doc('a'), doc('b'), doc('c')]));
vi.mock('../data/hr', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../data/hr')>()),
  getEmployee: () => getEmployee(),
  getPrivateProfile: async () => ({}),
  listHistory: async () => [],
}));
vi.mock('../data/hrDocuments', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../data/hrDocuments')>()),
  listDocumentTypes: async () => [],
  employeeDocuments: () => employeeDocuments(),
}));

const { resetBackendState } = await import('../data/api');
const { EmployeeProfilePage } = await import('../admin/people/EmployeeProfile');

const place = (i: number, n: number, d: EmployeeDocument) => `${ht.reviewPosition(i, n)}: ${d.typeName}, ${d.employeeName}`;
let restoreSink: ReturnType<typeof setErrorSink>;
beforeEach(() => {
  calls.length = 0;
  offline = false;
  getEmployee.mockClear();
  employeeDocuments.mockClear();
  resetBackendState();
  URL.createObjectURL = () => 'blob:test/1';
  URL.revokeObjectURL = () => undefined;
  // The failed reads below are meant; keep them out of the test output.
  restoreSink = setErrorSink(() => undefined);
});
afterEach(() => void setErrorSink(restoreSink));

describe('employee profile → Documents', () => {
  it('keeps the review dialog open, and its place, when the refresh behind a decision fails', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/people/e1?tab=documents']}>
        <Routes>
          <Route path="/people/:employeeId" element={<EmployeeProfilePage />} />
        </Routes>
      </MemoryRouter>,
    );
    await user.click(await screen.findByRole('button', { name: ht.reviewPending(3) }));
    const dialog = within(screen.getByRole('dialog'));
    await dialog.findByRole('img', { name: ht.reviewPreview('Paper a', 'Asha Rao') });
    const reads = [getEmployee.mock.calls.length, employeeDocuments.mock.calls.length];

    // The decision is saved; the two reads that follow it (the tab and the record) do not come back.
    offline = true;
    await user.click(dialog.getByRole('button', { name: ht.verify }));
    expect(await dialog.findByText(place(2, 3, doc('b')))).toHaveFocus();
    await waitFor(() => expect([getEmployee.mock.calls.length, employeeDocuments.mock.calls.length]).toEqual([reads[0] + 1, reads[1] + 1]));
    await dialog.findByRole('img', { name: ht.reviewPreview('Paper b', 'Asha Rao') });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    // The second document was opened once, not again after a remount.
    expect(calls.filter((c) => c.action === 'documents-open').map((c) => c.documentId)).toEqual(['a', 'b']);

    // Behind the dialog the page says the read failed, with what it had; Try again reads it anew.
    offline = false;
    await user.click(dialog.getByRole('button', { name: t.close }));
    expect(screen.getByRole('heading', { name: 'Asha Rao' })).toBeInTheDocument();
    expect(screen.getAllByText(t.errorLoad).length).toBeGreaterThan(0);
    for (const retry of screen.getAllByRole('button', { name: t.retry })) await user.click(retry);
    await waitFor(() => expect(screen.queryByText(t.errorLoad)).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: ht.reviewPending(3) })).toBeInTheDocument();
  });
});
