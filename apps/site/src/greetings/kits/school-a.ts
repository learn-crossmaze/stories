// Symbols for the card maker (src/greetings/maker.ts): Women's Day, World Health Day, Earth Day, Mother's Day,
// World Environment Day and Father's Day. Every piece is drawn in a 200 × 200 box centred on (0, 0), inside −95…95.
import type { Kit, Piece } from '../maker';
import { flower, heart, leaf, n, OUTLINE, sparkle, star, sun } from '../motifs';
import { between, pick, whole } from '../palettes';
import type { Rng } from '../types';

const STEM = '#3f9e4d';
const GREENS = ['#5cb85c', '#43a047', '#7cc96a'];
const WATER = '#4cb8f0';
const BROWN = '#8d5a3b';
const FACE = '#5a3214';
const CHEEK = '#ff7aa8';
const GOLD = '#ffc93c';
const PURPLES = ['#8e44ad', '#9b5de5', '#b57edc', '#a05bc8'];
const SKIN = ['#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#a8693f'];
const HAIR = ['#3b2314', '#1f1a17', '#5a3418', '#2b2b3a'];

/** A soft ink outline for white or very pale shapes, which a white outline would lose. */
const soft = (ink: string, w = 5) => `stroke="${ink}" stroke-opacity=".2" stroke-width="${w}" stroke-linejoin="round"`;
/** Moves, turns and sizes a drawing. */
const at = (svg: string, x: number, y: number, s = 1, rot = 0) =>
  `<g transform="translate(${n(x)} ${n(y)})${rot ? ` rotate(${n(rot)})` : ''}${s !== 1 ? ` scale(${n(s * 100) / 100})` : ''}">${svg}</g>`;
/** A string from the top of the box down to `top`, for things that hang. */
const string = (top: number, ink: string) => `<line x1="0" y1="-95" x2="0" y2="${top}" stroke="${ink}" stroke-width="4" opacity=".45"/>`;
/** True for green and teal colours, which would vanish against leaves. */
function greenish(hex: string) {
  const [red, green, blue] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return green > red + 30 && green >= blue;
}
const notGreen = (list: string[]) => list.filter((c) => !greenish(c));

/** Two dot eyes, a smile and pink cheeks; (x, y) is the middle of the face, R its size. */
function face(x: number, y: number, R: number, ink = FACE, cheeks = true) {
  const w = Math.max(2.5, R * 0.08);
  return `<circle cx="${n(x - R * 0.32)}" cy="${n(y - R * 0.12)}" r="${n(R * 0.09)}" fill="${ink}"/><circle cx="${n(x + R * 0.32)}" cy="${n(y - R * 0.12)}" r="${n(R * 0.09)}" fill="${ink}"/>
${cheeks ? `<circle cx="${n(x - R * 0.56)}" cy="${n(y + R * 0.14)}" r="${n(R * 0.14)}" fill="${CHEEK}" opacity=".5"/><circle cx="${n(x + R * 0.56)}" cy="${n(y + R * 0.14)}" r="${n(R * 0.14)}" fill="${CHEEK}" opacity=".5"/>` : ''}
<path d="M${n(x - R * 0.24)} ${n(y + R * 0.14)} q${n(R * 0.24)} ${n(R * 0.24)} ${n(R * 0.48)} 0" fill="none" stroke="${ink}" stroke-width="${n(w)}" stroke-linecap="round"/>`;
}

// ---------------------------------------------------------------------------------------------- flowers

/** A tulip head; (x, y) is its middle. */
const tulipHead = (x: number, y: number, s: number, c: string) =>
  `<path d="M${n(x - 34 * s)} ${n(y - 40 * s)} L${n(x - 17 * s)} ${n(y - 18 * s)} L${n(x)} ${n(y - 48 * s)} L${n(x + 17 * s)} ${n(y - 18 * s)} L${n(x + 34 * s)} ${n(y - 40 * s)} Q${n(x + 40 * s)} ${n(y + 24 * s)} ${n(x)} ${n(y + 32 * s)} Q${n(x - 40 * s)} ${n(y + 24 * s)} ${n(x - 34 * s)} ${n(y - 40 * s)} Z" fill="${c}" ${OUTLINE}/>
<path d="M${n(x - 16 * s)} ${n(y - 8 * s)} Q${n(x - 18 * s)} ${n(y + 12 * s)} ${n(x - 4 * s)} ${n(y + 20 * s)}" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" opacity=".55"/>`;

/** A rose seen from above: a round head with a swirl of petals; (x, y) its middle, R its radius. */
const roseHead = (x: number, y: number, R: number, c: string) =>
  `<path d="M${n(x - R)} ${n(y - R * 0.5)} Q${n(x - R * 0.5)} ${n(y - R * 0.95)} ${n(x - R * 0.2)} ${n(y - R * 0.6)} Q${n(x)} ${n(y - R * 1.05)} ${n(x + R * 0.2)} ${n(y - R * 0.6)} Q${n(x + R * 0.5)} ${n(y - R * 0.95)} ${n(x + R)} ${n(y - R * 0.5)} Q${n(x + R * 1.05)} ${n(y + R * 0.75)} ${n(x)} ${n(y + R * 0.85)} Q${n(x - R * 1.05)} ${n(y + R * 0.75)} ${n(x - R)} ${n(y - R * 0.5)} Z" fill="${c}" ${OUTLINE}/>
<path d="M${n(x - R * 0.72)} ${n(y - R * 0.2)} Q${n(x)} ${n(y + R * 0.75)} ${n(x + R * 0.72)} ${n(y - R * 0.2)} M${n(x - R * 0.42)} ${n(y - R * 0.42)} Q${n(x)} ${n(y + R * 0.25)} ${n(x + R * 0.42)} ${n(y - R * 0.42)}" fill="none" stroke="#fff" stroke-width="${n(Math.max(3, R * 0.08))}" stroke-linecap="round" opacity=".7"/>`;

/** One of five flower heads (petals, tulip, daisy, double bloom, rose); (x, y) is its middle, about 34·s across. */
function bloom(kind: number, x: number, y: number, s: number, c: string, c2: string, rot: number) {
  switch (kind % 5) {
    case 0: return flower(x, y, 6, 64 * s, 50 * s, [c, c2], GOLD, rot, 20 * s);
    case 1: return tulipHead(x, y + 6 * s, s * 1.1, c);
    case 2: return flower(x, y, 12, 60 * s, 22 * s, [c], GOLD, rot, 18 * s);
    case 3: return flower(x, y, 8, 66 * s, 40 * s, [c], GOLD, rot, 14 * s) + flower(x, y, 8, 38 * s, 26 * s, [c2], GOLD, rot + Math.PI / 8, 13 * s);
    default: return roseHead(x, y, 50 * s, c);
  }
}

/** A green stem from (x0, y0) up to (x1, y1), bending by `bend`. */
const stem = (x0: number, y0: number, x1: number, y1: number, bend = 0, w = 8) =>
  `<path d="M${n(x0)} ${n(y0)} Q${n((x0 + x1) / 2 + bend)} ${n((y0 + y1) / 2)} ${n(x1)} ${n(y1)}" fill="none" stroke="${STEM}" stroke-width="${w}" stroke-linecap="round"/>`;

/** A water drop; (x, y) is its middle. */
const drop = (x: number, y: number, s: number, fill = WATER) =>
  `<path d="M${n(x)} ${n(y - 22 * s)} C${n(x + 6 * s)} ${n(y - 10 * s)} ${n(x + 16 * s)} ${n(y)} ${n(x + 16 * s)} ${n(y + 8 * s)} A${n(16 * s)} ${n(16 * s)} 0 0 1 ${n(x - 16 * s)} ${n(y + 8 * s)} C${n(x - 16 * s)} ${n(y)} ${n(x - 6 * s)} ${n(y - 10 * s)} ${n(x)} ${n(y - 22 * s)} Z" fill="${fill}" ${OUTLINE}/>`;

/** A bow with two loops and tails; (x, y) is its knot. */
const bow = (x: number, y: number, s: number, c: string) =>
  `<path d="M${n(x)} ${n(y)} l${n(-22 * s)} ${n(40 * s)} l${n(12 * s)} ${n(-4 * s)} l${n(6 * s)} ${n(10 * s)} z M${n(x)} ${n(y)} l${n(22 * s)} ${n(40 * s)} l${n(-12 * s)} ${n(-4 * s)} l${n(-6 * s)} ${n(10 * s)} z" fill="${c}" ${OUTLINE}/>
<ellipse cx="${n(x - 22 * s)}" cy="${n(y - 6 * s)}" rx="${n(22 * s)}" ry="${n(13 * s)}" transform="rotate(-20 ${n(x - 22 * s)} ${n(y - 6 * s)})" fill="${c}" ${OUTLINE}/>
<ellipse cx="${n(x + 22 * s)}" cy="${n(y - 6 * s)}" rx="${n(22 * s)}" ry="${n(13 * s)}" transform="rotate(20 ${n(x + 22 * s)} ${n(y - 6 * s)})" fill="${c}" ${OUTLINE}/>
<circle cx="${n(x)}" cy="${n(y - 2 * s)}" r="${n(9 * s)}" fill="${c}" ${OUTLINE}/>`;

/** A bouquet of flowers in a paper wrap tied with a bow. */
const bouquetOf = (wraps: (p: string[]) => string[]): Piece => (r, p) => {
  const cs = notGreen(p.acc), wrap = pick(r, wraps(p.acc)), tie = pick(r, cs.filter((c) => c !== wrap).concat(GOLD));
  const heads: [number, number][] = [[-50, -38], [50, -38], [0, -60], [-24, -14], [24, -14]];
  let s = '';
  for (const [x, y] of heads) s += stem(0, 40, x, y, between(r, -10, 10));
  s += leaf(-10, 6, 56, GREENS[0], -150) + leaf(10, 6, 56, GREENS[1], -30) + leaf(0, 10, 50, GREENS[2], -95);
  const kinds = [0, 1, 2, 3, 4].sort(() => r() - 0.5);
  heads.forEach(([x, y], i) => (s += bloom(kinds[i], x, y, 0.52, pick(r, cs), pick(r, cs), r() * Math.PI)));
  s += `<path d="M-62 -2 L62 -2 L16 88 Q0 94 -16 88 Z" fill="${wrap}" ${OUTLINE}/>
<path d="M-30 6 L-2 82 M30 6 L4 82" stroke="#fff" stroke-width="4" opacity=".45" stroke-linecap="round"/>`;
  return s + bow(0, 40, 0.95, tie);
};

/** A single flower on a stem with two leaves. */
const stemFlower = (kindOf: (r: Rng) => number, colours: (p: string[]) => string[]): Piece => (r, p) => {
  const cs = colours(p.acc), kind = kindOf(r) % 5;
  return stem(0, 90, 0, -30, between(r, -12, 12), 10) + leaf(0, 50, 64, GREENS[0], -40) + leaf(0, 64, 58, GREENS[1], -150) +
    bloom(kind, 0, -40, [0.76, 1.3, 0.8, 0.76, 0.98][kind], pick(r, cs), pick(r, cs), r() * Math.PI);
};

/** A flower crown: a green ring of leaves and flowers, with ribbon tails. */
const flowerCrown = (ribbons: (p: string[]) => string[]): Piece => (r, p) => {
  const cs = notGreen(p.acc), tie = pick(r, ribbons(p.acc));
  let s = `<path d="M-14 58 l-26 34 l14 -2 l6 12 z M14 58 l26 34 l-14 -2 l-6 12 z" fill="${tie}" ${OUTLINE}/>
<circle cx="0" cy="0" r="62" fill="none" stroke="${STEM}" stroke-width="9"/>`;
  for (let i = 0; i < 12; i++) {
    const a = (2 * Math.PI * (i + 0.5)) / 12, x = Math.cos(a) * 62, y = Math.sin(a) * 62;
    s += leaf(x, y, 30, pick(r, GREENS), (a * 180) / Math.PI + (i % 2 ? 60 : -60));
  }
  const count = 8, rot = r() * Math.PI, kind = whole(r, 0, 3);
  for (let i = 0; i < count; i++) {
    const a = rot + (2 * Math.PI * i) / count;
    s += bloom(i % 2 ? kind : 0, Math.cos(a) * 62, Math.sin(a) * 62, 0.44, pick(r, cs), pick(r, cs), r() * Math.PI);
  }
  return s + bow(0, 58, 0.7, tie);
};

/** A heart with a white shine. */
const bigHeart = (colours: (p: string[]) => string[]): Piece => (r, p) =>
  heart(0, 6, 74, pick(r, colours(p.acc))) + `<path d="M-50 -30 q8 -22 28 -24" fill="none" stroke="#fff" stroke-width="9" stroke-linecap="round" opacity=".55"/>`;

/** A twinkling star. */
const bigStar = (colours: (p: string[]) => string[]): Piece => (r, p) =>
  star(0, 6, 88, pick(r, colours(p.acc)), between(r, -0.15, 0.15)) + sparkle(70, -70, 16, '#fff') + sparkle(-74, 62, 12, '#fff');

/** Something on a string. */
const hanging = (body: Piece, s: number, bodyTop: number, len = 22): Piece => (r, p) => string(-95 + len, p.ink) + at(body(r, p), 0, -95 + len - bodyTop * s, s);

// ---------------------------------------------------------------------------------------------- Women's Day

const purple = () => PURPLES;
const purplePink = (acc: string[]) => [...PURPLES, ...notGreen(acc).slice(0, 2)];

/** The purple ribbon of Women's Day. */
const ribbon: Piece = (r) => {
  const c = pick(r, PURPLES);
  const d = 'M-42 84 L14 -6 Q40 -50 0 -72 Q-40 -50 -14 -6 L42 84';
  return `<path d="${d}" fill="none" stroke="#fff" stroke-width="40" stroke-linejoin="round"/>
<path d="${d}" fill="none" stroke="${c}" stroke-width="30" stroke-linejoin="round"/>
<path d="M-6 -60 Q-22 -46 -12 -24" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round" opacity=".5"/>`;
};

/** Three women holding hands, in different dresses, hair and skin tones (sometimes with a little girl). */
const friends: Piece = (r, p) => {
  const skins = [...SKIN].sort(() => r() - 0.5), dresses = [...PURPLES.slice(0, 2), ...notGreen(p.acc)].sort(() => r() - 0.5);
  const girl = r() < 0.35 ? whole(r, 0, 2) : -1;
  const xs = [-62, 0, 62];
  let arms = '', bodies = '';
  const shoulder = (i: number) => (i === girl ? -2 : -22);
  xs.forEach((x, i) => {
    const k = i === girl ? 0.74 : 1, top = 90 - 150 * k;
    const head = top + 22 * k, neck = head + 22 * k, hem = 62, skin = skins[i], hair = pick(r, HAIR), dress = dresses[i % dresses.length];
    // Arms: to the neighbours' hands, and the outer ones waving up.
    for (const side of [-1, 1]) {
      const j = i + side, sy = shoulder(i);
      if (j >= 0 && j < 3) {
        const hx = (x + xs[j]) / 2, hy = (shoulder(i) + shoulder(j)) / 2 + 22;
        arms += `<path d="M${n(x + side * 10)} ${n(sy)} L${n(hx)} ${n(hy)}" stroke="${skin}" stroke-width="9" stroke-linecap="round"/><circle cx="${n(hx)}" cy="${n(hy)}" r="7" fill="${skin}"/>`;
      } else arms += `<path d="M${n(x + side * 10)} ${n(sy)} q${n(side * 18)} -6 ${n(side * 24)} -34" fill="none" stroke="${skin}" stroke-width="9" stroke-linecap="round"/><circle cx="${n(x + side * 24)}" cy="${n(sy - 38)}" r="7" fill="${skin}"/>`;
    }
    const style = whole(r, 0, 2);
    const hairBack = style === 0
      ? `<path d="M${n(x - 24 * k)} ${n(head)} q0 ${n(48 * k)} ${n(-6 * k)} ${n(58 * k)} h${n(60 * k)} q${n(-6 * k)} ${n(-10 * k)} ${n(-6 * k)} ${n(-58 * k)} z" fill="${hair}"/>`
      : style === 1 ? `<circle cx="${n(x)}" cy="${n(head - 26 * k)}" r="${n(12 * k)}" fill="${hair}"/>` : '';
    bodies += `${hairBack}
<path d="M${n(x)} ${n(neck - 4)} L${n(x + 30 * k)} ${n(hem)} Q${n(x)} ${n(hem + 8)} ${n(x - 30 * k)} ${n(hem)} Z" fill="${dress}" ${OUTLINE}/>
<path d="M${n(x - 10 * k)} ${n(hem + 2)} V${n(90)} M${n(x + 10 * k)} ${n(hem + 2)} V${n(90)}" stroke="${skin}" stroke-width="8" stroke-linecap="round"/>
<circle cx="${n(x)}" cy="${n(head)}" r="${n(22 * k)}" fill="${skin}" ${OUTLINE}/>
<path d="M${n(x - 23 * k)} ${n(head - 2)} a${n(23 * k)} ${n(23 * k)} 0 0 1 ${n(46 * k)} 0 q${n(-20 * k)} ${n(-4 * k)} ${n(-30 * k)} ${n(-14 * k)} q${n(-6 * k)} ${n(12 * k)} ${n(-16 * k)} ${n(14 * k)} z" fill="${hair}"/>
${face(x, head + 4 * k, 20 * k, FACE)}`;
  });
  const h = pick(r, PURPLES);
  return arms + bodies + heart(-31, -62, 9, h) + heart(31, -62, 9, h);
};

const womensDay: Kit = {
  hero: [bouquetOf(purple), flowerCrown(purple), friends, bouquetOf(purplePink)],
  small: [ribbon, stemFlower(() => 1, purplePink), stemFlower(() => 4, purplePink), bigHeart(purplePink), bigStar(() => [GOLD, ...PURPLES.slice(1, 3)]), stemFlower((r) => pick(r, [0, 2, 3]), purplePink), flowerCrown(purple)],
  hang: [hanging(bigHeart(purplePink), 0.62, -54), hanging(ribbon, 0.62, -80), hanging(bigStar(() => [GOLD, '#b57edc']), 0.62, -80)],
  colours: ['#8e44ad', '#b57edc', '#9b5de5', '#ff7aa8', GOLD, '#ffffff'],
};

// ---------------------------------------------------------------------------------------------- World Health Day

const APPLES = ['#e8473c', '#e53935', '#ef5350'];
const applePath = 'M0 -50 C30 -82 96 -62 86 0 C80 58 40 92 0 76 C-40 92 -80 58 -86 0 C-96 -62 -30 -82 0 -50 Z';

/** A shiny apple with a leaf. */
const apple: Piece = (r) => {
  const c = r() < 0.8 ? pick(r, APPLES) : '#8bc34a';
  return `<path d="M0 -48 q2 -24 12 -40" fill="none" stroke="${BROWN}" stroke-width="9" stroke-linecap="round"/>
${leaf(8, -72, 52, GREENS[1], -20)}
<g transform="translate(0 8)"><path d="${applePath}" fill="${c}" ${OUTLINE}/>
<path d="M-56 -24 q6 -24 30 -30" fill="none" stroke="#fff" stroke-width="10" stroke-linecap="round" opacity=".55"/><circle cx="-62" cy="0" r="6" fill="#fff" opacity=".55"/></g>`;
};

const orange = (x: number, y: number, R: number) =>
  `<circle cx="${n(x)}" cy="${n(y)}" r="${n(R)}" fill="#ffa62b" ${OUTLINE}/><circle cx="${n(x - R * 0.35)}" cy="${n(y - R * 0.35)}" r="${n(R * 0.18)}" fill="#fff" opacity=".55"/>${leaf(x, y - R, R * 0.7, GREENS[0], -30)}`;
const banana = (x: number, y: number, s: number) =>
  `<path d="M${n(x - 50 * s)} ${n(y - 26 * s)} Q${n(x - 40 * s)} ${n(y + 30 * s)} ${n(x + 40 * s)} ${n(y + 14 * s)} Q${n(x + 56 * s)} ${n(y + 8 * s)} ${n(x + 50 * s)} ${n(y)} Q${n(x - 20 * s)} ${n(y + 10 * s)} ${n(x - 34 * s)} ${n(y - 30 * s)} Z" fill="#ffd23f" ${OUTLINE}/>
<path d="M${n(x - 50 * s)} ${n(y - 26 * s)} l${n(-4 * s)} ${n(-8 * s)}" stroke="${BROWN}" stroke-width="6" stroke-linecap="round"/>`;
const grapes = (x: number, y: number, s: number) => {
  let g = `<path d="M${n(x)} ${n(y - 40 * s)} q4 -12 12 -16" fill="none" stroke="${BROWN}" stroke-width="5" stroke-linecap="round"/>`;
  for (const [dx, dy] of [[-20, -26], [0, -28], [20, -26], [-10, -8], [10, -8], [-20, 10], [20, 10], [0, 12], [-10, 30], [10, 30], [0, 48]])
    g += `<circle cx="${n(x + dx * s)}" cy="${n(y + dy * s)}" r="${n(12 * s)}" fill="#8e44ad" stroke="#fff" stroke-width="3"/>`;
  return g;
};

/** A basket of fruit: apple, orange, banana and grapes. */
const fruitBasket: Piece = (r, p) => {
  const flip = r() < 0.5 ? -1 : 1;
  return `<path d="M-72 26 Q-70 -92 0 -92 Q70 -92 72 26" fill="none" stroke="#fff" stroke-width="18" stroke-linecap="round"/><path d="M-72 26 Q-70 -92 0 -92 Q70 -92 72 26" fill="none" stroke="#c98b4a" stroke-width="10" stroke-linecap="round"/>
<g transform="scale(${flip} 1)">${grapes(-46, -10, 1.05)}${at(apple(r, p), 40, -4, 0.48)}${banana(-2, 6, 1.05)}${orange(-4, -30, 30)}</g>
<path d="M-88 28 H88 L70 86 Q68 92 60 92 H-60 Q-68 92 -70 86 Z" fill="#c98b4a" ${OUTLINE}/>
<path d="M-82 50 H82 M-76 70 H76" stroke="#a86f35" stroke-width="6"/>
<path d="M-44 30 L-38 90 M0 30 V90 M44 30 L38 90" stroke="#e0a96d" stroke-width="5"/>
<rect x="-94" y="20" width="188" height="16" rx="8" fill="#a86f35" ${OUTLINE}/>`;
};

/** A heart with a heartbeat line. */
const heartbeat: Piece = (r) =>
  heart(0, 6, 76, pick(r, ['#ef5350', '#ff6b8b', '#e8473c'])) +
  `<path d="M-74 2 H-38 L-24 -28 L-6 34 L10 -16 L20 2 H74" fill="none" stroke="#fff" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>`;

/** A carrot with its leafy top. */
const carrot: Piece = () =>
  `<g transform="rotate(-24)">${leaf(0, -56, 50, GREENS[0], -110)}${leaf(0, -56, 44, GREENS[1], -70)}${leaf(0, -56, 42, GREENS[2], -140)}
<path d="M-30 -56 Q0 -66 30 -56 L4 90 Q0 96 -4 90 Z" fill="#ff8c42" ${OUTLINE}/>
<path d="M-20 -16 h16 M4 20 h14 M-10 56 h10" stroke="#fff" stroke-width="5" stroke-linecap="round" opacity=".6"/></g>`;

/** A glass of water or milk with a straw. */
const glass: Piece = (r, p) => {
  const milk = r() < 0.4, straw = pick(r, notGreen(p.acc));
  return `<path d="M14 -40 L34 -92" stroke="${straw}" stroke-width="10" stroke-linecap="round"/>
<path d="M-50 -74 H50 L38 88 H-38 Z" fill="#eef8ff" ${soft(p.ink)}/>
<path d="M-46 -30 H46 L38 82 H-38 Z" fill="${milk ? '#ffffff' : WATER}" ${milk ? soft(p.ink, 4) : ''} opacity="${milk ? 1 : 0.8}"/>
<path d="M-28 -60 L-20 70" stroke="#fff" stroke-width="9" stroke-linecap="round" opacity=".8"/>
${milk ? '' : '<circle cx="12" cy="10" r="6" fill="#fff" opacity=".7"/><circle cx="22" cy="40" r="4" fill="#fff" opacity=".7"/><circle cx="4" cy="58" r="5" fill="#fff" opacity=".7"/>'}`;
};

/** A toothbrush with a blob of toothpaste. */
const toothbrush: Piece = (r, p) => {
  const c = pick(r, notGreen(p.acc));
  let bristles = '';
  for (let x = 34; x <= 84; x += 10) bristles += `<path d="M${x} -8 V-34" stroke="#cfe3f2" stroke-width="3"/>`;
  return `<g transform="rotate(-30)">
<rect x="28" y="-36" width="62" height="30" rx="6" fill="#ffffff" ${soft(p.ink)}/>${bristles}
<path d="M30 -36 q8 -18 20 -6 q8 -16 20 -2 q10 -14 22 0 q-4 -10 -12 -14 q-30 -10 -50 22 z" fill="#7fd3f7" ${OUTLINE}/>
<path d="M-92 -6 Q-92 -16 -82 -16 L20 -8 Q30 -8 30 0 V6 Q30 12 20 12 L-82 10 Q-92 10 -92 0 Z" fill="${c}" ${OUTLINE}/>
<rect x="-74" y="-8" width="34" height="8" rx="4" fill="#fff" opacity=".55"/></g>`;
};

/** A bar of soap with bubbles. */
const soap: Piece = (r, p) => {
  const c = pick(r, ['#ff9ec4', '#a8e6cf', '#ffd6a5', '#c5b3ff']);
  let bubbles = '';
  for (const [x, y, R] of [[-30, -38, 26], [18, -58, 20], [50, -26, 30], [60, -74, 14], [-62, -64, 14], [-6, -82, 10]])
    bubbles += `<circle cx="${x}" cy="${y}" r="${R}" fill="#e6f6ff" fill-opacity=".85" stroke="#9fd8f5" stroke-width="4"/><circle cx="${x - R * 0.35}" cy="${y - R * 0.35}" r="${n(R * 0.22)}" fill="#fff"/>`;
  return `<rect x="-84" y="8" width="168" height="78" rx="30" fill="${c}" ${OUTLINE}/>
<rect x="-56" y="24" width="112" height="20" rx="10" fill="#fff" opacity=".45"/>
<path d="M-70 14 q10 -18 26 -8 q10 -16 26 -2 q12 -14 28 0 q14 -12 26 4 Z" fill="#ffffff" ${soft(p.ink, 4)}/>${bubbles}`;
};

/** A sleeping moon with two stars. */
const sleepyMoon: Piece = (r) => {
  const c = pick(r, ['#ffd166', GOLD, '#ffe08a']);
  return `<path d="M24 -84 A86 86 0 1 0 24 84 A66 66 0 1 1 24 -84 Z" transform="translate(6 0)" fill="${c}" ${OUTLINE}/>
<path d="M-56 -10 q10 10 20 0" fill="none" stroke="${FACE}" stroke-width="5" stroke-linecap="round"/>
<circle cx="-36" cy="12" r="8" fill="${CHEEK}" opacity=".5"/><path d="M-62 28 q10 8 20 2" fill="none" stroke="${FACE}" stroke-width="5" stroke-linecap="round"/>
${star(54, -52, 24, GOLD)}${star(66, 26, 16, GOLD)}${sparkle(30, -10, 10, '#fff')}`;
};

/** A running shoe. */
const shoe: Piece = (r, p) => {
  const c = pick(r, notGreen(p.acc));
  return `<path d="M-88 34 Q-90 -2 -72 -14 L-40 -36 Q-30 -44 -16 -34 L4 -20 Q24 -8 56 0 Q88 8 90 34 Z" fill="${c}" ${OUTLINE}/>
<path d="M-92 34 H92 Q92 56 72 56 H-74 Q-92 56 -92 34 Z" fill="#ffffff" ${soft(p.ink)}/>
<path d="M-28 -24 l14 10 M-16 -32 l14 10 M-4 -18 l14 10" stroke="#fff" stroke-width="5" stroke-linecap="round"/>
<path d="M-60 6 q40 -6 70 6" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round" opacity=".6"/>
<path d="M-88 44 H86" stroke="${p.ink}" stroke-width="3" opacity=".15"/>`;
};

const healthDay: Kit = {
  hero: [apple, fruitBasket, heartbeat],
  small: [apple, carrot, glass, toothbrush, soap, sleepyMoon, shoe, heartbeat],
  hang: [hanging(apple, 0.6, -86), hanging(heartbeat, 0.6, -54), hanging(() => orange(0, 10, 70), 0.6, -76)],
};

// ---------------------------------------------------------------------------------------------- Earth Day

/** Planet Earth: blue sea, simple green continents, a wisp of cloud. */
const globeArt = (r: Rng, R = 86) => {
  const flip = r() < 0.5 ? -1 : 1, g1 = pick(r, GREENS), g2 = pick(r, GREENS), k = R / 86, turn = between(r, -18, 18);
  return `<circle cx="0" cy="0" r="${R}" fill="${WATER}" ${OUTLINE}/>
<g transform="scale(${n(flip * k * 100) / 100} ${n(k * 100) / 100}) rotate(${n(turn)})">
<path d="M-66 -44 C-56 -64 -24 -72 -14 -56 C-6 -44 -22 -34 -30 -26 C-36 -18 -40 -12 -44 -4 C-52 -8 -62 -18 -68 -30 Z" fill="${g1}"/>
<path d="M-34 6 C-20 2 -8 12 -12 28 C-16 46 -24 60 -32 70 C-40 56 -46 38 -46 22 C-46 12 -40 8 -34 6 Z" fill="${g1}"/>
<path d="M6 -66 C24 -78 62 -70 74 -46 C80 -32 70 -26 56 -26 C48 -26 44 -16 52 -4 C60 8 54 24 42 36 C34 46 30 56 22 58 C16 46 18 30 10 20 C2 10 -2 -4 6 -14 C12 -22 2 -30 0 -42 C-2 -52 -2 -60 6 -66 Z" fill="${g2}"/>
<ellipse cx="58" cy="44" rx="13" ry="8" fill="${g1}"/>
<path d="M-68 -38 a80 80 0 0 1 32 -40" fill="none" stroke="#fff" stroke-width="9" stroke-linecap="round" opacity=".5"/></g>`;
};

const globe: Piece = (r) => globeArt(r) + sparkle(76, -76, 14, '#fff');

/** The Earth held by two leafy branches. */
const leafyGlobe: Piece = (r) => {
  let s = globeArt(r, 70);
  for (const side of [-1, 1]) {
    s += `<path d="M${side * 14} 90 Q${side * 92} 70 ${side * 78} -40" fill="none" stroke="${STEM}" stroke-width="7" stroke-linecap="round"/>`;
    for (let i = 0; i < 5; i++) {
      const t = 0.15 + i * 0.19, x = (1 - t) * (1 - t) * side * 14 + 2 * (1 - t) * t * side * 92 + t * t * side * 78, y = (1 - t) * (1 - t) * 90 + 2 * (1 - t) * t * 70 + t * t * -40;
      s += leaf(x, y, 34, GREENS[i % 3], side > 0 ? -10 - i * 18 : -170 + i * 18);
    }
  }
  return s;
};

/** Two cupped hands holding a sapling in soil. */
const saplingHands: Piece = (r) => {
  const skin = pick(r, SKIN);
  const hand = (k: number) => `<g transform="scale(${k} 1)"><path d="M-2 90 Q-40 92 -60 82 A11 11 0 0 1 -72 64 A11 11 0 0 1 -80 44 A11 11 0 0 1 -84 24 A11 11 0 0 1 -82 4 Q-74 -6 -62 2 Q-34 22 -2 22 Z" fill="${skin}" ${OUTLINE}/>
<path d="M-70 66 l12 -2 M-78 46 l13 -2 M-82 26 l13 -1" stroke="#000" stroke-opacity=".15" stroke-width="4" stroke-linecap="round"/>
<path d="M-60 -2 Q-44 -12 -30 6 Q-36 16 -50 10 Z" fill="${skin}" ${OUTLINE}/></g>`;
  return `${stem(0, 10, 0, -58, between(r, -8, 8), 8)}${leaf(0, -46, 54, GREENS[0], -30)}${leaf(0, -46, 54, GREENS[1], -150)}${leaf(0, -20, 36, GREENS[2], -10)}
<path d="M-66 14 Q0 -28 66 14 Z" fill="${BROWN}" ${OUTLINE}/>${hand(1)}${hand(-1)}`;
};

/** A round leafy tree, sometimes with fruit or a bird. */
const tree: Piece = (r, p) => {
  const fruit = r() < 0.6, cs = notGreen(p.acc);
  let s = `<ellipse cx="0" cy="88" rx="62" ry="8" fill="${GREENS[2]}"/>
<path d="M-14 88 L-10 20 L10 20 L14 88 Z" fill="${BROWN}" ${OUTLINE}/><path d="M0 40 L-24 14 M2 50 L22 26" stroke="${BROWN}" stroke-width="8" stroke-linecap="round"/>`;
  for (const [x, y, R, g] of [[-44, -10, 42, 1], [44, -10, 42, 1], [0, -46, 48, 0], [-24, 12, 34, 2], [24, 12, 34, 2], [0, -6, 44, 0]] as const)
    s += `<circle cx="${x}" cy="${y}" r="${R}" fill="${GREENS[g]}" ${OUTLINE}/>`;
  s += `<circle cx="-22" cy="-62" r="12" fill="#fff" opacity=".35"/>`;
  if (fruit) {
    const c = pick(r, cs);
    for (const [x, y] of [[-46, -18], [30, -40], [52, 4], [-10, 10], [-30, -50], [14, -10]]) s += `<circle cx="${x}" cy="${y}" r="8" fill="${c}" stroke="#fff" stroke-width="3"/>`;
  }
  return s;
};

/** A butterfly; colours from the theme. */
const butterfly: Piece = (r, p) => {
  const cs = notGreen(p.acc), c1 = pick(r, cs), c2 = pick(r, cs.filter((c) => c !== c1)), s = 1.35, ink = p.ink;
  const wing = (dx: number, dy: number, rx: number, ry: number, rot: number, c: string) =>
    `<ellipse cx="${n(dx * s)}" cy="${n(dy * s)}" rx="${n(rx * s)}" ry="${n(ry * s)}" transform="rotate(${rot} ${n(dx * s)} ${n(dy * s)})" fill="${c}" ${OUTLINE}/>`;
  return `<g transform="translate(0 12) rotate(${n(between(r, -10, 10))})">
${wing(-30, -18, 34, 26, -25, c1)}${wing(30, -18, 34, 26, 25, c1)}${wing(-22, 20, 22, 18, 20, c2)}${wing(22, 20, 22, 18, -20, c2)}
<circle cx="${n(-30 * s)}" cy="${n(-20 * s)}" r="${n(9 * s)}" fill="#fff" opacity=".6"/><circle cx="${n(30 * s)}" cy="${n(-20 * s)}" r="${n(9 * s)}" fill="#fff" opacity=".6"/>
<rect x="${n(-7 * s)}" y="${n(-34 * s)}" width="${n(14 * s)}" height="${n(68 * s)}" rx="${n(7 * s)}" fill="${ink}"/>
<path d="M${n(-3 * s)} ${n(-32 * s)} q${n(-8 * s)} ${n(-20 * s)} ${n(-20 * s)} ${n(-26 * s)} M${n(3 * s)} ${n(-32 * s)} q${n(8 * s)} ${n(-20 * s)} ${n(20 * s)} ${n(-26 * s)}" fill="none" stroke="${ink}" stroke-width="4" stroke-linecap="round"/>
<circle cx="${n(-23 * s)}" cy="${n(-58 * s)}" r="${n(5 * s)}" fill="${ink}"/><circle cx="${n(23 * s)}" cy="${n(-58 * s)}" r="${n(5 * s)}" fill="${ink}"/></g>`;
};

/** A bumble bee. */
const bee: Piece = (r, p) => {
  const ink = p.ink, dir = r() < 0.5 ? 1 : -1;
  return `<g transform="translate(${-dir * 6} 18) scale(${dir * 2} 2)">
<ellipse cx="-8" cy="-26" rx="16" ry="22" transform="rotate(-25 -8 -26)" fill="#fff" opacity=".9" ${soft(ink, 2.5)}/>
<ellipse cx="8" cy="-28" rx="14" ry="20" transform="rotate(20 8 -28)" fill="#fff" opacity=".9" ${soft(ink, 2.5)}/>
<path d="M-30 0 l-14 -4 l4 10 z" fill="${ink}"/>
<ellipse cx="0" cy="0" rx="32" ry="22" fill="#ffc93c" stroke="#fff" stroke-width="2.5"/>
<path d="M-8 -15 V15 M8 -15 V15" stroke="${ink}" stroke-width="7" stroke-linecap="round"/>
<circle cx="20" cy="-5" r="4" fill="${ink}"/></g>`;
};

/** A green recycling bin with chasing arrows. */
const recycleBin: Piece = () => {
  let arrows = '';
  for (let i = 0; i < 3; i++) {
    const a0 = (i * 2 * Math.PI) / 3 - Math.PI / 2 + 0.25, a1 = a0 + 1.55, R = 26, cx = 0, cy = 26;
    const x0 = cx + Math.cos(a0) * R, y0 = cy + Math.sin(a0) * R, x1 = cx + Math.cos(a1) * R, y1 = cy + Math.sin(a1) * R;
    const tx = -Math.sin(a1), ty = Math.cos(a1), nx = Math.cos(a1), ny = Math.sin(a1);
    arrows += `<path d="M${n(x0)} ${n(y0)} A${R} ${R} 0 0 1 ${n(x1)} ${n(y1)}" fill="none" stroke="#fff" stroke-width="8"/>
<path d="M${n(x1 + tx * 12)} ${n(y1 + ty * 12)} L${n(x1 + nx * 12)} ${n(y1 + ny * 12)} L${n(x1 - nx * 12)} ${n(y1 - ny * 12)} Z" fill="#fff"/>`;
  }
  return `<path d="M-60 -46 H60 L48 88 H-48 Z" fill="#43a047" ${OUTLINE}/>
<path d="M-24 -76 Q-24 -88 -12 -88 H12 Q24 -88 24 -76" fill="none" stroke="#2e7d32" stroke-width="9" stroke-linecap="round"/>
<rect x="-72" y="-74" width="144" height="28" rx="12" fill="#2e7d32" ${OUTLINE}/>${arrows}`;
};

/** A flower on a stem. */
const gardenFlower = stemFlower((r) => whole(r, 0, 3), (acc) => notGreen(acc));

/** A rain cloud. */
const rainCloud: Piece = (r) =>
  `<path d="M-84 20 a36 36 0 0 1 26 -56 a48 48 0 0 1 88 -18 a40 40 0 0 1 54 40 a28 28 0 0 1 -4 34 z" fill="#d6ebfb" ${OUTLINE}/>
<path d="M-48 -26 a30 30 0 0 1 30 -18" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round" opacity=".8"/>
${drop(-50, 56, 0.9)}${drop(-6, 72, 1)}${drop(40, 54, 0.9)}${r() < 0.5 ? drop(76, 74, 0.7) : drop(-80, 76, 0.7)}`;

const sunny: Piece = (r) => sun(0, 0, 50, pick(r, [GOLD, '#ffb703', '#ffd166']), r() < 0.6);

const bigLeaf: Piece = (r) => {
  const g = pick(r, GREENS);
  return `<g transform="rotate(${n(between(r, -10, 10))})"><path d="M-70 76 Q-90 -40 70 -84 Q94 40 -70 76 Z" fill="${g}" ${OUTLINE}/>
<path d="M-70 76 Q-10 0 50 -60 M-30 30 l-18 -36 M-8 8 l40 6 M14 -18 l-12 -36 M30 -38 l32 2" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" opacity=".7"/>
<path d="M-70 76 l-14 14" stroke="${STEM}" stroke-width="8" stroke-linecap="round"/></g>`;
};

/** A leaf hanging from its stem. */
const hungLeaf: Piece = (r, p) => `<g transform="translate(4 0) rotate(135)">${bigLeaf(r, p)}</g>`;

const earthDay: Kit = {
  hero: [globe, leafyGlobe, saplingHands, tree],
  small: [recycleBin, butterfly, bee, gardenFlower, rainCloud, sunny, bigLeaf, globe],
  hang: [hanging(globe, 0.62, -86), hanging(hungLeaf, 0.62, -100), hanging(butterfly, 0.62, -74)],
};

// ---------------------------------------------------------------------------------------------- Mother's Day

/** A mother hen with her chicks. */
const henChicks: Piece = (r) => {
  const body = pick(r, ['#f4a259', '#e9884a', '#d9864f']), wing = '#c96a32', dir = r() < 0.5 ? 1 : -1;
  const chick = (x: number, y: number, s: number, d: number) =>
    `<g transform="translate(${x} ${y}) scale(${d * s} ${s})"><ellipse cx="0" cy="0" rx="24" ry="21" fill="#ffd23f" ${OUTLINE}/>
<path d="M22 -4 l12 4 l-12 4 z" fill="#ff9f43"/><circle cx="10" cy="-6" r="3.5" fill="${FACE}"/><circle cx="8" cy="4" r="4" fill="${CHEEK}" opacity=".5"/>
<path d="M-8 -2 q-10 4 -6 12" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" opacity=".7"/><path d="M-6 20 v8 M6 20 v8" stroke="#ff9f43" stroke-width="4" stroke-linecap="round"/></g>`;
  const hen = `<path d="M-50 -4 L-92 -50 L-80 -6 L-96 -24 L-76 20 Z" fill="${wing}" ${OUTLINE}/>
<path d="M-74 0 Q-80 60 -10 66 Q60 66 60 10 Q60 -28 34 -38 L10 -10 Q-30 -30 -74 0 Z" fill="${body}" ${OUTLINE}/>
<circle cx="38" cy="-48" r="30" fill="${body}" ${OUTLINE}/>
<path d="M22 -74 q2 -18 14 -10 q6 -16 16 -4 q12 -6 10 10 z" fill="#e8382a" ${OUTLINE}/>
<path d="M66 -50 l22 8 l-22 8 z" fill="#ff9f43" ${OUTLINE}/><path d="M66 -32 q4 14 -6 16 q-6 -8 0 -16 z" fill="#e8382a"/>
<circle cx="46" cy="-54" r="5" fill="${FACE}"/><circle cx="40" cy="-40" r="7" fill="${CHEEK}" opacity=".5"/>
<path d="M-40 12 Q-6 -4 22 20 Q-6 50 -40 12 Z" fill="${wing}" opacity=".8"/>
<path d="M-12 64 v18 M10 64 v18" stroke="#ff9f43" stroke-width="6" stroke-linecap="round"/>`;
  return `<g transform="scale(${dir} 1) translate(4 -2) scale(.95)">${hen}${chick(-70, 68, 0.85, 1)}${chick(66, 68, 0.8, -1)}</g>` + heart(dir * 72, -82, 11, '#ff7aa8');
};

/** An elephant seen from the side, facing right; (x, y) is the ground under its middle. */
function elephant(x: number, y: number, s: number, c: string, ear: string, ink: string) {
  return `<g transform="translate(${n(x)} ${n(y)}) scale(${n(s * 100) / 100})">
<path d="M-56 -60 q-16 6 -14 24" fill="none" stroke="${c}" stroke-width="5" stroke-linecap="round"/>
<rect x="-50" y="-44" width="24" height="44" rx="10" fill="${c}" ${OUTLINE}/><rect x="16" y="-44" width="24" height="44" rx="10" fill="${c}" ${OUTLINE}/>
<ellipse cx="-6" cy="-60" rx="58" ry="40" fill="${c}" ${OUTLINE}/>
<rect x="-30" y="-40" width="22" height="40" rx="10" fill="${c}" ${OUTLINE}/><rect x="30" y="-40" width="22" height="40" rx="10" fill="${c}" ${OUTLINE}/>
<path d="M60 -70 Q92 -60 88 -24 Q86 -12 78 -16 Q80 -50 50 -50 Z" fill="${c}" ${OUTLINE}/>
<circle cx="50" cy="-80" r="32" fill="${c}" ${OUTLINE}/>
<ellipse cx="34" cy="-76" rx="20" ry="26" fill="${ear}" ${OUTLINE}/>
<circle cx="62" cy="-88" r="4.5" fill="${ink}"/><circle cx="62" cy="-74" r="6" fill="${CHEEK}" opacity=".5"/></g>`;
}

/** A big elephant and a little one, with a heart between them. */
const elephantPair: Piece = (r, p) => {
  const c = pick(r, ['#a7b4d6', '#b8b0d8', '#9fb7c9']);
  return `<g transform="scale(${r() < 0.5 ? 1 : -1} 1)"><ellipse cx="0" cy="88" rx="92" ry="7" fill="${p.ink}" opacity=".08"/>${elephant(-6, 72, 0.98, c, '#f4b6c2', p.ink)}${elephant(-40, 92, 0.5, '#c9d2ea', '#f9cdd6', p.ink)}
${heart(-6, -62, 20, '#ff7aa8')}${heart(30, -80, 10, '#ff9ec4')}</g>`;
};

/** A greeting card standing open, a heart on the front. */
const heartCard: Piece = (r, p) => {
  const cs = notGreen(p.acc), c = pick(r, cs), h = pick(r, ['#ff4f7b', '#ff7aa8', '#e8473c']);
  return `<path d="M-6 -70 L72 -84 L72 76 L-6 86 Z" fill="${c}" ${OUTLINE} opacity=".75"/>
<path d="M-6 -70 L-84 -84 L-84 76 L-6 86 Z" fill="#ffffff" ${soft(p.ink)}/>
${heart(-46, 0, 30, h)}
<path d="M-70 -64 h20 M-70 66 h50" stroke="${c}" stroke-width="6" stroke-linecap="round"/>
${sparkle(-20, -44, 9, GOLD)}${sparkle(-70, 40, 7, GOLD)}${heart(34, -10, 14, '#fff')}`;
};

/** A cup of tea on a saucer, steam rising. */
const teaCup: Piece = (r, p) => {
  const c = pick(r, notGreen(p.acc));
  return `<path d="M-14 -40 q-14 -16 0 -30 q14 -14 0 -30 M18 -40 q-14 -16 0 -30" fill="none" stroke="${p.ink}" stroke-width="6" stroke-linecap="round" opacity=".25"/>
<ellipse cx="-4" cy="70" rx="86" ry="19" fill="#ffffff" ${soft(p.ink)}/>
<path d="M54 -6 a26 24 0 1 1 -6 46" fill="none" stroke="#fff" stroke-width="22"/><path d="M54 -6 a26 24 0 1 1 -6 46" fill="none" stroke="${c}" stroke-width="12"/>
<path d="M-70 -26 H62 Q60 52 -4 64 Q-68 52 -70 -26 Z" fill="${c}" ${OUTLINE}/>
<ellipse cx="-4" cy="-26" rx="66" ry="10" fill="#c98b4a" ${OUTLINE}/>
${heart(-4, 18, 18, '#fff')}<path d="M-54 -8 q2 30 18 46" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round" opacity=".5"/>`;
};

/** A paper crown, made by hand, with gems and stickers. */
const crown: Piece = (r, p) => {
  const c = pick(r, [GOLD, '#ffd166', ...notGreen(p.acc).slice(0, 2)]), gems = notGreen(p.acc);
  let s = `<path d="M-88 56 L-88 -34 L-50 4 L-24 -64 L0 -6 L24 -64 L50 4 L88 -34 L88 56 Z" fill="${c}" ${OUTLINE}/>
<rect x="-90" y="34" width="180" height="26" rx="6" fill="#fff" opacity=".45"/>`;
  for (const [x, y] of [[-88, -38], [-24, -68], [24, -68], [88, -38]]) s += `<circle cx="${x}" cy="${y}" r="9" fill="${pick(r, gems)}" stroke="#fff" stroke-width="3"/>`;
  s += heart(0, 26, 18, '#ff4f7b') + star(-50, 34, 15, pick(r, gems)) + star(50, 34, 15, pick(r, gems));
  return `<g transform="translate(0 10)">${s}</g>`;
};

/** Flowers in a clay pot. */
const flowerPot: Piece = (r, p) => {
  const cs = notGreen(p.acc);
  let s = stem(0, 30, -42, -48, -10) + stem(0, 30, 0, -66, 0) + stem(0, 30, 42, -48, 10) + leaf(-4, 6, 40, GREENS[0], -150) + leaf(4, 2, 40, GREENS[1], -30);
  const kind = whole(r, 0, 4);
  s += bloom(kind, -46, -50, 0.56, pick(r, cs), pick(r, cs), r()) + bloom((kind + 2) % 5, 46, -50, 0.56, pick(r, cs), pick(r, cs), r()) + bloom(kind, 0, -66, 0.6, pick(r, cs), pick(r, cs), r());
  return s + `<path d="M-50 32 H50 L38 90 H-38 Z" fill="#d9774a" ${OUTLINE}/><rect x="-58" y="20" width="116" height="22" rx="7" fill="#c75b2a" ${OUTLINE}/>${heart(0, 62, 12, '#fff')}`;
};

const pinkRed = (acc: string[]) => ['#ff4f7b', '#ff7aa8', '#e8473c', ...notGreen(acc).slice(0, 1)];

const mothersDay: Kit = {
  hero: [henChicks, elephantPair, bouquetOf((acc) => notGreen(acc)), flowerPot],
  small: [bigHeart(pinkRed), heartCard, teaCup, crown, flowerPot, stemFlower(() => 1, notGreen), stemFlower(() => 4, pinkRed)],
  hang: [hanging(bigHeart(pinkRed), 0.62, -54), hanging(gardenFlower, 0.6, -86), hanging(bigStar(() => [GOLD]), 0.62, -80)],
};

// ---------------------------------------------------------------------------------------------- World Environment Day

/** A watering can, its spout to the right; (0, 0) is its middle. */
const can = (c: string) => `<path d="M-40 -42 Q0 -96 40 -42" fill="none" stroke="${c}" stroke-width="12" stroke-linecap="round"/>
<path d="M40 22 L104 -42 L114 -32 L54 36 Z" fill="${c}" ${OUTLINE}/>
<ellipse cx="112" cy="-46" rx="18" ry="10" transform="rotate(-45 112 -46)" fill="${c}" ${OUTLINE}/>
<path d="M-60 -24 Q-60 -44 -40 -44 H40 Q60 -44 60 -24 V38 Q60 56 40 56 H-40 Q-60 56 -60 38 Z" fill="${c}" ${OUTLINE}/>
<path d="M-60 -10 H60" stroke="#fff" stroke-width="7" opacity=".5"/><circle cx="-36" cy="24" r="9" fill="#fff" opacity=".45"/>`;

const wateringCan: Piece = (r, p) => `<g transform="translate(-14 6) rotate(30) scale(.72)">${can(pick(r, notGreen(p.acc)))}</g>` + drop(76, 46, 0.8) + drop(64, 78, 0.65);

/** A sapling in a pot. */
const potSapling: Piece = (r) => {
  const pot = pick(r, ['#d9774a', '#c75b2a', '#e0a96d']);
  return `${stem(0, 14, 0, -70, between(r, -10, 10), 9)}${leaf(0, -56, 62, GREENS[0], -30)}${leaf(0, -56, 62, GREENS[1], -150)}${leaf(0, -24, 44, GREENS[2], -20)}${leaf(0, -10, 40, GREENS[0], -165)}
<path d="M-56 22 H56 L42 92 H-42 Z" fill="${pot}" ${OUTLINE}/><rect x="-64" y="8" width="128" height="24" rx="8" fill="${pot}" ${OUTLINE}/>
<rect x="-50" y="12" width="40" height="8" rx="4" fill="#fff" opacity=".4"/>`;
};

/** Watering a sapling in its pot. */
const watering: Piece = (r, p) =>
  at(potSapling(r, p), -30, 22, 0.78) + `<g transform="translate(46 -40) rotate(-38) scale(-0.52 0.52)">${can(pick(r, notGreen(p.acc)))}</g>` +
  drop(-10, -30, 0.5) + drop(-22, -14, 0.45) + drop(0, -10, 0.4) + `<path d="M28 88 q4 -22 -4 -34 M34 88 q6 -20 18 -26" fill="none" stroke="${STEM}" stroke-width="6" stroke-linecap="round"/>${leaf(24, 56, 20, GREENS[0], -150)}${leaf(52, 62, 22, GREENS[2], -20)}`;

/** A small bird; (x, y) is its feet, dir 1 faces right. */
function bird(x: number, y: number, s: number, dir: number, c: string, ink: string) {
  const X = (dx: number) => n(x + dir * dx * s), Y = (dy: number) => n(y + dy * s);
  return `<path d="M${X(-30)} ${Y(-30)} l${n(-dir * 30 * s)} ${n(-14 * s)} l${n(dir * 6 * s)} ${n(26 * s)} z" fill="${c}" ${OUTLINE}/>
<ellipse cx="${X(0)}" cy="${Y(-34)}" rx="${n(38 * s)}" ry="${n(32 * s)}" fill="${c}" ${OUTLINE}/>
<path d="M${X(-18)} ${Y(-38)} q${n(dir * 20 * s)} ${n(-4 * s)} ${n(dir * 30 * s)} ${n(12 * s)} q${n(-dir * 18 * s)} ${n(10 * s)} ${n(-dir * 30 * s)} ${n(-12 * s)} z" fill="#fff" opacity=".5"/>
<path d="M${X(34)} ${Y(-46)} l${n(dir * 18 * s)} ${n(6 * s)} l${n(-dir * 18 * s)} ${n(6 * s)} z" fill="#ff9f43"/>
<circle cx="${X(18)}" cy="${Y(-48)}" r="${n(5 * s)}" fill="${ink}"/>
<path d="M${X(-6)} ${Y(-2)} v${n(10 * s)} M${X(8)} ${Y(-2)} v${n(10 * s)}" stroke="#ff9f43" stroke-width="5" stroke-linecap="round"/>`;
}

/** A bird on a leafy branch. */
const birdBranch: Piece = (r, p) => {
  const c = pick(r, notGreen(p.acc)), dir = r() < 0.5 ? 1 : -1;
  let s = `<path d="M-92 52 Q-10 18 92 34" fill="none" stroke="${BROWN}" stroke-width="12" stroke-linecap="round"/><path d="M40 30 q20 18 40 20" fill="none" stroke="${BROWN}" stroke-width="7" stroke-linecap="round"/>`;
  for (const [x, y, a] of [[-74, 46, 140], [-60, 40, -110], [-40, 36, 120], [52, 30, -60], [70, 34, 50], [82, 50, 20], [20, 26, 70]]) s += leaf(x, y, 34, pick(r, GREENS), a);
  return `<g transform="scale(${dir} 1)">${s}${bird(-2, 32, 1.45, 1, c, p.ink)}</g>`;
};

/** A cloth shopping bag with a leaf on it (no plastic). */
const clothBag: Piece = (r, p) => {
  const c = pick(r, ['#f1e3c6', '#e9d8b4', '#ffe8c2']);
  return `<path d="M-34 -20 Q-34 -86 0 -86 Q34 -86 34 -20" fill="none" stroke="#c9a874" stroke-width="10" stroke-linecap="round"/>
<path d="M-66 -24 H66 L76 88 H-76 Z" fill="${c}" ${soft(p.ink)}/>
<path d="M-66 -24 H66" stroke="#c9a874" stroke-width="6"/>
${leaf(-24, 50, 56, GREENS[1], -40)}${leaf(-24, 50, 42, GREENS[0], -100)}${heart(28, 20, 12, pick(r, notGreen(p.acc)))}`;
};

/** A bicycle. */
const bicycle: Piece = (r, p) => {
  const c = pick(r, notGreen(p.acc)), ink = '#3d4a5c';
  const wheel = (x: number) => `<circle cx="${x}" cy="30" r="38" fill="none" stroke="#fff" stroke-width="16"/><circle cx="${x}" cy="30" r="38" fill="none" stroke="${ink}" stroke-width="9"/>
<path d="M${x - 26} 30 H${x + 26} M${x} 4 V56" stroke="${ink}" stroke-width="3" opacity=".5"/><circle cx="${x}" cy="30" r="6" fill="${ink}"/>`;
  return `${wheel(-52)}${wheel(52)}
<path d="M-52 30 L-16 -24 L36 -24 L52 30 M-16 -24 L0 30 L36 -24 M-52 30 H0" fill="none" stroke="#fff" stroke-width="15" stroke-linejoin="round" stroke-linecap="round"/>
<path d="M-52 30 L-16 -24 L36 -24 L52 30 M-16 -24 L0 30 L36 -24 M-52 30 H0" fill="none" stroke="${c}" stroke-width="9" stroke-linejoin="round" stroke-linecap="round"/>
<path d="M-20 -32 L-16 -24 M32 -48 L36 -24" stroke="${ink}" stroke-width="7" stroke-linecap="round"/>
<path d="M-36 -38 H-6" stroke="${ink}" stroke-width="10" stroke-linecap="round"/><path d="M24 -50 H44" stroke="${ink}" stroke-width="7" stroke-linecap="round"/>
<circle cx="0" cy="30" r="8" fill="${c}" stroke="#fff" stroke-width="3"/>`;
};

/** The sun shining on a solar panel. */
const solarPanel: Piece = (r) => {
  let grid = '';
  for (let i = 1; i < 4; i++) grid += `<path d="M${n(-70 + i * 33)} -4 L${n(-86 + i * 37)} 60" stroke="#fff" stroke-width="3" opacity=".7"/>`;
  grid += `<path d="M-78 28 H78" stroke="#fff" stroke-width="3" opacity=".7"/>`;
  return `${sun(-48, -50, 28, pick(r, [GOLD, '#ffb703']), false)}
<path d="M-8 60 V84 M30 60 V84 M-40 88 H60" stroke="#8a96a8" stroke-width="8" stroke-linecap="round"/>
<path d="M-70 -4 L62 -4 L90 60 L-86 60 Z" fill="#2f5aa8" ${OUTLINE}/>${grid}
<path d="M-58 4 L-46 4 L-58 26 Z" fill="#fff" opacity=".35"/>`;
};

const bigDrop: Piece = () => drop(0, 6, 3.6) + `<path d="M-28 6 q-2 26 18 40" fill="none" stroke="#fff" stroke-width="9" stroke-linecap="round" opacity=".6"/>` + drop(66, -60, 0.8) + drop(-64, -48, 0.6);
const smallBird: Piece = (r, p) => {
  const dir = r() < 0.5 ? 1 : -1;
  return `<path d="M-84 58 Q0 44 84 56" fill="none" stroke="${BROWN}" stroke-width="10" stroke-linecap="round"/>${leaf(-60, 54, 36, GREENS[0], -130)}${leaf(56, 54, 36, GREENS[1], -40)}${leaf(70, 56, 30, GREENS[2], 30)}` +
    bird(dir * 8, 50, 1.55, dir, pick(r, notGreen(p.acc)), p.ink);
};

const environmentDay: Kit = {
  hero: [tree, watering, birdBranch, leafyGlobe],
  small: [potSapling, wateringCan, bigLeaf, clothBag, bicycle, solarPanel, bigDrop, butterfly, tree, smallBird],
  hang: [hanging(hungLeaf, 0.62, -100), hanging(bigDrop, 0.6, -72), hanging(butterfly, 0.62, -74)],
};

// ---------------------------------------------------------------------------------------------- Father's Day

/** A lion's face with its mane; (x, y) the middle, R the mane's radius. */
function lion(x: number, y: number, R: number, mane: string, ink: string) {
  let s = '';
  const tufts = 14;
  for (let i = 0; i < tufts; i++) {
    const a = (2 * Math.PI * i) / tufts;
    s += `<circle cx="${n(x + Math.cos(a) * R * 0.72)}" cy="${n(y + Math.sin(a) * R * 0.72)}" r="${n(R * 0.3)}" fill="${mane}" ${OUTLINE}/>`;
  }
  s += `<circle cx="${n(x)}" cy="${n(y)}" r="${n(R * 0.74)}" fill="${mane}"/>
<circle cx="${n(x - R * 0.42)}" cy="${n(y - R * 0.44)}" r="${n(R * 0.16)}" fill="#ffc94a" ${OUTLINE}/><circle cx="${n(x + R * 0.42)}" cy="${n(y - R * 0.44)}" r="${n(R * 0.16)}" fill="#ffc94a" ${OUTLINE}/>
<circle cx="${n(x)}" cy="${n(y + R * 0.04)}" r="${n(R * 0.56)}" fill="#ffc94a" ${OUTLINE}/>
<ellipse cx="${n(x)}" cy="${n(y + R * 0.26)}" rx="${n(R * 0.26)}" ry="${n(R * 0.18)}" fill="#ffe7a3"/>
<path d="M${n(x - R * 0.1)} ${n(y + R * 0.12)} h${n(R * 0.2)} l${n(-R * 0.1)} ${n(R * 0.1)} z" fill="${ink}" stroke="${ink}" stroke-width="3" stroke-linejoin="round"/>`;
  for (const side of [-1, 1])
    s += `<circle cx="${n(x + side * R * 0.18)}" cy="${n(y - R * 0.06)}" r="${n(R * 0.055)}" fill="${ink}"/><circle cx="${n(x + side * R * 0.34)}" cy="${n(y + R * 0.18)}" r="${n(R * 0.08)}" fill="${CHEEK}" opacity=".5"/>`;
  return s + `<path d="M${n(x - R * 0.14)} ${n(y + R * 0.3)} q${n(R * 0.07)} ${n(R * 0.08)} ${n(R * 0.14)} 0 q${n(R * 0.07)} ${n(R * 0.08)} ${n(R * 0.14)} 0" fill="none" stroke="${ink}" stroke-width="${n(Math.max(2.5, R * 0.04))}" stroke-linecap="round"/>`;
}

/** A father lion and his cub. */
const lionCub: Piece = (r, _p) => {
  const dir = r() < 0.5 ? 1 : -1;
  return `<g transform="scale(${dir} 1)">${lion(-20, -16, 72, '#e9884a', FACE)}${lion(56, 52, 38, '#f4a259', FACE)}</g>${heart(dir * 62, -64, 14, '#ff7aa8')}`;
};

/** A gold trophy cup, a star on the front. */
const trophy: Piece = (r, p) => {
  const base = pick(r, ['#5a6b8c', '#7a4a2a', p.ink]);
  return `<path d="M-48 -64 Q-94 -64 -84 -24 Q-74 4 -36 6" fill="none" stroke="#fff" stroke-width="20" stroke-linecap="round"/><path d="M48 -64 Q94 -64 84 -24 Q74 4 36 6" fill="none" stroke="#fff" stroke-width="20" stroke-linecap="round"/>
<path d="M-48 -64 Q-94 -64 -84 -24 Q-74 4 -36 6" fill="none" stroke="#f0a500" stroke-width="12" stroke-linecap="round"/><path d="M48 -64 Q94 -64 84 -24 Q74 4 36 6" fill="none" stroke="#f0a500" stroke-width="12" stroke-linecap="round"/>
<path d="M-60 -82 H60 Q60 22 0 30 Q-60 22 -60 -82 Z" fill="${GOLD}" ${OUTLINE}/>
<path d="M-14 28 H14 L18 54 H-18 Z" fill="#f0a500" ${OUTLINE}/>
<rect x="-50" y="54" width="100" height="36" rx="8" fill="${base}" ${OUTLINE}/><rect x="-28" y="64" width="56" height="16" rx="4" fill="${GOLD}"/>
${star(0, -30, 30, '#fff4c2')}<path d="M-42 -70 q-2 40 18 72" fill="none" stroke="#fff" stroke-width="8" stroke-linecap="round" opacity=".5"/>
${sparkle(-80, -84, 10, '#fff')}${sparkle(82, 20, 8, '#fff')}`;
};

/** A kite with its tail, tilted in the wind. */
const flyingKite: Piece = (r, p) => {
  const cs = notGreen(p.acc), c = pick(r, cs), c2 = pick(r, cs.filter((x) => x !== c)), t = pick(r, cs.filter((x) => x !== c));
  let bows = '';
  for (const [x, y] of [[-6, 56], [-2, 80]]) bows += `<path d="M${x} ${y} l-13 -8 v16 z M${x} ${y} l13 -8 v16 z" fill="${t}" stroke="#fff" stroke-width="3" stroke-linejoin="round"/>`;
  return `<path d="M-6 26 Q-40 60 -86 90" fill="none" stroke="${p.ink}" stroke-width="3" opacity=".4"/>
<g transform="rotate(${n(between(r, 8, 18))} 0 0)">
<path d="M0 36 Q-18 46 -6 56 Q8 68 -2 80 Q-10 88 -4 92" fill="none" stroke="${t}" stroke-width="5" stroke-linecap="round"/>${bows}
<path d="M0 -90 L64 -26 L0 36 Z" fill="${c}" ${OUTLINE}/><path d="M0 -90 L-64 -26 L0 36 Z" fill="${c2}" ${OUTLINE}/>
<path d="M0 -90 V36 M-64 -26 H64" stroke="#fff" stroke-width="5"/><circle cx="-26" cy="-48" r="7" fill="#fff" opacity=".5"/></g>`;
};

/** A tie with stripes. */
const tie: Piece = (r, p) => {
  const c = pick(r, notGreen(p.acc)), stripe = r() < 0.5;
  return `<path d="M-38 -90 H38 L22 -58 H-22 Z" fill="${c}" ${OUTLINE}/>
<path d="M-20 -58 H20 L40 60 L0 94 L-40 60 Z" fill="${c}" ${OUTLINE}/>
${stripe ? '<path d="M-26 -22 L28 -48 M-32 18 L34 -14 M-38 58 L38 22" stroke="#fff" stroke-width="7" opacity=".55" stroke-linecap="round"/>' : '<circle cx="-8" cy="-20" r="6" fill="#fff" opacity=".6"/><circle cx="12" cy="10" r="6" fill="#fff" opacity=".6"/><circle cx="-14" cy="40" r="6" fill="#fff" opacity=".6"/><circle cx="14" cy="64" r="6" fill="#fff" opacity=".6"/>'}`;
};

/** A mug of coffee with a heart, steam rising. */
const mug: Piece = (r, p) => {
  const c = pick(r, notGreen(p.acc));
  return `<path d="M-30 -58 q-14 -14 0 -26 M2 -58 q-14 -14 0 -26" fill="none" stroke="${p.ink}" stroke-width="6" stroke-linecap="round" opacity=".25"/>
<path d="M40 -26 h16 a26 26 0 0 1 0 52 h-16" fill="none" stroke="#fff" stroke-width="24"/><path d="M40 -26 h16 a26 26 0 0 1 0 52 h-16" fill="none" stroke="${c}" stroke-width="14"/>
<rect x="-70" y="-50" width="116" height="136" rx="18" fill="${c}" ${OUTLINE}/>
<ellipse cx="-12" cy="-44" rx="50" ry="7" fill="#7a4a2a"/>
${heart(-12, 18, 26, '#fff')}<path d="M-52 -24 v70" stroke="#fff" stroke-width="7" stroke-linecap="round" opacity=".45"/>`;
};

/** A spanner (wrench). */
const spanner: Piece = () => {
  const jaw = 'M78 -14 A22 22 0 1 0 78 14';
  const parts = (w: number, c: string) =>
    `<path d="M-54 0 H50" stroke="${c}" stroke-width="${22 + w}" stroke-linecap="round"/><circle cx="-62" cy="0" r="${17 + w / 2}" fill="none" stroke="${c}" stroke-width="${16 + w}"/><path d="${jaw}" fill="none" stroke="${c}" stroke-width="${20 + w}" stroke-linecap="round"/>`;
  return `<g transform="rotate(-38) scale(1.02)">${parts(10, '#fff')}${parts(0, '#8a96a8')}<path d="M-36 -4 H34" stroke="#fff" stroke-width="5" stroke-linecap="round" opacity=".5"/></g>`;
};

/** A toolbox with a screwdriver poking out. */
const toolbox: Piece = (r, p) => {
  const c = pick(r, ['#e8382a', '#ff6f3c', ...notGreen(p.acc).slice(0, 2)]);
  return `<path d="M-36 -24 V-58 H36 V-24" fill="none" stroke="#5a6b8c" stroke-width="12" stroke-linejoin="round"/>
<path d="M-48 -18 L-64 -76" stroke="#ffc93c" stroke-width="16" stroke-linecap="round"/><path d="M-60 -64 L-76 -88" stroke="#8a96a8" stroke-width="6" stroke-linecap="round"/>
<path d="M48 -18 L58 -70" stroke="#8a96a8" stroke-width="10" stroke-linecap="round"/><circle cx="60" cy="-76" r="12" fill="none" stroke="#8a96a8" stroke-width="8"/>
<rect x="-88" y="-28" width="176" height="114" rx="14" fill="${c}" ${OUTLINE}/>
<path d="M-88 6 H88" stroke="#fff" stroke-width="6" opacity=".6"/><rect x="-16" y="-2" width="32" height="18" rx="4" fill="#ffc93c" ${OUTLINE}/>
<rect x="-74" y="-18" width="40" height="10" rx="5" fill="#fff" opacity=".4"/>`;
};

/** A sporty cap. */
const cap: Piece = (r, p) => {
  const c = pick(r, notGreen(p.acc)), brim = pick(r, notGreen(p.acc).filter((x) => x !== c));
  return `<path d="M14 30 Q74 14 92 40 Q76 64 14 56 Z" fill="${brim}" ${OUTLINE}/>
<path d="M-82 44 Q-90 -60 -4 -62 Q74 -60 66 44 Z" fill="${c}" ${OUTLINE}/>
<path d="M-4 -62 Q-28 -10 -24 44 M-4 -62 Q30 -10 34 44" fill="none" stroke="#fff" stroke-width="4" opacity=".55"/>
<circle cx="-4" cy="-64" r="9" fill="${brim}" stroke="#fff" stroke-width="3"/>
<path d="M-82 44 H66" stroke="${brim}" stroke-width="10" stroke-linecap="round"/>
<path d="M-56 -20 q8 -18 24 -24" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round" opacity=".5"/>`;
};

/** A shirt with a collar, buttons and a pocket. */
const shirt: Piece = (r, p) => {
  const c = pick(r, notGreen(p.acc));
  return `<path d="M-30 -78 L-88 -50 L-70 -6 L-50 -16 L-50 86 H50 L50 -16 L70 -6 L88 -50 L30 -78 Q0 -60 -30 -78 Z" fill="${c}" ${OUTLINE}/>
<path d="M-30 -78 L-4 -40 L-20 -30 Z M30 -78 L4 -40 L20 -30 Z" fill="#fff" stroke="#fff" stroke-width="3" stroke-linejoin="round"/>
<path d="M0 -44 V86" stroke="#fff" stroke-width="4" opacity=".6"/>
<circle cx="0" cy="-18" r="4" fill="#fff"/><circle cx="0" cy="12" r="4" fill="#fff"/><circle cx="0" cy="42" r="4" fill="#fff"/><circle cx="0" cy="70" r="4" fill="#fff"/>
<rect x="18" y="-16" width="22" height="22" rx="4" fill="none" stroke="#fff" stroke-width="4" opacity=".7"/>`;
};

const fathersDay: Kit = {
  hero: [lionCub, elephantPair, trophy, flyingKite],
  small: [tie, mug, spanner, toolbox, cap, shirt, flyingKite, bigStar(() => [GOLD, '#ffd166'])],
  hang: [hanging(tie, 0.62, -88), hanging(bigStar(() => [GOLD, '#ffd166']), 0.62, -80), hanging(shirt, 0.6, -76)],
};

export const schoolKitsA: Record<string, Kit> = {
  'womens-day': womensDay,
  'health-day': healthDay,
  'earth-day': earthDay,
  'mothers-day': mothersDay,
  'environment-day': environmentDay,
  'fathers-day': fathersDay,
};
