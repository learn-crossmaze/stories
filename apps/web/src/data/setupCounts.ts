// The small reads behind the counts beside the Master control pages (admin/attention.ts): "is there anything
// here?" asked as cheaply as it can be. Each asks for one row or one count, never a whole list. The rules let
// anyone in the organization read holidays, letter templates and payroll settings; salaries need `salary.view`.
import { collection, getCountFromServer, getDocs, limit, query, type QueryConstraint, where } from 'firebase/firestore';

import { db } from './common';

const any = async (path: string, ...filters: QueryConstraint[]) => !(await getDocs(query(collection(db(), path), ...filters, limit(1)))).empty;

/** Whether any holiday is entered for a year ("2026"). One row at most is read, not the year's list. */
export const hasHolidays = (orgId: string, year: string) => any(`orgs/${orgId}/holidays`, where('year', '==', year));

/** How many letter templates were never published (a published one stays published while it is edited). */
export async function draftTemplateCount(orgId: string): Promise<number> {
  return (await getCountFromServer(query(collection(db(), `orgs/${orgId}/letterTemplates`), where('status', '==', 'DRAFT')))).data().count;
}

/**
 * Whether payroll would run on the built-in PF, ESI and professional tax values: the settings were never saved
 * although somebody already has a salary. The salary is looked for only while nothing is saved, and only people
 * who see every salary can look (for anyone else the read fails and no count shows).
 */
export async function payrollOnBuiltInValues(orgId: string): Promise<boolean> {
  if (await any(`orgs/${orgId}/payrollSettings`)) return false;
  return any(`orgs/${orgId}/salaries`);
}
