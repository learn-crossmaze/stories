import { describe, expect, it } from 'vitest';

import { contactLine, testimonialsHtml } from '../render';
import { fillList } from '../sections';

describe('page sections from the console', () => {
  it('replaces a built-in list, keeping each item’s look', () => {
    const ul = document.createElement('ul');
    ul.innerHTML = '<li class="a"><strong>No due dates</strong> Keep it.</li><li class="b"><strong>No fines</strong> Never.</li>';
    fillList(ul, [{ title: 'One', text: 'First' }, { title: 'Two', text: 'Second' }, { title: 'Three', text: '' }]);
    expect(ul.innerHTML).toBe('<li class="a"><strong>One</strong> First</li><li class="b"><strong>Two</strong> Second</li><li class="a"><strong>Three</strong></li>');
    const ol = document.createElement('ol');
    ol.innerHTML = '<li><span class="icon">*</span><h2>1. Join</h2><p>Sign up.</p><p>More.</p></li>';
    fillList(ol, [{ title: 'Choose', text: 'Pick a plan <b>now</b>' }], true);
    expect(ol.innerHTML).toBe('<li><span class="icon">*</span><h2>1. Choose</h2><p>Pick a plan &lt;b&gt;now&lt;/b&gt;</p></li>');
    fillList(ol, []);
    expect(ol.children).toHaveLength(1);
  });

  it('shows readers’ words and head office’s contact details', () => {
    const s = (site: Record<string, unknown>) => ({ site } as never);
    expect(testimonialsHtml(s({ testimonials: [] }))).toBe('');
    expect(testimonialsHtml(s({ testimonials: [{ quote: 'Love it <3', name: 'Meera', detail: 'Member' }] }))).toContain('Love it &lt;3');
    expect(contactLine(s({ contact: { phone: '7259921508', whatsapp: '', email: 'hello@storiesforall.in' } }))).toBe(
      '<a href="tel:7259921508" data-tap-name="Head office">+91 72599 21508</a> · <a href="https://wa.me/917259921508" target="_blank" rel="noopener" data-tap-name="Head office">WhatsApp</a> · <a href="mailto:hello@storiesforall.in">hello@storiesforall.in</a>',
    );
  });
});
