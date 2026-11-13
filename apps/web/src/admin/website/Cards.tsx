import { useEffect, useMemo, useState } from 'react';

// The website's own card engine (apps/site/src/greetings), so the previews here are exactly what visitors see.
import { datesTable, nextDate } from '../../../../site/src/greetings/calendar';
import { estimate, type Measure, renderCard } from '../../../../site/src/greetings/card';
import dates from '../../../../site/src/greetings/dates.json';
import { kits } from '../../../../site/src/greetings/kits';
import { textFor } from '../../../../site/src/greetings/library';
import { occasions } from '../../../../site/src/greetings/occasions';
import { paletteFor } from '../../../../site/src/greetings/palettes';
import type { Occasion } from '../../../../site/src/greetings/types';
import { type CardPick, type GreetingsDraft, todayInIndia } from '../../data/site';
import { ErrorState, SkeletonRows } from '../../shared/ui';
import { SelectField, TextField } from '../../shared/fields';
import { st } from '../../strings/site';
import { BookPicker, ImageField, PublishBar, useSiteItem } from './kit';

const table = datesTable(dates.events, occasions);
const emptyPick = (): CardPick => ({ hidden: false, words: '', picture: null, gen: null, books: [] });
const isEmpty = (p: CardPick) => !p.hidden && !p.words && !p.picture && p.gen == null && !p.books.length;

/** The year's greeting days, in date order. */
function daysOf(year: number) {
  return occasions
    .map((o) => ({ o, date: nextDate(o, `${year}-01-01`, table) }))
    .filter((x): x is { o: Occasion; date: string } => !!x.date && x.date.startsWith(String(year)))
    .sort((a, b) => a.date.localeCompare(b.date));
}

let canvasMeasure: Measure | null = null;
function useMeasure() {
  const [m, setM] = useState<Measure>(() => canvasMeasure ?? estimate);
  useEffect(() => {
    if (canvasMeasure) return;
    void Promise.all([document.fonts.load("700 40px 'Poppins'"), document.fonts.load("700 40px 'Nunito Variable'")]).catch(() => undefined).then(() => {
      const ctx = document.createElement('canvas').getContext('2d');
      if (!ctx) return;
      canvasMeasure = (text, font) => ((ctx.font = font), ctx.measureText(text).width);
      setM(() => canvasMeasure!);
    });
  }, []);
  return m;
}

function CardPreview({ o, year, pick, measure }: { o: Occasion; year: number; pick: CardPick; measure: Measure }) {
  const svg = useMemo(
    () =>
      renderCard({
        occasion: o, text: textFor(o.id, o.name), year, palette: paletteFor('candy', o.solemn), logo: '/logo.svg', measure,
        pick: { wish: pick.words || undefined, photo: pick.picture?.url, gen: pick.gen ?? undefined },
      }),
    [o, year, pick.words, pick.picture?.url, pick.gen, measure],
  );
  return <div className="card-preview" dangerouslySetInnerHTML={{ __html: svg }} />;
}

/**
 * Festive cards (the Crossmaze website's festival greetings, for a library): on 36 festivals and special days the
 * website greets visitors with a card. Here the website team switches days off, changes a card's words or picture,
 * asks for a new drawing, suggests books for the day, and sets the offer beside the card.
 */
export function CardsPage() {
  const item = useSiteItem<GreetingsDraft>({ kind: 'greetings' });
  const { e } = item;
  const thisYear = Number(todayInIndia().slice(0, 4));
  const [year, setYear] = useState(thisYear);
  const [open, setOpen] = useState<string | null>(null);
  const measure = useMeasure();
  const d = e.draft;
  if (item.loading) return <SkeletonRows />;
  if (item.error || !d) return <ErrorState message={item.error ?? st.notFound} onRetry={item.reload} />;
  const today = todayInIndia();
  const pickOf = (id: string): CardPick => d.picks[`${id}-${year}`] ?? emptyPick();
  const setPick = (id: string, patch: Partial<CardPick>) => {
    const key = `${id}-${year}`;
    const next = { ...pickOf(id), ...patch };
    const picks = { ...d.picks };
    if (isEmpty(next)) delete picks[key];
    else picks[key] = next;
    e.update({ picks });
  };

  return (
    <>
      <header className="page-header">
        <h1>{st.navCards}</h1>
        <p className="muted">{st.cardsIntro}</p>
      </header>
      <PublishBar
        kind="greetings"
        message={e.message}
        state={item.state}
        onSave={item.save}
        onPublish={() => item.publish(st.published)}
        onDiscard={item.discard}
      />
      <div className="editor-grid">
        <div className="editor-main">
          <div className="toolbar">
            <SelectField label={st.year} value={String(year)} options={[thisYear, thisYear + 1, thisYear + 2].map((y) => ({ value: String(y), label: String(y) }))} onChange={(v) => setYear(Number(v))} />
          </div>
          <ul className="card-days">
            {daysOf(year).map(({ o, date }) => {
              const pick = pickOf(o.id);
              const key = `${o.id}-${year}`;
              const expanded = open === key;
              return (
                <li key={key} className={`card day-card${pick.hidden ? ' off' : ''}${date === today ? ' today' : ''}`}>
                  <CardPreview o={o} year={year} pick={pick} measure={measure} />
                  <div className="day-text">
                    <strong>{o.name}</strong>
                    <span className="muted small">{new Date(`${date}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'long' })}{date === today ? ` · ${st.today}` : ''}</span>
                    <label className="check">
                      <input type="checkbox" checked={!pick.hidden} onChange={(ev) => setPick(o.id, { hidden: !ev.target.checked })} /> {st.showOnWebsite}
                    </label>
                    {!isEmpty(pick) && !pick.hidden && <span className="muted small">{st.customised}</span>}
                    <button type="button" className="btn btn-text align-start" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : key)}>
                      {expanded ? st.close : st.changeCard}
                    </button>
                  </div>
                  {expanded && (
                    <div className="day-edit">
                      <TextField label={st.cardWords} hint={st.cardWordsHint(textFor(o.id, o.name).wishes.length)} value={pick.words} onChange={(words) => setPick(o.id, { words })} />
                      <ImageField label={st.cardPicture} hint={st.cardPictureHint} value={pick.picture} onChange={(picture) => setPick(o.id, { picture })} />
                      {kits[o.id] && !pick.picture && (
                        <div className="actions">
                          <button type="button" className="btn btn-outlined" onClick={() => setPick(o.id, { gen: 1 + Math.floor(Math.random() * 2_000_000_000) })}>
                            {st.tryAnother}
                          </button>
                          {pick.gen != null && (
                            <button type="button" className="btn btn-text" onClick={() => setPick(o.id, { gen: null })}>
                              {st.usualDrawing}
                            </button>
                          )}
                        </div>
                      )}
                      <BookPicker legend={st.cardBooks} hint={st.cardBooksHint} notes={false} max={4} value={pick.books.map((bookId) => ({ bookId, note: '' }))} onChange={(v) => setPick(o.id, { books: v.map((b) => b.bookId) })} />
                      <button type="button" className="btn btn-text align-start" onClick={() => setPick(o.id, emptyPick())}>
                        {st.backToAutomatic}
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
        <aside className="editor-side">
          <section className="card">
            <h2 className="h3">{st.cardSettings}</h2>
            <label className="check">
              <input type="checkbox" checked={d.enabled} onChange={(ev) => e.update({ enabled: ev.target.checked })} /> {st.cardsOn}
            </label>
            <label className="check">
              <input type="checkbox" checked={d.autoOpen} onChange={(ev) => e.update({ autoOpen: ev.target.checked })} /> {st.cardsAutoOpen}
            </label>
            {d.autoOpen && <TextField label={st.cardsDelay} type="number" value={String(d.delaySeconds)} onChange={(v) => e.update({ delaySeconds: Math.min(30, Math.max(2, Number(v) || 6)) })} />}
          </section>
          <section className="card">
            <h2 className="h3">{st.cardOffer}</h2>
            <label className="check">
              <input type="checkbox" checked={d.offer.on} onChange={(ev) => e.update({ offer: { ...d.offer, on: ev.target.checked } })} /> {st.cardOfferOn}
            </label>
            {d.offer.on && (
              <>
                <TextField label={st.cardOfferText} hint={st.cardOfferTextHint} value={d.offer.text} onChange={(text) => e.update({ offer: { ...d.offer, text } })} />
                <TextField label={st.buttonLabel} value={d.offer.cta?.label ?? ''} onChange={(label) => e.update({ offer: { ...d.offer, cta: label || d.offer.cta?.url ? { label, url: d.offer.cta?.url ?? '/account/sign-in?create=1' } : null } })} />
                <TextField label={st.buttonLink} hint={st.linkHint} value={d.offer.cta?.url ?? ''} onChange={(url) => e.update({ offer: { ...d.offer, cta: d.offer.cta || url ? { label: d.offer.cta?.label ?? '', url } : null } })} />
              </>
            )}
          </section>
        </aside>
      </div>
    </>
  );
}
