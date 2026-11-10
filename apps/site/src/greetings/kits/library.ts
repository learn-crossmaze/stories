// Symbols for the library days (World Book Day, Children's Book Day, Reading Day, Librarians' Day, Literacy Day),
// for the card maker and the hand-drawn designs in designs/library.ts. Each piece is drawn in a 200 × 200 box
// centred on (0, 0), inside −95…95, in the card's style: flat colours with a white outline.
import type { Kit, Piece } from '../maker';
import { n, OUTLINE, sparkle, star } from '../motifs';
import { between, pick } from '../palettes';
import type { Palette, Rng } from '../types';

const PAGE = '#fffaf0';
const soft = (p: Palette, w = 4) => `stroke="${p.ink}" stroke-opacity=".18" stroke-width="${w}" stroke-linecap="round"`;

/** A closed book standing on its foot, seen from the spine side; (x, y) is the middle of its foot. */
export function spine(x: number, y: number, w: number, h: number, fill: string, band = '#fff4c2', tilt = 0) {
  return `<g transform="rotate(${n(tilt)} ${n(x)} ${n(y)})"><rect x="${n(x - w / 2)}" y="${n(y - h)}" width="${n(w)}" height="${n(h)}" rx="${n(Math.min(10, w / 4))}" fill="${fill}" ${OUTLINE}/>
<rect x="${n(x - w / 2 + 5)}" y="${n(y - h * 0.82)}" width="${n(w - 10)}" height="${n(Math.max(6, h * 0.06))}" rx="3" fill="${band}" opacity=".9"/>
<rect x="${n(x - w / 2 + 5)}" y="${n(y - h * 0.24)}" width="${n(w - 10)}" height="${n(Math.max(6, h * 0.06))}" rx="3" fill="${band}" opacity=".9"/></g>`;
}

/** A book lying flat; (x, y) is the middle of its bottom edge. */
export function lying(x: number, y: number, w: number, h: number, fill: string) {
  return `<rect x="${n(x - w / 2)}" y="${n(y - h)}" width="${n(w)}" height="${n(h)}" rx="${n(h / 3)}" fill="${fill}" ${OUTLINE}/>
<rect x="${n(x + w / 2 - 16)}" y="${n(y - h + 5)}" width="10" height="${n(h - 10)}" rx="3" fill="${PAGE}"/>
<path d="M${n(x - w / 2 + 14)} ${n(y - h / 2)} h${n(w * 0.45)}" stroke="#fff" stroke-width="4" stroke-linecap="round" opacity=".7"/>`;
}

/** An open book seen from the front, pages fanning up; (x, y) is the middle of its spine at the bottom. */
export function openBook(x: number, y: number, s: number, cover: string, p: Palette) {
  const w = 120 * s, h = 80 * s;
  const leftPage = `M${n(x)} ${n(y)} C${n(x - w * 0.35)} ${n(y - 18 * s)} ${n(x - w * 0.7)} ${n(y - 12 * s)} ${n(x - w)} ${n(y)} L${n(x - w)} ${n(y - h)} C${n(x - w * 0.7)} ${n(y - h - 12 * s)} ${n(x - w * 0.35)} ${n(y - h - 18 * s)} ${n(x)} ${n(y - h)} Z`;
  const rightPage = `M${n(x)} ${n(y)} C${n(x + w * 0.35)} ${n(y - 18 * s)} ${n(x + w * 0.7)} ${n(y - 12 * s)} ${n(x + w)} ${n(y)} L${n(x + w)} ${n(y - h)} C${n(x + w * 0.7)} ${n(y - h - 12 * s)} ${n(x + w * 0.35)} ${n(y - h - 18 * s)} ${n(x)} ${n(y - h)} Z`;
  let lines = '';
  for (let i = 1; i <= 4; i++) {
    const yy = y - h + i * (h / 5.2);
    lines += `<path d="M${n(x - w * 0.86)} ${n(yy)} Q${n(x - w * 0.45)} ${n(yy - 8 * s)} ${n(x - w * 0.12)} ${n(yy - 6 * s)}" fill="none" ${soft(p, 4 * s)}/>`;
    lines += `<path d="M${n(x + w * 0.12)} ${n(yy - 6 * s)} Q${n(x + w * 0.45)} ${n(yy - 8 * s)} ${n(x + w * 0.86)} ${n(yy)}" fill="none" ${soft(p, 4 * s)}/>`;
  }
  return `<path d="M${n(x - w - 10 * s)} ${n(y + 8 * s)} L${n(x - w - 10 * s)} ${n(y - h + 8 * s)} L${n(x)} ${n(y - h + 14 * s)} L${n(x + w + 10 * s)} ${n(y - h + 8 * s)} L${n(x + w + 10 * s)} ${n(y + 8 * s)} L${n(x)} ${n(y + 14 * s)} Z" fill="${cover}" ${OUTLINE}/>
<path d="${leftPage}" fill="${PAGE}" ${OUTLINE}/><path d="${rightPage}" fill="${PAGE}" ${OUTLINE}/>${lines}
<path d="M${n(x)} ${n(y - h)} V${n(y)}" ${soft(p, 5 * s)}/>`;
}

/** A friendly owl with round glasses; (x, y) is its middle. */
export function owl(x: number, y: number, s: number, body: string, p: Palette) {
  return `<g transform="translate(${n(x)} ${n(y)}) scale(${n(s)})">
<path d="M-62 70 C-80 10 -70 -50 -40 -70 L-30 -95 L-8 -72 C0 -74 8 -74 8 -72 L30 -95 L40 -70 C70 -50 80 10 62 70 Z" fill="${body}" ${OUTLINE}/>
<ellipse cx="0" cy="28" rx="40" ry="38" fill="#fff4dc"/>
<path d="M-20 18 q6 6 12 0 M8 18 q6 6 12 0 M-14 36 q6 6 12 0 M2 36 q6 6 12 0" fill="none" ${soft(p, 4)}/>
<circle cx="-24" cy="-30" r="21" fill="#fff"/><circle cx="24" cy="-30" r="21" fill="#fff"/>
<circle cx="-24" cy="-30" r="21" fill="none" stroke="${p.ink}" stroke-width="5"/><circle cx="24" cy="-30" r="21" fill="none" stroke="${p.ink}" stroke-width="5"/>
<path d="M-3 -32 h6" stroke="${p.ink}" stroke-width="5"/>
<circle cx="-22" cy="-28" r="8" fill="${p.ink}"/><circle cx="26" cy="-28" r="8" fill="${p.ink}"/>
<circle cx="-19" cy="-31" r="3" fill="#fff"/><circle cx="29" cy="-31" r="3" fill="#fff"/>
<path d="M-8 -8 L0 6 L8 -8 Z" fill="#ffb703" ${OUTLINE}/>
<path d="M-30 70 v12 M-18 70 v12 M18 70 v12 M30 70 v12" stroke="#ffb703" stroke-width="7" stroke-linecap="round"/>
</g>`;
}

/** A reading lamp bending over; (x, y) is the middle of its base. */
export function lamp(x: number, y: number, s: number, shade: string) {
  return `<g transform="translate(${n(x)} ${n(y)}) scale(${n(s)})">
<path d="M-40 -170 L-10 -120 L60 -150" fill="none" stroke="#fff" stroke-width="16" stroke-linecap="round"/>
<path d="M-40 -170 L-10 -120 L60 -150" fill="none" stroke="#8a93b8" stroke-width="9" stroke-linecap="round"/>
<path d="M-10 -120 L-6 -8" stroke="#fff" stroke-width="16" stroke-linecap="round"/><path d="M-10 -120 L-6 -8" stroke="#8a93b8" stroke-width="9" stroke-linecap="round"/>
<path d="M-50 0 h88 a10 10 0 0 0 -10 -14 h-68 a10 10 0 0 0 -10 14 z" fill="#8a93b8" ${OUTLINE}/>
<path d="M30 -175 L100 -150 L80 -112 L10 -140 Z" fill="${shade}" ${OUTLINE}/>
<path d="M80 -112 L120 -40 L-10 -95 Z" fill="#fff3b0" opacity=".55"/>
</g>`;
}

/** An alphabet block with a letter; (x, y) is its middle. */
export function block(x: number, y: number, s: number, letter: string, fill: string, tilt = 0) {
  const h = 46 * s;
  return `<g transform="rotate(${n(tilt)} ${n(x)} ${n(y)})"><rect x="${n(x - h)}" y="${n(y - h)}" width="${n(2 * h)}" height="${n(2 * h)}" rx="${n(14 * s)}" fill="${fill}" ${OUTLINE}/>
<rect x="${n(x - h + 9 * s)}" y="${n(y - h + 9 * s)}" width="${n(2 * h - 18 * s)}" height="${n(2 * h - 18 * s)}" rx="${n(9 * s)}" fill="#fff" opacity=".9"/>
<text x="${n(x)}" y="${n(y + 20 * s)}" text-anchor="middle" font-family="'Poppins', sans-serif" font-weight="700" font-size="${n(58 * s)}" fill="${fill}">${letter}</text></g>`;
}

/** A pencil lying at an angle; (x, y) is its middle. */
export function pencil(x: number, y: number, s: number, fill: string, tilt = -30) {
  return `<g transform="translate(${n(x)} ${n(y)}) rotate(${n(tilt)}) scale(${n(s)})">
<rect x="-80" y="-14" width="130" height="28" rx="6" fill="${fill}" ${OUTLINE}/>
<rect x="-96" y="-14" width="20" height="28" rx="6" fill="#ff8fab" ${OUTLINE}/>
<path d="M50 -14 L88 0 L50 14 Z" fill="#f6d8a8" ${OUTLINE}/><path d="M76 -4 L88 0 L76 4 Z" fill="#3a2b20"/>
</g>`;
}

/** A ribbon bookmark hanging down; (x, y) is its top. */
export const bookmark = (x: number, y: number, s: number, fill: string) =>
  `<path d="M${n(x - 18 * s)} ${n(y)} h${n(36 * s)} v${n(110 * s)} l${n(-18 * s)} ${n(-18 * s)} l${n(-18 * s)} ${n(18 * s)} z" fill="${fill}" ${OUTLINE}/>`;

/** A row of books on a shelf from x0 to x1; (y) is the shelf's top. */
export function shelfRow(r: Rng, x0: number, x1: number, y: number, colours: string[]) {
  let s = '';
  let x = x0 + 8;
  while (x < x1 - 30) {
    const w = between(r, 30, 52), h = between(r, 110, 160), tilt = r() < 0.12 ? between(r, -10, -6) : 0;
    s += spine(x + w / 2, y, w, h, pick(r, colours), '#fff4c2', tilt);
    x += w + between(r, 3, 8);
  }
  return `${s}<rect x="${n(x0 - 14)}" y="${n(y)}" width="${n(x1 - x0 + 28)}" height="22" rx="8" fill="#d6a46c" ${OUTLINE}/>`;
}

// ------------------------------------------------------------------ pieces for the card maker

const pieceBooks: Piece = (r, p) => `${lying(0, 80, 170, 40, pick(r, p.acc))}${lying(-6, 40, 150, 36, pick(r, p.acc))}${lying(4, 4, 130, 34, pick(r, p.acc))}`;
const pieceOpen: Piece = (r, p) => openBook(0, 50, 0.72, pick(r, p.acc), p) + sparkle(between(r, -40, 40), -60, 14, pick(r, p.acc));
const pieceOwl: Piece = (r, p) => owl(0, 0, 0.92, pick(r, p.acc), p);
const pieceSpine: Piece = (r, p) => spine(0, 92, 54, 180, pick(r, p.acc), '#fff4c2', between(r, -8, 8));
const pieceBlock: Piece = (r, p) => block(0, 0, 1.6, pick(r, ['A', 'B', 'C', 'अ', 'ಅ', 'Z']), pick(r, p.acc), between(r, -10, 10));
const piecePencil: Piece = (r, p) => pencil(0, 0, 0.95, pick(r, p.acc), between(r, -40, -20));
const pieceMark: Piece = (r, p) => bookmark(0, -70, 1.2, pick(r, p.acc));
const pieceStar: Piece = (r, p) => star(0, 0, 70, pick(r, p.acc), between(r, -15, 15));
const pieceLamp: Piece = (r, p) => lamp(-20, 90, 0.85, pick(r, p.acc));

/** One kit for every library day: the maker draws a new card from these. */
export const libraryKit: Kit = {
  hero: [pieceOpen, pieceOwl, pieceBooks, pieceLamp],
  small: [pieceSpine, pieceBlock, pieceStar, pieceMark, piecePencil, pieceBooks],
};

export const libraryKits: Record<string, Kit> = {
  'world-book-day': libraryKit,
  'childrens-book-day': libraryKit,
  'reading-day': libraryKit,
  'librarians-day': libraryKit,
  'literacy-day': { ...libraryKit, hero: [pieceOpen, pieceBlock, pieceOwl], small: [pieceBlock, piecePencil, pieceStar, pieceMark] },
};
