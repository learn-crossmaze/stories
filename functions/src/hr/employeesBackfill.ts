import { FieldValue } from 'firebase-admin/firestore';
import { z } from 'zod';

import { recordAudit } from '../core/audit.js';
import { command } from '../core/callable.js';
import { db } from '../core/firebase.js';
import { employeeNumbering, renderCode, reserveCodes, type TokenValues } from '../core/numbering.js';
import { ALL_BRANCHES, type Membership } from '../core/rbac.js';
import { id } from '../core/schemas.js';
import { auditCtx } from './common.js';
import { employeeCodeRef, employeesCol, newEmployee, requireFor } from './model.js';

const BACKFILL_BATCH = 100;

/**
 * Creates employee records for staff who have roles but no record yet (staff
 * added before People existed). Keeps their employee IDs; links an unlinked
 * record with the same email instead of duplicating it. Safe to repeat.
 */
export const backfill = command(
  'employees-backfill',
  z.strictObject({ orgId: id }),
  async (ctx, tx) => {
    const { actor, input } = ctx;
    await requireFor(actor, 'employees.edit', input.orgId, null, tx);
    const [memberships, employees] = await Promise.all([
      tx.get(db.collectionGroup('memberships').where('orgId', '==', input.orgId).where('status', '==', 'ACTIVE')),
      tx.get(employeesCol(input.orgId).select('uid', 'emailLower')),
    ]);
    const haveUid = new Set(employees.docs.map((d) => d.get('uid')).filter(Boolean));
    const unlinkedByEmail = new Map(employees.docs.filter((d) => !d.get('uid') && d.get('emailLower')).map((d) => [d.get('emailLower') as string, d]));
    const missing = memberships.docs.map((d) => d.data() as Membership).filter((m) => !haveUid.has(m.uid));
    const batch = missing.slice(0, BACKFILL_BATCH);

    const indexes = await Promise.all(batch.map((m) => (m.employeeId ? tx.get(employeeCodeRef(input.orgId, m.employeeId)) : null)));
    const needCode = batch.filter((m, i) => {
      const match = m.email ? unlinkedByEmail.get(m.email.toLowerCase()) : undefined;
      const idx = indexes[i];
      const claimed = idx?.exists && idx.get('employeeDocId');
      return !match && (!m.employeeId || claimed);
    });
    // New IDs follow each person's first branch's employee pattern (head office for organization-wide staff).
    // People whose codes share fixed parts share one counter, so they are reserved together.
    const branchOf = (m: Membership) => (m.branchIds.includes(ALL_BRANCHES) ? null : (m.branchIds[0] ?? null));
    const branchIds = [...new Set(needCode.map(branchOf).filter((b): b is string => !!b))];
    const branchDocs = new Map((await Promise.all(branchIds.map((b) => tx.get(db.doc(`orgs/${input.orgId}/branches/${b}`))))).map((d) => [d.id, d]));
    const orgDoc = needCode.length ? await tx.get(db.doc(`orgs/${input.orgId}`)) : null;
    const groups = new Map<string, { pattern: string; values: TokenValues; members: Membership[] }>();
    for (const m of needCode) {
      const branch = branchDocs.get(branchOf(m) ?? '') ?? null;
      const { pattern, values } = employeeNumbering(branch, orgDoc);
      const key = renderCode(pattern, values, 0);
      const group = groups.get(key) ?? { pattern, values, members: [] };
      group.members.push(m);
      groups.set(key, group);
    }
    const freshCode = new Map<Membership, string>();
    const commits: (() => void)[] = [];
    for (const { pattern, values, members } of groups.values()) {
      const next = await reserveCodes(tx, {
        kind: 'employee',
        pattern,
        values,
        base: `orgs/${input.orgId}/counters`,
        count: members.length,
        taken: async (codes) => (await Promise.all(codes.map((c) => tx.get(employeeCodeRef(input.orgId, c))))).filter((d) => d.exists).map((d) => d.id),
      });
      members.forEach((m, i) => freshCode.set(m, next.codes[i]));
      commits.push(next.commit);
    }

    let created = 0;
    let linked = 0;
    for (const commit of commits) commit();
    batch.forEach((m, i) => {
      const email = m.email?.toLowerCase() ?? null;
      const match = email ? unlinkedByEmail.get(email) : undefined;
      const mRef = db.doc(`users/${m.uid}/memberships/${input.orgId}`);
      if (match) {
        const code = match.get('code') as string;
        tx.update(match.ref, { uid: m.uid, updatedAt: FieldValue.serverTimestamp() });
        tx.set(employeeCodeRef(input.orgId, code), { uid: m.uid, employeeDocId: match.id });
        if (m.employeeId && m.employeeId !== code && indexes[i]?.exists && !indexes[i]!.get('employeeDocId')) tx.delete(indexes[i]!.ref);
        tx.update(mRef, { employeeId: code });
        unlinkedByEmail.delete(email!);
        linked += 1;
        return;
      }
      const ref = employeesCol(input.orgId).doc();
      const reuse = m.employeeId && !(indexes[i]?.exists && indexes[i]!.get('employeeDocId'));
      const code = reuse ? m.employeeId! : freshCode.get(m)!;
      const branchId = branchOf(m);
      tx.create(ref, {
        ...newEmployee({ orgId: input.orgId, code, fullName: m.displayName || m.email || code, status: 'ACTIVE', source: 'BACKFILL', uid: m.uid, email, branchId }),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      tx.set(employeeCodeRef(input.orgId, code), { uid: m.uid, employeeDocId: ref.id });
      if (code !== m.employeeId) tx.update(mRef, { employeeId: code });
      created += 1;
    });
    if (batch.length) {
      recordAudit(tx, auditCtx(actor, ctx.requestId), input.orgId, { action: 'employee.backfill', entityType: 'employee', entityId: 'backfill', after: { created, linked } });
    }
    return { created, linked, remaining: missing.length - batch.length };
  },
);
