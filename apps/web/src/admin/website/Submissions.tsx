import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';

import { errorText } from '../../data/api';
import { deleteSubmission, downloadCsv, downloadResume, type Form, listSubmissions, markHandled, type Submission } from '../../data/site';
import { paths } from '../../paths';
import { useAsync } from '../../shared/useAsync';
import { Badge, EmptyState, ErrorState, Icon, SkeletonRows, TableWrap } from '../../shared/ui';
import { TextArea } from '../../shared/fields';
import { st } from '../../strings/site';

const FORMS: Form[] = ['MEMBERSHIP', 'CONTACT', 'FRANCHISE', 'JOB'];
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '');
const waLink = (phone: string) => {
  const d = phone.replace(/\D/g, '');
  const n = d.length === 10 ? `91${d}` : d.length === 11 && d.startsWith('0') ? `91${d.slice(1)}` : d;
  return `https://wa.me/${n}`;
};
const details = (s: Submission) => [s.jobTitle, s.branchName, s.city, s.readers, s.experience].filter(Boolean).join(' · ');

/** Submissions (as on crossmaze.in): every enquiry and application from the website's forms. */
export function SubmissionsPage() {
  const list = useAsync(listSubmissions, []);
  const [form, setForm] = useState<Form | 'ALL'>('ALL');
  const [show, setShow] = useState<'NEW' | 'ALL'>('NEW');
  const rows = (list.data ?? []).filter((s) => (form === 'ALL' || s.form === form) && (show === 'ALL' || !s.handled));
  const exportCsv = () =>
    downloadCsv(
      `stories-submissions-${new Date().toISOString().slice(0, 10)}.csv`,
      ['Received', 'Form', 'Name', 'Phone', 'Email', 'Branch', 'Job', 'City', 'For', 'Experience', 'Message', 'Page', 'Handled'],
      rows.map((s) => [s.createdAt, st.forms[s.form], s.name, s.phone, s.email, s.branchName, s.jobTitle, s.city, s.readers, s.experience, s.message, s.page, s.handled ? 'Yes' : 'No']),
    );
  return (
    <>
      <header className="page-header page-header-row">
        <div>
          <h1>{st.navSubmissions}</h1>
          <p className="muted">{st.submissionsIntro}</p>
        </div>
        <button type="button" className="btn btn-outlined" disabled={!rows.length} onClick={exportCsv}>
          {st.exportCsv}
        </button>
      </header>
      <div className="toolbar">
        <div className="segmented" role="group" aria-label={st.form}>
          {(['ALL', ...FORMS] as const).map((f) => (
            <button key={f} type="button" className="chip" aria-pressed={form === f} onClick={() => setForm(f)}>
              {f === 'ALL' ? st.all : st.forms[f]}
            </button>
          ))}
        </div>
        <div className="segmented" role="group" aria-label={st.show}>
          {(['NEW', 'ALL'] as const).map((f) => (
            <button key={f} type="button" className="chip" aria-pressed={show === f} onClick={() => setShow(f)}>
              {f === 'NEW' ? st.toFollowUp : st.all}
            </button>
          ))}
        </div>
      </div>
      {list.loading ? (
        <SkeletonRows />
      ) : list.error ? (
        <ErrorState message={list.error} onRetry={list.reload} />
      ) : !rows.length ? (
        <EmptyState icon="check" title={show === 'NEW' ? st.noNewSubmissions : st.noSubmissions} message={st.noSubmissionsHint} />
      ) : (
        <TableWrap label={st.navSubmissions}>
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{st.received}</th>
                <th scope="col">{st.form}</th>
                <th scope="col">{st.name}</th>
                <th scope="col">{st.phone}</th>
                <th scope="col">{st.details}</th>
                <th scope="col">{st.statusLabel}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id}>
                  <td className="nowrap">{when(s.createdAt)}</td>
                  <td>{st.forms[s.form]}</td>
                  <td>
                    <Link to={paths.adminWebsiteSubmission(s.id)}>{s.name}</Link>
                  </td>
                  <td className="nowrap">
                    <a href={`tel:${s.phone.replace(/[^+\d]/g, '')}`}>{s.phone}</a>
                  </td>
                  <td className="small">{details(s)}</td>
                  <td>{s.handled ? <Badge tone="ok">{st.handled}</Badge> : <Badge tone="warn">{st.newOne}</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
    </>
  );
}

export function SubmissionPage() {
  const { submissionId = '' } = useParams();
  const navigate = useNavigate();
  const list = useAsync(listSubmissions, []);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const s = list.data?.find((x) => x.id === submissionId);
  if (list.loading) return <SkeletonRows />;
  if (list.error || !s) return <ErrorState message={list.error ?? st.notFound} onRetry={list.reload} />;
  const act = async (fn: () => Promise<unknown>, after?: () => void) => {
    setBusy(true);
    setMessage(null);
    try {
      await fn();
      after?.();
      list.reload();
    } catch (e) {
      setMessage(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const fields: [string, string | null][] = [
    [st.phone, s.phone], [st.email, s.email], [st.branch, s.branchName], [st.job, s.jobTitle], [st.city, s.city], [st.readersFor, s.readers], [st.experience, s.experience], [st.page, s.page],
  ];
  return (
    <>
      <header className="page-header">
        <p className="muted small"><Link to={paths.adminWebsiteSubmissions}>{st.navSubmissions}</Link></p>
        <h1>{s.name}</h1>
        <p className="muted">{st.receivedLine(st.forms[s.form], when(s.createdAt))}</p>
      </header>
      <div className="editor-grid">
        <section className="card editor-main" aria-label={st.details}>
          <dl className="detail-list">
            {fields
              .filter(([, v]) => v)
              .map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
          </dl>
          {s.message && (
            <>
              <h2 className="h3">{st.messageLabel}</h2>
              <p className="pre-wrap">{s.message}</p>
            </>
          )}
          {s.resume && (
            <button type="button" className="btn btn-outlined align-start" disabled={busy} onClick={() => void act(() => downloadResume(s.id))}>
              <Icon name="folder" /> {st.downloadCv(s.resume.name)}
            </button>
          )}
        </section>
        <aside className="editor-side">
          <section className="card">
            <h2 className="h3">{st.followUp}</h2>
            <p className="actions">
              <a className="btn btn-filled" href={`tel:${s.phone.replace(/[^+\d]/g, '')}`}>{st.call}</a>
              <a className="btn btn-outlined" href={waLink(s.phone)} target="_blank" rel="noopener">WhatsApp</a>
              {s.email && <a className="btn btn-outlined" href={`mailto:${s.email}`}>{st.email}</a>}
            </p>
            <TextArea label={st.note} hint={st.noteHint} rows={3} value={note ?? s.note ?? ''} onChange={setNote} />
            <button type="button" className={`btn ${s.handled ? 'btn-outlined' : 'btn-filled'}`} disabled={busy} onClick={() => void act(() => markHandled(s.id, !s.handled, note ?? s.note ?? ''))}>
              {s.handled ? st.markNotHandled : st.markHandled}
            </button>
            {s.handled && s.handledBy && <p className="muted small">{st.handledBy(s.handledBy.name, when(s.handledAt ?? null))}</p>}
            {message && <p className="notice notice-error" role="alert">{message}</p>}
          </section>
          <section className="card">
            <button type="button" className="btn btn-text align-start" disabled={busy} onClick={() => { if (confirm(st.deleteSubmissionConfirm)) void act(() => deleteSubmission(s.id), () => navigate(paths.adminWebsiteSubmissions)); }}>
              {st.delete}
            </button>
            <p className="muted small">{st.deleteSubmissionHint}</p>
          </section>
        </aside>
      </div>
    </>
  );
}
