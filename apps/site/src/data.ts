// The live data the site shows, from GET /api/public (functions/src/site/public.ts).

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

export interface PublicSnapshot {
  generatedAt: string;
  titles: number;
  orgs: { id: string; name: string; type: 'CORPORATE' | 'FRANCHISE' }[];
  branches: PublicBranch[];
  plans: PublicPlan[];
}

let pending: Promise<PublicSnapshot> | null = null;

/** Fetches the snapshot once per page view (the CDN caches it for 15 minutes). */
export function loadSnapshot(fetcher: typeof fetch = fetch): Promise<PublicSnapshot> {
  pending ??= fetcher('/api/public', { headers: { Accept: 'application/json' } }).then(async (res) => {
    if (!res.ok) throw new Error(`/api/public answered ${res.status}`);
    return (await res.json()) as PublicSnapshot;
  });
  pending.catch(() => (pending = null)); // let "Try again" fetch afresh
  return pending;
}
