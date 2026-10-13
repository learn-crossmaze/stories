import { z } from 'zod';

import { command } from '../core/callable.js';
import { errors } from '../core/errors.js';
import { db } from '../core/firebase.js';
import { id } from '../core/schemas.js';
import { requireOwner } from '../members/me.js';
import type { Member } from '../members/model.js';
import { cancelDelivery, createDelivery, requestSchema } from './orders.js';

// Home delivery from the member app (docs/DELIVERY.md §2): members (or a
// guardian for a child) book a delivery, pickup or exchange at their home
// branch, and may cancel it until it is dispatched.

const MEMBER_REASON = 'Cancelled by the member in the app';

export const requestDelivery = command('me-requestDelivery', requestSchema, async (ctx, tx) => {
  const member = (await tx.get(db.doc(`orgs/${ctx.input.orgId}/members/${ctx.input.memberId}`))).data() as Member | undefined;
  if (member && member.homeBranchId !== ctx.input.branchId) throw errors.invalid('Home delivery comes from your home branch.');
  return createDelivery(ctx, tx, 'MEMBER', (m) => requireOwner(ctx.actor, m, ctx.input.orgId, tx));
});

export const cancelByMember = command('me-cancelDelivery', z.strictObject({ orgId: id, deliveryId: id }), (ctx, tx) =>
  cancelDelivery(
    { ...ctx, input: { ...ctx.input, reason: MEMBER_REASON } },
    tx,
    async (d) => {
      const member = await tx.get(db.doc(`orgs/${ctx.input.orgId}/members/${d.memberId}`));
      await requireOwner(ctx.actor, member.data() as Member, ctx.input.orgId, tx);
    },
    true,
  ),
);
