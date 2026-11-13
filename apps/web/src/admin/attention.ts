// What waits for the person signed in, by menu page (as in LITMUS): the menu shows a count beside each page and, on a
// closed group, the group's total; the browser tab shows the overall total. The same checks as the Dashboard's
// "Needs your attention" list, and where both read the same thing they share the read (`waiting` below), so the two
// agree. The self-onboarding count is not read here: it comes from the shell's one shared read (OnboardingProvider).
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router';

import { useAuth } from '../auth/AuthContext';
import { branchScope, can, type StoriesClaims } from '../auth/claims';
import { monthLock, pendingCorrections, previousMonth } from '../data/attendance';
import { waitingCounts } from '../data/circulation';
import type { Scope } from '../data/common';
import { deliveryCounts, type DeliverySettings } from '../data/delivery';
import { documentQueueCounts } from '../data/hrDocuments';
import { unshelvedCount } from '../data/inventory';
import { type LeaveType, listLeaveTypes, pendingLeave } from '../data/leave';
import { renewalsDueCount } from '../data/members';
import type { Branch } from '../data/org';
import { submittedRuns } from '../data/payroll';
import { draftTemplateCount, hasHolidays, payrollOnBuiltInValues } from '../data/setupCounts';
import { sharedLoad } from '../data/shared';
import { invalidateSiteOverview, onSiteOverviewChange, type Overview, siteOverview } from '../data/site';
import { loadOverview, type MessageEvent, templateActions } from '../data/whatsapp';
import { paths } from '../paths';
import { monthIST, todayIST } from '../shared/dates';
import { MENU, isGroup, navItemFor } from './nav';
import { useMyOnboarding } from './people/OnboardingReminder';
import { useWorkspace } from './Workspace';

/** Menu page address → how many things wait there for this person. */
export type Attention = Record<string, number>;

/**
 * What needs someone to act under Master control (null: not loaded, or not this person's to do). A count shows
 * only where something there is missing or broken, never as a reminder of a choice that is fine as it is.
 */
export interface SetupWaiting {
  /** Shifts & holidays: the years whose holidays are due but not entered (this year; from December also the next). */
  holidayYears?: string[] | null;
  /** Leave types: none is active, so nobody can apply for leave. */
  noLeaveType?: boolean | null;
  /** Letter templates: how many were never published. */
  letterDrafts?: number | null;
  /** Payroll settings: never saved although salaries exist, so payroll would run on the built-in values. */
  payrollUnconfirmed?: boolean | null;
  /** WhatsApp at the chosen branch: notifications Meta turned down, and ones switched on but never sent to Meta. */
  whatsapp?: number | null;
  /** Delivery at the chosen branch: courier apps still on their test account while home delivery is on. */
  courierTests?: number | null;
  /** Connections: nobody is on the enquiry alerts list. */
  noAlertRecipients?: boolean | null;
}

/** What the loaders found (null: not loaded or not this person's to do). */
export interface AttentionData {
  branch?: { inspection: number; incoming: number; approvals: number } | null;
  unshelved?: number | null;
  deliveries?: { requested: number; returning: number } | null;
  renewalsDue?: number | null;
  docs?: { pending: number; expired: number } | null;
  corrections?: number | null;
  unfinalized?: boolean | null;
  leave?: number | null;
  payroll?: number | null;
  website?: { publishable: number; reviews: number; newSubmissions: number | null } | null;
  onboardingMissing?: number | null;
  setup?: SetupWaiting | null;
}

/** The counts by menu page (pages with nothing waiting are left out). */
export function attentionFrom(d: AttentionData): Attention {
  const out: Attention = {};
  const add = (to: string, n: number | null | undefined) => {
    if (n && n > 0) out[to] = (out[to] ?? 0) + n;
  };
  add(paths.adminDesk, d.branch?.inspection);
  add(paths.adminShelve, d.unshelved);
  add(paths.adminTransfers, d.branch?.incoming);
  add(paths.opsDeliveries, (d.deliveries?.requested ?? 0) + (d.deliveries?.returning ?? 0));
  add(paths.adminDeposits, d.branch?.approvals);
  add(paths.adminMembers, d.renewalsDue);
  add(paths.adminDocuments, (d.docs?.pending ?? 0) + (d.docs?.expired ?? 0));
  add(paths.adminAttendance, (d.corrections ?? 0) + (d.unfinalized ? 1 : 0));
  add(paths.adminLeave, d.leave);
  add(paths.adminPayroll, d.payroll);
  add(paths.adminWebsite, d.website?.publishable);
  add(paths.adminWebsiteBlog, d.website?.reviews);
  add(paths.adminWebsiteSubmissions, d.website?.newSubmissions);
  add(paths.adminMyOnboarding, d.onboardingMissing);
  const s = d.setup;
  add(paths.adminSettingsSchedule, s?.holidayYears?.length);
  add(paths.adminSettingsLeave, s?.noLeaveType ? 1 : 0);
  add(paths.adminSettingsLetters, s?.letterDrafts);
  add(paths.adminSettingsPayroll, s?.payrollUnconfirmed ? 1 : 0);
  add(paths.adminSettingsWhatsApp, s?.whatsapp);
  add(paths.adminSettingsDelivery, s?.courierTests);
  add(paths.adminWebsiteConnections, s?.noAlertRecipients ? 1 : 0);
  return out;
}

// ---------------------------------------------------------------- the rules, as small pure functions

/**
 * Whether the Website counts are worth asking for. They can only be above zero for someone who manages the
 * website or a branch's pages in some organization (the server looks across all of them); a person who only
 * writes blog posts would get zeros, so the menu doesn't ask for them.
 */
export function countsWebsite(claims: StoriesClaims, orgId: string | null): boolean {
  const here = can(claims, 'website.manage', orgId) || can(claims, 'website.branch', orgId) || can(claims, 'blog.write', orgId);
  return here && (claims.sa || Object.keys(claims.o).some((o) => can(claims, 'website.manage', o) || can(claims, 'website.branch', o)));
}

/** The years whose holidays should be entered by `today` (a date in India): this year, and from December the next. */
export function holidayYearsDue(today: string): string[] {
  const year = Number(today.slice(0, 4));
  return today.slice(5, 7) === '12' ? [String(year), String(year + 1)] : [String(year)];
}

/** No leave type is active (the built-in ones count until they are archived). */
export const noActiveLeaveType = (types: Pick<LeaveType, 'status'>[]) => !types.some((t) => t.status === 'ACTIVE');

/**
 * A branch's WhatsApp notifications that need someone: the ones it added that Meta rejected, paused or disabled
 * and, only while WhatsApp is switched on for the branch, the ones switched on that were never sent to Meta
 * (every such message fails). Each notification counts once. One waiting for Meta's review is Meta's turn.
 */
export function whatsappWaiting(events: MessageEvent[], switchedOn: boolean): number {
  const { toFix, toSubmit } = templateActions(events);
  return toFix.length + (switchedOn ? toSubmit.filter((e) => e.template.enabled).length : 0);
}

/** Courier apps switched on but still on their test account, while the branch offers home delivery. */
export function courierTestsWaiting(delivery: Pick<DeliverySettings, 'enabled' | 'couriers'> | undefined): number {
  if (!delivery?.enabled) return 0;
  return Object.values(delivery.couriers ?? {}).filter((c) => c?.enabled && c.environment === 'TEST').length;
}

/** Nobody gets the bell and WhatsApp notice for a new enquiry (website managers only; the enquiry itself is not lost). */
export const noAlertRecipients = (overview: Pick<Overview, 'rights' | 'counts'>) => overview.rights.manager && overview.counts.alertRecipients === 0;

// ---------------------------------------------------------------- reads shared with the Dashboard

/** How long an answer serves both the menu and the Dashboard: long enough for one page load, no longer. */
const HOLD_MS = 5_000;
const keyOf = (...parts: (string | boolean | Scope)[]) => parts.map((p) => (Array.isArray(p) ? p.join(',') : String(p))).join('|');
const shared = <T,>(key: string, load: () => Promise<T>) => sharedLoad(key, load, HOLD_MS);

/**
 * The reads the menu and the Dashboard both make, each asked once when both ask together (data/shared.ts). `uid`
 * is in every key so a second person on the same browser never gets the first one's answer; the answers are
 * shared, so nobody changes them in place.
 */
export const waiting = {
  branch: (uid: string, o: string, b: string, canDeposits: boolean, scope: Scope) =>
    shared(keyOf('waiting.branch', uid, o, b, canDeposits, scope), () => waitingCounts(o, b, canDeposits, scope)),
  unshelved: (uid: string, o: string, b: string) => shared(keyOf('waiting.unshelved', uid, o, b), () => unshelvedCount(o, b)),
  deliveries: (uid: string, o: string, b: string) => shared(keyOf('waiting.deliveries', uid, o, b), () => deliveryCounts(o, b)),
  corrections: (uid: string, o: string, scope: Scope) => shared(keyOf('waiting.corrections', uid, o, scope), () => pendingCorrections(o, scope)),
  lock: (uid: string, o: string, month: string, b: string) => shared(keyOf('waiting.lock', uid, o, month, b), () => monthLock(o, month, b)),
  leave: (uid: string, o: string, scope: Scope) => shared(keyOf('waiting.leave', uid, o, scope), () => pendingLeave(o, scope)),
  payroll: (uid: string, o: string, scope: Scope) => shared(keyOf('waiting.payroll', uid, o, scope), () => submittedRuns(o, scope)),
};

const settled = async <T,>(p: Promise<T> | null): Promise<T | null> => {
  try {
    return await p;
  } catch {
    return null; // A count that can't load just doesn't show; the page itself will say what's wrong.
  }
};

/**
 * The Master control counts that need a read: about four small ones for someone who sets up HR and payroll, and
 * one server call for WhatsApp, asked only when the branch is connected. Each is asked only of people who see
 * its menu item, and one that fails shows no count.
 */
async function loadSetup(claims: StoriesClaims, o: string, branch: Branch | null): Promise<SetupWaiting> {
  const may = (p: Parameters<typeof can>[1], branchId?: string) => can(claims, p, o, branchId);
  const hr = may('hr.config');
  const years = holidayYearsDue(todayIST());
  const [holidayYears, noLeaveType, letterDrafts, payrollUnconfirmed, whatsapp] = await Promise.all([
    hr ? settled(Promise.all(years.map((y) => hasHolidays(o, y))).then((has) => years.filter((_, i) => !has[i]))) : null,
    hr ? settled(listLeaveTypes(o).then(noActiveLeaveType)) : null,
    hr ? settled(draftTemplateCount(o)) : null,
    may('salary.edit') ? settled(payrollOnBuiltInValues(o)) : null,
    branch?.whatsapp?.phoneNumberId && may('messaging.manage', branch.id)
      ? settled(loadOverview(o, branch.id).then((v) => whatsappWaiting(v.events, !!v.settings?.enabled)))
      : null,
  ]);
  return { holidayYears, noLeaveType, letterDrafts, payrollUnconfirmed, whatsapp };
}

/** What the Website overview adds: its three counts and, for those who see Connections, the missing alerts list. */
const websitePart = (v: Overview | null, connections: boolean): Partial<AttentionData> => ({
  website: v ? { publishable: v.pending.filter((p) => p.canPublish).length, reviews: v.reviews.length, newSubmissions: v.counts.newSubmissions } : null,
  setup: { noAlertRecipients: v && connections ? noAlertRecipients(v) : null },
});

const SETUP_PAGES = new Set(MENU.flatMap((e) => (isGroup(e) && e.id === 'settings' ? e.items.map((i) => i.to) : [])));
/** The Master control page an address belongs to, if any. */
const setupPageOf = (pathname: string) => {
  const to = navItemFor(pathname)?.to;
  return to && SETUP_PAGES.has(to) ? to : null;
};

/** Moving between pages counts again at most this often. */
export const REFRESH_MS = 30_000;
/** With the tab in view, a count is at most this old. */
export const TICK_MS = 120_000;
/** With the tab out of view the counts slow down but don't stop: the total is in the tab's title, read from afar. */
export const HIDDEN_MS = 10 * 60_000;
/** The Master control counts change rarely: they are read again at most this often (and on leaving one of its pages). */
export const SETUP_MS = 10 * 60_000;

const NOTHING: AttentionData = {};

export interface AttentionState {
  counts: Attention;
  total: number;
  /** What waits under Master control, for the Dashboard's list; null until it has loaded for this organization and branch. */
  setup: SetupWaiting | null;
}

/**
 * Loads what waits for this person. The everyday counts refresh on moving between pages (at most every 30
 * seconds), every 2 minutes while the tab is in view and every 10 minutes while it is not, and straight away when
 * it comes back into view. The Master control counts have their own slow cycle: a new organization or branch,
 * leaving one of the Master control pages (so a fix shows at once), and otherwise at most every 10 minutes.
 * Nothing starts until the organization's branches are known, so there is one run at the start, not two.
 */
export function useAttention(): AttentionState {
  const { claims, user } = useAuth();
  const { org, branch, orgsLoading, branchesLoading } = useWorkspace();
  const { pathname } = useLocation();
  const onboarding = useMyOnboarding();
  const [loaded, setLoaded] = useState<AttentionData>(NOTHING);
  const [slow, setSlow] = useState<SetupWaiting | null>(null);
  const [tick, setTick] = useState(0);
  // When each cycle last started, and which run of it is the current one: a run is replaced only by a newer run or
  // a new organization or branch, never by a mere move to another page (its answer would be lost, with nothing
  // replacing it until the next refresh).
  const last = useRef(0);
  const run = useRef(0);
  const slowLast = useRef(0);
  const slowRun = useRef(0);
  const setupPage = useRef<string | null>(null);
  const siteVersion = useRef(0);
  const now = useRef({ claims, org, user });
  now.current = { claims, org, user };
  const ready = !orgsLoading && !branchesLoading;

  useEffect(() => {
    const again = () => setTick((n) => n + 1);
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible' || Date.now() - last.current >= HIDDEN_MS - 5_000) again();
    }, TICK_MS);
    // Back in view: count again (the 30-second rule below still applies).
    const onVisible = () => {
      if (document.visibilityState === 'visible') again();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  // A new organization or branch: forget the old counts and count afresh straight away. (Declared before the
  // effects that load, so it has run by the time they look at `last`.)
  useEffect(() => {
    last.current = 0;
    slowLast.current = 0;
    run.current += 1;
    slowRun.current += 1;
    setLoaded(NOTHING);
    setSlow(null);
  }, [org?.id, branch?.id]);

  // Something in the Website section was saved, published or followed up: read its counts again, and only those.
  useEffect(
    () =>
      onSiteOverviewChange(() => {
        const { claims, org, user } = now.current;
        if (!org || !user || !countsWebsite(claims, org.id)) return;
        const version = ++siteVersion.current;
        const o = org.id;
        void settled(siteOverview(user.uid)).then((v) => {
          if (version === siteVersion.current && now.current.org?.id === o) setLoaded((d) => ({ ...d, ...websitePart(v, can(claims, 'website.manage', o)) }));
        });
      }),
    [],
  );

  useEffect(() => {
    if (!ready || !org || !user) return;
    if (Date.now() - last.current < REFRESH_MS) return;
    last.current = Date.now();
    const id = ++run.current;
    const o = org.id;
    const b = branch?.id;
    const uid = user.uid;
    const scope = branchScope(claims, o);
    const may = (p: Parameters<typeof can>[1], branchId?: string) => can(claims, p, o, branchId);
    const desk = !!b && may('members.view', b);
    // Each count shows as soon as its own read answers, so a slow one (a server call) doesn't hold the rest back.
    const show = <T,>(read: Promise<T> | null, part: (v: T | null) => Partial<AttentionData>) =>
      void settled(read).then((v) => {
        if (id === run.current) setLoaded((d) => ({ ...d, ...part(v) }));
      });
    show(desk && b ? waiting.branch(uid, o, b, may('deposits.approve'), scope) : null, (v) => ({ branch: v }));
    show(b && may('copies.manage', b) ? waiting.unshelved(uid, o, b) : null, (v) => ({ unshelved: v }));
    show(b && may('delivery.manage', b) ? waiting.deliveries(uid, o, b) : null, (v) => ({ deliveries: v }));
    show(desk && b ? renewalsDueCount(o, b) : null, (v) => ({ renewalsDue: v }));
    show(may('documents.verify') ? documentQueueCounts(o, scope) : null, (v) => ({ docs: v }));
    show(may('corrections.approve') ? waiting.corrections(uid, o, scope) : null, (v) => ({ corrections: v ? v.filter((c) => c.employeeUid !== uid).length : null }));
    // The month's lock is wrapped so that "no lock yet" (not finalized) and "couldn't read it" (no count) differ.
    show(b && may('attendance.finalize', b) ? waiting.lock(uid, o, previousMonth(monthIST()), b).then((lock) => ({ lock })) : null, (v) => ({
      unfinalized: v ? v.lock?.status !== 'FINALIZED' : null,
    }));
    show(may('leave.approve') ? waiting.leave(uid, o, scope) : null, (v) => ({ leave: v ? v.filter((r) => r.employeeUid !== uid).length : null }));
    show(may('payroll.approve') ? waiting.payroll(uid, o, scope) : null, (v) => ({
      payroll: v ? v.filter((r) => r.preparedBy !== uid && r.submittedBy !== uid).length : null,
    }));
    // The Website overview is one read per person for 30 seconds, shared with the Publish button and the Website
    // dashboard (data/site.ts). An answer from before a change there never replaces the one read after it.
    const version = siteVersion.current;
    show(countsWebsite(claims, o) ? siteOverview(uid) : null, (v) => (version === siteVersion.current ? websitePart(v, may('website.manage')) : {}));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, org?.id, branch?.id, user?.uid, pathname, tick]);

  // The Master control counts, on their own slow cycle.
  useEffect(() => {
    const was = setupPage.current;
    const here = setupPageOf(pathname);
    setupPage.current = here;
    if (!ready || !org || !user) return;
    const left = was !== null && was !== here;
    if (!left && Date.now() - slowLast.current < SETUP_MS) return;
    slowLast.current = Date.now();
    // The alerts list is saved on Connections without telling the overview, so leaving that page asks it again.
    if (left && was === paths.adminWebsiteConnections) invalidateSiteOverview();
    const id = ++slowRun.current;
    void loadSetup(claims, org.id, branch).then((s) => {
      if (id === slowRun.current) setSlow(s);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, org?.id, branch?.id, user?.uid, pathname, tick]);

  // The self-onboarding count and the courier check need no read here: the first is the shell's shared answer,
  // the second is on the branch document the workspace already holds.
  const missing = onboarding.data?.missing.length ?? null;
  const courierTests = org && branch && can(claims, 'delivery.configure', org.id, branch.id) ? courierTestsWaiting(branch.delivery) : null;
  return useMemo(() => {
    const setup = { ...slow, ...loaded.setup, courierTests };
    const counts = attentionFrom({ ...loaded, onboardingMissing: missing, setup });
    return { counts, total: Object.values(counts).reduce((a, n) => a + n, 0), setup: slow ? setup : null };
  }, [loaded, slow, missing, courierTests]);
}

const AttentionContext = createContext<AttentionState>({ counts: {}, total: 0, setup: {} });
/** The shell hands what it loaded to the pages (the Dashboard lists the Master control items from it). */
export const AttentionProvider = AttentionContext.Provider;
/** What the menu shows as waiting, as loaded by the shell. */
export const useWaiting = () => useContext(AttentionContext);
