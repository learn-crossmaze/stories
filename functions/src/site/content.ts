// The website's managed content (docs/WEBSITE_ADMIN.md): what staff edit in the console's Website section and
// what the public website shows once it is published. Every item keeps a `draft` (what editors save) and a `live`
// copy (what the website shows); Publish copies the draft to live. Nothing here is read by clients directly: the
// console goes through the site-* actions and the website through /api/public and the server-rendered pages.
import { z } from 'zod';

import { id } from '../core/schemas.js';

export const KINDS = ['settings', 'sections', 'greetings', 'branch', 'post', 'promotion', 'job', 'testimonial'] as const;
export type Kind = (typeof KINDS)[number];

/** Where each kind is stored. Settings and greetings are single documents. */
export const collectionOf: Record<Kind, string> = {
  settings: 'siteContent',
  sections: 'siteContent',
  greetings: 'siteContent',
  branch: 'siteBranches',
  post: 'sitePosts',
  promotion: 'sitePromotions',
  job: 'siteJobs',
  testimonial: 'siteTestimonials',
};
export const SINGLETONS: Partial<Record<Kind, string>> = { settings: 'settings', sections: 'sections', greetings: 'greetings' };
/** Kinds with many items (each its own document), as opposed to the single documents above. */
export const LISTS = ['branch', 'post', 'promotion', 'job', 'testimonial'] as const;
export type ListKind = (typeof LISTS)[number];

// ------------------------------------------------------------------ building blocks

const STORAGE_PREFIX = 'https://firebasestorage.googleapis.com/v0/b/';
/** Pictures must be ones uploaded through site-uploadImage (Firebase Storage), never arbitrary addresses. */
export function isSiteImage(url: string) {
  const emulator = process.env.FIREBASE_STORAGE_EMULATOR_HOST;
  return url.startsWith(STORAGE_PREFIX) || (!!emulator && url.startsWith(`http://${emulator}/v0/b/`));
}

const str = (max: number) => z.string().trim().max(max).default('');
const req = (min: number, max: number) => z.string().trim().min(min, 'is too short').max(max, 'is too long');

export const image = z.strictObject({
  url: z.string().max(1000).refine(isSiteImage, 'must be a picture uploaded here'),
  alt: str(160),
});
export type SiteImage = z.infer<typeof image>;

/**
 * A link a button may point to: a page of the website ("/plans"), a web address, WhatsApp or a phone number.
 * Nothing else (no javascript:, data: …).
 */
export const link = z
  .string()
  .trim()
  .max(500)
  .refine((v) => /^\/(?!\/)[\w\-./?=&#%]*$/.test(v) || /^https:\/\/[^\s]+$/.test(v) || /^tel:\+?[0-9 ]{6,16}$/.test(v) || /^mailto:[^\s@]+@[^\s@]+$/.test(v), 'must be a page of the website (/plans), an https:// address, tel: or mailto:');

export const cta = z.strictObject({ label: req(2, 40), url: link }).nullable().default(null);

/** Paragraph text with a little formatting: blank lines, "- " bullets, **bold**, _italic_, [text](link). */
export const rich = (max: number) => z.string().trim().max(max, `is too long (${max} characters at most)`).default('');

export const slug = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'may use only small letters, digits and dashes')
  .min(3, 'is too short')
  .max(60, 'is too long');

/** A calendar day in India: YYYY-MM-DD. */
export const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a date');

const bookRef = z.strictObject({ bookId: id, note: str(300) });

// ------------------------------------------------------------------ site settings (one document)

const email = z.union([z.literal(''), z.email().max(120)]).default('');
const phone = z.union([z.literal(''), z.string().trim().regex(/^\+?[0-9 ]{8,16}$/, 'must be a phone number')]).default('');

export const settingsDraft = z.strictObject({
  /** Contact details used across the website (Contact, Franchise, Careers, the footer). */
  contact: z
    .strictObject({
      phone,
      whatsapp: phone,
      email,
      franchiseEmail: email,
      careersEmail: email,
    })
    .prefault({}),
  /** The home page's top banner (empty keeps the built-in words). */
  banner: z.strictObject({ heading: str(60), highlight: str(40), intro: str(300) }).prefault({}),
  /** The About page: the library's story. */
  about: z
    .strictObject({
      heading: str(90),
      intro: str(300),
      body: rich(6000),
      photos: z.array(image).max(8).default([]),
      /** "2,400 titles", "Since 2026"… up to six figures shown on About. */
      facts: z.array(z.strictObject({ value: req(1, 24), label: req(2, 48) })).max(6).default([]),
    })
    .prefault({}),
  /** Show the people below on the About page. */
  showTeam: z.boolean().default(true),
  /** Head office people shown on About (founders, curators…). */
  team: z.array(z.strictObject({ name: req(2, 80), role: str(80), photo: image.nullable().default(null), bio: str(600) })).max(12).default([]),
  /** Footer social links. */
  social: z
    .strictObject({
      instagram: z.union([z.literal(''), z.url({ protocol: /^https$/ }).max(300)]).default(''),
      facebook: z.union([z.literal(''), z.url({ protocol: /^https$/ }).max(300)]).default(''),
      youtube: z.union([z.literal(''), z.url({ protocol: /^https$/ }).max(300)]).default(''),
      x: z.union([z.literal(''), z.url({ protocol: /^https$/ }).max(300)]).default(''),
    })
    .prefault({}),
});
export type SettingsDraft = z.infer<typeof settingsDraft>;

// ------------------------------------------------------------------ page sections (one document)

const tile = z.strictObject({ title: req(2, 70), text: str(400) });
/** Lists that appear on the website's pages. Empty: the page keeps its built-in list. */
export const sectionsDraft = z.strictObject({
  /** Home: the promise tiles under the banner (No due dates, No late fines…). */
  promises: z.array(tile).max(6).default([]),
  /** Home: the three steps of "How it works". */
  homeSteps: z.array(tile).max(4).default([]),
  /** Home: "Something for every reader" (little readers, teens, grown-ups). */
  readers: z.array(tile).max(4).default([]),
  /** How it works page: the steps. */
  howSteps: z.array(tile).max(6).default([]),
  /** How it works page: questions, after the built-in ones. */
  faqs: z.array(z.strictObject({ q: req(5, 160), a: req(5, 1200) })).max(30).default([]),
  /** Franchise page: what a franchise gets. */
  franchisePerks: z.array(tile).max(6).default([]),
  /** Careers page: why work with us. */
  careerPerks: z.array(tile).max(8).default([]),
});
export type SectionsDraft = z.infer<typeof sectionsDraft>;

// ------------------------------------------------------------------ festive cards (one document)

/** One day's card in one year, keyed "<occasion>-<year>" (apps/site/src/greetings). Left out: automatic. */
const cardPick = z.strictObject({
  hidden: z.boolean().default(false),
  /** Words on the card instead of the day's wish. */
  words: str(90),
  /** A picture of the library's own behind the card's greeting. */
  picture: image.nullable().default(null),
  /** A new drawing from the card maker ("Try another"), by its seed. */
  gen: z.number().int().min(0).max(2 ** 31).nullable().default(null),
  /** Books to suggest for the day (catalogue ids). */
  books: z.array(id).max(4).default([]),
});

export const greetingsDraft = z.strictObject({
  enabled: z.boolean().default(true),
  /** Open the card by itself on the home page, after `delaySeconds`. */
  autoOpen: z.boolean().default(true),
  delaySeconds: z.number().int().min(2).max(30).default(6),
  /** The offer box beside the card ("Become a member this Diwali…"). */
  offer: z.strictObject({ on: z.boolean().default(true), text: str(140), cta }).prefault({}),
  picks: z.record(z.string().regex(/^[a-z0-9-]{2,40}-\d{4}$/), cardPick).default({}),
});
export type GreetingsDraft = z.infer<typeof greetingsDraft>;

// ------------------------------------------------------------------ branch pages (one per branch)

const AMENITIES = ['WIFI', 'AC', 'KIDS_CORNER', 'READING_ROOM', 'STUDY_DESKS', 'PARKING', 'WHEELCHAIR', 'BOARD_GAMES', 'CAFE', 'POWER_BACKUP', 'NEWSPAPERS', 'PRINTING', 'EVENTS_SPACE', 'BABY_CARE'] as const;
export const amenity = z.enum(AMENITIES);

export const branchDraft = z.strictObject({
  slug,
  /** The line under the branch name: "Your neighbourhood library in Whitefield". */
  tagline: str(120),
  intro: rich(1500),
  about: rich(4000),
  photos: z.array(image).max(12).default([]),
  /** Figures at the top of the page: "6,000+ books", "24 reading seats". */
  highlights: z.array(z.strictObject({ value: req(1, 24), label: req(2, 48) })).max(6).default([]),
  amenities: z.array(amenity).max(AMENITIES.length).default([]),
  /** Regular activities: storytime, book club, reading hour… */
  activities: z
    .array(z.strictObject({ title: req(3, 70), when: req(3, 70), audience: str(40), text: str(400) }))
    .max(10)
    .default([]),
  /** Important information with dates: holiday closures, changed hours, a stock check. */
  notices: z
    .array(z.strictObject({ text: req(5, 220), from: day, to: day, closed: z.boolean().default(false) }).refine((n) => n.from <= n.to, 'must end on or after the day it starts'))
    .max(12)
    .default([]),
  /** Rules and good-to-know: membership at this branch, parking, quiet hours… */
  goodToKnow: z.array(req(5, 240)).max(10).default([]),
  /** The head librarian's profile. */
  librarian: z
    .strictObject({
      name: req(2, 80),
      title: str(60),
      photo: image.nullable().default(null),
      bio: rich(1500),
      quote: str(220),
      since: z.number().int().min(1950).max(2100).nullable().default(null),
      languages: z.array(req(2, 30)).max(6).default([]),
      /** Books they love (free text, so they can name books the library doesn't have yet). */
      favourites: z.array(req(2, 120)).max(6).default([]),
    })
    .nullable()
    .default(null),
  /** "Our librarian recommends": catalogue books with a short note. */
  picks: z.array(bookRef).max(12).default([]),
  /** A Google Maps link to the branch's listing (Share → Copy link); empty uses the address. */
  mapUrl: z.union([z.literal(''), z.url({ protocol: /^https$/ }).max(500).refine((u) => /^(www\.)?google\.[a-z.]+$|^maps\.app\.goo\.gl$|^goo\.gl$/.test(new URL(u).hostname), 'must be a Google Maps link')]).default(''),
  /** A WhatsApp number of its own (empty: the branch phone). */
  whatsapp: z.union([z.literal(''), z.string().trim().regex(/^\+?[0-9 ]{10,16}$/, 'must be a phone number')]).default(''),
  hidden: z.boolean().default(false),
});
export type BranchDraft = z.infer<typeof branchDraft>;

// ------------------------------------------------------------------ blog posts

export const DESIGNS = ['CLASSIC', 'MAGAZINE', 'PHOTO', 'TIPS', 'NOTICE', 'LETTER', 'BOOKLIST'] as const;

export const postDraft = z.strictObject({
  title: req(5, 110),
  slug,
  summary: str(300),
  design: z.enum(DESIGNS).default('CLASSIC'),
  cover: image.nullable().default(null),
  intro: rich(3000),
  sections: z.array(z.strictObject({ heading: str(100), text: rich(4000), image: image.nullable().default(null) })).max(20).default([]),
  quote: z.strictObject({ text: req(5, 300), by: str(80) }).nullable().default(null),
  takeaways: z.array(req(3, 160)).max(8).default([]),
  /** Books the post is about (the Book list design shows them as cards; others list them at the end). */
  books: z.array(bookRef).max(24).default([]),
  author: z.strictObject({ name: str(80), role: str(80) }).prefault({}),
  /** The branch it is about (its managers may publish it, and it shows on the branch page). */
  branch: z.strictObject({ orgId: id, branchId: id }).nullable().default(null),
  tags: z.array(z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9 -]{1,29}$/, 'may use letters, digits and dashes')).max(6).default([]),
  cta,
  hidden: z.boolean().default(false),
});
export type PostDraft = z.infer<typeof postDraft>;

// ------------------------------------------------------------------ promotions

export const PLACEMENTS = ['BAR', 'POPUP', 'HOME'] as const;

export const promotionDraft = z
  .strictObject({
    title: req(3, 80),
    message: str(240),
    /** BAR: a slim bar on top of every page; POPUP: a card that opens once a day; HOME: a banner on the home page. */
    placement: z.enum(PLACEMENTS).default('BAR'),
    image: image.nullable().default(null),
    cta,
    /** A code to quote at the counter or when joining ("DIWALI25"). */
    code: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{0,24}$/, 'may use letters, digits and dashes').default(''),
    /** Only on these branches' pages (empty: the whole website). */
    branchIds: z.array(id).max(50).default([]),
    startOn: day,
    endOn: day,
    tone: z.enum(['SUN', 'MINT', 'GRAPE', 'CORAL', 'SKY']).default('SUN'),
    hidden: z.boolean().default(false),
  })
  .refine((p) => p.startOn <= p.endOn, { message: 'must end on or after the day it starts', path: ['endOn'] });
export type PromotionDraft = z.infer<typeof promotionDraft>;

// ------------------------------------------------------------------ jobs and testimonials

export const jobDraft = z.strictObject({
  title: req(3, 80),
  /** Where: a branch, head office, "Bengaluru". */
  location: str(80),
  type: z.enum(['FULL_TIME', 'PART_TIME', 'INTERNSHIP', 'VOLUNTEER']).default('FULL_TIME'),
  overview: str(800),
  qualification: str(400),
  experience: str(120),
  timings: str(160),
  responsibilities: z.array(req(3, 240)).max(12).default([]),
  hidden: z.boolean().default(false),
});
export type JobDraft = z.infer<typeof jobDraft>;

export const testimonialDraft = z.strictObject({
  quote: req(10, 500),
  name: req(2, 80),
  /** "Member since 2026, Whitefield", "Parent of a little reader". */
  detail: str(100),
  hidden: z.boolean().default(false),
});
export type TestimonialDraft = z.infer<typeof testimonialDraft>;

export const draftSchema: Record<Kind, z.ZodType> = {
  settings: settingsDraft,
  sections: sectionsDraft,
  job: jobDraft,
  testimonial: testimonialDraft,
  greetings: greetingsDraft,
  branch: branchDraft,
  post: postDraft,
  promotion: promotionDraft,
};

/** What the lists show as an item's name. */
export function titleOf(kind: Kind, draft: Record<string, unknown> | null | undefined): string {
  if (kind === 'settings') return 'Site settings';
  if (kind === 'sections') return 'Page sections';
  if (kind === 'greetings') return 'Festival greetings';
  if (!draft) return '';
  if (kind === 'branch') return String(draft.slug ?? '');
  if (kind === 'testimonial') return String(draft.name ?? '');
  return String(draft.title ?? '');
}

/** Today in India (YYYY-MM-DD): promotions, notices and cards follow India's date. */
export const todayInIndia = (now = new Date()) => new Date(now.getTime() + 5.5 * 3_600_000).toISOString().slice(0, 10);

/** A promotion's state on a day: not started, running or over. */
export function promotionWindow(p: Pick<PromotionDraft, 'startOn' | 'endOn'>, today: string): 'UPCOMING' | 'RUNNING' | 'ENDED' {
  return today < p.startOn ? 'UPCOMING' : today > p.endOn ? 'ENDED' : 'RUNNING';
}

/** A post's address from its title: "10 Books for Rainy Days!" → "10-books-for-rainy-days". */
export const slugify = (title: string) =>
  title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
