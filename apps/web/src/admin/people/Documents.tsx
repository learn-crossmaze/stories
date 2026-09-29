// HR's document queue: waiting for verification, expiring soon, expired.
import { useState } from 'react';
import { Link } from 'react-router';

import { useAuth } from '../../auth/AuthContext';
import { branchScope } from '../../auth/claims';
import { documentQueue, type EmployeeDocument, listDocumentTypes, openDocument } from '../../data/hrDocuments';
import { paths } from '../../paths';
import { day } from '../../shared/format';
import { EmptyState, ErrorState, NoOrgState, SkeletonRows } from '../../shared/ui';
import { useAsync } from '../../shared/useAsync';
import { t } from '../../strings';
import { ht } from '../../strings/hr';
import { FormError } from '../components/Dialog';
import { Tabs } from '../components/kit';
import { useWorkspace } from '../Workspace';
import { DocumentBadge, ExpiryNote, useDocumentReview } from './EmployeeDocuments';

type Queue = 'pending' | 'expiring' | 'expired';

export function DocumentsPage() {
  const { claims, user } = useAuth();
  const { org, branchName } = useWorkspace();
  const scope = org ? branchScope(claims, org.id) : 'ALL';
  const data = useAsync(async () => {
    if (!org) return null;
    const types = await listDocumentTypes(org.id);
    return { types, queue: await documentQueue(org.id, scope, types) };
  }, [org?.id, JSON.stringify(scope)]);
  const [tab, setTab] = useState<Queue>('pending');
  const [openError, setOpenError] = useState<string | null>(null);
  const review = useDocumentReview(org?.id ?? '', data.reload);
  if (!org) return <NoOrgState />;

  const q = data.data?.queue;
  const reminder = new Map((data.data?.types ?? []).map((x) => [x.id, x.reminderDays]));
  const rows: EmployeeDocument[] = q ? q[tab] : [];
  const open = async (d: EmployeeDocument) => {
    setOpenError(null);
    try {
      await openDocument(org.id, d.employeeId, d.id);
    } catch (e) {
      setOpenError(e instanceof Error ? e.message : t.errorGeneric);
    }
  };

  return (
    <>
      <header className="page-header">
        <h1>{ht.documentsTitle}</h1>
        <p className="muted">{ht.documentsIntro}</p>
      </header>
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'pending' as const, label: ht.queuePending, count: q?.pending.length },
          { value: 'expiring' as const, label: ht.queueExpiring, count: q?.expiring.length },
          { value: 'expired' as const, label: ht.queueExpired, count: q?.expired.length },
        ]}
      />
      <FormError error={openError ?? review.error} />
      {data.loading ? (
        <SkeletonRows />
      ) : data.error ? (
        <ErrorState message={data.error} onRetry={data.reload} />
      ) : !rows.length ? (
        <EmptyState icon="check" title={ht.queueEmpty[tab]} message="" />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{ht.employeeCol}</th>
                <th scope="col">{ht.documentCol}</th>
                <th scope="col">{ht.datesCol}</th>
                <th scope="col">{ht.colStatus}</th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => (
                <tr key={`${d.employeeId}/${d.id}`}>
                  <td>
                    <Link to={paths.adminEmployee(d.employeeId)}>{d.employeeName}</Link>
                    <div className="muted small">
                      <span className="mono">{d.employeeCode}</span> · {d.branchId ? branchName(d.branchId) : ht.headOffice}
                    </div>
                  </td>
                  <td>
                    <div>{d.typeName}</div>
                    <div className="muted small">{d.selfUploaded ? ht.selfUploaded : d.fileName}</div>
                  </td>
                  <td>
                    <ExpiryNote doc={d} reminderDays={reminder.get(d.typeId)} />
                    {d.uploadedAt && <div className="muted small">{day(d.uploadedAt)}</div>}
                  </td>
                  <td>
                    <DocumentBadge status={d.status} />
                  </td>
                  <td className="cell-actions">
                    <button type="button" className="btn btn-text" onClick={() => void open(d)} aria-label={`${ht.open} ${d.typeName}, ${d.employeeName}`}>
                      {ht.open}
                    </button>
                    {d.status === 'PENDING' && d.uploadedBy !== user?.uid && (
                      <>
                        <button type="button" className="btn btn-text" onClick={() => void review.verify(d)} aria-label={`${ht.verify} ${d.typeName}, ${d.employeeName}`}>
                          {ht.verify}
                        </button>
                        <button type="button" className="btn btn-text" onClick={() => review.reject(d)} aria-label={`${ht.reject} ${d.typeName}, ${d.employeeName}`}>
                          {ht.reject}
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {review.dialog}
    </>
  );
}
