// Settings → Connections and Admins (as on crossmaze.in): outside services and enquiry alerts; who can change the website.
import { useEffect, useState } from 'react';
import { Link } from 'react-router';

import { errorText } from '../../data/api';
import { getConnections, listWebsiteAdmins, saveConnections } from '../../data/site';
import { paths } from '../../paths';
import { useAsync } from '../../shared/useAsync';
import { Badge, ErrorState, SkeletonRows, TableWrap } from '../../shared/ui';
import { st } from '../../strings/site';
import { WordsField } from './kit';

export function ConnectionsPage() {
  const data = useAsync(getConnections, []);
  const [alerts, setAlerts] = useState<string[]>([]);
  const [managers, setManagers] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  useEffect(() => {
    if (!data.data) return;
    setAlerts(data.data.alerts);
    setManagers(data.data.alertBranchManagers);
  }, [data.data]);
  if (data.loading) return <SkeletonRows />;
  if (data.error || !data.data) return <ErrorState message={data.error ?? ''} onRetry={data.reload} />;
  const save = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await saveConnections(alerts, managers);
      setMessage({ tone: 'ok', text: st.connectionsSaved });
      data.reload();
    } catch (e) {
      setMessage({ tone: 'error', text: errorText(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <header className="page-header">
        <h1>{st.navConnections}</h1>
        <p className="muted">{st.connectionsIntro}</p>
      </header>
      <div className="editor-main">
        <section className="card" aria-labelledby="h-alerts">
          <h2 id="h-alerts" className="h3">{st.enquiryAlerts}</h2>
          <p className="muted small">{st.enquiryAlertsHint}</p>
          <WordsField label={st.alertEmails} hint={st.alertEmailsHint} value={alerts} onChange={setAlerts} max={10} />
          <label className="check">
            <input type="checkbox" checked={managers} onChange={(e) => setManagers(e.target.checked)} /> {st.alertBranchManagers}
          </label>
          <button type="button" className="btn btn-filled align-start" disabled={busy} onClick={() => void save()}>
            {busy ? st.saving : st.save}
          </button>
          {message && <p className={`notice notice-${message.tone}`} role="status">{message.text}</p>}
        </section>
        <section className="card" aria-labelledby="h-services">
          <h2 id="h-services" className="h3">{st.services}</h2>
          <p className="muted small">{st.servicesHint}</p>
          <TableWrap label={st.services}>
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">{st.branch}</th>
                  <th scope="col">WhatsApp</th>
                  <th scope="col">{st.onlinePayments}</th>
                </tr>
              </thead>
              <tbody>
                {data.data.branches.map((b) => (
                  <tr key={b.id}>
                    <td>{b.name}</td>
                    <td>{b.whatsapp ? <Badge tone="ok">{st.connected}</Badge> : <Badge tone="muted">{st.notConnected}</Badge>}</td>
                    <td>{b.payments ? <Badge tone="ok">{st.connected}</Badge> : <Badge tone="muted">{st.notConnected}</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
          <p className="actions">
            <Link className="btn btn-outlined" to={paths.adminSettingsWhatsApp}>{st.setUpWhatsapp}</Link>
            <Link className="btn btn-outlined" to={paths.adminBranches}>{st.setUpPayments}</Link>
          </p>
          <p className="muted small">{st.mapsNote}</p>
        </section>
      </div>
    </>
  );
}

export function AdminsPage() {
  const data = useAsync(listWebsiteAdmins, []);
  return (
    <>
      <header className="page-header page-header-row">
        <div>
          <h1>{st.navAdmins}</h1>
          <p className="muted">{st.adminsIntro}</p>
        </div>
        <Link className="btn btn-filled" to={paths.adminStaff}>{st.giveAccess}</Link>
      </header>
      {data.loading ? (
        <SkeletonRows />
      ) : data.error || !data.data ? (
        <ErrorState message={data.error ?? ''} onRetry={data.reload} />
      ) : (
        <>
          <TableWrap label={st.navAdmins}>
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">{st.name}</th>
                  <th scope="col">{st.role}</th>
                  <th scope="col">{st.canDo}</th>
                  <th scope="col">{st.branches}</th>
                </tr>
              </thead>
              <tbody>
                {data.data.map((p) => (
                  <tr key={`${p.uid}-${p.org}`}>
                    <td>
                      <strong>{p.name}</strong>
                      <div className="muted small">{p.email}</div>
                    </td>
                    <td>
                      {p.roles.join(', ')}
                      <div className="muted small">{p.org}</div>
                    </td>
                    <td>{st.level[p.level]}</td>
                    <td className="small">{p.level === 'MANAGER' ? st.allBranches : p.branches.join(', ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
          <p className="muted small">{st.adminsNote}</p>
        </>
      )}
    </>
  );
}
