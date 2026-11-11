// The console's Website section (docs/WEBSITE_ADMIN.md): save, publish, unpublish, review and upload, for site
// settings, festive cards, branch pages, blog posts and promotions. Who may do what:
//   website.manage (Head Office Admin, Website Editor, in the corporate organization): everything;
//   website.branch (Franchise Owner, Branch Manager): their branches' pages, and posts about those branches;
//   blog.write (also Librarians): write their own posts and send them for review.
import { randomBytes } from 'node:crypto';

import { FieldValue, type Timestamp, type Transaction } from 'firebase-admin/firestore';
import { z } from 'zod';

import { recordAudit } from '../core/audit.js';
import { command, query, requestIdSchema } from '../core/callable.js';
import { errors } from '../core/errors.js';
import { db } from '../core/firebase.js';
import { notify } from '../core/notify.js';
import { type Actor, coversBranch, holds, type Membership } from '../core/rbac.js';
import { id } from '../core/schemas.js';
import { bucket, downloadUrl, IMAGE_TYPES } from '../catalogue/covers.js';
import { inboxCounts } from './inbox.js';
import {
  type BranchDraft,
  collectionOf,
  draftSchema,
  type Kind,
  KINDS,
  LISTS,
  type PostDraft,
  promotionWindow,
  type PromotionDraft,
  SINGLETONS,
  slugify,
  titleOf,
  todayInIndia,
} from './content.js';

type Draft = Record<string, unknown>;
interface Person {
  uid: string;
  name: string;
}

/** A stored item (siteContent/{key}, siteBranches/{branchId}, sitePosts/{id}, sitePromotions/{id}). */
export interface SiteDoc {
  kind: Kind;
  draft: Draft;
  live: Draft | null;
  isLive: boolean;
  /** The draft differs from what the website shows (there is something to publish). */
  changed: boolean;
  slug?: string | null;
  liveSlug?: string | null;
  /** Posts: when first published (YYYY-MM-DD), the branch it is about, its tags. */
  liveOn?: string | null;
  liveBranchId?: string | null;
  /** Promotions: the live window and placement, for the website's query. */
  liveStart?: string | null;
  liveEnd?: string | null;
  /** Branch pages: the branch, and its name (for lists). */
  orgId?: string | null;
  branchName?: string | null;
  branchId?: string | null;
  previewToken?: string | null;
  review?: { by: Person; at: Timestamp } | null;
  createdBy?: Person;
  createdAt?: Timestamp;
  updatedBy?: Person;
  updatedAt?: Timestamp;
  publishedBy?: Person | null;
  publishedAt?: Timestamp | null;
}

// ------------------------------------------------------------------ rights

export interface Rights {
  /** May manage the whole website; the organization to file audit entries under (null: platform). */
  manager: { orgId: string | null } | null;
  memberships: Membership[];
}

export async function rightsOf(actor: Actor, tx?: Transaction): Promise<Rights> {
  const q = db.collection(`users/${actor.uid}/memberships`).where('status', '==', 'ACTIVE');
  const memberships = (tx ? await tx.get(q) : await q.get()).docs.map((d) => d.data() as Membership);
  if (actor.isSuperAdmin) return { manager: { orgId: null }, memberships };
  const m = memberships.find((x) => x.orgType === 'CORPORATE' && holds(x, 'website.manage'));
  return { manager: m ? { orgId: m.orgId } : null, memberships };
}

export const canEditBranch = (r: Rights, orgId: string, branchId: string) =>
  !!r.manager || r.memberships.some((m) => m.orgId === orgId && holds(m, 'website.branch') && coversBranch(m.branchIds, branchId));
export const canWrite = (r: Rights) => !!r.manager || r.memberships.some((m) => holds(m, 'blog.write') || holds(m, 'website.branch'));

const postBranch = (d: Draft | null | undefined) => (d?.branch as PostDraft['branch'] | undefined) ?? null;
/** Editing a post: website managers, its writer, and managers of the branch it is about. */
function canEditPost(r: Rights, uid: string, doc: SiteDoc) {
  const b = postBranch(doc.draft);
  return !!r.manager || (doc.createdBy?.uid === uid && canWrite(r)) || (!!b && canEditBranch(r, b.orgId, b.branchId));
}
/** Publishing a post: website managers, and managers of the branch it is about. Writers send it for review. */
function canPublishPost(r: Rights, doc: SiteDoc, draft: Draft) {
  const b = postBranch(draft);
  return !!r.manager || (!!b && canEditBranch(r, b.orgId, b.branchId));
}

function canEdit(r: Rights, uid: string, kind: Kind, doc: SiteDoc | null, itemId: string | null, orgId?: string | null): boolean {
  if (kind === 'post') return doc ? canEditPost(r, uid, doc) : canWrite(r);
  if (kind === 'branch') return !!itemId && !!orgId && canEditBranch(r, orgId, itemId);
  return !!r.manager;
}

function canPublish(r: Rights, kind: Kind, doc: SiteDoc, itemId: string): boolean {
  if (kind === 'post') return canPublishPost(r, doc, doc.draft);
  if (kind === 'branch') return !!doc.orgId && canEditBranch(r, doc.orgId, itemId);
  return !!r.manager;
}

/** The organization an action is recorded under: the branch's, else the manager's, else the writer's. */
function auditOrg(r: Rights, branchOrg: string | null | undefined): string | null {
  return branchOrg ?? r.manager?.orgId ?? r.memberships.find((m) => holds(m, 'blog.write'))?.orgId ?? null;
}

/** An item's name in lists and the publish log: a branch page goes by its branch's name. */
const nameOf = (kind: Kind, doc: Pick<SiteDoc, 'draft' | 'branchName'>) => (kind === 'branch' && doc.branchName ? doc.branchName : titleOf(kind, doc.draft));

const personOf = (actor: Actor): Person => ({ uid: actor.uid, name: actor.profile?.displayName || actor.email || 'Staff' });

// ------------------------------------------------------------------ helpers

const refOf = (kind: Kind, itemId: string) => db.doc(`${collectionOf[kind]}/${SINGLETONS[kind] ?? itemId}`);

/** Equality that ignores key order (Firestore hands maps back sorted). */
function stable(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stable);
  if (v && typeof v === 'object' && !(v instanceof Date)) return Object.fromEntries(Object.entries(v as object).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, stable(x)]));
  return v;
}
export const sameContent = (a: unknown, b: unknown) => JSON.stringify(stable(a)) === JSON.stringify(stable(b));

/** Whether there is something to publish: the draft differs from live (a hidden draft that isn't live: nothing). */
const isChanged = (draft: Draft, live: Draft | null) => (draft.hidden === true && !live ? false : !sameContent(draft, live));

function parseDraft(kind: Kind, draft: unknown): Draft {
  const result = draftSchema[kind].safeParse(draft);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw errors.invalid(`Please check ${issue?.path.join('.') || 'the form'}: ${issue?.message ?? 'invalid value'}.`);
  }
  return result.data as Draft;
}

/** Another item already uses (or shows at) this address. */
async function slugTaken(tx: Transaction, kind: 'post' | 'branch', slug: string, itemId: string) {
  const col = db.collection(collectionOf[kind]);
  const [a, b] = await Promise.all([tx.get(col.where('slug', '==', slug).limit(2)), tx.get(col.where('liveSlug', '==', slug).limit(2))]);
  return [...a.docs, ...b.docs].some((d) => d.id !== itemId);
}

const iso = (t: Timestamp | null | undefined) => (t ? t.toDate().toISOString() : null);
const newToken = () => randomBytes(18).toString('base64url');

/** How an item stands, for the console's lists. */
export function statusOf(doc: Pick<SiteDoc, 'kind' | 'draft' | 'live' | 'isLive' | 'changed' | 'review'>, today = todayInIndia()) {
  if (doc.review && !doc.isLive) return 'IN_REVIEW';
  if (!doc.isLive) return doc.draft.hidden ? 'HIDDEN' : 'DRAFT';
  if (doc.kind === 'promotion' && doc.live) {
    const w = promotionWindow(doc.live as PromotionDraft, today);
    if (w !== 'RUNNING') return doc.changed ? 'CHANGED' : w;
  }
  return doc.changed ? 'CHANGED' : 'LIVE';
}

async function branchExists(tx: Transaction, orgId: string, branchId: string) {
  const snap = await tx.get(db.doc(`orgs/${orgId}/branches/${branchId}`));
  if (!snap.exists || snap.get('status') !== 'ACTIVE') throw errors.notFound('Branch');
  return snap;
}

function logPublish(tx: Transaction, kind: Kind, itemId: string, title: string, action: 'publish' | 'unpublish' | 'delete', by: Person) {
  tx.create(db.collection('sitePublishLog').doc(), { kind, itemId, title, action, by, at: FieldValue.serverTimestamp() });
}

/** The live copy and its index fields for the website's queries; `null` draft fields stay null. */
function liveFields(kind: Kind, draft: Draft, prior: SiteDoc | null): Partial<SiteDoc> {
  if (kind === 'post') {
    const d = draft as PostDraft;
    return { liveSlug: d.slug, liveOn: prior?.liveOn ?? todayInIndia(), liveBranchId: d.branch?.branchId ?? null };
  }
  if (kind === 'branch') return { liveSlug: (draft as BranchDraft).slug };
  if (kind === 'promotion') {
    const d = draft as PromotionDraft;
    return { liveStart: d.startOn, liveEnd: d.endOn };
  }
  return {};
}
const notLive = { live: null, isLive: false, liveSlug: null, liveBranchId: null, liveStart: null, liveEnd: null };

/** Publishes (or, for a hidden item, takes down) one item inside `tx`. Returns what happened. */
function publishInTx(tx: Transaction, kind: Kind, itemId: string, doc: SiteDoc, by: Person): 'publish' | 'unpublish' | 'none' {
  const ref = refOf(kind, itemId);
  const hiding = doc.draft.hidden === true;
  if (hiding && !doc.isLive) return 'none';
  const stamp = { publishedBy: by, publishedAt: FieldValue.serverTimestamp(), changed: false, review: null };
  if (hiding) tx.update(ref, { ...notLive, ...stamp });
  else tx.update(ref, { live: doc.draft, isLive: true, ...liveFields(kind, doc.draft, doc), ...stamp });
  logPublish(tx, kind, itemId, nameOf(kind, doc), hiding ? 'unpublish' : 'publish', by);
  return hiding ? 'unpublish' : 'publish';
}

// ------------------------------------------------------------------ schemas

const kind = z.enum(KINDS);
/** Kinds whose new items get an id on their first save. */
const isNewable = (k: Kind) => k === 'post' || k === 'promotion' || k === 'job' || k === 'testimonial';
const itemRef = { kind, id: id.optional() };
const resolveId = (k: Kind, itemId: string | undefined) => {
  const key = SINGLETONS[k] ?? itemId;
  if (!key) throw errors.invalid('Please choose an item.');
  return key;
};

// ------------------------------------------------------------------ reads

/** The Website section's front page: what the caller may do, what waits to be published or reviewed, recent publishes. */
export const overview = query('site-overview', z.strictObject({}), async ({ actor }) => {
  const r = await rightsOf(actor);
  if (!r.manager && !canWrite(r) && !r.memberships.some((m) => holds(m, 'website.branch'))) throw errors.forbidden();
  const [changed, reviews, recent] = await Promise.all([
    Promise.all(KINDS.filter((k) => !SINGLETONS[k] || k === 'settings').map((k) => db.collection(collectionOf[k]).where('changed', '==', true).limit(100).get())),
    db.collection('sitePosts').where('review', '!=', null).limit(50).get(),
    db.collection('sitePublishLog').orderBy('at', 'desc').limit(12).get(),
  ]);
  const visible = (k: Kind, d: SiteDoc, itemId: string) => (k === 'post' ? canEditPost(r, actor.uid, d) : k === 'branch' ? !!d.orgId && canEditBranch(r, d.orgId, itemId) : !!r.manager);
  const pending = changed
    .flatMap((s) => s.docs)
    .map((d) => ({ id: d.id, doc: d.data() as SiteDoc }))
    .filter(({ id: itemId, doc }) => visible(doc.kind, doc, itemId))
    .map(({ id: itemId, doc }) => ({
      kind: doc.kind,
      id: itemId,
      title: nameOf(doc.kind, doc),
      status: statusOf(doc),
      updatedAt: iso(doc.updatedAt),
      updatedBy: doc.updatedBy?.name ?? null,
      canPublish: canPublish(r, doc.kind, doc, itemId),
    }));
  const counts = await inboxCounts(r);
  return {
    counts,
    rights: {
      manager: !!r.manager,
      canWrite: canWrite(r),
      branches: r.memberships.filter((m) => holds(m, 'website.branch')).map((m) => ({ orgId: m.orgId, branchIds: m.branchIds })),
    },
    pending,
    reviews: reviews.docs
      .map((d) => ({ id: d.id, doc: d.data() as SiteDoc }))
      .filter(({ doc }) => canPublishPost(r, doc, doc.draft))
      .map(({ id: itemId, doc }) => ({ id: itemId, title: titleOf('post', doc.draft), by: doc.review?.by.name ?? '', at: iso(doc.review?.at) })),
    recent: recent.docs.map((d) => ({ ...d.data(), id: d.id, at: iso(d.get('at') as Timestamp) })),
  };
});

/** Lists one kind: posts, promotions or branch pages (every active branch the caller may edit, with or without a page). */
export const list = query('site-list', z.strictObject({ kind: z.enum(LISTS) }), async ({ actor, input }) => {
  const r = await rightsOf(actor);
  const today = todayInIndia();
  if (input.kind === 'branch') {
    const orgs = r.manager
      ? (await db.collection('orgs').where('status', '==', 'ACTIVE').get()).docs.map((o) => o.id)
      : [...new Set(r.memberships.filter((m) => holds(m, 'website.branch')).map((m) => m.orgId))];
    const [branches, pages] = await Promise.all([
      Promise.all(orgs.map((o) => db.collection(`orgs/${o}/branches`).where('status', '==', 'ACTIVE').get())),
      db.collection('siteBranches').get(),
    ]);
    const byId = new Map(pages.docs.map((d) => [d.id, d.data() as SiteDoc]));
    return {
      items: branches
        .flatMap((s) => s.docs)
        .filter((b) => canEditBranch(r, b.get('orgId') as string, b.id))
        .map((b) => {
          const page = byId.get(b.id);
          return {
            id: b.id,
            orgId: b.get('orgId') as string,
            title: b.get('name') as string,
            city: (b.get('address.city') as string | undefined) ?? '',
            status: page ? statusOf(page, today) : 'NONE',
            slug: (page?.draft.slug as string | undefined) ?? null,
            liveSlug: page?.liveSlug ?? null,
            updatedAt: iso(page?.updatedAt),
            updatedBy: page?.updatedBy?.name ?? null,
          };
        })
        .sort((a, b) => a.title.localeCompare(b.title)),
    };
  }
  if (input.kind !== 'post' && !r.manager) throw errors.forbidden();
  if (input.kind === 'post' && !canWrite(r)) throw errors.forbidden();
  const snap = await db.collection(collectionOf[input.kind]).orderBy('updatedAt', 'desc').limit(300).get();
  return {
    items: snap.docs
      .map((d) => ({ id: d.id, doc: d.data() as SiteDoc }))
      .filter(({ doc }) => input.kind !== 'post' || canEditPost(r, actor.uid, doc))
      .map(({ id: itemId, doc }) => ({
        id: itemId,
        title: titleOf(input.kind, doc.draft),
        status: statusOf(doc, today),
        slug: (doc.draft.slug as string | undefined) ?? null,
        liveSlug: doc.liveSlug ?? null,
        design: (doc.draft.design as string | undefined) ?? null,
        placement: (doc.draft.placement as string | undefined) ?? null,
        startOn: (doc.draft.startOn as string | undefined) ?? null,
        endOn: (doc.draft.endOn as string | undefined) ?? null,
        liveOn: doc.liveOn ?? null,
        by: doc.createdBy?.name ?? null,
        mine: doc.createdBy?.uid === actor.uid,
        updatedAt: iso(doc.updatedAt),
        updatedBy: doc.updatedBy?.name ?? null,
      })),
  };
});

/** One item to edit: its draft (or a new one), how it stands, and what the caller may do with it. */
export const get = query('site-get', z.strictObject({ ...itemRef, orgId: id.optional() }), async ({ actor, input }) => {
  const r = await rightsOf(actor);
  // A post not written yet: only what the caller may do with it.
  if (input.kind === 'post' && !input.id) {
    if (!canWrite(r)) throw errors.forbidden();
    return { id: null, kind: 'post' as const, exists: false, draft: null, status: 'NONE', isLive: false, changed: true, canPublish: !!r.manager, canDelete: false };
  }
  const itemId = resolveId(input.kind, input.id);
  const snap = await refOf(input.kind, itemId).get();
  const doc = snap.exists ? (snap.data() as SiteDoc) : null;
  let orgId = doc?.orgId ?? input.orgId ?? null;
  let branchName: string | null = null;
  if (input.kind === 'branch') {
    if (!orgId) throw errors.invalid('Please choose a branch.');
    const b = await db.doc(`orgs/${orgId}/branches/${itemId}`).get();
    if (!b.exists) throw errors.notFound('Branch');
    branchName = b.get('name') as string;
    orgId = b.get('orgId') as string;
  }
  if (!doc && input.kind === 'post' && input.id) throw errors.notFound('Post');
  if (!canEdit(r, actor.uid, input.kind, doc, itemId, orgId)) throw errors.forbidden();
  const draft =
    doc?.draft ??
    (input.kind === 'branch'
      ? parseDraft('branch', { slug: slugify(branchName ?? 'branch') || 'branch' })
      : SINGLETONS[input.kind]
        ? parseDraft(input.kind, {})
        : null);
  return {
    id: itemId,
    kind: input.kind,
    orgId,
    branchName,
    exists: !!doc,
    draft,
    status: doc ? statusOf(doc) : 'NONE',
    isLive: doc?.isLive ?? false,
    changed: doc?.changed ?? false,
    liveSlug: doc?.liveSlug ?? null,
    liveOn: doc?.liveOn ?? null,
    previewToken: doc && canEdit(r, actor.uid, input.kind, doc, itemId, orgId) ? (doc.previewToken ?? null) : null,
    review: doc?.review ? { by: doc.review.by.name, at: iso(doc.review.at) } : null,
    createdBy: doc?.createdBy?.name ?? null,
    updatedAt: iso(doc?.updatedAt),
    updatedBy: doc?.updatedBy?.name ?? null,
    publishedAt: iso(doc?.publishedAt),
    publishedBy: doc?.publishedBy?.name ?? null,
    canPublish: doc ? canPublish(r, input.kind, doc, itemId) : input.kind === 'post' ? !!r.manager : input.kind === 'branch' ? true : !!r.manager,
    canDelete: input.kind === 'post' ? !!doc && (!!r.manager || (doc.createdBy?.uid === actor.uid && !doc.isLive)) : input.kind !== 'branch' && !SINGLETONS[input.kind] && !!r.manager,
  };
});

// ------------------------------------------------------------------ writes

/** Saves a draft (nothing changes on the website until it is published). New posts and promotions get an id. */
export const save = command(
  'site-save',
  z.strictObject({ ...itemRef, orgId: id.optional(), draft: z.record(z.string(), z.unknown()) }),
  async ({ actor, input, requestId }, tx) => {
    const r = await rightsOf(actor, tx);
    const creating = isNewable(input.kind) && !input.id;
    const itemId = creating ? db.collection(collectionOf[input.kind]).doc().id : resolveId(input.kind, input.id);
    const ref = refOf(input.kind, itemId);
    const snap = await tx.get(ref);
    if (!creating && !snap.exists && isNewable(input.kind)) throw errors.notFound('This item');
    const doc = snap.exists ? (snap.data() as SiteDoc) : null;
    const draft = parseDraft(input.kind, input.draft);

    let orgId = doc?.orgId ?? input.orgId ?? null;
    let branchName: string | null = null;
    if (input.kind === 'branch') {
      if (!orgId) throw errors.invalid('Please choose a branch.');
      const b = await branchExists(tx, orgId, itemId);
      orgId = b.get('orgId') as string;
      branchName = (b.get('name') as string | undefined) ?? null;
    }
    if (!canEdit(r, actor.uid, input.kind, doc, itemId, orgId)) throw errors.forbidden();
    const b = input.kind === 'post' ? postBranch(draft) : null;
    if (b) {
      await branchExists(tx, b.orgId, b.branchId);
      // Writers may tie a post to a branch they work at; managers to any.
      const prior = postBranch(doc?.draft);
      const same = prior?.branchId === b.branchId;
      if (!r.manager && !same && !r.memberships.some((m) => m.orgId === b.orgId && coversBranch(m.branchIds, b.branchId))) {
        throw errors.forbidden('You can only write about a branch you work at.');
      }
    }
    if (input.kind === 'post' || input.kind === 'branch') {
      if (await slugTaken(tx, input.kind, draft.slug as string, itemId)) {
        throw errors.conflict('SLUG_TAKEN', `Another ${input.kind === 'post' ? 'post' : 'branch page'} already uses the address “${String(draft.slug)}”. Please choose another.`);
      }
    }
    if (input.kind === 'promotion' && (draft.branchIds as string[]).length) {
      // Branch ids are checked loosely (any organization): an unknown id simply never matches a page.
    }

    const by = personOf(actor);
    const live = doc?.live ?? null;
    const fields = {
      kind: input.kind,
      draft,
      changed: isChanged(draft, live),
      slug: (draft.slug as string | undefined) ?? null,
      ...(input.kind === 'branch' ? { branchName } : {}),
      updatedBy: by,
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (doc) tx.update(ref, fields);
    else {
      tx.create(ref, {
        ...fields,
        ...notLive,
        orgId: input.kind === 'branch' ? orgId : null,
        branchId: input.kind === 'branch' ? itemId : null,
        previewToken: input.kind === 'post' || input.kind === 'branch' ? newToken() : null,
        review: null,
        createdBy: by,
        createdAt: FieldValue.serverTimestamp(),
        publishedBy: null,
        publishedAt: null,
        liveOn: null,
      });
    }
    recordAudit(tx, { actorUid: actor.uid, actorEmail: actor.email, requestId }, auditOrg(r, input.kind === 'branch' ? orgId : (b?.orgId ?? null)), {
      action: `site.${input.kind}.save`,
      entityType: `site${input.kind}`,
      entityId: itemId,
      branchId: input.kind === 'branch' ? itemId : (b?.branchId ?? null),
      after: { title: titleOf(input.kind, draft) },
    });
    return { id: itemId, changed: fields.changed };
  },
);

const itemInput = z.strictObject({ kind, id: id.optional() });

async function load(tx: Transaction, k: Kind, itemId: string) {
  const snap = await tx.get(refOf(k, itemId));
  if (!snap.exists) throw errors.notFound('This item');
  return snap.data() as SiteDoc;
}

/** Puts the saved draft on the website (a hidden draft takes the item off it). */
export const publish = command('site-publish', itemInput, async ({ actor, input, requestId }, tx) => {
  const r = await rightsOf(actor, tx);
  const itemId = resolveId(input.kind, input.id);
  const doc = await load(tx, input.kind, itemId);
  if (!canPublish(r, input.kind, doc, itemId)) throw errors.forbidden(input.kind === 'post' ? 'Send it for review: a branch manager or the website team publishes it.' : undefined);
  if (input.kind === 'branch' || input.kind === 'post') {
    if (await slugTaken(tx, input.kind, doc.draft.slug as string, itemId)) throw errors.conflict('SLUG_TAKEN', 'Another item already uses this address. Change it, save, then publish.');
  }
  const by = personOf(actor);
  const result = publishInTx(tx, input.kind, itemId, doc, by);
  if (result !== 'none') {
    const b = input.kind === 'post' ? postBranch(doc.draft) : null;
    recordAudit(tx, { actorUid: actor.uid, actorEmail: actor.email, requestId }, auditOrg(r, input.kind === 'branch' ? doc.orgId : (b?.orgId ?? null)), {
      action: `site.${input.kind}.${result}`,
      entityType: `site${input.kind}`,
      entityId: itemId,
      branchId: input.kind === 'branch' ? itemId : (b?.branchId ?? null),
      after: { title: titleOf(input.kind, doc.draft) },
    });
    // Tell the writer their post went live.
    if (input.kind === 'post' && result === 'publish' && doc.createdBy) {
      const org = auditOrg(r, b?.orgId);
      if (org) notify(tx, doc.createdBy.uid, { orgId: org, kind: 'site.post.published', title: `Your post “${titleOf('post', doc.draft)}” is on the website`, link: `/website/blog/${itemId}` }, actor.uid);
    }
  }
  return { id: itemId, result };
});

/** Takes an item off the website (its draft stays, to publish again later). */
export const unpublish = command('site-unpublish', z.strictObject({ kind: z.enum(LISTS), id }), async ({ actor, input, requestId }, tx) => {
  const r = await rightsOf(actor, tx);
  const doc = await load(tx, input.kind, input.id);
  if (!canPublish(r, input.kind, doc, input.id)) throw errors.forbidden();
  if (!doc.isLive) return { id: input.id, result: 'none' as const };
  const by = personOf(actor);
  tx.update(refOf(input.kind, input.id), { ...notLive, changed: isChanged(doc.draft, null), publishedBy: by, publishedAt: FieldValue.serverTimestamp() });
  logPublish(tx, input.kind, input.id, nameOf(input.kind, doc), 'unpublish', by);
  recordAudit(tx, { actorUid: actor.uid, actorEmail: actor.email, requestId }, auditOrg(r, input.kind === 'branch' ? doc.orgId : postBranch(doc.draft)?.orgId), {
    action: `site.${input.kind}.unpublish`,
    entityType: `site${input.kind}`,
    entityId: input.id,
  });
  return { id: input.id, result: 'unpublish' as const };
});

/** Throws away unpublished changes: the draft goes back to what the website shows. */
export const discard = command('site-discard', itemInput, async ({ actor, input }, tx) => {
  const r = await rightsOf(actor, tx);
  const itemId = resolveId(input.kind, input.id);
  const doc = await load(tx, input.kind, itemId);
  if (!canEdit(r, actor.uid, input.kind, doc, itemId, doc.orgId)) throw errors.forbidden();
  if (!doc.live) throw errors.conflict('NOT_PUBLISHED', 'This has never been published, so there is nothing to go back to.');
  tx.update(refOf(input.kind, itemId), { draft: doc.live, slug: (doc.live.slug as string | undefined) ?? null, changed: false, updatedBy: personOf(actor), updatedAt: FieldValue.serverTimestamp() });
  return { id: itemId };
});

/** Deletes a post (website managers; writers their own unpublished ones) or a promotion. */
export const remove = command('site-delete', z.strictObject({ kind: z.enum(['post', 'promotion', 'job', 'testimonial']), id }), async ({ actor, input, requestId }, tx) => {
  const r = await rightsOf(actor, tx);
  const doc = await load(tx, input.kind, input.id);
  const allowed = input.kind !== 'post' ? !!r.manager : !!r.manager || (doc.createdBy?.uid === actor.uid && !doc.isLive);
  if (!allowed) throw errors.forbidden(doc.isLive ? 'Take it off the website first, or ask the website team.' : undefined);
  tx.delete(refOf(input.kind, input.id));
  const by = personOf(actor);
  logPublish(tx, input.kind, input.id, titleOf(input.kind, doc.draft), 'delete', by);
  recordAudit(tx, { actorUid: actor.uid, actorEmail: actor.email, requestId }, auditOrg(r, postBranch(doc.draft)?.orgId), {
    action: `site.${input.kind}.delete`,
    entityType: `site${input.kind}`,
    entityId: input.id,
    before: { title: titleOf(input.kind, doc.draft) },
  });
  return { id: input.id };
});

/** A writer asks for their post to be published: it shows on the Website page of those who may publish it. */
export const requestReview = command('site-requestReview', z.strictObject({ id, note: z.string().trim().max(300).default('') }), async ({ actor, input }, tx) => {
  const r = await rightsOf(actor, tx);
  const doc = await load(tx, 'post', input.id);
  if (!canEditPost(r, actor.uid, doc)) throw errors.forbidden();
  if (!doc.changed) throw errors.conflict('NOTHING_TO_REVIEW', 'There are no changes to review: the website already shows this post.');
  tx.update(refOf('post', input.id), { review: { by: personOf(actor), at: FieldValue.serverTimestamp(), note: input.note } });
  return { id: input.id };
});

/** Publishes everything with unpublished changes that the caller may publish (at most 100 at a time). */
export const publishAll = command('site-publishAll', z.strictObject({}), async ({ actor, requestId }, tx) => {
  const r = await rightsOf(actor, tx);
  const snaps = await Promise.all((['settings', 'branch', 'post', 'promotion', 'job', 'testimonial'] as const).map((k) => tx.get(db.collection(collectionOf[k]).where('changed', '==', true).limit(100))));
  const by = personOf(actor);
  const done: { kind: Kind; id: string; result: string }[] = [];
  const blocked: { kind: Kind; id: string; title: string; reason: string }[] = [];
  const items = snaps.flatMap((s) => s.docs).map((d) => ({ id: d.id, doc: d.data() as SiteDoc }));
  // Addresses must stay unique among what goes live.
  const slugs = new Map<string, string>();
  for (const k of ['post', 'branch'] as const) {
    const live = await tx.get(db.collection(collectionOf[k]).where('isLive', '==', true));
    for (const d of live.docs) slugs.set(`${k}:${d.get('liveSlug') as string}`, d.id);
  }
  for (const { id: itemId, doc } of items.slice(0, 100)) {
    if (!canPublish(r, doc.kind, doc, itemId)) continue;
    if (doc.kind === 'post' || doc.kind === 'branch') {
      const key = `${doc.kind}:${String(doc.draft.slug)}`;
      const holder = slugs.get(key);
      if (!doc.draft.hidden && holder && holder !== itemId) {
        blocked.push({ kind: doc.kind, id: itemId, title: nameOf(doc.kind, doc), reason: 'Its address is used by another item.' });
        continue;
      }
      if (!doc.draft.hidden) slugs.set(key, itemId);
    }
    const result = publishInTx(tx, doc.kind, itemId, doc, by);
    if (result !== 'none') done.push({ kind: doc.kind, id: itemId, result });
  }
  if (done.length) {
    recordAudit(tx, { actorUid: actor.uid, actorEmail: actor.email, requestId }, auditOrg(r, null), {
      action: 'site.publishAll',
      entityType: 'site',
      entityId: 'website',
      after: { items: done.length },
    });
  }
  return { published: done, blocked };
});

/** Largest picture accepted; the console shrinks photos before sending. */
export const MAX_IMAGE_BYTES = 2_000_000;

/**
 * Stores a picture for the website (base64 JPEG/PNG/WebP) and returns its public address. Idempotent: a retry of the
 * same request writes the same file. Pictures are public once the item using them is published (the address is
 * unguessable until then).
 */
export const uploadImage = query(
  'site-uploadImage',
  z.strictObject({ image: z.string().max(Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 4), requestId: requestIdSchema }),
  async ({ actor, input }) => {
    const r = await rightsOf(actor);
    if (!r.manager && !canWrite(r)) throw errors.forbidden();
    const bytes = Buffer.from(input.image, 'base64');
    const kindOf = IMAGE_TYPES.find((t) => t.matches(bytes));
    if (!kindOf) throw errors.invalid('The picture must be a JPEG, PNG or WebP image.');
    if (bytes.length > MAX_IMAGE_BYTES) throw errors.invalid('The picture is too large (2 MB at most).');
    const b = bucket();
    const path = `site/${todayInIndia().slice(0, 7)}/${input.requestId}.${kindOf.ext}`;
    const token = input.requestId;
    await b.file(path).save(bytes, {
      resumable: false,
      contentType: kindOf.type,
      metadata: { cacheControl: 'public, max-age=31536000, immutable', metadata: { firebaseStorageDownloadTokens: token, uploadedBy: actor.uid } },
    });
    return { url: downloadUrl(b.name, path, token) };
  },
);

export const routes = {
  'site-overview': overview,
  'site-list': list,
  'site-get': get,
  'site-save': save,
  'site-publish': publish,
  'site-unpublish': unpublish,
  'site-discard': discard,
  'site-delete': remove,
  'site-requestReview': requestReview,
  'site-publishAll': publishAll,
  'site-uploadImage': uploadImage,
};
