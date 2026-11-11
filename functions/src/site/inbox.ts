// What visitors send from the website (as on crossmaze.in): enquiry forms (/api/submit) and taps on call and
// WhatsApp buttons (/api/tap), both public POSTs to the sitePublic function; and the console's Submissions,
// Calls, Connections and Admins pages (site-* actions).
import { createHash } from 'node:crypto';

import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import type { Request } from 'firebase-functions/v2/https';
import { z } from 'zod';

import { recordAudit } from '../core/audit.js';
import { command, query } from '../core/callable.js';
import { errors } from '../core/errors.js';
import { auth, db } from '../core/firebase.js';
import { notify } from '../core/notify.js';
import { coversBranch, holds, type Membership } from '../core/rbac.js';
import { id } from '../core/schemas.js';
import { bucket } from '../catalogue/covers.js';
import { ROLES } from '../generated/rbac.js';
import { canEditBranch, rightsOf } from './admin.js';

// ------------------------------------------------------------------ public: forms

export const FORMS = ['MEMBERSHIP', 'FRANCHISE', 'JOB', 'CONTACT'] as const;
export type Form = (typeof FORMS)[number];
export const FORM_LABEL: Record<Form, string> = { MEMBERSHIP: 'Membership enquiry', FRANCHISE: 'Franchise enquiry', JOB: 'Job application', CONTACT: 'Message' };

const line = (max: number) => z.string().trim().max(max).default('');
export const submission = z.strictObject({
  form: z.enum(FORMS),
  name: z.string().trim().min(2, 'Please tell us your name.').max(80),
  phone: z.string().trim().regex(/^\+?[0-9 ()-]{10,18}$/, 'Please give a phone number we can call.'),
  email: z.union([z.literal(''), z.email('Please check the email address.').max(120)]).default(''),
  message: line(2000),
  /** Membership: which branch; Job: the job. */
  branchId: z.union([z.literal(''), id]).default(''),
  jobId: z.union([z.literal(''), id]).default(''),
  /** Franchise: the city or area; Membership: who it is for (Children/Teens/Adults/Family). */
  city: line(80),
  readers: line(40),
  /** Job applications: years of experience. */
  experience: line(60),
  page: z.string().max(200).regex(/^\/[^\s]*$/).or(z.literal('')).default(''),
  /** A field people can't see: robots fill it in. */
  website: z.string().max(200).default(''),
  /** Job applications: a CV (PDF or Word), base64. */
  resume: z.strictObject({ name: z.string().trim().max(120), data: z.string().max(Math.ceil((2_000_000 * 4) / 3) + 4) }).nullable().default(null),
});

const RESUME_TYPES = [
  { ext: 'pdf', type: 'application/pdf', matches: (b: Buffer) => b.subarray(0, 4).toString('latin1') === '%PDF' },
  { ext: 'docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', matches: (b: Buffer) => b[0] === 0x50 && b[1] === 0x4b },
  { ext: 'doc', type: 'application/msword', matches: (b: Buffer) => b.subarray(0, 4).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0])) },
];

/** The visitor's address, hashed with the day so nothing that identifies them is kept. */
function visitorKey(req: Pick<Request, 'headers' | 'ip'>, scope: string) {
  const ip = String(req.headers['x-forwarded-for'] ?? req.ip ?? 'unknown').split(',')[0].trim();
  return createHash('sha256').update(`${scope}|${ip}|${new Date().toISOString().slice(0, 10)}`).digest('hex').slice(0, 40);
}

/** At most `max` per visitor per hour. */
async function withinLimit(key: string, max: number) {
  const ref = db.doc(`siteRate/${key}`);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const now = Date.now();
    const start = (snap.get('start') as number | undefined) ?? 0;
    const count = now - start > 3_600_000 ? 0 : ((snap.get('count') as number | undefined) ?? 0);
    if (count >= max) return false;
    tx.set(ref, { start: count === 0 ? now : start, count: count + 1, expireAt: Timestamp.fromMillis(now + 2 * 86_400_000) });
    return true;
  });
}

type Res = { status: (n: number) => Res; set: (k: string, v: string) => Res; json: (b: unknown) => void; send: (b?: unknown) => void };

const parseBody = (req: Request) => {
  const b = req.body as unknown;
  if (typeof b === 'string') return JSON.parse(b) as unknown;
  if (Buffer.isBuffer(b)) return JSON.parse(b.toString('utf8')) as unknown;
  return b;
};

/** POST /api/submit: an enquiry from a website form. Saved first, so nothing is lost; then the alerts go out. */
export async function handleSubmit(req: Request, res: Res) {
  let body: z.infer<typeof submission>;
  try {
    const parsed = submission.safeParse(parseBody(req));
    if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.issues[0]?.message ?? 'Please check the form.' });
    body = parsed.data;
  } catch {
    return res.status(400).json({ ok: false, error: 'Please check the form.' });
  }
  // A robot filled in the hidden field: thank it and keep nothing.
  if (body.website) return res.status(200).json({ ok: true });
  if (!(await withinLimit(visitorKey(req, 'submit'), 8))) return res.status(429).json({ ok: false, error: 'Too many messages from here. Please call us instead.' });

  const ref = db.collection('siteSubmissions').doc();
  let resume: { path: string; name: string; type: string } | null = null;
  if (body.form === 'JOB' && body.resume) {
    const bytes = Buffer.from(body.resume.data, 'base64');
    const kind = RESUME_TYPES.find((t) => t.matches(bytes));
    if (!kind || bytes.length > 2_000_000) return res.status(400).json({ ok: false, error: 'Please attach your CV as a PDF or Word file of 2 MB at most.' });
    const path = `submissions/${ref.id}/resume.${kind.ext}`;
    await bucket().file(path).save(bytes, { resumable: false, contentType: kind.type });
    resume = { path, name: body.resume.name || `resume.${kind.ext}`, type: kind.type };
  }
  const [branch, job] = await Promise.all([
    body.branchId ? findBranch(body.branchId) : Promise.resolve(null),
    body.jobId ? db.doc(`siteJobs/${body.jobId}`).get() : Promise.resolve(null),
  ]);
  const record = {
    form: body.form,
    name: body.name,
    phone: body.phone,
    email: body.email,
    message: body.message,
    city: body.city,
    readers: body.readers,
    experience: body.experience,
    branchId: branch?.id ?? null,
    branchName: branch?.name ?? null,
    orgId: branch?.orgId ?? null,
    jobId: job?.exists ? job.id : null,
    jobTitle: job?.exists ? ((job.get('live.title') as string | undefined) ?? (job.get('draft.title') as string | undefined) ?? null) : null,
    page: body.page,
    resume,
    handled: false,
    createdAt: FieldValue.serverTimestamp(),
  };
  await ref.create(record);
  await alert(ref.id, record).catch((e: unknown) => logger.warn('site: enquiry alert failed', { id: ref.id, error: e instanceof Error ? e.message : String(e) }));
  return res.status(200).json({ ok: true });
}

async function findBranch(branchId: string) {
  const orgs = await db.collection('orgs').where('status', '==', 'ACTIVE').get();
  for (const o of orgs.docs) {
    const b = await db.doc(`orgs/${o.id}/branches/${branchId}`).get();
    if (b.exists && b.get('status') === 'ACTIVE') return { id: b.id, orgId: o.id, name: String(b.get('name') ?? '') };
  }
  return null;
}

/** Tells the people on Connections → Enquiry alerts (and the branch's managers, for a branch's enquiry). */
async function alert(submissionId: string, s: { form: Form; name: string; branchId: string | null; orgId: string | null; branchName: string | null; jobTitle: string | null }) {
  const conn = await db.doc('siteContent/connections').get();
  const people = (conn.get('alerts') as { uid: string; orgId: string }[] | undefined) ?? [];
  const recipients = new Map(people.map((p) => [p.uid, p.orgId]));
  if (s.branchId && s.orgId && conn.get('alertBranchManagers') !== false) {
    const managers = await db.collectionGroup('memberships').where('orgId', '==', s.orgId).where('status', '==', 'ACTIVE').get();
    for (const m of managers.docs) {
      // Those who look after the branch's website page (Branch Owners, Senior Librarians, roles of their own with it).
      if (holds(m.data() as Membership, 'website.branch') && coversBranch((m.get('branchIds') as string[]) ?? [], s.branchId)) recipients.set(m.get('uid') as string, s.orgId);
    }
  }
  if (!recipients.size) return;
  const batch = db.batch();
  const what = s.form === 'JOB' && s.jobTitle ? `Job application: ${s.jobTitle}` : FORM_LABEL[s.form];
  for (const [uid, orgId] of recipients) {
    notify(batch, uid, { orgId, kind: 'site.submission', title: `${what} from ${s.name}`, body: s.branchName ? `For ${s.branchName}` : 'From the website', link: `/website/submissions/${submissionId}` });
  }
  await batch.commit();
}

// ------------------------------------------------------------------ public: taps on call and WhatsApp buttons

const tap = z.object({
  channel: z.enum(['phone', 'whatsapp']),
  number: z.string().transform((v) => v.replace(/\D/g, '')).pipe(z.string().min(6).max(15)),
  branch: z.string().max(80).default(''),
  page: z.string().max(200).regex(/^\/[^\s]*$/).or(z.literal('')).default(''),
  place: z.string().max(120).default(''),
  source: z.string().max(120).default(''),
  visit: z.string().regex(/^[a-z0-9]{6,32}$/i).or(z.literal('')).default(''),
  device: z.enum(['Phone', 'Tablet', 'Computer', '']).default(''),
});

/** POST /api/tap: someone tapped a call or WhatsApp button (nothing that identifies them is kept). */
export async function handleTap(req: Request, res: Res) {
  let body: unknown;
  try {
    body = parseBody(req);
  } catch {
    return res.status(204).send();
  }
  const parsed = tap.safeParse(body);
  if (!parsed.success) return res.status(204).send();
  if (!(await withinLimit(visitorKey(req, 'tap'), 60))) return res.status(204).send();
  await db.collection('siteCalls').add({ ...parsed.data, createdAt: FieldValue.serverTimestamp(), expireAt: Timestamp.fromMillis(Date.now() + 400 * 86_400_000) });
  return res.status(204).send();
}

// ------------------------------------------------------------------ console: submissions

const iso = (t: Timestamp | null | undefined) => (t ? t.toDate().toISOString() : null);

async function submissionRights(uid: string, actor: Parameters<typeof rightsOf>[0]) {
  const r = await rightsOf(actor);
  const branchRoles = r.memberships.filter((m) => holds(m, 'website.branch'));
  if (!r.manager && !branchRoles.length) throw errors.forbidden();
  return { r, sees: (s: { orgId?: string | null; branchId?: string | null }) => !!r.manager || (!!s.orgId && !!s.branchId && canEditBranch(r, s.orgId, s.branchId)), uid };
}

/** Enquiries, newest first: website managers see all, branch managers their branches'. */
export const submissions = query('site-submissions', z.strictObject({ limit: z.number().int().min(1).max(2000).default(500) }), async ({ actor, input }) => {
  const { sees } = await submissionRights(actor.uid, actor);
  const snap = await db.collection('siteSubmissions').orderBy('createdAt', 'desc').limit(input.limit).get();
  return {
    items: snap.docs
      .map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) }) as Record<string, unknown> & { id: string })
      .filter((s) => sees(s as { orgId?: string; branchId?: string }))
      .map((s) => ({ ...s, createdAt: iso(s.createdAt as Timestamp), handledAt: iso(s.handledAt as Timestamp | undefined), resume: s.resume ? { name: (s.resume as { name: string }).name } : null })),
  };
});

/** Marks an enquiry as followed up (or not). */
export const markHandled = command('site-markHandled', z.strictObject({ id, handled: z.boolean(), note: z.string().trim().max(500).default('') }), async ({ actor, input, requestId }, tx) => {
  const r = await rightsOf(actor, tx);
  const ref = db.doc(`siteSubmissions/${input.id}`);
  const snap = await tx.get(ref);
  if (!snap.exists) throw errors.notFound('Submission');
  const s = snap.data() as { orgId?: string; branchId?: string };
  if (!r.manager && !(s.orgId && s.branchId && canEditBranch(r, s.orgId, s.branchId))) throw errors.forbidden();
  tx.update(ref, { handled: input.handled, handledBy: input.handled ? { uid: actor.uid, name: actor.profile?.displayName || actor.email || 'Staff' } : null, handledAt: input.handled ? FieldValue.serverTimestamp() : null, note: input.note });
  recordAudit(tx, { actorUid: actor.uid, actorEmail: actor.email, requestId }, s.orgId ?? r.manager?.orgId ?? null, { action: `site.submission.${input.handled ? 'handled' : 'reopened'}`, entityType: 'siteSubmission', entityId: input.id, branchId: s.branchId ?? null });
  return { id: input.id };
});

/** Deletes an enquiry and its CV (website managers): for spam, or when someone asks to be forgotten. */
export const deleteSubmission = command('site-deleteSubmission', z.strictObject({ id }), async ({ actor, input, requestId }, tx) => {
  const r = await rightsOf(actor, tx);
  if (!r.manager) throw errors.forbidden();
  const ref = db.doc(`siteSubmissions/${input.id}`);
  const snap = await tx.get(ref);
  if (!snap.exists) return { id: input.id };
  tx.delete(ref);
  recordAudit(tx, { actorUid: actor.uid, actorEmail: actor.email, requestId }, r.manager.orgId, { action: 'site.submission.delete', entityType: 'siteSubmission', entityId: input.id });
  return { id: input.id, resumePath: (snap.get('resume.path') as string | undefined) ?? null };
}, async (result) => {
  if (result.resumePath) await bucket().file(result.resumePath).delete({ ignoreNotFound: true });
});

/** An applicant's CV, for those who may see the application (sent as data; CVs are never public). */
export const resumeFile = query('site-resume', z.strictObject({ id }), async ({ actor, input }) => {
  const { sees } = await submissionRights(actor.uid, actor);
  const snap = await db.doc(`siteSubmissions/${input.id}`).get();
  const s = snap.data() as { orgId?: string; branchId?: string; resume?: { path: string; name: string; type: string } } | undefined;
  if (!s || !sees(s)) throw errors.notFound('Submission');
  if (!s.resume) throw errors.notFound('CV');
  const [bytes] = await bucket().file(s.resume.path).download();
  return { name: s.resume.name, type: s.resume.type, data: bytes.toString('base64') };
});

// ------------------------------------------------------------------ console: calls

/** Taps on call and WhatsApp buttons in the last 7, 30 or 90 days (website managers). */
export const calls = query('site-calls', z.strictObject({ days: z.union([z.literal(7), z.literal(30), z.literal(90)]).default(7) }), async ({ actor, input }) => {
  const r = await rightsOf(actor);
  if (!r.manager) throw errors.forbidden();
  const since = Timestamp.fromMillis(Date.now() - input.days * 86_400_000);
  const snap = await db.collection('siteCalls').where('createdAt', '>=', since).orderBy('createdAt', 'desc').limit(5000).get();
  return { items: snap.docs.map((d) => ({ id: d.id, ...d.data(), createdAt: iso(d.get('createdAt') as Timestamp), expireAt: undefined })) };
});

// ------------------------------------------------------------------ console: connections

/** Outside services and who is told about new enquiries. */
export const connections = query('site-connections', z.strictObject({}), async ({ actor }) => {
  const r = await rightsOf(actor);
  if (!r.manager) throw errors.forbidden();
  const [conn, branches] = await Promise.all([
    db.doc('siteContent/connections').get(),
    db.collection('orgs').where('status', '==', 'ACTIVE').get().then((orgs) => Promise.all(orgs.docs.map((o) => db.collection(`orgs/${o.id}/branches`).where('status', '==', 'ACTIVE').get()))),
  ]);
  const all = branches.flatMap((s) => s.docs);
  // WhatsApp and online payments are set per branch (Admin → Settings → WhatsApp; Admin → Branches).
  const whatsapp = await Promise.all(all.map((b) => db.doc(`orgs/${b.get('orgId') as string}/branches/${b.id}/private/whatsapp`).get()));
  const payments = await Promise.all(all.map((b) => db.doc(`orgs/${b.get('orgId') as string}/branches/${b.id}/private/razorpay`).get()));
  return {
    alerts: ((conn.get('alerts') as { email: string }[] | undefined) ?? []).map((a) => a.email),
    alertBranchManagers: conn.get('alertBranchManagers') !== false,
    branches: all.map((b, i) => ({ id: b.id, name: String(b.get('name') ?? ''), whatsapp: whatsapp[i].exists && whatsapp[i].get('enabled') !== false, payments: payments[i].exists })),
  };
});

export const saveConnections = command(
  'site-saveConnections',
  z.strictObject({ alerts: z.array(z.email().transform((e) => e.toLowerCase())).max(10), alertBranchManagers: z.boolean() }),
  async ({ actor, input, requestId, prepared }, tx) => {
    const r = await rightsOf(actor, tx);
    if (!r.manager) throw errors.forbidden();
    const people = prepared as { email: string; uid: string }[];
    const orgId = r.manager.orgId ?? (await tx.get(db.collection('orgs').where('type', '==', 'CORPORATE').limit(1))).docs[0]?.id ?? null;
    tx.set(db.doc('siteContent/connections'), { kind: 'connections', alerts: people.map((p) => ({ ...p, orgId })), alertBranchManagers: input.alertBranchManagers, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    recordAudit(tx, { actorUid: actor.uid, actorEmail: actor.email, requestId }, orgId, { action: 'site.connections.save', entityType: 'site', entityId: 'connections', after: { alerts: input.alerts } });
    return { alerts: input.alerts };
  },
  null,
  {
    // Staff accounts by email (outside the transaction: it calls Firebase Auth).
    prepare: async ({ actor, input }) => {
      const r = await rightsOf(actor);
      if (!r.manager) throw errors.forbidden();
      return Promise.all(
        input.alerts.map(async (email) => {
          try {
            return { email, uid: (await auth.getUserByEmail(email)).uid };
          } catch {
            throw errors.conflict('USER_NOT_FOUND', `No Stories account uses ${email}. Ask them to sign in to the staff app once, then try again.`);
          }
        }),
      );
    },
  },
);

// ------------------------------------------------------------------ console: admins

/** Everyone who can change the website, and what they may do. */
export const admins = query('site-admins', z.strictObject({}), async ({ actor }) => {
  const r = await rightsOf(actor);
  if (!r.manager) throw errors.forbidden();
  const orgs = await db.collection('orgs').where('status', '==', 'ACTIVE').get();
  const [members, supers, branches] = await Promise.all([
    Promise.all(orgs.docs.map((o) => db.collectionGroup('memberships').where('orgId', '==', o.id).where('status', '==', 'ACTIVE').get())),
    db.collection('users').where('platformRoles', 'array-contains', 'SUPER_ADMIN').get(),
    Promise.all(orgs.docs.map((o) => db.collection(`orgs/${o.id}/branches`).get())),
  ]);
  const branchName = new Map(branches.flatMap((s) => s.docs).map((b) => [b.id, String(b.get('name') ?? '')]));
  const people = members
    .flatMap((s) => s.docs)
    .map((d) => d.data() as Membership)
    .filter((m) => holds(m, 'website.manage') || holds(m, 'website.branch') || holds(m, 'blog.write'))
    .map((m) => {
      const can = (p: Parameters<typeof holds>[1]) => holds(m, p);
      const level = m.orgType === 'CORPORATE' && can('website.manage') ? 'MANAGER' : can('website.branch') ? 'BRANCH' : 'WRITER';
      return {
        uid: m.uid,
        name: m.displayName ?? m.email ?? '',
        email: m.email ?? '',
        org: m.orgName,
        roles: [...m.roles.map((x) => ROLES[x]?.label ?? x), ...(m.customRoleNames ?? [])],
        level,
        branches: level === 'MANAGER' ? [] : m.branchIds.includes('*') ? ['All branches'] : m.branchIds.map((b) => branchName.get(b) ?? b),
      };
    });
  return {
    people: [
      ...supers.docs.map((u) => ({ uid: u.id, name: String(u.get('displayName') ?? u.get('email') ?? ''), email: String(u.get('email') ?? ''), org: 'Platform', roles: ['Super Admin'], level: 'MANAGER', branches: [] })),
      ...people,
    ].sort((a, b) => ['MANAGER', 'BRANCH', 'WRITER'].indexOf(a.level) - ['MANAGER', 'BRANCH', 'WRITER'].indexOf(b.level) || a.name.localeCompare(b.name)),
  };
});

/** For the dashboard and the menu: enquiries waiting (website managers: all; branch managers: their branches'), taps this week. */
export async function inboxCounts(r: Awaited<ReturnType<typeof rightsOf>>) {
  if (!r.manager) {
    const branchRoles = r.memberships.filter((m) => holds(m, 'website.branch'));
    if (!branchRoles.length) return { newSubmissions: null, callsThisWeek: null, openJobs: null };
    const open = await db.collection('siteSubmissions').where('handled', '==', false).limit(500).get();
    const mine = open.docs.filter((d) => {
      const s = d.data() as { orgId?: string; branchId?: string };
      return !!s.orgId && !!s.branchId && canEditBranch(r, s.orgId, s.branchId);
    });
    return { newSubmissions: mine.length, callsThisWeek: null, openJobs: null };
  }
  const [subs, taps, jobs] = await Promise.all([
    db.collection('siteSubmissions').where('handled', '==', false).count().get(),
    db.collection('siteCalls').where('createdAt', '>=', Timestamp.fromMillis(Date.now() - 7 * 86_400_000)).count().get(),
    db.collection('siteJobs').where('isLive', '==', true).count().get(),
  ]);
  return { newSubmissions: subs.data().count, callsThisWeek: taps.data().count, openJobs: jobs.data().count };
}

export const routes = {
  'site-submissions': submissions,
  'site-markHandled': markHandled,
  'site-deleteSubmission': deleteSubmission,
  'site-resume': resumeFile,
  'site-calls': calls,
  'site-connections': connections,
  'site-saveConnections': saveConnections,
  'site-admins': admins,
};
