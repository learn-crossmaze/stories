// Drawings for the library days. Each day has two hand-made scenes; "Try another" in the console uses the
// library kit (kits/library.ts) through the card maker.
import { block, bookmark, lamp, lying, openBook, owl, pencil, shelfRow, spine } from '../kits/library';
import { balloon, cloud, confetti, kite, n, OUTLINE, sparkle, star, sun } from '../motifs';
import { between, pick, whole } from '../palettes';
import type { Design, Palette, Rng } from '../types';

const SPINES = (p: Palette) => [...p.acc, '#7aa6d6', '#f4a261'];

/** Stars and sparkles drifting up from a point. */
function flyingStars(r: Rng, p: Palette, x: number, y: number, count: number) {
  let s = '';
  for (let i = 0; i < count; i++) {
    const a = between(r, -2.4, -0.7), d = between(r, 90, 320);
    const sx = x + Math.cos(a) * d * 1.4, sy = y + Math.sin(a) * d;
    s += i % 2 ? sparkle(sx, sy, between(r, 12, 22), pick(r, p.acc)) : star(sx, sy, between(r, 16, 28), pick(r, p.acc), between(r, -20, 20));
  }
  return s;
}

/** Letters floating out of a book. */
function letters(r: Rng, p: Palette, x: number, y: number, list: string[]) {
  return list
    .map((l, i) => {
      const lx = x + (i - (list.length - 1) / 2) * between(r, 90, 120), ly = y - between(r, 120, 260);
      return `<text x="${n(lx)}" y="${n(ly)}" text-anchor="middle" font-family="'Poppins', sans-serif" font-weight="700" font-size="${n(between(r, 54, 80))}" fill="${pick(r, p.acc)}" stroke="#fff" stroke-width="5" paint-order="stroke" transform="rotate(${n(between(r, -18, 18))} ${n(lx)} ${n(ly)})">${l}</text>`;
    })
    .join('');
}

/** A: an open book on a stack, with stars flying out of it. */
const magicBook: Design = (r, p) => {
  const x = between(r, 500, 580);
  let s = cloud(between(r, 140, 240), between(r, 90, 150), 0.8) + cloud(between(r, 840, 940), between(r, 120, 170), 0.7);
  s += flyingStars(r, p, x, 380, whole(r, 7, 10));
  s += lying(x, 640, 520, 70, pick(r, p.acc)) + lying(x - 10, 574, 470, 62, pick(r, p.acc));
  s += openBook(x, 500, 1.9, pick(r, p.acc), p);
  s += bookmark(x + 40, 440, 1, '#ff6b81');
  return s;
};

/** B: a bookshelf full of books, with a reading owl on top. */
const shelfAndOwl: Design = (r, p) => {
  let s = `<rect x="150" y="250" width="780" height="400" rx="26" fill="#f3d9b5" ${OUTLINE}/>`;
  s += shelfRow(r, 180, 900, 440, SPINES(p)) + shelfRow(r, 180, 900, 630, SPINES(p));
  s += owl(between(r, 300, 780), 170, 0.95, pick(r, p.acc), p);
  s += star(between(r, 90, 130), between(r, 120, 200), 26, pick(r, p.acc)) + sparkle(between(r, 950, 1000), between(r, 120, 220), 20, pick(r, p.acc));
  return s;
};

/** A reading lamp over an open book, a cup of chai beside it. */
const lampAndBook: Design = (r, p) => {
  let s = `<ellipse cx="540" cy="640" rx="470" ry="40" fill="#fff" opacity=".55"/>`;
  s += lamp(230, 640, 2, pick(r, p.acc));
  s += openBook(between(r, 600, 660), 600, 1.7, pick(r, p.acc), p);
  const cx = between(r, 900, 950);
  s += `<path d="M${n(cx - 50)} 560 h100 l-12 80 h-76 z" fill="${pick(r, p.acc)}" ${OUTLINE}/><path d="M${n(cx + 50)} 580 q36 6 18 36 q-10 12 -26 8" fill="none" stroke="#fff" stroke-width="10"/>`;
  for (let i = 0; i < 3; i++) s += `<path d="M${n(cx - 24 + i * 24)} 540 q-12 -24 0 -44 q12 -20 0 -40" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round" opacity=".8"/>`;
  s += flyingStars(r, p, 620, 380, 5);
  return s;
};

/** Alphabet blocks and a pencil, with letters in many scripts floating over an open book. */
const abcBlocks: Design = (r, p) => {
  let s = letters(r, p, 540, 420, ['A', 'अ', 'ಅ', 'அ', 'ا']);
  s += openBook(540, 520, 1.6, pick(r, p.acc), p);
  s += block(220, 580, 1.4, 'A', pick(r, p.acc), between(r, -8, 4)) + block(330, 600, 1.15, 'B', pick(r, p.acc), between(r, 4, 12)) + block(860, 585, 1.35, 'C', pick(r, p.acc), between(r, -10, 0));
  s += pencil(between(r, 700, 760), 630, 1.1, pick(r, p.acc), -8);
  return s;
};

/** Books as balloons: a child's picture book world, with a kite and the sun. */
const storyWorld: Design = (r, p) => {
  let s = sun(between(r, 860, 940), 140, 70);
  s += kite(between(r, 150, 260), between(r, 140, 220), 1, pick(r, p.acc), pick(r, p.acc), between(r, -10, 10));
  for (let i = 0; i < 3; i++) s += balloon(between(r, 330, 760), between(r, 150, 280), pick(r, p.acc), p.ink, r, 46);
  s += openBook(540, 560, 2.1, pick(r, p.acc), p);
  s += spine(170, 640, 60, 190, pick(r, p.acc)) + spine(240, 640, 52, 160, pick(r, p.acc), '#fff4c2', -6) + spine(900, 640, 58, 180, pick(r, p.acc));
  s += confetti(r, p.acc, 14, { x0: 60, x1: 1020, y0: 20, y1: 320 });
  return s;
};

/** Library card and stamp: a stack of borrowed books with a due-date card (no due dates at Stories!). */
const stackAndCard: Design = (r, p) => {
  let s = '';
  const x = between(r, 420, 480);
  for (let i = 0; i < 5; i++) s += lying(x + between(r, -20, 20), 640 - i * 62, between(r, 380, 460), 58, pick(r, SPINES(p)));
  s += `<g transform="rotate(${n(between(r, 6, 12))} 800 420)"><rect x="680" y="260" width="250" height="320" rx="20" fill="#fffaf0" ${OUTLINE}/>
<rect x="700" y="290" width="210" height="34" rx="8" fill="${pick(r, p.acc)}"/>
${[0, 1, 2, 3, 4].map((i) => `<path d="M705 ${360 + i * 40} h200" stroke="${p.ink}" stroke-opacity=".18" stroke-width="4"/>`).join('')}
<circle cx="830" cy="480" r="58" fill="none" stroke="${pick(r, p.acc)}" stroke-width="9" opacity=".85"/>
<text x="830" y="494" text-anchor="middle" font-family="'Poppins', sans-serif" font-weight="700" font-size="34" fill="${p.ink}" opacity=".7">READ</text></g>`;
  s += flyingStars(r, p, 460, 300, 5);
  return s;
};

export const worldBookDay: Design[] = [magicBook, shelfAndOwl];
export const childrensBookDay: Design[] = [storyWorld, magicBook];
export const readingDay: Design[] = [lampAndBook, shelfAndOwl];
export const librariansDay: Design[] = [shelfAndOwl, stackAndCard];
export const literacyDay: Design[] = [abcBlocks, magicBook];
