import { useRef, useState } from 'react';

import { toApiError } from '../../data/api';
import { services } from '../../data/services';
import {
  fillSamples,
  fixedWords,
  LANGUAGES,
  loadOverview,
  messageLog,
  type MessageEvent,
  type Overview,
  WORDS_PER_VALUE,
  placeholders,
  removeTemplate,
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
// Meta), the notifications it sends (added from the list of transactions,
// each with an editable template), test sends and the message log.

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
  const form = (
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
  );
  return (
    <section className="card" aria-labelledby="wa-conn">
      <h2 id="wa-conn">{wt.connection}</h2>
      <p className={s ? '' : 'muted'}>
        {s ? wt.connectedAs(s.verifiedName ?? '—', s.displayPhone ?? s.phoneNumberId) : wt.notConnected}
        {s && !s.enabled && <span className="muted"> · {wt.off}</span>}
      </p>
      {s ? (
        <details className="numbering-help">
          <summary>{wt.changeConnection}</summary>
          {form}
        </details>
      ) : (
        form
      )}

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

/**
 * One notification in full: wording with value chips, template name,
 * language, live preview, and (once added) Meta review, test send and remove.
 */
function TemplateDialog({ orgId, branchId, event, connected, onClose, onSaved }: { orgId: string; branchId: string; event: MessageEvent; connected: boolean; onClose: () => void; onSaved: () => void }) {
  const tpl = event.template;
  const initial = { enabled: tpl.enabled, name: tpl.name, language: tpl.language, body: tpl.body };
  const [f, setF] = useState(initial);
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const unknown = placeholders(f.body).filter((k) => !event.variables.some((v) => v.key === k));
  const values = placeholders(f.body).length;
  const words = fixedWords(f.body);
  const tooShort = words < values * WORDS_PER_VALUE;
  const dirty = f.enabled !== initial.enabled || f.name !== initial.name || f.language !== initial.language || f.body !== initial.body;
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
  const run = async (key: string, fn: () => Promise<string>, close = false) => {
    setBusy(key);
    setMsg(null);
    try {
      const text = await fn();
      onSaved();
      if (close) onClose();
      else setMsg({ tone: 'ok', text });
    } catch (e) {
      setMsg({ tone: 'error', text: toApiError(e).message });
    } finally {
      setBusy(null);
    }
  };
  return (
    <Dialog title={wt.editTitle(event.label)} onClose={onClose}>
      <form onSubmit={save.submit} noValidate>
        <p className="muted small">
          {wt.audience[event.audience]} · <strong>{wt.when}:</strong> {event.when}
        </p>
        {event.added && (
          <p className="wa-dialog-status">
            <span className={`badge badge-${STATUS_TONE[tpl.status] ?? 'muted'}`}>{wt.status[tpl.status] ?? tpl.status}</span>
            <span className="muted small mono">
              {tpl.name} · {tpl.language}
            </span>
          </p>
        )}
        {tpl.reason && (
          <p className="field-error">
            {tpl.reason}
            {wt.reasons[tpl.reason] && <span className="wa-reason"> · {wt.reasons[tpl.reason]}</span>}
          </p>
        )}
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
          {tooShort && <span className="field-error">{wt.tooShort(values, values * WORDS_PER_VALUE, words)}</span>}
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
        <DialogActions busy={save.busy} submitLabel={event.added ? t.save : wt.addThis} onCancel={onClose} />
      </form>

      {event.added && (
        <div className="wa-dialog-actions">
          <h3>{wt.actions}</h3>
          {dirty && <p className="muted small">{wt.saveFirst}</p>}
          {connected && (
            <div className="row">
              <button
                type="button"
                className="btn btn-outlined"
                disabled={busy !== null || dirty || tpl.status === 'APPROVED'}
                onClick={() => void run('submit', async () => wt.submitted((await submitTemplate(orgId, branchId, event.key)).status))}
              >
                {busy === 'submit' ? t.loading : wt.submit}
              </button>
            </div>
          )}
          {connected && (
            <div className="row wa-test-to">
              <TextField label={wt.testTo} type="tel" value={to} onChange={setTo} autoComplete="off" />
              <button
                type="button"
                className="btn btn-outlined"
                disabled={busy !== null || dirty || to.trim().length < 10}
                onClick={() => void run('test', async () => (await sendTest(orgId, branchId, to, event.key), wt.testSent))}
              >
                {busy === 'test' ? t.loading : wt.sendTest}
              </button>
            </div>
          )}
          {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
          <button
            type="button"
            className="btn btn-text danger"
            disabled={busy !== null}
            onClick={() => {
              if (window.confirm(wt.removeConfirm(event.label))) void run('remove', async () => (await removeTemplate(orgId, branchId, event.key), ''), true);
            }}
          >
            {busy === 'remove' ? t.loading : wt.remove}
          </button>
        </div>
      )}
    </Dialog>
  );
}

/** Every notification the branch can add, grouped by kind of transaction. */
function AddDialog({ events, onPick, onClose }: { events: MessageEvent[]; onPick: (e: MessageEvent) => void; onClose: () => void }) {
  const left = events.filter((e) => !e.added);
  return (
    <Dialog title={wt.addTitle} onClose={onClose}>
      {left.length === 0 ? (
        <p className="muted">{wt.allAdded}</p>
      ) : (
        GROUPS.filter((g) => left.some((e) => e.group === g)).map((g) => (
          <section key={g} className="wa-add-group" aria-label={wt.groups[g]}>
            <h3>{wt.groups[g]}</h3>
            <ul className="wa-add-list">
              {left
                .filter((e) => e.group === g)
                .map((e) => (
                  <li key={e.key}>
                    <button type="button" className="wa-add-item" onClick={() => onPick(e)}>
                      <span className="wa-add-label">{e.label}</span>
                      <span className="muted small">
                        {wt.audience[e.audience]} · {e.when}
                      </span>
                    </button>
                  </li>
                ))}
            </ul>
          </section>
        ))
      )}
      <div className="dialog-actions">
        <button type="button" className="btn btn-text" onClick={onClose}>
          {t.cancel}
        </button>
      </div>
    </Dialog>
  );
}

const GROUPS = ['MEMBERSHIP', 'PAYMENTS', 'BORROWING', 'RESERVATIONS', 'STAFF'] as const;

function TemplatesCard({ orgId, branchId, data, onChanged }: { orgId: string; branchId: string; data: Overview; onChanged: () => void }) {
  const [editing, setEditing] = useState<MessageEvent | null>(null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const run = async (key: string, fn: () => Promise<string | null>) => {
    setBusy(key);
    setMsg(null);
    try {
      const text = await fn();
      if (text) setMsg({ tone: 'ok', text });
      onChanged();
    } catch (e) {
      setMsg({ tone: 'error', text: toApiError(e).message });
    } finally {
      setBusy(null);
    }
  };
  const connected = !!data.settings;
  const added = data.events.filter((e) => e.added);
  const toggle = (e: MessageEvent) =>
    run(`toggle-${e.key}`, async () => {
      const tpl = e.template;
      await saveTemplate(orgId, branchId, { event: e.key, enabled: !tpl.enabled, name: tpl.name, language: tpl.language, body: tpl.body });
      return null;
    });
  return (
    <section className="section" aria-labelledby="wa-msgs">
      <div className="page-header-row">
        <h2 id="wa-msgs">{wt.messages}</h2>
        <div className="row">
          {connected && added.length > 0 && (
            <button
              type="button"
              className="btn btn-outlined"
              disabled={busy !== null}
              onClick={() =>
                void run('sync', async () => {
                  const r = await syncTemplates(orgId, branchId);
                  return wt.checked(r.statuses, r.missing.length);
                })
              }
            >
              {busy === 'sync' ? t.loading : wt.checkApprovals}
            </button>
          )}
          <button type="button" className="btn btn-filled" onClick={() => setAdding(true)} disabled={added.length === data.events.length}>
            {wt.add}
          </button>
        </div>
      </div>
      <p className="muted">{wt.messagesIntro}</p>
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      {added.length === 0 ? (
        <p className="muted">{wt.noneAdded}</p>
      ) : (
        <ul className="wa-list">
          {added.map((e) => {
            const tpl = e.template;
            return (
              <li key={e.key} className="wa-row">
                <button type="button" className="wa-row-main" onClick={() => setEditing(e)} aria-label={`${wt.edit}: ${e.label}`}>
                  <span className="wa-row-label">{e.label}</span>
                  <span className="muted small">
                    {wt.audience[e.audience]} · {wt.groups[e.group]}
                    {tpl.reason && <span className="wa-row-reason"> · {tpl.reason}</span>}
                  </span>
                </button>
                <span className={`badge badge-${STATUS_TONE[tpl.status] ?? 'muted'}`}>{wt.status[tpl.status] ?? tpl.status}</span>
                <label className="switch" title={tpl.enabled ? wt.on : wt.off_}>
                  <input type="checkbox" role="switch" checked={tpl.enabled} disabled={busy !== null} onChange={() => void toggle(e)} aria-label={`${wt.sendThis}: ${e.label}`} />
                  <span className="small">{tpl.enabled ? wt.on : wt.off_}</span>
                </label>
                <button type="button" className="btn btn-text" onClick={() => setEditing(e)}>
                  {wt.editShort}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {adding && (
        <AddDialog
          events={data.events}
          onClose={() => setAdding(false)}
          onPick={(e) => {
            setAdding(false);
            setEditing(e);
          }}
        />
      )}
      {editing && <TemplateDialog orgId={orgId} branchId={branchId} event={editing} connected={connected} onClose={() => setEditing(null)} onSaved={onChanged} />}
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
