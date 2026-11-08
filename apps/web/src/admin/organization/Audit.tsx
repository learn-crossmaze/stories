import { useAuth } from '../../auth/AuthContext';
import { branchScope } from '../../auth/claims';
import { type AuditEntry, listAudit } from '../../data/org';
import { usePagedQuery } from '../../shared/usePagedQuery';
import { t } from '../../strings';
import { EmptyState, ErrorState, NoOrgState, SkeletonRows, TableWrap } from '../../shared/ui';
import { useWorkspace } from '../Workspace';

const when = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' });

function Changes({ entry }: { entry: AuditEntry }) {
  if (!entry.before && !entry.after && !entry.reason) return null;
  return (
    <details>
      <summary>{t.auditDetails}</summary>
      {entry.reason && (
        <p>
          <strong>{t.reasonLabel}:</strong> {entry.reason}
        </p>
      )}
      {entry.before != null && <pre>{JSON.stringify(entry.before, null, 2)}</pre>}
      {entry.after != null && <pre>{JSON.stringify(entry.after, null, 2)}</pre>}
    </details>
  );
}

/** Read-only, newest-first audit trail, paginated 25 at a time. */
export function AuditPage() {
  const { claims } = useAuth();
  const { org, branchName } = useWorkspace();
  const scope = org ? branchScope(claims, org.id) : 'ALL';
  const scopeKey = JSON.stringify(scope);
  // Another organization's (or scope's) entries never stay on screen while the new ones load.
  const list = usePagedQuery<AuditEntry>(
    async (after) => {
      const page = await listAudit(org!.id, scope, after);
      return { items: page.entries, cursor: page.cursor };
    },
    [org?.id, scopeKey],
    { enabled: !!org, keepPrevious: false },
  );
  const { items: entries, loading, error } = list;

  if (!org) return <NoOrgState />;
  return (
    <>
      <header className="page-header">
        <h1>{t.auditTitle}</h1>
      </header>
      {error && entries.length === 0 ? (
        <ErrorState message={error} onRetry={list.reload} />
      ) : loading && entries.length === 0 ? (
        <SkeletonRows rows={6} />
      ) : entries.length === 0 ? (
        <EmptyState icon="history" title={t.auditEmpty} message="" />
      ) : (
        <>
          <TableWrap>
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">{t.auditWhen}</th>
                  <th scope="col">{t.auditAction}</th>
                  <th scope="col">{t.auditEntity}</th>
                  <th scope="col">{t.branch}</th>
                  <th scope="col">{t.auditActor}</th>
                  <th scope="col">{t.auditDetails}</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.id}>
                    <td className="nowrap">{e.at ? when.format(e.at) : '—'}</td>
                    <td className="mono">{e.action}</td>
                    <td>
                      {e.entityType} <span className="muted mono small">{e.entityId}</span>
                    </td>
                    <td>{e.branchId ? branchName(e.branchId) : '—'}</td>
                    <td>{e.actorEmail ?? e.actorUid}</td>
                    <td>
                      <Changes entry={e} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
          {error && <p className="form-error" role="alert">{error}</p>}
          {list.hasMore && (
            <button type="button" className="btn btn-outlined load-more" disabled={loading} onClick={list.loadMore}>
              {loading ? t.loading : t.loadMore}
            </button>
          )}
        </>
      )}
    </>
  );
}
