import { useRef, useState } from 'react';

import { toApiError } from '../../data/api';
import { services } from '../../data/services';
import {
  fillSamples,
  LANGUAGES,
  loadOverview,
  messageLog,
  type MessageEvent,
  type Overview,
  placeholders,
  saveConnection,
  saveTemplate,
  sendTest,
  submitTemplate,
  syncTemplates,
} from '../../data/whatsapp';
import { when } from '../../shared/format';
import { EmptyState, ErrorState, NoOrgState, SkeletonRows, TableWrap } from '../../shared/ui';
import { useAsync } from '../../shared/useAsync';
import { t } from '../../strings';
import { wt } from '../../strings/messaging';
import { Dialog, DialogActions, FormError, SelectField, TextField, useSubmit } from '../components/Dialog';
import { NeedBranch, Notice } from '../components/kit';
import { useWorkspace } from '../Workspace';

// Settings → WhatsApp: a branch's WhatsApp Business number (three values from
// Meta), one editable template per message, test sends and the message log.

const STATUS_TONE: Record<string, string> = { APPROVED: 'ok', PENDING: 'info', REJECTED: 'danger', PAUSED: 'warn', DISABLED: 'danger', NOT_SUBMITTED: 'muted' };
const LOG_TONE: Record<string, string> = { SENT: 'info', DELIVERED: 'ok', READ: 'ok', FAILED: 'danger', SKIPPED: 'warn', QUEUED: 'muted', SENDING: 'muted' };

function webhookUrl(path: string) {
  const { fns } = services();
  return `https://${fns.region}-${fns.app.options.projectId ?? 'PROJECT'}.cloudfunctions.net/${path}`;
}

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <div className="lookup-bar">
        <input readOnly value={value} aria-label={label} onFocus={(e) => e.target.select()} />
        <button
          type="button"
          className="btn btn-outlined"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(value);
              setCopied(true);
            } catch {
              setCopied(false);
            }
          }}
        >
          {copied ? wt.copied : wt.copy}
        </button>
      </div>
    </div>
  );
}

function ConnectionCard({ orgId, branchId, data, onSaved }: { orgId: string; branchId: string; data: Overview; onSaved: () => void }) {
  const s = data.settings;
  const [f, setF] = useState({ enabled: s?.enabled ?? true, phoneNumberId: s?.phoneNumberId ?? '', wabaId: s?.wabaId ?? '', accessToken: '', appSecret: '', language: s?.language ?? 'en' });
  const [saved, setSaved] = useState(false);
  const [to, setTo] = useState('');
  const [test, setTest] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const save = useSubmit(async () => {
    setSaved(false);
    await saveConnection(orgId, branchId, { ...f, phoneNumberId: f.phoneNumberId.trim(), wabaId: f.wabaId.trim(), accessToken: f.accessToken.trim(), appSecret: f.appSecret.trim() });
    setF((x) => ({ ...x, accessToken: '', appSecret: '' }));
    setSaved(true);
    onSaved();
  });
  const runTest = async () => {
    setTest(null);
    try {
      await sendTest(orgId, branchId, to, null);
      setTest({ tone: 'ok', text: wt.testSent });
    } catch (e) {
      setTest({ tone: 'error', text: toApiError(e).message });
    }
  };
  return (
    <section className="card" aria-labelledby="wa-conn">
      <h2 id="wa-conn">{wt.connection}</h2>
      <p className={s ? '' : 'muted'}>
        {s ? wt.connectedAs(s.verifiedName ?? '—', s.displayPhone ?? s.phoneNumberId) : wt.notConnected}
        {s && !s.enabled && <span className="muted"> · {wt.off}</span>}
      </p>
      <form onSubmit={save.submit} noValidate className="form-grid wa-form">
        <label className="check span-2">
          <input type="checkbox" checked={f.enabled} onChange={(e) => setF({ ...f, enabled: e.target.checked })} /> {wt.enabled}
        </label>
        <TextField label={wt.phoneNumberId} value={f.phoneNumberId} onChange={(phoneNumberId) => setF({ ...f, phoneNumberId })} hint={wt.phoneNumberIdHint} autoComplete="off" />
        <TextField label={wt.wabaId} value={f.wabaId} onChange={(wabaId) => setF({ ...f, wabaId })} hint={wt.wabaIdHint} autoComplete="off" />
        <div className="span-2">
          <TextField label={wt.token} type="password" value={f.accessToken} onChange={(accessToken) => setF({ ...f, accessToken })} hint={s ? wt.tokenSaved : wt.tokenHint} autoComplete="new-password" />
        </div>
        <TextField label={wt.appSecret} type="password" value={f.appSecret} onChange={(appSecret) => setF({ ...f, appSecret })} hint={s?.hasAppSecret ? wt.tokenSaved : wt.appSecretHint} autoComplete="new-password" />
        <SelectField label={wt.language} value={f.language} onChange={(language) => setF({ ...f, language })} options={LANGUAGES.map(([value, label]) => ({ value, label: `${label} (${value})` }))} />
        <div className="span-2">
          <FormError error={save.error} />
          {saved && <Notice tone="ok">{wt.saved}</Notice>}
          <button type="submit" className="btn btn-filled" disabled={save.busy}>
            {save.busy ? t.saving : wt.saveConnection}
          </button>
        </div>
      </form>

      {data.webhook && (
        <details className="numbering-help">
          <summary>{wt.webhook}</summary>
          <p className="small muted">{wt.webhookIntro}</p>
          <CopyField label={wt.callbackUrl} value={webhookUrl(data.webhook.path)} />
          {data.webhook.verifyToken && <CopyField label={wt.verifyToken} value={data.webhook.verifyToken} />}
        </details>
      )}

      {s && (
        <div className="wa-test">
          <h3>{wt.testTitle}</h3>
          <div className="row">
            <TextField label={wt.testTo} type="tel" value={to} onChange={setTo} autoComplete="off" />
            <button type="button" className="btn btn-outlined" disabled={to.trim().length < 10} onClick={() => void runTest()}>
              {wt.testHello}
            </button>
          </div>
          {test && <Notice tone={test.tone}>{test.text}</Notice>}
        </div>
      )}
    </section>
  );
}

/** Edit one message: wording with value chips, template name, language, live preview, test send. */
function TemplateDialog({ orgId, branchId, event, onClose, onSaved }: { orgId: string; branchId: string; event: MessageEvent; onClose: () => void; onSaved: () => void }) {
  const tpl = event.template;
  const [f, setF] = useState({ enabled: tpl.enabled, name: tpl.name, language: tpl.language, body: tpl.body });
  const area = useRef<HTMLTextAreaElement>(null);
  const unknown = placeholders(f.body).filter((k) => !event.variables.some((v) => v.key === k));
  const insert = (key: string) => {
    const el = area.current;
    const token = `{{${key}}}`;
    if (!el) return setF((x) => ({ ...x, body: x.body + token }));
    const at = el.selectionStart ?? f.body.length;
    const next = f.body.slice(0, at) + token + f.body.slice(el.selectionEnd ?? at);
    setF((x) => ({ ...x, body: next }));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(at + token.length, at + token.length);
    });
  };
  const save = useSubmit(async () => {
    if (unknown.length) return;
    await saveTemplate(orgId, branchId, { event: event.key, ...f, body: f.body.trim(), name: f.name.trim() });
    onSaved();
    onClose();
  });
  return (
    <Dialog title={wt.editTitle(event.label)} onClose={onClose}>
      <form onSubmit={save.submit} noValidate>
        <p className="muted small">
          <strong>{wt.when}:</strong> {event.when}
        </p>
        <label className="check">
          <input type="checkbox" checked={f.enabled} onChange={(e) => setF({ ...f, enabled: e.target.checked })} /> {wt.sendThis}
        </label>
        {tpl.status !== 'APPROVED' && <p className="muted small">{wt.needsApproval}</p>}
        <div className="field">
          <label htmlFor="wa-body">{wt.body}</label>
          <textarea id="wa-body" ref={area} rows={5} maxLength={1024} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} aria-describedby="wa-body-hint" />
          <span id="wa-body-hint" className="field-hint">
            {wt.bodyHint} {f.body.length}/1024
          </span>
          {unknown.length > 0 && <span className="field-error">{`{{${unknown[0]}}} isn't a value this message has.`}</span>}
        </div>
        <div className="chips wa-chips" role="group" aria-label={wt.insert}>
          {event.variables.map((v) => (
            <button key={v.key} type="button" className="chip-button" onClick={() => insert(v.key)} title={`${v.label}, e.g. ${v.sample}`}>
              {`{{${v.key}}}`}
            </button>
          ))}
        </div>
        <div className="wa-preview" aria-live="polite">
          <span className="muted small">{wt.preview}</span>
          <p>{fillSamples(f.body, event.variables)}</p>
        </div>
        <div className="form-grid">
          <TextField label={wt.templateName} value={f.name} onChange={(name) => setF({ ...f, name })} hint={wt.templateNameHint} autoComplete="off" />
          <SelectField label={wt.language} value={f.language} onChange={(language) => setF({ ...f, language })} options={LANGUAGES.map(([value, label]) => ({ value, label: `${label} (${value})` }))} />
        </div>
        <p className="muted small">{wt.changedNote}</p>
        <FormError error={save.error} />
        <DialogActions busy={save.busy} submitLabel={t.save} onCancel={onClose} />
      </form>
    </Dialog>
  );
}

function TemplatesCard({ orgId, branchId, data, onChanged }: { orgId: string; branchId: string; data: Overview; onChanged: () => void }) {
  const [editing, setEditing] = useState<MessageEvent | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [to, setTo] = useState('');
  const run = async (key: string, fn: () => Promise<string>) => {
    setBusy(key);
    setMsg(null);
    try {
      setMsg({ tone: 'ok', text: await fn() });
      onChanged();
    } catch (e) {
      setMsg({ tone: 'error', text: toApiError(e).message });
    } finally {
      setBusy(null);
    }
  };
  const connected = !!data.settings;
  return (
    <section className="section" aria-labelledby="wa-msgs">
      <div className="page-header-row">
        <h2 id="wa-msgs">{wt.messages}</h2>
        {connected && (
          <button type="button" className="btn btn-outlined" disabled={busy !== null} onClick={() => void run('sync', async () => wt.checked((await syncTemplates(orgId, branchId)).found))}>
            {busy === 'sync' ? t.loading : wt.checkApprovals}
          </button>
        )}
      </div>
      <p className="muted">{wt.messagesIntro}</p>
      {connected && (
        <div className="row wa-test-to">
          <TextField label={`${wt.sendTest}: ${wt.testTo}`} type="tel" value={to} onChange={setTo} autoComplete="off" />
        </div>
      )}
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      <ul className="wa-events">
        {data.events.map((e) => {
          const tpl = e.template;
          return (
            <li key={e.key} className="card wa-event">
              <div className="wa-event-head">
                <div>
                  <h3>{e.label}</h3>
                  <p className="muted small">
                    {wt.audience[e.audience]} · {e.when}
                  </p>
                </div>
                <div className="wa-badges">
                  <span className={`badge badge-${tpl.enabled ? 'ok' : 'muted'}`}>{tpl.enabled ? wt.on : wt.off_}</span>
                  <span className={`badge badge-${STATUS_TONE[tpl.status] ?? 'muted'}`}>{wt.status[tpl.status] ?? tpl.status}</span>
                </div>
              </div>
              <p className="wa-body">{tpl.body}</p>
              {tpl.reason && (
                <p className="field-error">
                  {tpl.reason}
                  {wt.reasons[tpl.reason] && <span className="wa-reason"> · {wt.reasons[tpl.reason]}</span>}
                </p>
              )}
              <p className="muted small mono">
                {tpl.name} · {tpl.language}
              </p>
              <div className="row">
                <button type="button" className="btn btn-outlined" onClick={() => setEditing(e)}>
                  {wt.edit}
                </button>
                {connected && (
                  <>
                    <button
                      type="button"
                      className="btn btn-text"
                      disabled={busy !== null || tpl.status === 'APPROVED'}
                      onClick={() => void run(e.key, async () => wt.submitted((await submitTemplate(orgId, branchId, e.key)).status))}
                    >
                      {busy === e.key ? t.loading : wt.submit}
                    </button>
                    <button
                      type="button"
                      className="btn btn-text"
                      disabled={busy !== null || to.trim().length < 10}
                      onClick={() => void run(`test-${e.key}`, async () => (await sendTest(orgId, branchId, to, e.key), wt.testSent))}
                    >
                      {wt.sendTest}
                    </button>
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {editing && <TemplateDialog orgId={orgId} branchId={branchId} event={editing} onClose={() => setEditing(null)} onSaved={onChanged} />}
    </section>
  );
}

function LogCard({ orgId, branchId, events }: { orgId: string; branchId: string; events: MessageEvent[] }) {
  const log = useAsync(() => messageLog(orgId, branchId), [orgId, branchId]);
  const label = (k: string) => events.find((e) => e.key === k)?.label ?? k;
  return (
    <section className="section" aria-labelledby="wa-log">
      <div className="page-header-row">
        <h2 id="wa-log">{wt.log}</h2>
        <button type="button" className="btn btn-text" onClick={log.reload}>
          {wt.refresh}
        </button>
      </div>
      {log.loading ? (
        <SkeletonRows rows={3} />
      ) : log.error ? (
        <ErrorState message={log.error} onRetry={log.reload} />
      ) : !log.data?.messages.length ? (
        <p className="muted">{wt.logEmpty}</p>
      ) : (
        <TableWrap>
          <table className="table compact">
            <thead>
              <tr>
                <th scope="col">{wt.logWhen}</th>
                <th scope="col">{wt.logMessage}</th>
                <th scope="col">{wt.logTo}</th>
                <th scope="col">{wt.logState}</th>
              </tr>
            </thead>
            <tbody>
              {log.data.messages.map((m) => (
                <tr key={m.id}>
                  <td className="nowrap">{m.at ? when(new Date(m.at)) : '—'}</td>
                  <td>{label(m.event)}</td>
                  <td>
                    {m.recipient ?? '—'}
                    {m.to && <div className="muted small mono">{m.to}</div>}
                  </td>
                  <td>
                    <span className={`badge badge-${LOG_TONE[m.status] ?? 'muted'}`}>{wt.logStatus[m.status] ?? m.status}</span>
                    {m.error && <div className="muted small">{m.error}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
    </section>
  );
}

function BranchWhatsApp({ orgId, branchId }: { orgId: string; branchId: string }) {
  const data = useAsync(() => loadOverview(orgId, branchId), [orgId, branchId]);
  if (data.loading && !data.data) return <SkeletonRows rows={6} />;
  if (data.error) return <ErrorState message={data.error} onRetry={data.reload} />;
  if (!data.data) return <EmptyState icon="tune" title={wt.nav} message="" />;
  return (
    <>
      <ConnectionCard orgId={orgId} branchId={branchId} data={data.data} onSaved={data.reload} />
      <TemplatesCard orgId={orgId} branchId={branchId} data={data.data} onChanged={data.reload} />
      {data.data.settings && <LogCard orgId={orgId} branchId={branchId} events={data.data.events} />}
    </>
  );
}

export function WhatsAppPage() {
  const { org, branch } = useWorkspace();
  if (!org) return <NoOrgState />;
  return (
    <>
      <header className="page-header">
        <h1>{branch ? wt.title(branch.name) : wt.nav}</h1>
        <p className="muted">{wt.intro}</p>
        <p>
          <a href="https://github.com/learn-crossmaze/stories/blob/main/docs/WHATSAPP.md" target="_blank" rel="noreferrer">
            {wt.guide}
          </a>
        </p>
      </header>
      <NeedBranch>{(branchId) => <BranchWhatsApp orgId={org.id} branchId={branchId} />}</NeedBranch>
    </>
  );
}
