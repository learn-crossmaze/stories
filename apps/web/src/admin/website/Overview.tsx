import { useState } from 'react';
import { Link } from 'react-router';

import { errorText } from '../../data/api';
import { publishAll, SITE_URL, siteOverview, type Kind, type Pending } from '../../data/site';
import { paths } from '../../paths';
import { useAsync } from '../../shared/useAsync';
import { EmptyState, ErrorState, Icon, SkeletonRows, TableWrap } from '../../shared/ui';
import { st } from '../../strings/site';
import { savedLine, SiteStatusBadge } from './kit';

/** Where each kind of item is edited. */
export function editPath(kind: Kind, id: string, orgId?: string | null) {
  if (kind === 'post') return paths.adminWebsitePost(id);
  if (kind === 'promotion') return paths.adminWebsitePromotion(id);
  if (kind === 'branch') return orgId ? paths.adminWebsiteBranch(orgId, id) : paths.adminWebsiteBranches;
  if (kind === 'greetings') return paths.adminWebsiteCards;
  return paths.adminWebsiteSettings;
}

/**
 * The Website section's front page: what the website team can change, what waits to be published or reviewed,
 * and what was published lately. "Publish all" puts every saved change on the website at once.
 */
export function WebsiteOverviewPage() {
  const data = useAsync(siteOverview, []);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const o = data.data;
  const sections = [
    { to: paths.adminWebsiteBlog, icon: 'folder' as const, label: st.navBlog, text: st.blogIntro, show: !!o?.rights.canWrite },
    { to: paths.adminWebsiteBranches, icon: 'store' as const, label: st.navBranches, text: st.branchesIntro, show: !!o && (o.rights.manager || o.rights.branches.length > 0) },
    { to: paths.adminWebsitePromotions, icon: 'card' as const, label: st.navPromotions, text: st.promotionsIntro, show: !!o?.rights.manager },
    { to: paths.adminWebsiteCards, icon: 'palette' as const, label: st.navCards, text: st.cardsIntro, show: !!o?.rights.manager },
    { to: paths.adminWebsiteSettings, icon: 'tune' as const, label: st.navSettings, text: st.settingsIntro, show: !!o?.rights.manager },
  ];
  const mine = (o?.pending ?? []).filter((p) => p.canPublish);
  const doPublishAll = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const r = await publishAll();
      setMessage({ tone: r.blocked.length ? 'error' : 'ok', text: [st.publishedCount(r.published.length), ...r.blocked.map((b) => `${b.title}: ${b.reason}`)].join(' ') });
      data.reload();
    } catch (e) {
      setMessage({ tone: 'error', text: errorText(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <header className="page-header page-header-row">
        <div>
          <h1>{st.title}</h1>
          <p className="muted">{st.intro}</p>
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
          <ul className="site-sections">
            {sections
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
            <div className="page-header-row">
              <h2 id="h-pending">{st.waiting}</h2>
              {mine.length > 0 && (
                <button type="button" className="btn btn-filled" disabled={busy} onClick={() => void doPublishAll()}>
                  {busy ? st.publishingNow : st.publishAll(mine.length)}
                </button>
              )}
            </div>
            <p className="muted small">{st.waitingHint}</p>
            {message && <p className={`notice notice-${message.tone === 'ok' ? 'ok' : 'error'}`} role="status">{message.text}</p>}
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
