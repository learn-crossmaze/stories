import type { DocumentSnapshot, Transaction } from 'firebase-admin/firestore';

import { errors } from '../core/errors.js';
import { branchPatterns, reserveCodes } from '../core/numbering.js';
import { employeeCodeRef } from './model.js';

/**
 * Employee IDs are unique in the organization: orgs/{o}/employeeIds/{code}
 * holds `{ uid, employeeDocId }` (either may be null while unknown). They are
 * kept when roles change or are revoked.
 *
 * Resolves the code to use (reads only; call `commit()` to write):
 * `requested` if given (it must be free or already this person's), else
 * `current`, else the next code from the branch's employee pattern.
 */
export async function assignEmployeeCode(
  tx: Transaction,
  orgId: string,
  owner: { uid: string | null; employeeDocId: string | null },
  current: string | null,
  requested: string,
  branch: DocumentSnapshot | null,
) {
  const mine = (snap: DocumentSnapshot) =>
    (owner.uid !== null && snap.get('uid') === owner.uid) || (owner.employeeDocId !== null && snap.get('employeeDocId') === owner.employeeDocId);
  const record = { uid: owner.uid, employeeDocId: owner.employeeDocId };
  if (requested && requested !== current) {
    const taken = await tx.get(employeeCodeRef(orgId, requested));
    if (taken.exists && !mine(taken)) {
      throw errors.conflict('EMPLOYEE_ID_TAKEN', `Employee ID ${requested} already belongs to someone else in this organization.`);
    }
    return {
      employeeId: requested,
      commit() {
        if (current) tx.delete(employeeCodeRef(orgId, current));
        tx.set(employeeCodeRef(orgId, requested), record);
      },
    };
  }
  if (current) {
    return {
      employeeId: current,
      commit() {
        tx.set(employeeCodeRef(orgId, current), record);
      },
    };
  }
  const next = await reserveCodes(tx, {
    kind: 'employee',
    pattern: branchPatterns(branch).employee,
    values: { BRANCH: branch?.get('code') },
    base: `orgs/${orgId}/counters`,
    taken: async (codes) => (await Promise.all(codes.map((c) => tx.get(employeeCodeRef(orgId, c))))).filter((d) => d.exists).map((d) => d.id),
  });
  const [employeeId] = next.codes;
  return {
    employeeId,
    commit() {
      next.commit();
      tx.create(employeeCodeRef(orgId, employeeId), record);
    },
  };
}
