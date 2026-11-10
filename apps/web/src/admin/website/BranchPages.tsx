import { useMemo } from 'react';
import { Link, useParams } from 'react-router';

import { AMENITIES, type BranchDraft, discardSite, getSite, type Librarian, listSite, liveUrl, previewUrl, publishSite, saveSite, todayInIndia, unpublishSite } from '../../data/site';
import { paths } from '../../paths';
import { useAsync } from '../../shared/useAsync';
import { EmptyState, ErrorState, SkeletonRows, TableWrap } from '../../shared/ui';
import { TextArea, TextField } from '../../shared/fields';
import { st } from '../../strings/site';
import { BookPicker, ImageField, ImagesField, ListEditor, PublishBar, RichField, savedLine, SiteStatusBadge, useEditor, WordsField } from './kit';

/** Every branch the caller may edit, with how its page stands. */
export function BranchPagesPage() {
  const list = useAsync(() => listSite('branch'), []);
  return (
    <>
      <header className="page-header">
        <p className="muted small"><Link to={paths.adminWebsite}>{st.title}</Link></p>
        <h1>{st.navBranches}</h1>
        <p className="muted">{st.branchesIntro}</p>
      </header>
      {list.loading ? (
        <SkeletonRows />
      ) : list.error ? (
        <ErrorState message={list.error} onRetry={list.reload} />
      ) : !list.data?.length ? (
        <EmptyState icon="store" title={st.noBranches} message="" />
      ) : (
        <TableWrap label={st.navBranches}>
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{st.branch}</th>
                <th scope="col">{st.statusLabel}</th>
                <th scope="col">{st.onWebsite}</th>
                <th scope="col">{st.lastSaved}</th>
              </tr>
            </thead>
            <tbody>
              {list.data.map((b) => (
                <tr key={b.id}>
                  <td>
                    <Link to={paths.adminWebsiteBranch(b.orgId!, b.id)}>{b.title}</Link>
                    {b.city && <span className="muted small"> · {b.city}</span>}
                  </td>
                  <td>
                    <SiteStatusBadge status={b.status} />
                  </td>
                  <td>{b.liveSlug ? <a href={liveUrl('branch', b.liveSlug)!} target="_blank" rel="noopener">/branches/{b.liveSlug}</a> : <span className="muted">{st.noPageYet}</span>}</td>
                  <td className="muted small">{savedLine(b.updatedBy, b.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
    </>
  );
}

const blankLibrarian = (): Librarian => ({ name: '', title: 'Head librarian', photo: null, bio: '', quote: '', since: null, languages: [], favourites: [] });

export function BranchPageEditorPage() {
  const { orgId = '', branchId = '' } = useParams();
  const item = useAsync(() => getSite<BranchDraft>('branch', branchId, orgId), [orgId, branchId]);
  const initial = useMemo(() => item.data?.draft ?? null, [item.data]);
  const e = useEditor<BranchDraft>(initial);
  const d = e.draft;
  if (item.loading) return <SkeletonRows />;
  if (item.error || !item.data || !d) return <ErrorState message={item.error ?? st.notFound} onRetry={item.reload} />;
  const info = item.data;
  const save = async () => {
    await saveSite('branch', d, branchId, orgId);
    e.setDirty(false);
    item.reload();
  };
  const lib = d.librarian;
  const setLib = (patch: Partial<Librarian>) => e.update({ librarian: { ...(lib ?? blankLibrarian()), ...patch } });
  const today = todayInIndia();

  return (
    <>
      <header className="page-header">
        <p className="muted small">
          <Link to={paths.adminWebsite}>{st.title}</Link> › <Link to={paths.adminWebsiteBranches}>{st.navBranches}</Link>
        </p>
        <h1>{info.branchName}</h1>
        <p className="muted">{st.branchEditorIntro}</p>
      </header>
      <PublishBar
        kind="branch"
        message={e.message}
        state={{
          status: info.status, dirty: e.dirty, busy: e.busy, canPublish: info.canPublish, isLive: info.isLive, changed: info.changed || !info.exists,
          liveUrl: liveUrl('branch', info.liveSlug), previewUrl: previewUrl('branch', info.id, info.previewToken), updated: savedLine(info.updatedBy, info.updatedAt),
        }}
        onSave={() => void e.run('save', save, st.saved)}
        onPublish={() => void e.run('publish', async () => { if (e.dirty || !info.exists) await save(); await publishSite('branch', branchId); item.reload(); }, d.hidden ? st.takenDown : st.published)}
        onUnpublish={() => void e.run('unpublish', async () => { await unpublishSite('branch', branchId); item.reload(); }, st.takenDown)}
        onDiscard={() => void e.run('discard', async () => { await discardSite('branch', branchId); item.reload(); }, st.discarded)}
      />

      <div className="editor-grid">
        <div className="editor-main">
          <section className="card" aria-labelledby="h-page">
            <h2 id="h-page" className="h3">{st.thePage}</h2>
            <TextField label={st.address} hint={st.addressHint(`/branches/${d.slug || '…'}`)} value={d.slug} onChange={(slug) => e.update({ slug: slug.toLowerCase().replace(/[^a-z0-9-]/g, '-') })} />
            <TextField label={st.tagline} hint={st.taglineHint} value={d.tagline} onChange={(tagline) => e.update({ tagline })} />
            <RichField label={st.introLabel} rows={3} value={d.intro} onChange={(intro) => e.update({ intro })} hint={st.branchIntroHint} />
            <RichField label={st.aboutLibrary} rows={8} value={d.about} onChange={(about) => e.update({ about })} hint={st.aboutLibraryHint} />
            <ImagesField label={st.photos} hint={st.photosHint} value={d.photos} onChange={(photos) => e.update({ photos })} max={12} />
          </section>

          <section className="card" aria-labelledby="h-info">
            <h2 id="h-info" className="h3">{st.importantInfo}</h2>
            <ListEditor
              legend={st.notices}
              hint={st.noticesHint}
              items={d.notices}
              onChange={(notices) => e.update({ notices })}
              make={() => ({ text: '', from: today, to: today, closed: false })}
              max={12}
              addLabel={st.addNotice}
            >
              {(n, set) => (
                <>
                  <TextArea label={st.noticeText} rows={2} value={n.text} onChange={(text) => set({ ...n, text })} />
                  <div className="form-grid">
                    <TextField label={st.from} type="date" value={n.from} onChange={(from) => set({ ...n, from })} />
                    <TextField label={st.to} type="date" value={n.to} onChange={(to) => set({ ...n, to })} />
                  </div>
                  <label className="check">
                    <input type="checkbox" checked={n.closed} onChange={(ev) => set({ ...n, closed: ev.target.checked })} /> {st.closedThen}
                  </label>
                  {n.to < today && <span className="muted small">{st.noticeOver}</span>}
                </>
              )}
            </ListEditor>
            <ListEditor legend={st.goodToKnow} hint={st.goodToKnowHint} items={d.goodToKnow} onChange={(goodToKnow) => e.update({ goodToKnow })} make={() => ''} max={10} addLabel={st.addPoint}>
              {(g, set, i) => <TextField label={`${st.point} ${i + 1}`} value={g} onChange={set} />}
            </ListEditor>
            <ListEditor legend={st.highlights} hint={st.highlightsHint} items={d.highlights} onChange={(highlights) => e.update({ highlights })} make={() => ({ value: '', label: '' })} max={6} addLabel={st.addHighlight}>
              {(h, set) => (
                <div className="form-grid">
                  <TextField label={st.figure} value={h.value} onChange={(value) => set({ ...h, value })} />
                  <TextField label={st.figureLabel} value={h.label} onChange={(label) => set({ ...h, label })} />
                </div>
              )}
            </ListEditor>
            <fieldset className="choices">
              <legend>{st.amenities}</legend>
              <div className="amenity-grid">
                {AMENITIES.map((a) => (
                  <label key={a} className="check">
                    <input type="checkbox" checked={d.amenities.includes(a)} onChange={(ev) => e.update({ amenities: ev.target.checked ? [...d.amenities, a] : d.amenities.filter((x) => x !== a) })} />
                    {st.amenity[a]}
                  </label>
                ))}
              </div>
            </fieldset>
          </section>

          <section className="card" aria-labelledby="h-activities">
            <h2 id="h-activities" className="h3">{st.activities}</h2>
            <ListEditor
              legend={st.activities}
              hint={st.activitiesHint}
              items={d.activities}
              onChange={(activities) => e.update({ activities })}
              make={() => ({ title: '', when: '', audience: '', text: '' })}
              max={10}
              addLabel={st.addActivity}
            >
              {(a, set) => (
                <>
                  <div className="form-grid">
                    <TextField label={st.activityTitle} value={a.title} onChange={(title) => set({ ...a, title })} />
                    <TextField label={st.activityWhen} hint={st.activityWhenHint} value={a.when} onChange={(when) => set({ ...a, when })} />
                  </div>
                  <TextField label={st.activityFor} hint={st.activityForHint} value={a.audience} onChange={(audience) => set({ ...a, audience })} />
                  <TextArea label={st.activityText} rows={2} value={a.text} onChange={(text) => set({ ...a, text })} />
                </>
              )}
            </ListEditor>
          </section>

          <section className="card" aria-labelledby="h-librarian">
            <h2 id="h-librarian" className="h3">{st.librarian}</h2>
            <p className="muted small">{st.librarianHint}</p>
            {!lib ? (
              <button type="button" className="btn btn-outlined" onClick={() => e.update({ librarian: blankLibrarian() })}>
                {st.addLibrarian}
              </button>
            ) : (
              <>
                <div className="form-grid">
                  <TextField label={st.librarianName} value={lib.name} onChange={(name) => setLib({ name })} />
                  <TextField label={st.librarianTitle} value={lib.title} onChange={(title) => setLib({ title })} />
                </div>
                <ImageField label={st.librarianPhoto} hint={st.librarianPhotoHint} value={lib.photo} onChange={(photo) => setLib({ photo })} />
                <RichField label={st.librarianBio} rows={5} value={lib.bio} onChange={(bio) => setLib({ bio })} hint={st.librarianBioHint} />
                <TextArea label={st.librarianQuote} hint={st.librarianQuoteHint} rows={2} value={lib.quote} onChange={(quote) => setLib({ quote })} />
                <div className="form-grid">
                  <TextField label={st.librarianSince} type="number" value={lib.since ? String(lib.since) : ''} onChange={(v) => setLib({ since: v ? Number(v) : null })} />
                  <WordsField label={st.librarianLanguages} hint={st.commaList} value={lib.languages} onChange={(languages) => setLib({ languages })} max={6} />
                </div>
                <WordsField label={st.librarianFavourites} hint={st.librarianFavouritesHint} value={lib.favourites} onChange={(favourites) => setLib({ favourites })} max={6} />
                <button type="button" className="btn btn-text align-start" onClick={() => e.update({ librarian: null })}>
                  {st.removeLibrarian}
                </button>
              </>
            )}
            <BookPicker legend={st.picks} hint={st.picksHint} value={d.picks} onChange={(picks) => e.update({ picks })} max={12} />
          </section>
        </div>

        <aside className="editor-side">
          <section className="card">
            <h2 className="h3">{st.contactOnPage}</h2>
            <p className="muted small">{st.contactOnPageHint}</p>
            <TextField label={st.whatsapp} hint={st.whatsappHint} value={d.whatsapp} onChange={(whatsapp) => e.update({ whatsapp })} />
            <TextField label={st.mapLink} hint={st.mapLinkHint} value={d.mapUrl} onChange={(mapUrl) => e.update({ mapUrl })} />
          </section>
          <section className="card">
            <label className="check">
              <input type="checkbox" checked={d.hidden} onChange={(ev) => e.update({ hidden: ev.target.checked })} />
              {st.hideFromWebsite}
            </label>
            <p className="muted small">{st.hideBranchHint}</p>
          </section>
        </aside>
      </div>
    </>
  );
}
