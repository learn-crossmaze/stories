import { logger } from 'firebase-functions';
import type { Request } from 'firebase-functions/v2/https';

import { db } from '../core/firebase.js';
import { type Plan, pricesFor } from '../billing/plans.js';
import { handleSubmit, handleTap } from './inbox.js';
import { type PublicSite, readLiveSite } from './live.js';
import { readShowcase, type Showcase } from './showcase.js';

/**
 * What the public website (apps/site) shows: active organizations' active
 * branches with their public business contact details, active plans with
 * today's prices, and how many titles the catalogue holds. Nothing about
 * members, staff, stock levels or money held. Served at /api/public on the
 * website (a Hosting rewrite) and cached by the CDN for 5 minutes (so a publish shows within minutes).
 */
export interface PublicSnapshot {
  generatedAt: string;
  titles: number;
  orgs: { id: string; name: string; type: 'CORPORATE' | 'FRANCHISE' }[];
  branches: PublicBranch[];
  plans: PublicPlan[];
  /** Book shelves: trending, most borrowed, new arrivals, most wanted, by age, genres (site/showcase.ts). */
  showcase: Showcase;
  /** What the Website section published: promotions, festive cards, branch pages, latest posts, FAQs, social links. */
  site: PublicSite;
}

export interface PublicBranch {
  id: string;
  orgId: string;
  name: string;
  address: { line1: string; line2: string; city: string; state: string; postalCode: string };
  phone: string | null;
  email: string | null;
  hours: { day: string; open: string; close: string }[];
  weeklyOffs: string[];
  delivery: { offered: boolean; feeMinor: number };
}

export interface PublicPlan {
  id: string;
  orgId: string;
  name: string;
  description: string;
  booksAtATime: number;
  depositMinor: number;
  audiences: string[];
  homeDelivery: boolean;
  prices: { duration: string; months: number; listPriceMinor: number; priceMinor: number; discountLabel: string | null }[];
}

const text = (v: unknown) => (typeof v === 'string' ? v : '');

/** A branch as the website may show it: its business contact details and hours, nothing internal. */
export function toPublicBranch(b: FirebaseFirestore.DocumentSnapshot, orgId: string): PublicBranch {
  const a = (b.get('address') ?? {}) as Record<string, unknown>;
  const delivery = (b.get('delivery') ?? {}) as { enabled?: boolean; feeMinor?: number };
  return {
    id: b.id,
    orgId,
    name: text(b.get('name')),
    address: { line1: text(a.line1), line2: text(a.line2), city: text(a.city), state: text(a.state), postalCode: text(a.postalCode) },
    phone: text(b.get('contact.phone')) || null,
    email: text(b.get('contact.email')) || null,
    hours: ((b.get('operatingHours') as PublicBranch['hours'] | undefined) ?? []).map((h) => ({ day: h.day, open: h.open, close: h.close })),
    weeklyOffs: (b.get('weeklyOffs') as string[] | undefined) ?? [],
    delivery: { offered: delivery.enabled === true, feeMinor: delivery.feeMinor ?? 0 },
  };
}

export async function publicSnapshot(now = new Date()): Promise<PublicSnapshot> {
  const [orgSnap, titles, showcase, site] = await Promise.all([
    db.collection('orgs').where('status', '==', 'ACTIVE').get(),
    db.collection('books').where('status', '==', 'ACTIVE').count().get(),
    readShowcase(),
    readLiveSite(now),
  ]);
  const orgs = orgSnap.docs.map((o) => ({ id: o.id, name: text(o.get('name')), type: o.get('type') as 'CORPORATE' | 'FRANCHISE' }));
  const perOrg = await Promise.all(
    orgs.map(async (o) => {
      const [branches, plans] = await Promise.all([
        db.collection(`orgs/${o.id}/branches`).where('status', '==', 'ACTIVE').get(),
        db.collection(`orgs/${o.id}/plans`).where('status', '==', 'ACTIVE').get(),
      ]);
      return {
        branches: branches.docs.map((b) => toPublicBranch(b, o.id)),
        plans: plans.docs.map((p): PublicPlan => {
          const plan = p.data() as Plan;
          return {
            id: p.id,
            orgId: o.id,
            name: plan.name,
            description: plan.description ?? '',
            booksAtATime: plan.maxSimultaneousBooks,
            depositMinor: plan.depositMinor,
            audiences: plan.audiences ?? [],
            homeDelivery: plan.deliveryEligible === true,
            prices: pricesFor(plan, now).map(({ duration, months, listPriceMinor, priceMinor, discountLabel }) => ({ duration, months, listPriceMinor, priceMinor, discountLabel })),
          };
        }),
      };
    }),
  );
  const byName = <T extends { name: string }>(list: T[]) => list.sort((a, b) => a.name.localeCompare(b.name));
  return {
    generatedAt: now.toISOString(),
    titles: titles.data().count,
    orgs: byName(orgs),
    branches: byName(perOrg.flatMap((x) => x.branches)),
    plans: perOrg.flatMap((x) => x.plans).sort((a, b) => a.booksAtATime - b.booksAtATime || (a.prices[0]?.priceMinor ?? 0) - (b.prices[0]?.priceMinor ?? 0)),
    showcase,
    site,
  };
}

type Res = { status: (n: number) => Res; set: (k: string, v: string) => Res; json: (b: unknown) => void; send: (b?: unknown) => void };

/** GET /api/public (website), and POST /api/submit and /api/tap (inbox.ts). /api/public is read-only; the CDN caches it for 5 minutes, browsers for 1. */
export async function handleSitePublic(req: Request, res: Res) {
  // The website's forms and call/WhatsApp taps come here too (one function: Cloud Run CPU quota).
  const path = (req.path || req.url || '').split('?')[0];
  if (req.method === 'POST' && path.endsWith('/api/submit')) return handleSubmit(req, res);
  if (req.method === 'POST' && path.endsWith('/api/tap')) return handleTap(req, res);
  if (req.method !== 'GET' && req.method !== 'HEAD') return res.status(405).set('Allow', 'GET').send('method not allowed');
  try {
    const snapshot = await publicSnapshot();
    res.status(200).set('Cache-Control', 'public, max-age=60, s-maxage=300').json(snapshot);
  } catch (e) {
    logger.error('site: public snapshot failed', { error: e instanceof Error ? e.message : String(e) });
    res.status(503).set('Cache-Control', 'no-store').json({ error: 'unavailable' });
  }
}
