// Letters to employees (offer, appointment, custom): list, preview, issue, withdraw, open (docs/HRMS.md §12–13).
import { collection, getDocs, limit, orderBy, query, type QueryConstraint, where } from 'firebase/firestore';

import { command } from './api';
import { openFile } from './files';
import type { EmploymentType } from './hr';
import { services } from './services';

export type OfferStatus = 'RELEASED' | 'SUPERSEDED' | 'WITHDRAWN';
export type LetterKind = 'OFFER' | 'APPOINTMENT' | 'CUSTOM';

/** An issued letter (records from before templates have no kind: they are offers). */
export interface OfferLetter {
  id: string;
  orgId: string;
  kind?: LetterKind;
  templateId?: string | null;
  templateName?: string;
  subject?: string;
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  employeeUid: string | null;
  branchId: string | null;
  number: string;
  issuedOn: string;
  designation: string | null;
  department: string | null;
  employmentType: EmploymentType | null;
  joiningDate: string | null;
  annualCtc: number | null;
  probationMonths: number | null;
  noticeDays: number | null;
  acceptBy: string | null;
  reportingTo: string | null;
  workLocation: string;
  terms: string;
  signatoryName: string;
  status: OfferStatus;
  documentId: string;
  releasedByEmail: string | null;
  releasedAt: unknown;
  withdrawnReason: string | null;
}

export const letterKind = (o: OfferLetter): LetterKind => o.kind ?? 'OFFER';
export const letterName = (o: OfferLetter) => o.templateName ?? 'Offer letter';

export interface OfferTerms {
  orgId: string;
  employeeId: string;
  designation: string;
  department: string;
  employmentType: EmploymentType;
  joiningDate: string;
  annualCtc: number;
  probationMonths: number;
  noticeDays: number;
  acceptBy: string;
  reportingTo: string;
  terms: string;
}

/** An appointment or custom letter: blank values come from the employee record. */
export interface LetterTerms {
  orgId: string;
  employeeId: string;
  kind: 'APPOINTMENT' | 'CUSTOM';
  templateId?: string;
  designation: string;
  department: string;
  joiningDate: string;
  annualCtc: number | null;
  probationMonths: number | null;
  noticeDays: number | null;
  acceptBy: string;
  reportingTo: string;
  terms: string;
}

const col = (orgId: string) => collection(services().db, `orgs/${orgId}/offerLetters`);
const asOffer = (d: { id: string; data: () => unknown }) => ({ id: d.id, ...(d.data() as object) }) as OfferLetter;
const released = (o: OfferLetter) => (o.releasedAt as { toMillis?: () => number } | null)?.toMillis?.() ?? 0;

/** One employee's letters, newest first (the branch filter keeps branch managers inside the rules). */
export async function listEmployeeOffers(orgId: string, employeeId: string, branchId: string | null): Promise<OfferLetter[]> {
  const snap = await getDocs(query(col(orgId), where('employeeId', '==', employeeId), where('branchId', '==', branchId)));
  return snap.docs.map(asOffer).sort((a, b) => released(b) - released(a));
}

/** Recent letters across the caller's branches ('ALL' for org-wide staff), newest first. */
export async function listOffers(orgId: string, scope: string[] | 'ALL'): Promise<OfferLetter[]> {
  const filters: QueryConstraint[] = scope === 'ALL' ? [] : [where('branchId', 'in', scope.slice(0, 30))];
  const snap = await getDocs(query(col(orgId), ...filters, orderBy('releasedAt', 'desc'), limit(200)));
  return snap.docs.map(asOffer);
}

export const releaseOffer = (terms: OfferTerms) => command<{ offerId: string; documentId: string; number: string }>('offers-release', { ...terms });
export const issueLetter = (terms: LetterTerms) => command<{ offerId: string; documentId: string; number: string }>('letters-issue', { ...terms });
export const withdrawOffer = (orgId: string, offerId: string, reason: string) => command<{ offerId: string }>('offers-withdraw', { orgId, offerId, reason });

/** Shows the letter as it would be released (marked PREVIEW) in a new tab. */
export const previewOffer = (terms: OfferTerms) => openFile('offers-preview', { ...terms });
export const previewLetter = (terms: LetterTerms) => openFile('letters-preview', { ...terms });
/** Shows a released letter in a new tab (the server records the opening). */
export const openOffer = (orgId: string, offerId: string) => openFile('offers-open', { orgId, offerId });
