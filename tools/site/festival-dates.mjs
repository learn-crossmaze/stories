// Updates src/greetings/dates.json from Google's public calendar of Indian holidays, for the festivals whose
// dates move each year (Diwali, Holi, Eid…). It runs before every build (GitHub Actions); the file in the
// repository is the last good copy, so a build never fails or loses dates if Google can't be reached.
// (From the Crossmaze website, learn-crossmaze/crossmaze-website.)
//
//   node tools/site/festival-dates.mjs
//
// The file keeps every event's dates by its name in Google's calendar ("Diwali/Deepavali": ["2026-11-08", …]);
// src/greetings/occasions.ts says which names each greeting uses.
import { readFileSync, writeFileSync } from 'node:fs';

const SOURCE = 'https://calendar.google.com/calendar/ical/en.indian%23holiday%40group.v.calendar.google.com/public/basic.ics';
const FILE = new URL('../../apps/site/src/greetings/dates.json', import.meta.url);

/** Reads the calendar's events into { name: [dates] }. */
export function parseIcs(ics) {
  const events = {};
  const text = ics.replace(/\r?\n[ \t]/g, ''); // unfold long lines
  for (const block of text.split('BEGIN:VEVENT').slice(1)) {
    const date = /DTSTART;VALUE=DATE:(\d{4})(\d{2})(\d{2})/.exec(block);
    const summary = /\nSUMMARY:(.*)/.exec(block);
    if (!date || !summary) continue;
    // "Ramzan Id (tentative)" and "Ramzan Id" are the same festival.
    const name = summary[1].replace(/\\,/g, ',').replace(/\s*\(tentative\)\s*$/i, '').trim();
    (events[name] ??= []).push(`${date[1]}-${date[2]}-${date[3]}`);
  }
  for (const name of Object.keys(events)) events[name] = [...new Set(events[name])].sort();
  return events;
}

async function main() {
  const old = JSON.parse(readFileSync(FILE, 'utf8'));
  let ics;
  try {
    const res = await fetch(SOURCE, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    ics = await res.text();
  } catch (err) {
    console.warn(`Festival dates: couldn't reach Google's calendar (${err.message}); keeping the dates from ${old.updated}.`);
    return;
  }
  const events = parseIcs(ics);
  const count = Object.values(events).reduce((sum, d) => sum + d.length, 0);
  // A calendar that comes back nearly empty is a fault, not a change: keep the old dates.
  if (count < 100) {
    console.warn(`Festival dates: Google's calendar had only ${count} events; keeping the dates from ${old.updated}.`);
    return;
  }
  // Google's dates win for the years it lists (a tentative Eid date can move by a day); years it no longer
  // lists keep their old dates, so a festival never disappears because Google trimmed its early years.
  const merged = { ...old.events };
  for (const [name, dates] of Object.entries(events)) {
    const years = new Set(dates.map((d) => d.slice(0, 4)));
    merged[name] = [...(merged[name] ?? []).filter((d) => !years.has(d.slice(0, 4))), ...dates].sort();
  }
  const sorted = Object.fromEntries(Object.keys(merged).sort().map((k) => [k, merged[k]]));
  writeFileSync(FILE, `${JSON.stringify({ source: SOURCE, updated: new Date().toISOString().slice(0, 10), events: sorted }, null, 1)}\n`);
  const last = Object.values(events).flat().sort().at(-1);
  console.log(`Festival dates: ${count} events from Google's calendar, up to ${last}.`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
