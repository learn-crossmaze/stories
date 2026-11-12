// Employee documents: types, an employee's file, the HR queue, upload and open (docs/HRMS.md §7).
import { collection, collectionGroup, getCountFromServer, getDocs, limit, orderBy, query, type QueryConstraint, where } from 'firebase/firestore';

import { ApiError, command } from './api';
import { fetchFile, openFile, toBase64 } from './files';
import { addDays, todayIST } from '../shared/dates';
import { shrinkToJpeg } from '../shared/image';
import { ht } from '../strings/hr';
import { db, toDate } from './common';

export const DOCUMENT_CATEGORIES = ['IDENTITY', 'ADDRESS', 'STATUTORY', 'CONTRACT', 'EDUCATION', 'EMPLOYMENT', 'OTHER'] as const;
export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];
export type DocumentStatus = 'PENDING' | 'VERIFIED' | 'REJECTED' | 'EXPIRED' | 'SUPERSEDED' | 'REMOVED';

export interface DocumentType {
  id: string;
  name: string;
  category: DocumentCategory;
  required: boolean;
  hasExpiry: boolean;
  reminderDays: number;
  selfUpload: boolean;
  checklistKey: string | null;
  status: 'ACTIVE' | 'ARCHIVED';
}

export interface EmployeeDocument {
  id: string;
  orgId: string;
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  employeeUid: string | null;
  branchId: string | null;
  typeId: string;
  typeName: string;
  fileName: string;
  contentType: string;
  size: number;
  number: string;
  issuedOn: string | null;
  expiresOn: string | null;
  status: DocumentStatus;
  uploadedBy: string;
  uploadedByEmail: string | null;
  selfUploaded: boolean;
  verifiedByEmail: string | null;
  rejectReason: string | null;
  uploadedAt: Date | null;
}

/** Largest file the server accepts. */
export const MAX_DOCUMENT_BYTES = 5_000_000;
export const DOCUMENT_ACCEPT = 'application/pdf,image/jpeg,image/png';

/** Mirrors functions/src/hr/documents.ts DEFAULT_DOCUMENT_TYPES. */
export const DEFAULT_DOCUMENT_TYPES: DocumentType[] = [
  { id: 'aadhaar', name: 'Aadhaar card', category: 'IDENTITY', required: true, hasExpiry: false, reminderDays: 30, selfUpload: true, checklistKey: 'id-proof', status: 'ACTIVE' },
  { id: 'pan-card', name: 'PAN card', category: 'STATUTORY', required: true, hasExpiry: false, reminderDays: 30, selfUpload: true, checklistKey: 'pan', status: 'ACTIVE' },
  { id: 'bank-proof', name: 'Cancelled cheque or bank passbook', category: 'STATUTORY', required: true, hasExpiry: false, reminderDays: 30, selfUpload: true, checklistKey: 'bank', status: 'ACTIVE' },
  { id: 'address-proof', name: 'Address proof', category: 'ADDRESS', required: false, hasExpiry: false, reminderDays: 30, selfUpload: true, checklistKey: 'address-proof', status: 'ACTIVE' },
  { id: 'photo', name: 'Photograph', category: 'IDENTITY', required: false, hasExpiry: false, reminderDays: 30, selfUpload: true, checklistKey: 'photo', status: 'ACTIVE' },
  { id: 'offer-letter', name: 'Signed offer letter', category: 'CONTRACT', required: true, hasExpiry: false, reminderDays: 30, selfUpload: false, checklistKey: 'offer-letter', status: 'ACTIVE' },
  { id: 'appointment-letter', name: 'Appointment letter', category: 'CONTRACT', required: false, hasExpiry: false, reminderDays: 30, selfUpload: false, checklistKey: null, status: 'ACTIVE' },
  { id: 'offer-letter-issued', name: 'Offer letter', category: 'CONTRACT', required: false, hasExpiry: false, reminderDays: 30, selfUpload: false, checklistKey: null, status: 'ACTIVE' },
  { id: 'education', name: 'Education certificate', category: 'EDUCATION', required: false, hasExpiry: false, reminderDays: 30, selfUpload: true, checklistKey: null, status: 'ACTIVE' },
  { id: 'previous-employment', name: 'Previous employment letter', category: 'EMPLOYMENT', required: false, hasExpiry: false, reminderDays: 30, selfUpload: true, checklistKey: null, status: 'ACTIVE' },
  { id: 'driving-licence', name: 'Driving licence', category: 'IDENTITY', required: false, hasExpiry: true, reminderDays: 30, selfUpload: true, checklistKey: null, status: 'ACTIVE' },
  { id: 'police-verification', name: 'Police verification', category: 'OTHER', required: false, hasExpiry: true, reminderDays: 45, selfUpload: false, checklistKey: null, status: 'ACTIVE' },
];

const toDoc = (id: string, data: Record<string, unknown>) =>
  ({ ...data, id, uploadedAt: toDate(data.uploadedAt) }) as EmployeeDocument;

/** The org's document types: defaults, overridden or extended by its own. */
export async function listDocumentTypes(orgId: string): Promise<DocumentType[]> {
  const snap = await getDocs(collection(db(), `orgs/${orgId}/documentTypes`));
  const own = new Map(snap.docs.map((d) => [d.id, { ...(d.data() as Omit<DocumentType, 'id'>), id: d.id }]));
  const merged = DEFAULT_DOCUMENT_TYPES.map((t) => own.get(t.id) ?? t);
  for (const [id, t] of own) if (!DEFAULT_DOCUMENT_TYPES.some((d) => d.id === id)) merged.push(t);
  return merged.sort((a, b) => Number(b.required) - Number(a.required) || a.name.localeCompare(b.name));
}

/** An employee's documents, newest first. The employee themselves must filter on their uid (rules). */
export async function employeeDocuments(orgId: string, employeeId: string, ownUid?: string): Promise<EmployeeDocument[]> {
  const filters: QueryConstraint[] = ownUid ? [where('employeeUid', '==', ownUid)] : [];
  const snap = await getDocs(query(collection(db(), `orgs/${orgId}/employees/${employeeId}/documents`), ...filters, limit(200)));
  return snap.docs.map((d) => toDoc(d.id, d.data())).sort((a, b) => (b.uploadedAt?.getTime() ?? 0) - (a.uploadedAt?.getTime() ?? 0));
}

const inDays = (n: number) => addDays(todayIST(), n);

/**
 * One list of the queue, across the organization. Branch-scoped verifiers pass their branches (the rules only
 * allow that query shape). The lists and their counts share this, and each keeps its ordering: the indexes
 * serve these shapes only (a count without its orderBy has no index).
 */
const queueQuery = (orgId: string, scope: string[] | 'ALL', constraints: QueryConstraint[]) =>
  query(
    collectionGroup(db(), 'documents'),
    where('orgId', '==', orgId),
    ...(scope === 'ALL' ? [] : [where('branchId', 'in', scope.slice(0, 30))]),
    ...constraints,
    limit(200),
  );
const queueList = async (orgId: string, scope: string[] | 'ALL', constraints: QueryConstraint[]) =>
  (await getDocs(queueQuery(orgId, scope, constraints))).docs.map((d) => toDoc(d.id, d.data()));
const awaitingReview = () => [where('status', '==', 'PENDING'), orderBy('uploadedAt', 'asc')];
const markedExpired = () => [where('status', '==', 'EXPIRED'), orderBy('expiresOn', 'desc')];

/** Documents awaiting verification, oldest first (the first list of `documentQueue`, on its own). */
export const pendingDocuments = (orgId: string, scope: string[] | 'ALL'): Promise<EmployeeDocument[]> => queueList(orgId, scope, awaitingReview());

/**
 * How many documents await verification and how many have expired, without downloading them (for the menu).
 * The same numbers as `documentQueue(...).pending.length` and `.expired.length`, the viewer's own uploads included.
 */
export async function documentQueueCounts(orgId: string, scope: string[] | 'ALL'): Promise<{ pending: number; expired: number }> {
  const count = async (constraints: QueryConstraint[]) => (await getCountFromServer(queueQuery(orgId, scope, constraints))).data().count;
  const [pending, expired, lapsed] = await Promise.all([
    count(awaitingReview()),
    count(markedExpired()),
    // Expired but not yet swept (the daily job runs after midnight).
    count([where('status', '==', 'VERIFIED'), where('expiresOn', '<', todayIST()), orderBy('expiresOn', 'asc')]),
  ]);
  return { pending, expired: expired + lapsed };
}

/**
 * The verification queue across the organization: awaiting verification,
 * expiring within each type's reminder window, and expired. Branch-scoped
 * verifiers pass their branches (the rules only allow that query shape).
 */
export async function documentQueue(orgId: string, scope: string[] | 'ALL', types: DocumentType[]) {
  const run = (constraints: QueryConstraint[]) => queueList(orgId, scope, constraints);
  const window = Math.max(30, ...types.map((t) => t.reminderDays));
  const reminder = new Map(types.map((t) => [t.id, t.reminderDays]));
  const [pending, soon, expired] = await Promise.all([
    run(awaitingReview()),
    run([where('status', '==', 'VERIFIED'), where('expiresOn', '<=', inDays(window)), orderBy('expiresOn', 'asc')]),
    run(markedExpired()),
  ]);
  const expiring = soon.filter((d) => d.expiresOn && d.expiresOn >= todayIST() && d.expiresOn <= inDays(reminder.get(d.typeId) ?? 30));
  // Expired but not yet swept (the daily job runs after midnight).
  const lapsed = soon.filter((d) => d.expiresOn && d.expiresOn < todayIST());
  return { pending, expiring, expired: [...lapsed, ...expired] };
}

/** Photos larger than this are made smaller before they are sent. */
const SHRINK_ABOVE_BYTES = 1_000_000;
/** Long side of a shrunk photo: about 190 dpi for an A4 page, enough for the small print on an ID or a cheque. */
const DOCUMENT_MAX_SIDE = 2200;
const decodedBytes = (base64: string) => Math.floor((base64.length * 3) / 4) - (base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0);

/**
 * What to send for a chosen file. A large photo (JPEG or PNG) is re-encoded as a smaller JPEG; a PDF, a small
 * image, and a photo that would not get smaller or cannot be read by this browser go as they are. Refuses, in
 * plain words, what is still over the server's limit. `shrink` is replaceable for tests.
 */
export async function prepareDocument(
  file: File,
  shrink: (file: File, maxSide: number) => Promise<string> = shrinkToJpeg,
): Promise<{ fileName: string; content: string }> {
  if ((file.type === 'image/jpeg' || file.type === 'image/png') && file.size > SHRINK_ABOVE_BYTES) {
    // A very large photo can fail to decode on a phone: then the original goes, if it fits.
    const small = await shrink(file, DOCUMENT_MAX_SIDE).catch(() => '');
    const size = decodedBytes(small);
    if (small && size < file.size && size <= MAX_DOCUMENT_BYTES) return { fileName: file.name.replace(/\.(png|jpe?g)$/i, '.jpg').slice(0, 120), content: small };
  }
  // An ApiError, so the form shows this sentence instead of the general failure text.
  if (file.size > MAX_DOCUMENT_BYTES) throw new ApiError(ht.fileTooLarge, 'INVALID_INPUT');
  return { fileName: file.name.slice(0, 120), content: await toBase64(file) };
}

// Prepared once per chosen file: pressing Upload again after a failure must send the same bytes, because
// command() recognises a repeat by its input (different bytes would file the document twice).
const prepared = new WeakMap<File, Promise<{ fileName: string; content: string }>>();
function preparedOnce(file: File) {
  let p = prepared.get(file);
  if (!p) {
    p = prepareDocument(file);
    prepared.set(file, p);
    p.catch(() => prepared.delete(file));
  }
  return p;
}

export async function uploadDocument(input: { orgId: string; employeeId: string; typeId: string; file: File; number: string; issuedOn: string; expiresOn: string }) {
  const { file, ...rest } = input;
  return command<{ documentId: string; status: DocumentStatus }>('documents-upload', { ...rest, ...(await preparedOnce(file)) });
}

/** Fetches a document (the server records the opening) and shows it in a new tab. */
export const openDocument = (orgId: string, employeeId: string, documentId: string) => openFile('documents-open', { orgId, employeeId, documentId });

/** Fetches a document to show inside the page. Each call is recorded as one opening, so call it once per document shown. */
export const fetchDocument = (orgId: string, employeeId: string, documentId: string) => fetchFile('documents-open', { orgId, employeeId, documentId });
