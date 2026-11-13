import { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';

import { errorText } from '../../data/api';
import { deleteSubmission, downloadCsv, downloadResume, type Form, getSubmission, listSubmissions, markHandled, type Submission } from '../../data/site';
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
  const [form, setForm] = useState<Form | 'ALL'>('ALL');
  const [show, setShow] = useState<'NEW' | 'ALL'>('NEW');
  // "To follow up" asks the server for the open ones only; "All" for the newest 500, handled or not.
  const list = useAsync(() => listSubmissions(show === 'NEW'), [show]);
  // Marked from this list: shown as handled at once (and so gone from "To follow up"), before the list is read again.
  const [marked, setMarked] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const sending = useRef(new Set<string>());
  const [last, setLast] = useState<{ id: string; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const rows = (list.data ?? [])
    .map((s) => (marked.has(s.id) ? { ...s, handled: true } : s))
    .filter((s) => (form === 'ALL' || s.form === form) && (show === 'ALL' || !s.handled));
  /** One click on a row. The note is not sent, so one written on the enquiry's page stays as it is. */
  const mark = async (s: { id: string; name: string }, handled: boolean) => {
    const toggle = (ids: ReadonlySet<string>, on: boolean) => new Set(on ? [...ids, s.id] : [...ids].filter((x) => x !== s.id));
    // A double click must not send the same change twice.
    if (sending.current.has(s.id)) return;
    sending.current.add(s.id);
    setBusy((b) => toggle(b, true));
    setError(null);
    setLast(null);
    setMarked((m) => toggle(m, handled));
    try {
      await markHandled(s.id, handled);
      if (handled) setLast(s);
      list.reload();
    } catch (e) {
      // Back to how it was: the row returns to the list (or, for an undo, the offer to undo returns).
      setMarked((m) => toggle(m, !handled));
      setError(errorText(e));
      if (!handled) setLast(s);
    } finally {
      sending.current.delete(s.id);
      setBusy((b) => toggle(b, false));
    }
  };
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
      {last && (
        <p className="notice notice-ok" role="status">
          {st.markedHandled(last.name)}{' '}
          <button type="button" className="btn btn-text" disabled={busy.has(last.id)} onClick={() => void mark(last, false)}>
            {st.undo}
          </button>
        </p>
      )}
      {error && <p className="notice notice-error" role="alert">{error}</p>}
      {list.loading ? (
        <SkeletonRows />
      ) : list.error && !list.data ? (
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
                <th scope="col">{st.followUp}</th>
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
                  <td>
                    {!s.handled && (
                      <button type="button" className="btn btn-outlined" disabled={busy.has(s.id)} aria-label={st.markFollowedUpFor(s.name)} onClick={() => void mark(s, true)}>
                        {st.markFollowedUp}
                      </button>
                    )}
                  </td>
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
  // This enquiry only (a notification opens this page): not the whole list to find one row.
  const one = useAsync(() => getSubmission(submissionId), [submissionId]);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const s = one.data;
  if (one.loading) return <SkeletonRows />;
  if (!s) return <ErrorState message={one.error ?? st.notFound} onRetry={one.reload} />;
  /** `after`: what follows a success (read the enquiry again, or leave the page). */
  const act = async (fn: () => Promise<unknown>, after?: () => void) => {
    setBusy(true);
    setMessage(null);
    try {
      await fn();
      after?.();
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
            <button type="button" className={`btn ${s.handled ? 'btn-outlined' : 'btn-filled'}`} disabled={busy} onClick={() => void act(() => markHandled(s.id, !s.handled, note ?? s.note ?? ''), one.reload)}>
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
