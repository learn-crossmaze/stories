import { useState } from 'react';
import { Link } from 'react-router';

import { useAuth } from '../../auth/AuthContext';
import { branchScope } from '../../auth/claims';
import { command } from '../../data/api';
import { type Adjustment, label, pendingAdjustments } from '../../data/library';
import { useAsync } from '../../data/useAsync';
import { day, money } from '../../format';
import { paths } from '../../paths';
import { EmptyState, ErrorState, SkeletonRows } from '../../ui';
import { ConfirmWithReason, FormError } from '../Dialog';
import { lt } from '../libraryStrings';
import { useWorkspace } from '../Workspace';

/** Maker-checker queue: deposit deductions/adjustments proposed by others. */
export function DepositApprovalsPage() {
  const { claims, user } = useAuth();
  const { org, branchName } = useWorkspace();
  const scope = org ? branchScope(claims, org.id) : 'ALL';
  const list = useAsync(() => (org ? pendingAdjustments(org.id, scope) : Promise.resolve([])), [org?.id, JSON.stringify(scope)]);
  const [deciding, setDeciding] = useState<{ adj: Adjustment; decision: 'APPROVE' | 'REJECT' } | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!org) return null;
  return (
    <>
      <header className="page-header">
        <h1>{lt.approvalsTitle}</h1>
      </header>
      <FormError error={error} />
      {list.loading ? (
        <SkeletonRows />
      ) : list.error ? (
        <ErrorState message={list.error} onRetry={list.reload} />
      ) : !list.data?.length ? (
        <EmptyState icon="check" title={lt.approvalsEmpty} message="" />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{lt.membersTitle}</th>
                <th scope="col">Type</th>
                <th scope="col">{lt.amount.replace(' (₹)', '')}</th>
                <th scope="col">{lt.proposedBy}</th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {list.data.map((a) => (
                <tr key={a.id}>
                  <td>
                    <Link to={paths.adminMember(a.memberId)}>{a.memberName}</Link> <span className="mono small">{a.memberCode}</span>
                    <div className="muted small">{branchName(a.branchId)}</div>
                  </td>
                  <td>
                    {label(a.kind)}
                    <div className="muted small">{a.reason}</div>
                  </td>
                  <td className={`nowrap ${a.deltaMinor < 0 ? 'neg' : ''}`}>{money(a.deltaMinor)}</td>
                  <td className="small">
                    {a.proposedByEmail ?? a.proposedBy}
                    <div className="muted">{day(a.createdAt)}</div>
                  </td>
                  <td className="cell-actions">
                    <button type="button" className="btn btn-outlined" disabled={a.proposedBy === user?.uid} title={a.proposedBy === user?.uid ? 'Another person must approve your own proposal.' : undefined} onClick={() => setDeciding({ adj: a, decision: 'APPROVE' })}>
                      {lt.approve}
                    </button>
                    <button type="button" className="btn btn-text" onClick={() => setDeciding({ adj: a, decision: 'REJECT' })}>
                      {lt.reject}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {deciding && (
        <ConfirmWithReason
          title={`${deciding.decision === 'APPROVE' ? lt.approve : lt.reject} ${money(deciding.adj.deltaMinor)} for ${deciding.adj.memberName}?`}
          body={deciding.adj.reason}
          confirmLabel={deciding.decision === 'APPROVE' ? lt.approve : lt.reject}
          onClose={() => setDeciding(null)}
          onConfirm={async (note) => {
            setError(null);
            await command('deposits-decide', { orgId: org.id, adjustmentId: deciding.adj.id, decision: deciding.decision, note });
            list.reload();
            setDeciding(null);
          }}
        />
      )}
    </>
  );
}
