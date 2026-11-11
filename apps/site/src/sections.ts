// Page sections published from the console (Website → Page sections): lists on the website's pages. A page keeps
// its built-in list until the website team publishes one; each new item takes the look of the built-in item in its
// place (its icon, colour), so the page doesn't change shape.
import type { PublicSite, Tile } from './data';

/** Puts `items` in place of `list`'s children, reusing the children as templates. */
export function fillList(list: HTMLElement, items: Tile[], numbered = false) {
  const templates = [...list.children] as HTMLElement[];
  if (!items.length || !templates.length) return;
  list.replaceChildren(
    ...items.map((item, i) => {
      const el = templates[i % templates.length].cloneNode(true) as HTMLElement;
      const head = el.querySelector('h2, h3, strong');
      if (head) head.textContent = numbered ? `${i + 1}. ${item.title}` : item.title;
      const paras = [...el.querySelectorAll('p')].filter((p) => !p.querySelector('a, button'));
      if (paras.length) {
        paras[0].textContent = item.text;
        paras.slice(1).forEach((p) => p.remove());
      } else if (head) {
        // "<li><strong>Title</strong> text</li>": the words after the heading.
        while (head.nextSibling) head.nextSibling.remove();
        head.after(document.createTextNode(item.text ? ` ${item.text}` : ''));
      }
      return el;
    }),
  );
}

export function applySections(sections: PublicSite['sections'] | undefined) {
  if (!sections) return;
  document.querySelectorAll<HTMLElement>('[data-section]').forEach((el) => {
    const items = sections[el.dataset.section as keyof PublicSite['sections']];
    if (Array.isArray(items) && items.length && 'title' in (items[0] as object)) fillList(el, items as Tile[], el.dataset.numbered !== undefined);
  });
}
