import { useMemo } from 'react';

import { discardSite, getSite, publishSite, saveSite, type SettingsDraft, SITE_URL } from '../../data/site';
import { useAsync } from '../../shared/useAsync';
import { ErrorState, SkeletonRows } from '../../shared/ui';
import { TextArea, TextField } from '../../shared/fields';
import { st } from '../../strings/site';
import { ImageField, ImagesField, ListEditor, PublishBar, RichField, savedLine, useEditor } from './kit';

/** Site settings (as on crossmaze.in): contact details, the home page's banner, the About page and its people, social links. */
export function SiteSettingsPage() {
  const item = useAsync(() => getSite<SettingsDraft>('settings'), []);
  const initial = useMemo(() => item.data?.draft ?? null, [item.data]);
  const e = useEditor<SettingsDraft>(initial);
  const d = e.draft;
  if (item.loading) return <SkeletonRows />;
  if (item.error || !item.data || !d) return <ErrorState message={item.error ?? st.notFound} onRetry={item.reload} />;
  const info = item.data;
  const save = async () => {
    await saveSite('settings', d);
    e.setDirty(false);
    item.reload();
  };
  const about = d.about;
  const setAbout = (patch: Partial<SettingsDraft['about']>) => e.update({ about: { ...about, ...patch } });
  return (
    <>
      <header className="page-header">
        <h1>{st.navSettings}</h1>
        <p className="muted">{st.settingsIntro}</p>
      </header>
      <PublishBar
        kind="settings"
        message={e.message}
        state={{ status: info.status, dirty: e.dirty, busy: e.busy, canPublish: info.canPublish, isLive: info.isLive, changed: info.changed || !info.exists, liveUrl: `${SITE_URL}/about`, updated: savedLine(info.updatedBy, info.updatedAt) }}
        onSave={() => void e.run('save', save, st.saved)}
        onPublish={() => void e.run('publish', async () => { if (e.dirty || !info.exists) await save(); await publishSite('settings'); item.reload(); }, st.published)}
        onDiscard={() => void e.run('discard', async () => { await discardSite('settings'); item.reload(); }, st.discarded)}
      />
      <div className="editor-main">
        <section className="card" aria-labelledby="h-contact">
          <h2 id="h-contact" className="h3">{st.contactDetails}</h2>
          <p className="muted small">{st.contactDetailsHint}</p>
          <div className="form-grid">
            <TextField label={st.mainPhone} type="tel" value={d.contact.phone} onChange={(phone) => e.update({ contact: { ...d.contact, phone } })} />
            <TextField label={st.whatsapp} hint={st.whatsappHint} type="tel" value={d.contact.whatsapp} onChange={(whatsapp) => e.update({ contact: { ...d.contact, whatsapp } })} />
            <TextField label={st.generalEmail} hint={st.generalEmailHint} type="email" value={d.contact.email} onChange={(email) => e.update({ contact: { ...d.contact, email: email.trim() } })} />
            <TextField label={st.franchiseEmail} hint={st.emptyUsesGeneral} type="email" value={d.contact.franchiseEmail} onChange={(franchiseEmail) => e.update({ contact: { ...d.contact, franchiseEmail: franchiseEmail.trim() } })} />
            <TextField label={st.careersEmail} type="email" value={d.contact.careersEmail} onChange={(careersEmail) => e.update({ contact: { ...d.contact, careersEmail: careersEmail.trim() } })} />
          </div>
        </section>

        <section className="card" aria-labelledby="h-banner">
          <h2 id="h-banner" className="h3">{st.homeBanner}</h2>
          <p className="muted small">{st.homeBannerHint}</p>
          <div className="form-grid">
            <TextField label={st.heading} value={d.banner.heading} onChange={(heading) => e.update({ banner: { ...d.banner, heading } })} />
            <TextField label={st.highlight} hint={st.highlightHint} value={d.banner.highlight} onChange={(highlight) => e.update({ banner: { ...d.banner, highlight } })} />
          </div>
          <TextArea label={st.introLabel} rows={3} value={d.banner.intro} onChange={(intro) => e.update({ banner: { ...d.banner, intro } })} />
        </section>

        <section className="card" aria-labelledby="h-about">
          <h2 id="h-about" className="h3">{st.aboutPage}</h2>
          <TextField label={st.heading} hint={st.aboutHeadingHint} value={about.heading} onChange={(heading) => setAbout({ heading })} />
          <TextArea label={st.introLabel} rows={2} value={about.intro} onChange={(intro) => setAbout({ intro })} />
          <RichField label={st.aboutStory} rows={10} value={about.body} onChange={(body) => setAbout({ body })} hint={st.aboutStoryHint} />
          <ListEditor legend={st.highlights} hint={st.aboutFactsHint} items={about.facts} onChange={(facts) => setAbout({ facts })} make={() => ({ value: '', label: '' })} max={6} addLabel={st.addHighlight}>
            {(f, set) => (
              <div className="form-grid">
                <TextField label={st.figure} value={f.value} onChange={(value) => set({ ...f, value })} />
                <TextField label={st.figureLabel} value={f.label} onChange={(label) => set({ ...f, label })} />
              </div>
            )}
          </ListEditor>
          <ImagesField label={st.photos} value={about.photos} onChange={(photos) => setAbout({ photos })} max={8} />
        </section>

        <section className="card" aria-labelledby="h-team">
          <h2 id="h-team" className="h3">{st.team}</h2>
          <label className="check">
            <input type="checkbox" checked={d.showTeam} onChange={(ev) => e.update({ showTeam: ev.target.checked })} /> {st.showTeam}
          </label>
          <ListEditor legend={st.team} hint={st.teamHint} items={d.team} onChange={(team) => e.update({ team })} make={() => ({ name: '', role: '', photo: null, bio: '' })} max={12} addLabel={st.addPerson}>
            {(m, set) => (
              <>
                <div className="form-grid">
                  <TextField label={st.librarianName} value={m.name} onChange={(name) => set({ ...m, name })} />
                  <TextField label={st.role} value={m.role} onChange={(role) => set({ ...m, role })} />
                </div>
                <ImageField label={st.librarianPhoto} value={m.photo} onChange={(photo) => set({ ...m, photo })} />
                <TextArea label={st.bio} rows={3} value={m.bio} onChange={(bio) => set({ ...m, bio })} />
              </>
            )}
          </ListEditor>
        </section>

        <section className="card" aria-labelledby="h-social">
          <h2 id="h-social" className="h3">{st.social}</h2>
          <p className="muted small">{st.socialHint}</p>
          <div className="form-grid">
            {(['instagram', 'facebook', 'youtube', 'x'] as const).map((k) => (
              <TextField key={k} label={st.socialName[k]} type="url" value={d.social[k]} onChange={(v) => e.update({ social: { ...d.social, [k]: v.trim() } })} />
            ))}
          </div>
        </section>
      </div>
    </>
  );
}
