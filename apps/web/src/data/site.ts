// The console's Website section (functions/src/site/admin.ts): drafts, publishing, previews and pictures.
import { call, command } from './api';
import { env } from '../config/env';
import { shrinkToJpeg } from '../shared/image';

export type Kind = 'settings' | 'sections' | 'greetings' | 'branch' | 'post' | 'promotion' | 'job' | 'testimonial';
export type ListKind = 'branch' | 'post' | 'promotion' | 'job' | 'testimonial';
export type SiteStatus = 'NONE' | 'DRAFT' | 'IN_REVIEW' | 'HIDDEN' | 'LIVE' | 'CHANGED' | 'UPCOMING' | 'ENDED';

export interface SiteImage {
  url: string;
  alt: string;
}
export interface Cta {
  label: string;
  url: string;
}
export interface BookRef {
  bookId: string;
  note: string;
}

export interface SettingsDraft {
  contact: { phone: string; whatsapp: string; email: string; franchiseEmail: string; careersEmail: string };
  banner: { heading: string; highlight: string; intro: string };
  showTeam: boolean;
  about: { heading: string; intro: string; body: string; photos: SiteImage[]; facts: { value: string; label: string }[] };
  team: { name: string; role: string; photo: SiteImage | null; bio: string }[];
  social: { instagram: string; facebook: string; youtube: string; x: string };
}

export interface Tile {
  title: string;
  text: string;
}
export interface SectionsDraft {
  promises: Tile[];
  homeSteps: Tile[];
  readers: Tile[];
  howSteps: Tile[];
  faqs: { q: string; a: string }[];
  franchisePerks: Tile[];
  careerPerks: Tile[];
}

export const JOB_TYPES = ['FULL_TIME', 'PART_TIME', 'INTERNSHIP', 'VOLUNTEER'] as const;
export interface JobDraft {
  title: string;
  location: string;
  type: (typeof JOB_TYPES)[number];
  overview: string;
  qualification: string;
  experience: string;
  timings: string;
  responsibilities: string[];
  hidden: boolean;
}
export interface TestimonialDraft {
  quote: string;
  name: string;
  detail: string;
  hidden: boolean;
}

export interface CardPick {
  hidden: boolean;
  words: string;
  picture: SiteImage | null;
  gen: number | null;
  books: string[];
}
export interface GreetingsDraft {
  enabled: boolean;
  autoOpen: boolean;
  delaySeconds: number;
  offer: { on: boolean; text: string; cta: Cta | null };
  picks: Record<string, CardPick>;
}

export const AMENITIES = ['WIFI', 'AC', 'KIDS_CORNER', 'READING_ROOM', 'STUDY_DESKS', 'PARKING', 'WHEELCHAIR', 'BOARD_GAMES', 'CAFE', 'POWER_BACKUP', 'NEWSPAPERS', 'PRINTING', 'EVENTS_SPACE', 'BABY_CARE'] as const;
export type Amenity = (typeof AMENITIES)[number];

export interface Librarian {
  name: string;
  title: string;
  photo: SiteImage | null;
  bio: string;
  quote: string;
  since: number | null;
  languages: string[];
  favourites: string[];
}
export interface BranchDraft {
  slug: string;
  tagline: string;
  intro: string;
  about: string;
  photos: SiteImage[];
  highlights: { value: string; label: string }[];
  amenities: Amenity[];
  activities: { title: string; when: string; audience: string; text: string }[];
  notices: { text: string; from: string; to: string; closed: boolean }[];
  goodToKnow: string[];
  librarian: Librarian | null;
  picks: BookRef[];
  mapUrl: string;
  whatsapp: string;
  hidden: boolean;
}

export const DESIGNS = ['CLASSIC', 'MAGAZINE', 'PHOTO', 'TIPS', 'NOTICE', 'LETTER', 'BOOKLIST'] as const;
export type Design = (typeof DESIGNS)[number];
export interface PostDraft {
  title: string;
  slug: string;
  summary: string;
  design: Design;
  cover: SiteImage | null;
  intro: string;
  sections: { heading: string; text: string; image: SiteImage | null }[];
  quote: { text: string; by: string } | null;
  takeaways: string[];
  books: BookRef[];
  author: { name: string; role: string };
  branch: { orgId: string; branchId: string } | null;
  tags: string[];
  cta: Cta | null;
  hidden: boolean;
}

export const PLACEMENTS = ['BAR', 'POPUP', 'HOME'] as const;
export const TONES = ['SUN', 'MINT', 'GRAPE', 'CORAL', 'SKY'] as const;
export interface PromotionDraft {
  title: string;
  message: string;
  placement: (typeof PLACEMENTS)[number];
  image: SiteImage | null;
  cta: Cta | null;
  code: string;
  branchIds: string[];
  startOn: string;
  endOn: string;
  tone: (typeof TONES)[number];
  hidden: boolean;
}

export interface Rights {
  manager: boolean;
  canWrite: boolean;
  branches: { orgId: string; branchIds: string[] }[];
}
export interface Pending {
  kind: Kind;
  id: string;
  title: string;
  status: SiteStatus;
  updatedAt: string | null;
  updatedBy: string | null;
  canPublish: boolean;
}
export interface Overview {
  /** `alertRecipients`: how many people are on the enquiry alerts list (Connections); null unless a website manager. */
  counts: { newSubmissions: number | null; callsThisWeek: number | null; openJobs: number | null; alertRecipients: number | null };
  rights: Rights;
  pending: Pending[];
  reviews: { id: string; title: string; by: string; at: string | null }[];
  recent: { id: string; kind: Kind; itemId: string; title: string; action: 'publish' | 'unpublish' | 'delete'; by: { name: string }; at: string | null }[];
}

export interface ListItem {
  id: string;
  orgId?: string;
  title: string;
  city?: string;
  status: SiteStatus;
  slug: string | null;
  liveSlug: string | null;
  design?: string | null;
  placement?: string | null;
  startOn?: string | null;
  endOn?: string | null;
  liveOn?: string | null;
  by?: string | null;
  mine?: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
}

export interface Item<D> {
  id: string;
  kind: Kind;
  orgId: string | null;
  branchName: string | null;
  exists: boolean;
  draft: D | null;
  status: SiteStatus;
  isLive: boolean;
  changed: boolean;
  liveSlug: string | null;
  liveOn: string | null;
  previewToken: string | null;
  review: { by: string; at: string | null } | null;
  createdBy: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
  publishedAt: string | null;
  publishedBy: string | null;
  canPublish: boolean;
  canDelete: boolean;
}

/**
 * How a saved item stands and what the person may do with it: what the bar at the top of an editor shows. Saving,
 * publishing, taking down and asking for a review all answer with it, so the editor never reads the item again.
 */
export type ItemView = Pick<
  Item<unknown>,
  'id' | 'status' | 'isLive' | 'changed' | 'liveSlug' | 'liveOn' | 'previewToken' | 'review' | 'updatedAt' | 'updatedBy' | 'publishedAt' | 'publishedBy' | 'canPublish' | 'canDelete'
> & { exists: true };
/** What publishing did: put it on the website, took it off (a hidden draft), or nothing (hidden and never on it). */
export type PublishResult = 'publish' | 'unpublish' | 'none';

// ------------------------------------------------------------------ the overview, read once and shared

/** Sent on `window` after anything in the Website section was saved, published, deleted or followed up. */
export const SITE_CHANGED = 'stories:site-changed';
/** How long one read of the overview serves everyone who asks (the menu, the Publish button, the Website dashboard). */
const OVERVIEW_FRESH_MS = 30_000;
let overview: { uid: string; at: number; promise: Promise<Overview> } | null = null;

/**
 * The Website overview: what waits to be published or reviewed, new enquiries, what the person may do. The menu's
 * counts, the top bar's Publish button and the Website dashboard all need it, so with `uid` (the signed-in
 * person's) they share one request: a read under way or under 30 seconds old is reused, never another person's,
 * and never a failed one. Without `uid` it is a plain read, shared with nobody.
 */
export function siteOverview(uid?: string | null): Promise<Overview> {
  if (!uid) return call<Overview>('site-overview', {});
  if (overview && overview.uid === uid && Date.now() - overview.at < OVERVIEW_FRESH_MS) return overview.promise;
  const promise = call<Overview>('site-overview', {});
  const entry = { uid, at: Date.now(), promise };
  overview = entry;
  // A failure is not kept: "Try again" and the next caller read afresh.
  promise.catch(() => {
    if (overview === entry) overview = null;
  });
  return promise;
}

/**
 * Forgets the shared overview (a read still under way included, so what it started with is never served later),
 * then tells whoever shows it to read again. Every change below calls it; nothing else needs to.
 */
export function invalidateSiteOverview(): void {
  overview = null;
  window.dispatchEvent(new Event(SITE_CHANGED));
}

/** Calls `onChange` whenever the Website section changed (see `invalidateSiteOverview`); returns how to stop. */
export function onSiteOverviewChange(onChange: () => void): () => void {
  window.addEventListener(SITE_CHANGED, onChange);
  return () => window.removeEventListener(SITE_CHANGED, onChange);
}

/** A change to the Website section: whether it worked or not (a failed one may still have happened), the overview is stale. */
const changing = <R>(change: Promise<R>): Promise<R> => change.finally(invalidateSiteOverview);

export const listSite = (kind: ListKind) => call<{ items: ListItem[] }>('site-list', { kind }).then((r) => r.items);
export const getSite = <D>(kind: Kind, id?: string, orgId?: string) => call<Item<D>>('site-get', { kind, ...(id ? { id } : {}), ...(orgId ? { orgId } : {}) });

/**
 * Saves a draft. With `publish` the saved draft also goes on the website in the same request ("Save and publish":
 * `result` says what happened); if it can't be published, nothing is saved either.
 */
export const saveSite = (kind: Kind, draft: object, id?: string, orgId?: string, publish = false) =>
  changing(command<ItemView & { result?: PublishResult }>('site-save', { kind, draft, ...(id ? { id } : {}), ...(orgId ? { orgId } : {}), ...(publish ? { publish: true } : {}) }));
export const publishSite = (kind: Kind, id?: string) => changing(command<ItemView & { result: PublishResult }>('site-publish', { kind, ...(id ? { id } : {}) }));
export const unpublishSite = (kind: ListKind, id: string) => changing(command<ItemView & { result: PublishResult }>('site-unpublish', { kind, id }));
export const discardSite = (kind: Kind, id?: string) => changing(command('site-discard', { kind, ...(id ? { id } : {}) }));
export const deleteSite = (kind: Exclude<ListKind, 'branch'>, id: string) => changing(command('site-delete', { kind, id }));
export const requestReview = (id: string, note = '') => changing(command<ItemView>('site-requestReview', { id, note }));
export const publishAll = () =>
  changing(command<{ published: { kind: Kind; id: string; result: string }[]; blocked: { title: string; reason: string }[] }>('site-publishAll', {}));

/** Longest side of a picture for the website: sharp on large screens, small enough for phones. */
const MAX_SIDE = 1800;
/**
 * Shrinks a photo and stores it for the website; returns its address. A dropped connection is tried again as the
 * same request (the server names the file after it, so a retry writes the same file, never a second one).
 */
export async function uploadSiteImage(file: File): Promise<string> {
  const image = await shrinkToJpeg(file, MAX_SIDE);
  // The id is given here so that `command` never builds its own key from the picture's bytes.
  const { url } = await command<{ url: string }>('site-uploadImage', { image }, crypto.randomUUID());
  return url;
}

/** The public website (the member area is its /account). */
export const SITE_URL = env.memberUrl.replace(/\/account$/, '');
export const liveUrl = (kind: Kind, slug: string | null) => (slug ? `${SITE_URL}${kind === 'post' ? '/blog/' : '/branches/'}${slug}` : null);
export const previewUrl = (kind: 'post' | 'branch', id: string, token: string | null) => (token ? `${SITE_URL}/preview/${kind}/${id}?t=${token}` : null);

/** "10 Books for Rainy Days!" → "10-books-for-rainy-days" (the same rule as the server). */
export const slugify = (title: string) =>
  title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');

export const todayInIndia = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());

// ------------------------------------------------------------------ enquiries, calls, connections, admins

export type Form = 'MEMBERSHIP' | 'FRANCHISE' | 'JOB' | 'CONTACT';
export interface Submission {
  id: string;
  form: Form;
  name: string;
  phone: string;
  email: string;
  message: string;
  city: string;
  readers: string;
  experience: string;
  branchId: string | null;
  branchName: string | null;
  jobId: string | null;
  jobTitle: string | null;
  page: string;
  resume: { name: string } | null;
  handled: boolean;
  handledBy?: { name: string } | null;
  handledAt?: string | null;
  note?: string;
  createdAt: string | null;
}
/** Enquiries, newest first: with `open`, only those still to follow up; otherwise the newest 500, handled or not. */
export const listSubmissions = (open: boolean) => call<{ items: Submission[] }>('site-submissions', { open }).then((r) => r.items);
/** One enquiry (the page a notification opens). */
export const getSubmission = (id: string) => call<Submission>('site-submission', { id });
/** Marks an enquiry as followed up (or not). Without `note` its note stays as it is; with one (even empty) it is replaced. */
export const markHandled = (id: string, handled: boolean, note?: string) =>
  changing(command('site-markHandled', { id, handled, ...(note === undefined ? {} : { note }) }));
export const deleteSubmission = (id: string) => changing(command('site-deleteSubmission', { id }));
/** Downloads an applicant's CV (it is never public). */
export async function downloadResume(id: string) {
  const f = await call<{ name: string; type: string; data: string }>('site-resume', { id });
  const bytes = Uint8Array.from(atob(f.data), (c) => c.charCodeAt(0));
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([bytes], { type: f.type }));
  a.download = f.name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

export interface CallTap {
  id: string;
  channel: 'phone' | 'whatsapp';
  number: string;
  branch: string;
  page: string;
  place: string;
  source: string;
  visit: string;
  device: string;
  createdAt: string | null;
}
export const listCalls = (days: 7 | 30 | 90) => call<{ items: CallTap[] }>('site-calls', { days }).then((r) => r.items);

export interface Connections {
  alerts: string[];
  alertBranchManagers: boolean;
  branches: { id: string; name: string; whatsapp: boolean; payments: boolean }[];
}
export const getConnections = () => call<Connections>('site-connections', {});
export const saveConnections = (alerts: string[], alertBranchManagers: boolean) => command('site-saveConnections', { alerts, alertBranchManagers });

export interface WebsitePerson {
  uid: string;
  name: string;
  email: string;
  org: string;
  roles: string[];
  level: 'MANAGER' | 'BRANCH' | 'WRITER';
  branches: string[];
}
export const listWebsiteAdmins = () => call<{ people: WebsitePerson[] }>('site-admins', {}).then((r) => r.people);

/** Rows as a CSV file the person saves (Excel opens it). */
export function downloadCsv(name: string, header: string[], rows: (string | number | null | undefined)[][]) {
  const cell = (v: string | number | null | undefined) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) || /^[=+\-@]/.test(s) ? `"${s.replace(/^([=+\-@])/, "'$1").replace(/"/g, '""')}"` : s;
  };
  const csv = [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([`\ufeff${csv}`], { type: 'text/csv' }));
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
