// A greeting card: one 1080 × 1080 SVG with the year's drawing, the library's logo and a white glass panel
// for the words (from the Crossmaze website's card engine). The website shows it inline and turns it into a
// PNG for sharing (ui.ts adds the fonts to the SVG for that).
import { kits } from './kits';
import { compose } from './maker';
import { rng } from './palettes';
import type { CardPick, Occasion, OccasionText, Palette } from './types';

/** The card's two typefaces, the website's own: Poppins for the title, Nunito for the rest. */
export const CARD_FONTS = { display: 'Poppins', text: 'Nunito Variable' } as const;

/** How wide a piece of text is, in pixels, in the given CSS font. */
export type Measure = (text: string, font: string) => number;

/** A rough measure for when no canvas is to hand: average glyph widths of the two card fonts. */
export const estimate: Measure = (text, font) => {
  const size = Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 16);
  return text.length * size * (font.includes(CARD_FONTS.display) ? 0.56 : 0.53);
};

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);

/** Breaks `text` into lines no wider than `width`. */
function wrap(text: string, font: string, width: number, measure: Measure) {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (line && measure(next, font) > width) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

/** "1st", "2nd", "77th": for anniversaries in titles and wishes. */
export const ordinal = (k: number) => `${k}${['th', 'st', 'nd', 'rd'][k % 100 >> 3 ^ 1 && k % 10] || 'th'}`;

/** Which of an occasion's lists to use in a year: they take turns. */
export const turn = <T>(list: readonly T[], year: number) => list[((year % list.length) + list.length) % list.length];

export interface CardInput {
  occasion: Occasion;
  text: OccasionText;
  year: number;
  palette: Palette;
  /** The logo picture's address (or a data: URL when the card is turned into a PNG). */
  logo: string;
  measure?: Measure;
  /** Extra markup for the SVG's <defs>, such as @font-face rules with the fonts inside. */
  defs?: string;
  /** The admin's choices for this card, if any (the picture's address must be one the SVG can load). */
  pick?: CardPick;
}

/** The year's wish for an occasion, before any words of the admin's own. */
export function autoWish(text: OccasionText, year: number) {
  const chosen = turn(text.wishes, year);
  return typeof chosen === 'function' ? chosen(year) : chosen;
}

export function renderCard({ occasion, text, year, palette: p, logo, measure = estimate, defs = '', pick = {} }: CardInput) {
  const design = pick.design != null && occasion.designs[pick.design] ? occasion.designs[pick.design] : turn(occasion.designs, year);
  const kit = kits[occasion.id];
  const drawing = pick.photo
    ? ''
    : pick.gen && kit
      ? compose(kit, rng(`${occasion.id}-${year}-gen${pick.gen}`), p)
      : design(rng(pick.seed ? `${occasion.id}-${year}-${pick.seed}` : `${occasion.id}-${year}`), p);
  const title = text.title(year);
  const wish = pick.wish?.trim() || autoWish(text, year);

  // The words: the title as big as fits on one line, the wish on up to three lines.
  const inner = 880;
  let titleSize = 92;
  while (titleSize > 56 && measure(title, `700 ${titleSize}px '${CARD_FONTS.display}'`) > inner) titleSize -= 4;
  let wishSize = 33;
  let wishLines = wrap(wish, `700 ${wishSize}px '${CARD_FONTS.text}'`, 820, measure);
  while (wishLines.length > 2 && wishSize > 27) {
    wishSize -= 2;
    wishLines = wrap(wish, `700 ${wishSize}px '${CARD_FONTS.text}'`, 820, measure);
  }
  const wishGap = Math.round(wishSize * 1.3);
  const panelH = 34 + titleSize * 1.02 + 14 + wishLines.length * wishGap + 22 + 26 + 28;
  const panelY = 1028 - panelH;
  const titleY = panelY + 34 + titleSize * 0.82;
  const wishY = titleY + titleSize * 0.2 + 14 + wishSize;
  const footY = panelY + panelH - 30;

  const [b1, b2, b3] = p.bg;
  const id = `c${occasion.id.replace(/\W/g, '')}${year}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 1080 1080" width="1080" height="1080" role="img" aria-label="${esc(`${title}: ${wish}`)}">
<defs>${defs}
<linearGradient id="${id}bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${b1}"/><stop offset=".55" stop-color="${b2}"/><stop offset="1" stop-color="${b3}"/></linearGradient>
<radialGradient id="${id}g1" cx=".15" cy=".1" r=".6"><stop offset="0" stop-color="${b2}"/><stop offset="1" stop-color="${b2}" stop-opacity="0"/></radialGradient>
<radialGradient id="${id}g2" cx=".9" cy=".3" r=".6"><stop offset="0" stop-color="${b3}"/><stop offset="1" stop-color="${b3}" stop-opacity="0"/></radialGradient>
<linearGradient id="${id}head" x1="0" x2="1"><stop offset="0" stop-color="${p.head[0]}"/><stop offset="1" stop-color="${p.head[1]}"/></linearGradient>
<clipPath id="${id}art"><rect x="0" y="0" width="1080" height="680"/></clipPath>
<filter id="${id}sh" x="-10%" y="-10%" width="120%" height="140%"><feDropShadow dx="0" dy="14" stdDeviation="18" flood-color="${p.ink}" flood-opacity=".16"/></filter>
</defs>
<rect width="1080" height="1080" fill="url(#${id}bg)"/>
<rect width="1080" height="1080" fill="url(#${id}g1)"/>
<rect width="1080" height="1080" fill="url(#${id}g2)"/>
${
  pick.photo
    ? `<image href="${esc(pick.photo)}" xlink:href="${esc(pick.photo)}" x="0" y="0" width="1080" height="1080" preserveAspectRatio="xMidYMid slice"/>`
    : `<g transform="translate(98 ${Math.round(Math.min(128, panelY - 572))}) scale(.8235)" clip-path="url(#${id}art)">${drawing}</g>`
}
<rect x="34" y="26" width="372" height="74" rx="20" fill="#fff" fill-opacity=".8" filter="url(#${id}sh)"/>
<image href="${logo}" xlink:href="${logo}" x="50" y="37" width="52" height="52" preserveAspectRatio="xMidYMid meet"/>
<text x="116" y="76" font-family="'${CARD_FONTS.display}', sans-serif" font-weight="700" font-size="34" fill="${p.ink}">Stories <tspan font-size="26" fill-opacity=".75">for all</tspan></text>
<rect x="60" y="${panelY}" width="960" height="${panelH}" rx="40" fill="#fff" fill-opacity=".82" stroke="#fff" stroke-width="2" filter="url(#${id}sh)"/>
<text x="540" y="${titleY}" text-anchor="middle" font-family="'${CARD_FONTS.display}', sans-serif" font-weight="700" font-size="${titleSize}" fill="url(#${id}head)">${esc(title)}</text>
${wishLines.map((l, i) => `<text x="540" y="${wishY + i * wishGap}" text-anchor="middle" font-family="'${CARD_FONTS.text}', sans-serif" font-weight="700" font-size="${wishSize}" fill="${p.ink}">${esc(l)}</text>`).join('\n')}
<text x="540" y="${footY}" text-anchor="middle" font-family="'${CARD_FONTS.text}', sans-serif" font-weight="800" font-size="25" fill="${p.ink}" fill-opacity=".75">With love from all of us at Stories for All · storiesforall.in</text>
</svg>`;
}
