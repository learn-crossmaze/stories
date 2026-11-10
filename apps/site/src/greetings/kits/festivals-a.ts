// Symbols for Ugadi, Good Friday, Ram Navami, Mahavir Jayanti, Eid al-Fitr, Raksha Bandhan and Janmashtami,
// for the card maker (src/greetings/maker.ts). Every piece is drawn in a 200 × 200 box centred on (0, 0),
// inside −95…95. Mahavir Jayanti's hand-made designs (src/greetings/designs/festivals.ts) reuse some of them.
import type { Kit, Piece } from '../maker';
import { diya, flower, gift, heart, leaf, n, OUTLINE, sparkle, star } from '../motifs';
import { between, pick, whole } from '../palettes';
import type { Palette, Rng } from '../types';

const GREEN = '#3f9b3a', LEAF = '#5cb85c', CLAY = '#c75b2a', CLAY_DARK = '#a8461c', GOLD = '#ffc93c', CREAM = '#fff4c2';
const BRASS = '#f2b134', BRASS_LIGHT = '#ffd36b', BRASS_DARK = '#d98e1a', WOOD = '#a0612f', SAFFRON = '#ff9933';
const MARIGOLD = ['#ff8f1f', '#ffb300'];
const SKIN = ['#f1c27d', '#e0a370', '#c68642'];
/** The five colours of the Jain flag, top to bottom. */
const JAIN = ['#e53935', '#fbc02d', '#ffffff', '#43a047', '#1a237e'];

/** A soft ink outline for white and pale shapes, so they don't vanish on the pale card. */
const soft = (p: Palette, w = 5) => `stroke="${p.ink}" stroke-opacity=".18" stroke-width="${w}" stroke-linejoin="round"`;
/** Draws `body` moved to (x, y), turned and scaled (negative `sx` mirrors it). */
const g = (body: string, x = 0, y = 0, s = 1, rot = 0, sx = s) =>
  `<g transform="translate(${n(x)} ${n(y)})${rot ? ` rotate(${n(rot)})` : ''}${s !== 1 || sx !== s ? ` scale(${Math.round(sx * 1000) / 1000} ${Math.round(s * 1000) / 1000})` : ''}">${body}</g>`;
/** A colour from the palette other than `not`. */
const other = (r: Rng, p: Palette, not: string) => pick(r, p.acc.filter((c) => c !== not));
/** A point on a quadratic curve. */
const quad = (x1: number, y1: number, cx: number, cy: number, x2: number, y2: number, t: number): [number, number] => [
  (1 - t) * (1 - t) * x1 + 2 * (1 - t) * t * cx + t * t * x2,
  (1 - t) * (1 - t) * y1 + 2 * (1 - t) * t * cy + t * t * y2,
];

// ---------------------------------------------------------------- shared drawings

/** A marigold: a ruffled orange ball. White rim first, then the petals over it. */
function marigold(x: number, y: number, R: number, colour = MARIGOLD[0]) {
  let rim = '', top = '';
  for (let i = 0; i < 10; i++) {
    const a = (2 * Math.PI * i) / 10;
    const cx = n(x + Math.cos(a) * R * 0.55), cy = n(y + Math.sin(a) * R * 0.55);
    rim += `<circle cx="${cx}" cy="${cy}" r="${n(R * 0.48)}" fill="#fff"/>`;
    top += `<circle cx="${cx}" cy="${cy}" r="${n(R * 0.42)}" fill="${colour}"/>`;
  }
  return `${rim}${top}<circle cx="${n(x)}" cy="${n(y)}" r="${n(R * 0.55)}" fill="#ffb52e"/><circle cx="${n(x)}" cy="${n(y)}" r="${n(R * 0.25)}" fill="#ffd54a"/>`;
}

/** A pointed leaf hanging straight down from (x, y). */
const hangingLeaf = (x: number, y: number, len: number, fill: string, tilt = 0) =>
  `<g transform="rotate(${n(tilt)} ${n(x)} ${n(y)})"><path d="M${n(x)} ${n(y)} q${n(len * 0.36)} ${n(len * 0.45)} 0 ${n(len)} q${n(-len * 0.36)} ${n(-len * 0.55)} 0 ${n(-len)} z" fill="${fill}" ${OUTLINE}/><path d="M${n(x)} ${n(y + 4)} v${n(len * 0.8)}" stroke="#fff" stroke-width="3" opacity=".6"/></g>`;

/** Marigolds on a string hanging from the top of the box, a mango leaf at the end. */
const marigoldStrand: Piece = (r) => {
  let s = `<line x1="0" y1="-95" x2="0" y2="40" stroke="#2f8f46" stroke-width="4"/>`;
  s += hangingLeaf(0, 34, 56, GREEN, between(r, -8, 8));
  const k = r() < 0.5 ? 0 : 1;
  for (let i = 0; i < 3; i++) s += marigold(0, -70 + 42 * i, 23, MARIGOLD[(i + k) % 2]);
  return s;
};

/** A marigold with two leaves. */
const marigoldFlower: Piece = (r) =>
  leaf(0, 34, 80, GREEN, 160) + leaf(0, 34, 80, LEAF, 20) + marigold(0, -8, 68, pick(r, MARIGOLD));

/** A swag of marigolds sagging between two points, with a tassel in the middle. */
const marigoldSwag: Piece = (r) => {
  let s = `<path d="M-80 -70 Q0 70 80 -70" fill="none" stroke="#2f8f46" stroke-width="4"/>`;
  s += hangingLeaf(0, 6, 72, GREEN, between(r, -6, 6));
  for (let i = 0; i <= 8; i++) {
    const [x, y] = quad(-80, -70, 0, 70, 80, -70, i / 8);
    s += marigold(x, y, 17, MARIGOLD[i % 2]);
  }
  return s;
};

/** A lotus seen from the side; (0, 0) is the middle of its base. About 240 wide and 160 tall with its pad. */
function lotus(fill: string, pad = true) {
  const petal = (a: number, h: number, w: number, c: string) =>
    `<path d="M0 0 Q${-w} ${n(-h * 0.55)} 0 ${-h} Q${w} ${n(-h * 0.55)} 0 0 Z" fill="${c}" ${OUTLINE} transform="rotate(${a})"/>`;
  return (pad ? `<ellipse cx="0" cy="8" rx="120" ry="24" fill="${LEAF}" ${OUTLINE}/>` : '') +
    petal(-62, 78, 30, fill) + petal(62, 78, 30, fill) + petal(-32, 104, 36, fill) + petal(32, 104, 36, fill) +
    `<g opacity=".9">${petal(-14, 120, 40, '#fff')}${petal(14, 120, 40, '#fff')}</g>` + petal(0, 128, 42, fill) +
    `<path d="M0 -12 v-70" stroke="#fff" stroke-width="4" opacity=".6"/>`;
}

const lotusFlower: Piece = (r, p) => g(lotus(pick(r, p.acc)), 0, 36, 0.77);

/** A kalash: a brass pot with mango leaves and a coconut. */
const kalash: Piece = (r, p) => {
  const band = pick(r, p.acc), pot = pick(r, [BRASS, '#e0a526', '#d9822b']);
  let s = '';
  for (const [a, len] of [[-165, 80], [-138, 80], [-108, 60], [-72, 60], [-42, 80], [-15, 80]]) s += leaf(0, -30, len, Math.abs(a + 90) > 60 ? GREEN : LEAF, a);
  s += `<path d="M-28 -16 C-86 -4 -88 72 -42 84 H42 C88 72 86 -4 28 -16 Z" fill="${pot}" ${OUTLINE}/>
<path d="M-74 24 Q0 54 74 24" stroke="${band}" stroke-width="14" fill="none"/>`;
  for (let i = 0; i < 5; i++) s += `<circle cx="${-48 + 24 * i}" cy="${n(32 + Math.sin((Math.PI * i) / 4) * 7)}" r="4" fill="#fff"/>`;
  s += `<path d="M-52 4 Q-58 30 -46 52" stroke="#fff" stroke-width="7" fill="none" stroke-linecap="round" opacity=".45"/>
<ellipse cx="0" cy="86" rx="32" ry="7" fill="${BRASS_DARK}" ${OUTLINE}/>
<rect x="-24" y="-34" width="48" height="22" rx="6" fill="${pot}" ${OUTLINE}/>
<ellipse cx="0" cy="-34" rx="34" ry="9" fill="${pot}" ${OUTLINE}/>
<ellipse cx="0" cy="-56" rx="26" ry="28" fill="#8d5a3b" ${OUTLINE}/>
<path d="M-8 -82 q8 -10 16 0" stroke="#6d4c2f" stroke-width="5" fill="none" stroke-linecap="round"/>
<ellipse cx="-9" cy="-62" rx="6" ry="10" fill="#fff" opacity=".3"/>
<circle cx="0" cy="56" r="6" fill="#d62828"/>`;
  return s;
};

/** A clay diya on a little brass stand. */
const lampOnStand: Piece = () =>
  `<ellipse cx="0" cy="70" rx="72" ry="15" fill="${BRASS}" ${OUTLINE}/><ellipse cx="0" cy="66" rx="54" ry="8" fill="${BRASS_LIGHT}"/>` +
  g(diya(0, 0), 0, 58, 1.22);

/** A five-pointed sparkle on its own, for quiet corners. */
const twinkle = (x: number, y: number, s: number, fill = '#fff') => sparkle(x, y, s, fill);

/** A temple bell on its chain, hanging from the top of the box. */
const bell: Piece = () =>
  `<line x1="0" y1="-95" x2="0" y2="-52" stroke="${BRASS_DARK}" stroke-width="5" stroke-dasharray="7 4"/>
<circle cx="0" cy="-46" r="8" fill="none" stroke="${BRASS_DARK}" stroke-width="5"/>
<path d="M-12 -38 C-36 -38 -40 -6 -42 30 L-56 50 H56 L42 30 C40 -6 36 -38 12 -38 Z" fill="${BRASS}" ${OUTLINE}/>
<path d="M-24 -14 C-28 6 -28 22 -30 34" stroke="#fff" stroke-width="7" fill="none" stroke-linecap="round" opacity=".5"/>
<path d="M-38 10 H38" stroke="${BRASS_DARK}" stroke-width="5"/>
<circle cx="0" cy="72" r="11" fill="${BRASS_DARK}" ${OUTLINE}/>
<rect x="-60" y="46" width="120" height="14" rx="7" fill="${BRASS_DARK}" ${OUTLINE}/>`;

/** A raised hand, palm out, thumb on the left; white rim around the whole shape. */
function hand(fill: string, extra = '') {
  const fingers = [[-35, -64, 21], [-12, -74, 21], [12, -68, 21], [34, -50, 20]];
  const shape = (c: string, grow: number) =>
    fingers.map(([x, top, w]) => `<path d="M${x} -6 V${top}" stroke="${c}" stroke-width="${w + grow}" stroke-linecap="round"/>`).join('') +
    `<path d="M-36 40 L-72 0" stroke="${c}" stroke-width="${24 + grow}" stroke-linecap="round"/>
<rect x="${-47 - grow / 2}" y="${-26 - grow / 2}" width="${94 + grow}" height="${96 + grow}" rx="${30 + grow / 2}" fill="${c}"/>
<rect x="${-32 - grow / 2}" y="56" width="${64 + grow}" height="${30 + grow / 2}" rx="6" fill="${c}"/>`;
  return shape('#fff', 10) + shape(fill, 0) +
    `<path d="M-24 2 q10 4 20 0 M2 2 q10 4 20 0" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round" opacity=".35"/>` + extra;
}

/** A wheel with 24 spokes, as in the palm of the Jain Ahimsa hand. */
function chakra(x: number, y: number, R: number, ink: string) {
  let spokes = '';
  for (let i = 0; i < 24; i++) {
    const a = (2 * Math.PI * i) / 24;
    spokes += `M${n(x + Math.cos(a) * R * 0.2)} ${n(y + Math.sin(a) * R * 0.2)} L${n(x + Math.cos(a) * R)} ${n(y + Math.sin(a) * R)} `;
  }
  return `<circle cx="${n(x)}" cy="${n(y)}" r="${n(R + 4)}" fill="${CREAM}" stroke="#fff" stroke-width="3"/>
<circle cx="${n(x)}" cy="${n(y)}" r="${n(R)}" fill="none" stroke="${ink}" stroke-width="4"/>
<path d="${spokes.trim()}" stroke="${ink}" stroke-width="1.8"/>
<circle cx="${n(x)}" cy="${n(y)}" r="${n(R * 0.2)}" fill="${ink}"/>`;
}

/** A temple with a curved spire (shikhara) and a flag: saffron for Ram Navami, the Jain flag for Mahavir Jayanti. */
function temple(r: Rng, p: Palette, jain: boolean) {
  const stone = jain ? '#fffaf0' : pick(r, ['#ffd8a8', '#ffe0b2', '#f8c99a']);
  const edge = jain ? soft(p) : OUTLINE, trim = jain ? pick(r, [GOLD, '#e53935', p.acc[0]]) : pick(r, [SAFFRON, '#e8590c', p.acc[0]]);
  let s = `<line x1="0" y1="-60" x2="0" y2="-94" stroke="#8d6e63" stroke-width="3.5" stroke-linecap="round"/>`;
  if (jain) {
    JAIN.forEach((c, i) => (s += `<rect x="1" y="${-94 + i * 5}" width="40" height="5" fill="${c}"/>`));
    s += `<rect x="1" y="-94" width="40" height="25" fill="none" ${soft(p, 2)}/>`;
  } else s += `<path d="M1 -94 Q22 -90 44 -82 Q22 -76 1 -70 Z" fill="${SAFFRON}" stroke="#fff" stroke-width="2.5" stroke-linejoin="round"/>`;
  const spire = (cx: number, w: number, top: number, base: number) => {
    let t = `<path d="M${cx - w} ${base} C${cx - w} ${n(base - (base - top) * 0.6)} ${n(cx - w * 0.5)} ${top + 4} ${cx} ${top} C${n(cx + w * 0.5)} ${top + 4} ${cx + w} ${n(base - (base - top) * 0.6)} ${cx + w} ${base} Z" fill="${stone}" ${edge}/>`;
    for (let k = 1; k <= 3; k++) {
      const y = base - ((base - top) * k) / 4.2, half = w * (1 - (k / 4.2) ** 2.2) * 0.96;
      t += `<path d="M${n(cx - half)} ${n(y)} Q${cx} ${n(y + 6)} ${n(cx + half)} ${n(y)}" stroke="${trim}" stroke-width="3" fill="none" opacity=".7"/>`;
    }
    t += `<path d="M${cx} ${base} V${top + 8}" stroke="${trim}" stroke-width="3" opacity=".45"/>`;
    return t + `<ellipse cx="${cx}" cy="${top - 2}" rx="${n(w * 0.34)}" ry="${n(w * 0.12)}" fill="${GOLD}" stroke="#fff" stroke-width="2"/>`;
  };
  if (jain) s += spire(-54, 22, -14, 26) + spire(54, 22, -14, 26);
  s += spire(0, 44, -54, 26);
  s += `<circle cx="0" cy="-62" r="6" fill="${GOLD}" stroke="#fff" stroke-width="2"/>
<rect x="-76" y="20" width="152" height="12" rx="5" fill="${trim}" ${OUTLINE}/>
<rect x="-66" y="30" width="132" height="44" rx="3" fill="${stone}" ${edge}/>
<path d="M-15 74 V52 a15 15 0 0 1 30 0 V74 Z" fill="${jain ? '#c58b2c' : WOOD}" stroke="#fff" stroke-width="3"/>
<path d="M-50 70 V48 a8 8 0 0 1 16 0 V70 Z M34 70 V48 a8 8 0 0 1 16 0 V70 Z" fill="${trim}" opacity=".55"/>
<rect x="-84" y="72" width="168" height="10" rx="4" fill="${stone}" ${edge}/>
<rect x="-92" y="81" width="184" height="10" rx="4" fill="${stone}" ${edge}/>`;
  for (let i = 0; i < 7; i++) s += `<circle cx="${-60 + 20 * i}" cy="26" r="2.6" fill="#fff"/>`;
  return s;
}

/** A decorated cradle hanging from a wooden frame, with marigolds; Janmashtami's has a peacock feather. */
function cradle(r: Rng, p: Palette, feather: boolean) {
  const body = pick(r, p.acc), trim = other(r, p, body);
  let s = `<rect x="-88" y="-76" width="14" height="160" rx="6" fill="${WOOD}" ${OUTLINE}/><rect x="74" y="-76" width="14" height="160" rx="6" fill="${WOOD}" ${OUTLINE}/>
<rect x="-94" y="80" width="32" height="10" rx="4" fill="${WOOD}" ${OUTLINE}/><rect x="62" y="80" width="32" height="10" rx="4" fill="${WOOD}" ${OUTLINE}/>
<rect x="-92" y="-86" width="184" height="16" rx="7" fill="${WOOD}" ${OUTLINE}/>
<circle cx="-81" cy="-78" r="7" fill="${GOLD}"/><circle cx="81" cy="-78" r="7" fill="${GOLD}"/>
<path d="M-40 -70 L-62 6 M40 -70 L62 6" stroke="${GOLD}" stroke-width="4" stroke-dasharray="7 4"/>`;
  for (let i = 0; i <= 6; i++) {
    const [x, y] = quad(-66, -64, 0, -40, 66, -64, i / 6);
    s += marigold(x, y, 9, MARIGOLD[i % 2]);
  }
  if (feather) s += peacockFeather(22, 22, 0.17, 24);
  s += `<path d="M-74 6 Q0 18 74 6 Q68 66 0 70 Q-68 66 -74 6 Z" fill="${body}" ${OUTLINE}/>
<path d="M-66 28 Q0 46 66 28" stroke="${trim}" stroke-width="9" fill="none" stroke-linecap="round"/>
<path d="M-78 4 Q0 -6 78 4" stroke="${GOLD}" stroke-width="8" fill="none" stroke-linecap="round"/>`;
  for (let i = 0; i < 6; i++) s += `<circle cx="${-45 + 18 * i}" cy="${n(52 + 4 * Math.sin((Math.PI * i) / 5))}" r="3.5" fill="#fff"/>`;
  s += marigold(-64, 8, 12, MARIGOLD[1]) + marigold(64, 8, 12, MARIGOLD[1]);
  return s;
}

/** A peacock feather; (x, y) is the bottom of the quill, standing up, tilted by `tilt` degrees. 480·s tall. */
function peacockFeather(x: number, y: number, s: number, tilt: number) {
  const P = (dx: number, dy: number) => `${n(x + dx * s)} ${n(y + dy * s)}`;
  return `<g transform="rotate(${n(tilt)} ${n(x)} ${n(y)})">
<path d="M${P(0, 0)} L${P(0, -420)}" stroke="#8d6e63" stroke-width="${n(Math.max(8 * s, 2.5))}" stroke-linecap="round"/>
<path d="M${P(0, -40)} q${n(-40 * s)} ${n(-40 * s)} ${n(-60 * s)} ${n(-90 * s)} M${P(0, -40)} q${n(40 * s)} ${n(-40 * s)} ${n(60 * s)} ${n(-90 * s)} M${P(0, -80)} q${n(-50 * s)} ${n(-30 * s)} ${n(-80 * s)} ${n(-90 * s)} M${P(0, -80)} q${n(50 * s)} ${n(-30 * s)} ${n(80 * s)} ${n(-90 * s)}" fill="none" stroke="#3fae5a" stroke-width="${n(Math.max(6 * s, 2))}" stroke-linecap="round"/>
<path d="M${P(0, -110)} C${P(120, -200)} ${P(130, -420)} ${P(0, -480)} C${P(-130, -420)} ${P(-120, -200)} ${P(0, -110)} Z" fill="#3fae5a" stroke="#fff" stroke-width="${n(Math.max(12 * s, 3))}" stroke-linejoin="round"/>
<ellipse cx="${n(x)}" cy="${n(y - 360 * s)}" rx="${n(64 * s)}" ry="${n(80 * s)}" fill="#e8b33a"/>
<ellipse cx="${n(x)}" cy="${n(y - 356 * s)}" rx="${n(46 * s)}" ry="${n(60 * s)}" fill="#18a6a0"/>
<path d="M${P(0, -312)} C${P(-40, -340)} ${P(-30, -390)} ${P(0, -384)} C${P(30, -390)} ${P(40, -340)} ${P(0, -312)} Z" fill="#1a3c8f"/></g>`;
}

/** A crescent moon opening to the right, made of two circles; (0, 0) is the middle of the outer circle. */
function crescent(R: number, fill: string, edge = OUTLINE) {
  const R2 = R * 0.84, d = R * 0.46;
  const x = (d * d + R * R - R2 * R2) / (2 * d), y = Math.sqrt(R * R - x * x);
  return `<path d="M${n(x)} ${n(-y)} A${n(R)} ${n(R)} 0 1 0 ${n(x)} ${n(y)} A${n(R2)} ${n(R2)} 0 ${x > d ? 1 : 0} 1 ${n(x)} ${n(-y)} Z" fill="${fill}" ${edge}/>`;
}

/** Round sweets (laddoos) heaped in rows; (x, y) is the middle of the bottom row. */
function laddoos(x: number, y: number, R: number, rows: number, fill = '#ffa62b') {
  let s = '';
  for (let k = 0; k < rows; k++)
    for (let i = 0; i < rows - k; i++) {
      const cx = x + (i - (rows - k - 1) / 2) * R * 1.9, cy = y - k * R * 1.6;
      s += `<circle cx="${n(cx)}" cy="${n(cy)}" r="${R}" fill="${fill}" ${OUTLINE}/><circle cx="${n(cx - R * 0.35)}" cy="${n(cy - R * 0.35)}" r="${n(R * 0.2)}" fill="#fff4c2"/>`;
    }
  return s;
}

/** A brass plate seen from the front at an angle; (0, y) is its middle. */
const plate = (y: number, rx = 92, ry = 30) =>
  `<ellipse cx="0" cy="${y}" rx="${rx}" ry="${ry}" fill="${BRASS}" ${OUTLINE}/><ellipse cx="0" cy="${y - 4}" rx="${rx - 14}" ry="${ry - 9}" fill="${BRASS_LIGHT}"/>`;

// ---------------------------------------------------------------- Ugadi

/** A raw green mango with a leaf; (0, 0) is its stalk. */
const mangoBody = (fill = '#8bc34a', blush = '#cddc39') =>
  `<path d="M0 0 C46 -6 66 50 44 92 C26 124 -26 126 -44 92 C-60 58 -42 4 0 0 Z" fill="${fill}" ${OUTLINE}/>
<ellipse cx="22" cy="34" rx="14" ry="24" fill="${blush}" opacity=".7"/>
<path d="M0 0 v-14" stroke="#6d4c2f" stroke-width="6" stroke-linecap="round"/>${leaf(0, -12, 64, GREEN, -30)}`;

const mango: Piece = (r) => g(mangoBody(pick(r, ['#8bc34a', '#9ccc65', '#7cb342'])), -4, -36, 1, between(r, -10, 10));

const mangoes: Piece = (r) =>
  g(mangoBody('#9ccc65'), -40, -40, 0.86, -14) + g(mangoBody(pick(r, ['#8bc34a', '#7cb342'])), 42, -30, 0.86, 12, -0.86);

/** A neem sprig with clusters of tiny white flowers; (0, 0) is the cut end, it grows up. */
function neem(r: Rng, p: Palette, h: number) {
  let s = `<path d="M0 0 Q14 ${n(-h * 0.5)} 0 ${-h}" stroke="#6d8b3a" stroke-width="9" fill="none" stroke-linecap="round"/>`;
  for (let i = 1; i <= 4; i++) {
    const y = -h * (i / 5);
    s += leaf(6, y, 58, i % 2 ? GREEN : LEAF, -20) + leaf(6, y, 58, i % 2 ? LEAF : GREEN, -160);
  }
  for (let i = 0; i < 10; i++)
    s += `<circle cx="${n(between(r, -34, 34))}" cy="${n(-h - between(r, -10, 40))}" r="10" fill="#fff" ${soft(p, 4)}/>`;
  return s;
}

const neemSprig: Piece = (r, p) => g(neem(r, p, 118), 0, 86);

/** Bevu-bella: neem flowers and jaggery on a brass plate, with a bowl of Ugadi pachadi. */
const bevuBella: Piece = (r, p) => {
  let s = plate(52, 92, 30);
  // the neem sprig at the back
  s += g(neem(r, p, 64), 40, 34, 0.74, 10);
  // jaggery lumps
  for (const [x, y, w, h] of [[-86, 22, 34, 28], [-54, 26, 32, 26], [-74, -2, 32, 26]]) s += `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" fill="#b8742a" ${OUTLINE}/><path d="M${x + 6} ${y + 7} h${w - 14}" stroke="#d99a4e" stroke-width="4" stroke-linecap="round"/>`;
  // the bowl of pachadi
  const bowl = pick(r, p.acc);
  s += `<path d="M-30 18 Q-28 58 0 60 Q28 58 30 18 Z" fill="${bowl}" ${OUTLINE}/><ellipse cx="0" cy="18" rx="30" ry="9" fill="#e3a94f" ${OUTLINE}/>`;
  for (let i = 0; i < 5; i++) s += `<circle cx="${n(between(r, -20, 20))}" cy="${n(18 + between(r, -3, 3))}" r="3.5" fill="${pick(r, ['#9ccc65', '#fff', '#6d4c2f'])}"/>`;
  return g(s, 0, -4);
};

/** A kolam: a diamond with a flower in the middle and dots. */
const kolam: Piece = (r, p) => {
  const petals = pick(r, [6, 8]), rot = r() * Math.PI;
  let s = `<path d="M0 -90 L90 0 L0 90 L-90 0 Z" fill="none" stroke="${p.acc[0]}" stroke-width="7" stroke-linejoin="round"/>
<path d="M0 -62 L62 0 L0 62 L-62 0 Z" fill="none" stroke="${p.acc[2]}" stroke-width="4" stroke-dasharray="2 9" stroke-linecap="round"/>`;
  s += flower(0, 0, petals, 54, 26, [p.acc[1], p.acc[3]], GOLD, rot, 14);
  s += flower(0, 0, petals, 30, 16, [p.acc[2], p.acc[4]], p.head[1], rot + Math.PI / petals, 8);
  for (let i = 0; i < 4; i++) {
    const a = (Math.PI / 2) * i;
    s += `<circle cx="${n(Math.cos(a) * 74)}" cy="${n(Math.sin(a) * 74)}" r="8" fill="${pick(r, p.acc)}" ${OUTLINE}/>`;
    const b = a + Math.PI / 4;
    s += `<circle cx="${n(Math.cos(b) * 38)}" cy="${n(Math.sin(b) * 38)}" r="5" fill="${p.ink}" opacity=".45"/>`;
  }
  return s;
};

/** A short toran: marigolds on a string with mango leaves hanging between. */
const toran: Piece = (r) => {
  let s = `<path d="M-90 -64 Q0 -30 90 -64" fill="none" stroke="#8d5a3b" stroke-width="5"/>`;
  for (const t of [0.25, 0.5, 0.75]) {
    const [x, y] = quad(-90, -64, 0, -30, 90, -64, t);
    s += hangingLeaf(x, y, between(r, 104, 124), t === 0.5 ? LEAF : GREEN, between(r, -6, 6));
  }
  for (const t of [0.04, 0.375, 0.625, 0.96]) {
    const [x, y] = quad(-90, -64, 0, -30, 90, -64, t);
    s += marigold(x * 0.96, y, 18, MARIGOLD[Math.round(t * 8) % 2]);
  }
  return s;
};

/** A mango leaf of a toran hanging from a marigold. */
const toranLeaf: Piece = (r) => {
  let s = `<line x1="0" y1="-95" x2="0" y2="-80" stroke="#8d5a3b" stroke-width="4"/>`;
  s += hangingLeaf(0, -62, 148, pick(r, [GREEN, LEAF]), between(r, -5, 5));
  return s + marigold(0, -72, 20, pick(r, MARIGOLD));
};

/** A festive meal on a banana leaf. */
const bananaLeaf: Piece = (r, p) => {
  let s = `<path d="M-92 22 Q-70 -44 30 -46 Q84 -46 92 -18 Q86 34 10 46 Q-70 56 -92 22 Z" fill="${LEAF}" ${OUTLINE}/>
<path d="M-88 22 Q0 0 90 -18" stroke="${GREEN}" stroke-width="4" fill="none"/>`;
  for (let i = 0; i < 6; i++) {
    const [x, y] = quad(-88, 22, 0, 0, 90, -18, 0.12 + i * 0.15);
    s += `<path d="M${n(x)} ${n(y)} l${i % 2 ? 14 : -10} -34 M${n(x)} ${n(y)} l${i % 2 ? -10 : 14} 34" stroke="${GREEN}" stroke-width="2.5" opacity=".6"/>`;
  }
  s += `<ellipse cx="-6" cy="4" rx="32" ry="18" fill="#fffaf0" ${soft(p, 4)}/><ellipse cx="-2" cy="-4" rx="14" ry="7" fill="#f7c948"/>
<circle cx="46" cy="-12" r="18" fill="#f0b030" ${OUTLINE}/><circle cx="46" cy="-12" r="9" fill="#e09a20" opacity=".6"/>
<circle cx="-56" cy="-6" r="13" fill="#e8c48a" ${OUTLINE}/><circle cx="-54" cy="20" r="7" fill="#d9480f"/><circle cx="-38" cy="28" r="6" fill="#8bc34a"/>
<circle cx="48" cy="24" r="15" fill="#fff1d0" ${soft(p, 3)}/>`;
  return g(s, 0, 0, 1, between(r, -6, 6));
};

const ugadiKit: Kit = {
  hero: [kalash, bevuBella, kolam, mangoes],
  small: [mango, neemSprig, marigoldFlower, toran, kalash, bananaLeaf, kolam],
  hang: [toranLeaf, marigoldStrand],
  colours: ['#ff8f1f', '#ffb300', '#3f9b3a', '#8bc34a', '#e8382a'],
};

// ---------------------------------------------------------------- Good Friday (quiet palette)

const OLIVE = ['#7f9a5a', '#95ad6e'];

/** A white lily on its stem; (0, 0) is the foot of the stem, h its height. About h + 90 tall. */
function lily(p: Palette, h: number, lean = 1) {
  const top = -h, petal = (a: number, len: number) =>
    `<path d="M0 0 Q-22 ${-len * 0.5} 0 ${-len} Q22 ${-len * 0.5} 0 0 Z" fill="#fff" ${soft(p, 4)} transform="translate(${n(lean * 8)} ${top}) rotate(${a})"/>`;
  return `<path d="M0 0 Q${n(-lean * 20)} ${n(-h * 0.5)} ${n(lean * 8)} ${top}" stroke="${OLIVE[0]}" stroke-width="7" fill="none" stroke-linecap="round"/>
<path d="M0 0 Q${n(-lean * 60)} ${n(-h * 0.35)} ${n(-lean * 44)} ${n(-h * 0.62)} Q${n(-lean * 20)} ${n(-h * 0.3)} 0 0 Z" fill="${OLIVE[1]}" ${OUTLINE}/>
${petal(-58, 70)}${petal(58, 70)}${petal(-24, 84)}${petal(24, 84)}${petal(0, 90)}
<path d="M${n(lean * 8)} ${top} l-10 -46 M${n(lean * 8)} ${top} l0 -52 M${n(lean * 8)} ${top} l10 -46" stroke="#e8d9a8" stroke-width="4" stroke-linecap="round"/>
<circle cx="${n(lean * 8 - 10)}" cy="${top - 48}" r="6" fill="#d9b860"/><circle cx="${n(lean * 8)}" cy="${top - 54}" r="6" fill="#d9b860"/><circle cx="${n(lean * 8 + 10)}" cy="${top - 48}" r="6" fill="#d9b860"/>`;
}

const oneLily: Piece = (_r, p) => g(lily(p, 84, 1), 4, 88);

const lilyPair: Piece = (_r, p) => g(g(lily(p, 120, 1), 0, 0, 1, -14) + g(lily(p, 96, -1), 0, 0, 1, 18), 0, 90, 0.82);

/** Three lilies tied with a ribbon. */
const lilies: Piece = (r, p) => {
  const ribbon = pick(r, [p.acc[0], p.acc[2]]);
  const body = g(lily(p, 108, 1), 0, 0, 1, -26) + g(lily(p, 108, -1), 0, 0, 1, 26) + lily(p, 140, 1) +
    `<path d="M-14 -30 q14 8 28 0" stroke="${ribbon}" stroke-width="10" stroke-linecap="round" fill="none"/>
<path d="M0 -26 l-26 -16 v26 z M0 -26 l26 -16 v26 z" fill="${ribbon}" ${OUTLINE}/><path d="M-4 -24 l-12 40 M4 -24 l12 40" stroke="${ribbon}" stroke-width="6" stroke-linecap="round"/>`;
  return g(body, 0, 80, 0.76);
};

/** A plain wooden cross on a gentle hill, soft light behind it. */
const hillCross: Piece = (_r, p) => {
  const glow = p.acc[1], wood = '#a58b73';
  let s = `<circle cx="0" cy="-20" r="74" fill="${glow}" opacity=".35"/><circle cx="0" cy="-20" r="50" fill="${glow}" opacity=".6"/>`;
  for (let i = 0; i < 12; i++) {
    const a = (2 * Math.PI * i) / 12 - Math.PI / 2;
    if (Math.sin(a) > 0.5) continue;
    s += `<line x1="${n(Math.cos(a) * 62)}" y1="${n(-20 + Math.sin(a) * 62)}" x2="${n(Math.cos(a) * 84)}" y2="${n(-20 + Math.sin(a) * 84)}" stroke="${glow}" stroke-width="6" stroke-linecap="round"/>`;
  }
  const cross = (c: string, grow: number) =>
    `<rect x="${-10 - grow}" y="${-76 - grow}" width="${20 + 2 * grow}" height="${130 + 2 * grow}" rx="4" fill="${c}"/><rect x="${-44 - grow}" y="${-48 - grow}" width="${88 + 2 * grow}" height="${18 + 2 * grow}" rx="4" fill="${c}"/>`;
  s += cross('#fff', 3) + cross(wood, 0) + `<path d="M-4 -66 v30 M-4 -20 v40" stroke="#fff" stroke-width="2.5" opacity=".35"/>`;
  s += `<path d="M-94 92 Q-50 34 0 40 Q50 42 94 92 Z" fill="${p.acc[4]}" ${OUTLINE}/>`;
  s += flower(-44, 66, 5, 14, 9, ['#fff'], p.acc[1], 0, 4) + flower(52, 72, 5, 14, 9, ['#fff'], p.acc[1], 1, 4);
  return s;
};

/** A candle on a dish; `h` the candle's height. The flame's tip is at y = 80 − h − 68. */
function candleBody(p: Palette, h: number, x = 0, w = 48) {
  const top = 80 - h;
  return `<rect x="${n(x - w / 2)}" y="${top}" width="${w}" height="${h}" rx="8" fill="#fffaf0" ${soft(p)}/>
<path d="M${n(x - w / 2 + 2)} ${top + 10} q8 14 14 0 v18" fill="none" stroke="${p.ink}" stroke-opacity=".1" stroke-width="4"/>
<path d="M${x} ${top} v-10" stroke="${p.ink}" stroke-width="3" opacity=".6"/>
<path d="M${x} ${top - 68} q${n(w * 0.42)} 32 0 58 q${n(-w * 0.42)} -26 0 -58 z" fill="#ffb300" opacity=".9"/><path d="M${x} ${top - 46} q8 14 0 30 q-8 -14 0 -30 z" fill="${CREAM}"/>`;
}

const candle: Piece = (_r, p) =>
  `<circle cx="0" cy="-52" r="44" fill="${p.acc[1]}" opacity=".35"/><circle cx="0" cy="-52" r="28" fill="${p.acc[1]}" opacity=".5"/>
<ellipse cx="0" cy="82" rx="60" ry="12" fill="${p.acc[3]}" ${OUTLINE}/>` + candleBody(p, 96);

const candles: Piece = (r, p) => {
  const hs = [between(r, 60, 76), between(r, 96, 108), between(r, 44, 56)];
  return `<ellipse cx="0" cy="84" rx="92" ry="12" fill="${p.acc[3]}" ${OUTLINE}/>` +
    candleBody(p, hs[0], -52, 34) + candleBody(p, hs[1], 2, 40) + candleBody(p, hs[2], 56, 34);
};

/** A white dove flying right, an olive sprig in its beak; (0, 0) is its middle. */
const doveBody = (p: Palette, sprig = true) =>
  `<path d="M-58 -2 L-120 -34 L-112 6 L-122 30 Z" fill="#fff" ${soft(p)}/>
<ellipse cx="0" cy="0" rx="74" ry="36" fill="#fff" ${soft(p)}/>
<circle cx="62" cy="-26" r="27" fill="#fff" ${soft(p)}/>
<path d="M86 -30 l22 8 l-22 6 z" fill="#ff9f43"/>
<circle cx="70" cy="-32" r="4.5" fill="${p.ink}"/>
<path d="M-30 -10 Q-40 -110 30 -112 Q8 -60 30 -12 Z" fill="#fff" ${soft(p)}/>
<path d="M-12 -30 Q-8 -70 14 -88 M2 -24 Q8 -56 22 -70" stroke="${p.ink}" stroke-opacity=".14" stroke-width="4" fill="none" stroke-linecap="round"/>` +
  (sprig ? `<path d="M104 -18 q14 18 6 42" stroke="${OLIVE[0]}" stroke-width="4" fill="none"/>${leaf(108, -6, 26, OLIVE[1], 30)}${leaf(110, 12, 24, OLIVE[0], -20)}` : '');

const dove: Piece = (_r, p) => g(doveBody(p), 2, 36, 0.72);

/** An olive branch with a few olives. */
const olive: Piece = (r) => {
  let s = `<path d="M-78 76 Q-6 30 76 -74" stroke="#8a6f4d" stroke-width="6" fill="none" stroke-linecap="round"/>`;
  for (let i = 0; i < 7; i++) {
    const t = 0.12 + i * 0.13, [x, y] = quad(-78, 76, -6, 30, 76, -74, t);
    const dir = (Math.atan2(-74 - 76, 76 + 78) * 180) / Math.PI - (1 - t) * 18;
    s += leaf(x, y, between(r, 40, 50), OLIVE[i % 2], dir + (i % 2 ? 42 : -42));
  }
  for (const t of [0.3, 0.58]) {
    const [x, y] = quad(-78, 76, -6, 30, 76, -74, t);
    s += `<ellipse cx="${n(x + 12)}" cy="${n(y + 14)}" rx="8" ry="11" fill="#5b6b3a" stroke="#fff" stroke-width="3"/>`;
  }
  return s;
};

/** Soft rays of morning light. */
const rays: Piece = (_r, p) => {
  let s = `<circle cx="0" cy="0" r="52" fill="${p.acc[1]}" opacity=".45"/><circle cx="0" cy="0" r="36" fill="${p.acc[1]}" ${OUTLINE}/><circle cx="-10" cy="-10" r="12" fill="#fff" opacity=".5"/>`;
  for (let i = 0; i < 16; i++) {
    const a = (2 * Math.PI * i) / 16, len = i % 2 ? 76 : 90;
    s += `<line x1="${n(Math.cos(a) * 58)}" y1="${n(Math.sin(a) * 58)}" x2="${n(Math.cos(a) * len)}" y2="${n(Math.sin(a) * len)}" stroke="${p.acc[1]}" stroke-width="${i % 2 ? 5 : 7}" stroke-linecap="round" opacity=".85"/>`;
  }
  return s;
};

const goodFridayKit: Kit = {
  hero: [hillCross, lilies, candle, dove],
  small: [oneLily, lilyPair, candle, candles, dove, olive, rays],
  quiet: true,
};

// ---------------------------------------------------------------- Ram Navami

/** A drawn bow with an arrow, decorated with gold. */
const bow: Piece = (r, p) => {
  const fletch = pick(r, p.acc), wrap = other(r, p, fletch);
  const curve = 'M-34 -84 C36 -76 62 -30 62 0 C62 30 36 76 -34 84';
  const body = `<path d="M-34 -84 L-66 0 L-34 84" stroke="${p.ink}" stroke-width="3" fill="none" opacity=".55"/>
<path d="${curve}" fill="none" stroke="#fff" stroke-width="22" stroke-linecap="round"/>
<path d="${curve}" fill="none" stroke="#a0522d" stroke-width="13" stroke-linecap="round"/>
<path d="M-26 -78 C30 -66 50 -30 52 -10" fill="none" stroke="#fff" stroke-width="3" opacity=".4"/>
<rect x="52" y="-16" width="20" height="32" rx="6" fill="${wrap}" ${OUTLINE}/>
<circle cx="-34" cy="-84" r="8" fill="${GOLD}" stroke="#fff" stroke-width="3"/><circle cx="-34" cy="84" r="8" fill="${GOLD}" stroke="#fff" stroke-width="3"/>
<path d="M-66 0 H74" stroke="#fff" stroke-width="11" stroke-linecap="round"/><path d="M-66 0 H74" stroke="#8d5a3b" stroke-width="6" stroke-linecap="round"/>
<path d="M94 0 l-26 -14 v28 z" fill="${GOLD}" ${OUTLINE}/>
<path d="M-50 0 l-12 -14 h-20 l10 14 l-10 14 h20 z" fill="${fletch}" ${OUTLINE}/>`;
  return g(body, 2, 0, 0.98, between(r, -38, -26));
};

const ramCradle: Piece = (r, p) => cradle(r, p, false);

const ramTemple: Piece = (r, p) => temple(r, p, false);

/** A plain saffron pennant on its pole. */
const pennant: Piece = (r) =>
  `<line x1="-50" y1="-80" x2="-50" y2="92" stroke="#8d6e63" stroke-width="8" stroke-linecap="round"/><circle cx="-50" cy="-84" r="8" fill="${GOLD}" stroke="#fff" stroke-width="3"/>
<path d="M-46 -76 Q14 ${n(between(r, -74, -60))} 86 -40 Q18 ${n(between(r, -26, -16))} -46 -4 Z" fill="${SAFFRON}" ${OUTLINE}/>
<path d="M-40 -66 Q6 -58 52 -44" stroke="#fff" stroke-width="4" fill="none" opacity=".35" stroke-linecap="round"/>`;

/** A saffron pennant hanging from a string. */
const pennantHang: Piece = (r) =>
  `<line x1="0" y1="-95" x2="0" y2="-84" stroke="#8d6e63" stroke-width="4"/>
<path d="M-50 -86 H50 L${n(between(r, -6, 6))} 66 Z" fill="${pick(r, [SAFFRON, '#ff8a1f'])}" ${OUTLINE}/>
<path d="M-36 -74 H30" stroke="#fff" stroke-width="5" opacity=".4" stroke-linecap="round"/>
<circle cx="0" cy="76" r="9" fill="${GOLD}" ${OUTLINE}/>`;

/** Panakam: a brass pot of the jaggery drink and a tumbler. */
const panakam: Piece = (r, p) => {
  const band = pick(r, p.acc);
  return `<circle cx="-24" cy="30" r="54" fill="${BRASS}" ${OUTLINE}/>
<path d="M-74 28 Q-24 50 26 28" stroke="${band}" stroke-width="11" fill="none"/>
<path d="M-62 4 Q-66 24 -58 42" stroke="#fff" stroke-width="6" fill="none" stroke-linecap="round" opacity=".45"/>
<rect x="-50" y="-32" width="52" height="24" rx="6" fill="${BRASS}" ${OUTLINE}/>
<ellipse cx="-24" cy="-32" rx="36" ry="10" fill="${BRASS_DARK}" ${OUTLINE}/><ellipse cx="-24" cy="-31" rx="26" ry="5" fill="#b8742a"/>
<path d="M38 -2 H86 L78 84 H46 Z" fill="#dfe5ec" ${soft(p)}/>
<ellipse cx="62" cy="-2" rx="24" ry="6" fill="#c9852f"/>
<path d="M44 20 H80" stroke="#fff" stroke-width="5" opacity=".7"/>
<circle cx="84" cy="-10" r="11" fill="#f7e463" stroke="#fff" stroke-width="3"/><path d="M84 -18 v16 M76 -10 h16" stroke="#e0c94a" stroke-width="2"/>
${leaf(-6, -40, 40, GREEN, -60)}${leaf(-6, -40, 34, LEAF, -120)}`;
};

const ramNavamiKit: Kit = {
  hero: [bow, ramCradle, ramTemple],
  small: [pennant, lotusFlower, marigoldFlower, marigoldSwag, panakam, bow, kalash],
  hang: [pennantHang, bell, marigoldStrand],
  colours: [SAFFRON, '#ffc93c', '#e8590c', '#3f9b3a', '#ffb300'],
};

// ---------------------------------------------------------------- Mahavir Jayanti

/** The Ahimsa hand: a raised open palm with a wheel in it. */
const ahimsaHand: Piece = (r, p) => hand(pick(r, [SAFFRON, '#f4a62a', '#ffa726']), chakra(0, 26, 27, p.ink));

const jainTemple: Piece = (r, p) => temple(r, p, true);

/** The Jain flag: five stripes (red, yellow, white, green, dark blue) on a pole. */
const jainFlag: Piece = (r, p) => {
  const x = -64, w = 150, band = 22, top = -80, sag = between(r, 8, 12);
  const wave = (y: number) => `M${x} ${y} q${n(w / 4)} ${-sag} ${n(w / 2)} 0 t${n(w / 2)} 0`;
  const stripe = (y: number, h: number) => `${wave(y)} v${h} q${n(-w / 4)} ${-sag} ${n(-w / 2)} 0 t${n(-w / 2)} 0 z`;
  let s = `<path d="${stripe(top, band * 5)}" fill="#fff" stroke="#fff" stroke-width="9" stroke-linejoin="round"/>`;
  JAIN.forEach((c, i) => (s += `<path d="${stripe(top + band * i, band + 0.6)}" fill="${c}"/>`));
  s += `<path d="${stripe(top, band * 5)}" fill="none" ${soft(p, 2)}/>`;
  return `<line x1="${x - 4}" y1="-82" x2="${x - 4}" y2="92" stroke="#8d6e63" stroke-width="8" stroke-linecap="round"/><circle cx="${x - 4}" cy="-86" r="7" fill="${GOLD}" stroke="#fff" stroke-width="3"/>` + s;
};

/** A small Jain flag hanging from a string. */
const jainPennant: Piece = (_r, p) => {
  let s = `<line x1="0" y1="-95" x2="0" y2="-86" stroke="#8d6e63" stroke-width="4"/><rect x="-52" y="-88" width="104" height="130" rx="4" fill="#fff" stroke="#fff" stroke-width="8"/>`;
  JAIN.forEach((c, i) => (s += `<rect x="-52" y="${-88 + 26 * i}" width="104" height="26.4" fill="${c}"/>`));
  s += `<rect x="-52" y="-88" width="104" height="130" fill="none" ${soft(p, 2)}/>`;
  for (const x of [-46, 0, 46]) s += `<path d="M${x} 42 v22" stroke="${GOLD}" stroke-width="4"/><circle cx="${x}" cy="68" r="7" fill="${GOLD}" stroke="#fff" stroke-width="2.5"/>`;
  return s;
};

/** A procession chariot (rath) with a lotus inside and the Jain flag on top. */
const rath: Piece = (r, p) => {
  const body = pick(r, p.acc), roof = other(r, p, body);
  let s = `<line x1="0" y1="-66" x2="0" y2="-94" stroke="#8d6e63" stroke-width="3" stroke-linecap="round"/>`;
  JAIN.forEach((c, i) => (s += `<rect x="1" y="${-94 + i * 4.4}" width="32" height="4.4" fill="${c}"/>`));
  s += `<rect x="1" y="-94" width="32" height="22" fill="none" ${soft(p, 2)}/>`;
  s += `<rect x="-66" y="-36" width="11" height="58" rx="3" fill="${GOLD}" ${OUTLINE}/><rect x="55" y="-36" width="11" height="58" rx="3" fill="${GOLD}" ${OUTLINE}/>`;
  s += g(lotus(pick(r, p.acc), false), 0, 18, 0.3);
  s += `<path d="M-82 -30 Q-74 -60 0 -70 Q74 -60 82 -30 Z" fill="${roof}" ${OUTLINE}/>`;
  for (let i = 0; i < 8; i++) s += `<path d="M${-80 + 20 * i} -30 a10 9 0 0 0 20 0 Z" fill="${body}" stroke="#fff" stroke-width="3"/>`;
  for (let i = 0; i <= 4; i++) {
    const [x, y] = quad(-56, -14, 0, 8, 56, -14, i / 4);
    s += marigold(x, y, 7, MARIGOLD[i % 2]);
  }
  s += `<rect x="-84" y="20" width="168" height="26" rx="7" fill="${body}" ${OUTLINE}/>`;
  for (let i = 0; i < 8; i++) s += `<circle cx="${-66 + 19 * i}" cy="33" r="4" fill="#fff" opacity=".85"/>`;
  for (const x of [-50, 50]) {
    s += `<circle cx="${x}" cy="62" r="28" fill="${WOOD}" ${OUTLINE}/><circle cx="${x}" cy="62" r="19" fill="none" stroke="#d9a35b" stroke-width="3"/>`;
    for (let k = 0; k < 8; k++) {
      const a = (Math.PI * k) / 4;
      s += `<line x1="${x}" y1="62" x2="${n(x + Math.cos(a) * 19)}" y2="${n(62 + Math.sin(a) * 19)}" stroke="#d9a35b" stroke-width="3"/>`;
    }
    s += `<circle cx="${x}" cy="62" r="6" fill="${GOLD}"/>`;
  }
  return s;
};

/** An aarti plate: a lamp, flowers, rice and kumkum on a brass plate. */
const aartiPlate: Piece = (r, p) => {
  let s = plate(48, 92, 30);
  for (let i = 0; i < 20; i++) {
    const a = (2 * Math.PI * i) / 20;
    s += `<circle cx="${n(Math.cos(a) * 85)}" cy="${n(48 + Math.sin(a) * 26)}" r="3" fill="${BRASS_DARK}"/>`;
  }
  s += `<ellipse cx="-52" cy="44" rx="20" ry="9" fill="#fffaf0" ${soft(p, 3)}/>`;
  for (let i = 0; i < 5; i++) s += `<circle cx="${n(-52 + between(r, -12, 12))}" cy="${n(42 + between(r, -3, 3))}" r="2.5" fill="${p.ink}" opacity=".2"/>`;
  s += `<path d="M38 34 Q40 56 56 56 Q72 56 74 34 Z" fill="${BRASS_DARK}" ${OUTLINE}/><ellipse cx="56" cy="34" rx="18" ry="6" fill="#d62828"/>`;
  s += g(diya(0, 0), 0, 44, 0.95);
  s += flower(-26, 62, 6, 20, 12, [pick(r, p.acc)], GOLD, r(), 5) + flower(26, 64, 6, 20, 12, [pick(r, p.acc)], GOLD, r(), 5);
  return g(s, 0, 4);
};

const mahavirKit: Kit = {
  calm: true,
  hero: [ahimsaHand, jainTemple, jainFlag, rath],
  small: [lotusFlower, lampOnStand, kalash, aartiPlate, jainFlag, ahimsaHand, jainTemple],
  hang: [jainPennant, bell, marigoldStrand],
  colours: ['#ffc93c', '#ff9f1c', '#e53935', '#43a047', '#fbc02d'],
};

/** Mahavir Jayanti's pieces, for its hand-made designs. */
export const jainPieces = { ahimsaHand, jainTemple, jainFlag, jainPennant, rath, aartiPlate, lamp: lampOnStand, kalash, lotus: lotusFlower, bell };

// ---------------------------------------------------------------- Eid al-Fitr

/** A crescent moon with a star. */
const moonStar: Piece = (r) =>
  g(crescent(82, GOLD), -4, 0, 1, between(r, -30, -12)) + star(42, -12, 28, GOLD, between(r, -0.2, 0.2)) +
  twinkle(62, -70, 12) + twinkle(-70, 70, 9, '#fff');

/** A mosque: a dome between two minarets. */
const mosque: Piece = (r, p) => {
  const wall = pick(r, p.acc), dome = other(r, p, wall);
  let s = '';
  for (const side of [-1, 1]) {
    const x = side * 76;
    s += `<rect x="${x - 9}" y="-44" width="18" height="132" rx="4" fill="${wall}" ${OUTLINE}/>
<rect x="${x - 14}" y="-8" width="28" height="9" rx="4" fill="${dome}" ${OUTLINE}/>
<path d="M${x - 11} -44 Q${x} -78 ${x + 11} -44 Z" fill="${dome}" ${OUTLINE}/>
<path d="M${x} -74 v-10" stroke="${GOLD}" stroke-width="3.5" stroke-linecap="round"/>
<path d="M${x - 4} -26 v12 a4 4 0 0 1 8 0 v-12 z" fill="${CREAM}"/>`;
  }
  s += `<rect x="-58" y="16" width="116" height="72" rx="6" fill="${wall}" ${OUTLINE}/>
<rect x="-36" y="0" width="72" height="20" rx="4" fill="${wall}" ${OUTLINE}/>
<path d="M-40 4 C-48 -38 -8 -46 0 -70 C8 -46 48 -38 40 4 Z" fill="${dome}" ${OUTLINE}/>
<path d="M-24 -20 C-24 -32 -14 -40 -6 -46" stroke="#fff" stroke-width="5" fill="none" stroke-linecap="round" opacity=".4"/>
<path d="M0 -70 v-12" stroke="${GOLD}" stroke-width="4" stroke-linecap="round"/>
<path d="M-15 88 v-34 a15 15 0 0 1 30 0 v34 z" fill="${CREAM}"/>
<path d="M-44 58 v-16 a7 7 0 0 1 14 0 v16 z M30 58 v-16 a7 7 0 0 1 14 0 v16 z" fill="${CREAM}"/>`;
  for (const x of [-24, -8, 8, 24]) s += `<circle cx="${x}" cy="10" r="3.5" fill="${CREAM}"/>`;
  s += g(crescent(8, GOLD, ''), 1, -89, 1, -30);
  return s;
};

/** A fanoos (Ramadan lantern); `string` hangs it from the top of the box. */
const fanoosBody = (colour: string) =>
  `<circle cx="0" cy="-40" r="9" fill="none" stroke="${GOLD}" stroke-width="5"/>
<path d="M-38 6 Q0 -54 38 6 Z" fill="${colour}" ${OUTLINE}/>
<path d="M-44 6 h88 l16 46 l-16 80 h-88 l-16 -80 z" fill="${colour}" ${OUTLINE}/>
<path d="M-26 22 h52 l8 30 l-8 56 h-52 l-8 -56 z" fill="${CREAM}"/>
<path d="M0 22 v86 M-34 52 h68" stroke="${colour}" stroke-width="5" opacity=".7"/>
<path d="M0 46 q10 14 0 28 q-10 -14 0 -28 z" fill="#ffb300"/>
<path d="M-30 132 h60 l-14 26 h-32 z" fill="${colour}" ${OUTLINE}/>
<path d="M0 158 v24" stroke="${GOLD}" stroke-width="6" stroke-linecap="round"/><circle cx="0" cy="188" r="8" fill="${GOLD}"/>`;

const fanoos: Piece = (r, p) => g(fanoosBody(pick(r, p.acc)), 0, -52, 0.73);

const fanoosHang: Piece = (r, p) => `<line x1="0" y1="-95" x2="0" y2="-80" stroke="${p.ink}" stroke-width="3" opacity=".45"/>` + g(fanoosBody(pick(r, p.acc)), 0, -51, 0.72);

/** A crescent and a star hanging from the top of the box. */
const moonHang: Piece = (r, p) =>
  `<line x1="0" y1="-95" x2="0" y2="-66" stroke="${p.ink}" stroke-width="3" opacity=".45"/>` +
  g(crescent(64, GOLD), 0, 0, 1, -8) + `<line x1="34" y1="-30" x2="34" y2="0" stroke="${p.ink}" stroke-width="2" opacity=".4"/>` + star(34, 18, 22, pick(r, [GOLD, ...p.acc]), 0);

/** A star hanging from the top of the box. */
const starHang: Piece = (r, p) =>
  `<line x1="0" y1="-95" x2="0" y2="-46" stroke="${p.ink}" stroke-width="3" opacity=".45"/>` + star(0, 12, 62, pick(r, [GOLD, ...p.acc]), 0) +
  `<circle cx="0" cy="12" r="12" fill="#fff" opacity=".5"/>`;

/** A plate of dates. */
const dates: Piece = (r, p) => {
  const dish = pick(r, p.acc);
  let s = `<ellipse cx="0" cy="44" rx="92" ry="28" fill="${dish}" ${OUTLINE}/><ellipse cx="0" cy="40" rx="74" ry="18" fill="#fff" opacity=".55"/>`;
  const rows = [[-54, -18, 18, 54], [-36, 0, 36], [-18, 18], [0]];
  rows.forEach((row, k) => {
    for (const x of row) {
      const y = 30 - k * 22;
      s += `<ellipse cx="${x}" cy="${y}" rx="22" ry="13" fill="${pick(r, ['#7b3f1f', '#8d4a24', '#6b3418'])}" stroke="#fff" stroke-width="3" transform="rotate(${n(between(r, -18, 18))} ${x} ${y})"/><ellipse cx="${x - 8}" cy="${y - 5}" rx="6" ry="3" fill="#fff" opacity=".35"/>`;
    }
  });
  return g(s + leaf(60, -20, 40, GREEN, -40), 0, -2);
};

/** A bowl of sheer khurma: milky vermicelli with nuts. */
const sheerKhurma: Piece = (r, p) => {
  const bowl = pick(r, p.acc);
  let s = '';
  for (const x of [-26, 0, 26]) s += `<path d="M${x} -36 q-10 -12 0 -24 q10 -12 0 -24" stroke="${p.ink}" stroke-width="4" fill="none" stroke-linecap="round" opacity=".22"/>`;
  s += `<ellipse cx="0" cy="80" rx="34" ry="8" fill="${bowl}" ${OUTLINE}/>
<path d="M-84 -2 Q-80 72 0 76 Q80 72 84 -2 Z" fill="${bowl}" ${OUTLINE}/>
<path d="M-70 26 q12 10 24 0 t24 0 t24 0 t24 0 t24 0" stroke="#fff" stroke-width="4" fill="none" opacity=".6"/>
<ellipse cx="0" cy="-2" rx="84" ry="20" fill="#f8ead0" ${OUTLINE}/>`;
  for (let i = 0; i < 7; i++) {
    const x = between(r, -60, 50), y = between(r, -10, 6);
    s += `<path d="M${n(x)} ${n(y)} q8 -6 16 0 t16 0" stroke="#d9a24a" stroke-width="3" fill="none" stroke-linecap="round"/>`;
  }
  for (let i = 0; i < 9; i++) {
    const c = pick(r, ['#e8c48a', '#9ccc65', '#6b2f3a']);
    s += `<ellipse cx="${n(between(r, -62, 62))}" cy="${n(between(r, -10, 8))}" rx="5" ry="2.6" fill="${c}" transform="rotate(${n(between(r, -40, 40))})"/>`;
  }
  return s;
};

/** A teapot with a pattern. */
const teapot: Piece = (r, p) => {
  const c = pick(r, p.acc), lid = other(r, p, c);
  return `<path d="M-50 -6 C-92 -10 -92 56 -48 50" fill="none" stroke="#fff" stroke-width="20" stroke-linecap="round"/><path d="M-50 -6 C-92 -10 -92 56 -48 50" fill="none" stroke="${c}" stroke-width="11" stroke-linecap="round"/>
<path d="M46 22 Q76 12 80 -30 l10 -4 l-2 12 Q86 34 50 48 Z" fill="${c}" ${OUTLINE}/>
<ellipse cx="0" cy="24" rx="60" ry="52" fill="${c}" ${OUTLINE}/>
<path d="M-54 22 q9 -12 18 0 t18 0 t18 0 t18 0 t18 0 t18 0" stroke="${CREAM}" stroke-width="5" fill="none" stroke-linecap="round"/>
<circle cx="-30" cy="46" r="5" fill="${CREAM}"/><circle cx="0" cy="52" r="5" fill="${CREAM}"/><circle cx="30" cy="46" r="5" fill="${CREAM}"/>
<path d="M-38 0 Q-40 -12 -28 -20" stroke="#fff" stroke-width="7" fill="none" stroke-linecap="round" opacity=".45"/>
<ellipse cx="0" cy="-26" rx="36" ry="10" fill="${lid}" ${OUTLINE}/>
<path d="M-24 -30 Q0 -58 24 -30 Z" fill="${lid}" ${OUTLINE}/>
<circle cx="0" cy="-50" r="8" fill="${GOLD}" ${OUTLINE}/>
<ellipse cx="0" cy="78" rx="38" ry="6" fill="${p.ink}" opacity=".12"/>`;
};

/** A hand with a simple mehndi (henna) pattern. */
const mehndiHand: Piece = (r) => {
  const ink = '#a4421a';
  let m = flower(0, 26, 8, 24, 11, [ink], '#fff', r(), 6).replaceAll(OUTLINE, 'stroke="none"');
  for (let i = 0; i < 12; i++) {
    const a = (2 * Math.PI * i) / 12;
    m += `<circle cx="${n(Math.cos(a) * 36)}" cy="${n(26 + Math.sin(a) * 36)}" r="2.6" fill="${ink}"/>`;
  }
  for (const [x, top] of [[-35, -64], [-12, -74], [12, -68], [34, -50]]) m += `<path d="M${x - 9} ${top} a9 9 0 0 1 18 0 z" fill="${ink}"/><path d="M${x - 6} ${top + 22} h12 M${x - 6} ${top + 30} h12" stroke="${ink}" stroke-width="2.5"/>`;
  m += `<circle cx="-72" cy="0" r="8" fill="${ink}"/><path d="M-28 70 h56 M-24 78 l6 -6 l6 6 l6 -6 l6 6 l6 -6 l6 6 l6 -6" stroke="${ink}" stroke-width="2.5" fill="none"/>`;
  return g(hand(pick(r, SKIN), m), 0, 0, 1, between(r, -8, 8));
};

const eidGift: Piece = (r, p) => {
  const c = pick(r, p.acc);
  return gift(-70, -36, 140, 116, c, other(r, p, c)) + `<circle cx="-42" cy="10" r="6" fill="#fff" opacity=".6"/>`;
};

const littleMoon: Piece = (r) => g(crescent(74, GOLD), -6, 0, 1, between(r, -30, 0)) + twinkle(40, -6, 18, '#fff');

const eidStar: Piece = (r, p) => star(0, 8, 84, pick(r, [GOLD, ...p.acc]), between(r, -0.2, 0.2)) + `<circle cx="0" cy="8" r="16" fill="#fff" opacity=".5"/>`;

const eidKit: Kit = {
  hero: [moonStar, mosque, fanoos, dates],
  small: [littleMoon, eidStar, fanoos, dates, sheerKhurma, eidGift, mehndiHand, teapot],
  hang: [fanoosHang, moonHang, starHang],
};

// ---------------------------------------------------------------- Raksha Bandhan

/** The decorated middle of a rakhi, of radius about R: petals, a scalloped disc or a star. */
function rakhiTop(r: Rng, p: Palette, R: number) {
  const cols = [...p.acc].sort(() => r() - 0.5), kind = whole(r, 0, 2), rot = r() * Math.PI;
  let s = '';
  if (kind === 0) {
    for (let i = 0; i < 16; i++) {
      const a = (2 * Math.PI * i) / 16 + rot;
      s += `<circle cx="${n(Math.cos(a) * R * 0.86)}" cy="${n(Math.sin(a) * R * 0.86)}" r="${n(R * 0.2)}" fill="${i % 2 ? cols[3] : cols[4]}" ${OUTLINE}/>`;
    }
    s += `<circle cx="0" cy="0" r="${n(R * 0.86)}" fill="${cols[3]}" ${OUTLINE}/>`;
    s += flower(0, 0, 10, R * 0.76, R * 0.32, [cols[1], cols[2]], GOLD, rot, R * 0.22);
  } else if (kind === 1) {
    let pts = '';
    for (let i = 0; i < 16; i++) {
      const a = rot + (Math.PI / 8) * i, rad = i % 2 ? R * 0.62 : R;
      pts += `${n(Math.cos(a) * rad)},${n(Math.sin(a) * rad)} `;
    }
    s += `<polygon points="${pts.trim()}" fill="${cols[1]}" ${OUTLINE}/><circle cx="0" cy="0" r="${n(R * 0.56)}" fill="${cols[2]}" ${OUTLINE}/>`;
    for (let i = 0; i < 10; i++) {
      const a = (2 * Math.PI * i) / 10;
      s += `<circle cx="${n(Math.cos(a) * R * 0.4)}" cy="${n(Math.sin(a) * R * 0.4)}" r="${n(R * 0.07)}" fill="${CREAM}"/>`;
    }
  } else {
    s += flower(0, 0, 12, R, R * 0.38, [cols[1], cols[0]], GOLD, rot, R * 0.3);
    s += flower(0, 0, 6, R * 0.6, R * 0.32, [cols[2]], GOLD, rot + 0.3, R * 0.3);
  }
  return s + `<circle cx="0" cy="0" r="${n(R * 0.18)}" fill="${p.head[1]}" stroke="#fff" stroke-width="3"/><circle cx="${n(-R * 0.06)}" cy="${n(-R * 0.06)}" r="${n(R * 0.06)}" fill="#fff" opacity=".7"/>`;
}

/** A rakhi: a thread with beads and tassels, its decorated middle the hero. */
const rakhi: Piece = (r, p) => {
  const thread = pick(r, p.acc), bead = other(r, p, thread);
  const d = 'M-84 10 Q-42 32 0 0 Q42 32 84 10';
  let s = `<path d="${d}" fill="none" stroke="#fff" stroke-width="18" stroke-linecap="round"/><path d="${d}" fill="none" stroke="${thread}" stroke-width="10" stroke-linecap="round"/><path d="${d}" fill="none" stroke="${CREAM}" stroke-width="10" stroke-dasharray="5 10"/>`;
  for (const side of [-1, 1]) {
    s += `<path d="M${side * 84 - 8} 18 v52 M${side * 84} 18 v62 M${side * 84 + 8} 18 v52" stroke="${thread}" stroke-width="5" stroke-linecap="round"/><circle cx="${side * 84}" cy="16" r="10" fill="${bead}" ${OUTLINE}/>`;
    for (const t of [0.3, 0.62]) {
      const [x, y] = quad(side * 84, 10, side * 42, 32, 0, 0, t);
      s += `<circle cx="${n(x)}" cy="${n(y)}" r="8" fill="${bead}" stroke="#fff" stroke-width="3"/>`;
    }
  }
  return s + g(rakhiTop(r, p, 58), 0, -8);
};

/** A smaller, simpler rakhi. */
const rakhiSmall: Piece = (r, p) => {
  const thread = pick(r, p.acc);
  return `<path d="M-90 20 Q0 -30 90 20" fill="none" stroke="#fff" stroke-width="16" stroke-linecap="round"/><path d="M-90 20 Q0 -30 90 20" fill="none" stroke="${thread}" stroke-width="9" stroke-linecap="round"/>` +
    rakhiTop(r, p, 72);
};

/** A rakhi hanging from the top of the box, its two ends falling below. */
const rakhiHang: Piece = (r, p) => {
  const thread = pick(r, p.acc);
  return `<line x1="0" y1="-95" x2="0" y2="-40" stroke="${thread}" stroke-width="6"/>
<path d="M-6 20 Q-26 50 -18 78 M6 20 Q26 50 18 78" stroke="${thread}" stroke-width="6" fill="none" stroke-linecap="round"/>
<circle cx="-18" cy="84" r="8" fill="${GOLD}" stroke="#fff" stroke-width="3"/><circle cx="18" cy="84" r="8" fill="${GOLD}" stroke="#fff" stroke-width="3"/>` + g(rakhiTop(r, p, 46), 0, -16);
};

const heartHang: Piece = (r, p) =>
  `<line x1="0" y1="-95" x2="0" y2="-40" stroke="${p.ink}" stroke-width="3" opacity=".45"/>` + heart(0, 20, 58, pick(r, p.acc)) + `<circle cx="-24" cy="-4" r="8" fill="#fff" opacity=".5"/>`;

const bigHeart: Piece = (r, p) => heart(0, 8, 70, pick(r, p.acc)) + `<circle cx="-30" cy="-22" r="10" fill="#fff" opacity=".5"/>` + twinkle(66, -66, 14, '#fff');

/** An aarti thali for the rakhi: a lamp, a rakhi, laddoos and red roli. */
const thali: Piece = (r, p) => {
  let s = plate(46, 94, 32);
  for (let i = 0; i < 22; i++) {
    const a = (2 * Math.PI * i) / 22;
    s += `<circle cx="${n(Math.cos(a) * 86)}" cy="${n(46 + Math.sin(a) * 27)}" r="3" fill="${BRASS_DARK}"/>`;
  }
  s += laddoos(-52, 34, 14, 2);
  s += `<path d="M36 22 Q38 44 54 44 Q70 44 72 22 Z" fill="${BRASS_DARK}" ${OUTLINE}/><ellipse cx="54" cy="22" rx="18" ry="6" fill="#d62828"/>`;
  s += g(diya(0, 0), 0, 30, 0.86);
  const thread = pick(r, p.acc);
  s += `<path d="M-60 62 Q-20 50 0 60 Q30 72 64 56" stroke="${thread}" stroke-width="6" fill="none" stroke-linecap="round"/>` + g(rakhiTop(r, p, 20), 4, 60);
  return g(s, 0, -2);
};

/** An open box of sweets. */
const sweetsBox: Piece = (r, p) => {
  const box = pick(r, p.acc), ribbon = other(r, p, box);
  let s = `<path d="M-78 -12 L-66 -84 H66 L78 -12 Z" fill="${box}" ${OUTLINE}/><path d="M-60 -20 L-52 -72 H52 L60 -20 Z" fill="#fff" opacity=".35"/>`;
  s += laddoos(-40, -14, 15, 2) + laddoos(40, -14, 15, 2, '#f7c948');
  s += `<path d="M-12 -12 l12 -16 l12 16 l-12 16 z" fill="#eef0f3" stroke="#fff" stroke-width="3"/>`;
  s += `<rect x="-86" y="-12" width="172" height="92" rx="10" fill="${box}" ${OUTLINE}/>
<rect x="-12" y="-12" width="24" height="92" fill="${ribbon}"/>
<path d="M0 26 q-34 -26 -34 4 q0 22 34 -4 q34 26 34 -4 q0 -30 -34 4" fill="${ribbon}" ${OUTLINE}/><circle cx="0" cy="26" r="8" fill="${ribbon}" ${OUTLINE}/>`;
  return s;
};

/** Two little hands raised, a rakhi tied on one wrist. */
const rakhiHands: Piece = (r, p) => {
  const skins = [...SKIN].sort(() => r() - 0.5), thread = pick(r, p.acc);
  const band = `<rect x="-36" y="62" width="72" height="12" rx="5" fill="${thread}" stroke="#fff" stroke-width="3"/>` + g(rakhiTop(r, p, 26), 0, 68);
  return g(hand(skins[0], band), -34, 12, 0.68, -12) + g(hand(skins[1]), 42, 20, 0.6, 12, -0.6) + heart(6, -72, 18, pick(r, p.acc));
};

const raksha: Kit = {
  hero: [rakhi, thali, sweetsBox, rakhiHands],
  small: [rakhiSmall, bigHeart, eidGift, sweetsBox, lampOnStand, thali, rakhiSmall],
  hang: [rakhiHang, heartHang],
};

// ---------------------------------------------------------------- Janmashtami

/** A bamboo flute with coloured bands; drawn level, 200 long, centred. */
const fluteBody = (a: string, b: string) => {
  let f = `<rect x="-98" y="-9" width="196" height="18" rx="9" fill="#d9a35b" ${OUTLINE}/><rect x="-92" y="-5" width="184" height="4" rx="2" fill="#f0c98a"/>`;
  for (const x of [-84, -74, 64, 74]) f += `<rect x="${x}" y="-9" width="7" height="18" fill="${x < 0 ? a : b}"/>`;
  f += `<ellipse cx="-50" cy="0" rx="5" ry="4" fill="#7a4a12"/>`;
  for (let i = 0; i < 6; i++) f += `<ellipse cx="${-10 + 13 * i}" cy="0" rx="4.5" ry="3.5" fill="#7a4a12"/>`;
  return f;
};

/** A tassel hanging from (x, y). */
const tassel = (x: number, y: number, c: string, len = 40) =>
  `<path d="M${n(x)} ${n(y)} v${len * 0.4}" stroke="${c}" stroke-width="4"/><circle cx="${n(x)}" cy="${n(y + len * 0.45)}" r="7" fill="${c}" stroke="#fff" stroke-width="3"/>
<path d="M${n(x - 5)} ${n(y + len * 0.6)} v${len * 0.4} M${n(x)} ${n(y + len * 0.6)} v${len * 0.5} M${n(x + 5)} ${n(y + len * 0.6)} v${len * 0.4}" stroke="${c}" stroke-width="4" stroke-linecap="round"/>`;

/** The flute with a peacock feather tucked behind it. */
const fluteFeather: Piece = (r, p) => {
  const cols = [...p.acc].sort(() => r() - 0.5), angle = between(r, -28, -20);
  const a = (angle * Math.PI) / 180, k = 0.9, tx = -50 * k, x = Math.cos(a) * tx, y = 26 + Math.sin(a) * tx;
  return peacockFeather(-8, 88, 0.36, 16) + g(fluteBody(cols[0], cols[1]), 0, 26, k, angle) + tassel(x, y + 8, cols[2], 50);
};

const flute: Piece = (r, p) => {
  const cols = [...p.acc].sort(() => r() - 0.5), angle = between(r, -40, -30);
  const a = (angle * Math.PI) / 180, x = Math.cos(a) * -40, y = Math.sin(a) * -40;
  return g(fluteBody(cols[0], cols[1]), 0, 0, 0.98, angle) + tassel(x, y + 8, cols[2], 56);
};

const feather: Piece = (r) => peacockFeather(-22, 92, 0.38, between(r, 10, 18));

/** A clay pot (matki) of butter. */
function matkiBody(r: Rng, p: Palette) {
  const band = pick(r, p.acc);
  let s = `<circle cx="0" cy="26" r="60" fill="${CLAY}" ${OUTLINE}/>
<path d="M-56 4 Q0 30 56 4 L58 30 Q0 58 -58 30 Z" fill="${band}"/>
<path d="M-44 -6 Q-56 18 -46 42" stroke="#fff" stroke-width="6" fill="none" stroke-linecap="round" opacity=".35"/>`;
  for (let i = 0; i < 7; i++) s += `<circle cx="${-42 + 14 * i}" cy="${n(26 + Math.sin((Math.PI * i) / 6) * 12)}" r="3.6" fill="${CREAM}"/>`;
  s += `<rect x="-38" y="-46" width="76" height="22" rx="9" fill="${CLAY_DARK}" ${OUTLINE}/>`;
  s += g(`<path d="M-78 0 q-6 -40 30 -48 q14 -40 54 -24 q40 -20 52 22 q30 10 20 50 q-6 24 -14 0 q-30 6 -60 2 q-10 30 -20 0 q-30 0 -62 -2 z" fill="#fffaf0" ${soft(p, 8)}/>`, 0, -44, 0.48);
  return s;
}

const matki: Piece = (r, p) => matkiBody(r, p) + `<ellipse cx="0" cy="86" rx="44" ry="6" fill="${p.ink}" opacity=".12"/>` + marigold(-40, -40, 12, MARIGOLD[0]) + marigold(40, -40, 12, MARIGOLD[1]);

/** The dahi handi: the pot of butter hanging high on ropes. */
const dahiHandi: Piece = (r, p) =>
  `<path d="M0 -95 L-34 -38 M0 -95 L34 -38 M0 -95 V-44" stroke="#a1774a" stroke-width="4" stroke-linecap="round"/>` +
  g(matkiBody(r, p), 0, 22, 0.76) + marigold(-28, 36, 10, MARIGOLD[1]) + marigold(28, 36, 10, MARIGOLD[0]);

/** A crown (mukut) with a peacock feather. */
const mukut: Piece = (r, p) => {
  const gems = [...p.acc].sort(() => r() - 0.5);
  let s = peacockFeather(0, 28, 0.25, 0);
  s += `<path d="M-70 52 L-66 -2 L-40 22 L-22 -30 L0 2 L22 -30 L40 22 L66 -2 L70 52 Z" fill="${GOLD}" ${OUTLINE}/>
<rect x="-76" y="48" width="152" height="28" rx="10" fill="${BRASS}" ${OUTLINE}/>`;
  for (const [x, y] of [[-66, -6], [-22, -34], [22, -34], [66, -6]]) s += `<circle cx="${x}" cy="${y}" r="6" fill="#fff" stroke="${BRASS_DARK}" stroke-width="2"/>`;
  for (let i = 0; i < 5; i++) s += `<circle cx="${-52 + 26 * i}" cy="62" r="7" fill="${gems[i % gems.length]}" stroke="#fff" stroke-width="2.5"/>`;
  s += `<path d="M-30 30 l8 -12 l8 12 l-8 12 z M14 30 l8 -12 l8 12 l-8 12 z" fill="${gems[0]}" stroke="#fff" stroke-width="2.5"/>`;
  return g(s, 0, 10);
};

/** A brass cow bell on a cloth strap. */
const cowbellBody = (strap: string) =>
  `<circle cx="0" cy="-62" r="12" fill="none" stroke="#fff" stroke-width="12"/><circle cx="0" cy="-62" r="12" fill="none" stroke="${BRASS_DARK}" stroke-width="6"/>
<path d="M-26 -44 Q0 -58 26 -44 Q32 6 52 46 Q0 62 -52 46 Q-32 6 -26 -44 Z" fill="${BRASS}" ${OUTLINE}/>
<path d="M-30 -14 Q0 -6 30 -14 M-38 16 Q0 26 38 16" stroke="${BRASS_DARK}" stroke-width="4" fill="none"/>
<path d="M-16 -38 Q-22 0 -32 36" stroke="#fff" stroke-width="7" fill="none" stroke-linecap="round" opacity=".45"/>
<path d="M-4 -50 l-26 -16 v26 z M4 -50 l26 -16 v26 z" fill="${strap}" ${OUTLINE}/><circle cx="0" cy="-50" r="8" fill="${strap}" ${OUTLINE}/>
<ellipse cx="0" cy="52" rx="48" ry="10" fill="${BRASS_DARK}" stroke="#fff" stroke-width="3"/>
<circle cx="0" cy="66" r="10" fill="${BRASS_DARK}" ${OUTLINE}/>`;

const cowbell: Piece = (r, p) => g(cowbellBody(pick(r, p.acc)), 0, 12, 1, between(r, -10, 10));

const cowbellHang: Piece = (r, p) => `<line x1="0" y1="-95" x2="0" y2="-74" stroke="#a1774a" stroke-width="4"/>` + g(cowbellBody(pick(r, p.acc)), 0, 4, 0.98);

/** A tulsi (holy basil) plant in a small clay pot. */
const tulsi: Piece = (r, p) => {
  let s = `<path d="M0 50 Q-4 0 0 -52 M0 14 Q26 -4 42 -34 M0 -6 Q-28 -22 -44 -46" stroke="#5d7b3a" stroke-width="5" fill="none" stroke-linecap="round"/>`;
  const leaves: [number, number, number][] = [[0, 30, 0], [0, 4, 0], [0, -24, 0], [22, -6, 30], [34, -22, 30], [-22, -18, -30], [-34, -32, -30]];
  for (const [x, y, t] of leaves) s += leaf(x, y, 38, LEAF, -24 + t) + leaf(x, y, 38, GREEN, -156 + t);
  for (const [x, y] of [[0, -52], [42, -34], [-44, -46]]) for (let k = 0; k < 4; k++) s += `<circle cx="${x}" cy="${y - 8 - k * 9}" r="${5 - k}" fill="#8e5a8a"/>`;
  const band = pick(r, p.acc);
  s += `<path d="M-44 48 H44 L34 90 H-34 Z" fill="${CLAY}" ${OUTLINE}/><rect x="-50" y="42" width="100" height="14" rx="6" fill="${CLAY_DARK}" ${OUTLINE}/><path d="M-38 70 H38" stroke="${band}" stroke-width="7"/>`;
  return s;
};

const krishnaCradle: Piece = (r, p) => cradle(r, p, true);

const janmashtamiKit: Kit = {
  hero: [fluteFeather, matki, mukut, krishnaCradle],
  small: [feather, flute, matki, cowbell, tulsi, mukut, marigoldFlower],
  hang: [dahiHandi, cowbellHang, marigoldStrand],
  colours: ['#18a6a0', '#3fae5a', '#ffc93c', '#1e64c8', '#ff9f1c'],
};

export const festivalKitsA: Record<string, Kit> = {
  ugadi: ugadiKit,
  'good-friday': goodFridayKit,
  'ram-navami': ramNavamiKit,
  'mahavir-jayanti': mahavirKit,
  'eid-ul-fitr': eidKit,
  'raksha-bandhan': raksha,
  janmashtami: janmashtamiKit,
};
