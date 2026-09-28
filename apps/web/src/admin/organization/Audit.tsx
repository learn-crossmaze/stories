import type { DocumentSnapshot } from 'firebase/firestore';
import { useEffect, useState } from 'react';

import { useAuth } from '../../auth/AuthContext';
import { branchScope } from '../../auth/claims';
import { type AuditEntry, listAudit } from '../../data/org';
import { t } from '../../strings';
import { EmptyState, ErrorState, SkeletonRows } from '../../shared/ui';
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
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [cursor, setCursor] = useState<DocumentSnapshot | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const scope = org ? branchScope(claims, org.id) : 'ALL';
  const scopeKey = JSON.stringify(scope);

  const load = async (after?: DocumentSnapshot) => {
    if (!org) return;
    setLoading(true);
    setError(null);
    try {
      const page = await listAudit(org.id, scope, after);
      setEntries((prev) => (after ? [...prev, ...page.entries] : page.entries));
      setCursor(page.cursor);
    } catch (e) {
      console.error(e);
      setError(t.errorLoad);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setEntries([]);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [org?.id, scopeKey, attempt]);

  if (!org) return <EmptyState icon="building" title={t.noOrgTitle} message={t.noOrgMessage} />;
  return (
    <>
      <header className="page-header">
        <h1>{t.auditTitle}</h1>
      </header>
      {error && entries.length === 0 ? (
        <ErrorState message={error} onRetry={() => setAttempt((n) => n + 1)} />
      ) : loading && entries.length === 0 ? (
        <SkeletonRows rows={6} />
      ) : entries.length === 0 ? (
        <EmptyState icon="history" title={t.auditEmpty} message="" />
      ) : (
        <>
          <div className="table-wrap">
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
          </div>
          {error && <p className="form-error">{error}</p>}
          {cursor && (
            <button type="button" className="btn btn-outlined load-more" disabled={loading} onClick={() => load(cursor)}>
              {loading ? t.loading : t.loadMore}
            </button>
          )}
        </>
      )}
    </>
  );
}
