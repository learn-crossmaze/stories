// What waits for the person signed in, by menu page (as in LITMUS): the menu shows a count beside each page and, on a
// closed group, the group's total; the browser tab shows the overall total. The same checks as the Dashboard's
// "Needs your attention" list, so the two always agree.
import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router';

import { useAuth } from '../auth/AuthContext';
import { branchScope, can } from '../auth/claims';
import { monthLock, pendingCorrections, previousMonth } from '../data/attendance';
import { branchCounts } from '../data/circulation';
import { listDeliveries } from '../data/delivery';
import { documentQueue, listDocumentTypes } from '../data/hrDocuments';
import { unshelvedCount } from '../data/inventory';
import { pendingLeave } from '../data/leave';
import { memberCounts } from '../data/members';
import { submittedRuns } from '../data/payroll';
import { siteOverview } from '../data/site';
import { myOnboarding } from '../data/selfOnboarding';
import { paths } from '../paths';
import { monthIST } from '../shared/dates';
import { useWorkspace } from './Workspace';

/** Menu page address → how many things wait there for this person. */
export type Attention = Record<string, number>;

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
  return out;
}

const settled = async <T,>(p: Promise<T>): Promise<T | null> => {
  try {
    return await p;
  } catch {
    return null; // A count that can't load just doesn't show; the page itself will say what's wrong.
  }
};

/** Loads what waits for this person; refreshes on moving between pages (at most every 30 seconds) and every 2 minutes. */
export function useAttention(): { counts: Attention; total: number } {
  const { claims, user } = useAuth();
  const { org, branch } = useWorkspace();
  const { pathname } = useLocation();
  const [counts, setCounts] = useState<Attention>({});
  const last = useRef(0);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setTick((n) => n + 1), 120_000);
    return () => clearInterval(timer);
  }, []);
  // A new organization or branch: count afresh straight away.
  useEffect(() => {
    last.current = 0;
  }, [org?.id, branch?.id]);

  useEffect(() => {
    if (!org || !user) return;
    if (Date.now() - last.current < 30_000) return;
    last.current = Date.now();
    let live = true;
    const o = org.id;
    const b = branch?.id;
    const scope = branchScope(claims, o);
    const may = (p: Parameters<typeof can>[1], branchId?: string) => can(claims, p, o, branchId);
    const desk = !!b && may('members.view', b);
    void (async () => {
      const [branchC, unshelved, deliveries, members, docs, corrections, lock, leave, runs, website, onboarding] = await Promise.all([
        desk && b ? settled(branchCounts(o, b, may('deposits.approve'), scope)) : null,
        b && may('copies.manage', b) ? settled(unshelvedCount(o, b)) : null,
        b && may('delivery.manage', b)
          ? settled(listDeliveries(o, b).then(({ open }) => ({ requested: open.filter((x) => x.status === 'REQUESTED').length, returning: open.filter((x) => x.status === 'RETURNING').length })))
          : null,
        desk && b ? settled(memberCounts(o, b)) : null,
        may('documents.verify') ? settled(listDocumentTypes(o).then((types) => documentQueue(o, scope, types))) : null,
        may('corrections.approve') ? settled(pendingCorrections(o, scope)) : null,
        b && may('attendance.finalize', b) ? settled(monthLock(o, previousMonth(monthIST()), b)) : null,
        may('leave.approve') ? settled(pendingLeave(o, scope)) : null,
        may('payroll.approve') ? settled(submittedRuns(o, scope)) : null,
        may('website.manage') || may('website.branch') || may('blog.write') ? settled(siteOverview()) : null,
        settled(myOnboarding(o, user.uid)),
      ]);
      if (!live) return;
      setCounts(
        attentionFrom({
          branch: branchC,
          unshelved: unshelved as number | null,
          deliveries,
          renewalsDue: (members as { DUE?: number } | null)?.DUE ?? null,
          docs: docs ? { pending: docs.pending.length, expired: docs.expired.length } : null,
          corrections: corrections?.filter((c) => c.employeeUid !== user.uid).length ?? null,
          unfinalized: b && may('attendance.finalize', b) ? lock?.status !== 'FINALIZED' : null,
          leave: leave?.filter((r) => r.employeeUid !== user.uid).length ?? null,
          payroll: runs?.filter((r) => r.preparedBy !== user.uid && r.submittedBy !== user.uid).length ?? null,
          website: website
            ? { publishable: website.pending.filter((p) => p.canPublish).length, reviews: website.reviews.length, newSubmissions: website.counts.newSubmissions }
            : null,
          onboardingMissing: onboarding?.missing.length ?? null,
        }),
      );
    })();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [org?.id, branch?.id, user?.uid, pathname, tick]);

  const total = Object.values(counts).reduce((a, n) => a + n, 0);
  return { counts, total };
}
