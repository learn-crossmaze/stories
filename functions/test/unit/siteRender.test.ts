import { describe, expect, it } from 'vitest';

import { isSiteImage, link, postDraft, promotionWindow, slugify, todayInIndia } from '../../src/site/content.js';
import { currentNotices, formatPhone, plain, richText, safeHref, whatsappLink } from '../../src/site/render.js';

describe('website text', () => {
  it('formats editor text safely', () => {
    expect(richText('Hello **world**\nnext line\n\n- one\n- two')).toBe('<p>Hello <strong>world</strong><br />next line</p><ul><li>one</li><li>two</li></ul>');
    expect(richText('<script>alert(1)</script>')).toBe('<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>');
    expect(richText('[plans](/plans) and [site](https://storiesforall.in) and [bad](javascript:void)')).toBe(
      '<p><a href="/plans">plans</a> and <a href="https://storiesforall.in" target="_blank" rel="noopener">site</a> and bad</p>',
    );
    expect(richText('read _slowly_ today')).toBe('<p>read <em>slowly</em> today</p>');
    expect(safeHref('//evil.example')).toBeNull();
    expect(plain('**Big** news: [read](/blog) all about it', 12)).toBe('Big news:…');
  });

  it('checks links, pictures and addresses', () => {
    expect(link.safeParse('/account/sign-in?create=1').success).toBe(true);
    expect(link.safeParse('https://wa.me/917259921508').success).toBe(true);
    expect(link.safeParse('javascript:alert(1)').success).toBe(false);
    expect(link.safeParse('//evil.example').success).toBe(false);
    expect(isSiteImage('https://firebasestorage.googleapis.com/v0/b/x/o/site%2Fa.jpg?alt=media')).toBe(true);
    expect(isSiteImage('https://evil.example/a.jpg')).toBe(false);
    expect(slugify('10 Books for Rainy Days!')).toBe('10-books-for-rainy-days');
    expect(postDraft.safeParse({ title: 'Hello there', slug: 'Bad Slug' }).success).toBe(false);
  });

  it('works with India’s dates for offers and notices', () => {
    expect(todayInIndia(new Date('2026-11-10T20:00:00Z'))).toBe('2026-11-11');
    expect(promotionWindow({ startOn: '2026-11-01', endOn: '2026-11-10' }, '2026-11-10')).toBe('RUNNING');
    expect(promotionWindow({ startOn: '2026-11-01', endOn: '2026-11-10' }, '2026-11-11')).toBe('ENDED');
    const n = (from: string, to: string) => ({ text: 'x', from, to, closed: false });
    expect(currentNotices([n('2026-12-01', '2026-12-02'), n('2026-11-01', '2026-11-02'), n('2026-11-20', '2026-11-21')], '2026-11-10').map((x) => x.from)).toEqual(['2026-11-20']);
  });

  it('writes phone numbers for people and WhatsApp', () => {
    expect(formatPhone('07259921508')).toBe('+91 72599 21508');
    expect(whatsappLink('7259921508', 'Hi')).toBe('https://wa.me/917259921508?text=Hi');
    expect(whatsappLink('+91 80 4000 0000', 'Hi')).toBe('https://wa.me/918040000000?text=Hi');
    expect(whatsappLink('044 2345 6789', 'Hi')).toBeNull();
  });
});
