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

export interface ShowcaseBook {
  id: string;
  title: string;
  authors: string[];
  coverUrl: string | null;
  ageGroup: string;
  genres: string[];
  count?: number;
  addedAt?: string;
}

export interface Showcase {
  generatedAt: string;
  trending: ShowcaseBook[];
  popular: ShowcaseBook[];
  newArrivals: ShowcaseBook[];
  mostWanted: ShowcaseBook[];
  byAge: Record<'CHILDREN' | 'TEENS' | 'ADULTS', ShowcaseBook[]>;
  genres: { key: string; count: number }[];
}

export interface SiteImage {
  url: string;
  alt: string;
}

export interface PublicPromotion {
  id: string;
  title: string;
  message: string;
  placement: 'BAR' | 'POPUP' | 'HOME';
  image: SiteImage | null;
  cta: { label: string; url: string } | null;
  code: string;
  /** Only on these branches' pages (empty: everywhere). */
  branchIds: string[];
  tone: 'SUN' | 'MINT' | 'GRAPE' | 'CORAL' | 'SKY';
  startOn: string;
  endOn: string;
}

export interface PostCard {
  slug: string;
  title: string;
  summary: string;
  design: string;
  cover: SiteImage | null;
  date: string | null;
  author: string;
  tags: string[];
}

/** What the console's Website section published (functions/src/site/live.ts). */
export interface Tile {
  title: string;
  text: string;
}

export interface PublicSite {
  contact: { phone: string; whatsapp: string; email: string; franchiseEmail: string; careersEmail: string };
  banner: { heading: string; highlight: string; intro: string };
  social: { instagram: string; facebook: string; youtube: string; x: string };
  sections: { promises: Tile[]; homeSteps: Tile[]; readers: Tile[]; howSteps: Tile[]; faqs: { q: string; a: string }[]; franchisePerks: Tile[]; careerPerks: Tile[] };
  faqs: { q: string; a: string }[];
  testimonials: { quote: string; name: string; detail: string }[];
  openJobs: number;
  greetings: import('./greetings/ui').GreetingsConfig | null;
  promotions: PublicPromotion[];
  branchPages: Record<string, { slug: string; tagline: string; photo: SiteImage | null }>;
  posts: PostCard[];
}

export interface PublicSnapshot {
  generatedAt: string;
  titles: number;
  orgs: { id: string; name: string; type: 'CORPORATE' | 'FRANCHISE' }[];
  branches: PublicBranch[];
  plans: PublicPlan[];
  /** Older backends don't send it: treat as empty shelves. */
  showcase?: Showcase;
  /** Older backends don't send it: nothing published yet. */
  site?: PublicSite;
}

let pending: Promise<PublicSnapshot> | null = null;

/**
 * Fetches the snapshot once per page view (the CDN caches it for 5 minutes). Every page's head preloads it
 * (partials/head.html), so the request is already under way when this runs: it must stay a plain GET with no
 * headers or options, or the browser would not reuse the preloaded answer and would fetch it again.
 */
export function loadSnapshot(fetcher: typeof fetch = fetch): Promise<PublicSnapshot> {
  pending ??= fetcher('/api/public').then(async (res) => {
    if (!res.ok) throw new Error(`/api/public answered ${res.status}`);
    return (await res.json()) as PublicSnapshot;
  });
  pending.catch(() => (pending = null)); // let "Try again" fetch afresh
  return pending;
}
