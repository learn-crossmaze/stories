import { logger } from 'firebase-functions';
import { onSchedule } from 'firebase-functions/v2/scheduler';

import { syncStaleClaims } from '../core/claims.js';
import { REGION } from '../core/firebase.js';
import { JOB_OPTIONS } from '../core/sweep.js';
import { reapOutbox } from '../messaging/outbox.js';
import { refreshShowcaseIfStale } from '../site/showcase.js';

/**
 * Every 15 minutes: finishes work whose first attempt was interrupted.
 * - Role changes whose token update failed (users marked `claimsStale`), so a
 *   revoked person never keeps access in their token.
 * - WhatsApp messages whose send trigger never ran, or that were left SENDING.
 * - The website's book shelves (trending, new arrivals…), rebuilt every 6 hours.
 * Each step is independent; one failing never stops the other.
 */
export async function runMaintenance() {
  const steps = await Promise.allSettled([syncStaleClaims(), reapOutbox(), refreshShowcaseIfStale()]);
  const failed = steps.filter((s) => s.status === 'rejected');
  for (const f of failed) logger.error('maintenance: a step failed', { error: String((f as PromiseRejectedResult).reason) });
  if (failed.length) throw new Error('maintenance: a step failed (see the log above)');
}

export const maintenance = onSchedule({ schedule: 'every 15 minutes', region: REGION, timeZone: 'Asia/Kolkata', ...JOB_OPTIONS }, runMaintenance);
