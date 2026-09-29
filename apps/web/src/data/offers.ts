// Offer letters: list, preview, release, withdraw, open (docs/HRMS.md §12).
import { collection, getDocs, limit, orderBy, query, type QueryConstraint, where } from 'firebase/firestore';

import { callAction, command, toApiError } from './api';
import type { EmploymentType } from './hr';
import { services } from './services';

export type OfferStatus = 'RELEASED' | 'SUPERSEDED' | 'WITHDRAWN';

export interface OfferLetter {
  id: string;
  orgId: string;
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  employeeUid: string | null;
  branchId: string | null;
  number: string;
  issuedOn: string;
  designation: string;
  department: string | null;
  employmentType: EmploymentType;
  joiningDate: string;
  annualCtc: number;
  probationMonths: number;
  noticeDays: number;
  acceptBy: string;
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

const col = (orgId: string) => collection(services().db, `orgs/${orgId}/offerLetters`);
const asOffer = (d: { id: string; data: () => unknown }) => ({ id: d.id, ...(d.data() as object) }) as OfferLetter;
const released = (o: OfferLetter) => (o.releasedAt as { toMillis?: () => number } | null)?.toMillis?.() ?? 0;

/** One employee's offers, newest first (the branch filter keeps branch managers inside the rules). */
export async function listEmployeeOffers(orgId: string, employeeId: string, branchId: string | null): Promise<OfferLetter[]> {
  const snap = await getDocs(query(col(orgId), where('employeeId', '==', employeeId), where('branchId', '==', branchId)));
  return snap.docs.map(asOffer).sort((a, b) => released(b) - released(a));
}

/** Recent offers across the caller's branches ('ALL' for org-wide staff), newest first. */
export async function listOffers(orgId: string, scope: string[] | 'ALL'): Promise<OfferLetter[]> {
  const filters: QueryConstraint[] = scope === 'ALL' ? [] : [where('branchId', 'in', scope.slice(0, 30))];
  const snap = await getDocs(query(col(orgId), ...filters, orderBy('releasedAt', 'desc'), limit(200)));
  return snap.docs.map(asOffer);
}

export const releaseOffer = (terms: OfferTerms) => command<{ offerId: string; documentId: string; number: string }>('offers-release', { ...terms });
export const withdrawOffer = (orgId: string, offerId: string, reason: string) => command<{ offerId: string }>('offers-withdraw', { orgId, offerId, reason });

async function showPdf(action: string, data: Record<string, unknown>) {
  // Open the tab first so the browser treats it as a response to the click.
  const tab = window.open('', '_blank');
  try {
    const res = await callAction<{ fileName: string; contentType: string; content: string }>(services().fns, action, data);
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

/** Shows the letter as it would be released (marked PREVIEW) in a new tab. */
export const previewOffer = (terms: OfferTerms) => showPdf('offers-preview', { ...terms });
/** Shows a released letter in a new tab (the server records the opening). */
export const openOffer = (orgId: string, offerId: string) => showPdf('offers-open', { orgId, offerId });
