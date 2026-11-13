import { useSearchParams } from 'react-router';

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

/**
 * Read-only, newest-first audit trail, paginated 25 at a time. It can be narrowed to one branch and to one
 * record; both choices are kept in the address (?branch=…&record=…), so they survive a reload and can be linked to.
 */
export function AuditPage() {
  const { claims } = useAuth();
  const { org, branchName, myBranches } = useWorkspace();
  const [params, setParams] = useSearchParams();
  const scope = org ? branchScope(claims, org.id) : 'ALL';
  const record = params.get('record') ?? '';
  // A branch from the address counts only if the reader may see it: the rules refuse a read outside their branches.
  const asked = params.get('branch') ?? '';
  const chosen = asked && (scope === 'ALL' || scope.includes(asked)) ? asked : '';
  // One branch narrows the reader's own list. "All branches" adds no filter at all, so entries without a branch
  // (roles, head office) stay in.
  const effective = chosen ? [chosen] : scope;
  const scopeKey = JSON.stringify(effective);
  // Another organization's (or filter's) entries never stay on screen while the new ones load.
  const list = usePagedQuery<AuditEntry>(
    async (after) => {
      const page = await listAudit(org!.id, effective, after, { entityId: record || undefined });
      return { items: page.entries, cursor: page.cursor };
    },
    [org?.id, scopeKey, record],
    { enabled: !!org, keepPrevious: false },
  );
  const { items: entries, loading, error } = list;

  if (!org) return <NoOrgState />;
  const filter = (key: 'record' | 'branch', value: string, replace = false) =>
    setParams(
      (now) => {
        const next = new URLSearchParams(now);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace },
    );
  // A branch opened from a link may be archived (not in the list): it still gets its own line.
  const choices = chosen && !myBranches.some((b) => b.id === chosen) ? [...myBranches.map((b) => b.id), chosen] : myBranches.map((b) => b.id);
  return (
    <>
      <header className="page-header">
        <h1>{t.auditTitle}</h1>
      </header>
      {choices.length > 1 && (
        <div className="toolbar">
          <select value={chosen} onChange={(e) => filter('branch', e.target.value, true)} aria-label={t.branch}>
            <option value="">{scope === 'ALL' ? t.allBranches : t.auditMyBranches}</option>
            {choices.map((id) => (
              <option key={id} value={id}>
                {branchName(id)}
              </option>
            ))}
          </select>
        </div>
      )}
      {record && (
        <div className="notice notice-ok" role="status">
          {t.auditOneRecord} <span className="mono">{record}</span>{' '}
          <button type="button" className="btn btn-text btn-inline" onClick={() => filter('record', '')}>
            {t.auditShowAll}
          </button>
          <div className="small">{t.auditOneRecordHint}</div>
        </div>
      )}
      {error && entries.length === 0 ? (
        <ErrorState message={error} onRetry={list.reload} />
      ) : loading && entries.length === 0 ? (
        <SkeletonRows rows={6} />
      ) : entries.length === 0 ? (
        <EmptyState icon="history" title={record || chosen ? t.auditNoMatch : t.auditEmpty} message="" />
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
                      {e.entityType}{' '}
                      {record || !e.entityId ? (
                        <span className="muted mono small">{e.entityId}</span>
                      ) : (
                        <button type="button" className="btn btn-text btn-inline mono small" title={t.auditOnlyThis} aria-label={`${t.auditOnlyThis}: ${e.entityId}`} onClick={() => filter('record', e.entityId)}>
                          {e.entityId}
                        </button>
                      )}
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
