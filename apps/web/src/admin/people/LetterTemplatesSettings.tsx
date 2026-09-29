// Settings → Letter templates (docs/HRMS.md §13): offer, appointment and custom letters, per branch or for all branches.
import { useState } from 'react';

import { ApiError } from '../../data/api';
import { archiveTemplate, type LetterTemplate, listTemplates, previewTemplate, publishTemplate, saveTemplate, type TemplateDefaults, templateDefaults, type TemplateText, usedPlaceholders } from '../../data/letterTemplates';
import type { LetterKind } from '../../data/offers';
import { ErrorState, Icon, SkeletonRows } from '../../shared/ui';
import { useAsync } from '../../shared/useAsync';
import { t } from '../../strings';
import { ht } from '../../strings/hr';
import { Notice } from '../components/kit';
import { ConfirmWithReason, Dialog, FormError, SelectField, TextArea, TextField } from '../components/Dialog';
import { useWorkspace } from '../Workspace';

const KINDS: LetterKind[] = ['OFFER', 'APPOINTMENT', 'CUSTOM'];
const statusTone: Record<string, string> = { DRAFT: 'info', PUBLISHED: 'ok', ARCHIVED: 'muted' };

type Draft = TemplateText & { templateId?: string; branchId: string | null };

function TemplateDialog({ orgId, draft, defaults, published, onClose, onSaved }: { orgId: string; draft: Draft; defaults: TemplateDefaults; published: boolean; onClose: () => void; onSaved: (msg: string) => void }) {
  const { branches } = useWorkspace();
  const [f, setF] = useState<Draft>(draft);
  const set = <K extends keyof Draft>(k: K) => (v: Draft[K]) => setF((x) => ({ ...x, [k]: v }));
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState<'preview' | 'save' | 'publish' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const unknown = usedPlaceholders(`${f.subject}\n${f.body}`).filter((p) => !(p in defaults.placeholders));
  const errors = {
    name: f.name.trim().length >= 2 ? undefined : t.required,
    subject: f.subject.trim().length >= 3 ? undefined : t.required,
    body: f.body.trim().length < 20 ? ht.tplBodyShort : unknown.length ? ht.tplUnknown(unknown) : undefined,
  };
  const e = (k: keyof typeof errors) => (touched ? errors[k] : undefined);
  const fixed = !!f.templateId && published;
  const run = async (what: 'preview' | 'save' | 'publish') => {
    setTouched(true);
    if (Object.values(errors).some(Boolean) || busy) return;
    setBusy(what);
    setError(null);
    try {
      const text = { ...f, name: f.name.trim(), subject: f.subject.trim(), body: f.body.trim() };
      if (what === 'preview') await previewTemplate(orgId, text);
      else {
        const { templateId } = await saveTemplate(orgId, text);
        if (what === 'publish') await publishTemplate(orgId, templateId);
        onSaved(what === 'publish' ? ht.tplPublished(text.name) : ht.tplSaved(text.name));
        onClose();
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.errorGeneric);
    } finally {
      setBusy(null);
    }
  };
  return (
    <Dialog title={f.templateId ? ht.tplEdit : ht.tplNew} onClose={onClose}>
      <form
        onSubmit={(ev) => {
          ev.preventDefault();
          void run('save');
        }}
        noValidate
      >
        <div className="form-grid">
          <TextField label={ht.tplName} value={f.name} onChange={set('name')} error={e('name')} />
          <SelectField label={ht.tplKind} value={f.kind} disabled={fixed} onChange={set('kind')} options={KINDS.map((k) => ({ value: k, label: ht.tplKinds[k] }))} />
          <SelectField
            label={ht.tplAppliesTo}
            value={f.branchId ?? ''}
            disabled={fixed}
            onChange={(v) => set('branchId')(v || null)}
            hint={ht.tplAppliesHint}
            options={[{ value: '', label: ht.tplAllBranches }, ...branches.filter((b) => b.status === 'ACTIVE').map((b) => ({ value: b.id, label: b.name }))]}
          />
          <TextField label={ht.tplSubject} value={f.subject} onChange={set('subject')} error={e('subject')} />
        </div>
        <TextArea label={ht.tplBody} rows={14} value={f.body} onChange={set('body')} hint={ht.tplBodyHint} error={e('body')} />
        <label className="check">
          <input type="checkbox" checked={f.acceptance} onChange={(ev) => set('acceptance')(ev.target.checked)} /> {ht.tplAcceptance}
        </label>
        <details className="numbering-help">
          <summary>{ht.tplPlaceholders}</summary>
          <dl>
            {Object.entries(defaults.placeholders).map(([k, v]) => (
              <div key={k}>
                <dt className="mono">{`{{${k}}}`}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </details>
        {published && <p className="muted small">{ht.tplLiveNote}</p>}
        <FormError error={error} />
        <div className="dialog-actions">
          <button type="button" className="btn btn-text" onClick={onClose} disabled={!!busy}>
            {t.cancel}
          </button>
          <button type="button" className="btn btn-outlined" onClick={() => void run('preview')} disabled={!!busy}>
            {busy === 'preview' ? t.loading : ht.offerPreview}
          </button>
          <button type="submit" className={`btn ${published ? 'btn-filled' : 'btn-outlined'}`} disabled={!!busy}>
            {busy === 'save' ? t.saving : published ? t.save : ht.tplSaveDraft}
          </button>
          {!published && (
            <button type="button" className="btn btn-filled" onClick={() => void run('publish')} disabled={!!busy}>
              {busy === 'publish' ? t.saving : ht.tplSavePublish}
            </button>
          )}
        </div>
      </form>
    </Dialog>
  );
}

export function LetterTemplatesSection({ orgId }: { orgId: string }) {
  const { branchName } = useWorkspace();
  const list = useAsync(() => listTemplates(orgId), [orgId]);
  const defaults = useAsync(() => templateDefaults(orgId), [orgId]);
  const [editing, setEditing] = useState<{ draft: Draft; published: boolean } | null>(null);
  const [archiving, setArchiving] = useState<LetterTemplate | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const templates = list.data ?? [];
  const shown = templates.filter((x) => showArchived || x.status !== 'ARCHIVED');
  const hasOrgWide = (kind: LetterKind) => templates.some((x) => x.kind === kind && !x.branchId && x.status === 'PUBLISHED');
  const saved = (msg: string) => {
    setNotice(msg);
    list.reload();
  };
  const publish = async (x: LetterTemplate) => {
    setError(null);
    try {
      await publishTemplate(orgId, x.id);
      saved(ht.tplPublished(x.name));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.errorGeneric);
    }
  };
  const copy = (x: TemplateText, branchId: string | null, name?: string): Draft => ({ name: name ?? x.name, kind: x.kind, subject: x.subject, body: x.body, acceptance: x.acceptance, branchId });

  if (list.loading || defaults.loading) return <SkeletonRows rows={4} />;
  if (list.error || defaults.error) return <ErrorState message={list.error ?? defaults.error ?? ''} onRetry={() => (list.reload(), defaults.reload())} />;
  const d = defaults.data!;

  return (
    <section className="section" aria-labelledby="tpl-h">
      <div className="page-header-row">
        <h2 className="sr-only" id="tpl-h">
          {ht.navLetterTemplates}
        </h2>
        <button type="button" className="btn btn-filled" onClick={() => setEditing({ draft: { name: '', kind: 'CUSTOM', subject: '', body: 'Dear {{firstName}},\n\n', acceptance: false, branchId: null }, published: false })}>
          <Icon name="plus" /> {ht.tplNew}
        </button>
      </div>
      <p className="muted">{ht.tplIntro}</p>
      {notice && <Notice tone="ok">{notice}</Notice>}
      <FormError error={error} />

      <h3>{ht.tplBuiltIn}</h3>
      <ul className="plain-list">
        {(['OFFER', 'APPOINTMENT'] as const).map((k) => (
          <li key={k}>
            <span>
              <strong>{d.builtIn[k].name}</strong> <span className="badge badge-muted">{ht.tplBuiltInBadge}</span>
              <div className="muted small">{hasOrgWide(k) ? ht.tplBuiltInReplaced : ht.tplBuiltInInUse}</div>
            </span>
            <span className="cell-actions">
              <button type="button" className="btn btn-text" onClick={() => void previewTemplate(orgId, { ...d.builtIn[k], branchId: null }).catch(() => undefined)}>
                {ht.offerPreview}
              </button>
              <button type="button" className="btn btn-text" onClick={() => setEditing({ draft: copy(d.builtIn[k], null), published: false })} aria-label={`${ht.tplCustomize} ${d.builtIn[k].name}`}>
                {ht.tplCustomize}
              </button>
            </span>
          </li>
        ))}
      </ul>

      <h3>{ht.tplYours}</h3>
      {!shown.length ? (
        <p className="muted">{ht.tplNone}</p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{ht.tplName}</th>
                <th scope="col">{ht.tplAppliesTo}</th>
                <th scope="col">{ht.colStatus}</th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((x) => (
                <tr key={x.id}>
                  <td>
                    {x.name}
                    <div className="muted small">{ht.tplKinds[x.kind]}</div>
                  </td>
                  <td>{x.branchId ? branchName(x.branchId) : ht.tplAllBranches}</td>
                  <td>
                    <span className={`badge badge-${statusTone[x.status]}`}>{ht.tplStatus[x.status]}</span>
                  </td>
                  <td className="cell-actions">
                    {x.status !== 'ARCHIVED' && (
                      <>
                        <button type="button" className="btn btn-text" onClick={() => setEditing({ draft: { ...copy(x, x.branchId), templateId: x.id }, published: x.status === 'PUBLISHED' })} aria-label={`${t.edit} ${x.name}`}>
                          {t.edit}
                        </button>
                        {x.status === 'DRAFT' && (
                          <button type="button" className="btn btn-text" onClick={() => void publish(x)} aria-label={`${ht.tplPublish} ${x.name}`}>
                            {ht.tplPublish}
                          </button>
                        )}
                        {!x.branchId && (
                          <button type="button" className="btn btn-text" onClick={() => setEditing({ draft: copy(x, null, `${x.name} (branch)`), published: false })} aria-label={`${ht.tplCopyForBranch} ${x.name}`}>
                            {ht.tplCopyForBranch}
                          </button>
                        )}
                        <button type="button" className="btn btn-text" onClick={() => setArchiving(x)} aria-label={`${t.archive} ${x.name}`}>
                          {t.archive}
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
      {templates.some((x) => x.status === 'ARCHIVED') && (
        <label className="check">
          <input type="checkbox" checked={showArchived} onChange={(ev) => setShowArchived(ev.target.checked)} /> {ht.tplShowArchived}
        </label>
      )}
      {editing && <TemplateDialog orgId={orgId} draft={editing.draft} published={editing.published} defaults={d} onClose={() => setEditing(null)} onSaved={saved} />}
      {archiving && (
        <ConfirmWithReason
          title={ht.tplArchiveTitle(archiving.name)}
          body={ht.tplArchiveBody}
          confirmLabel={t.archive}
          onClose={() => setArchiving(null)}
          onConfirm={async (reason) => {
            await archiveTemplate(orgId, archiving.id, reason);
            setArchiving(null);
            list.reload();
          }}
        />
      )}
    </section>
  );
}
