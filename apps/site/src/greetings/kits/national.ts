// The national days' and Sankranti's and Holi's symbols for the card maker (src/greetings/maker.ts): New Year,
// Republic Day, Independence Day, Gandhi Jayanti, Kannada Rajyotsava, Makar Sankranti and Pongal, Holi.
// Every piece is drawn in a 200 × 200 box centred on (0, 0), inside −95…95.
import type { Kit, Piece } from '../maker';
import { flower, gift, leaf, n, OUTLINE, sparkle, star, sun } from '../motifs';
import { between, pick, whole } from '../palettes';
import type { Palette, Rng } from '../types';

// ---------------------------------------------------------------- shared

// The national colours, as they must be.
const SAFFRON = '#FF9933', GREEN = '#138808', NAVY = '#000080', WHITE = '#ffffff';
const TRI = [SAFFRON, WHITE, GREEN];
// Karnataka's flag: yellow over red.
const KA_YELLOW = '#ffcd00', KA_RED = '#d9261c';
const KA = [KA_YELLOW, KA_RED];
const GOLD = '#ffc93c', CREAM = '#fff4c2', BRASS = '#e0a526', CLAY = '#c75b2a', LEAF = '#5cb85c', LEAF_DARK = '#3f9b3a';
const WOOD = '#b07a4a', WOOD_DARK = '#8a5a34', POLE = '#8d6e63';

/** Wraps markup in a move, turn and scale. */
const g = (body: string, x = 0, y = 0, s = 1, rot = 0) =>
  `<g transform="translate(${n(x)} ${n(y)})${rot ? ` rotate(${n(rot)})` : ''}${s !== 1 ? ` scale(${n(s)})` : ''}">${body}</g>`;

/** A soft ink rim under white and pale shapes, so they don't vanish on the pale card. */
const soft = (ink: string, w = 10) => `stroke="${ink}" stroke-opacity=".16" stroke-width="${w}" stroke-linejoin="round"`;

/** A pale shape: its soft ink rim first, then the shape. `el` is an element without its closing, like `<circle r="9"`. */
const pale = (el: string, fill: string, ink: string, w = 10) => `${el} fill="${fill}" ${soft(ink, w)}/>${el} fill="${fill}"/>`;

/** Twelve-sided rays of a small burst, in this box's units. */
function pop(x: number, y: number, R: number, colour: string, rays = 12) {
  let s = '';
  for (let i = 0; i < rays; i++) {
    const a = (2 * Math.PI * i) / rays;
    s += `<line x1="${n(x + Math.cos(a) * R * 0.32)}" y1="${n(y + Math.sin(a) * R * 0.32)}" x2="${n(x + Math.cos(a) * R)}" y2="${n(y + Math.sin(a) * R)}" stroke="${colour}" stroke-width="${n(Math.max(4, R * 0.12))}" stroke-linecap="round"/>`;
    s += `<circle cx="${n(x + Math.cos(a) * (R + 9))}" cy="${n(y + Math.sin(a) * (R + 9))}" r="${n(Math.max(3, R * 0.07))}" fill="${colour}"/>`;
  }
  return s;
}

/** The Ashoka Chakra: a navy wheel of 24 spokes. */
function chakra(cx: number, cy: number, R: number) {
  let spokes = '';
  for (let i = 0; i < 24; i++) {
    const a = (2 * Math.PI * i) / 24;
    spokes += `M${n(cx + Math.cos(a) * R * 0.16)} ${n(cy + Math.sin(a) * R * 0.16)}L${n(cx + Math.cos(a) * R)} ${n(cy + Math.sin(a) * R)}`;
  }
  return `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(R)}" fill="none" stroke="${NAVY}" stroke-width="${n(Math.max(1.6, R * 0.13))}"/>
<path d="${spokes}" stroke="${NAVY}" stroke-width="${n(Math.max(0.8, R * 0.055))}"/>
<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(R * 0.2)}" fill="${NAVY}"/>`;
}

/** A flag of equal horizontal bands, waving gently; (x, y) is its top corner at the pole. */
function wavyFlag(x: number, y: number, w: number, h: number, bands: string[], ink: string, wave = 7) {
  const band = h / bands.length;
  const edge = (yy: number) => `M${n(x)} ${n(yy)} q${n(w / 4)} ${n(-wave)} ${n(w / 2)} 0 t${n(w / 2)} 0`;
  const back = `q${n(-w / 4)} ${n(wave)} ${n(-w / 2)} 0 t${n(-w / 2)} 0 z`;
  const whole = `${edge(y)} v${n(h)} ${back}`;
  let s = `<path d="${whole}" fill="none" ${soft(ink, 9)}/>`;
  bands.forEach((c, i) => (s += `<path d="${edge(y + i * band)} v${n(band)} ${back}" fill="${c}"/>`));
  return s + `<path d="${whole}" fill="none" stroke="#fff" stroke-width="3" stroke-linejoin="round"/>`;
}

/** A flag on a pole with a gold tip and a little stand; bands top to bottom, and the chakra for India. */
function flagOnPole(bands: string[], ink: string, india: boolean, wave = 7) {
  const x = -76, y = -76, w = 162, h = 108;
  return `<ellipse cx="${x}" cy="86" rx="22" ry="7" fill="${WOOD_DARK}" ${OUTLINE}/>
<line x1="${x}" y1="-82" x2="${x}" y2="84" stroke="${POLE}" stroke-width="8" stroke-linecap="round"/>
${wavyFlag(x + 3, y, w, h, bands, ink, wave)}${india ? chakra(x + 3 + w / 2, y + h / 2, h / 6 - 3) : ''}
<circle cx="${x}" cy="-86" r="7" fill="${GOLD}" stroke="#fff" stroke-width="2.5"/>`;
}

/** A balloon (rx wide) with a highlight and knot; white balloons get a soft rim. */
function balloonBody(x: number, y: number, rx: number, fill: string, ink: string) {
  const ry = rx * 1.24;
  return (fill === WHITE ? `<ellipse cx="${n(x)}" cy="${n(y)}" rx="${n(rx)}" ry="${n(ry)}" fill="none" ${soft(ink, 12)}/>` : '') +
    `<ellipse cx="${n(x)}" cy="${n(y)}" rx="${n(rx)}" ry="${n(ry)}" fill="${fill}" ${OUTLINE}/>
<ellipse cx="${n(x - rx * 0.34)}" cy="${n(y - ry * 0.36)}" rx="${n(rx * 0.17)}" ry="${n(ry * 0.24)}" fill="#fff" opacity=".55" transform="rotate(25 ${n(x - rx * 0.34)} ${n(y - ry * 0.36)})"/>
<path d="M${n(x - 7)} ${n(y + ry + 8)} h14 l-7 -10 z" fill="${fill === WHITE ? '#e8e8ee' : fill}"/>`;
}

/** A bunch of balloons tied at (0, 66) with a bow; `spots` are [x, y, rx, colour], back ones first. */
function balloonBunch(spots: [number, number, number, string][], ink: string, bow: string, r: Rng) {
  let s = '';
  for (const [x, y, rx] of spots) s += `<path d="M${n(x)} ${n(y + rx * 1.24 + 8)} Q${n((x * 0.4) + between(r, -8, 8))} ${n((y + 66) / 2 + 30)} 0 66" fill="none" stroke="${ink}" stroke-width="2.5" opacity=".45"/>`;
  for (const [x, y, rx, c] of spots) s += balloonBody(x, y, rx, c, ink);
  return s + `<path d="M0 66 q-26 -18 -30 4 q6 16 30 -4 z M0 66 q26 -18 30 4 q-6 16 -30 -4 z" fill="${bow}" ${OUTLINE}/>
<path d="M0 66 q-10 14 -18 26 M0 66 q10 14 16 26" fill="none" stroke="${bow}" stroke-width="6" stroke-linecap="round"/>
<circle cx="0" cy="66" r="8" fill="${bow}" stroke="#fff" stroke-width="3"/>`;
}

/** A diamond kite: one colour, two halves, or three horizontal bands (saffron, white, green). */
function kiteBody(cx: number, cy: number, W: number, H: number, bands: string[], ink: string) {
  const P = (x: number, y: number) => `${n(cx + x)},${n(cy + y)}`;
  const outline = `M${P(0, -H)} L${P(W, 0)} L${P(0, H)} L${P(-W, 0)} Z`;
  let s = bands.includes(WHITE) ? `<path d="${outline}" fill="none" ${soft(ink, 12)}/>` : '';
  if (bands.length === 1) s += `<path d="${outline}" fill="${bands[0]}"/>`;
  else if (bands.length === 2) s += `<path d="M${P(0, -H)} L${P(-W, 0)} L${P(0, H)} Z" fill="${bands[0]}"/><path d="M${P(0, -H)} L${P(W, 0)} L${P(0, H)} Z" fill="${bands[1]}"/>`;
  else {
    const hw = (y: number) => W * (1 - Math.abs(y) / H), y1 = -H / 3, y2 = H / 3;
    s += `<polygon points="${P(0, -H)} ${P(hw(y1), y1)} ${P(-hw(y1), y1)}" fill="${bands[0]}"/>
<polygon points="${P(-hw(y1), y1)} ${P(hw(y1), y1)} ${P(W, 0)} ${P(hw(y2), y2)} ${P(-hw(y2), y2)} ${P(-W, 0)}" fill="${bands[1]}"/>
<polygon points="${P(-hw(y2), y2)} ${P(hw(y2), y2)} ${P(0, H)}" fill="${bands[2]}"/>`;
  }
  s += `<path d="${outline}" fill="none" ${OUTLINE}/>
<path d="M${P(0, -H)} L${P(0, H)} M${P(-W, 0)} Q${P(0, -H * 0.3)} ${P(W, 0)}" fill="none" stroke="#fff" stroke-width="3" opacity=".8"/>`;
  if (bands.length === 3 && bands[1] === WHITE) s += chakra(cx, cy + 2, Math.min(W, H) * 0.16);
  return s;
}

/** A wavy kite tail from (x, y) going down-left, with bows. */
function kiteTail(x: number, y: number, len: number, colour: string, bows: string[]) {
  const s = len / 100;
  let out = `<path d="M${n(x)} ${n(y)} c${n(-30 * s)} ${n(16 * s)} ${n(-4 * s)} ${n(44 * s)} ${n(-34 * s)} ${n(60 * s)} s${n(-18 * s)} ${n(30 * s)} ${n(-34 * s)} ${n(36 * s)}" fill="none" stroke="${colour}" stroke-width="4" stroke-linecap="round"/>`;
  const at = [[x - 18 * s, y + 24 * s], [x - 46 * s, y + 70 * s]];
  at.forEach(([bx, by], i) => (out += `<path d="M${n(bx - 9)} ${n(by - 7)} L${n(bx + 9)} ${n(by + 7)} L${n(bx + 9)} ${n(by - 7)} L${n(bx - 9)} ${n(by + 7)} Z" fill="${bows[i % bows.length]}" stroke="#fff" stroke-width="2" stroke-linejoin="round"/>`));
  return out;
}

/** A kite reel (charkhi) lying sideways, string wound on its drum; (x, y) its middle, s its scale. */
function reel(x: number, y: number, s: number, thread: string) {
  return g(`<rect x="-44" y="-28" width="88" height="56" rx="6" fill="${thread}" ${OUTLINE}/>
<path d="M-36 -16 h72 M-36 -4 h72 M-36 8 h72 M-36 20 h72" stroke="#fff" stroke-width="3" opacity=".55"/>
<ellipse cx="-48" cy="0" rx="13" ry="44" fill="${WOOD}" ${OUTLINE}/><ellipse cx="48" cy="0" rx="13" ry="44" fill="${WOOD}" ${OUTLINE}/>
<path d="M-62 0 h-28 M62 0 h28" stroke="${WOOD_DARK}" stroke-width="13" stroke-linecap="round"/>`, x, y, s);
}

/** A rosette: pleated ring, two ribbon tails, a centre (the chakra for India). */
function rosette(outer: string, mid: string, tails: [string, string], ink: string, india: boolean) {
  const cy = -16;
  let s = `<polygon points="-8,${cy} -48,84 -34,76 -24,92 14,${cy + 6}" fill="${tails[0]}" ${OUTLINE}/>
<polygon points="8,${cy} 48,84 34,76 24,92 -14,${cy + 6}" fill="${tails[1]}" ${OUTLINE}/>`;
  let ruff = '';
  for (let i = 0; i < 18; i++) {
    const a = (2 * Math.PI * i) / 18;
    ruff += `<circle cx="${n(Math.cos(a) * 54)}" cy="${n(cy + Math.sin(a) * 54)}" r="18"/>`;
  }
  s += `<g fill="#fff">${ruff.replace(/r="18"/g, 'r="21"')}</g><g fill="${outer}">${ruff}</g>`;
  s += pale(`<circle cx="0" cy="${cy}" r="52"`, mid, ink, 6);
  for (let i = 0; i < 18; i++) {
    const a = (2 * Math.PI * (i + 0.5)) / 18;
    s += `<path d="M${n(Math.cos(a) * 40)} ${n(cy + Math.sin(a) * 40)} L${n(Math.cos(a) * 52)} ${n(cy + Math.sin(a) * 52)}" stroke="${ink}" stroke-opacity=".12" stroke-width="3"/>`;
  }
  s += `<circle cx="0" cy="${cy}" r="38" fill="${tails[1]}" ${OUTLINE}/><circle cx="0" cy="${cy}" r="27" fill="#fff"/>`;
  s += india ? chakra(0, cy, 22) : `<circle cx="0" cy="${cy}" r="18" fill="${tails[0]}"/>${sparkle(0, cy, 12, '#fff')}`;
  return s;
}

/** A triangular pennant in bands, hanging from a little rod, its top near y −90. */
function pennant(bands: string[], ink: string, emblem = '') {
  const top = -72, tip = 88, W = 58, Hh = tip - top;
  const hw = (y: number) => (W * (tip - y)) / Hh;
  let s = `<path d="M-62 ${top - 4} L0 -94 L62 ${top - 4}" fill="none" stroke="${ink}" stroke-width="3" opacity=".45"/>`;
  const outline = `M${-W} ${top} H${W} L0 ${tip} Z`;
  s += `<path d="${outline}" fill="none" ${soft(ink, 10)}/>`;
  const k = bands.length;
  for (let i = 0; i < k; i++) {
    const y0 = top + (Hh * i) / k, y1 = top + (Hh * (i + 1)) / k;
    s += `<polygon points="${n(-hw(y0))},${n(y0)} ${n(hw(y0))},${n(y0)} ${n(hw(y1))},${n(y1)} ${n(-hw(y1))},${n(y1)}" fill="${bands[i]}"/>`;
  }
  return s + `<path d="${outline}" fill="none" ${OUTLINE}/>${emblem}<rect x="-68" y="${top - 8}" width="136" height="9" rx="4.5" fill="${WOOD}" stroke="#fff" stroke-width="2.5"/>`;
}

/** A rectangular flag hanging from a rod, as on a string of flags; its top near y −90. */
function hangingBanner(bands: string[], ink: string, india: boolean) {
  const x = -74, y = -62, w = 148, h = 100;
  let s = `<path d="M-78 -70 L0 -94 L78 -70" fill="none" stroke="${ink}" stroke-width="3" opacity=".45"/>`;
  s += wavyFlag(x, y, w, h, bands, ink, 6) + (india ? chakra(0, y + h / 2, h / 6 - 3) : '');
  s += `<rect x="-84" y="-74" width="168" height="10" rx="5" fill="${WOOD}" stroke="#fff" stroke-width="2.5"/>`;
  for (let i = 0; i < 7; i++) s += `<circle cx="${n(-60 + i * 20)}" cy="${n(y + h + 10 + (i % 2) * 3)}" r="5" fill="${bands[i % bands.length] === WHITE ? GOLD : bands[i % bands.length]}" stroke="#fff" stroke-width="2"/>`;
  return s;
}

/** A pink lotus from the side, on a green pad; (0, 0) the middle of its base. */
function lotus(fill: string, deep: string) {
  const petal = (a: number, h: number, w: number, c: string) =>
    `<path d="M0 0 Q${-w} ${n(-h * 0.55)} 0 ${-h} Q${w} ${n(-h * 0.55)} 0 0 Z" fill="${c}" ${OUTLINE} transform="rotate(${a})"/>`;
  return `<ellipse cx="0" cy="10" rx="118" ry="24" fill="${LEAF}" ${OUTLINE}/><path d="M-60 10 q30 -10 60 -2" stroke="#fff" stroke-width="4" fill="none" opacity=".5"/>` +
    petal(-64, 82, 32, deep) + petal(64, 82, 32, deep) + petal(-32, 106, 38, fill) + petal(32, 106, 38, fill) +
    `<g opacity=".92">${petal(-14, 122, 40, '#fff')}${petal(14, 122, 40, '#fff')}</g>` + petal(0, 130, 42, fill) +
    `<path d="M0 -14 v-76" stroke="#fff" stroke-width="4" opacity=".6"/>`;
}
const lotusPiece: Piece = (r) => {
  const [fill, deep] = pick(r, [['#f48fb1', '#ec6f9e'], ['#ff8fb8', '#f06292'], ['#f7a1c4', '#e57399']]);
  return g(lotus(fill, deep), 0, 46, 0.76);
};

/** India's flag on its pole. */
const indiaFlag: Piece = (r, p) => flagOnPole(TRI, p.ink, true, between(r, 5, 9));

/** Three balloons in saffron, white (with the chakra) and green. */
const triBalloons: Piece = (r, p) => {
  const swap = r() < 0.5;
  const out = balloonBunch([[swap ? 52 : -52, -26, 37, SAFFRON], [swap ? -52 : 52, -26, 37, GREEN], [0, -44, 40, WHITE]], p.ink, pick(r, [SAFFRON, GREEN, NAVY]), r);
  return out + chakra(0, -44, 18);
};

/** One tricolour kite with a tail. */
const triKite: Piece = (r, p) => kiteTail(6, 56, 100, GREEN, [SAFFRON, GREEN]) + kiteBody(6, -20, 62, 74, TRI, p.ink) + (r() < 0.5 ? sparkle(70, -70, 12, GOLD) : '');

/** Two tricolour kites flying, their strings down to a reel. */
const kitePair: Piece = (r, p) => {
  const thread = pick(r, p.acc);
  return `<path d="M-30 -18 Q-20 40 22 52 M52 -42 Q60 20 30 50" fill="none" stroke="${p.ink}" stroke-width="2.5" opacity=".4"/>` +
    kiteTail(-30, 22, 62, SAFFRON, [GREEN, SAFFRON]) + kiteBody(-30, -32, 44, 54, TRI, p.ink) +
    kiteTail(52, -14, 50, GREEN, [SAFFRON, GREEN]) + kiteBody(52, -56, 32, 40, TRI, p.ink) + reel(24, 72, 0.4, thread);
};

/** A tricolour rosette with the chakra. */
const triRosette: Piece = (_r, p) => rosette(SAFFRON, WHITE, [SAFFRON, GREEN], p.ink, true);

/** A tricolour pennant and a hanging flag, for strings of flags. */
const triPennant: Piece = (_r, p) => pennant(TRI, p.ink, chakra(0, -4, 13));
const triBanner: Piece = (_r, p) => hangingBanner(TRI, p.ink, true);
const hangRosette: Piece = (_r, p) => `<line x1="0" y1="-94" x2="0" y2="-80" stroke="${p.ink}" stroke-width="3" opacity=".45"/>` + g(rosette(SAFFRON, WHITE, [SAFFRON, GREEN], p.ink, true), 0, 6, 0.92);

/** A peacock, India's national bird, with its tail spread like a fan. */
const peacock: Piece = (r) => {
  const fx = 0, fy = 26, count = whole(r, 11, 13), blue = '#1f5fbf', teal = '#1aa39a';
  let s = `<path d="M${fx} ${fy} L${n(fx + Math.cos(-2.9) * 64)} ${n(fy + Math.sin(-2.9) * 64)} A64 64 0 0 1 ${n(fx + Math.cos(-0.24) * 64)} ${n(fy + Math.sin(-0.24) * 64)} Z" fill="#7cc576" ${OUTLINE}/>`;
  let stalks = '', eyes = '';
  for (let i = 0; i < count; i++) {
    const deg = -162 + (144 * i) / (count - 1), a = (deg * Math.PI) / 180;
    const ex = fx + Math.cos(a) * 66, ey = fy + Math.sin(a) * 66;
    stalks += `M${fx} ${fy} L${n(ex)} ${n(ey)} `;
    eyes += `<g transform="translate(${n(ex)} ${n(ey)}) rotate(${n(deg)})"><ellipse rx="23" ry="15" fill="#2e9e5b" ${OUTLINE}/><ellipse cx="2" rx="13" ry="9.5" fill="${GOLD}"/><ellipse cx="3" rx="8.5" ry="6.5" fill="${teal}"/><circle cx="4" r="4" fill="#123c8c"/></g>`;
  }
  for (let i = 0; i < count - 1; i++) {
    const deg = -162 + (144 * (i + 0.5)) / (count - 1), a = (deg * Math.PI) / 180;
    eyes += `<g transform="translate(${n(fx + Math.cos(a) * 38)} ${n(fy + Math.sin(a) * 38)}) rotate(${n(deg)})"><ellipse rx="13" ry="9" fill="#3fae6a" stroke="#fff" stroke-width="3"/><circle cx="2" r="4.5" fill="${teal}"/></g>`;
  }
  s += `<path d="${stalks}" stroke="#fff" stroke-width="3" opacity=".7"/>${eyes}`;
  // Wings, body, head and crest.
  s += `<path d="M-14 30 Q-40 44 -30 74 Q-14 70 -8 50 Z M14 30 Q40 44 30 74 Q14 70 8 50 Z" fill="#c9965a" ${OUTLINE}/>
<path d="M0 -22 C12 -22 14 -2 11 16 C28 30 30 66 0 78 C-30 66 -28 30 -11 16 C-14 -2 -12 -22 0 -22 Z" fill="${blue}" ${OUTLINE}/>
<ellipse cx="0" cy="48" rx="11" ry="20" fill="#4fa3ff" opacity=".55"/>
<path d="M-6 82 l-4 10 M6 82 l4 10" stroke="#e8902c" stroke-width="5" stroke-linecap="round"/>
<path d="M0 -40 L-11 -60 M0 -40 L0 -64 M0 -40 L11 -60" stroke="${blue}" stroke-width="3" stroke-linecap="round"/>
<circle cx="-11" cy="-61" r="4.5" fill="${blue}"/><circle cx="0" cy="-65" r="4.5" fill="${blue}"/><circle cx="11" cy="-61" r="4.5" fill="${blue}"/>
<circle cx="0" cy="-28" r="15" fill="${blue}" ${OUTLINE}/>
<circle cx="-6" cy="-31" r="4.5" fill="#fff"/><circle cx="6" cy="-31" r="4.5" fill="#fff"/><circle cx="-5.5" cy="-30.5" r="2.4" fill="#123"/><circle cx="6.5" cy="-30.5" r="2.4" fill="#123"/>
<path d="M-4 -24 L4 -24 L0 -15 Z" fill="#f2b33d"/>`;
  return s;
};

/** A parade drum with two sticks. */
const drum: Piece = (r, p) => {
  const body = pick(r, p.acc), w = 128, h = 92, ry = 18, y = 74, top = y - h;
  let zig = `M${-w / 2} ${top + 12}`;
  for (let i = 1; i <= 6; i++) zig += ` L${n(-w / 2 + (w / 6) * i)} ${i % 2 ? y - 10 : top + 12}`;
  return `<path d="M-14 ${top - 6} L-70 -86 M14 ${top - 6} L70 -86" stroke="#fff" stroke-width="13" stroke-linecap="round"/>
<path d="M-14 ${top - 6} L-70 -86 M14 ${top - 6} L70 -86" stroke="${WOOD}" stroke-width="7" stroke-linecap="round"/>
<circle cx="-70" cy="-86" r="9" fill="${SAFFRON}" stroke="#fff" stroke-width="3"/><circle cx="70" cy="-86" r="9" fill="${GREEN}" stroke="#fff" stroke-width="3"/>
<path d="M${-w / 2} ${top} V${y} A${w / 2} ${ry} 0 0 0 ${w / 2} ${y} V${top} Z" fill="${body}" ${OUTLINE}/>
<path d="${zig}" fill="none" stroke="${CREAM}" stroke-width="5" stroke-linejoin="round"/>
<path d="M${-w / 2} ${y} A${w / 2} ${ry} 0 0 0 ${w / 2} ${y}" fill="none" stroke="${GREEN}" stroke-width="10"/>
<path d="M${-w / 2} ${top + 4} A${w / 2} ${ry} 0 0 0 ${w / 2} ${top + 4}" fill="none" stroke="${SAFFRON}" stroke-width="9"/>
<ellipse cx="0" cy="${top}" rx="${w / 2}" ry="${ry}" fill="${CREAM}" ${OUTLINE}/>`;
};

/** India Gate, a sandstone arch, under three tricolour flypast trails. */
const indiaGate: Piece = (r, p) => {
  const st = '#e7b57f', dk = '#c98d55';
  let s = '';
  if (r() < 0.65) {
    const lift = between(r, -6, 6);
    TRI.forEach((c, i) => {
      const d = `M-88 ${n(30 + i * 12 + lift)} Q0 ${n(-196 + i * 12 + lift)} 88 ${n(30 + i * 12 + lift)}`;
      if (c === WHITE) s += `<path d="${d}" fill="none" stroke="${p.ink}" stroke-opacity=".14" stroke-width="15" stroke-linecap="round"/>`;
      s += `<path d="${d}" fill="none" stroke="${c}" stroke-width="10" stroke-linecap="round"/>`;
    });
  }
  s += g(`<path d="M-90 92 V82 H-80 V74 H80 V82 H90 V92 Z" fill="${dk}" ${OUTLINE}/>
<path d="M-66 76 V-26 H66 V76 H28 V18 A28 28 0 0 0 -28 18 V76 Z" fill="${st}" ${OUTLINE}/>
<path d="M-28 76 V18 A28 28 0 0 1 28 18 V76" fill="none" stroke="${p.ink}" stroke-opacity=".12" stroke-width="6"/>
<rect x="-73" y="-36" width="146" height="12" rx="4" fill="${dk}" ${OUTLINE}/>
<rect x="-54" y="-58" width="108" height="24" rx="3" fill="${st}" ${OUTLINE}/>
<rect x="-61" y="-66" width="122" height="10" rx="4" fill="${dk}" ${OUTLINE}/>
<path d="M-24 -66 A24 15 0 0 1 24 -66 Z" fill="${st}" ${OUTLINE}/>
<path d="M-54 -6 h18 M36 -6 h18 M-54 40 h18 M36 40 h18 M-30 -46 h60" stroke="${dk}" stroke-width="5" stroke-linecap="round"/>`, 0, 12, 0.88);
  return s;
};

/** The Red Fort's Lahori Gate: red sandstone, white-domed pavilions and the flag on top. */
const redFort: Piece = (_r, p) => {
  const red = '#c9573f', dk = '#9c3d2b', marble = '#fbefdc';
  const chhatri = (x: number, y: number, w: number) =>
    `<rect x="${n(x - w / 2)}" y="${n(y)}" width="${n(w)}" height="${n(w * 0.55)}" fill="${red}" stroke="#fff" stroke-width="3"/>
<path d="M${n(x - w * 0.62)} ${n(y + 1)} Q${n(x - w * 0.5)} ${n(y - w * 0.75)} ${n(x)} ${n(y - w * 0.82)} Q${n(x + w * 0.5)} ${n(y - w * 0.75)} ${n(x + w * 0.62)} ${n(y + 1)} Z" fill="${marble}" ${soft(p.ink, 6)}/>
<path d="M${n(x - w * 0.62)} ${n(y + 1)} Q${n(x - w * 0.5)} ${n(y - w * 0.75)} ${n(x)} ${n(y - w * 0.82)} Q${n(x + w * 0.5)} ${n(y - w * 0.75)} ${n(x + w * 0.62)} ${n(y + 1)} Z" fill="${marble}"/>
<circle cx="${n(x)}" cy="${n(y - w * 0.86)}" r="${n(Math.max(2.5, w * 0.08))}" fill="${GOLD}"/>`;
  let merlons = '';
  for (let x = -92; x < 92; x += 14) merlons += `<path d="M${x} 36 h10 v-6 a5 5 0 0 0 -10 0 z"/>`;
  let s = `<g fill="${red}" stroke="#fff" stroke-width="2">${merlons}</g>
<rect x="-94" y="34" width="188" height="58" fill="${red}" ${OUTLINE}/>
<path d="M-94 52 H94" stroke="${dk}" stroke-width="3"/>
<rect x="-80" y="-30" width="30" height="122" fill="${red}" ${OUTLINE}/><rect x="50" y="-30" width="30" height="122" fill="${red}" ${OUTLINE}/>
<rect x="-46" y="-14" width="92" height="106" fill="${red}" ${OUTLINE}/>
<path d="M-24 92 V38 Q-24 14 0 8 Q24 14 24 38 V92 Z" fill="${dk}" stroke="#fff" stroke-width="3"/>
<path d="M-34 -2 h68" stroke="${marble}" stroke-width="4"/>
<path d="M-74 10 h18 M56 10 h18 M-74 50 h18 M56 50 h18" stroke="${dk}" stroke-width="5" stroke-linecap="round"/>`;
  s += chhatri(-65, -30, 26) + chhatri(65, -30, 26);
  for (let i = 0; i < 5; i++) s += chhatri(-36 + i * 18, -14, 12);
  // The flag flies over the gate.
  s += `<line x1="0" y1="-90" x2="0" y2="-26" stroke="${POLE}" stroke-width="4" stroke-linecap="round"/>${wavyFlag(1, -86, 48, 32, TRI, p.ink, 3)}${chakra(25, -70, 4)}`;
  return s;
};

// ---------------------------------------------------------------- New Year

/** A big bunch of balloons tied with a bow. */
const nyBalloons: Piece = (r, p) => {
  const c = [...p.acc].sort(() => r() - 0.5);
  return balloonBunch([[-50, -36, 34, c[0]], [50, -36, 34, c[1]], [0, -52, 34, c[2]], [-26, -2, 33, c[3]], [26, -2, 33, c[4 % c.length]]], p.ink, pick(r, p.acc), r);
};

/** One balloon on its string. */
const nyBalloon: Piece = (r, p) => {
  const c = pick(r, p.acc);
  return `<path d="M0 46 q-14 20 2 30 t-4 16" fill="none" stroke="${p.ink}" stroke-width="3" opacity=".45"/>` + balloonBody(0, -26, 52, c, p.ink) + (r() < 0.5 ? sparkle(64, -70, 12, GOLD) : '');
};

/** A striped party hat with a pompom. */
function hat(c: string, c2: string, ink: string) {
  return `<path d="M-56 70 L0 -70 L56 70 Z" fill="${c}" ${OUTLINE}/>
<path d="M-40 30 L42 6 M-26 -6 L26 -24 M-50 58 L50 46" stroke="${c2}" stroke-width="10" stroke-linecap="round"/>
<circle cx="-14" cy="18" r="5" fill="#fff"/><circle cx="18" cy="-8" r="4" fill="#fff"/><circle cx="10" cy="34" r="5" fill="#fff"/>
${pale('<path d="M-62 72 q8 -12 16 0 q8 -12 16 0 q8 -12 16 0 q8 -12 16 0 q8 -12 16 0 q8 -12 16 0 q8 -12 16 0 v12 h-112 z"', CREAM, ink, 6)}
<circle cx="0" cy="-74" r="16" fill="${GOLD}" ${OUTLINE}/>`;
}
const nyHat: Piece = (r, p) => {
  const [c, c2] = [...p.acc].sort(() => r() - 0.5);
  return g(hat(c, c2, p.ink), 0, 4, 1.05);
};

/** A curly paper streamer. */
function curl(x0: number, y0: number, x1: number, y1: number, loops: number, amp: number, colour: string) {
  let d = '';
  const steps = loops * 16;
  for (let i = 0; i <= steps; i++) {
    const u = i / steps, th = u * loops * 2 * Math.PI;
    const x = x0 + (x1 - x0) * u + amp * Math.sin(th), y = y0 + (y1 - y0) * u - amp * Math.cos(th) + amp;
    d += `${i ? 'L' : 'M'}${n(x)} ${n(y)}`;
  }
  return `<path d="${d}" fill="none" stroke="#fff" stroke-width="11" stroke-linecap="round" stroke-linejoin="round"/><path d="${d}" fill="none" stroke="${colour}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>`;
}

/** A party hat with curly streamers and confetti flying round it. */
const nyParty: Piece = (r, p) => {
  const [c, c2, c3, c4] = [...p.acc].sort(() => r() - 0.5);
  let s = curl(-90, -40, -40, 70, 3, 13, c3) + curl(42, 70, 84, -60, 3, 12, c4);
  s += g(hat(c, c2, p.ink), 0, 10, 0.95);
  for (let i = 0; i < 8; i++) {
    const a = between(r, 0, 2 * Math.PI), d = between(r, 66, 84);
    const x = Math.cos(a) * d, y = Math.sin(a) * d * 0.95;
    s += r() < 0.5 ? `<rect x="${n(x - 6)}" y="${n(y - 3)}" width="12" height="6" rx="2" fill="${pick(r, p.acc)}" transform="rotate(${n(between(r, 0, 180))} ${n(x)} ${n(y)})"/>` : `<circle cx="${n(x)}" cy="${n(y)}" r="4.5" fill="${pick(r, p.acc)}"/>`;
  }
  return s;
};

/** A confetti popper bursting. */
const nyPopper: Piece = (r, p) => {
  const [c, c2] = [...p.acc].sort(() => r() - 0.5);
  let s = '';
  for (let i = 0; i < 3; i++) s += curl(-20 + i * 14, 8 - i * 6, 20 + i * 30, -80 + i * 22, 2, 8, pick(r, p.acc));
  for (let i = 0; i < 14; i++) {
    const x = between(r, -10, 86), y = between(r, -88, 16);
    if (Math.hypot(x + 30, y - 30) < 34) continue;
    const k = r();
    s += k < 0.4 ? `<rect x="${n(x - 7)}" y="${n(y - 3.5)}" width="14" height="7" rx="2" fill="${pick(r, p.acc)}" transform="rotate(${n(between(r, 0, 180))} ${n(x)} ${n(y)})"/>`
      : k < 0.75 ? `<circle cx="${n(x)}" cy="${n(y)}" r="5" fill="${pick(r, p.acc)}"/>` : star(x, y, 9, GOLD, r());
  }
  s += g(`<path d="M-12 74 L12 74 L32 -18 L-32 -18 Z" fill="${c}" ${OUTLINE}/>
<path d="M-28 4 L28 4 M-22 32 L22 32 M-16 56 L16 56" stroke="${c2}" stroke-width="9"/>
<ellipse cx="0" cy="-18" rx="32" ry="10" fill="${c2}" ${OUTLINE}/><ellipse cx="0" cy="-18" rx="22" ry="5" fill="#fff" opacity=".7"/>
<rect x="-10" y="72" width="20" height="16" rx="5" fill="${GOLD}" stroke="#fff" stroke-width="3"/>`, -40, 22, 0.85, 42);
  return s;
};

/** Fireworks: three bursts with stars. */
const nyFireworks: Piece = (r, p) => {
  const [a, b, c] = [...p.acc].sort(() => r() - 0.5);
  return pop(-30, -26, 44, a, 12) + pop(46, -42, 32, b, 10) + pop(20, 42, 32, c, 10) +
    star(-30, -26, 14, GOLD, r()) + star(46, -42, 11, GOLD, r()) + star(20, 42, 11, GOLD, r()) +
    `<path d="M-62 92 Q-56 60 -40 44" fill="none" stroke="${a}" stroke-width="4" stroke-dasharray="2 9" stroke-linecap="round"/>` + sparkle(-66, 50, 10, '#fff');
};
const nyBurst: Piece = (r, p) => pop(0, 0, 66, pick(r, p.acc), whole(r, 12, 14)) + star(0, 0, 22, GOLD, r()) + sparkle(-58, -62, 9, '#fff');

/** A pile of three presents. */
const nyGifts: Piece = (r, p) => {
  const c = [...p.acc].sort(() => r() - 0.5);
  return gift(-88, 6, 116, 84, c[0], CREAM) + gift(34, 34, 56, 56, c[1], CREAM) + gift(-66, -48, 72, 52, c[2], CREAM) + sparkle(62, -26, 14, GOLD);
};
const nyGift: Piece = (r, p) => {
  const [a, b] = [...p.acc].sort(() => r() - 0.5);
  return gift(-70, -40, 140, 124, a, CREAM) + `<circle cx="0" cy="-48" r="9" fill="${b}" stroke="#fff" stroke-width="3"/>`;
};

/** A shooting star with a trail. */
const nyStar: Piece = (r, p) => {
  const [a, b] = [...p.acc].sort(() => r() - 0.5);
  return `<path d="M-86 80 Q-30 40 14 -6" fill="none" stroke="${a}" stroke-width="12" stroke-linecap="round" opacity=".55"/>
<path d="M-60 88 Q-10 50 22 10 M-90 50 Q-44 20 4 -14" fill="none" stroke="${b}" stroke-width="6" stroke-linecap="round" opacity=".55"/>` +
    star(30, -30, 58, GOLD, 0.1) + sparkle(-50, -60, 12, a) + sparkle(76, 50, 10, b);
};

/** Three curly streamers. */
const nyStreamers: Piece = (r, p) => {
  const c = [...p.acc].sort(() => r() - 0.5);
  return curl(-86, -70, 70, -30, 4, 12, c[0]) + curl(-80, -10, 76, 30, 4, 12, c[1]) + curl(-72, 50, 80, 70, 4, 11, c[2]);
};

/** Hangers for New Year: a star, a pennant and a paper honeycomb ball. */
const nyHangStar: Piece = (r, p) => `<line x1="0" y1="-95" x2="0" y2="-60" stroke="${p.ink}" stroke-width="3" opacity=".45"/>` + star(0, 4, 72, pick(r, [GOLD, ...p.acc]), 0) + sparkle(-50, 60, 9, '#fff');
const nyPennant: Piece = (r, p) => {
  const c = pick(r, p.acc);
  let dots = '';
  for (const [x, y] of [[-26, -50], [26, -50], [0, -24], [-12, 6], [12, 6], [0, 36]]) dots += `<circle cx="${x}" cy="${y}" r="6" fill="#fff" opacity=".85"/>`;
  return pennant([c], p.ink, dots);
};
const nyBall: Piece = (r, p) => {
  const c = [...p.acc].sort(() => r() - 0.5);
  let s = `<line x1="0" y1="-95" x2="0" y2="-58" stroke="${p.ink}" stroke-width="3" opacity=".45"/><circle cx="0" cy="8" r="66" fill="${c[0]}" ${OUTLINE}/>`;
  for (let i = 1; i <= 4; i++) {
    const y = 8 - 66 + i * 26.4, half = Math.sqrt(66 * 66 - (y - 8) ** 2);
    s += `<path d="M${n(-half)} ${n(y)} Q0 ${n(y + 12)} ${n(half)} ${n(y)}" fill="none" stroke="${c[i % 3 + 1]}" stroke-width="12"/>`;
  }
  return s + `<circle cx="0" cy="8" r="66" fill="none" ${OUTLINE}/><rect x="-12" y="-64" width="24" height="10" rx="3" fill="${GOLD}" stroke="#fff" stroke-width="2"/>
<path d="M-6 74 v16 M0 74 v20 M6 74 v16" stroke="${c[1]}" stroke-width="4" stroke-linecap="round"/><ellipse cx="-26" cy="-22" rx="9" ry="14" fill="#fff" opacity=".45" transform="rotate(35 -26 -22)"/>`;
};

// ---------------------------------------------------------------- Gandhi Jayanti

const KHADI = '#f3ead2';

/** A charkha (spinning wheel) on its stand, the thread running to the spindle. */
const charkha: Piece = (r, p) => {
  const cx = -22, cy = -6, R = 62, spokes = pick(r, [8, 10, 12]), rot = r() * Math.PI;
  let sp = '';
  for (let i = 0; i < spokes; i++) {
    const a = rot + (2 * Math.PI * i) / spokes;
    sp += `M${cx} ${cy} L${n(cx + Math.cos(a) * (R - 4))} ${n(cy + Math.sin(a) * (R - 4))} `;
  }
  return `<rect x="-92" y="74" width="184" height="16" rx="6" fill="${WOOD_DARK}" ${OUTLINE}/>
<path d="M${cx - 44} 76 L${cx} ${cy} L${cx + 44} 76" fill="none" stroke="#fff" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M${cx - 44} 76 L${cx} ${cy} L${cx + 44} 76" fill="none" stroke="${WOOD}" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>
<rect x="62" y="22" width="14" height="54" rx="4" fill="${WOOD}" ${OUTLINE}/>
<path d="${sp}" stroke="#fff" stroke-width="9" stroke-linecap="round"/><path d="${sp}" stroke="${WOOD}" stroke-width="5" stroke-linecap="round"/>
<circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="#fff" stroke-width="17"/>
<circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="${WOOD}" stroke-width="11"/>
<circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="${WOOD_DARK}" stroke-width="3" stroke-dasharray="3 10"/>
<circle cx="${cx}" cy="${cy}" r="14" fill="${pick(r, p.acc)}" ${OUTLINE}/>
<path d="M${cx} ${cy} l-26 -20" stroke="${WOOD_DARK}" stroke-width="6" stroke-linecap="round"/><circle cx="${cx - 26}" cy="${cy - 20}" r="6" fill="${WOOD_DARK}" stroke="#fff" stroke-width="2.5"/>
<path d="M${cx + 8} ${cy - R} L70 22 M${cx + 8} ${cy + R} L70 30" stroke="${p.ink}" stroke-width="1.6" opacity=".4"/>
<path d="M52 26 H92" stroke="${WOOD_DARK}" stroke-width="4" stroke-linecap="round"/>
${pale('<ellipse cx="80" cy="26" rx="11" ry="8"', '#fffaf0', p.ink, 6)}`;
};

/** Round wire spectacles resting on folded khadi. */
const spectacles: Piece = (r, p) => {
  const frame = '#5d4037', kh2 = pick(r, ['#cfe3b0', '#bfd9c8', '#e8d6b0']);
  return `${pale('<path d="M-92 82 L-82 40 H82 L92 82 Z"', KHADI, p.ink, 8)}
<path d="M-86 60 H86" stroke="${kh2}" stroke-width="9"/><path d="M-84 72 H84" stroke="${p.ink}" stroke-opacity=".1" stroke-width="3" stroke-dasharray="7 8"/>
<path d="M-86 -12 q-10 24 4 48 M86 -12 q10 24 -4 48" fill="none" stroke="${frame}" stroke-width="5" stroke-linecap="round"/>
<circle cx="-46" cy="-14" r="38" fill="#eaf6ff" fill-opacity=".8" stroke="#fff" stroke-width="12"/><circle cx="46" cy="-14" r="38" fill="#eaf6ff" fill-opacity=".8" stroke="#fff" stroke-width="12"/>
<circle cx="-46" cy="-14" r="38" fill="none" stroke="${frame}" stroke-width="5.5"/><circle cx="46" cy="-14" r="38" fill="none" stroke="${frame}" stroke-width="5.5"/>
<path d="M-8 -20 q8 -12 16 0" fill="none" stroke="#fff" stroke-width="10" stroke-linecap="round"/><path d="M-8 -20 q8 -12 16 0" fill="none" stroke="${frame}" stroke-width="5" stroke-linecap="round"/>
<path d="M-66 -28 a24 24 0 0 1 18 -16 M26 -28 a24 24 0 0 1 18 -16" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round"/>`;
};

/** The spectacles alone, a little bigger. */
const specsSmall: Piece = () => {
  const frame = '#5d4037';
  return `<path d="M-90 -6 q-6 30 6 50 M90 -6 q6 30 -6 50" fill="none" stroke="${frame}" stroke-width="6" stroke-linecap="round"/>
<circle cx="-46" cy="0" r="40" fill="#eaf6ff" stroke="#fff" stroke-width="13"/><circle cx="46" cy="0" r="40" fill="#eaf6ff" stroke="#fff" stroke-width="13"/>
<circle cx="-46" cy="0" r="40" fill="none" stroke="${frame}" stroke-width="6"/><circle cx="46" cy="0" r="40" fill="none" stroke="${frame}" stroke-width="6"/>
<path d="M-6 -6 q6 -12 12 0" fill="none" stroke="${frame}" stroke-width="6" stroke-linecap="round"/>
<path d="M-68 -14 a26 26 0 0 1 20 -18 M24 -14 a26 26 0 0 1 20 -18" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round"/>`;
};

/** A white dove of peace with a green sprig. */
const dove: Piece = (r, p) => {
  const tw = '#5a8f3a';
  const body = `<path d="M-58 -2 L-120 -34 L-112 6 L-122 30 Z"/><ellipse cx="0" cy="0" rx="74" ry="36"/><circle cx="62" cy="-26" r="27"/><path d="M-30 -10 Q-40 -112 30 -114 Q8 -60 30 -12 Z"/>`;
  return g(`<path d="M104 -18 q16 18 6 46" stroke="${tw}" stroke-width="5" fill="none"/>${leaf(108, -6, 30, LEAF, 30)}${leaf(110, 14, 28, LEAF_DARK, -20)}${leaf(112, 30, 24, LEAF, 40)}
<g fill="#fff" ${soft(p.ink, 9)}>${body}</g><g fill="#fff">${body}</g>
<path d="M86 -30 l22 8 l-22 6 z" fill="#ff9f43"/><circle cx="70" cy="-32" r="4.5" fill="${p.ink}"/>
<path d="M-12 -30 Q-8 -70 14 -88 M2 -24 Q8 -56 22 -70 M-60 4 l-30 -14 M-60 12 l-34 4" stroke="${p.ink}" stroke-opacity=".14" stroke-width="4" fill="none" stroke-linecap="round"/>`, -2, 26, 0.72, r() < 0.5 ? -6 : 0);
};

/** A walking stick with a pair of simple sandals. */
const stickSandals: Piece = (_r, p) => {
  const sole = '#a1683a', strap = '#6d4326';
  const sandal = (x: number, y: number, rot: number) =>
    g(`<path d="M0 -44 C20 -44 22 -16 18 4 C16 24 22 44 0 46 C-22 44 -16 24 -18 4 C-22 -16 -20 -44 0 -44 Z" fill="${sole}" ${OUTLINE}/>
<path d="M0 -44 C14 -42 16 -20 13 2 C11 22 16 38 0 40 C-16 38 -11 22 -13 2 C-16 -20 -14 -42 0 -44 Z" fill="#c68a52"/>
<path d="M-15 -4 Q0 -24 15 -4" fill="none" stroke="${strap}" stroke-width="7" stroke-linecap="round"/><circle cx="0" cy="-28" r="5" fill="${strap}"/>`, x, y, 1, rot);
  return `<path d="M-74 88 L52 -74" stroke="#fff" stroke-width="14" stroke-linecap="round"/><path d="M-74 88 L52 -74" stroke="${WOOD}" stroke-width="8" stroke-linecap="round"/>
<path d="M52 -74 q14 -18 30 -8 q10 8 2 18" fill="none" stroke="#fff" stroke-width="14" stroke-linecap="round"/><path d="M52 -74 q14 -18 30 -8 q10 8 2 18" fill="none" stroke="${WOOD}" stroke-width="8" stroke-linecap="round"/>
<path d="M-40 44 l10 -12 M10 -20 l10 -12" stroke="${WOOD_DARK}" stroke-width="3" opacity=".6"/>
<ellipse cx="30" cy="84" rx="62" ry="8" fill="${p.ink}" opacity=".08"/>` + sandal(6, 40, -12) + sandal(56, 34, 10);
};

/** A cotton boll: white fluff bursting from a brown star-shaped husk; (x, y) its middle. */
function boll(x: number, y: number, sc: number, ink: string) {
  let husk = '';
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + (2 * Math.PI * (i + 0.5)) / 5;
    husk += `<path d="M${n(Math.cos(a - 0.5) * 14)} ${n(Math.sin(a - 0.5) * 14)} L${n(Math.cos(a) * 36)} ${n(Math.sin(a) * 36)} L${n(Math.cos(a + 0.5) * 14)} ${n(Math.sin(a + 0.5) * 14)} Z" fill="#8a5a34" ${OUTLINE}/>`;
  }
  let fluff = '';
  for (const [dx, dy, R] of [[-12, -8, 15], [12, -8, 15], [-12, 10, 14], [12, 10, 14], [0, 0, 13]]) fluff += pale(`<circle cx="${dx}" cy="${dy}" r="${R}"`, '#fffdf7', ink, 6);
  return g(`${husk}${fluff}<path d="M-12 -8 q6 6 0 16 M12 -8 q-6 6 0 16" stroke="${ink}" stroke-opacity=".12" stroke-width="2.5" fill="none"/>`, x, y, sc);
}

/** A cotton plant: fluffy bolls on a stem with leaves. */
const cotton: Piece = (r, p) =>
  `<path d="M0 92 Q-6 40 4 -10 M2 46 Q-26 28 -46 -2 M4 16 Q34 -2 48 -34" fill="none" stroke="#6d8b3a" stroke-width="6" stroke-linecap="round"/>` +
  leaf(0, 66, 54, LEAF, -150) + leaf(2, 60, 50, LEAF_DARK, -30) + leaf(4, 30, 40, LEAF, 200 - between(r, 0, 20)) +
  boll(-48, -8, 1.05, p.ink) + boll(48, -38, 1, p.ink) + boll(4, -46, 1.2, p.ink);

/** Folded khadi cloth with a hank of spun yarn and a spindle. */
const khadi: Piece = (r, p) => {
  const c1 = pick(r, [KHADI, '#efe4c6']), c2 = pick(r, ['#cfe3b0', '#bfd9c8', '#e8d6b0']), c3 = pick(r, ['#f6d7a7', KHADI]);
  const fold = (y: number, w: number, c: string) => `${pale(`<rect x="${-w / 2}" y="${y}" width="${w}" height="30" rx="9"`, c, p.ink, 7)}<path d="M${-w / 2 + 8} ${y + 22} H${w / 2 - 8}" stroke="${p.ink}" stroke-opacity=".1" stroke-width="3" stroke-dasharray="6 7"/>`;
  return fold(58, 180, c1) + fold(30, 164, c2) + fold(2, 150, c3) +
    `${pale('<ellipse cx="-24" cy="-26" rx="44" ry="28"', '#fffaf0', p.ink, 8)}
<path d="M-60 -32 Q-24 -60 12 -32 M-64 -20 Q-24 -46 16 -20 M-60 -10 Q-24 -30 10 -8" fill="none" stroke="${p.ink}" stroke-opacity=".14" stroke-width="3"/>
<path d="M30 -2 L84 -84" stroke="${WOOD}" stroke-width="6" stroke-linecap="round"/>${pale('<ellipse cx="58" cy="-44" rx="11" ry="20" transform="rotate(33 58 -44)"', '#fffaf0', p.ink, 6)}
<path d="M48 -52 l22 14 M44 -44 l22 14" stroke="${p.ink}" stroke-opacity=".14" stroke-width="2.5"/>`;
};

/** Hangers for Gandhi Jayanti: a cotton boll on a thread. */
const cottonHang: Piece = (_r, p) => `<line x1="0" y1="-95" x2="0" y2="-40" stroke="${p.ink}" stroke-width="3" opacity=".45"/>
<path d="M0 -46 v-10" stroke="#6d8b3a" stroke-width="5"/>${leaf(0, -50, 34, LEAF, -30)}${leaf(0, -50, 34, LEAF_DARK, -150)}` + boll(0, 18, 1.9, p.ink);

// ---------------------------------------------------------------- Kannada Rajyotsava

/** Karnataka's flag on its pole. */
const kaFlag: Piece = (r, p) => flagOnPole(KA, p.ink, false, between(r, 5, 9));

/** An onion dome on a drum; tip at y = base − drum − h. */
function dome(x: number, base: number, w: number, h: number, fill: string, drumFill: string) {
  const dh = w * 0.3, b = base - dh;
  return `<rect x="${n(x - w * 0.42)}" y="${n(b)}" width="${n(w * 0.84)}" height="${n(dh)}" fill="${drumFill}" stroke="#fff" stroke-width="3"/>
<path d="M${n(x - w / 2)} ${n(b)} C${n(x - w / 2)} ${n(b - h * 0.55)} ${n(x - w * 0.1)} ${n(b - h * 0.7)} ${n(x)} ${n(b - h)} C${n(x + w * 0.1)} ${n(b - h * 0.7)} ${n(x + w / 2)} ${n(b - h * 0.55)} ${n(x + w / 2)} ${n(b)} Z" fill="${fill}" ${OUTLINE}/>
<path d="M${n(x - w * 0.22)} ${n(b - h * 0.2)} q${n(w * 0.04)} ${n(-h * 0.3)} ${n(w * 0.18)} ${n(-h * 0.5)}" stroke="#fff" stroke-width="3" fill="none" opacity=".6" stroke-linecap="round"/>
<circle cx="${n(x)}" cy="${n(b - h - 4)}" r="${n(Math.max(3, w * 0.07))}" fill="${GOLD}" stroke="#fff" stroke-width="2"/>`;
}

/** The Mysuru Palace: arches, towers with onion domes, Karnataka flags on the side domes. */
const palace: Piece = (r, p) => {
  const body = '#f2cf96', dk = '#d9a35f', domeC = pick(r, ['#e0533f', '#d84a3a', '#e46a4c']);
  let s = `<rect x="-94" y="80" width="188" height="12" rx="4" fill="${dk}" ${OUTLINE}/>
<rect x="-86" y="18" width="172" height="64" fill="${body}" ${OUTLINE}/>
<rect x="-90" y="12" width="180" height="10" rx="4" fill="${dk}" ${OUTLINE}/>`;
  for (let i = 0; i < 5; i++) {
    const ax = -86 + 34.4 * i + 17.2;
    s += `<path d="M${n(ax - 10)} 80 V54 A10 10 0 0 1 ${n(ax + 10)} 54 V80 Z" fill="${dk}" stroke="#fff" stroke-width="3"/>`;
  }
  for (const side of [-1, 1]) {
    const tx = side * 64;
    s += `<line x1="${tx}" y1="-82" x2="${tx}" y2="-46" stroke="${POLE}" stroke-width="3" stroke-linecap="round"/>${wavyFlag(tx + 1, -82, 26, 16, KA, p.ink, 2)}
<rect x="${tx - 17}" y="-10" width="34" height="24" fill="${body}" ${OUTLINE}/><path d="M${tx - 6} 12 V2 a6 6 0 0 1 12 0 V12 Z" fill="${dk}"/>` + dome(tx, -8, 32, 30, domeC, body);
  }
  s += `<rect x="-28" y="-18" width="56" height="34" fill="${body}" ${OUTLINE}/>
<rect x="-32" y="-22" width="64" height="8" rx="3" fill="${dk}" ${OUTLINE}/>
<path d="M-10 14 V2 a10 10 0 0 1 20 0 V14 Z" fill="${dk}" stroke="#fff" stroke-width="3"/>` + dome(0, -20, 50, 50, domeC, body);
  // Yellow-and-red pennants between the towers.
  for (const [x0, x1] of [[-46, -30], [30, 46]]) for (let i = 0; i < 2; i++) {
    const x = x0 + (x1 - x0) * (i + 0.5) / 2;
    s += `<path d="M${n(x - 5)} 24 h10 l-5 10 z" fill="${KA[i]}" stroke="#fff" stroke-width="1.5"/>`;
  }
  return s;
};

/** A friendly decorated elephant (as at Mysuru Dasara), facing right, no rider. */
const elephant: Piece = (r, p) => {
  const grey = '#a9b4c4', grey2 = '#94a0b2', cloth = pick(r, [KA_RED, '#c2185b']), trim = KA_YELLOW;
  let s = `<path d="M-74 0 q-18 20 -10 48" fill="none" stroke="${grey2}" stroke-width="6" stroke-linecap="round"/><path d="M-88 46 l-4 10 l8 -3 l4 9 l3 -13 z" fill="${grey2}"/>
<rect x="-56" y="24" width="24" height="64" rx="10" fill="${grey2}" ${OUTLINE}/><rect x="14" y="24" width="24" height="64" rx="10" fill="${grey2}" ${OUTLINE}/>
<ellipse cx="-14" cy="12" rx="64" ry="46" fill="${grey}" ${OUTLINE}/>
<rect x="-44" y="30" width="26" height="60" rx="11" fill="${grey}" ${OUTLINE}/><rect x="26" y="30" width="26" height="60" rx="11" fill="${grey}" ${OUTLINE}/>
<path d="M-38 84 h6 M-28 84 h6 M32 84 h6 M42 84 h6" stroke="#fff" stroke-width="4" stroke-linecap="round" opacity=".8"/>`;
  s += `<path d="M-60 -22 Q-14 -46 30 -26 L26 30 Q-14 42 -56 30 Z" fill="${cloth}" ${OUTLINE}/>
<path d="M26 30 Q-14 42 -56 30" fill="none" stroke="${trim}" stroke-width="8"/>`;
  for (let i = 0; i < 5; i++) {
    const t = i / 4, x = -52 + 76 * t, y = 31 + Math.sin(Math.PI * t) * 9;
    s += `<path d="M${n(x)} ${n(y)} v9" stroke="${trim}" stroke-width="3" stroke-linecap="round"/><circle cx="${n(x)}" cy="${n(y + 12)}" r="4" fill="${trim}" stroke="#fff" stroke-width="1.5"/>`;
  }
  for (let i = 0; i < 3; i++) s += `<circle cx="${n(-40 + i * 24)}" cy="${n(-2 + between(r, -3, 3))}" r="6" fill="${trim}" stroke="#fff" stroke-width="2"/>`;
  const trunk = 'M58 6 Q80 22 76 48 Q74 64 86 62';
  s += `<path d="${trunk}" fill="none" stroke="#fff" stroke-width="24" stroke-linecap="round"/><path d="${trunk}" fill="none" stroke="${grey}" stroke-width="16" stroke-linecap="round"/>
<path d="M70 30 h10 M70 44 h10" stroke="${grey2}" stroke-width="3" stroke-linecap="round"/>
${pale('<path d="M50 18 q12 10 24 4 q-8 -2 -14 -10 z"', '#fffaf0', p.ink, 5)}
<circle cx="40" cy="-14" r="34" fill="${grey}" ${OUTLINE}/>
<path d="M30 -38 Q-6 -42 -2 -8 Q2 26 30 16 Z" fill="${grey2}" ${OUTLINE}/><path d="M24 -30 Q4 -30 6 -8 Q8 12 24 8" fill="none" stroke="#f4c6c9" stroke-width="5" stroke-linecap="round" opacity=".8"/>
<path d="M44 -48 Q66 -44 72 -18 L56 2 Q48 -24 44 -48 Z" fill="${cloth}" stroke="#fff" stroke-width="3" stroke-linejoin="round"/><circle cx="58" cy="-24" r="5" fill="${trim}" stroke="#fff" stroke-width="1.5"/>
<circle cx="50" cy="-12" r="4.5" fill="${p.ink}"/><circle cx="51.5" cy="-13.5" r="1.6" fill="#fff"/><circle cx="42" cy="4" r="6" fill="#ff8fa3" opacity=".5"/>
<circle cx="26" cy="30" r="7" fill="${GOLD}" stroke="#fff" stroke-width="2.5"/>`;
  return g(s, -2, -4);
};

/** A white jasmine (mallige) flower; s scales it. */
function jasmine(x: number, y: number, s: number, ink: string, rot = 0) {
  let petals = '';
  for (let i = 0; i < 5; i++) {
    const a = rot + (2 * Math.PI * i) / 5;
    const px = x + Math.cos(a) * 11 * s, py = y + Math.sin(a) * 11 * s;
    petals += `<ellipse cx="${n(px)}" cy="${n(py)}" rx="${n(11 * s)}" ry="${n(6.5 * s)}" transform="rotate(${n((a * 180) / Math.PI)} ${n(px)} ${n(py)})"/>`;
  }
  return `<g fill="#fff" stroke="${ink}" stroke-opacity=".2" stroke-width="${n(3 + 2 * s)}">${petals}</g><g fill="#fff">${petals}</g><circle cx="${n(x)}" cy="${n(y)}" r="${n(3.5 * s)}" fill="#ffd54f"/>`;
}
/** A jasmine bud. */
const bud = (x: number, y: number, rot: number, ink: string, s = 1) =>
  `<ellipse cx="${n(x)}" cy="${n(y)}" rx="${n(5 * s)}" ry="${n(10 * s)}" fill="#fff" ${soft(ink, 5)} transform="rotate(${n(rot)} ${n(x)} ${n(y)})"/><ellipse cx="${n(x)}" cy="${n(y)}" rx="${n(5 * s)}" ry="${n(10 * s)}" fill="#fff" transform="rotate(${n(rot)} ${n(x)} ${n(y)})"/>`;

/** A sprig of jasmine flowers and buds. */
const jasmineSprig: Piece = (r, p) =>
  leaf(-10, 30, 70, LEAF, -150) + leaf(10, 30, 70, LEAF_DARK, -30) + leaf(0, 40, 56, LEAF, 90 + between(r, -20, 20)) +
  jasmine(-40, -16, 1.8, p.ink, r() * 6) + jasmine(42, -22, 1.7, p.ink, r() * 6) + jasmine(2, 26, 1.9, p.ink, r() * 6) +
  bud(-4, -60, -10, p.ink, 1.4) + bud(-70, 30, -60, p.ink, 1.3) + bud(72, 26, 60, p.ink, 1.3);

/** A round jasmine garland with orange kanakambara flowers, tied with a tassel. */
const jasmineGarland: Piece = (r, p) => {
  const cy = -12, R = 64, count = 30, accent = pick(r, ['#ff8a3d', '#ff9f1c', KA_RED]);
  let s = `<circle cx="0" cy="${cy}" r="${R}" fill="none" stroke="${LEAF_DARK}" stroke-width="4"/>`;
  for (let i = 0; i < count; i++) {
    const a = (2 * Math.PI * i) / count, x = Math.cos(a) * R, y = cy + Math.sin(a) * R;
    if (i % 6 === 1) s += `<circle cx="${n(x)}" cy="${n(y)}" r="11" fill="${accent}" ${OUTLINE}/><circle cx="${n(x)}" cy="${n(y)}" r="4" fill="${GOLD}"/>`;
    else {
      for (const k of [-1, 1]) s += bud(x + Math.cos(a) * k * 9, y + Math.sin(a) * k * 9, (a * 180) / Math.PI + 90 + k * 30, p.ink, 1.1);
    }
  }
  // The tassel: three strands of buds and a flower.
  for (const dx of [-14, 0, 14]) {
    s += `<path d="M0 ${cy + R} L${dx} 84" stroke="${LEAF_DARK}" stroke-width="2.5"/>`;
    for (let k = 1; k <= 2; k++) s += bud((dx * k) / 2.4, cy + R + k * 9, dx, p.ink, 0.9);
  }
  s += `<circle cx="0" cy="${cy + R}" r="12" fill="${accent}" ${OUTLINE}/>` + jasmine(-14, 84, 0.8, p.ink) + jasmine(14, 84, 0.8, p.ink) + jasmine(0, 86, 0.8, p.ink);
  s += jasmine(0, cy, 1.9, p.ink, r() * 6) + leaf(-12, cy + 4, 32, LEAF, -160) + leaf(12, cy + 4, 32, LEAF_DARK, -20);
  return s;
};

/** A hanging string of jasmine ending in a flower, its top near y −90. */
const jasmineString: Piece = (r, p) => {
  let s = `<line x1="0" y1="-95" x2="0" y2="62" stroke="${LEAF_DARK}" stroke-width="3"/>`;
  for (let y = -80; y <= 50; y += 16) s += bud(-7, y, -25, p.ink, 1.1) + bud(7, y + 7, 25, p.ink, 1.1);
  return s + `<circle cx="0" cy="74" r="13" fill="${pick(r, ['#ff8a3d', KA_RED, KA_YELLOW])}" ${OUTLINE}/>` + jasmine(0, 74, 1.1, p.ink);
};

/** The Indian roller (Karnataka's state bird) on a twig. */
const roller: Piece = (r, p) => {
  const turq = '#2fb5c9', deep = '#1a4fa0', breast = '#c9926a', head = '#6fc7d8';
  return `<path d="M-90 58 Q0 50 90 64" stroke="#fff" stroke-width="12" stroke-linecap="round" fill="none"/><path d="M-90 58 Q0 50 90 64" stroke="${WOOD}" stroke-width="7" stroke-linecap="round" fill="none"/>
${leaf(70, 62, 30, LEAF, 40)}${leaf(-70, 56, 30, LEAF_DARK, 150)}
<path d="M-30 30 L-74 88 L-58 92 L-20 40 Z" fill="${deep}" ${OUTLINE}/><path d="M-62 74 l10 8" stroke="${turq}" stroke-width="6" stroke-linecap="round"/>
<ellipse cx="0" cy="10" rx="50" ry="38" fill="${breast}" ${OUTLINE}/>
<path d="M-46 4 Q-30 -32 10 -20 Q28 -6 14 22 Q-20 44 -46 4 Z" fill="${turq}" ${OUTLINE}/>
<path d="M-44 8 Q-24 36 10 22" fill="none" stroke="${deep}" stroke-width="10" stroke-linecap="round"/>
<circle cx="34" cy="-26" r="26" fill="${head}" ${OUTLINE}/>
<path d="M56 -30 l26 6 l-26 8 z" fill="#4a4a4a" stroke="#fff" stroke-width="2" stroke-linejoin="round"/>
<circle cx="42" cy="-30" r="5" fill="${p.ink}"/><circle cx="43.5" cy="-31.5" r="1.8" fill="#fff"/>
<path d="M30 -10 q10 10 22 2" fill="none" stroke="${breast}" stroke-width="7" stroke-linecap="round"/>
<path d="M-6 46 v10 M10 46 v10" stroke="#e8902c" stroke-width="4" stroke-linecap="round"/>` + (r() < 0.5 ? sparkle(-70, -60, 10, KA_YELLOW) : '');
};

/** Yellow and red balloons; a Karnataka rosette; a pennant and a hanging flag. */
const kaBalloons: Piece = (r, p) => {
  const swap = r() < 0.5;
  return balloonBunch([[swap ? 44 : -44, -30, 38, KA_YELLOW], [swap ? -44 : 44, -30, 38, KA_RED], [0, -48, 38, pick(r, KA)]], p.ink, pick(r, KA), r);
};
const kaRosette: Piece = (_r, p) => rosette(KA_YELLOW, KA_RED, [KA_YELLOW, KA_RED], p.ink, false);
const kaPennant: Piece = (_r, p) => pennant(KA, p.ink);
const kaBanner: Piece = (_r, p) => hangingBanner(KA, p.ink, false);

// ---------------------------------------------------------------- Makar Sankranti and Pongal

/** A sugarcane stalk with leaves; (x, y) its foot, h tall, leaning `tilt` degrees. */
function cane(x: number, y: number, h: number, tilt: number, fill = '#7b3f61') {
  let joints = '';
  for (let yy = -24; yy > -h + 20; yy -= 30) joints += `<path d="M-6 ${yy} h12" stroke="#fff" stroke-width="2.5" opacity=".6"/>`;
  return g(`<rect x="-7" y="${-h}" width="14" height="${h}" rx="6" fill="${fill}" stroke="#fff" stroke-width="3"/>${joints}` +
    leaf(0, -h + 4, 54, LEAF_DARK, -62) + leaf(0, -h + 4, 50, LEAF, -122) + leaf(0, -h + 12, 44, LEAF_DARK, -20), x, y, 1, tilt);
}

/** The Pongal pot boiling over with sweet rice, turmeric leaves at the neck, on three stones. */
const pongalPot: Piece = (r, p) => {
  const band = pick(r, p.acc);
  let s = cane(-66, 92, 128, -4) + cane(68, 92, 124, 5, '#8e4b6f');
  s += `<path d="M-30 86 q10 -24 20 0 z M10 86 q10 -24 20 0 z" fill="#ffb300"/>
<path d="M-28 -16 C-96 2 -88 66 0 68 C88 66 96 2 28 -16 Z" fill="${CLAY}" ${OUTLINE}/>
<rect x="-32" y="-34" width="64" height="22" rx="7" fill="${CLAY}" ${OUTLINE}/>
<path d="M-74 16 Q0 40 74 16" stroke="${band}" stroke-width="15" fill="none" stroke-linecap="round"/>`;
  for (let i = 0; i < 6; i++) s += `<circle cx="${n(-55 + 22 * i)}" cy="${n(22 + 7 * Math.sin((Math.PI * i) / 5))}" r="3.5" fill="#fff"/>`;
  for (let i = 0; i < 4; i++) s += `<path d="M${-36 + 24 * i} 46 l7 9 l-7 9 l-7 -9 z" fill="#fff" opacity=".85"/>`;
  s += `<path d="M-32 -14 h64" stroke="${GOLD}" stroke-width="5" stroke-linecap="round"/>` + leaf(-26, -14, 40, LEAF_DARK, 150) + leaf(26, -14, 40, LEAF, 30);
  const puffs = [[-24, -38, 15], [-6, -50, 19], [14, -48, 17], [30, -38, 13], [-34, -26, 9], [36, -24, 9]];
  for (const [dx, dy, R] of puffs) s += `<circle cx="${dx}" cy="${dy}" r="${R + 4}" fill="${p.ink}" opacity=".12"/>`;
  for (const [dx, dy, R] of puffs) s += `<circle cx="${dx}" cy="${dy}" r="${R}" fill="#fff"/>`;
  s += `<rect x="-34" y="-40" width="68" height="10" fill="#fff"/>`;
  for (let i = 0; i < 6; i++) s += `<ellipse cx="${n(-22 + 9 * i + between(r, -3, 3))}" cy="${n(-48 + between(r, -6, 6))}" rx="3" ry="1.8" fill="${p.ink}" opacity=".15"/>`;
  for (const dx of [-46, 0, 46]) s += `<ellipse cx="${dx}" cy="82" rx="${dx ? 22 : 18}" ry="11" fill="#a39b93" ${OUTLINE}/>`;
  return s;
};

/** Kites flying, strings down to a reel. */
const skyKites: Piece = (r, p) => {
  const [a, b, c, d] = [...p.acc].sort(() => r() - 0.5);
  return `<path d="M-30 -24 Q-30 40 18 54 M50 -50 Q60 20 34 52" fill="none" stroke="${p.ink}" stroke-width="2.5" opacity=".4"/>` +
    kiteTail(-30, 24, 62, c, [a, b]) + kiteBody(-30, -30, 46, 54, [a, b], p.ink) +
    kiteTail(52, -14, 50, d, [b, c]) + kiteBody(52, -54, 32, 40, [c], p.ink) + reel(26, 72, 0.4, d);
};

/** One kite with its tail. */
const oneKite: Piece = (r, p) => {
  const [a, b, c] = [...p.acc].sort(() => r() - 0.5);
  return kiteTail(6, 56, 100, c, [a, b]) + kiteBody(6, -20, 62, 74, r() < 0.5 ? [a, b] : [a], p.ink);
};

/** A kite hanging on its string. */
const hangKite: Piece = (r, p) => {
  const [a, b, c] = [...p.acc].sort(() => r() - 0.5);
  return `<line x1="0" y1="-95" x2="0" y2="-66" stroke="${p.ink}" stroke-width="3" opacity=".45"/>` + kiteTail(0, 64, 90, c, [a, b]) + kiteBody(0, -2, 50, 64, [a, b], p.ink);
};

/** A kite reel with string rising off it. */
const reelPiece: Piece = (r, p) => `<path d="M18 -10 Q40 -50 84 -86" fill="none" stroke="${p.ink}" stroke-width="3" opacity=".45"/>` + reel(0, 24, 1, pick(r, p.acc)) + sparkle(-60, -56, 12, GOLD);

/** Two sugarcanes crossed. */
const sugarcanes: Piece = (r, p) => {
  const bow = pick(r, p.acc);
  return cane(-44, 92, 146, 24) + cane(44, 92, 146, -24, '#8e4b6f') +
    `<path d="M0 -4 q-24 -16 -28 4 q6 14 28 -4 z M0 -4 q24 -16 28 4 q-6 14 -28 -4 z" fill="${bow}" ${OUTLINE}/><path d="M0 -4 q-8 16 -14 28 M0 -4 q8 16 12 28" stroke="${bow}" stroke-width="5" fill="none" stroke-linecap="round"/><circle cx="0" cy="-4" r="7" fill="${bow}" stroke="#fff" stroke-width="2.5"/>`;
};

/** The smiling sun. */
const sankrantiSun: Piece = (r) => sun(0, 0, 52, pick(r, ['#ffc93c', '#ffb52e']), true);

/** A kolam/rangoli of coloured petals, loops and dots. */
const kolam: Piece = (r, p) => {
  const petals = 8, rot = r() * Math.PI, c = pick(r, p.acc);
  let s = '';
  for (let i = 0; i < 8; i++) {
    const a = rot + (2 * Math.PI * i) / 8, x = Math.cos(a) * 60, y = Math.sin(a) * 60;
    s += `<circle cx="${n(x)}" cy="${n(y)}" r="22" fill="none" stroke="#fff" stroke-width="10"/><circle cx="${n(x)}" cy="${n(y)}" r="22" fill="none" stroke="${c}" stroke-width="5"/>`;
  }
  s += flower(0, 0, petals, 92, 34, p.acc, GOLD, rot, 22) + flower(0, 0, petals, 56, 22, [...p.acc.slice(2), ...p.acc.slice(0, 2)], GOLD, rot + Math.PI / petals, 18);
  for (let i = 0; i < 8; i++) {
    const a = rot + (2 * Math.PI * (i + 0.5)) / 8;
    s += `<circle cx="${n(Math.cos(a) * 80)}" cy="${n(Math.sin(a) * 80)}" r="5" fill="${p.ink}" opacity=".5"/>`;
  }
  return s;
};

/** A bowl of ellu-bella: sesame, jaggery cubes and coconut. */
const elluBella: Piece = (r, p) => {
  let s = `<path d="M-70 14 Q-62 -60 0 -62 Q62 -60 70 14 Z" fill="#f2dfb8" ${OUTLINE}/>`;
  for (let i = 0; i < 26; i++) {
    const x = between(r, -58, 58), y = between(r, -50, 8);
    if (y < -56 + Math.abs(x) * 0.9 - 6) continue;
    s += `<ellipse cx="${n(x)}" cy="${n(y)}" rx="3" ry="1.8" fill="${r() < 0.5 ? '#fffaf0' : '#c9a46b'}" transform="rotate(${n(between(r, 0, 180))} ${n(x)} ${n(y)})"/>`;
  }
  for (const [x, y, rot] of [[-30, -6, 12], [18, -26, -10], [34, 0, 20], [-8, -40, 30]]) s += `<rect x="${x - 10}" y="${y - 9}" width="20" height="18" rx="3" fill="#a0522d" stroke="#fff" stroke-width="2.5" transform="rotate(${rot} ${x} ${y})"/>`;
  s += `${pale('<path d="M-48 -26 q10 -10 22 -4 q-10 4 -18 14 z"', '#fffaf0', p.ink, 4)}${pale('<path d="M2 -6 q12 -12 24 -2 q-12 2 -20 12 z"', '#fffaf0', p.ink, 4)}`;
  s += `<path d="M-88 12 Q0 96 88 12 Z" fill="${BRASS}" ${OUTLINE}/><ellipse cx="0" cy="12" rx="88" ry="10" fill="#f0c04a" ${OUTLINE}/>
<path d="M-50 40 Q0 64 50 40" fill="none" stroke="#fff" stroke-width="4" opacity=".5" stroke-linecap="round"/>
<rect x="-26" y="62" width="52" height="14" rx="5" fill="${BRASS}" ${OUTLINE}/>`;
  return g(s, 0, 4);
};

/** A brass cow bell on a bright rope with tassels, its top near y −90. */
const cowBell: Piece = (r, p) => {
  const rope = pick(r, p.acc), tassel = pick(r, p.acc.filter((c) => c !== rope));
  let beads = '';
  for (let i = 0; i < 4; i++) beads += `<circle cx="0" cy="${-80 + i * 12}" r="5" fill="${i % 2 ? tassel : GOLD}" stroke="#fff" stroke-width="2"/>`;
  return `<path d="M0 -95 V-36" stroke="${rope}" stroke-width="8" stroke-linecap="round"/>${beads}
<path d="M-12 -38 q-30 4 -46 30 M12 -38 q30 4 46 30" stroke="${rope}" stroke-width="6" fill="none" stroke-linecap="round"/>
${[-58, 58].map((x) => `<path d="M${x - 6} -8 l-4 30 M${x} -8 v32 M${x + 6} -8 l4 30" stroke="${tassel}" stroke-width="4" stroke-linecap="round"/><circle cx="${x}" cy="-10" r="8" fill="${tassel}" stroke="#fff" stroke-width="2.5"/>`).join('')}
<path d="M-44 60 Q-46 -6 -20 -32 L20 -32 Q46 -6 44 60 Z" fill="${BRASS}" ${OUTLINE}/>
<path d="M-30 20 h60 M-36 40 h72" stroke="#f6d36b" stroke-width="5" stroke-linecap="round"/>
<rect x="-54" y="56" width="108" height="14" rx="6" fill="#c98d1f" ${OUTLINE}/>
<circle cx="0" cy="82" r="11" fill="#c98d1f" ${OUTLINE}/><ellipse cx="-20" cy="0" rx="6" ry="16" fill="#fff" opacity=".45"/>`;
};

/** A marigold with a mango leaf below, as on a toran. */
function marigold(x: number, y: number, R: number, colour = '#ff8f1f') {
  let rim = '', top = '';
  for (let i = 0; i < 10; i++) {
    const a = (2 * Math.PI * i) / 10;
    const cx = n(x + Math.cos(a) * R * 0.55), cy = n(y + Math.sin(a) * R * 0.55);
    rim += `<circle cx="${cx}" cy="${cy}" r="${n(R * 0.48)}" fill="#fff"/>`;
    top += `<circle cx="${cx}" cy="${cy}" r="${n(R * 0.42)}" fill="${colour}"/>`;
  }
  return `${rim}${top}<circle cx="${n(x)}" cy="${n(y)}" r="${n(R * 0.55)}" fill="#ffb52e"/><circle cx="${n(x)}" cy="${n(y)}" r="${n(R * 0.25)}" fill="#ffd54a"/>`;
}
const toranPiece: Piece = (r, p) => `<line x1="0" y1="-95" x2="0" y2="-70" stroke="${p.ink}" stroke-width="3" opacity=".45"/>
<path d="M0 -40 q34 50 0 128 q-34 -60 0 -128 z" fill="${pick(r, [LEAF_DARK, LEAF])}" ${OUTLINE}/><path d="M0 -36 v110" stroke="#fff" stroke-width="3" opacity=".6"/>` + marigold(0, -52, 34, pick(r, ['#ff8f1f', '#ffb300']));

// ---------------------------------------------------------------- Holi

const HOLI = ['#ff4fa3', '#ffd23f', '#3ad1e6', '#7bd34a', '#9b5cff', '#ff8c42'];

/** A cloud of colour powder, its specks kept inside the box. */
function puff(r: Rng, x: number, y: number, R: number, colour: string) {
  let s = `<circle cx="${n(x)}" cy="${n(y)}" r="${n(R)}" fill="${colour}"/>`;
  const k = whole(r, 7, 10);
  for (let i = 0; i < k; i++) {
    const a = (2 * Math.PI * i) / k + between(r, -0.2, 0.2), d = R * between(r, 0.72, 0.92);
    s += `<circle cx="${n(x + Math.cos(a) * d)}" cy="${n(y + Math.sin(a) * d)}" r="${n(R * between(r, 0.3, 0.46))}" fill="${colour}"/>`;
    const d2 = R * between(r, 1.3, 1.55), sx = x + Math.cos(a + 0.3) * d2, sy = y + Math.sin(a + 0.3) * d2, sr = between(r, 3, 7);
    if (Math.abs(sx) + sr < 92 && Math.abs(sy) + sr < 92) s += `<circle cx="${n(sx)}" cy="${n(sy)}" r="${n(sr)}" fill="${colour}"/>`;
  }
  return `<g opacity=".92">${s}</g>`;
}

/** Colours of the day: the theme's brights and Holi's own. */
const holiColours = (p: Palette) => [...new Set([...p.acc, ...HOLI])];

/** Big clouds of gulal in many colours. */
const gulalClouds: Piece = (r, p) => {
  const c = holiColours(p).sort(() => r() - 0.5);
  return puff(r, -38, -34, 30, c[0]) + puff(r, 40, -38, 28, c[1]) + puff(r, -44, 40, 26, c[2]) + puff(r, 44, 38, 28, c[3]) + puff(r, 0, 2, 36, c[4]) + sparkle(0, -70, 10, '#fff') + sparkle(-6, 2, 10, '#fff');
};
const gulalPuff: Piece = (r, p) => puff(r, 0, 0, 50, pick(r, holiColours(p)));

/** A splat of colour. */
const splat: Piece = (r, p) => {
  const c = pick(r, holiColours(p));
  let s = `<circle cx="0" cy="0" r="46" fill="${c}"/>`;
  const k = whole(r, 8, 11);
  for (let i = 0; i < k; i++) {
    const a = (2 * Math.PI * i) / k + between(r, -0.2, 0.2), d = between(r, 44, 58), rr = between(r, 9, 17);
    s += `<path d="M${n(Math.cos(a - 0.25) * 30)} ${n(Math.sin(a - 0.25) * 30)} L${n(Math.cos(a) * d)} ${n(Math.sin(a) * d)} L${n(Math.cos(a + 0.25) * 30)} ${n(Math.sin(a + 0.25) * 30)} Z" fill="${c}"/><circle cx="${n(Math.cos(a) * d)}" cy="${n(Math.sin(a) * d)}" r="${n(rr)}" fill="${c}"/>`;
    if (i % 2) s += `<circle cx="${n(Math.cos(a + 0.3) * 80)}" cy="${n(Math.sin(a + 0.3) * 80)}" r="${n(between(r, 4, 8))}" fill="${c}"/>`;
  }
  return s + `<ellipse cx="-16" cy="-18" rx="10" ry="14" fill="#fff" opacity=".4" transform="rotate(35 -16 -18)"/>`;
};

/** A water balloon flying, with motion lines; (0, 0) is its middle. */
const waterBalloonAt = (fill: string, ink: string) =>
  `<path d="M-60 -16 h-30 M-56 6 h-36 M-60 28 h-26" stroke="${ink}" stroke-width="5" stroke-linecap="round" opacity=".25"/>
<path d="M0 -44 C40 -44 52 -4 40 18 C30 38 12 44 0 44 C-12 44 -50 34 -50 0 C-50 -30 -30 -44 0 -44 Z" fill="${fill}" ${OUTLINE} transform="rotate(-70)"/>
<ellipse cx="-14" cy="-14" rx="9" ry="14" fill="#fff" opacity=".55" transform="rotate(30 -14 -14)"/>
<path d="M44 -14 l14 -10 l2 18 z" fill="${fill}" ${OUTLINE}/>`;
const waterBalloon: Piece = (r, p) => g(waterBalloonAt(pick(r, holiColours(p)), p.ink), 14, 0, 1.12, between(r, -15, 15));
const waterBalloons: Piece = (r, p) => {
  const c = holiColours(p).sort(() => r() - 0.5);
  return g(waterBalloonAt(c[0], p.ink), 30, -50, 0.8, -10) + g(waterBalloonAt(c[1], p.ink), 34, 48, 0.85, 12) + g(waterBalloonAt(c[2], p.ink), -26, 4, 0.8, -2) +
    `<circle cx="80" cy="-6" r="6" fill="${c[0]}"/><circle cx="72" cy="12" r="4" fill="${c[1]}"/><circle cx="86" cy="82" r="5" fill="${c[2]}"/>`;
};
const hangWaterBalloon: Piece = (r, p) => {
  const c = pick(r, holiColours(p));
  return `<line x1="0" y1="-95" x2="0" y2="-62" stroke="${p.ink}" stroke-width="3" opacity=".45"/>
<path d="M0 -62 l-9 -10 h18 z" fill="${c}"/>
<path d="M0 -56 C34 -56 58 -20 58 16 C58 54 30 80 0 80 C-30 80 -58 54 -58 16 C-58 -20 -34 -56 0 -56 Z" fill="${c}" ${OUTLINE}/>
<ellipse cx="-24" cy="-12" rx="10" ry="18" fill="#fff" opacity=".5" transform="rotate(25 -24 -12)"/><circle cx="26" cy="88" r="4" fill="${c}"/>`;
};

/** A pichkari (water squirter) spraying an arc of coloured drops. */
function pichkariShape(body: string, cap: string) {
  return `<rect x="-120" y="-10" width="70" height="20" rx="8" fill="${cap}" ${OUTLINE}/>
<rect x="-150" y="-36" width="34" height="72" rx="16" fill="${cap}" ${OUTLINE}/>
<rect x="-60" y="-40" width="190" height="80" rx="34" fill="${body}" ${OUTLINE}/>
<path d="M-24 -38 v76 M20 -38 v76 M64 -38 v76" stroke="#fff" stroke-width="8" opacity=".6"/>
<path d="M126 -22 l60 14 v16 l-60 14 z" fill="${cap}" ${OUTLINE}/>`;
}
const pichkari: Piece = (r, p) => {
  const c = holiColours(p).sort(() => r() - 0.5);
  const [nx, ny, qx, qy, ex, ey] = [30, 6, 60, -124, 82, 40];
  let drops = '';
  for (let i = 0; i < 18; i++) {
    const t = 0.06 + (i / 17) * 0.9, u = 1 - t;
    const x = u * u * nx + 2 * u * t * qx + t * t * ex, y = u * u * ny + 2 * u * t * qy + t * t * ey, spread = 4 + t * 10;
    const dx = Math.max(-88, Math.min(86, x + between(r, -spread, spread))), dy = Math.max(-86, Math.min(86, y + between(r, -spread, spread)));
    drops += `<circle cx="${n(dx)}" cy="${n(dy)}" r="${n(between(r, 5, 8.5))}" fill="${c[i % 5]}"/>`;
  }
  return drops + g(pichkariShape(c[0], c[1]), -34, 50, 0.46, -36);
};

/** A plate with heaps of colour powder. */
function gulalHeap(x: number, y: number, rx: number, colour: string) {
  return `<ellipse cx="${n(x)}" cy="${n(y)}" rx="${n(rx)}" ry="${n(rx * 0.28)}" fill="${BRASS}" ${OUTLINE}/>
<path d="M${n(x - rx * 0.78)} ${n(y - 3)} Q${n(x - rx * 0.45)} ${n(y - rx * 1.05)} ${n(x)} ${n(y - rx * 1.08)} Q${n(x + rx * 0.45)} ${n(y - rx * 1.05)} ${n(x + rx * 0.78)} ${n(y - 3)} Z" fill="${colour}" ${OUTLINE}/>
<ellipse cx="${n(x - rx * 0.25)}" cy="${n(y - rx * 0.62)}" rx="${n(rx * 0.12)}" ry="${n(rx * 0.2)}" fill="#fff" opacity=".35"/>
<circle cx="${n(x + rx * 0.5)}" cy="${n(y + 2)}" r="4" fill="${colour}"/><circle cx="${n(x - rx * 0.6)}" cy="${n(y + 5)}" r="3" fill="${colour}"/>`;
}
const gulalBowls: Piece = (r, p) => {
  const c = holiColours(p).sort(() => r() - 0.5);
  return puff(r, -60, -60, 14, c[3]) + puff(r, 60, -56, 14, c[4]) + gulalHeap(0, 0, 52, c[0]) + gulalHeap(-46, 68, 46, c[1]) + gulalHeap(46, 70, 46, c[2]);
};
const gulalBowl: Piece = (r, p) => {
  const c = holiColours(p).sort(() => r() - 0.5);
  return gulalHeap(0, 50, 84, c[0]) + `<circle cx="-50" cy="-64" r="7" fill="${c[1]}"/><circle cx="56" cy="-58" r="6" fill="${c[2]}"/><circle cx="30" cy="-80" r="5" fill="${c[1]}"/>`;
};

/** A colourful handprint. */
const handprint: Piece = (r, p) => {
  const c = pick(r, holiColours(p)), flip = r() < 0.5 ? -1 : 1;
  const hand = `<ellipse cx="0" cy="30" rx="44" ry="50"/><rect x="-44" y="-70" width="20" height="96" rx="10"/><rect x="-20" y="-88" width="20" height="110" rx="10"/><rect x="4" y="-84" width="20" height="106" rx="10"/><rect x="28" y="-62" width="19" height="86" rx="9.5"/><rect x="-11" y="-70" width="22" height="76" rx="11" transform="translate(-28 42) rotate(-42)"/>`;
  return `<g transform="translate(${6 * flip} 0) scale(${flip} 1)"><g fill="#fff" stroke="#fff" stroke-width="10">${hand}</g><g fill="${c}">${hand}</g>
<path d="M-8 30 q10 12 26 4" fill="none" stroke="#fff" stroke-width="4" opacity=".45" stroke-linecap="round"/>
<circle cx="-72" cy="-64" r="6" fill="${c}"/><circle cx="62" cy="-82" r="4" fill="${c}"/><circle cx="70" cy="66" r="5" fill="${c}"/></g>`;
};

/** A plate of gujiya, the crimped sweet dumplings. */
const gujiya: Piece = (r, p) => {
  const one = (x: number, y: number, s: number, rot: number) => {
    let crimp = '';
    for (let i = 0; i <= 10; i++) {
      const a = Math.PI + (Math.PI * i) / 10;
      crimp += `<circle cx="${n(Math.cos(a) * 50)}" cy="${n(Math.sin(a) * 50)}" r="7"/>`;
    }
    return g(`<g fill="#e09a3a" stroke="#fff" stroke-width="3">${crimp}</g><path d="M-50 0 A50 50 0 0 1 50 0 Z" fill="#f2b65a" ${OUTLINE}/>
<path d="M-34 -6 A36 36 0 0 1 30 -18" fill="none" stroke="#fff" stroke-width="4" opacity=".5" stroke-linecap="round"/>
<circle cx="-10" cy="-20" r="3" fill="#7bc043"/><circle cx="12" cy="-28" r="3" fill="#7bc043"/><circle cx="4" cy="-12" r="2.5" fill="#e75a7c"/>`, x, y, s, rot);
  };
  return `<ellipse cx="0" cy="56" rx="90" ry="26" fill="${pick(r, p.acc)}" ${OUTLINE}/><ellipse cx="0" cy="52" rx="70" ry="16" fill="#fff" opacity=".35"/>` +
    one(-34, 50, 0.9, -8) + one(36, 52, 0.9, 8) + one(0, 6, 0.95, 0) + sparkle(-66, -40, 10, GOLD);
};

/** A bright pennant for Holi. */
const holiPennant: Piece = (r, p) => {
  const c = holiColours(p).sort(() => r() - 0.5);
  return pennant([c[0], c[1], c[2]], p.ink);
};

// ---------------------------------------------------------------- the kits

const newYear: Kit = {
  hero: [nyBalloons, nyParty, nyFireworks, nyGifts],
  small: [nyBalloon, nyHat, nyPopper, nyBurst, nyGift, nyStar, nyStreamers],
  hang: [nyHangStar, nyPennant, nyBall],
};

const republicDay: Kit = {
  hero: [indiaFlag, indiaGate, peacock, drum],
  small: [triBalloons, triKite, triRosette, lotusPiece, indiaFlag, drum, peacock],
  hang: [triPennant, triBanner, hangRosette],
  colours: [SAFFRON, WHITE, GREEN, NAVY],
};

const independenceDay: Kit = {
  hero: [indiaFlag, redFort, kitePair, peacock],
  small: [triKite, triBalloons, triRosette, indiaFlag, lotusPiece, peacock],
  hang: [triPennant, triBanner, hangRosette],
  colours: [SAFFRON, WHITE, GREEN, NAVY],
};

const gandhiJayanti: Kit = {
  calm: true,
  hero: [charkha, spectacles, dove, cotton],
  small: [specsSmall, dove, cotton, stickSandals, khadi, charkha, indiaFlag],
  hang: [triPennant, cottonHang, triBanner],
  colours: [SAFFRON, GREEN, '#a5d6a7', '#e8d6b0', WHITE],
};

const rajyotsava: Kit = {
  hero: [kaFlag, palace, elephant, jasmineGarland],
  small: [kaFlag, jasmineSprig, roller, kaBalloons, kaRosette, elephant, palace],
  hang: [jasmineString, kaPennant, kaBanner],
  colours: [KA_YELLOW, KA_RED, '#ffffff', '#ff9f1c'],
};

const sankranti: Kit = {
  hero: [pongalPot, skyKites, sankrantiSun, kolam],
  small: [oneKite, reelPiece, sugarcanes, elluBella, cowBell, sankrantiSun, kolam],
  hang: [cowBell, hangKite, toranPiece],
};

const holi: Kit = {
  hero: [gulalClouds, pichkari, gulalBowls, waterBalloons],
  small: [gulalPuff, waterBalloon, gulalBowl, handprint, gujiya, splat, pichkari],
  hang: [hangWaterBalloon, holiPennant],
  colours: HOLI,
};

export const nationalKits: Record<string, Kit> = {
  'new-year': newYear,
  'republic-day': republicDay,
  'independence-day': independenceDay,
  'gandhi-jayanti': gandhiJayanti,
  rajyotsava,
  sankranti,
  holi,
};
