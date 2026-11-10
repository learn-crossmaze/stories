// Reading what is published (the `live` copies) for the public website.
import { db } from '../core/firebase.js';
import type { BranchDraft, GreetingsDraft, PostDraft, PromotionDraft, SettingsDraft, SiteImage } from './content.js';
import { promotionWindow, todayInIndia } from './content.js';
import type { SiteDoc } from './admin.js';
import { type BookInfo, type PostCard } from './render.js';

export interface PublicPromotion {
  id: string;
  title: string;
  message: string;
  placement: PromotionDraft['placement'];
  image: SiteImage | null;
  cta: PromotionDraft['cta'];
  code: string;
  branchIds: string[];
  tone: PromotionDraft['tone'];
  startOn: string;
  endOn: string;
}

export interface PublicGreetings {
  enabled: boolean;
  autoOpen: boolean;
  delaySeconds: number;
  offer: GreetingsDraft['offer'];
  /** This year's and next year's choices, with their books looked up. */
  picks: Record<string, { hidden: boolean; words: string; picture: SiteImage | null; gen: number | null; books: BookInfo[] }>;
}

export interface PublicSite {
  social: SettingsDraft['social'];
  faqs: SettingsDraft['faqs'];
  greetings: PublicGreetings | null;
  /** Promotions running today. */
  promotions: PublicPromotion[];
  /** Branches with a page: branchId → its address on the site and a line about it. */
  branchPages: Record<string, { slug: string; tagline: string; photo: SiteImage | null }>;
  /** The newest posts. */
  posts: PostCard[];
}

/** Catalogue books by id (active ones), in the order asked. */
export async function booksById(ids: string[]): Promise<Map<string, BookInfo>> {
  const unique = [...new Set(ids)].slice(0, 100);
  if (!unique.length) return new Map();
  const snaps = await db.getAll(...unique.map((i) => db.doc(`books/${i}`)));
  return new Map(
    snaps
      .filter((s) => s.exists && s.get('status') !== 'ARCHIVED')
      .map((s) => [s.id, { id: s.id, title: String(s.get('title') ?? ''), authors: (s.get('authorNames') as string[] | undefined) ?? [], coverUrl: (s.get('coverUrl') as string | null | undefined) ?? null }]),
  );
}

export const cardOf = (doc: SiteDoc): PostCard => {
  const d = doc.live as PostDraft;
  return { slug: d.slug, title: d.title, summary: d.summary, design: d.design, cover: d.cover, date: doc.liveOn ?? null, author: d.author.name, tags: d.tags };
};

/** Live posts, newest first. */
export async function livePosts(limit = 60): Promise<SiteDoc[]> {
  const snap = await db.collection('sitePosts').where('isLive', '==', true).orderBy('liveOn', 'desc').limit(limit).get();
  return snap.docs.map((d) => d.data() as SiteDoc);
}

export async function readLiveSite(now = new Date()): Promise<PublicSite> {
  const today = todayInIndia(now);
  const year = Number(today.slice(0, 4));
  const [settings, greetings, promotions, branches, posts] = await Promise.all([
    db.doc('siteContent/settings').get(),
    db.doc('siteContent/greetings').get(),
    db.collection('sitePromotions').where('isLive', '==', true).get(),
    db.collection('siteBranches').where('isLive', '==', true).get(),
    livePosts(6),
  ]);
  const s = (settings.get('live') as SettingsDraft | null | undefined) ?? null;
  const g = (greetings.get('live') as GreetingsDraft | null | undefined) ?? null;

  let publicGreetings: PublicGreetings | null = null;
  if (g) {
    const picks = Object.entries(g.picks ?? {}).filter(([k]) => k.endsWith(`-${year}`) || k.endsWith(`-${year + 1}`));
    const books = await booksById(picks.flatMap(([, p]) => p.books));
    publicGreetings = {
      enabled: g.enabled,
      autoOpen: g.autoOpen,
      delaySeconds: g.delaySeconds,
      offer: g.offer,
      picks: Object.fromEntries(picks.map(([k, p]) => [k, { hidden: p.hidden, words: p.words, picture: p.picture, gen: p.gen, books: p.books.map((b) => books.get(b)).filter((b): b is BookInfo => !!b) }])),
    };
  }

  return {
    social: s?.social ?? { instagram: '', facebook: '', youtube: '', x: '' },
    faqs: s?.faqs ?? [],
    greetings: publicGreetings,
    promotions: promotions.docs
      .map((d) => ({ id: d.id, p: d.get('live') as PromotionDraft }))
      .filter(({ p }) => p && !p.hidden && promotionWindow(p, today) === 'RUNNING')
      .map(({ id, p }) => ({ id, title: p.title, message: p.message, placement: p.placement, image: p.image, cta: p.cta, code: p.code, branchIds: p.branchIds, tone: p.tone, startOn: p.startOn, endOn: p.endOn }))
      .sort((a, b) => a.endOn.localeCompare(b.endOn)),
    branchPages: Object.fromEntries(
      branches.docs
        .map((d) => [d.id, d.get('live') as BranchDraft] as const)
        .filter(([, p]) => p && !p.hidden)
        .map(([branchId, p]) => [branchId, { slug: p.slug, tagline: p.tagline, photo: p.photos[0] ?? null }]),
    ),
    posts: posts.map(cardOf),
  };
}
