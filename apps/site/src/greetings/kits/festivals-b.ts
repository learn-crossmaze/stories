// The card maker's symbols (src/greetings/maker.ts) for Diwali, Onam, Ganesh Chaturthi, Dussehra, Guru Nanak
// Jayanti and Christmas. Diwali is the worked example the other kits follow. Every piece is drawn in a
// 200 × 200 box centred on (0, 0), inside −95…95; hanging pieces start at the top of the box (y = −95).
import type { Kit, Piece } from '../maker';
import { burst, flower, gift, n, OUTLINE, sparkle, star } from '../motifs';
import { between, pick, whole } from '../palettes';
import type { Rng } from '../types';

// ---------------------------------------------------------------- shared colours and helpers

const MARIGOLD = ['#ff9f1c', '#ffc93c'];
const MARIGOLD_MID = '#e8750a';
const LEAF = ['#2fa84f', '#46b862'];
const LEAF_DARK = '#1f7a3a';
const BRASS = '#f2b134', BRASS_LIGHT = '#ffd36b', BRASS_DARK = '#d98e1a';
const STEEL = '#cfd6df', STEEL_LIGHT = '#eef2f6';
const CREAM = '#fff4c2';
const CLAY = '#c75b2a', CLAY_LIGHT = '#e07a3f', OIL = '#8a3b16';
const FLAME = '#ffb300';
const SAFFRON = '#ff9933';
const RED = '#e8382a';
const GOLD = '#ffc93c';

/** A soft ink outline for pale shapes (steel, cream sweets, snow) that would vanish on the pale card. */
const soft = (ink: string, w = 5) => `stroke="${ink}" stroke-opacity=".2" stroke-width="${w}" stroke-linejoin="round"`;

/** Moves and scales a drawing. */
const at = (svg: string, x: number, y: number, s = 1, rot = 0) =>
  `<g transform="translate(${n(x)} ${n(y)})${rot ? ` rotate(${n(rot)})` : ''}${s !== 1 ? ` scale(${n(s * 100) / 100})` : ''}">${svg}</g>`;

/** The string a hanging piece hangs from, from the top of the box down to `y`. */
const hook = (ink: string, y: number, x = 0) => `<line x1="${n(x)}" y1="-95" x2="${n(x)}" y2="${n(y)}" stroke="${ink}" stroke-width="4" stroke-linecap="round" opacity=".45"/>`;

/** A shuffled copy of a list. */
function shuffle<T>(r: Rng, list: readonly T[]) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Draws one of the hand-made card drawings (1080 × 680 units) as a piece: centred on (cx, cy) and scaled by
 * k, with its thin outlines thickened so they match the other pieces.
 */
const lift = (svg: string, cx: number, cy: number, k: number, flip = false) =>
  `<g transform="scale(${flip ? -k : k} ${k}) translate(${-cx} ${-cy})">${svg.replace(/stroke-width="([\d.]+)"/g, (m, w) => (Number(w) <= 6 ? `stroke-width="${n((Number(w) * 0.8) / k)}"` : m))}</g>`;

/** A round marigold. */
function bloom(x: number, y: number, R: number, colour = MARIGOLD[0]) {
  let s = `<circle cx="${n(x)}" cy="${n(y)}" r="${n(R)}" fill="${colour}" stroke="#fff" stroke-width="${R > 14 ? 4 : 3}"/>`;
  const other = colour === MARIGOLD[0] ? MARIGOLD[1] : MARIGOLD[0];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i;
    s += `<circle cx="${n(x + Math.cos(a) * R * 0.55)}" cy="${n(y + Math.sin(a) * R * 0.55)}" r="${n(R * 0.3)}" fill="${other}"/>`;
  }
  return s + `<circle cx="${n(x)}" cy="${n(y)}" r="${n(R * 0.3)}" fill="${MARIGOLD_MID}"/>`;
}

/** A mango leaf hanging down from (x, y), turned by `angle` degrees. */
const mangoLeaf = (x: number, y: number, len: number, fill: string, angle = 0) =>
  `<g transform="rotate(${n(angle)} ${n(x)} ${n(y)})"><path d="M${n(x)} ${n(y)} Q${n(x + len * 0.3)} ${n(y + len * 0.45)} ${n(x)} ${n(y + len)} Q${n(x - len * 0.3)} ${n(y + len * 0.45)} ${n(x)} ${n(y)} Z" fill="${fill}" stroke="#fff" stroke-width="3" stroke-linejoin="round"/><path d="M${n(x)} ${n(y + 4)} V${n(y + len * 0.85)}" stroke="#fff" stroke-width="2" opacity=".6"/></g>`;

/** A flame with its glow; (x, y) is its base, h its height. */
const flame = (x: number, y: number, h: number, glow = true) =>
  (glow ? `<circle cx="${n(x)}" cy="${n(y - h * 0.45)}" r="${n(h * 0.62)}" fill="#ffe08a" opacity=".45"/>` : '') +
  `<path d="M${n(x)} ${n(y - h)} q${n(h * 0.38)} ${n(h * 0.5)} 0 ${n(h)} q${n(-h * 0.38)} ${n(-h * 0.5)} 0 ${n(-h)} z" fill="${FLAME}"/>
<path d="M${n(x)} ${n(y - h * 0.72)} q${n(h * 0.17)} ${n(h * 0.28)} 0 ${n(h * 0.62)} q${n(-h * 0.17)} ${n(-h * 0.28)} 0 ${n(-h * 0.62)} z" fill="#fff4c2"/>`;

/** A clay diya with a band of dots and its flame: the rim's middle at (0, 0), x −82…82, y −86…52. */
function clayDiya(band: string[]) {
  let s = flame(0, -6, 80);
  s += `<path d="M-80 0 Q0 100 80 0 Z" fill="${CLAY}" ${OUTLINE}/>
<ellipse cx="0" cy="0" rx="80" ry="12" fill="${CLAY_LIGHT}" ${OUTLINE}/><ellipse cx="0" cy="1" rx="60" ry="6" fill="${OIL}"/>`;
  for (let i = 0; i < 7; i++) s += `<circle cx="${-48 + 16 * i}" cy="20" r="5.5" fill="${band[i % band.length]}"/>`;
  for (let i = 0; i < 4; i++) s += `<path d="M${-27 + 18 * i} 30 l9 10 l9 -10" fill="none" stroke="${CREAM}" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>`;
  return s;
}

/** A modak: a pleated teardrop sweet; (x, y) is the middle of its base, s its half-width. */
function modak(x: number, y: number, s: number, fill: string, ink: string) {
  let m = `<path d="M${n(x)} ${n(y - 1.55 * s)} C${n(x + 0.25 * s)} ${n(y - 1.15 * s)} ${n(x + s)} ${n(y - 0.85 * s)} ${n(x + s)} ${n(y - 0.35 * s)} Q${n(x + s)} ${n(y)} ${n(x)} ${n(y)} Q${n(x - s)} ${n(y)} ${n(x - s)} ${n(y - 0.35 * s)} C${n(x - s)} ${n(y - 0.85 * s)} ${n(x - 0.25 * s)} ${n(y - 1.15 * s)} ${n(x)} ${n(y - 1.55 * s)} Z" fill="${fill}" ${soft(ink, 4)}/>`;
  for (const k of [-2, -1, 0, 1, 2])
    m += `<path d="M${n(x)} ${n(y - 1.45 * s)} Q${n(x + k * 0.42 * s)} ${n(y - 0.75 * s)} ${n(x + k * 0.36 * s)} ${n(y - 0.1 * s)}" fill="none" stroke="#d9a35b" stroke-width="${n(Math.max(2.5, s * 0.08))}" stroke-linecap="round" opacity=".7"/>`;
  return m + `<ellipse cx="${n(x - s * 0.35)}" cy="${n(y - s * 0.6)}" rx="${n(s * 0.12)}" ry="${n(s * 0.22)}" fill="#fff" opacity=".7"/>`;
}
const MODAK = ['#fff6e3', '#ffd9a8'];

/** A brass plate on a little stand, seen from the front: its top at y, x −rx…rx, the stand down to y + 40. */
const brassPlate = (y: number, rx: number) =>
  `<path d="M-32 ${y + 40} h64 l-14 -34 h-36 z" fill="${BRASS_DARK}" ${OUTLINE}/>
<ellipse cx="0" cy="${y}" rx="${rx}" ry="${n(rx * 0.22)}" fill="${BRASS}" ${OUTLINE}/>
<ellipse cx="0" cy="${y - 3}" rx="${n(rx * 0.82)}" ry="${n(rx * 0.14)}" fill="${BRASS_LIGHT}"/>`;

/** A string of marigolds hanging from the top, ending in a mango leaf or a tassel. */
const marigoldStrand: Piece = (r, p) => {
  const count = whole(r, 5, 6), step = 132 / count, start = MARIGOLD[whole(r, 0, 1)];
  let s = hook(p.ink, -80) + `<line x1="0" y1="-80" x2="0" y2="${n(-80 + step * count)}" stroke="#2f8f46" stroke-width="5"/>`;
  const end = -80 + step * count;
  s += r() < 0.5
    ? mangoLeaf(-4, end - 6, 48, LEAF[0], 22) + mangoLeaf(4, end - 6, 48, LEAF[1], -22)
    : `<path d="M-8 ${n(end)} v38 M0 ${n(end)} v44 M8 ${n(end)} v38" stroke="${pick(r, p.acc)}" stroke-width="5" stroke-linecap="round"/><circle cx="0" cy="${n(end)}" r="9" fill="${RED}" ${OUTLINE}/>`;
  for (let i = 0; i < count; i++) s += bloom(0, -80 + step * i + step / 2, step * 0.62, i % 2 ? (start === MARIGOLD[0] ? MARIGOLD[1] : MARIGOLD[0]) : start);
  return s;
};

/** A short toran: a marigold string with mango leaves, and marigold drops at the ends and the middle. */
const toranBit: Piece = (r, p) => {
  let s = `<line x1="-80" y1="-95" x2="-80" y2="-78" stroke="${p.ink}" stroke-width="4" opacity=".45"/><line x1="80" y1="-95" x2="80" y2="-78" stroke="${p.ink}" stroke-width="4" opacity=".45"/>`;
  for (let i = 0; i < 6; i++) {
    const x = -66.7 + 26.7 * i;
    s += mangoLeaf(x, -76, between(r, 50, 62), LEAF[i % 2], between(r, -8, 8));
  }
  for (const x of [-80, 0, 80]) {
    const drop = x === 0 ? 5 : 3;
    for (let k = 1; k <= drop; k++) s += bloom(x, -78 + k * 26, 12, MARIGOLD[k % 2]);
  }
  for (let i = 0; i <= 8; i++) s += bloom(-80 + 20 * i, -78, 12, MARIGOLD[i % 2]);
  return s;
};

/** A temple bell on a chain. */
const bell: Piece = (r, p) => {
  const band = pick(r, p.acc);
  let s = '';
  for (let y = -92; y < -58; y += 10) s += `<ellipse cx="0" cy="${y}" rx="4" ry="6" fill="none" stroke="${BRASS_DARK}" stroke-width="3"/>`;
  s += `<circle cx="0" cy="${n(64)}" r="13" fill="${BRASS_DARK}" ${OUTLINE}/>
<path d="M-14 -56 Q-16 -60 0 -62 Q16 -60 14 -56 Q46 -44 50 0 Q52 34 70 52 H-70 Q-52 34 -50 0 Q-46 -44 -14 -56 Z" fill="${BRASS}" ${OUTLINE}/>
<path d="M-50 4 Q0 -8 50 4" fill="none" stroke="${band}" stroke-width="8"/>
<path d="M-56 34 Q0 22 56 34" fill="none" stroke="${BRASS_DARK}" stroke-width="5"/>
<rect x="-74" y="48" width="148" height="12" rx="6" fill="${BRASS_DARK}" ${OUTLINE}/>
<path d="M-26 -36 Q-34 -6 -30 22" fill="none" stroke="${BRASS_LIGHT}" stroke-width="8" stroke-linecap="round"/>`;
  for (const x of [-30, -15, 0, 15, 30]) s += `<circle cx="${x}" cy="-14" r="3.5" fill="${CREAM}"/>`;
  return s;
};

// ---------------------------------------------------------------- Diwali

/** A big clay diya with its flame. */
const bigDiya: Piece = (r, p) => at(clayDiya(shuffle(r, p.acc)), 0, 17, 1.05);

/** Three diyas on a brass plate, with marigold petals. */
const diyaCluster: Piece = (r, p) => {
  const band = shuffle(r, p.acc);
  let s = brassPlate(62, 92);
  s += at(clayDiya(band), 0, -4, 0.7);
  s += at(clayDiya([band[1], band[2]]), -48, 26, 0.54) + at(clayDiya([band[3], band[0]]), 48, 26, 0.54);
  for (let i = 0; i < 5; i++) s += `<circle cx="${n(-60 + 30 * i + between(r, -6, 6))}" cy="${n(66 + between(r, -3, 3))}" r="5" fill="${MARIGOLD[i % 2]}"/>`;
  return at(s, 0, -10);
};

/** A round rangoli of petals and dots. */
const rangoli: Piece = (r, p) => {
  const petals = 8 + 2 * whole(r, 0, 2), rot = r() * Math.PI;
  let s = flower(0, 0, petals, 78, 30, p.acc, GOLD, rot, 26);
  s += flower(0, 0, petals, 54, 22, [...p.acc.slice(2), ...p.acc.slice(0, 2)], GOLD, rot + Math.PI / petals, 22);
  for (let i = 0; i < 16; i++) {
    const a = rot + (2 * Math.PI * (i + 0.5)) / 16;
    s += `<circle cx="${n(Math.cos(a) * 87)}" cy="${n(Math.sin(a) * 87)}" r="${i % 2 ? 4 : 6.5}" fill="${pick(r, p.acc)}"/>`;
  }
  return s;
};

/** A rangoli with a lit diya in the middle. */
const rangoliDiya: Piece = (r, p) => {
  const cols = shuffle(r, p.acc), rot = r() * Math.PI, petals = pick(r, [12, 16]);
  let s = '';
  for (let i = 0; i < 24; i++) {
    const a = rot + (2 * Math.PI * i) / 24;
    s += `<circle cx="${n(Math.cos(a) * 86)}" cy="${n(Math.sin(a) * 86)}" r="${i % 2 ? 4 : 7}" fill="${i % 2 ? GOLD : cols[0]}"/>`;
  }
  s += flower(0, 0, petals, 76, 26, [cols[1], cols[2]], CREAM, rot, 40);
  s += flower(0, 0, petals / 2, 56, 30, [cols[3], cols[4]], CREAM, rot + Math.PI / petals, 40);
  s += `<circle cx="0" cy="0" r="40" fill="${CREAM}" ${OUTLINE}/>`;
  return s + at(clayDiya([cols[0], GOLD]), 0, 14, 0.4);
};

/** A star-shaped sky lantern (aakash kandil) with streamers, hanging from the top. */
const starKandil = (hang: boolean): Piece => (r, p) => {
  const [c, c2] = shuffle(r, p.acc);
  const tail = (x: number, side: number) =>
    `<path d="M${x} 36 q${side * 8} 22 ${side * -2} 50" fill="none" stroke="#fff" stroke-width="12" stroke-linecap="round"/><path d="M${x} 36 q${side * 8} 22 ${side * -2} 50" fill="none" stroke="${c2}" stroke-width="6" stroke-linecap="round"/>`;
  let s = (hang ? hook(p.ink, -70) : '') + tail(-34, -1) + tail(34, 1) + tail(-18, -1) + tail(18, 1);
  s += `<circle cx="0" cy="-8" r="52" fill="#ffe08a" opacity=".4"/>`;
  s += star(0, -8, 64, c) + star(0, -8, 38, CREAM) + star(0, -8, 20, c2);
  s += `<circle cx="0" cy="-8" r="5" fill="#fff"/>`;
  return s;
};

/** A diamond sky lantern (akash kandil) with tassels. */
const kandil = (hang: boolean): Piece => (r, p) => {
  const c = pick(r, p.acc);
  return `${hang ? hook(p.ink, -62) : ''}
<path d="M0 -64 L52 -10 L0 44 L-52 -10 Z" fill="${c}" ${OUTLINE}/>
<path d="M-52 -10 H52 M0 -64 V44" stroke="#fff4c2" stroke-width="5"/>
<path d="M-26 44 L0 70 L26 44" fill="${GOLD}" ${OUTLINE}/>
<path d="M-12 70 v24 M0 72 v22 M12 70 v24" stroke="${c}" stroke-width="5" stroke-linecap="round"/>`;
};

/** A sparkler (phuljhadi) fizzing with sparks. */
const phuljhadi: Piece = (r) => {
  const tx = 22, ty = -24;
  let s = `<line x1="-62" y1="90" x2="${tx}" y2="${ty}" stroke="#fff" stroke-width="10" stroke-linecap="round"/><line x1="-62" y1="90" x2="${tx}" y2="${ty}" stroke="#8d8f99" stroke-width="5" stroke-linecap="round"/>
<line x1="-62" y1="90" x2="-38" y2="57" stroke="#8d5a3b" stroke-width="9" stroke-linecap="round"/>`;
  s += `<circle cx="${tx}" cy="${ty}" r="40" fill="#ffe08a" opacity=".45"/>`;
  const rays = whole(r, 16, 20);
  for (let i = 0; i < rays; i++) {
    const a = (2 * Math.PI * i) / rays + between(r, -0.1, 0.1), len = between(r, 36, 62);
    const c = pick(r, ['#ffb300', '#ffd23f', '#ff7a1c']);
    s += `<line x1="${n(tx + Math.cos(a) * 12)}" y1="${n(ty + Math.sin(a) * 12)}" x2="${n(tx + Math.cos(a) * len)}" y2="${n(ty + Math.sin(a) * len)}" stroke="${c}" stroke-width="4" stroke-linecap="round"/>`;
    if (i % 3 === 0) s += sparkle(tx + Math.cos(a) * (len + 8), ty + Math.sin(a) * (len + 8), 7, c);
  }
  return s + `<circle cx="${tx}" cy="${ty}" r="11" fill="#fff4c2"/>`;
};

/** A firework burst. */
const firework: Piece = (r, p) => burst(0, 0, between(r, 62, 76), pick(r, p.acc), whole(r, 10, 14)) + sparkle(0, 0, 18, '#fff');

/** A brass plate of laddoos and diamond barfis. */
const sweets: Piece = (r, p) => {
  let s = brassPlate(40, 90);
  for (const x of [-72, 72]) s += `<path d="M${x} -2 l16 18 l-16 18 l-16 -18 z" fill="#f4f1ea" ${soft(p.ink, 3)}/><path d="M${x - 8} 8 l8 -8" stroke="#c9ccd6" stroke-width="3" stroke-linecap="round"/>`;
  for (const [x, y] of [[-44, 24], [0, 26], [44, 24], [-22, -10], [22, -10], [0, -44]]) {
    s += `<circle cx="${x}" cy="${y}" r="24" fill="#ffa62b" ${OUTLINE}/><circle cx="${x - 8}" cy="${y - 8}" r="5" fill="#fff4c2"/>`;
    for (let k = 0; k < 3; k++) s += `<circle cx="${n(x + between(r, -12, 12))}" cy="${n(y + between(r, -4, 14))}" r="2" fill="#e07a12"/>`;
  }
  return s;
};

/** A marigold flower. */
const marigold: Piece = () => flower(0, 0, 14, 90, 34, ['#ff9f1c', '#ffbf47'], '#e8590c', 0, 26);

const diwaliKit: Kit = {
  hero: [bigDiya, diyaCluster, rangoliDiya, starKandil(false)],
  small: [bigDiya, kandil(false), starKandil(false), phuljhadi, firework, marigold, rangoli, sweets],
  hang: [kandil(true), starKandil(true), marigoldStrand, toranBit],
};

// ---------------------------------------------------------------- Onam

/** A ring segment between radii R1 < R2, from angle a0 to a1. */
function wedge(R1: number, R2: number, a0: number, a1: number, fill: string, stroke = 3) {
  const pt = (R: number, a: number) => `${n(Math.cos(a) * R)} ${n(Math.sin(a) * R)}`;
  return `<path d="M${pt(R2, a0)} A${R2} ${R2} 0 0 1 ${pt(R2, a1)} L${pt(R1, a1)} A${R1} ${R1} 0 0 0 ${pt(R1, a0)} Z" fill="${fill}" stroke="#fff" stroke-width="${stroke}" stroke-linejoin="round"/>`;
}

/** A pookalam: a round carpet of flower petals in rings of many colours. */
const pookalam: Piece = (r, p) => {
  const cols = shuffle(r, p.acc), rot = r() * Math.PI;
  let s = '';
  const scallops = 30;
  for (let i = 0; i < scallops; i++) {
    const a = rot + (2 * Math.PI * i) / scallops;
    s += `<circle cx="${n(Math.cos(a) * 83)}" cy="${n(Math.sin(a) * 83)}" r="9" fill="${i % 2 ? MARIGOLD[0] : cols[0]}" stroke="#fff" stroke-width="3"/>`;
  }
  s += `<circle cx="0" cy="0" r="81" fill="${LEAF[0]}" ${OUTLINE}/>`;
  for (let i = 0; i < 36; i++) {
    const a = rot + (2 * Math.PI * i) / 36;
    s += `<circle cx="${n(Math.cos(a) * 72)}" cy="${n(Math.sin(a) * 72)}" r="4.5" fill="${i % 2 ? CREAM : MARIGOLD[1]}"/>`;
  }
  const K = pick(r, [8, 12, 16]);
  const ring = [MARIGOLD[1], RED, cols[1], MARIGOLD[0]].slice(0, K === 12 ? 3 : 2 + whole(r, 0, 2));
  for (let i = 0; i < K; i++) s += wedge(44, 64, rot + (2 * Math.PI * i) / K, rot + (2 * Math.PI * (i + 1)) / K, ring[i % ring.length]);
  s += `<circle cx="0" cy="0" r="44" fill="${CREAM}" ${OUTLINE}/>`;
  const petals = K >= 12 ? K : K * 2;
  s += flower(0, 0, petals, 44, 15, [cols[2], cols[3]], MARIGOLD[1], rot + Math.PI / petals, 14);
  s += flower(0, 0, 8, 24, 11, [RED, MARIGOLD[0]], MARIGOLD[1], rot, 8);
  return s + `<circle cx="0" cy="0" r="3.5" fill="${p.head[1]}"/>`;
};

/** A small, simpler pookalam for scatters. */
const pookalamSmall: Piece = (r, p) => {
  const cols = shuffle(r, p.acc), rot = r() * Math.PI;
  let s = '';
  for (let i = 0; i < 8; i++) s += wedge(56, 86, rot + (Math.PI * i) / 4, rot + (Math.PI * (i + 1)) / 4, i % 2 ? MARIGOLD[0] : RED, 4);
  s += `<circle cx="0" cy="0" r="56" fill="${MARIGOLD[1]}" ${OUTLINE}/>`;
  s += flower(0, 0, 12, 54, 20, [cols[0], cols[1]], CREAM, rot, 18);
  return s + `<circle cx="0" cy="0" r="7" fill="${LEAF[0]}"/>`;
};

/** A snake boat (chundan vallam) with oars and a festive umbrella, on the water. */
const snakeBoat: Piece = (r, p) => {
  const cols = shuffle(r, p.acc), oars = whole(r, 7, 9), lean = between(r, 10, 16);
  let s = '';
  // Oars dipping into the water.
  for (let i = 0; i < oars; i++) {
    const x = -70 + (120 / (oars - 1)) * i;
    s += `<line x1="${n(x)}" y1="0" x2="${n(x - lean)}" y2="44" stroke="#8d6e63" stroke-width="3.5" stroke-linecap="round"/><ellipse cx="${n(x - lean - 1)}" cy="47" rx="4" ry="8" fill="${cols[(i % 2) + 2]}" stroke="#fff" stroke-width="2" transform="rotate(${n(lean * 1.6)} ${n(x - lean - 1)} 47)"/>`;
  }
  // Festive umbrellas (muthukuda) on deck.
  for (const [ux, c] of [[between(r, -58, -48), cols[0]], [between(r, 4, 14), cols[1]]] as const) {
    const top = -50;
    s += `<line x1="${n(ux)}" y1="12" x2="${n(ux)}" y2="${top}" stroke="#8d6e63" stroke-width="4"/>
<path d="M${n(ux - 30)} ${top + 6} Q${n(ux - 28)} ${top - 26} ${n(ux)} ${top - 28} Q${n(ux + 28)} ${top - 26} ${n(ux + 30)} ${top + 6} Z" fill="${GOLD}" stroke="#fff" stroke-width="3.5" stroke-linejoin="round"/>
<path d="M${n(ux - 21)} ${top - 6} Q${n(ux)} ${top - 19} ${n(ux + 21)} ${top - 6}" fill="none" stroke="${c}" stroke-width="5" stroke-linecap="round"/>
<circle cx="${n(ux)}" cy="${top - 32}" r="5" fill="${c}" stroke="#fff" stroke-width="2.5"/>`;
    for (let k = 0; k < 7; k++) s += `<circle cx="${n(ux - 27 + 9 * k)}" cy="${top + 10}" r="4" fill="${c}" stroke="#fff" stroke-width="1.5"/>`;
  }
  // The hull: low at the bow, the stern sweeping up high like a snake's hood.
  s += `<path d="M-92 4 L52 4 Q72 0 78 -38 Q82 -62 92 -76 Q94 -48 90 -22 Q84 26 50 30 L-66 30 Q-86 26 -92 4 Z" fill="#6d4c41" ${OUTLINE}/>
<path d="M-80 14 L54 14 Q76 8 84 -30" fill="none" stroke="${GOLD}" stroke-width="5" stroke-linecap="round"/>
<circle cx="92" cy="-76" r="6" fill="${GOLD}" stroke="#fff" stroke-width="3"/>`;
  for (let i = 0; i < 6; i++) s += `<circle cx="${-66 + 22 * i}" cy="22" r="3" fill="${CREAM}"/>`;
  // Water.
  const wave = (y: number, c2: string) => `<path d="M-94 ${y} q11 -7 23.5 0 t23.5 0 t23.5 0 t23.5 0 t23.5 0 t23.5 0 t23.5 0 t23.5 0" fill="none" stroke="${c2}" stroke-width="6" stroke-linecap="round"/>`;
  s += wave(56, '#5ec3ea') + wave(72, '#8fd3f0');
  return at(s, 0, 4);
};

/** A nilavilakku: Kerala's tall brass lamp, with five flames. */
const nilavilakku: Piece = (r, p) => {
  let s = `<path d="M0 -95 q8 12 0 22 q-8 -10 0 -22 z" fill="${BRASS_DARK}"/><path d="M-7 -74 h14 l10 40 h-34 z" fill="${BRASS}" ${OUTLINE}/>
<ellipse cx="0" cy="-58" rx="13" ry="5" fill="${BRASS_DARK}"/>`;
  for (const [x, h] of [[-56, 26], [-28, 32], [28, 32], [56, 26]]) s += flame(x, -34, h, false);
  s += `<circle cx="0" cy="-50" r="44" fill="#ffe08a" opacity=".35"/>`;
  s += `<path d="M-74 -34 Q0 -42 74 -34 Q62 -6 0 -4 Q-62 -6 -74 -34 Z" fill="${BRASS}" ${OUTLINE}/>
<ellipse cx="0" cy="-34" rx="74" ry="9" fill="${BRASS_LIGHT}" ${OUTLINE}/>
<path d="M-56 -22 Q0 -12 56 -22" fill="none" stroke="${BRASS_DARK}" stroke-width="4" stroke-dasharray="2 8" stroke-linecap="round"/>
<rect x="-10" y="-6" width="20" height="70" fill="${BRASS}" ${OUTLINE}/>`;
  for (const [y, rx] of [[2, 20], [26, 15], [50, 18]]) s += `<ellipse cx="0" cy="${y}" rx="${rx}" ry="8" fill="${BRASS_DARK}" ${OUTLINE}/>`;
  s += `<path d="M-30 60 Q0 52 30 60 L56 80 H-56 Z" fill="${BRASS}" ${OUTLINE}/>
<rect x="-74" y="78" width="148" height="14" rx="6" fill="${BRASS_DARK}" ${OUTLINE}/>
<path d="M-4 -2 V58" stroke="${BRASS_LIGHT}" stroke-width="4" opacity=".8"/>`;
  // A few flowers at its foot.
  const c = pick(r, p.acc);
  s += bloom(-80, 70, 11, MARIGOLD[0]) + bloom(80, 70, 11, MARIGOLD[1]) + `<circle cx="-62" cy="66" r="5" fill="${c}"/><circle cx="62" cy="66" r="5" fill="${c}"/>`;
  return s;
};

/** A palm-leaf umbrella (olakkuda), the kind Mahabali carries, with a gold border and tassels. */
const olakkuda: Piece = (r, p) => {
  const c = pick(r, p.acc), palm = '#e3b768', rib = '#b98a3e';
  let s = `<path d="M0 6 V80 q0 12 -12 12 q-10 0 -12 -10" fill="none" stroke="#fff" stroke-width="11" stroke-linecap="round"/><path d="M0 6 V80 q0 12 -12 12 q-10 0 -12 -10" fill="none" stroke="#8d5a3b" stroke-width="6" stroke-linecap="round"/>`;
  for (let i = 0; i < 9; i++) {
    const x = -80 + 20 * i;
    s += `<path d="M${x} 16 v16" stroke="${c}" stroke-width="4" stroke-linecap="round"/><circle cx="${x}" cy="35" r="4.5" fill="${GOLD}"/>`;
  }
  s += `<path d="M-92 18 Q-90 -66 0 -72 Q90 -66 92 18 Q46 4 0 6 Q-46 4 -92 18 Z" fill="${palm}" ${OUTLINE}/>`;
  for (let i = 1; i < 10; i++) {
    const t = i / 10, x = -92 + 184 * t, y = 18 - 4 * 14 * t * (1 - t) * 0.98;
    s += `<path d="M0 -70 Q${n(x * 0.55)} ${n(-50 + 40 * Math.abs(t - 0.5))} ${n(x)} ${n(y)}" fill="none" stroke="${rib}" stroke-width="2.5" opacity=".75"/>`;
  }
  s += `<path d="M-86 4 Q0 -14 86 4" fill="none" stroke="${c}" stroke-width="7"/><path d="M-80 -12 Q0 -30 80 -12" fill="none" stroke="${GOLD}" stroke-width="4" stroke-dasharray="3 7" stroke-linecap="round"/>
<circle cx="0" cy="-78" r="9" fill="${GOLD}" ${OUTLINE}/>`;
  return s;
};

/** A sadya: an Onam feast on a banana leaf, seen from above. */
const sadya: Piece = (r, p) => {
  let s = `<path d="M-94 14 Q-86 -46 0 -44 Q66 -42 94 -8 Q74 40 0 46 Q-80 52 -94 14 Z" fill="${LEAF[1]}" ${OUTLINE}/>
<path d="M-90 -2 Q-70 -40 0 -40 Q60 -38 90 -10" fill="none" stroke="${LEAF_DARK}" stroke-width="5" stroke-linecap="round" opacity=".6"/>`;
  for (let i = 0; i < 7; i++) s += `<path d="M${-70 + 24 * i} -36 q8 30 2 70" fill="none" stroke="#fff" stroke-width="2" opacity=".4"/>`;
  // A row of little side dishes.
  const dishes = shuffle(r, ['#d7342a', '#f2c230', '#7cc045', '#f28c28', '#fff1d6', '#a0522d']);
  for (let i = 0; i < 5; i++) s += `<ellipse cx="${-30 + 22 * i}" cy="-24" rx="10" ry="7" fill="${dishes[i]}" stroke="#fff" stroke-width="2.5"/>`;
  // Papadam, a banana and a heap of rice.
  s += `<circle cx="-58" cy="-10" r="20" fill="#f7e2a1" stroke="#fff" stroke-width="3"/>`;
  for (let k = 0; k < 5; k++) s += `<circle cx="${n(-58 + between(r, -11, 11))}" cy="${n(-10 + between(r, -11, 11))}" r="2.5" fill="#e3c06c"/>`;
  s += `<path d="M-80 24 Q-56 40 -30 22 Q-54 30 -78 18 Z" fill="#ffd23f" stroke="#fff" stroke-width="3" stroke-linejoin="round"/><circle cx="-80" cy="21" r="3" fill="#8d6e63"/>`;
  s += `<ellipse cx="18" cy="14" rx="36" ry="19" fill="#fffaf0" ${soft(p.ink, 3)}/><ellipse cx="14" cy="8" rx="20" ry="8" fill="#fff"/>`;
  s += `<path d="M52 18 q12 -14 26 -2 q-10 12 -26 2 z" fill="#f28c28" stroke="#fff" stroke-width="2.5"/>`;
  for (let k = 0; k < 6; k++) s += `<circle cx="${n(18 + between(r, -24, 24))}" cy="${n(16 + between(r, -8, 8))}" r="1.8" fill="#e8dcc0"/>`;
  return `<g transform="scale(1 1.3)">${s}</g>`;
};

/** A coconut palm with coconuts. */
const coconutTree: Piece = (r) => {
  const lean = between(r, -8, 8);
  let s = `<path d="M-6 92 Q${n(-16 + lean)} 30 ${n(4 + lean)} -26" fill="none" stroke="#fff" stroke-width="22" stroke-linecap="round"/><path d="M-6 92 Q${n(-16 + lean)} 30 ${n(4 + lean)} -26" fill="none" stroke="#a1724e" stroke-width="15" stroke-linecap="round"/>`;
  for (let i = 0; i < 5; i++) {
    const t = 0.1 + i * 0.17, y = 92 - 118 * t, x = (1 - t) * (1 - t) * -6 + 2 * (1 - t) * t * (-16 + lean) + t * t * (4 + lean);
    s += `<path d="M${n(x - 7)} ${n(y)} q7 4 14 0" fill="none" stroke="#7d5538" stroke-width="3" stroke-linecap="round"/>`;
  }
  const tx = 4 + lean, ty = -30;
  const frond = (ang: number, len: number, fill: string) => {
    const a = (ang * Math.PI) / 180, ex = tx + Math.cos(a) * len, ey = ty + Math.sin(a) * len + len * 0.35;
    const side = Math.cos(a) >= 0 ? 1 : -1;
    const mx = tx + Math.cos(a) * len * 0.55, my = ty + Math.sin(a) * len * 0.55 - 26;
    return `<path d="M${n(tx)} ${n(ty)} Q${n(mx - side * 4)} ${n(my - 14)} ${n(ex)} ${n(ey)} Q${n(mx + side * 6)} ${n(my + 16)} ${n(tx)} ${n(ty)} Z" fill="${fill}" stroke="#fff" stroke-width="3.5" stroke-linejoin="round"/>
<path d="M${n(tx)} ${n(ty)} Q${n(mx)} ${n(my - 4)} ${n(ex)} ${n(ey)}" fill="none" stroke="#fff" stroke-width="2" opacity=".6"/>`;
  };
  for (const [ang, len, k] of [[-165, 92, 0], [-15, 92, 1], [-130, 74, 1], [-50, 74, 0], [-95, 58, 1], [160, 70, 1], [20, 70, 0]] as const) s += frond(ang, len, LEAF[k]);
  for (const [dx, dy] of [[-8, 8], [8, 8], [0, 18]]) s += `<circle cx="${n(tx + dx)}" cy="${n(ty + dy)}" r="9" fill="#7d5538" stroke="#fff" stroke-width="3"/>`;
  return s;
};

/** A bunch of bananas with its flower, hanging. */
const bananas = (hang: boolean): Piece => (r, p) => {
  const ripe = r() < 0.6 ? '#ffd23f' : '#c9d93a';
  let s = hang ? hook(p.ink, -80) : '';
  s += `<line x1="0" y1="-82" x2="0" y2="62" stroke="#7d6a3a" stroke-width="8" stroke-linecap="round"/>`;
  for (const [y, count, w] of [[-50, 4, 44], [-12, 5, 56], [26, 4, 44]] as const) {
    for (let i = 0; i < count; i++) {
      const t = i / (count - 1) - 0.5, ex = t * w * 2.2, ey = y - 22 + Math.abs(t) * 16;
      const d = `M${n(t * 8)} ${y + 10} Q${n(ex * 0.9)} ${y + 12} ${n(ex)} ${n(ey)}`;
      s += `<path d="${d}" fill="none" stroke="#fff" stroke-width="20" stroke-linecap="round"/><path d="${d}" fill="none" stroke="${ripe}" stroke-width="13" stroke-linecap="round"/><circle cx="${n(ex)}" cy="${n(ey)}" r="2.5" fill="#6d5a2a"/>`;
    }
  }
  s += `<path d="M0 54 Q22 70 0 94 Q-22 70 0 54 Z" fill="#8e3b5a" ${OUTLINE}/><path d="M-6 66 q6 4 12 0" stroke="#c4627f" stroke-width="3" fill="none"/>`;
  return hang ? s : at(s, 0, -4);
};

/** A tender coconut leaf decoration (kuruthola), knotted at the top with long fringes. */
const kuruthola: Piece = (r, p) => {
  const strips = 9;
  let s = hook(p.ink, -74);
  for (let i = 0; i < strips; i++) {
    const t = i / (strips - 1) - 0.5, ex = t * 130, ey = 80 - Math.abs(t) * 40 + between(r, -6, 6);
    s += `<path d="M0 -48 Q${n(ex * 0.4)} 10 ${n(ex)} ${n(ey)}" fill="none" stroke="#fff" stroke-width="11" stroke-linecap="round"/><path d="M0 -48 Q${n(ex * 0.4)} 10 ${n(ex)} ${n(ey)}" fill="none" stroke="${i % 2 ? '#e6df7a' : '#cfd45a'}" stroke-width="6" stroke-linecap="round"/>`;
  }
  s += `<path d="M0 -78 L18 -58 L0 -38 L-18 -58 Z" fill="#cfd45a" ${OUTLINE}/><path d="M-9 -68 L9 -48 M9 -68 L-9 -48" stroke="#b5b84a" stroke-width="3"/>`;
  s += bloom(0, -36, 10, MARIGOLD[0]);
  return s;
};

/** A ball of red chethi (ixora) flowers, used in pookalams. */
const chethi: Piece = (r) => {
  let s = '';
  s += leafAt(-50, 52, 80, LEAF[0], 150) + leafAt(50, 52, 80, LEAF[1], 30) + `<path d="M0 30 V90" stroke="${LEAF_DARK}" stroke-width="6" stroke-linecap="round"/>`;
  const reds = ['#e8302a', '#f0533a', '#d7263d'];
  const spots: [number, number][] = [];
  for (let ring = 0; ring < 3; ring++) {
    const count = [1, 6, 12][ring], R = [0, 22, 44][ring];
    for (let i = 0; i < count; i++) {
      const a = (2 * Math.PI * i) / count + ring;
      spots.push([Math.cos(a) * R, -12 + Math.sin(a) * R * 0.9]);
    }
  }
  for (const [x, y] of spots.reverse()) s += flower(x, y, 4, 15, 11, [pick(r, reds)], '#ffd23f', Math.PI / 4 + between(r, -0.3, 0.3), 3);
  return s;
};

const onamKit: Kit = {
  hero: [pookalam, pookalam, snakeBoat, nilavilakku, olakkuda],
  small: [pookalamSmall, nilavilakku, olakkuda, coconutTree, bananas(false), sadya, snakeBoat, chethi],
  hang: [bananas(true), kuruthola, marigoldStrand],
  colours: [MARIGOLD[0], GOLD, LEAF[0], RED, CREAM],
};

// ---------------------------------------------------------------- Ganesh Chaturthi

/** A brass plate heaped with modaks, a durva sprig on top. */
const modakPlate: Piece = (r, p) => {
  const mix = r() < 0.5;
  let s = brassPlate(52, 92);
  const size = 26;
  for (let row = 0; row < 3; row++) {
    const count = 3 - row, y = 56 - row * size * 1.2;
    for (let i = 0; i < count; i++) s += modak((i - (count - 1) / 2) * size * 2.05, y, size, mix ? MODAK[(i + row) % 2] : MODAK[0], p.ink);
  }
  s += `<path d="M0 -50 q-14 -18 -22 -34 M0 -50 q2 -20 0 -38 M0 -50 q12 -16 22 -32" fill="none" stroke="${LEAF[0]}" stroke-width="4" stroke-linecap="round"/>`;
  s += bloom(-84, 46, 12, MARIGOLD[0]) + bloom(84, 46, 12, MARIGOLD[1]);
  return at(s, 0, -2);
};

/** One big modak. */
const modakOne: Piece = (r, p) => modak(0, 74, 80, pick(r, MODAK), p.ink) + `<path d="M0 -50 q-12 -14 -24 -16 M0 -50 q2 -18 -2 -34 M0 -50 q12 -14 24 -16" stroke="${LEAF[0]}" stroke-width="5" fill="none" stroke-linecap="round"/>`;

/** Three modaks together. */
const modakTrio: Piece = (r, p) => {
  const c = shuffle(r, MODAK);
  return at(modak(-46, 66, 48, c[0], p.ink) + modak(46, 66, 48, c[1], p.ink) + modak(0, 80, 56, c[0], p.ink), 0, -34) + `<ellipse cx="0" cy="54" rx="86" ry="10" fill="${p.ink}" opacity=".08"/>`;
};

/** A decorated festive umbrella (chhatri) with tassels. */
const chhatri: Piece = (r, p) => {
  const [c1, c2, c3] = shuffle(r, p.acc);
  let s = `<line x1="0" y1="0" x2="0" y2="92" stroke="#fff" stroke-width="12" stroke-linecap="round"/><line x1="0" y1="0" x2="0" y2="92" stroke="${BRASS_DARK}" stroke-width="7" stroke-linecap="round"/>`;
  for (let i = 0; i < 9; i++) {
    const x = -80 + 20 * i, len = i % 2 ? 26 : 38;
    s += `<path d="M${x} 6 v${len}" stroke="${GOLD}" stroke-width="3"/><path d="M${x} ${6 + len} l-5 12 h10 z" fill="${i % 2 ? c2 : RED}" stroke="#fff" stroke-width="2" stroke-linejoin="round"/>`;
  }
  s += `<path d="M-88 6 Q-86 -60 0 -66 Q86 -60 88 6 Z" fill="${c1}" ${OUTLINE}/>
<path d="M-70 -24 Q0 -50 70 -24" fill="none" stroke="${GOLD}" stroke-width="8"/>
<path d="M-44 -50 Q0 -64 44 -50" fill="none" stroke="${c3}" stroke-width="7"/>`;
  for (let i = 0; i < 9; i++) s += `<circle cx="${-80 + 20 * i}" cy="${n(4 - (i === 0 || i === 8 ? 0 : 2))}" r="9" fill="${GOLD}" stroke="#fff" stroke-width="3"/>`;
  for (let i = 0; i < 5; i++) s += `<circle cx="${-48 + 24 * i}" cy="${n(-20 - 10 * Math.sin((i / 4) * Math.PI))}" r="4" fill="${CREAM}"/>`;
  s += `<path d="M0 -92 l8 14 h-16 z" fill="${GOLD}" stroke="#fff" stroke-width="3" stroke-linejoin="round"/><circle cx="0" cy="-70" r="8" fill="${GOLD}" ${OUTLINE}/>`;
  return s;
};

/** A cheerful little mouse (Mushak) holding a modak. */
const mushak: Piece = (r, p) => {
  const fur = pick(r, ['#b0aec4', '#b8a99a', '#a9b4c2']), belly = '#ecebf3', pink = '#ffb3c7', x = 540;
  let s = `<path d="M${x + 100} 600 q120 20 110 -70 q-6 -50 40 -60" fill="none" stroke="#fff" stroke-width="22" stroke-linecap="round"/>
<path d="M${x + 100} 600 q120 20 110 -70 q-6 -50 40 -60" fill="none" stroke="${pink}" stroke-width="12" stroke-linecap="round"/>`;
  s += `<ellipse cx="${x}" cy="500" rx="120" ry="128" fill="${fur}" ${OUTLINE}/>
<ellipse cx="${x}" cy="525" rx="78" ry="90" fill="${belly}"/>
<ellipse cx="${x - 58}" cy="630" rx="42" ry="18" fill="${pink}" ${OUTLINE}/>
<ellipse cx="${x + 58}" cy="630" rx="42" ry="18" fill="${pink}" ${OUTLINE}/>`;
  for (const side of [-1, 1]) s += `<circle cx="${x + side * 92}" cy="240" r="58" fill="${fur}" ${OUTLINE}/><circle cx="${x + side * 92}" cy="240" r="36" fill="${pink}"/>`;
  s += `<circle cx="${x}" cy="320" r="100" fill="${fur}" ${OUTLINE}/>
<circle cx="${x - 36}" cy="308" r="12" fill="${p.ink}"/><circle cx="${x + 36}" cy="308" r="12" fill="${p.ink}"/>
<circle cx="${x - 32}" cy="303" r="4" fill="#fff"/><circle cx="${x + 40}" cy="303" r="4" fill="#fff"/>
<circle cx="${x - 62}" cy="345" r="15" fill="${pink}" opacity=".6"/><circle cx="${x + 62}" cy="345" r="15" fill="${pink}" opacity=".6"/>
<circle cx="${x}" cy="342" r="14" fill="${pink}" ${OUTLINE}/>
<path d="M${x - 18} 362 q18 18 36 0" fill="none" stroke="${p.ink}" stroke-width="5" stroke-linecap="round"/>
<path d="M${x - 30} 345 l-70 -12 M${x - 30} 352 l-70 10 M${x + 30} 345 l70 -12 M${x + 30} 352 l70 10" stroke="${p.ink}" stroke-width="4" stroke-linecap="round" opacity=".35"/>`;
  s += modak(x, 560, 50, pick(r, MODAK), p.ink);
  s += `<ellipse cx="${x - 52}" cy="520" rx="22" ry="18" fill="${fur}" ${OUTLINE}/><ellipse cx="${x + 52}" cy="520" rx="22" ry="18" fill="${fur}" ${OUTLINE}/>`;
  return lift(s, 590, 420, 0.38, r() < 0.4);
};

/** A kalash: a brass pot with mango leaves and a coconut, tied with red thread. */
const kalash: Piece = (r, p) => {
  const band = pick(r, p.acc);
  let s = '';
  for (const [ang, len] of [[-150, 56], [-120, 58], [-60, 58], [-30, 56], [-90, 50]] as const) s += mangoLeaf(0, -28, len, LEAF[Math.abs(ang) % 60 ? 1 : 0], ang + 90 + 180);
  s += `<ellipse cx="0" cy="-48" rx="24" ry="30" fill="#8d5a3b" ${OUTLINE}/><path d="M-6 -78 q6 -12 14 -14 M0 -78 q-4 -10 -12 -12" stroke="#c49a6c" stroke-width="4" fill="none" stroke-linecap="round"/>
<path d="M-14 -60 q-4 10 -2 22" stroke="#a87650" stroke-width="3" fill="none"/>`;
  s += `<path d="M-28 -24 h56 l-6 14 h-44 z" fill="${BRASS_DARK}" ${OUTLINE}/>
<path d="M-22 -10 Q-76 4 -70 46 Q-62 84 0 86 Q62 84 70 46 Q76 4 22 -10 Z" fill="${BRASS}" ${OUTLINE}/>
<path d="M-62 24 Q0 40 62 24" fill="none" stroke="${RED}" stroke-width="6"/><path d="M-66 34 Q0 50 66 34" fill="none" stroke="${GOLD}" stroke-width="4"/>
<path d="M-40 6 Q-56 30 -46 60" fill="none" stroke="${BRASS_LIGHT}" stroke-width="7" stroke-linecap="round"/>`;
  for (const x of [-24, 0, 24]) s += `<circle cx="${x}" cy="${x === 0 ? 62 : 58}" r="6" fill="${band}" stroke="#fff" stroke-width="2"/>`;
  return s;
};

/** A red hibiscus flower with its long stamen. */
const hibiscus: Piece = (r) => {
  const rot = between(r, -0.3, 0.3);
  let s = leafAt(-50, 52, 60, LEAF[0], 150) + leafAt(52, 56, 54, LEAF[1], 30);
  for (let i = 0; i < 5; i++) {
    const a = rot + (2 * Math.PI * i) / 5 - Math.PI / 2;
    const x = Math.cos(a) * 42, y = Math.sin(a) * 42;
    s += `<ellipse cx="${n(x)}" cy="${n(y)}" rx="44" ry="34" transform="rotate(${n((a * 180) / Math.PI)} ${n(x)} ${n(y)})" fill="${i % 2 ? '#e8302a' : '#f0453a'}" ${OUTLINE}/>`;
  }
  s += `<circle cx="0" cy="0" r="18" fill="#a3172b"/>
<path d="M0 0 Q14 -26 34 -52" fill="none" stroke="#f7d1d5" stroke-width="5" stroke-linecap="round"/>`;
  for (const [dx, dy] of [[30, -54], [38, -50], [34, -44], [40, -58], [28, -60]]) s += `<circle cx="${dx}" cy="${dy}" r="3.5" fill="#ffd23f"/>`;
  return s;
};
const leafAt = (x: number, y: number, len: number, fill: string, angle: number) =>
  `<g transform="rotate(${n(angle)} ${n(x)} ${n(y)})"><path d="M${n(x - len / 2)} ${n(y)} q${n(len * 0.5)} ${n(-len * 0.4)} ${n(len)} 0 q${n(-len * 0.5)} ${n(len * 0.4)} ${n(-len)} 0 z" fill="${fill}" ${OUTLINE}/></g>`;

/** A bunch of durva grass, tied with red thread. */
const durva: Piece = (r) => {
  let s = '';
  const blades = 11;
  for (let i = 0; i < blades; i++) {
    const t = i / (blades - 1) - 0.5, tipx = t * 150 + between(r, -6, 6), tipy = -86 + Math.abs(t) * 70 + between(r, -6, 6);
    s += `<path d="M${n(t * 12 - 4)} 58 Q${n(tipx * 0.3 - 6)} ${n(tipy * 0.4)} ${n(tipx)} ${n(tipy)} Q${n(tipx * 0.3 + 8)} ${n(tipy * 0.4 + 6)} ${n(t * 12 + 5)} 58 Z" fill="${i % 3 ? LEAF[i % 2] : LEAF_DARK}" stroke="#fff" stroke-width="2" stroke-linejoin="round"/>`;
  }
  s += `<path d="M-6 58 L-12 92 M0 58 V94 M6 58 L12 92" stroke="${LEAF_DARK}" stroke-width="4" stroke-linecap="round"/>
<rect x="-14" y="48" width="28" height="14" rx="5" fill="${RED}" ${OUTLINE}/><path d="M10 58 q14 6 18 20 M10 58 q4 14 -2 26" fill="none" stroke="${RED}" stroke-width="3" stroke-linecap="round"/>`;
  return s;
};

/** A festive pandal arch with a toran and a kalash inside. */
const pandal: Piece = (r, p) => {
  const [c, c2] = shuffle(r, p.acc);
  let s = `<path d="M-84 92 V-6 A84 84 0 0 1 84 -6 V92 H62 V-6 A62 62 0 0 0 -62 -6 V92 Z" fill="${c}" ${OUTLINE}/>`;
  for (let i = 0; i <= 12; i++) {
    const a = Math.PI + (Math.PI * i) / 12;
    s += `<circle cx="${n(Math.cos(a) * 73)}" cy="${n(-6 + Math.sin(a) * 73)}" r="4.5" fill="${i % 2 ? CREAM : GOLD}"/>`;
  }
  for (let y = 10; y < 84; y += 18) s += `<circle cx="-73" cy="${y}" r="4.5" fill="${CREAM}"/><circle cx="73" cy="${y}" r="4.5" fill="${CREAM}"/>`;
  // Toran across the inside.
  for (let i = 0; i < 6; i++) s += mangoLeaf(-50 + 20 * i, -6, 24, LEAF[i % 2]);
  for (let i = 0; i <= 6; i++) s += bloom(-60 + 20 * i, -6, 8, MARIGOLD[i % 2]);
  s += at(kalash(r, p), 0, 52, 0.42);
  s += `<path d="M-50 92 h100" stroke="${c2}" stroke-width="6" stroke-linecap="round"/>`;
  s += bloom(0, -90, 9, MARIGOLD[0]);
  return s;
};

const ganeshKit: Kit = {
  hero: [modakPlate, chhatri, mushak, pandal, kalash],
  small: [modakOne, modakTrio, hibiscus, durva, bigDiya, kalash, mushak, marigold, chhatri],
  hang: [marigoldStrand, bell, toranBit],
  colours: [MARIGOLD[0], GOLD, '#e8302a', LEAF[0], CREAM],
};

// ---------------------------------------------------------------- Dussehra

/** A bow with two crossed arrows, decorated with a marigold garland and a ribbon. */
const bowArrows: Piece = (r, p) => {
  const [feather, ribbon] = shuffle(r, p.acc);
  const arrow = (angle: number) => `<g transform="rotate(${angle})">
<line x1="0" y1="76" x2="0" y2="-62" stroke="#fff" stroke-width="13" stroke-linecap="round"/><line x1="0" y1="76" x2="0" y2="-62" stroke="#8d5a3b" stroke-width="8" stroke-linecap="round"/>
<path d="M0 -92 l15 30 h-30 z" fill="${GOLD}" stroke="#fff" stroke-width="4" stroke-linejoin="round"/>
<path d="M0 48 l-14 16 v22 l14 -12 l14 12 v-22 z" fill="${feather}" stroke="#fff" stroke-width="3.5" stroke-linejoin="round"/></g>`;
  const curve = 'M-26 -86 Q86 0 -26 86';
  let s = `<line x1="-26" y1="-86" x2="-26" y2="86" stroke="${p.ink}" stroke-width="3" opacity=".45"/>
<path d="${curve}" fill="none" stroke="#fff" stroke-width="22" stroke-linecap="round"/><path d="${curve}" fill="none" stroke="#a0522d" stroke-width="14" stroke-linecap="round"/>
<path d="M-12 -70 Q34 -38 40 -10" fill="none" stroke="#c97a4a" stroke-width="4" stroke-linecap="round"/>
<rect x="22" y="-16" width="16" height="32" rx="5" fill="${ribbon}" stroke="#fff" stroke-width="3"/>`;
  s += arrow(-30) + arrow(30);
  // A marigold garland draped along the bow.
  for (let i = 1; i < 8; i++) {
    const t = i / 8, x = (1 - t) * (1 - t) * -26 + 2 * (1 - t) * t * 86 + t * t * -26, y = -86 + 172 * t;
    if (Math.abs(y) > 22) s += bloom(x + 2, y, 8.5, MARIGOLD[i % 2]);
  }
  s += `<path d="M30 10 q10 24 0 44 M34 10 q22 18 22 40" fill="none" stroke="${ribbon}" stroke-width="6" stroke-linecap="round"/>`;
  return s + bloom(0, 0, 16);
};

/** The decorated Mysuru Dasara elephant with its cloth and golden howdah. */
const elephant: Piece = (r, p) => {
  const cols = shuffle(r, p.acc), grey = '#9ea7b8', ear = '#8a93a6', gold = GOLD;
  let e = `<path d="M290 420 q-30 40 -20 120" fill="none" stroke="${grey}" stroke-width="10" stroke-linecap="round"/><circle cx="270" cy="545" r="10" fill="${p.ink}" opacity=".5"/>`;
  e += `<rect x="345" y="490" width="66" height="150" rx="22" fill="${ear}" ${OUTLINE}/><rect x="620" y="490" width="66" height="150" rx="22" fill="${ear}" ${OUTLINE}/>`;
  e += `<ellipse cx="500" cy="440" rx="220" ry="150" fill="${grey}" ${OUTLINE}/>
<rect x="400" y="500" width="70" height="140" rx="22" fill="${grey}" ${OUTLINE}/><rect x="560" y="500" width="70" height="140" rx="22" fill="${grey}" ${OUTLINE}/>`;
  for (const x of [400, 560]) e += `<rect x="${x}" y="606" width="70" height="16" fill="${gold}"/>`;
  e += `<path d="M360 330 Q500 270 640 330 L650 520 L350 520 Z" fill="${cols[0]}" ${OUTLINE}/>
<rect x="350" y="490" width="300" height="26" fill="${cols[1]}"/>`;
  for (let i = 0; i < 10; i++) e += `<circle cx="${365 + 30 * i}" cy="526" r="13" fill="${gold}" stroke="#fff" stroke-width="3"/>`;
  for (let i = 0; i < 4; i++) e += flower(410 + 60 * i, 420, 6, 34, 20, [CREAM], gold, 0, 8);
  e += `<rect x="415" y="240" width="170" height="70" rx="10" fill="${gold}" ${OUTLINE}/>
<path d="M430 240 V170 M570 240 V170" stroke="${BRASS_DARK}" stroke-width="10"/>
<path d="M410 180 Q500 70 590 180 Z" fill="${cols[2]}" ${OUTLINE}/>
<circle cx="500" cy="108" r="14" fill="${gold}" ${OUTLINE}/>`;
  for (let i = 0; i < 5; i++) e += `<circle cx="${440 + 30 * i}" cy="275" r="8" fill="${cols[(i % 2) + 3]}"/>`;
  e += `<path d="M790 400 Q830 470 820 560 Q815 600 850 600" fill="none" stroke="#fff" stroke-width="58" stroke-linecap="round"/>
<path d="M790 400 Q830 470 820 560 Q815 600 850 600" fill="none" stroke="${grey}" stroke-width="46" stroke-linecap="round"/>
<circle cx="740" cy="350" r="105" fill="${grey}" ${OUTLINE}/>
<path d="M800 455 q30 10 40 -6" fill="none" stroke="#fffaf0" stroke-width="14" stroke-linecap="round"/>
<ellipse cx="680" cy="370" rx="62" ry="92" fill="${ear}" ${OUTLINE}/>
<path d="M740 250 Q800 250 820 300 Q800 360 790 400 Q770 340 740 250 Z" fill="${gold}" ${OUTLINE}/>
<circle cx="795" cy="310" r="9" fill="${cols[3]}"/><circle cx="795" cy="345" r="7" fill="${cols[4]}"/>
<circle cx="765" cy="335" r="10" fill="${p.ink}"/><path d="M756 360 q12 10 26 4" fill="none" stroke="${p.ink}" stroke-width="5" stroke-linecap="round"/>`;
  for (let i = 0; i < 4; i++) e += `<circle cx="${n(812 + i * 3)}" cy="${470 + 32 * i}" r="6" fill="${cols[(i % 3) + 1]}"/>`;
  return lift(e, 570, 372, 0.29, r() < 0.5);
};

/** Mysuru Palace at night, its outline lit with rows of little lights. */
const palace: Piece = (r, _p) => {
  const body = pick(r, ['#5a4b8f', '#4a5a9a', '#6b4a7f']), light = '#ffe27a';
  const dotsLine = (x1: number, y1: number, x2: number, y2: number, step = 9) => {
    let d = '';
    const len = Math.hypot(x2 - x1, y2 - y1), k = Math.max(1, Math.round(len / step));
    for (let i = 0; i <= k; i++) d += `<circle cx="${n(x1 + ((x2 - x1) * i) / k)}" cy="${n(y1 + ((y2 - y1) * i) / k)}" r="2.6" fill="${light}"/>`;
    return d;
  };
  const dome = (cx: number, base: number, w: number, h: number) => {
    let d = `<path d="M${cx - w} ${base} Q${cx - w * 1.5} ${base - h * 0.55} ${cx} ${base - h} Q${cx + w * 1.5} ${base - h * 0.55} ${cx + w} ${base} Z" fill="${body}" ${OUTLINE}/>
<line x1="${cx}" y1="${base - h}" x2="${cx}" y2="${base - h - 10}" stroke="${GOLD}" stroke-width="3"/><circle cx="${cx}" cy="${base - h - 11}" r="3.5" fill="${GOLD}"/>`;
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      for (const side of [-1, 1]) {
        const x = (1 - t) * (1 - t) * (cx + side * w) + 2 * (1 - t) * t * (cx + side * w * 1.5) + t * t * cx;
        const y = (1 - t) * (1 - t) * base + 2 * (1 - t) * t * (base - h * 0.55) + t * t * (base - h);
        if (side === 1 && i === 8) continue;
        d += `<circle cx="${n(x)}" cy="${n(y)}" r="2.4" fill="${light}"/>`;
      }
    }
    return d;
  };
  let s = '';
  // Side towers.
  for (const side of [-1, 1]) {
    const x = side * 66;
    s += `<rect x="${x - 14}" y="-24" width="28" height="60" fill="${body}" ${OUTLINE}/>` + dome(x, -24, 14, 34);
    s += dotsLine(x - 14, -24, x + 14, -24, 7) + `<path d="M${x - 6} 18 v-14 a6 6 0 0 1 12 0 v14 z" fill="${light}" opacity=".85"/>`;
  }
  // The main block and its big middle dome.
  s += `<rect x="-38" y="-30" width="76" height="66" fill="${body}" ${OUTLINE}/>` + dome(0, -30, 26, 52);
  s += dotsLine(-38, -30, 38, -30, 8);
  for (const x of [-24, 0, 24]) s += `<path d="M${x - 7} 28 v-24 a7 7 0 0 1 14 0 v24 z" fill="${light}" opacity=".85"/>`;
  s += `<path d="M-30 -10 h60" stroke="${light}" stroke-width="2" stroke-dasharray="2 6" stroke-linecap="round"/>`;
  // The long front with its row of arches.
  s += `<rect x="-92" y="34" width="184" height="50" rx="3" fill="${body}" ${OUTLINE}/>`;
  s += dotsLine(-90, 34, 90, 34) + dotsLine(-90, 84, 90, 84);
  for (let i = 0; i < 9; i++) {
    const x = -80 + 20 * i;
    s += `<path d="M${x - 6} 76 v-18 a6 6 0 0 1 12 0 v18 z" fill="${light}" opacity="${i === 4 ? 1 : 0.8}"/>`;
  }
  return at(s, 0, 4);
};

/** A saffron pennant (two stacked triangles) on a pole. */
const pennant: Piece = (r) => {
  const wave = between(r, 4, 10);
  return `<line x1="-50" y1="-80" x2="-50" y2="92" stroke="#fff" stroke-width="12" stroke-linecap="round"/><line x1="-50" y1="-80" x2="-50" y2="92" stroke="#8d5a3b" stroke-width="7" stroke-linecap="round"/>
<path d="M-48 -74 Q20 ${n(-62 - wave)} 80 -40 L-4 -22 Q30 ${n(-10 + wave)} 72 6 Q10 ${n(22 + wave)} -48 32 Z" fill="${SAFFRON}" ${OUTLINE}/>
<path d="M-40 -60 Q4 -54 40 -42" fill="none" stroke="#ffc58a" stroke-width="5" stroke-linecap="round"/>
<circle cx="-50" cy="-84" r="9" fill="${GOLD}" ${OUTLINE}/>` + bloom(-50, 50, 11, MARIGOLD[0]);
};

/** A saffron pennant hanging from the string, point down. */
const pennantHang: Piece = (r, p) => {
  const c = r() < 0.7 ? SAFFRON : pick(r, p.acc);
  return `${hook(p.ink, -74)}<path d="M-56 -74 H56 L0 76 Z" fill="${c}" ${OUTLINE}/><path d="M-36 -56 H36 L0 40 Z" fill="none" stroke="#ffc58a" stroke-width="4" stroke-linejoin="round"/>
<circle cx="0" cy="-74" r="7" fill="${GOLD}" stroke="#fff" stroke-width="3"/>${bloom(0, 82, 10)}`;
};

/** Apta leaves, the "gold" friends give each other at Dussehra: one green, one golden. */
const aptaLeaves: Piece = () => {
  const apta = (x: number, y: number, s: number, fill: string, vein: string, rot: number) =>
    at(`<path d="M0 60 C-10 40 -70 30 -64 -20 C-60 -54 -20 -60 -4 -30 L0 -40 L4 -30 C20 -60 60 -54 64 -20 C70 30 10 40 0 60 Z" fill="${fill}" ${OUTLINE}/>
<path d="M0 56 V-30 M0 20 Q-24 6 -44 -14 M0 20 Q24 6 44 -14 M0 -2 Q-16 -14 -26 -36 M0 -2 Q16 -14 26 -36" fill="none" stroke="${vein}" stroke-width="3" stroke-linecap="round"/>
<path d="M0 58 q-2 14 -8 22" stroke="${vein}" stroke-width="5" fill="none" stroke-linecap="round"/>`, x, y, s, rot);
  return apta(-30, 8, 0.82, LEAF[0], '#bfe8c6', -20) + apta(34, -2, 0.86, GOLD, '#fff4c2', 18) + sparkle(70, -66, 14, '#fff') + sparkle(54, -80, 7, GOLD);
};

/** A plate of Mysore pak, Mysuru's own golden sweet. */
const mysorePak: Piece = (r, p) => {
  let s = brassPlate(46, 90);
  const block = (x: number, y: number) => {
    let b = `<path d="M${x - 24} ${y} l24 -10 l24 10 l-24 10 z" fill="#ffd56b" stroke="#fff" stroke-width="3" stroke-linejoin="round"/><path d="M${x - 24} ${y} v24 l24 10 v-24 z" fill="#f2b134" stroke="#fff" stroke-width="3" stroke-linejoin="round"/><path d="M${x + 24} ${y} v24 l-24 10 v-24 z" fill="#e39a1f" stroke="#fff" stroke-width="3" stroke-linejoin="round"/>`;
    for (let k = 0; k < 3; k++) b += `<circle cx="${n(x - 14 + between(r, -4, 4) + k * 5)}" cy="${n(y + 10 + k * 6)}" r="1.8" fill="#c97f12"/><circle cx="${n(x + 10 + k * 4)}" cy="${n(y + 10 + between(r, 0, 14))}" r="1.8" fill="#b06e0c"/>`;
    return b;
  };
  for (const [x, y] of [[-48, 12], [0, 16], [48, 12], [-24, -18], [24, -18], [0, -48]]) s += block(x, y);
  return s + `<circle cx="-80" cy="38" r="5" fill="${pick(r, p.acc)}"/><circle cx="80" cy="38" r="5" fill="${pick(r, p.acc)}"/>`;
};

const dussehraKit: Kit = {
  hero: [bowArrows, elephant, palace, aptaLeaves],
  small: [bowArrows, aptaLeaves, pennant, marigold, mysorePak, bigDiya, elephant, palace],
  hang: [marigoldStrand, toranBit, pennantHang, bell],
  colours: [SAFFRON, GOLD, MARIGOLD[0], LEAF[0], RED],
};

// ---------------------------------------------------------------- Guru Nanak Jayanti

/** A white gurdwara with domes and golden tops, outlined with little lights. */
const gurdwara: Piece = (r, p) => {
  const white = '#fbfaf6', light = GOLD, ink = p.ink;
  const dome = (cx: number, base: number, w: number, h: number) =>
    `<path d="M${cx - w} ${base} Q${cx - w * 1.45} ${base - h * 0.5} ${cx} ${base - h} Q${cx + w * 1.45} ${base - h * 0.5} ${cx + w} ${base} Z" fill="${white}" ${soft(ink, 4)}/>
<path d="M${cx} ${base - h} v-7" stroke="${BRASS_DARK}" stroke-width="3"/><path d="M${cx - 4} ${base - h - 6} q4 -12 8 0 z" fill="${GOLD}"/><circle cx="${cx}" cy="${base - h - 13}" r="3" fill="${GOLD}"/>`;
  let s = '';
  // Corner chhatris.
  for (const side of [-1, 1]) {
    const x = side * 70;
    s += `<rect x="${x - 16}" y="-12" width="32" height="74" fill="${white}" ${soft(ink, 4)}/>` + dome(x, -12, 13, 30);
    s += `<path d="M${x - 8} -14 h16" stroke="${GOLD}" stroke-width="3"/><path d="M${x - 6} 30 v-14 a6 6 0 0 1 12 0 v14 z" fill="#d9e3f2"/>`;
  }
  // The main hall and its big dome.
  s += `<rect x="-50" y="-22" width="100" height="84" fill="${white}" ${soft(ink, 4)}/>` + dome(0, -22, 30, 56);
  s += `<path d="M-50 -22 h100" stroke="${GOLD}" stroke-width="5"/>`;
  for (const x of [-34, 34]) s += dome(x, -26, 7, 18);
  // Doors.
  s += `<path d="M-14 62 v-32 a14 14 0 0 1 28 0 v32 z" fill="#d9e3f2"/><path d="M-12 62 v-30 a12 12 0 0 1 24 0 v30" fill="none" stroke="${GOLD}" stroke-width="3"/>`;
  for (const x of [-34, 34]) s += `<path d="M${x - 7} 52 v-18 a7 7 0 0 1 14 0 v18 z" fill="#d9e3f2"/>`;
  // Steps and lights.
  s += `<rect x="-92" y="62" width="184" height="12" rx="3" fill="${white}" ${soft(ink, 4)}/><rect x="-80" y="74" width="160" height="10" rx="3" fill="${STEEL_LIGHT}" ${soft(ink, 4)}/>`;
  for (let i = 0; i <= 18; i++) s += `<circle cx="${-90 + 10 * i}" cy="62" r="2.6" fill="${light}"/>`;
  for (let i = 0; i <= 10; i++) s += `<circle cx="${-50 + 10 * i}" cy="-22" r="2.6" fill="${i % 2 ? pick(r, p.acc) : light}"/>`;
  // Every gurdwara has its Nishan Sahib beside it.
  const flag = `<rect x="80" y="-84" width="7" height="170" rx="3" fill="${SAFFRON}" stroke="#fff" stroke-width="3"/>
<path d="M80 -82 Q56 -84 34 -66 Q58 -60 80 -50 Z" fill="${SAFFRON}" stroke="#fff" stroke-width="3" stroke-linejoin="round"/>
<circle cx="83.5" cy="-88" r="4" fill="${GOLD}"/>`;
  return flag + at(s, -12, 10, 0.84);
};

/** The Nishan Sahib: a tall pole wrapped in saffron cloth with a kesri triangular flag. */
const nishanSahib: Piece = (r) => {
  const wave = between(r, 4, 10);
  return `<rect x="-34" y="-80" width="12" height="160" rx="5" fill="${SAFFRON}" ${OUTLINE}/>
<path d="M-34 -40 h12 M-34 0 h12 M-34 40 h12" stroke="#ffc58a" stroke-width="3"/>
<path d="M-24 -78 Q24 ${n(-70 - wave)} 86 -44 Q30 ${n(-18 + wave)} -24 -6 Z" fill="${SAFFRON}" ${OUTLINE}/>
<path d="M-14 -62 Q22 -58 52 -46" fill="none" stroke="#ffc58a" stroke-width="5" stroke-linecap="round"/>
<path d="M-28 -96 l7 12 h-14 z" fill="${GOLD}" stroke="#fff" stroke-width="2.5" stroke-linejoin="round"/><circle cx="-28" cy="-82" r="6" fill="${GOLD}" stroke="#fff" stroke-width="3"/>
<rect x="-62" y="78" width="68" height="14" rx="4" fill="#fbfaf6" stroke="#c9ccd6" stroke-width="3"/><rect x="-50" y="68" width="44" height="12" rx="3" fill="#fbfaf6" stroke="#c9ccd6" stroke-width="3"/>`;
};

/** A candle with its flame. */
const candleAt = (x: number, base: number, h: number, w: number, fill: string) =>
  flame(x, base - h - 4, w * 1.4) +
  `<rect x="${n(x - w / 2)}" y="${n(base - h)}" width="${w}" height="${h}" rx="5" fill="${fill}" stroke="#fff" stroke-width="3.5"/>
<path d="M${n(x - w / 2 + 6)} ${n(base - h + 4)} q4 8 0 16" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" opacity=".8"/>
<line x1="${x}" y1="${n(base - h)}" x2="${x}" y2="${n(base - h - 5)}" stroke="#5d4037" stroke-width="2.5"/>`;

/** Candles and diyas glowing together. */
const lampCluster: Piece = (r, p) => {
  const c = shuffle(r, p.acc);
  let s = candleAt(-38, 54, 74, 26, CREAM) + candleAt(16, 54, 98, 28, '#fbfaf6') + candleAt(62, 54, 56, 24, c[0]);
  s += `<ellipse cx="0" cy="60" rx="92" ry="14" fill="${BRASS}" ${OUTLINE}/>`;
  s += at(clayDiya([c[1], GOLD]), -48, 66, 0.42) + at(clayDiya([c[2], GOLD]), 40, 68, 0.42);
  return at(s, 0, 6);
};

/** One candle. */
const candle: Piece = (r, p) => candleAt(0, 88, 120, 40, r() < 0.5 ? CREAM : pick(r, p.acc)) + `<ellipse cx="0" cy="88" rx="44" ry="8" fill="${BRASS}" stroke="#fff" stroke-width="3"/>`;

/** A langar thali: a steel plate with rotis, dal, kheer and sabzi. */
const thali: Piece = (r, p) => {
  let s = `<ellipse cx="0" cy="20" rx="92" ry="52" fill="${STEEL}" ${soft(p.ink)}/><ellipse cx="0" cy="18" rx="76" ry="40" fill="${STEEL_LIGHT}"/>`;
  const bowl = (x: number, y: number, fill: string) =>
    `<ellipse cx="${x}" cy="${y + 4}" rx="22" ry="13" fill="${STEEL}" ${soft(p.ink, 3)}/><ellipse cx="${x}" cy="${y}" rx="18" ry="9" fill="${fill}"/>`;
  const order = shuffle(r, ['#ffc94a', '#fff1d6', '#8cc152']);
  s += bowl(-32, -6, order[0]) + bowl(10, -12, order[1]) + bowl(50, -2, order[2]);
  for (let k = 0; k < 3; k++) s += `<ellipse cx="-30" cy="${34 - k * 6}" rx="34" ry="13" fill="#e8c38a" stroke="#fff" stroke-width="3"/>`;
  s += `<circle cx="-40" cy="20" r="2.5" fill="#b07a3c"/><circle cx="-20" cy="24" r="2" fill="#b07a3c"/>`;
  s += `<ellipse cx="34" cy="32" rx="22" ry="11" fill="#fffaf0" ${soft(p.ink, 2)}/>`;
  return at(s, 0, 2, 1);
};

/** A brass lamp hanging on three chains. */
const hangingLamp: Piece = (r, p) => {
  let s = hook(p.ink, -80) + `<path d="M0 -80 L-46 20 M0 -80 L0 20 M0 -80 L46 20" stroke="${BRASS_DARK}" stroke-width="3" stroke-dasharray="5 3"/>`;
  s += flame(0, 18, 46);
  s += `<path d="M-60 20 Q0 80 60 20 Z" fill="${BRASS}" ${OUTLINE}/><ellipse cx="0" cy="20" rx="60" ry="9" fill="${BRASS_LIGHT}" ${OUTLINE}/>
<path d="M-6 56 h12 l-6 30 z" fill="${BRASS_DARK}" ${OUTLINE}/>`;
  s += `<circle cx="-24" cy="38" r="4" fill="${pick(r, p.acc)}"/><circle cx="0" cy="44" r="4" fill="${RED}"/><circle cx="24" cy="38" r="4" fill="${pick(r, p.acc)}"/>`;
  return s;
};

/** A strand of little light bulbs hanging down. */
const lightStrand: Piece = (r, p) => {
  const cols = [GOLD, ...shuffle(r, p.acc).slice(0, 2)];
  let s = `<path d="M0 -95 V80" fill="none" stroke="${p.ink}" stroke-width="3" opacity=".4"/>`;
  for (let i = 0; i < 5; i++) {
    const y = -72 + 36 * i, c = cols[i % cols.length], side = i % 2 ? 1 : -1;
    const x = 0;
    const bx = x + side * 12, by = y + 14;
    s += `<circle cx="${n(bx)}" cy="${by}" r="24" fill="${c}" opacity=".22"/><path d="M${n(x)} ${y} L${n(bx - side * 4)} ${by - 12}" stroke="${p.ink}" stroke-width="3" opacity=".4"/>
<ellipse cx="${n(bx)}" cy="${by}" rx="11" ry="15" fill="${c}" stroke="#fff" stroke-width="3" transform="rotate(${-side * 20} ${n(bx)} ${by})"/><rect x="${n(bx - side * 4 - 5)}" y="${by - 19}" width="10" height="8" rx="2" fill="${p.ink}" opacity=".5" transform="rotate(${-side * 20} ${n(bx)} ${by})"/>`;
  }
  return s;
};

const guruNanakKit: Kit = {
  hero: [gurdwara, nishanSahib, lampCluster, thali],
  small: [bigDiya, candle, lampCluster, thali, gurdwara, nishanSahib, marigold, firework],
  hang: [lightStrand, hangingLamp, marigoldStrand],
  colours: [SAFFRON, GOLD, '#ffe08a', '#7aa6d6', '#ffffff'],
};

// ---------------------------------------------------------------- Christmas

const XRED = '#e23b3b', XGREEN = '#2e9e55';

/** A Christmas tree with baubles, a garland and a star on top. */
const tree: Piece = (r, p) => {
  const cols = shuffle(r, [...p.acc, XRED, GOLD]);
  let s = `<rect x="-14" y="66" width="28" height="22" rx="4" fill="#8d5a3b" ${OUTLINE}/>`;
  const tiers: [number, number, number][] = [[70, 76, 14], [30, 60, -26], [-12, 42, -62]];
  for (const [base, w, top] of tiers)
    s += `<path d="M${-w} ${base} Q0 ${base + 12} ${w} ${base} L0 ${top} Z" fill="${XGREEN}" ${OUTLINE}/>`;
  s += `<path d="M-56 46 Q0 64 50 30" fill="none" stroke="${GOLD}" stroke-width="4" stroke-dasharray="1 8" stroke-linecap="round"/><path d="M-40 8 Q0 24 38 -6" fill="none" stroke="${GOLD}" stroke-width="4" stroke-dasharray="1 8" stroke-linecap="round"/>`;
  const balls: [number, number][] = [[-48, 62], [-12, 68], [30, 64], [56, 60], [-30, 26], [8, 30], [36, 20], [-16, -8], [14, -14], [0, -38]];
  balls.forEach(([x, y], i) => (s += `<circle cx="${x}" cy="${y}" r="${i > 7 ? 6 : 8}" fill="${cols[i % cols.length]}" stroke="#fff" stroke-width="2.5"/><circle cx="${x - 2}" cy="${y - 2}" r="2" fill="#fff" opacity=".8"/>`));
  s += star(0, -72, 22, GOLD);
  return s + sparkle(-62, -60, 9, '#fff') + sparkle(64, -36, 7, GOLD);
};

/** A stack of three wrapped presents. */
const giftStack: Piece = (r, p) => {
  const c = shuffle(r, [...p.acc, XRED]);
  return gift(-88, 10, 124, 80, c[0], CREAM) + gift(-62, -56, 84, 64, c[2], CREAM) + gift(32, -12, 58, 102, c[1], c[3]) + sparkle(64, -60, 12, GOLD) + sparkle(-80, -30, 9, '#fff');
};

/** A wreath of leaves with berries and a red bow. */
const wreath: Piece = (r, p) => {
  let s = `<circle cx="0" cy="-4" r="62" fill="none" stroke="${LEAF_DARK}" stroke-width="30"/>`;
  const count = 22;
  for (let i = 0; i < count; i++) {
    const a = (2 * Math.PI * i) / count, R = i % 2 ? 72 : 52, x = Math.cos(a) * R, y = -4 + Math.sin(a) * R;
    s += `<ellipse cx="${n(x)}" cy="${n(y)}" rx="18" ry="9" fill="${LEAF[i % 2]}" stroke="#fff" stroke-width="2.5" transform="rotate(${n((a * 180) / Math.PI + 60)} ${n(x)} ${n(y)})"/>`;
  }
  for (let i = 0; i < 9; i++) {
    const a = (2 * Math.PI * i) / 9 + 0.3, R = 62;
    s += `<circle cx="${n(Math.cos(a) * R)}" cy="${n(-4 + Math.sin(a) * R)}" r="6" fill="${i % 3 === 2 ? pick(r, p.acc) : XRED}" stroke="#fff" stroke-width="2"/>`;
  }
  s += `<path d="M0 62 l-26 -18 q-8 16 2 30 z M0 62 l26 -18 q8 16 -2 30 z" fill="${XRED}" ${OUTLINE}/>
<path d="M-4 64 l-12 30 l10 -4 l6 -26 M4 64 l12 30 l-10 -4 l-6 -26" fill="${XRED}" stroke="#fff" stroke-width="3" stroke-linejoin="round"/>
<circle cx="0" cy="62" r="8" fill="${XRED}" ${OUTLINE}/>`;
  return s;
};

/** A cheerful snowman with a scarf and a hat. */
const snowman: Piece = (r, p) => {
  const scarf = pick(r, [...p.acc, XRED]), snow = '#ffffff';
  let s = `<path d="M-34 6 L-74 -18 M-62 -12 l-6 -14 M34 6 L74 -22 M62 -14 l8 -12" stroke="#8d5a3b" stroke-width="5" stroke-linecap="round"/>
<circle cx="0" cy="52" r="42" fill="${snow}" ${soft(p.ink)}/><circle cx="0" cy="-2" r="32" fill="${snow}" ${soft(p.ink)}/><circle cx="0" cy="-48" r="24" fill="${snow}" ${soft(p.ink)}/>`;
  for (const y of [-8, 6, 40]) s += `<circle cx="0" cy="${y}" r="4" fill="${p.ink}" opacity=".8"/>`;
  s += `<circle cx="-8" cy="-52" r="3.5" fill="${p.ink}"/><circle cx="8" cy="-52" r="3.5" fill="${p.ink}"/>
<path d="M0 -46 l22 5 l-22 3 z" fill="#ff8a3d"/><path d="M-9 -38 q9 7 18 0" fill="none" stroke="${p.ink}" stroke-width="2.5" stroke-linecap="round"/>
<circle cx="-14" cy="-42" r="4" fill="#ffb3c7" opacity=".7"/><circle cx="14" cy="-42" r="4" fill="#ffb3c7" opacity=".7"/>
<path d="M-26 -28 Q0 -18 26 -28 L24 -20 Q0 -10 -24 -20 Z" fill="${scarf}" stroke="#fff" stroke-width="2.5" stroke-linejoin="round"/><path d="M14 -20 l6 26 l10 -4 l-6 -22 z" fill="${scarf}" stroke="#fff" stroke-width="2.5" stroke-linejoin="round"/>`;
  s += r() < 0.5
    ? `<rect x="-30" y="-74" width="60" height="9" rx="4" fill="${p.ink}"/><rect x="-19" y="-96" width="38" height="26" rx="4" fill="${p.ink}"/><rect x="-19" y="-80" width="38" height="6" fill="${XRED}"/>`
    : `<path d="M-24 -66 Q0 -96 24 -66 Z" fill="${scarf}" stroke="#fff" stroke-width="3"/><rect x="-26" y="-70" width="52" height="9" rx="4" fill="#fff" ${soft(p.ink, 2)}/><circle cx="0" cy="-88" r="7" fill="#fff" ${soft(p.ink, 2)}/>`;
  return s;
};

/** A gingerbread house with icing, sweets on the roof and a lit window. */
const gingerHouse: Piece = (r, p) => {
  const ginger = '#c27a45', cols = shuffle(r, [...p.acc, XRED]);
  let s = `<rect x="34" y="-70" width="18" height="34" fill="${ginger}" ${OUTLINE}/><rect x="31" y="-74" width="24" height="8" rx="3" fill="#fff"/>
<rect x="-66" y="-6" width="132" height="92" rx="4" fill="${ginger}" ${OUTLINE}/>
<path d="M-88 4 L0 -78 L88 4 Z" fill="#a8602f" ${OUTLINE}/>
<path d="M-82 2 Q-71 14 -60 2 Q-49 14 -38 2 Q-27 14 -16 2 Q-5 14 6 2 Q17 14 28 2 Q39 14 50 2 Q61 14 72 2 Q78 10 84 2" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round"/>`;
  for (const [x, y, i] of [[-34, -22, 0], [0, -46, 1], [34, -22, 2], [0, -14, 3]] as const) s += `<circle cx="${x}" cy="${y}" r="7" fill="${cols[i]}" stroke="#fff" stroke-width="2.5"/>`;
  s += `<path d="M-16 86 v-34 a16 16 0 0 1 32 0 v34 z" fill="#7d4524" stroke="#fff" stroke-width="3"/><circle cx="8" cy="70" r="2.5" fill="${GOLD}"/>
<rect x="-56" y="20" width="26" height="24" rx="3" fill="#ffe08a" stroke="#fff" stroke-width="3"/><path d="M-43 20 v24 M-56 32 h26" stroke="#fff" stroke-width="2.5"/>
<rect x="30" y="20" width="26" height="24" rx="3" fill="#ffe08a" stroke="#fff" stroke-width="3"/><path d="M43 20 v24 M30 32 h26" stroke="#fff" stroke-width="2.5"/>`;
  for (let i = 0; i < 6; i++) s += `<path d="M${-60 + 8 * i} 86 v-8" stroke="${i % 2 ? XRED : '#fff'}" stroke-width="5"/><path d="M${20 + 8 * i} 86 v-8" stroke="${i % 2 ? XGREEN : '#fff'}" stroke-width="5"/>`;
  return s;
};

/** A red and white candy cane with a little bow. */
const candyCane = (hang: boolean): Piece => (_r, p) => {
  const d = hang ? 'M24 90 V-34 A30 30 0 0 0 -36 -34 V-20' : 'M24 90 V-34 A30 30 0 0 0 -36 -34 V-14';
  let s = hang ? hook(p.ink, -64, -6) : '';
  s += `<path d="${d}" fill="none" stroke="${p.ink}" stroke-opacity=".2" stroke-width="30" stroke-linecap="round"/><path d="${d}" fill="none" stroke="#fff" stroke-width="24" stroke-linecap="round"/>
<path d="${d}" fill="none" stroke="${XRED}" stroke-width="24" stroke-dasharray="12 12"/>`;
  s += `<path d="M24 24 l-22 -12 v26 z M24 24 l22 -12 v26 z" fill="${XGREEN}" stroke="#fff" stroke-width="3" stroke-linejoin="round"/><circle cx="24" cy="24" r="6" fill="${GOLD}" stroke="#fff" stroke-width="2"/>`;
  return hang ? s : at(s, 6, 0);
};

/** A Christmas stocking with a fluffy cuff, on its loop. */
const stocking = (hang: boolean): Piece => (r, p) => {
  const body = pick(r, [XRED, XRED, ...p.acc]), patch = body === XRED ? XGREEN : XRED;
  let s = hang ? hook(p.ink, -80, -6) : '';
  s += `<path d="M-6 -80 q14 -6 14 8" fill="none" stroke="${p.ink}" stroke-width="3" opacity=".45"/>
<path d="M-40 -56 H28 V28 Q30 50 54 50 Q80 50 82 70 Q82 92 52 92 H-6 Q-40 92 -40 54 Z" fill="${body}" ${OUTLINE}/>
<path d="M50 50 Q80 50 82 70 Q82 92 52 92 Z" fill="${patch}" stroke="#fff" stroke-width="3" stroke-linejoin="round"/>
<path d="M-40 60 Q-40 92 -6 92 L-6 60 Z" fill="${patch}" stroke="#fff" stroke-width="3" stroke-linejoin="round"/>
<rect x="-48" y="-82" width="86" height="30" rx="14" fill="#fff" ${soft(p.ink, 3)}/>`;
  for (let i = 0; i < 4; i++) s += `<circle cx="${-30 + 20 * i}" cy="-67" r="5" fill="#eef2f6"/>`;
  s += star(-6, 4, 14, GOLD);
  return hang ? s : at(s, -16, 0);
};

/** A gold star with twinkles. */
const xStar: Piece = (r) => star(0, 6, 82, GOLD, between(r, -0.15, 0.15)) + star(0, 6, 40, '#ffe08a') + sparkle(-74, -70, 12, '#fff') + sparkle(72, 70, 10, '#fff');

/** A gold star hanging from the string. */
const starHang: Piece = (r, p) => hook(p.ink, -62) + star(0, 8, 70, pick(r, [GOLD, GOLD, ...p.acc])) + star(0, 8, 32, '#ffe08a');

/** A Christmas bauble. */
const bauble = (hang: boolean): Piece => (r, p) => {
  const c = pick(r, [...p.acc, XRED]), c2 = pick(r, [GOLD, '#fff']);
  let s = hang ? hook(p.ink, -66) + `<ellipse cx="0" cy="-66" rx="8" ry="6" fill="none" stroke="${BRASS_DARK}" stroke-width="3"/>` : '';
  s += `<rect x="-14" y="-62" width="28" height="18" rx="4" fill="${BRASS}" ${OUTLINE}/>
<circle cx="0" cy="16" r="66" fill="${c}" ${OUTLINE}/>
<path d="M-62 4 Q0 22 62 4 M-62 30 Q0 48 62 30" fill="none" stroke="${c2}" stroke-width="6"/>`;
  if (r() < 0.5) for (let i = 0; i < 5; i++) s += `<circle cx="${-40 + 20 * i}" cy="${n(17 + 10 * Math.sin((i / 4) * Math.PI))}" r="4" fill="${c2}"/>`;
  else for (let i = 0; i < 4; i++) s += star(-36 + 24 * i, 17 + 9 * Math.sin(((i + 0.5) / 4) * Math.PI), 6, c2);
  s += `<ellipse cx="-30" cy="-16" rx="12" ry="18" fill="#fff" opacity=".45" transform="rotate(30 -30 -16)"/>`;
  return hang ? s : at(s, 0, 4);
};

/** Two golden bells with a red bow and holly. */
const bells = (hang: boolean): Piece => (_r, p) => {
  const bellShape = (rot: number) =>
    at(`<path d="M0 -50 Q30 -50 34 -6 Q36 22 50 34 H-50 Q-36 22 -34 -6 Q-30 -50 0 -50 Z" fill="${GOLD}" ${OUTLINE}/><rect x="-54" y="30" width="108" height="10" rx="5" fill="${BRASS_DARK}" ${OUTLINE}/><circle cx="0" cy="48" r="9" fill="${BRASS_DARK}" ${OUTLINE}/><path d="M-18 -34 Q-24 -10 -20 14" fill="none" stroke="${BRASS_LIGHT}" stroke-width="6" stroke-linecap="round"/>`, 0, 0, 0.82, rot);
  let s = hang ? hook(p.ink, -66) : '';
  s += at(bellShape(-24), -34, 10) + at(bellShape(24), 34, 10);
  s += leafAt(-30, -52, 40, XGREEN, -20) + leafAt(30, -52, 40, LEAF[1], 20);
  s += `<path d="M0 -56 l-28 -18 q-8 16 2 30 z M0 -56 l28 -18 q8 16 -2 30 z" fill="${XRED}" ${OUTLINE}/><circle cx="0" cy="-56" r="9" fill="${XRED}" ${OUTLINE}/>
<path d="M-4 -50 l-10 22 M4 -50 l10 22" stroke="${XRED}" stroke-width="7" stroke-linecap="round"/>`;
  return hang ? s : at(s, 0, 10);
};

/** Holly leaves with red berries. */
const holly: Piece = (r) => {
  const hollyLeaf = (rot: number, fill: string) => {
    let d = 'M0 0';
    const pts = 4;
    for (let i = 1; i <= pts; i++) d += ` Q${n(22 - (i % 2) * 6)} ${n((-80 * (i - 0.5)) / pts)} ${n(i === pts ? 0 : 26)} ${n((-80 * i) / pts)}`;
    for (let i = pts - 1; i >= 0; i--) d += ` Q${n(-22 + ((i + 1) % 2) * 6)} ${n((-80 * (i + 0.5)) / pts)} ${n(i === 0 ? 0 : -26)} ${n((-80 * i) / pts)}`;
    return `<g transform="rotate(${rot})"><path d="${d} Z" fill="${fill}" ${OUTLINE}/><path d="M0 -4 V-74" stroke="#fff" stroke-width="3" opacity=".6"/></g>`;
  };
  let s = at(hollyLeaf(-62, XGREEN) + hollyLeaf(62, LEAF[1]) + hollyLeaf(0, LEAF[0]), 0, 40, 1.05);
  for (const [x, y] of [[-12, 40], [12, 40], [0, 58]]) s += `<circle cx="${x}" cy="${y}" r="13" fill="${XRED}" ${OUTLINE}/><circle cx="${x - 4}" cy="${y - 4}" r="3.5" fill="#fff" opacity=".7"/>`;
  return at(s, 0, -2) + (r() < 0.5 ? sparkle(70, -60, 10, '#fff') : '');
};

/** One present. */
const present: Piece = (r, p) => {
  const body = pick(r, [...p.acc, XRED]), yellow = /^#(ff[bcd]|d8b)/i.test(body);
  return gift(-70, -40, 140, 116, body, yellow ? XRED : pick(r, [CREAM, GOLD])) + sparkle(78, -70, 12, GOLD);
};

const christmasKit: Kit = {
  hero: [tree, giftStack, wreath, snowman, gingerHouse],
  small: [candyCane(false), stocking(false), xStar, bauble(false), holly, bells(false), present, snowman, tree],
  hang: [bells(true), bauble(true), starHang, stocking(true), candyCane(true)],
  colours: [XRED, XGREEN, GOLD, '#ffffff', '#7fc8f8'],
};

export const festivalKitsB: Record<string, Kit> = {
  diwali: diwaliKit,
  onam: onamKit,
  'ganesh-chaturthi': ganeshKit,
  dussehra: dussehraKit,
  'guru-nanak-jayanti': guruNanakKit,
  christmas: christmasKit,
};
