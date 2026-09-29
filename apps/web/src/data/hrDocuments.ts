// Employee documents: types, an employee's file, the HR queue, upload and open (docs/HRMS.md §7).
import { collection, collectionGroup, getDocs, limit, orderBy, query, type QueryConstraint, Timestamp, where } from 'firebase/firestore';

import { callAction, command, toApiError } from './api';
import { services } from './services';

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
  { id: 'education', name: 'Education certificate', category: 'EDUCATION', required: false, hasExpiry: false, reminderDays: 30, selfUpload: true, checklistKey: null, status: 'ACTIVE' },
  { id: 'previous-employment', name: 'Previous employment letter', category: 'EMPLOYMENT', required: false, hasExpiry: false, reminderDays: 30, selfUpload: true, checklistKey: null, status: 'ACTIVE' },
  { id: 'driving-licence', name: 'Driving licence', category: 'IDENTITY', required: false, hasExpiry: true, reminderDays: 30, selfUpload: true, checklistKey: null, status: 'ACTIVE' },
  { id: 'police-verification', name: 'Police verification', category: 'OTHER', required: false, hasExpiry: true, reminderDays: 45, selfUpload: false, checklistKey: null, status: 'ACTIVE' },
];

const db = () => services().db;
const toDoc = (id: string, data: Record<string, unknown>) =>
  ({ ...data, id, uploadedAt: data.uploadedAt instanceof Timestamp ? data.uploadedAt.toDate() : null }) as EmployeeDocument;

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

const today = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const inDays = (n: number) => new Date(Date.now() + 330 * 60_000 + n * 86_400_000).toISOString().slice(0, 10);

/**
 * The verification queue across the organization: awaiting verification,
 * expiring within each type's reminder window, and expired. Branch-scoped
 * verifiers pass their branches (the rules only allow that query shape).
 */
export async function documentQueue(orgId: string, scope: string[] | 'ALL', types: DocumentType[]) {
  const base = collectionGroup(db(), 'documents');
  const branch: QueryConstraint[] = scope === 'ALL' ? [] : [where('branchId', 'in', scope.slice(0, 30))];
  const run = async (constraints: QueryConstraint[]) =>
    (await getDocs(query(base, where('orgId', '==', orgId), ...branch, ...constraints, limit(200)))).docs.map((d) => toDoc(d.id, d.data()));
  const window = Math.max(30, ...types.map((t) => t.reminderDays));
  const reminder = new Map(types.map((t) => [t.id, t.reminderDays]));
  const [pending, soon, expired] = await Promise.all([
    run([where('status', '==', 'PENDING'), orderBy('uploadedAt', 'asc')]),
    run([where('status', '==', 'VERIFIED'), where('expiresOn', '<=', inDays(window)), orderBy('expiresOn', 'asc')]),
    run([where('status', '==', 'EXPIRED'), orderBy('expiresOn', 'desc')]),
  ]);
  const expiring = soon.filter((d) => d.expiresOn && d.expiresOn >= today() && d.expiresOn <= inDays(reminder.get(d.typeId) ?? 30));
  // Expired but not yet swept (the daily job runs after midnight).
  const lapsed = soon.filter((d) => d.expiresOn && d.expiresOn < today());
  return { pending, expiring, expired: [...lapsed, ...expired] };
}

export const daysUntil = (iso: string) => Math.round((Date.parse(`${iso}T00:00:00+05:30`) - Date.parse(`${today()}T00:00:00+05:30`)) / 86_400_000);

function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export async function uploadDocument(input: { orgId: string; employeeId: string; typeId: string; file: File; number: string; issuedOn: string; expiresOn: string }) {
  const { file, ...rest } = input;
  return command<{ documentId: string; status: DocumentStatus }>('documents-upload', { ...rest, fileName: file.name.slice(0, 120), content: await toBase64(file) });
}

/** Fetches a document (the server records the opening) and shows it in a new tab. */
export async function openDocument(orgId: string, employeeId: string, documentId: string) {
  // Open the tab first so the browser treats it as a response to the click.
  const tab = window.open('', '_blank');
  try {
    const res = await callAction<{ fileName: string; contentType: string; content: string }>(services().fns, 'documents-open', { orgId, employeeId, documentId });
    const bytes = Uint8Array.from(atob(res.content), (c) => c.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: res.contentType }));
    if (tab) tab.location.href = url;
    else window.location.assign(url);
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (e) {
    tab?.close();
    throw toApiError(e);
  }
}
