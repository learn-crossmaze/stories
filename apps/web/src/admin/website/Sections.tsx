import { type SectionsDraft, SITE_URL, type Tile } from '../../data/site';
import { ErrorState, SkeletonRows } from '../../shared/ui';
import { TextArea, TextField } from '../../shared/fields';
import { st } from '../../strings/site';
import { ListEditor, PublishBar, useSiteItem } from './kit';

/** A list of title + text items; an empty list keeps the page's built-in words. */
function TileList({ legend, hint, items, onChange, max, addLabel }: { legend: string; hint: string; items: Tile[]; onChange: (v: Tile[]) => void; max: number; addLabel: string }) {
  return (
    <ListEditor legend={legend} hint={`${hint} ${st.emptyKeepsBuiltIn}`} items={items} onChange={onChange} make={() => ({ title: '', text: '' })} max={max} addLabel={addLabel}>
      {(t, set) => (
        <>
          <TextField label={st.tileTitle} value={t.title} onChange={(title) => set({ ...t, title })} />
          <TextArea label={st.text} rows={2} value={t.text} onChange={(text) => set({ ...t, text })} />
        </>
      )}
    </ListEditor>
  );
}

/**
 * Page sections (as on crossmaze.in): the lists that appear on the website's pages: the home page's promises, steps and
 * reader groups, How it works' steps and questions, the franchise and careers pages' points.
 */
export function SectionsPage() {
  const item = useSiteItem<SectionsDraft>({ kind: 'sections' });
  const { e } = item;
  const d = e.draft;
  if (item.loading) return <SkeletonRows />;
  if (item.error || !d) return <ErrorState message={item.error ?? st.notFound} onRetry={item.reload} />;
  return (
    <>
      <header className="page-header">
        <h1>{st.navSections}</h1>
        <p className="muted">{st.sectionsIntro}</p>
      </header>
      <PublishBar
        kind="sections"
        message={e.message}
        state={{ ...item.state, liveUrl: SITE_URL }}
        onSave={item.save}
        onPublish={() => item.publish(st.published)}
        onDiscard={item.discard}
      />
      <div className="editor-main">
        <section className="card" aria-labelledby="h-home">
          <h2 id="h-home" className="h3">{st.homePage}</h2>
          <TileList legend={st.secPromises} hint={st.secPromisesHint} items={d.promises} onChange={(promises) => e.update({ promises })} max={6} addLabel={st.addItem} />
          <TileList legend={st.secHomeSteps} hint={st.secHomeStepsHint} items={d.homeSteps} onChange={(homeSteps) => e.update({ homeSteps })} max={4} addLabel={st.addStep} />
          <TileList legend={st.secReaders} hint={st.secReadersHint} items={d.readers} onChange={(readers) => e.update({ readers })} max={4} addLabel={st.addItem} />
        </section>
        <section className="card" aria-labelledby="h-how">
          <h2 id="h-how" className="h3">{st.howPage}</h2>
          <TileList legend={st.secHowSteps} hint={st.secHowStepsHint} items={d.howSteps} onChange={(howSteps) => e.update({ howSteps })} max={6} addLabel={st.addStep} />
          <ListEditor legend={st.faqs} hint={st.faqsHint} items={d.faqs} onChange={(faqs) => e.update({ faqs })} make={() => ({ q: '', a: '' })} max={30} addLabel={st.addFaq}>
            {(f, set) => (
              <>
                <TextField label={st.question} value={f.q} onChange={(q) => set({ ...f, q })} />
                <TextArea label={st.answer} rows={3} value={f.a} onChange={(a) => set({ ...f, a })} />
              </>
            )}
          </ListEditor>
        </section>
        <section className="card" aria-labelledby="h-other">
          <h2 id="h-other" className="h3">{st.otherPages}</h2>
          <TileList legend={st.secFranchise} hint={st.secFranchiseHint} items={d.franchisePerks} onChange={(franchisePerks) => e.update({ franchisePerks })} max={6} addLabel={st.addItem} />
          <TileList legend={st.secCareers} hint={st.secCareersHint} items={d.careerPerks} onChange={(careerPerks) => e.update({ careerPerks })} max={8} addLabel={st.addItem} />
        </section>
      </div>
    </>
  );
}
