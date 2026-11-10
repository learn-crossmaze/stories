import { describe, expect, it } from 'vitest';

import { datesTable, occasionsOn } from '../greetings/calendar';
import { renderCard } from '../greetings/card';
import dates from '../greetings/dates.json';
import { textFor } from '../greetings/library';
import { occasions } from '../greetings/occasions';
import { paletteFor } from '../greetings/palettes';
import { schedule } from '../greetings/schedule';
import { greetingDaysOn } from '../greetings/today';

describe('festive cards', () => {
  it('the small schedule every page loads matches the full list of occasions', () => {
    expect(schedule.map((s) => [s.id, s.name, s.when, s.solemn ?? false])).toEqual(occasions.map((o) => [o.id, o.name, o.when, o.solemn ?? false]));
  });

  it('greets on the library days and the festivals, by India’s date', () => {
    expect(greetingDaysOn('2026-04-23').map((o) => o.id)).toEqual(['world-book-day']);
    expect(greetingDaysOn('2026-08-12').map((o) => o.id)).toEqual(['librarians-day']);
    expect(greetingDaysOn('2026-11-14').map((o) => o.id)).toEqual(['childrens-day']);
    expect(occasionsOn('2026-11-08', occasions, datesTable(dates.events, occasions)).map((o) => o.id)).toContain('diwali');
    expect(greetingDaysOn('2026-11-10')).toEqual([]);
  });

  it('speaks as a library: every day has its own words, none from the preschool', () => {
    for (const o of occasions) {
      const t = textFor(o.id, o.name);
      const words = [t.heading, t.little, t.bar, ...t.activities, ...t.wishes.map((w) => (typeof w === 'function' ? w(2026) : w))].join(' ');
      expect(words, o.id).not.toMatch(/Crossmaze|little ones?\b|preschool|admission/i);
      expect(t.activities.length, o.id).toBeGreaterThan(0);
    }
  });

  it('draws every day’s card for this year and the next', () => {
    for (const o of occasions) {
      for (const year of [2026, 2027]) {
        const svg = renderCard({ occasion: o, text: textFor(o.id, o.name), year, palette: paletteFor('library', o.solemn), logo: '/logo.svg' });
        expect(svg, `${o.id} ${year}`).toMatch(/^<svg[\s\S]*<\/svg>$/);
        expect(svg).toContain('Stories for All · storiesforall.in');
      }
    }
  });
});
