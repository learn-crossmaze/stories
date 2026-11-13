import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router';

import { useAuth } from '../../auth/AuthContext';
import { errorText } from '../../data/api';
import { onSiteOverviewChange, publishAll, SITE_URL, siteOverview, type Kind, type Pending } from '../../data/site';
import { paths } from '../../paths';
import { useAsync } from '../../shared/useAsync';
import { EmptyState, ErrorState, Icon, SkeletonRows, TableWrap } from '../../shared/ui';
import { st } from '../../strings/site';
import { savedLine, SiteStatusBadge } from './kit';

/** Where each kind of item is edited. */
export function editPath(kind: Kind, id: string, orgId?: string | null) {
  if (kind === 'post') return paths.adminWebsitePost(id);
  if (kind === 'job') return paths.adminWebsiteJob(id);
  if (kind === 'testimonial') return paths.adminWebsiteTestimonial(id);
  if (kind === 'sections') return paths.adminWebsiteSections;
  if (kind === 'promotion') return paths.adminWebsitePromotion(id);
  if (kind === 'branch') return orgId ? paths.adminWebsiteBranch(orgId, id) : paths.adminWebsiteBranches;
  if (kind === 'greetings') return paths.adminWebsiteCards;
  return paths.adminWebsiteSettings;
}

/**
 * The Website overview, from the read the menu, the top bar and the dashboard share (data/site.ts): one request
 * serves them all for 30 seconds, and it is read again as soon as anything in the Website section changes.
 * `deps`: when else to ask again (a fresh enough answer is reused, so asking is cheap).
 */
export function useSiteOverview(deps: unknown[]) {
  const { user } = useAuth();
  const uid = user?.uid;
  const data = useAsync(() => siteOverview(uid), [uid, ...deps]);
  const { reload } = data;
  useEffect(() => onSiteOverviewChange(reload), [reload]);
  return data;
}

/** Publishes every saved change the person may publish: the Dashboard's card and the top bar's button. */
export function usePublishAll() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const run = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const r = await publishAll();
      setMessage({ tone: r.blocked.length ? 'error' : 'ok', text: [st.publishedCount(r.published.length), ...r.blocked.map((b) => `${b.title}: ${b.reason}`)].join(' ') });
    } catch (e) {
      setMessage({ tone: 'error', text: errorText(e) });
    } finally {
      setBusy(false);
    }
  };
  return { busy, message, run };
}

/** The top bar's Publish button (as on crossmaze.in): how many saved changes wait, and publishing them all. */
export function PublishButton() {
  const { pathname } = useLocation();
  // Asked again on every page of the section, so other people's changes show too (within the shared read's 30 seconds).
  const data = useSiteOverview([pathname]);
  const waiting = (data.data?.pending ?? []).filter((p) => p.canPublish).length;
  const { busy, message, run } = usePublishAll();
  if (!data.data) return null;
  return (
    <div className="publish-top">
      <button type="button" className={`btn ${waiting ? 'btn-filled' : 'btn-outlined'}`} disabled={busy || !waiting} title={waiting ? st.waitingTitle(waiting) : st.nothingWaiting} onClick={() => void run()}>
        {busy ? st.publishingNow : waiting ? st.publishAll(waiting) : st.allPublished}
      </button>
      {message && <span className={`publish-top-message ${message.tone}`} role="status">{message.text}</span>}
    </div>
  );
}

/**
 * The Website view's Dashboard (as on crossmaze.in): publishing, new enquiries and taps on call buttons, links to
 * every page, then what waits to be published or reviewed and what was published lately.
 */
export function WebsiteOverviewPage() {
  const { user } = useAuth();
  const data = useSiteOverview([]);
  const publish = usePublishAll();
  const o = data.data;
  const m = !!o?.rights.manager;
  const branchy = !!o && (m || o.rights.branches.length > 0);
  const links = [
    { to: paths.adminWebsiteSettings, icon: 'tune' as const, label: st.navSettings, text: st.settingsIntro, show: m },
    { to: paths.adminWebsiteSections, icon: 'folder' as const, label: st.navSections, text: st.sectionsIntro, show: m },
    { to: paths.adminWebsiteBranches, icon: 'store' as const, label: st.navBranches, text: st.branchesIntro, show: branchy },
    { to: paths.adminWebsitePromotions, icon: 'bell' as const, label: st.navPromotions, text: st.promotionsIntro, show: m },
    { to: paths.adminWebsiteJobs, icon: 'badge' as const, label: st.navJobs, text: st.jobsIntro, show: m },
    { to: paths.adminWebsiteBlog, icon: 'book' as const, label: st.navBlog, text: st.blogIntro, show: !!o?.rights.canWrite },
    { to: paths.adminWebsiteCards, icon: 'palette' as const, label: st.navCards, text: st.cardsIntro, show: m },
    { to: paths.adminWebsiteTestimonials, icon: 'chat' as const, label: st.navTestimonials, text: st.testimonialsIntro, show: m },
    { to: paths.adminWebsiteSubmissions, icon: 'folder' as const, label: st.navSubmissions, text: st.submissionsIntro, show: branchy },
    { to: paths.adminWebsiteCalls, icon: 'insights' as const, label: st.navCalls, text: st.callsIntro, show: m },
  ];
  const mine = (o?.pending ?? []).filter((p) => p.canPublish);
  return (
    <>
      <header className="page-header page-header-row">
        <div>
          <h1>{st.navWebsiteHome}</h1>
          <p className="muted">{st.signedInAs(user?.email ?? '')}</p>
        </div>
        <a className="btn btn-outlined" href={SITE_URL} target="_blank" rel="noopener">
          <Icon name="explore" /> {st.openWebsite}
        </a>
      </header>
      {data.loading ? (
        <SkeletonRows />
      ) : data.error || !o ? (
        <ErrorState message={data.error ?? ''} onRetry={data.reload} />
      ) : (
        <>
          <ul className="site-sections stat-row">
            <li className="card stat publish-card">
              <strong>{mine.length}</strong>
              <span>{mine.length ? st.changesWaiting : st.nothingWaiting}</span>
              {mine.length > 0 && (
                <button type="button" className="btn btn-filled align-start" disabled={publish.busy} onClick={() => void publish.run()}>
                  {publish.busy ? st.publishingNow : st.publishAll(mine.length)}
                </button>
              )}
            </li>
            {o.counts.newSubmissions !== null && (
              <li>
                <Link className="card stat" to={paths.adminWebsiteSubmissions}>
                  <strong className={o.counts.newSubmissions ? 'warn' : ''}>{o.counts.newSubmissions}</strong>
                  <span>{st.newSubmissionsStat}</span>
                </Link>
              </li>
            )}
            {o.counts.callsThisWeek !== null && (
              <li>
                <Link className="card stat" to={paths.adminWebsiteCalls}>
                  <strong>{o.counts.callsThisWeek}</strong>
                  <span>{st.callsStat}</span>
                </Link>
              </li>
            )}
            {o.reviews.length > 0 && (
              <li>
                <Link className="card stat" to={paths.adminWebsiteBlog}>
                  <strong className="warn">{o.reviews.length}</strong>
                  <span>{st.reviewsStat}</span>
                </Link>
              </li>
            )}
          </ul>
          {publish.message && <p className={`notice notice-${publish.message.tone === 'ok' ? 'ok' : 'error'}`} role="status">{publish.message.text}</p>}

          <h2>{st.editWebsite}</h2>
          <ul className="site-sections">
            {links
              .filter((s) => s.show)
              .map((s) => (
                <li key={s.to}>
                  <Link className="card site-section" to={s.to}>
                    <Icon name={s.icon} />
                    <strong>{s.label}</strong>
                    <span className="muted small">{s.text}</span>
                  </Link>
                </li>
              ))}
          </ul>

          <section className="section" aria-labelledby="h-pending">
            <h2 id="h-pending">{st.waiting}</h2>
            <p className="muted small">{st.waitingHint}</p>
            {!o.pending.length ? <EmptyState icon="check" title={st.nothingWaiting} message="" /> : <PendingTable rows={o.pending} />}
          </section>

          {o.reviews.length > 0 && (
            <section className="section" aria-labelledby="h-reviews">
              <h2 id="h-reviews">{st.reviews}</h2>
              <ul className="plain-list">
                {o.reviews.map((r) => (
                  <li key={r.id}>
                    <Link to={paths.adminWebsitePost(r.id)}>{r.title}</Link>
                    <span className="muted small">{st.reviewAsked(r.by, savedLine(null, r.at) ?? '')}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {o.recent.length > 0 && (
            <section className="section" aria-labelledby="h-recent">
              <h2 id="h-recent">{st.recent}</h2>
              <ul className="plain-list">
                {o.recent.map((r) => (
                  <li key={r.id}>
                    <span>
                      <strong>{st.action[r.action]}</strong> {st.kind[r.kind]}: {r.title}
                    </span>
                    <span className="muted small">{[r.by?.name, savedLine(null, r.at)].filter(Boolean).join(', ')}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <p className="muted small">{st.howItWorks}</p>
        </>
      )}
    </>
  );
}

function PendingTable({ rows }: { rows: Pending[] }) {
  return (
    <TableWrap label={st.waiting}>
      <table className="table">
        <thead>
          <tr>
            <th scope="col">{st.item}</th>
            <th scope="col">{st.kindLabel}</th>
            <th scope="col">{st.statusLabel}</th>
            <th scope="col">{st.lastSaved}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={`${p.kind}-${p.id}`}>
              <td>
                <Link to={editPath(p.kind, p.id)}>{p.title || st.untitled}</Link>
              </td>
              <td>{st.kind[p.kind]}</td>
              <td>
                <SiteStatusBadge status={p.status} />
              </td>
              <td className="muted small">{savedLine(p.updatedBy, p.updatedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
  );
}
