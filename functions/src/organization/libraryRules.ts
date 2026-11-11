// Master control → Library rules (docs/BUSINESS_RULES.md D3, and the deposit sign-off limit in docs/PAYMENTS.md):
// the organization's settings that were only defaults in code. Stored where the code already reads them
// (orgs/{o}/config/circulation and orgs/{o}/config/deposits).
import { FieldValue } from 'firebase-admin/firestore';
import { z } from 'zod';

import { DEFAULT_HOLD_HOURS } from '../circulation/allocation.js';
import { recordAudit } from '../core/audit.js';
import { command, query } from '../core/callable.js';
import { db } from '../core/firebase.js';
import { id } from '../core/schemas.js';

const circulationRef = (orgId: string) => db.doc(`orgs/${orgId}/config/circulation`);
const depositsRef = (orgId: string) => db.doc(`orgs/${orgId}/config/deposits`);

export const DEFAULT_RULES = { reservationHoldHours: DEFAULT_HOLD_HOURS, makerCheckerThresholdMinor: 0 };

const rulesOf = (circulation: FirebaseFirestore.DocumentSnapshot, deposits: FirebaseFirestore.DocumentSnapshot) => ({
  reservationHoldHours: (circulation.get('reservationHoldHours') as number | undefined) ?? DEFAULT_RULES.reservationHoldHours,
  makerCheckerThresholdMinor: (deposits.get('makerCheckerThresholdMinor') as number | undefined) ?? DEFAULT_RULES.makerCheckerThresholdMinor,
});

/** The organization's library rules (anyone in Master control may read them; config.manage changes them). */
export const get = query('config-libraryRules', z.strictObject({ orgId: id }), async ({ actor, input }) => {
  await actor.require('config.manage', input.orgId);
  const [c, d] = await Promise.all([circulationRef(input.orgId).get(), depositsRef(input.orgId).get()]);
  return { rules: rulesOf(c, d), defaults: DEFAULT_RULES };
});

export const set = command(
  'config-setLibraryRules',
  z.strictObject({
    orgId: id,
    /** How long a copy set aside for a reservation waits for the member (1 hour to 14 days). */
    reservationHoldHours: z.number().int().min(1).max(336),
    /** Deposit adjustments up to this many paise need no second person (0: every one does). */
    makerCheckerThresholdMinor: z.number().int().min(0).max(10_000_000),
  }),
  async ({ actor, input, requestId }, tx) => {
    await actor.require('config.manage', input.orgId, undefined, tx);
    const [c, d] = await Promise.all([tx.get(circulationRef(input.orgId)), tx.get(depositsRef(input.orgId))]);
    const before = rulesOf(c, d);
    tx.set(circulationRef(input.orgId), { reservationHoldHours: input.reservationHoldHours, updatedAt: FieldValue.serverTimestamp(), updatedBy: actor.uid }, { merge: true });
    tx.set(depositsRef(input.orgId), { makerCheckerThresholdMinor: input.makerCheckerThresholdMinor, updatedAt: FieldValue.serverTimestamp(), updatedBy: actor.uid }, { merge: true });
    const after = { reservationHoldHours: input.reservationHoldHours, makerCheckerThresholdMinor: input.makerCheckerThresholdMinor };
    recordAudit(tx, { actorUid: actor.uid, actorEmail: actor.email, requestId }, input.orgId, {
      action: 'config.libraryRules',
      entityType: 'config',
      entityId: 'libraryRules',
      before,
      after,
    });
    return { rules: after };
  },
);
