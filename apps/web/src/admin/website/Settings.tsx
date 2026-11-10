import { useMemo } from 'react';
import { Link } from 'react-router';

import { discardSite, getSite, publishSite, saveSite, type SettingsDraft, SITE_URL } from '../../data/site';
import { paths } from '../../paths';
import { useAsync } from '../../shared/useAsync';
import { ErrorState, SkeletonRows } from '../../shared/ui';
import { TextArea, TextField } from '../../shared/fields';
import { st } from '../../strings/site';
import { ImageField, ImagesField, ListEditor, PublishBar, RichField, savedLine, useEditor } from './kit';

/** Site-wide words: the About page, the people behind Stories, more questions for How it works, social links. */
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
        <p className="muted small"><Link to={paths.adminWebsite}>{st.title}</Link></p>
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

        <section className="card" aria-labelledby="h-faqs">
          <h2 id="h-faqs" className="h3">{st.faqs}</h2>
          <ListEditor legend={st.faqs} hint={st.faqsHint} items={d.faqs} onChange={(faqs) => e.update({ faqs })} make={() => ({ q: '', a: '' })} max={30} addLabel={st.addFaq}>
            {(f, set) => (
              <>
                <TextField label={st.question} value={f.q} onChange={(q) => set({ ...f, q })} />
                <TextArea label={st.answer} rows={3} value={f.a} onChange={(a) => set({ ...f, a })} />
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
