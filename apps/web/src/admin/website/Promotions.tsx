import { useMemo } from 'react';
import { Link, useNavigate, useParams } from 'react-router';

import { deleteSite, getSite, listSite, PLACEMENTS, type PromotionDraft, publishSite, saveSite, todayInIndia, TONES, unpublishSite } from '../../data/site';
import { paths } from '../../paths';
import { useAsync } from '../../shared/useAsync';
import { EmptyState, ErrorState, Icon, SkeletonRows, TableWrap } from '../../shared/ui';
import { SelectField, TextArea, TextField } from '../../shared/fields';
import { st } from '../../strings/site';
import { useWorkspace } from '../Workspace';
import { ImageField, PublishBar, savedLine, SiteStatusBadge, useEditor } from './kit';

export function PromotionsPage() {
  const list = useAsync(() => listSite('promotion'), []);
  return (
    <>
      <header className="page-header page-header-row">
        <div>
            <h1>{st.navPromotions}</h1>
          <p className="muted">{st.promotionsIntro}</p>
        </div>
        <Link className="btn btn-filled" to={paths.adminWebsitePromotion('new')}>
          <Icon name="plus" /> {st.newPromotion}
        </Link>
      </header>
      {list.loading ? (
        <SkeletonRows />
      ) : list.error ? (
        <ErrorState message={list.error} onRetry={list.reload} />
      ) : !list.data?.length ? (
        <EmptyState icon="card" title={st.noPromotions} message={st.noPromotionsHint} />
      ) : (
        <TableWrap label={st.navPromotions}>
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{st.promoTitle}</th>
                <th scope="col">{st.placement}</th>
                <th scope="col">{st.dates}</th>
                <th scope="col">{st.statusLabel}</th>
                <th scope="col">{st.lastSaved}</th>
              </tr>
            </thead>
            <tbody>
              {list.data.map((p) => (
                <tr key={p.id}>
                  <td>
                    <Link to={paths.adminWebsitePromotion(p.id)}>{p.title}</Link>
                  </td>
                  <td>{st.placements[(p.placement ?? 'BAR') as PromotionDraft['placement']].name}</td>
                  <td className="nowrap">
                    {p.startOn} → {p.endOn}
                  </td>
                  <td>
                    <SiteStatusBadge status={p.status} />
                  </td>
                  <td className="muted small">{savedLine(p.updatedBy, p.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
    </>
  );
}

const blank = (): PromotionDraft => {
  const today = todayInIndia();
  const end = new Date(Date.parse(`${today}T00:00:00Z`) + 13 * 86_400_000).toISOString().slice(0, 10);
  return { title: '', message: '', placement: 'BAR', image: null, cta: { label: 'Become a member', url: '/account/sign-in?create=1' }, code: '', branchIds: [], startOn: today, endOn: end, tone: 'SUN', hidden: false };
};

export function PromotionEditorPage() {
  const { promotionId = 'new' } = useParams();
  const isNew = promotionId === 'new';
  const navigate = useNavigate();
  const { branches } = useWorkspace();
  const item = useAsync(() => (isNew ? Promise.resolve(null) : getSite<PromotionDraft>('promotion', promotionId)), [promotionId]);
  const initial = useMemo(() => (isNew ? blank() : (item.data?.draft ?? null)), [isNew, item.data]);
  const e = useEditor<PromotionDraft>(initial);
  const d = e.draft;
  if (!isNew && item.loading) return <SkeletonRows />;
  if (!isNew && (item.error || !item.data)) return <ErrorState message={item.error ?? st.notFound} onRetry={item.reload} />;
  if (!d) return <SkeletonRows />;
  const info = item.data;
  const save = async () => {
    const r = await saveSite('promotion', d, isNew ? undefined : promotionId);
    e.setDirty(false);
    if (isNew) navigate(paths.adminWebsitePromotion(r.id), { replace: true });
    else item.reload();
    return r.id;
  };
  const activeBranches = branches.filter((b) => b.status === 'ACTIVE');
  return (
    <>
      <header className="page-header">
        <p className="muted small">
          <Link to={paths.adminWebsitePromotions}>{st.navPromotions}</Link>
        </p>
        <h1>{isNew ? st.newPromotion : d.title || st.untitled}</h1>
      </header>
      <PublishBar
        kind="promotion"
        message={e.message}
        state={{ status: info?.status ?? 'NONE', dirty: e.dirty, busy: e.busy, canPublish: true, isLive: info?.isLive ?? false, changed: info?.changed ?? true, updated: savedLine(info?.updatedBy ?? null, info?.updatedAt ?? null) }}
        onSave={() => void e.run('save', save, st.saved)}
        onPublish={() => void e.run('publish', async () => { const id = e.dirty || isNew ? await save() : promotionId; await publishSite('promotion', id); item.reload(); }, d.hidden ? st.takenDown : st.promoPublished(d.startOn, d.endOn))}
        onUnpublish={info ? () => void e.run('unpublish', async () => { await unpublishSite('promotion', promotionId); item.reload(); }, st.takenDown) : undefined}
        onDelete={info ? () => { if (confirm(st.deleteConfirm(d.title))) void e.run('delete', async () => { await deleteSite('promotion', promotionId); navigate(paths.adminWebsitePromotions); }); } : undefined}
      />
      <div className="editor-grid">
        <section className="card editor-main" aria-label={st.promotion}>
          <TextField label={st.promoTitle} hint={st.promoTitleHint} value={d.title} onChange={(title) => e.update({ title })} />
          <TextArea label={st.promoMessage} hint={st.promoMessageHint} rows={3} value={d.message} onChange={(message) => e.update({ message })} />
          <div className="form-grid">
            <TextField label={st.buttonLabel} value={d.cta?.label ?? ''} onChange={(label) => e.update({ cta: label || d.cta?.url ? { label, url: d.cta?.url ?? '/plans' } : null })} />
            <TextField label={st.buttonLink} hint={st.linkHint} value={d.cta?.url ?? ''} onChange={(url) => e.update({ cta: d.cta || url ? { label: d.cta?.label ?? '', url } : null })} />
          </div>
          <TextField label={st.promoCode} hint={st.promoCodeHint} value={d.code} onChange={(code) => e.update({ code: code.toUpperCase().replace(/[^A-Z0-9-]/g, '') })} />
          {d.placement !== 'BAR' && <ImageField label={st.promoImage} hint={st.promoImageHint} value={d.image} onChange={(image) => e.update({ image })} />}
          <div className={`promo-preview tone-${d.tone.toLowerCase()} place-${d.placement.toLowerCase()}`} aria-label={st.previewHere}>
            <strong>{d.title || st.promoTitle}</strong> {d.message && <span>{d.message}</span>} {d.code && <span className="promo-code">{d.code}</span>} {d.cta?.label && <u>{d.cta.label}</u>}
          </div>
        </section>
        <aside className="editor-side">
          <section className="card">
            <h2 className="h3">{st.placement}</h2>
            <div className="design-picks" role="radiogroup" aria-label={st.placement}>
              {PLACEMENTS.map((k) => (
                <label key={k} className={`design-pick${d.placement === k ? ' on' : ''}`}>
                  <input type="radio" name="placement" checked={d.placement === k} onChange={() => e.update({ placement: k })} />
                  <strong>{st.placements[k].name}</strong>
                  <span className="muted small">{st.placements[k].text}</span>
                </label>
              ))}
            </div>
          </section>
          <section className="card">
            <h2 className="h3">{st.when}</h2>
            <div className="form-grid">
              <TextField label={st.from} type="date" value={d.startOn} onChange={(startOn) => e.update({ startOn })} />
              <TextField label={st.to} type="date" value={d.endOn} onChange={(endOn) => e.update({ endOn })} error={d.endOn < d.startOn ? st.endBeforeStart : undefined} />
            </div>
            <p className="muted small">{st.whenHint}</p>
            <SelectField label={st.colour} value={d.tone} options={TONES.map((x) => ({ value: x, label: st.tones[x] }))} onChange={(tone) => e.update({ tone })} />
          </section>
          <section className="card">
            <fieldset className="choices">
              <legend>{st.where}</legend>
              <label className="check">
                <input type="radio" name="where" checked={!d.branchIds.length} onChange={() => e.update({ branchIds: [] })} /> {st.everywhere}
              </label>
              <label className="check">
                <input type="radio" name="where" checked={!!d.branchIds.length} onChange={() => e.update({ branchIds: activeBranches.slice(0, 1).map((b) => b.id) })} /> {st.someBranches}
              </label>
              {!!d.branchIds.length &&
                activeBranches.map((b) => (
                  <label key={b.id} className="check indent">
                    <input type="checkbox" checked={d.branchIds.includes(b.id)} onChange={(ev) => e.update({ branchIds: ev.target.checked ? [...d.branchIds, b.id] : d.branchIds.filter((x) => x !== b.id) })} />
                    {b.name}
                  </label>
                ))}
              <p className="muted small">{st.whereHint}</p>
            </fieldset>
          </section>
          <section className="card">
            <label className="check">
              <input type="checkbox" checked={d.hidden} onChange={(ev) => e.update({ hidden: ev.target.checked })} />
              {st.pausePromotion}
            </label>
          </section>
        </aside>
      </div>
    </>
  );
}
