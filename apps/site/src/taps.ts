// Counts taps on call and WhatsApp buttons (console → Website → Calls), as crossmaze.in does. A website can't see
// who called: it only knows a button was tapped. Nothing that identifies the visitor is sent; the visit code is
// random and forgotten when the tab closes.
const visit = (() => {
  try {
    let v = sessionStorage.getItem('stories.visit');
    if (!v) sessionStorage.setItem('stories.visit', (v = Math.random().toString(36).slice(2, 12)));
    return v;
  } catch {
    return '';
  }
})();

const device = () => (/iPad|Tablet|Android(?!.*Mobile)/i.test(navigator.userAgent) ? 'Tablet' : /Mobi|iPhone|Android/i.test(navigator.userAgent) ? 'Phone' : 'Computer');

/** How the visit started: an ad, a search engine, a social site, another site, or direct. */
function source() {
  const q = new URLSearchParams(location.search);
  if (q.get('utm_source')) return `${q.get('utm_source')}${q.get('utm_medium') ? ` / ${q.get('utm_medium')}` : ''}`;
  if (q.get('gclid')) return 'Google Ads';
  try {
    const host = document.referrer ? new URL(document.referrer).hostname.replace(/^www\./, '') : '';
    return !host || host === location.hostname ? 'Direct' : host;
  } catch {
    return 'Direct';
  }
}

export function wireTaps() {
  document.addEventListener('click', (e) => {
    const a = (e.target as HTMLElement).closest?.<HTMLAnchorElement>('a[href^="tel:"], a[href^="https://wa.me/"]');
    if (!a) return;
    const whatsapp = a.href.startsWith('https://wa.me/');
    const number = whatsapp ? new URL(a.href).pathname.slice(1) : a.href.slice(4);
    if (!number || number === '/') return;
    const card = a.closest<HTMLElement>('.card, section, footer');
    const branch = a.dataset.tapName || card?.querySelector('h3, h1')?.textContent?.trim() || '';
    const place = card?.querySelector('h2, h3')?.textContent?.trim() || (a.closest('footer') ? 'Footer' : '');
    const body = JSON.stringify({ channel: whatsapp ? 'whatsapp' : 'phone', number, branch: branch.slice(0, 80), page: location.pathname, place: place.slice(0, 120), source: source(), visit, device: device() });
    try {
      if (!navigator.sendBeacon?.('/api/tap', body)) void fetch('/api/tap', { method: 'POST', body, keepalive: true });
    } catch {
      // Counting is best effort: the call itself goes ahead.
    }
  });
}
