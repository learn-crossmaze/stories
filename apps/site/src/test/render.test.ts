import { describe, expect, it } from 'vitest';

import type { PublicSnapshot } from '../data';
import { ageShelves, bookCard, branchCard, coverColour, esc, genreChips, hoursLines, plansSection, reason, ribbon, rupees, shelf, statsLine, time12 } from '../render';

const snapshot = (over: Partial<PublicSnapshot> = {}): PublicSnapshot => ({
  generatedAt: '2026-11-10T10:00:00Z',
  titles: 2400,
  orgs: [{ id: 'corp', name: 'Stories for All', type: 'CORPORATE' }],
  branches: [],
  plans: [
    {
      id: 'p1', orgId: 'corp', name: 'Reader', description: 'For busy readers', booksAtATime: 3, depositMinor: 100000,
      audiences: ['TEENS', 'ADULTS'], homeDelivery: true,
      prices: [
        { duration: 'MONTHLY', months: 1, listPriceMinor: 40000, priceMinor: 36000, discountLabel: '10% off' },
        { duration: 'ANNUAL', months: 12, listPriceMinor: 400000, priceMinor: 400000, discountLabel: null },
      ],
    },
  ],
  ...over,
});

describe('formatting', () => {
  it('shows rupees from paise', () => {
    expect(rupees(139900)).toBe('₹1,399');
    expect(rupees(139950)).toBe('₹1,399.5');
    expect(rupees(10000000)).toBe('₹1,00,000');
  });

  it('shows times the Indian way', () => {
    expect(time12('10:00')).toBe('10 am');
    expect(time12('19:30')).toBe('7:30 pm');
    expect(time12('12:00')).toBe('12 pm');
    expect(time12('00:15')).toBe('12:15 am');
  });

  it('groups opening hours and lists closed days', () => {
    const week = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'].map((day) => ({ day, open: '10:00', close: '19:00' }));
    expect(hoursLines(week, ['SUN'])).toEqual(['Mon–Sat: 10 am – 7 pm', 'Closed: Sun']);
    expect(hoursLines([...week.slice(0, 5), { day: 'SAT', open: '10:00', close: '14:00' }], ['SUN'])).toEqual(['Mon–Fri: 10 am – 7 pm', 'Sat: 10 am – 2 pm', 'Closed: Sun']);
    expect(hoursLines([], [])).toEqual([]);
    // Hours saved for a weekly off don't count.
    expect(hoursLines(week, ['MON'])).toEqual(['Tue–Sat: 10 am – 7 pm', 'Closed: Mon, Sun']);
  });

  it('escapes everything that comes from the data', () => {
    expect(esc('<b>"x"</b> & \'y\'')).toBe('&lt;b&gt;&quot;x&quot;&lt;/b&gt; &amp; &#39;y&#39;');
    const html = plansSection(snapshot({ plans: [{ ...snapshot().plans[0], name: '<img src=x onerror=alert(1)>' }] }), 'https://app.example');
    expect(html).not.toContain('<img');
  });
});

describe('plans', () => {
  it('shows the offer price, the old price and the facts', () => {
    const html = plansSection(snapshot(), 'https://app.example');
    expect(html).toContain('₹360');
    expect(html).toContain('<s class="was"');
    expect(html).toContain('10% off');
    expect(html).toContain('/ month');
    expect(html).toContain('/ year');
    expect(html).toContain('Teens (13–17), Adults (18+)');
    expect(html).toContain('Home delivery available');
    expect(html).toContain('Refundable deposit ₹1,000');
    expect(html).toContain('href="https://app.example"');
  });

  it('groups plans by organization only when several sell plans', () => {
    const two = snapshot({
      orgs: [{ id: 'corp', name: 'Stories for All', type: 'CORPORATE' }, { id: 'fr', name: 'Stories Pune', type: 'FRANCHISE' }],
      plans: [snapshot().plans[0], { ...snapshot().plans[0], id: 'p2', orgId: 'fr', name: 'Pune Reader' }],
    });
    expect(plansSection(two, 'x')).toContain('class="group-title">Stories Pune');
    expect(plansSection(two, 'x', 3)).not.toContain('group-title');
    expect(plansSection(snapshot({ plans: [] }), 'x')).toContain('Plans will appear here soon');
  });
});

describe('branches', () => {
  it('shows address, hours, delivery and a call link', () => {
    const html = branchCard({
      id: 'b1', orgId: 'corp', name: 'Central', phone: '+91 80 1234 5678', email: 'central@storiesforall.in',
      address: { line1: '12 MG Road', line2: '', city: 'Bengaluru', state: 'Karnataka', postalCode: '560001' },
      hours: [{ day: 'MON', open: '10:00', close: '19:00' }], weeklyOffs: ['SUN'], delivery: { offered: true, feeMinor: 5000 },
    });
    expect(html).toContain('href="tel:+918012345678"');
    expect(html).toContain('Home delivery: ₹50 a visit');
    expect(html).toContain('Mon: 10 am – 7 pm');
    expect(html).toContain('google.com/maps/search/?api=1&amp;query=12%20MG%20Road');
  });

  it('summarizes titles and branches', () => {
    expect(statsLine(snapshot({ branches: [{} as never, {} as never] }))).toBe('2,400 titles to choose from · 2 branches');
  });
});

describe('book shelves', () => {
  const book = (id: string, over: Record<string, unknown> = {}) => ({ id, title: `Title ${id}`, authors: ['Ruskin Bond'], coverUrl: null, ageGroup: 'CHILDREN', genres: ['FICTION'], count: 3, ...over });
  const withShowcase = (over: Record<string, unknown> = {}) =>
    snapshot({ showcase: { generatedAt: '', trending: [], popular: [], newArrivals: [], mostWanted: [], byAge: { CHILDREN: [], TEENS: [], ADULTS: [] }, genres: [], ...over } as never });

  it('draws a cover when there is no image, with a ribbon and the reason it is on the shelf', () => {
    const html = bookCard(book('b1', { title: '<Matilda>' }), 'trending', 0, 'https://app.example');
    expect(html).toContain('class="drawn-cover c-');
    expect(html).toContain('&lt;Matilda&gt;');
    expect(html).not.toContain('<Matilda>');
    expect(html).toContain('<span class="ribbon">#1</span>');
    expect(html).toContain('Borrowed 3 times this month');
    expect(html).toContain('href="https://app.example/explore"');
    expect(bookCard(book('b2', { coverUrl: 'https://img/x.jpg' }), 'popular', 1, 'x')).toContain('<img src="https://img/x.jpg"');
    expect(coverColour('same')).toBe(coverColour('same'));
  });

  it('says why a book is on each shelf', () => {
    expect(ribbon('newArrivals', book('a'), 4)).toBe('New');
    expect(ribbon('mostWanted', book('a', { count: 5 }), 0)).toBe('5 waiting');
    expect(reason('mostWanted', book('a', { count: 1 }))).toBe('1 reader in the queue');
    expect(reason('popular', book('a', { count: 1200 }))).toBe('Borrowed 1,200 times');
    const now = Date.parse('2026-11-10T12:00:00Z');
    expect(reason('newArrivals', book('a', { addedAt: '2026-11-10T08:00:00Z' }), now)).toBe('Added today');
    expect(reason('newArrivals', book('a', { addedAt: '2026-11-07T08:00:00Z' }), now)).toBe('Added 3 days ago');
  });

  it('renders nothing for empty shelves so their section can hide', () => {
    expect(shelf([], 'trending', 'Trending', 'x')).toBe('');
    expect(shelf(undefined, 'trending', 'Trending', 'x')).toBe('');
    expect(ageShelves(withShowcase(), 'x')).toBe('');
    expect(genreChips(withShowcase(), 'x')).toBe('');
    expect(shelf([book('a'), book('b'), book('c')], 'trending', 'Trending', 'x', 2).match(/class="book"/g)).toHaveLength(2);
  });

  it('shows age groups that have books as tabs, and genres with counts', () => {
    const html = ageShelves(withShowcase({ byAge: { CHILDREN: [book('a')], TEENS: [], ADULTS: [book('b', { ageGroup: 'ADULTS' })] } }), 'x');
    expect(html.match(/role="tab"/g)).toHaveLength(2);
    expect(html).toContain('aria-selected="true"');
    expect(html).toMatch(/id="panel-ADULTS"[^>]*hidden/);
    expect(genreChips(withShowcase({ genres: [{ key: 'SELF_HELP', count: 1200 }] }), 'x')).toContain('Self-help <span class="chip-count">1,200</span>');
  });
});
