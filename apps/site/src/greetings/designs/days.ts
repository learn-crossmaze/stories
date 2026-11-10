// Drawings for Women's Day, World Health Day, Earth Day, Mother's Day, World Environment Day and Father's Day.
import { between, pick, whole } from '../palettes';
import { cloud, flower, grass, heart, kite, leaf, n, OUTLINE, sparkle, sun } from '../motifs';
import type { Design, Rng } from '../types';

const STEM = '#3f9e4d';
const GREENS = ['#5cb85c', '#43a047', '#7cc96a'];
const WATER = '#4cb8f0';
const BROWN = '#8d5a3b';
const FACE = '#5a3214';
const CHEEK = '#ff7aa8';
/** A soft ink outline for white or very pale shapes, which a white outline would lose. */
const soft = (ink: string, w = 5) => `stroke="${ink}" stroke-opacity=".18" stroke-width="${w}" stroke-linejoin="round"`;

/** True for green and teal colours, which would vanish against leaves. */
function greenish(hex: string) {
  const [red, green, blue] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return green > red + 30 && green >= blue;
}

/** The colours of `list` in a random order. */
function shuffled<T>(r: Rng, list: readonly T[]) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Two dot eyes, a smile and pink cheeks; (x, y) is the middle of the face, R its size. */
function face(x: number, y: number, R: number, ink = FACE) {
  const w = Math.max(4, R * 0.07);
  return `<circle cx="${n(x - R * 0.32)}" cy="${n(y - R * 0.12)}" r="${n(R * 0.08)}" fill="${ink}"/><circle cx="${n(x + R * 0.32)}" cy="${n(y - R * 0.12)}" r="${n(R * 0.08)}" fill="${ink}"/>
<circle cx="${n(x - R * 0.56)}" cy="${n(y + R * 0.12)}" r="${n(R * 0.13)}" fill="${CHEEK}" opacity=".5"/><circle cx="${n(x + R * 0.56)}" cy="${n(y + R * 0.12)}" r="${n(R * 0.13)}" fill="${CHEEK}" opacity=".5"/>
<path d="M${n(x - R * 0.26)} ${n(y + R * 0.12)} q${n(R * 0.26)} ${n(R * 0.26)} ${n(R * 0.52)} 0" fill="none" stroke="${ink}" stroke-width="${n(w)}" stroke-linecap="round"/>`;
}

/** A butterfly; (x, y) is the middle of its body. */
function butterfly(x: number, y: number, s: number, c1: string, c2: string, ink: string, tilt = 0) {
  const wing = (dx: number, dy: number, rx: number, ry: number, rot: number, c: string) =>
    `<ellipse cx="${n(x + dx * s)}" cy="${n(y + dy * s)}" rx="${n(rx * s)}" ry="${n(ry * s)}" transform="rotate(${rot} ${n(x + dx * s)} ${n(y + dy * s)})" fill="${c}" ${OUTLINE}/>`;
  return `<g transform="rotate(${n(tilt)} ${n(x)} ${n(y)})">
${wing(-30, -18, 34, 26, -25, c1)}${wing(30, -18, 34, 26, 25, c1)}${wing(-22, 20, 22, 18, 20, c2)}${wing(22, 20, 22, 18, -20, c2)}
<circle cx="${n(x - 30 * s)}" cy="${n(y - 20 * s)}" r="${n(9 * s)}" fill="#fff" opacity=".6"/><circle cx="${n(x + 30 * s)}" cy="${n(y - 20 * s)}" r="${n(9 * s)}" fill="#fff" opacity=".6"/>
<rect x="${n(x - 7 * s)}" y="${n(y - 34 * s)}" width="${n(14 * s)}" height="${n(68 * s)}" rx="${n(7 * s)}" fill="${ink}"/>
<path d="M${n(x - 3 * s)} ${n(y - 32 * s)} q${n(-8 * s)} ${n(-20 * s)} ${n(-20 * s)} ${n(-26 * s)} M${n(x + 3 * s)} ${n(y - 32 * s)} q${n(8 * s)} ${n(-20 * s)} ${n(20 * s)} ${n(-26 * s)}" fill="none" stroke="${ink}" stroke-width="4" stroke-linecap="round"/>
<circle cx="${n(x - 23 * s)}" cy="${n(y - 58 * s)}" r="${n(5 * s)}" fill="${ink}"/><circle cx="${n(x + 23 * s)}" cy="${n(y - 58 * s)}" r="${n(5 * s)}" fill="${ink}"/></g>`;
}

/** A bumble bee with a dotted flight path behind it; dir 1 flies right, -1 left. */
function bee(x: number, y: number, s: number, ink: string, dir = 1, r?: Rng) {
  const trail = r
    ? `<path d="M${n(x - dir * 40 * s)} ${n(y + 6 * s)} q${n(-dir * 60 * s)} ${n(between(r, -70, 70) * s)} ${n(-dir * 150 * s)} ${n(between(r, -20, 40) * s)}" fill="none" stroke="${ink}" stroke-width="5" stroke-linecap="round" stroke-dasharray="1 14" opacity=".35"/>`
    : '';
  let stripes = '';
  for (const dx of [-8, 8]) {
    const h = 22 * Math.sqrt(1 - (dx / 32) ** 2) - 5;
    stripes += `<path d="M${n(x + dir * dx * s)} ${n(y - h * s)} V${n(y + h * s)}" stroke="${ink}" stroke-width="${n(8 * s)}" stroke-linecap="round"/>`;
  }
  return `${trail}<ellipse cx="${n(x - dir * 8 * s)}" cy="${n(y - 26 * s)}" rx="${n(16 * s)}" ry="${n(22 * s)}" transform="rotate(${-dir * 25} ${n(x - dir * 8 * s)} ${n(y - 26 * s)})" fill="#fff" opacity=".9" ${soft(ink, 4)}/>
<ellipse cx="${n(x + dir * 8 * s)}" cy="${n(y - 28 * s)}" rx="${n(14 * s)}" ry="${n(20 * s)}" transform="rotate(${dir * 20} ${n(x + dir * 8 * s)} ${n(y - 28 * s)})" fill="#fff" opacity=".9" ${soft(ink, 4)}/>
<path d="M${n(x - dir * 30 * s)} ${n(y)} l${n(-dir * 14 * s)} ${n(-4 * s)} l${n(dir * 4 * s)} ${n(10 * s)} z" fill="${ink}"/>
<ellipse cx="${n(x)}" cy="${n(y)}" rx="${n(32 * s)}" ry="${n(22 * s)}" fill="#ffc93c" ${OUTLINE}/>${stripes}
<circle cx="${n(x + dir * 20 * s)}" cy="${n(y - 5 * s)}" r="${n(4 * s)}" fill="${ink}"/>`;
}

/** A tulip head; (x, y) is its middle. */
const tulip = (x: number, y: number, s: number, c: string) =>
  `<path d="M${n(x - 34 * s)} ${n(y - 40 * s)} L${n(x - 17 * s)} ${n(y - 18 * s)} L${n(x)} ${n(y - 48 * s)} L${n(x + 17 * s)} ${n(y - 18 * s)} L${n(x + 34 * s)} ${n(y - 40 * s)} Q${n(x + 40 * s)} ${n(y + 24 * s)} ${n(x)} ${n(y + 32 * s)} Q${n(x - 40 * s)} ${n(y + 24 * s)} ${n(x - 34 * s)} ${n(y - 40 * s)} Z" fill="${c}" ${OUTLINE}/>
<path d="M${n(x - 16 * s)} ${n(y - 8 * s)} Q${n(x - 18 * s)} ${n(y + 12 * s)} ${n(x - 4 * s)} ${n(y + 20 * s)}" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" opacity=".55"/>`;


/** One of four garden flower heads (petals, tulip, daisy, double bloom); (x, y) is its middle. */
function bloom(kind: number, x: number, y: number, s: number, c: string, c2: string, rot: number) {
  switch (kind % 4) {
    case 0: return flower(x, y, 6, 64 * s, 50 * s, [c, c2], '#ffc93c', rot, 20 * s);
    case 1: return tulip(x, y, s * 1.1, c);
    case 2: return flower(x, y, 12, 60 * s, 22 * s, [c], '#ffc93c', rot, 18 * s);
    default: return flower(x, y, 8, 66 * s, 40 * s, [c], '#ffc93c', rot, 14 * s) + flower(x, y, 8, 38 * s, 26 * s, [c2], '#ffc93c', rot + Math.PI / 8, 13 * s);
  }
}

/** A green stem from (x0, y0) up to (x1, y1), bending by `bend`. */
const stem = (x0: number, y0: number, x1: number, y1: number, bend = 0) =>
  `<path d="M${n(x0)} ${n(y0)} Q${n((x0 + x1) / 2 + bend)} ${n((y0 + y1) / 2)} ${n(x1)} ${n(y1)}" fill="none" stroke="${STEM}" stroke-width="10" stroke-linecap="round"/>`;

/** A water drop; (x, y) is its middle. */
const drop = (x: number, y: number, s: number, fill = WATER) =>
  `<path d="M${n(x)} ${n(y - 22 * s)} C${n(x + 6 * s)} ${n(y - 10 * s)} ${n(x + 16 * s)} ${n(y)} ${n(x + 16 * s)} ${n(y + 8 * s)} A${n(16 * s)} ${n(16 * s)} 0 0 1 ${n(x - 16 * s)} ${n(y + 8 * s)} C${n(x - 16 * s)} ${n(y)} ${n(x - 6 * s)} ${n(y - 10 * s)} ${n(x)} ${n(y - 22 * s)} Z" fill="${fill}" ${OUTLINE}/>`;

/** A few twinkles spread along the top of the area. */
function twinkles(r: Rng, colours: string[], count: number, y0 = 40, y1 = 160, x0 = 70, x1 = 1010) {
  let s = '';
  for (let i = 0; i < count; i++)
    s += sparkle(x0 + ((x1 - x0) / Math.max(1, count - 1)) * i + between(r, -30, 30), between(r, y0, y1), between(r, 14, 24), pick(r, colours));
  return s;
}

// ---------------------------------------------------------------------------------------------- Women's Day

/** Women's Day A: a bouquet of mixed flowers in a paper wrap, with hearts and butterflies. */
const bouquet: Design = (r, p) => {
  const cx = 540 + between(r, -25, 25), base = 600, wrap = pick(r, p.acc);
  const colours = shuffled(r, p.acc.filter((c) => c !== wrap));
  const heads: [number, number, number][] = [];
  const outer = whole(r, 4, 5);
  for (let i = 0; i < outer; i++) {
    const a = Math.PI * (-0.88 + (0.76 * i) / (outer - 1)) + between(r, -0.04, 0.04);
    heads.push([cx + Math.cos(a) * 275, 470 + Math.sin(a) * 270, between(r, 0.95, 1.1)]);
  }
  const inner = whole(r, 2, 3);
  for (let i = 0; i < inner; i++) {
    const a = Math.PI * (inner === 2 ? -0.62 + 0.24 * i : -0.68 + 0.18 * i);
    heads.push([cx + Math.cos(a) * 170, 470 + Math.sin(a) * 150, between(r, 0.85, 0.95)]);
  }
  let s = '';
  heads.forEach(([x, y], i) => {
    s += stem(cx + (x - cx) * 0.12, base, x, y, (x - cx) * 0.15);
    if (i < outer && i % 2 === 0) s += leaf(cx + (x - cx) * 0.55, 470 + (y - 470) * 0.3, 70, pick(r, GREENS), x < cx ? -150 : -30);
  });
  // The paper wrap, with a scalloped top, folds and a ribbon bow.
  const top = 400, half = 205, foot = 48, bottom = 640;
  let edge = `M${n(cx - half)} ${top}`;
  for (let i = 0; i < 6; i++) edge += ` q${n(half / 6)} -34 ${n(half / 3)} 0`;
  s += `<path d="${edge} L${n(cx + foot)} ${bottom} L${n(cx - foot)} ${bottom} Z" fill="${wrap}" ${OUTLINE}/>
<path d="M${n(cx - half * 0.45)} ${top + 6} L${n(cx - foot * 0.4)} ${bottom - 6} M${n(cx + half * 0.45)} ${top + 6} L${n(cx + foot * 0.4)} ${bottom - 6}" stroke="#fff" stroke-width="5" opacity=".5" stroke-linecap="round"/>`;
  const by = 540, ribbon = '#fff4c2';
  s += `<ellipse cx="${n(cx - 34)}" cy="${by}" rx="34" ry="20" fill="none" stroke="${ribbon}" stroke-width="12"/><ellipse cx="${n(cx + 34)}" cy="${by}" rx="34" ry="20" fill="none" stroke="${ribbon}" stroke-width="12"/>
<path d="M${n(cx - 6)} ${by + 8} l-26 52 M${n(cx + 6)} ${by + 8} l26 52" stroke="${ribbon}" stroke-width="12" stroke-linecap="round"/><circle cx="${n(cx)}" cy="${by}" r="15" fill="${ribbon}"/>`;
  const kinds = shuffled(r, [0, 1, 2, 3]);
  heads.forEach(([x, y, k], i) => (s += bloom(kinds[i % 4], x, y, k * 1.15, colours[i % colours.length], colours[(i + 2) % colours.length], r() * Math.PI)));
  // A butterfly and a heart on each side, swapped by the year.
  const up = r() < 0.5 ? 1 : -1;
  for (const side of [-1, 1]) {
    const x = cx + side * between(r, 360, 410), flyHigh = side === up;
    const bx = x + side * 10, hy = flyHigh ? between(r, 430, 500) : between(r, 150, 210), fy = flyHigh ? between(r, 150, 200) : between(r, 420, 480);
    s += butterfly(bx, fy, 0.95, pick(r, p.acc), pick(r, p.acc), p.ink, side * between(r, 8, 20));
    s += heart(x - side * 10, hy, between(r, 30, 40), pick(r, p.acc));
  }
  return s;
};

/** Women's Day B: a garden of tall flowers of every kind, with butterflies and a bee. */
const garden: Design = (r, p) => {
  const count = whole(r, 6, 7), start = whole(r, 0, 3), tallFirst = r() < 0.5;
  const colours = shuffled(r, p.acc);
  let s = '';
  const heads: [number, number][] = [];
  for (let i = 0; i < count; i++) {
    const x = 110 + (860 / (count - 1)) * i + between(r, -12, 12);
    const tall = (i % 2 === 0) === tallFirst;
    const y = tall ? between(r, 250, 300) : between(r, 370, 420);
    heads.push([x, y]);
    const bend = between(r, -30, 30);
    s += stem(x + between(r, -8, 8), 645, x, y, bend);
    const ly = between(r, 500, 570), side = i % 2 ? 1 : -1;
    s += leaf(x + bend * 0.3, ly, 66, pick(r, GREENS), side > 0 ? -30 : -150);
  }
  s += grass(r, GREENS[2]);
  heads.forEach(([x, y], i) => (s += bloom(start + i, x, y, 0.95, colours[i % 5], colours[(i + 3) % 5], r() * Math.PI)));
  // Sky: two butterflies and a bee above the low flowers.
  const lows = heads.filter((_, i) => (i % 2 === 0) !== tallFirst);
  const spots = shuffled(r, lows).slice(0, 3);
  spots.forEach(([x, y], i) => {
    const sy = y - between(r, 170, 200);
    s += i < 2 ? butterfly(x, sy, 0.8, pick(r, p.acc), pick(r, p.acc), p.ink, between(r, -15, 15)) : bee(x, sy + 20, 1, p.ink, x < 540 ? 1 : -1);
  });
  return s + twinkles(r, p.acc, 4, 30, 90);
};

// ------------------------------------------------------------------------------------------ World Health Day

/** A carrot lying at an angle; (x, y) is the middle of its top. */
const carrot = (x: number, y: number, s: number, tilt: number) =>
  `<g transform="rotate(${n(tilt)} ${n(x)} ${n(y)})">
${leaf(x, y, 60 * s, GREENS[0], -110)}${leaf(x, y, 54 * s, GREENS[1], -70)}${leaf(x, y, 50 * s, GREENS[2], -140)}
<path d="M${n(x - 34 * s)} ${n(y)} Q${n(x)} ${n(y - 12 * s)} ${n(x + 34 * s)} ${n(y)} L${n(x + 4 * s)} ${n(y + 190 * s)} Q${n(x)} ${n(y + 198 * s)} ${n(x - 4 * s)} ${n(y + 190 * s)} Z" fill="#ff8c42" ${OUTLINE}/>
<path d="M${n(x - 22 * s)} ${n(y + 50 * s)} h${n(18 * s)} M${n(x + 4 * s)} ${n(y + 95 * s)} h${n(16 * s)} M${n(x - 12 * s)} ${n(y + 140 * s)} h${n(12 * s)}" stroke="#fff" stroke-width="5" stroke-linecap="round" opacity=".6"/></g>`;

/** A head of broccoli; (x, y) is the bottom of its stalk. */
const broccoli = (x: number, y: number, s: number) =>
  `<path d="M${n(x - 22 * s)} ${n(y)} L${n(x - 16 * s)} ${n(y - 80 * s)} L${n(x + 16 * s)} ${n(y - 80 * s)} L${n(x + 22 * s)} ${n(y)} Z" fill="#9ccc65" ${OUTLINE}/>
<circle cx="${n(x - 44 * s)}" cy="${n(y - 104 * s)}" r="${n(38 * s)}" fill="${GREENS[1]}" ${OUTLINE}/><circle cx="${n(x + 44 * s)}" cy="${n(y - 104 * s)}" r="${n(38 * s)}" fill="${GREENS[1]}" ${OUTLINE}/>
<circle cx="${n(x)}" cy="${n(y - 130 * s)}" r="${n(46 * s)}" fill="${GREENS[0]}" ${OUTLINE}/>`;

/** Health A: a happy apple with a carrot, broccoli and a glass of water. */
const apple: Design = (r, p) => {
  const R = 165, cx = 540 + between(r, -30, 30), cy = 470, side = r() < 0.5 ? 1 : -1, tilt = between(r, -6, 6);
  const red = pick(r, ['#e8473c', '#e53935', '#ef5350']);
  let s = twinkles(r, p.acc, 5, 40, 150);
  s += `<g transform="rotate(${n(tilt)} ${n(cx)} ${n(cy + R)})">
<path d="M${n(cx)} ${n(cy - R * 0.98)} q${n(R * 0.04)} ${n(-R * 0.22)} ${n(R * 0.16)} ${n(-R * 0.3)}" fill="none" stroke="${BROWN}" stroke-width="14" stroke-linecap="round"/>
${leaf(cx + R * 0.08, cy - R * 1.1, R * 0.55, GREENS[0], -25)}
<path d="M${n(cx)} ${n(cy - R * 0.78)} C${n(cx + R * 0.35)} ${n(cy - R * 1.1)} ${n(cx + R * 1.08)} ${n(cy - R * 1.0)} ${n(cx + R * 1.02)} ${n(cy - R * 0.1)} C${n(cx + R * 0.98)} ${n(cy + R * 0.72)} ${n(cx + R * 0.45)} ${n(cy + R * 1.04)} ${n(cx)} ${n(cy + R * 0.88)} C${n(cx - R * 0.45)} ${n(cy + R * 1.04)} ${n(cx - R * 0.98)} ${n(cy + R * 0.72)} ${n(cx - R * 1.02)} ${n(cy - R * 0.1)} C${n(cx - R * 1.08)} ${n(cy - R * 1.0)} ${n(cx - R * 0.35)} ${n(cy - R * 1.1)} ${n(cx)} ${n(cy - R * 0.78)} Z" fill="${red}" ${OUTLINE}/>
<ellipse cx="${n(cx - R * 0.5)}" cy="${n(cy - R * 0.42)}" rx="${n(R * 0.14)}" ry="${n(R * 0.24)}" transform="rotate(30 ${n(cx - R * 0.5)} ${n(cy - R * 0.42)})" fill="#fff" opacity=".45"/>
${face(cx, cy + R * 0.05, R * 0.75)}</g>`;
  // Vegetables on one side, a glass of water on the other.
  const vx = cx - side * between(r, 300, 330);
  s += side > 0
    ? broccoli(vx - 40, 645, 1) + carrot(vx + 70, 470, 1, between(r, -40, -25))
    : broccoli(vx + 40, 645, 1) + carrot(vx - 70, 470, 1, between(r, 25, 40));
  const gx = cx + side * between(r, 290, 320), gt = 455, gb = 640, level = between(r, 0.3, 0.4);
  const wy = gt + (gb - gt) * level, at = (y: number) => 66 - ((y - gt) / (gb - gt)) * 14;
  s += `<path d="M${n(gx - at(wy))} ${n(wy)} L${n(gx + at(wy))} ${n(wy)} L${n(gx + 52)} ${gb} L${n(gx - 52)} ${gb} Z" fill="${WATER}" opacity=".85"/>
<path d="M${n(gx - 66)} ${gt} L${n(gx + 66)} ${gt} L${n(gx + 52)} ${gb} Q${n(gx)} ${gb + 6} ${n(gx - 52)} ${gb} Z" fill="#fff" fill-opacity=".35" ${soft(p.ink, 6)}/>
<path d="M${n(gx - 42)} ${gt + 30} L${n(gx - 36)} ${gt + 120}" stroke="#fff" stroke-width="10" stroke-linecap="round" opacity=".8"/>
${drop(gx + side * 10, gt - 70, 1.6)}`;
  return s;
};

/** Health B: a smiling bar of soap with bubbles, and a toothbrush with sparkles. */
const soap: Design = (r, p) => {
  const side = r() < 0.5 ? 1 : -1, sx = 540 - side * between(r, 140, 170), w = 340, h = 175, top = 640 - h;
  const bar = pick(r, p.acc);
  let s = '';
  // Bubbles float up over the whole picture.
  const bubbles = whole(r, 8, 11);
  for (let i = 0; i < bubbles; i++) {
    const x = 90 + (900 / (bubbles - 1)) * i + between(r, -30, 30), rad = between(r, 18, 46);
    const y = Math.abs(x - sx) < 220 ? between(r, 80, 300) : between(r, 60, 220);
    s += `<circle cx="${n(x)}" cy="${n(y)}" r="${n(rad)}" fill="#fff" fill-opacity=".4" stroke="${pick(r, p.acc)}" stroke-width="5" stroke-opacity=".75"/>
<path d="M${n(x - rad * 0.55)} ${n(y - rad * 0.2)} q${n(rad * 0.1)} ${n(-rad * 0.35)} ${n(rad * 0.45)} ${n(-rad * 0.42)}" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round"/>`;
  }
  // Foam on top of the soap.
  let foam = '';
  for (let i = 0; i < 6; i++) {
    const fx = sx - w * 0.38 + (w * 0.76 / 5) * i, fr = between(r, 26, 40);
    foam += `<circle cx="${n(fx)}" cy="${n(top - fr * 0.3 - (i % 2) * 14)}" r="${n(fr)}" fill="#fff" ${soft(p.ink)}/>`;
  }
  s += foam;
  s += `<rect x="${n(sx - w / 2)}" y="${top}" width="${w}" height="${h}" rx="48" fill="${bar}" ${OUTLINE}/>
<rect x="${n(sx - w / 2 + 26)}" y="${top + 20}" width="${n(w * 0.42)}" height="18" rx="9" fill="#fff" opacity=".45"/>
${face(sx, top + h * 0.56, 112)}`;
  // The toothbrush, drawn level and then tilted, with a swirl of paste on its bristles.
  const tx = 540 + side * between(r, 230, 260), ty = 410, a = side > 0 ? -58 : -122, hc = pick(r, p.acc.filter((c) => c !== bar));
  const flip = side > 0 ? '' : ` scale(1 -1)`;
  let bristles = '';
  for (let i = 0; i < 6; i++) bristles += `<rect x="${n(100 + i * 18)}" y="-66" width="14" height="46" rx="6" fill="#fff" ${soft(p.ink, 4)}/>`;
  s += `<g transform="translate(${n(tx)} ${ty}) rotate(${a})${flip} scale(.9)">
<rect x="-210" y="-18" width="330" height="36" rx="18" fill="${hc}" ${OUTLINE}/>
<rect x="90" y="-26" width="128" height="30" rx="14" fill="${hc}" ${OUTLINE}/>${bristles}
<path d="M96 -70 q10 -34 36 -22 q14 -30 38 -12 q22 -20 40 4 q14 22 -8 30 h-100 q-14 0 -6 0 z" fill="#fff" ${soft(p.ink, 4)}/>
<path d="M112 -82 q16 -14 32 -6 M152 -96 q16 -8 30 4" stroke="${pick(r, p.acc)}" stroke-width="8" stroke-linecap="round" fill="none"/>
<circle cx="-170" cy="0" r="9" fill="#fff" opacity=".7"/></g>`;
  for (let i = 0; i < 3; i++)
    s += sparkle(tx + side * between(r, 120, 190) - side * i * 60, between(r, 470, 600) - i * 10, between(r, 18, 28), pick(r, ['#ffc93c', ...p.acc]));
  return s;
};

// ------------------------------------------------------------------------------------------------ Earth Day

/** A smiling globe; land is blobs kept well inside the circle. */
function globe(r: Rng, cx: number, cy: number, R: number, ink: string) {
  let s = `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(R)}" fill="${WATER}" ${OUTLINE}/>`;
  const lands = whole(r, 3, 4), turn = r() * Math.PI * 2;
  for (let i = 0; i < lands; i++) {
    const a = turn + (2 * Math.PI * i) / lands + between(r, -0.3, 0.3), d = between(r, 0.42, 0.55) * R;
    const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d * 0.9, rx = between(r, 0.2, 0.3) * R, ry = between(r, 0.14, 0.22) * R;
    const g = pick(r, GREENS);
    s += `<ellipse cx="${n(x)}" cy="${n(y)}" rx="${n(rx)}" ry="${n(ry)}" transform="rotate(${n(between(r, -40, 40))} ${n(x)} ${n(y)})" fill="${g}"/>
<circle cx="${n(x + Math.cos(a + 1.3) * rx * 0.6)}" cy="${n(y + Math.sin(a + 1.3) * ry * 0.6)}" r="${n(ry * 0.9)}" fill="${g}"/>`;
  }
  s += `<path d="M${n(cx - R * 0.72)} ${n(cy - R * 0.38)} a${n(R * 0.8)} ${n(R * 0.8)} 0 0 1 ${n(R * 0.5)} ${n(-R * 0.42)}" fill="none" stroke="#fff" stroke-width="12" stroke-linecap="round" opacity=".55"/>`;
  return s + face(cx, cy + R * 0.05, R * 0.6, ink);
}

/** Earth Day A: a smiling globe hugged by two leafy branches, with hearts and clouds. */
const hugGlobe: Design = (r, p) => {
  const cx = 540, cy = 300, R = 185;
  let s = cloud(between(r, 160, 220), between(r, 170, 220), 0.9) + cloud(between(r, 870, 930), between(r, 120, 170), 0.8);
  s += globe(r, cx, cy, R, p.ink);
  // Two branches curl up around the globe from a knot under it.
  const ky = 600;
  for (const side of [-1, 1]) {
    const x0 = cx + side * 20, x1 = cx + side * R * 1.12, y1 = cy - R * between(r, 0.2, 0.4), qx = cx + side * R * 1.35, qy = cy + R * 1.05;
    s += `<path d="M${n(x0)} ${ky} Q${n(qx)} ${n(qy)} ${n(x1)} ${n(y1)}" fill="none" stroke="${BROWN}" stroke-width="14" stroke-linecap="round"/>`;
    const leaves = whole(r, 5, 6);
    for (let i = 0; i < leaves; i++) {
      const t = 0.12 + (0.86 / (leaves - 1)) * i;
      const x = (1 - t) ** 2 * x0 + 2 * (1 - t) * t * qx + t * t * x1, y = (1 - t) ** 2 * ky + 2 * (1 - t) * t * qy + t * t * y1;
      // Tangent direction, then the leaf points out from the branch on alternate sides.
      const dx = 2 * (1 - t) * (qx - x0) + 2 * t * (x1 - qx), dy = 2 * (1 - t) * (qy - ky) + 2 * t * (y1 - qy);
      const ang = (Math.atan2(dy, dx) * 180) / Math.PI + (i % 2 ? 40 : -40);
      s += leaf(x, y, between(r, 62, 76), GREENS[i % 3], ang);
    }
    s += leaf(x1, y1, 70, GREENS[0], side > 0 ? -80 : -100);
  }
  s += heart(cx, ky + 8, 26, pick(r, p.acc));
  const hs = shuffled(r, [[150, 430], [930, 400], [880, 560], [200, 590]]).slice(0, 3);
  for (const [x, y] of hs) s += heart(x + between(r, -20, 20), y + between(r, -20, 20), between(r, 24, 32), pick(r, p.acc));
  return s + twinkles(r, p.acc, 4, 40, 110, 320, 760);
};

/** A small watering can tilted to pour; (x, y) is the middle of its body. Returns the spout's tip too. */
function wateringCan(x: number, y: number, c: string, tilt: number): [string, number, number] {
  const a = (tilt * Math.PI) / 180, tipX = 178, tipY = -96;
  const tip: [number, number] = [x + tipX * Math.cos(a) - tipY * Math.sin(a), y + tipX * Math.sin(a) + tipY * Math.cos(a)];
  const svg = `<g transform="rotate(${n(tilt)} ${n(x)} ${n(y)})">
<path d="M${n(x - 58)} ${n(y - 62)} Q${n(x)} ${n(y - 150)} ${n(x + 58)} ${n(y - 62)}" fill="none" stroke="${c}" stroke-width="16" stroke-linecap="round"/>
<path d="M${n(x + 60)} ${n(y + 30)} L${n(x + 168)} ${n(y - 82)} L${n(x + 182)} ${n(y - 70)} L${n(x + 78)} ${n(y + 50)} Z" fill="${c}" ${OUTLINE}/>
<ellipse cx="${n(x + 180)}" cy="${n(y - 90)}" rx="26" ry="14" transform="rotate(-45 ${n(x + 180)} ${n(y - 90)})" fill="${c}" ${OUTLINE}/>
<path d="M${n(x - 90)} ${n(y - 40)} Q${n(x - 90)} ${n(y - 66)} ${n(x - 62)} ${n(y - 66)} H${n(x + 62)} Q${n(x + 90)} ${n(y - 66)} ${n(x + 90)} ${n(y - 40)} V${n(y + 50)} Q${n(x + 90)} ${n(y + 76)} ${n(x + 62)} ${n(y + 76)} H${n(x - 62)} Q${n(x - 90)} ${n(y + 76)} ${n(x - 90)} ${n(y + 50)} Z" fill="${c}" ${OUTLINE}/>
<path d="M${n(x - 90)} ${n(y - 16)} H${n(x + 90)}" stroke="#fff" stroke-width="8" opacity=".55"/>
<circle cx="${n(x - 56)}" cy="${n(y + 30)}" r="12" fill="#fff" opacity=".45"/></g>`;
  return [svg, tip[0], tip[1]];
}

/** Earth Day B: seedlings growing in a row of soil, watered from a can, under a smiling sun. */
const seedlings: Design = (r, p) => {
  const count = whole(r, 3, 4), x0 = 480, x1 = 940, grow = r() < 0.5;
  let s = sun(between(r, 890, 940), between(r, 110, 140), 58, '#ffc93c');
  s += cloud(between(r, 600, 700), between(r, 150, 190), 0.8);
  const [can, tx, ty] = wateringCan(between(r, 200, 240), between(r, 210, 250), pick(r, p.acc), between(r, 38, 46));
  s += can;
  // Drops fall in an arc from the spout onto the first seedling.
  const firstX = x0, landY = 520;
  for (let i = 0; i < 5; i++) {
    const t = (i + 0.6) / 5.6;
    s += drop(tx + (firstX - tx) * t + 20 * Math.sin(t * Math.PI), ty + (landY - ty) * t * t * 0.9 + (landY - ty) * t * 0.1, 0.85);
  }
  // A row of soil mounds with a seedling in each.
  let soil = `M${x0 - 120} 648`;
  for (let i = 0; i < count; i++) {
    const x = x0 + ((x1 - x0) / (count - 1)) * i;
    soil += ` L${n(x - 70)} 640 Q${n(x)} 560 ${n(x + 70)} 640`;
  }
  soil += ` L${x1 + 100} 648 Z`;
  let plants = '';
  for (let i = 0; i < count; i++) {
    const x = x0 + ((x1 - x0) / (count - 1)) * i + between(r, -8, 8);
    const k = grow ? i / (count - 1) : 1 - i / (count - 1);
    const h = 60 + k * 170 + between(r, -10, 10), top = 600 - h, bend = between(r, -18, 18);
    plants += stem(x, 610, x + bend * 0.3, top, bend);
    plants += leaf(x + bend * 0.3, top + 6, 54 + k * 30, GREENS[0], -30) + leaf(x + bend * 0.3, top + 6, 54 + k * 30, GREENS[1], -150);
    if (k > 0.45) plants += leaf(x + bend * 0.2, top + h * 0.45, 48 + k * 18, GREENS[2], i % 2 ? -25 : -155);
    if (k === 1) plants += bloom(whole(r, 0, 3), x + bend * 0.3, top - 30, 0.75, pick(r, p.acc), pick(r, p.acc), r() * Math.PI);
  }
  s += plants + `<path d="${soil}" fill="${BROWN}" ${OUTLINE}/>`;
  for (let i = 0; i < count; i++) {
    const x = x0 + ((x1 - x0) / (count - 1)) * i;
    s += `<circle cx="${n(x - 30)}" cy="622" r="6" fill="#fff" opacity=".35"/><circle cx="${n(x + 24)}" cy="630" r="5" fill="#fff" opacity=".35"/>`;
  }
  return s + twinkles(r, p.acc, 3, 40, 120, 380, 760);
};

// ---------------------------------------------------------------------------------------------- Mother's Day

/** A duck sitting on the water; (x, y) is the waterline under its middle, dir 1 faces right. */
function duck(x: number, y: number, s: number, dir: number, body: string, stroke: string, ink: string, tuft: boolean) {
  const P = (dx: number, dy: number) => `${n(x + dir * dx * s)} ${n(y + dy * s)}`;
  const X = (dx: number) => n(x + dir * dx * s), Y = (dy: number) => n(y + dy * s);
  return `<path d="M${P(-100, -14)} Q${P(-138, -82)} ${P(-104, -98)} Q${P(-76, -62)} ${P(-24, -66)} Q${P(62, -78)} ${P(98, -42)} Q${P(114, -8)} ${P(86, 0)} L${P(-78, 0)} Q${P(-100, 0)} ${P(-100, -14)} Z" fill="${body}" ${stroke}/>
<path d="M${P(-56, -48)} Q${P(-4, -74)} ${P(42, -44)} Q${P(-2, -18)} ${P(-56, -48)} Z" fill="${body}" ${stroke}/>
<circle cx="${X(58)}" cy="${Y(-118)}" r="${n(44 * s)}" fill="${body}" ${stroke}/>
<path d="M${P(94, -122)} Q${P(140, -118)} ${P(132, -102)} Q${P(114, -92)} ${P(94, -102)} Z" fill="#ff9f43" ${OUTLINE}/>
<circle cx="${X(72)}" cy="${Y(-128)}" r="${n(Math.max(5, 7 * s))}" fill="${ink}"/>
<circle cx="${X(56)}" cy="${Y(-106)}" r="${n(10 * s)}" fill="${CHEEK}" opacity=".5"/>
${tuft ? `<path d="M${P(50, -160)} q${n(dir * 4 * s)} ${n(-22 * s)} ${n(dir * 18 * s)} ${n(-18 * s)} M${P(60, -160)} q${n(dir * 10 * s)} ${n(-18 * s)} ${n(dir * 22 * s)} ${n(-8 * s)}" fill="none" stroke="${body}" stroke-width="7" stroke-linecap="round"/>` : ''}`;
}

/** Mother's Day A: a mother duck and her ducklings on the pond, with hearts rising between them. */
const ducks: Design = (r, p) => {
  const flip = r() < 0.5 ? 1 : -1, X = (x: number) => (flip > 0 ? x : 1080 - x);
  const cream = '#fffaf0', yellow = '#ffd23f';
  let s = cloud(X(between(r, 180, 240)), between(r, 140, 180), 0.8) + cloud(X(between(r, 820, 900)), between(r, 110, 150), 0.7);
  // Ripples on the pond.
  for (let i = 0; i < 7; i++) {
    const x = 90 + 150 * i + between(r, -20, 20), y = between(r, 600, 640);
    s += `<path d="M${n(x - 50)} ${n(y)} q25 -12 50 0 t50 0" fill="none" stroke="${WATER}" stroke-width="7" stroke-linecap="round" opacity=".6"/>`;
  }
  const ms = 1.6, mx = X(310), my = 585;
  s += duck(mx, my, ms, flip, cream, soft(p.ink, 6), p.ink, false);
  // A flower behind mother's head.
  s += flower(mx + flip * 40 * ms, my - 168 * ms, 6, 30, 22, [pick(r, p.acc)], '#ffc93c', r(), 9);
  const bs = between(r, 0.68, 0.76), gap = between(r, 200, 215);
  for (let i = 0; i < 2; i++) {
    const bx = X(670 + gap * i), by = 595 + between(r, -8, 8);
    s += duck(bx, by, bs, -flip, yellow, OUTLINE, p.ink, true);
  }
  // Hearts drift up from between mother and little ones.
  const hearts = whole(r, 3, 4), lean = between(r, 30, 60);
  for (let i = 0; i < hearts; i++)
    s += heart(X(600 + i * lean + (i % 2) * between(r, -20, 20)), 400 - i * 82 + between(r, -8, 8), 40 - i * 5, pick(r, p.acc));
  return s;
};

/** Mother's Day B: a bunch of heart balloons tied with a bow. */
const heartBalloons: Design = (r, p) => {
  const tx = 540 + between(r, -20, 20), ty = 590, colours = shuffled(r, p.acc);
  const spots: [number, number][] = [];
  const topRow = whole(r, 3, 4);
  for (let i = 0; i < topRow; i++) spots.push([280 + (520 / (topRow - 1)) * i + between(r, -15, 15), between(r, 140, 175)]);
  const midRow = topRow - 1;
  for (let i = 0; i < midRow; i++) spots.push([280 + (520 / (topRow - 1)) * (i + 0.5) + between(r, -15, 15), between(r, 320, 345)]);
  let strings = '', balloons = '';
  spots.forEach(([x, y], i) => {
    const sz = between(r, 80, 90), t = between(r, -14, 14), a = (t * Math.PI) / 180;
    const bx = x - Math.sin(a) * sz * 0.95, by = y + Math.cos(a) * sz * 0.95;
    strings += `<path d="M${n(bx)} ${n(by)} Q${n((bx + tx) / 2 + between(r, -30, 30))} ${n((by + ty) / 2)} ${n(tx)} ${n(ty)}" fill="none" stroke="${p.ink}" stroke-width="3" opacity=".45"/>`;
    const c = colours[i % colours.length];
    balloons += `<g transform="rotate(${n(t)} ${n(x)} ${n(y)})">${heart(x, y, sz, c)}
<ellipse cx="${n(x - sz * 0.62)}" cy="${n(y - sz * 0.42)}" rx="${n(sz * 0.14)}" ry="${n(sz * 0.24)}" transform="rotate(35 ${n(x - sz * 0.62)} ${n(y - sz * 0.42)})" fill="#fff" opacity=".55"/>
<path d="M${n(x - 9)} ${n(y + sz * 0.98)} h18 l-9 -12 z" fill="${c}"/></g>`;
  });
  const ribbon = pick(r, p.acc);
  let s = strings + balloons;
  s += `<ellipse cx="${n(tx - 30)}" cy="${ty}" rx="30" ry="18" fill="none" stroke="${ribbon}" stroke-width="11"/><ellipse cx="${n(tx + 30)}" cy="${ty}" rx="30" ry="18" fill="none" stroke="${ribbon}" stroke-width="11"/>
<path d="M${n(tx - 5)} ${ty + 6} q-10 30 -28 52 M${n(tx + 5)} ${ty + 6} q10 30 28 52" fill="none" stroke="${ribbon}" stroke-width="11" stroke-linecap="round"/><circle cx="${n(tx)}" cy="${ty}" r="14" fill="${ribbon}" stroke="#fff" stroke-width="4"/>`;
  // Small hearts and twinkles in the margins.
  for (const side of [-1, 1]) {
    s += heart(540 + side * between(r, 410, 440), between(r, 400, 470), between(r, 26, 34), pick(r, p.acc));
    s += sparkle(540 + side * between(r, 400, 440), between(r, 120, 230), between(r, 20, 28), pick(r, ['#ffc93c', ...p.acc]));
    s += sparkle(540 + side * between(r, 250, 300), between(r, 520, 600), between(r, 16, 22), pick(r, ['#ffc93c', ...p.acc]));
  }
  return s;
};

// ------------------------------------------------------------------------------------- World Environment Day

/** A small round bird; (x, y) is where it sits, dir 1 faces right. */
function bird(x: number, y: number, s: number, dir: number, c: string, ink: string) {
  const X = (dx: number) => n(x + dir * dx * s), Y = (dy: number) => n(y + dy * s);
  return `<path d="M${X(-30)} ${Y(-30)} l${n(-dir * 30 * s)} ${n(-14 * s)} l${n(dir * 6 * s)} ${n(26 * s)} z" fill="${c}" ${OUTLINE}/>
<ellipse cx="${X(0)}" cy="${Y(-34)}" rx="${n(38 * s)}" ry="${n(32 * s)}" fill="${c}" ${OUTLINE}/>
<path d="M${X(-18)} ${Y(-38)} q${n(dir * 20 * s)} ${n(-4 * s)} ${n(dir * 30 * s)} ${n(12 * s)} q${n(-dir * 18 * s)} ${n(10 * s)} ${n(-dir * 30 * s)} ${n(-12 * s)} z" fill="#fff" opacity=".5"/>
<path d="M${X(34)} ${Y(-46)} l${n(dir * 18 * s)} ${n(6 * s)} l${n(-dir * 18 * s)} ${n(6 * s)} z" fill="#ff9f43"/>
<circle cx="${X(18)}" cy="${Y(-48)}" r="${n(5 * s)}" fill="${ink}"/>
<path d="M${X(-6)} ${Y(-2)} v${n(10 * s)} M${X(8)} ${Y(-2)} v${n(10 * s)}" stroke="#ff9f43" stroke-width="5" stroke-linecap="round"/>`;
}

/** Environment A: a big tree with birds and fruit, bees and butterflies, and the sun. */
const bigTree: Design = (r, p) => {
  const cx = 540 + between(r, -50, 50), cy = 290, sunSide = r() < 0.5 ? -1 : 1;
  let s = sun(540 + sunSide * between(r, 400, 430), between(r, 105, 125), 52, '#ffc93c');
  s += grass(r, GREENS[2]);
  s += `<path d="M${n(cx - 46)} 648 Q${n(cx - 26)} 520 ${n(cx - 30)} 380 L${n(cx + 30)} 380 Q${n(cx + 26)} 520 ${n(cx + 46)} 648 Z" fill="${BROWN}" ${OUTLINE}/>
<path d="M${n(cx - 20)} 470 Q${n(cx - 80)} 430 ${n(cx - 120)} 400 M${n(cx + 18)} 440 Q${n(cx + 80)} 410 ${n(cx + 110)} 380" fill="none" stroke="${BROWN}" stroke-width="22" stroke-linecap="round"/>`;
  const blobs: [number, number, number][] = [[-175, 55, 92], [175, 55, 92], [-105, -45, 108], [105, -45, 108], [0, -110, 100], [0, 40, 118]];
  blobs.forEach(([dx, dy, br], i) => {
    s += `<circle cx="${n(cx + dx + between(r, -8, 8))}" cy="${n(cy + dy + between(r, -8, 8))}" r="${n(br + between(r, -6, 6))}" fill="${GREENS[i < 2 ? 1 : i % 2 ? 0 : 2]}" ${OUTLINE}/>`;
  });
  // Fruit or blossoms dotted over the leaves.
  const fruit = pick(r, p.acc.filter((c) => !greenish(c))), fruits = whole(r, 6, 8);
  for (let i = 0; i < fruits; i++) {
    const a = (2 * Math.PI * i) / fruits + between(r, -0.2, 0.2), d = between(r, 100, 190);
    s += `<circle cx="${n(cx + Math.cos(a) * d * 1.1)}" cy="${n(cy - 20 + Math.sin(a) * d * 0.62)}" r="15" fill="${fruit}" stroke="#fff" stroke-width="4"/>`;
  }
  // Birds sit on the top of the canopy.
  const perches = shuffled(r, [[-105, -45 - 108], [105, -45 - 108], [0, -110 - 100], [-175, 55 - 92], [175, 55 - 92]]).slice(0, whole(r, 2, 3));
  perches.forEach(([dx, dy]) => s += bird(cx + dx, cy + dy + 12, 0.9, dx < 0 ? -1 : 1, pick(r, p.acc.filter((c) => c !== fruit && !greenish(c))), p.ink));
  // Bees and butterflies in the margins either side of the tree.
  const lx = (cx - 265 + 30) / 2 + 15, rx = (cx + 265 + 1050) / 2 - 15, beeSide = r() < 0.5 ? -1 : 1;
  for (const side of [-1, 1]) {
    const x = side < 0 ? lx : rx;
    s += side === beeSide
      ? bee(x, between(r, 380, 440), 1.05, p.ink, -side, r) + butterfly(x + side * 10, between(r, 540, 570), 0.65, pick(r, p.acc), pick(r, p.acc), p.ink, between(r, -15, 15))
      : butterfly(x, between(r, 330, 400), 0.85, pick(r, p.acc), pick(r, p.acc), p.ink, side * between(r, 5, 15));
  }
  return s;
};

/** A round little tree; (x, y) is the foot of its trunk. */
const littleTree = (x: number, y: number, s: number, c: string) =>
  `<rect x="${n(x - 14 * s)}" y="${n(y - 120 * s)}" width="${n(28 * s)}" height="${n(120 * s)}" rx="${n(10 * s)}" fill="${BROWN}" ${OUTLINE}/>
<circle cx="${n(x)}" cy="${n(y - 170 * s)}" r="${n(78 * s)}" fill="${c}" ${OUTLINE}/>
<circle cx="${n(x - 26 * s)}" cy="${n(y - 196 * s)}" r="${n(16 * s)}" fill="#fff" opacity=".35"/>`;

/** Environment B: three friendly bins with leaves sprouting from their lids, between little trees. */
const bins: Design = (r, p) => {
  const colours = shuffled(r, p.acc).slice(0, 3);
  let s = sun(between(r, 520, 560), between(r, 95, 115), 50, '#ffc93c');
  s += cloud(between(r, 250, 330), between(r, 150, 190), 0.85) + cloud(between(r, 780, 860), between(r, 130, 170), 0.75);
  s += littleTree(between(r, 110, 140), 645, between(r, 1, 1.15), GREENS[0]) + littleTree(between(r, 940, 970), 645, between(r, 0.85, 1), GREENS[1]);
  const mid = whole(r, 0, 2);
  colours.forEach((c, i) => {
    const x = 330 + 210 * i + between(r, -8, 8), w = i === mid ? 170 : 150, h = i === mid ? between(r, 230, 250) : between(r, 190, 215);
    const top = 645 - h, half = w / 2;
    s += `<path d="M${n(x - half)} ${n(top)} L${n(x + half)} ${n(top)} L${n(x + half - 14)} 645 L${n(x - half + 14)} 645 Z" fill="${c}" ${OUTLINE}/>
<path d="M${n(x - half * 0.45)} ${n(top + 40)} V${n(top + h - 22)} M${n(x + half * 0.45)} ${n(top + 40)} V${n(top + h - 22)}" stroke="#fff" stroke-width="7" stroke-linecap="round" opacity=".45"/>`;
    // Leaves peek out from under the lid, then the lid with its handle.
    const lt = top - 22;
    s += leaf(x - half * 0.4, top + 2, 56, GREENS[i % 3], -135) + leaf(x + half * 0.35, top + 2, 50, GREENS[(i + 1) % 3], -50);
    s += `<rect x="${n(x - half - 12)}" y="${n(lt)}" width="${n(w + 24)}" height="30" rx="12" fill="${c}" ${OUTLINE}/>
<rect x="${n(x - 26)}" y="${n(lt - 20)}" width="52" height="24" rx="10" fill="none" stroke="${c}" stroke-width="10"/>
${face(x, top + h * 0.42, 62, p.ink)}`;
  });
  s += butterfly(between(r, 400, 440), between(r, 230, 260), 0.7, pick(r, p.acc), pick(r, p.acc), p.ink, between(r, -15, 15));
  s += bee(between(r, 660, 700), between(r, 250, 280), 0.9, p.ink, -1, r);
  return s;
};

// ---------------------------------------------------------------------------------------------- Father's Day

/** A sitting teddy-like bear; (x, y) is the floor under its middle. */
function bear(x: number, y: number, s: number, fur: string, light: string, ink: string) {
  const X = (dx: number) => n(x + dx * s), Y = (dy: number) => n(y + dy * s), S = (v: number) => n(v * s);
  let out = '';
  for (const side of [-1, 1])
    out += `<ellipse cx="${X(side * 92)}" cy="${Y(-150)}" rx="${S(32)}" ry="${S(58)}" transform="rotate(${side * 22} ${X(side * 92)} ${Y(-150)})" fill="${fur}" ${OUTLINE}/>`;
  out += `<ellipse cx="${X(0)}" cy="${Y(-112)}" rx="${S(106)}" ry="${S(112)}" fill="${fur}" ${OUTLINE}/>
<ellipse cx="${X(0)}" cy="${Y(-100)}" rx="${S(62)}" ry="${S(70)}" fill="${light}"/>`;
  for (const side of [-1, 1])
    out += `<ellipse cx="${X(side * 64)}" cy="${Y(-22)}" rx="${S(42)}" ry="${S(28)}" fill="${fur}" ${OUTLINE}/><ellipse cx="${X(side * 64)}" cy="${Y(-22)}" rx="${S(22)}" ry="${S(15)}" fill="${light}"/>
<circle cx="${X(side * 62)}" cy="${Y(-338)}" r="${S(32)}" fill="${fur}" ${OUTLINE}/><circle cx="${X(side * 62)}" cy="${Y(-338)}" r="${S(16)}" fill="${light}"/>`;
  out += `<circle cx="${X(0)}" cy="${Y(-272)}" r="${S(88)}" fill="${fur}" ${OUTLINE}/>
<ellipse cx="${X(0)}" cy="${Y(-242)}" rx="${S(42)}" ry="${S(32)}" fill="${light}"/>
<ellipse cx="${X(0)}" cy="${Y(-256)}" rx="${S(15)}" ry="${S(11)}" fill="${ink}"/>
<path d="M${X(0)} ${Y(-246)} v${S(10)} M${X(-14)} ${Y(-232)} q${S(14)} ${S(12)} ${S(28)} 0" fill="none" stroke="${ink}" stroke-width="${n(Math.max(4, 6 * s))}" stroke-linecap="round"/>
<circle cx="${X(-34)}" cy="${Y(-292)}" r="${S(9)}" fill="${ink}"/><circle cx="${X(34)}" cy="${Y(-292)}" r="${S(9)}" fill="${ink}"/>
<circle cx="${X(-56)}" cy="${Y(-252)}" r="${S(13)}" fill="${CHEEK}" opacity=".5"/><circle cx="${X(56)}" cy="${Y(-252)}" r="${S(13)}" fill="${CHEEK}" opacity=".5"/>`;
  return out;
}

/** Father's Day A: a big bear and a little bear side by side, with hearts above. */
const bears: Design = (r, p) => {
  const flip = r() < 0.5 ? 1 : -1, X = (x: number) => (flip > 0 ? x : 1080 - x);
  const [fur, light] = pick(r, [['#a9744f', '#e8c39e'], ['#8d5a3b', '#d9a77a'], ['#b5835a', '#f0d2b0']]);
  let s = twinkles(r, p.acc, 5, 40, 140);
  s += grass(r, GREENS[2]);
  const fx = X(390 + between(r, -15, 15)), bx = X(680 + between(r, -15, 15));
  // Daddy's arm reaches across behind the little one.
  s += bear(fx, 640, 1.22, fur, light, FACE);
  s += bear(bx, 640, 0.68, fur, light, FACE);
  s += `<path d="M${n(fx + flip * 110)} 470 Q${n((fx + bx) / 2)} 440 ${n(bx - flip * 40)} 470" fill="none" stroke="${fur}" stroke-width="40" stroke-linecap="round"/>`;
  s += `<circle cx="${n(bx - flip * 40)}" cy="470" r="22" fill="${fur}" ${OUTLINE}/>`;
  const hx = X(between(r, 640, 700));
  s += heart(hx, 230, 46, pick(r, p.acc)) + heart(hx + flip * 90, 150, 30, pick(r, p.acc)) + heart(hx - flip * 70, 110, 22, pick(r, p.acc));
  // A flower or two in the grass.
  s += flower(X(870 + between(r, -20, 20)), 600, 6, 34, 26, [pick(r, p.acc)], '#ffc93c', r(), 10) + stem(X(870), 645, X(870), 620);
  return s;
};

/** Father's Day B: a big kite and a little kite flying together over a green hill. */
const kites: Design = (r, p) => {
  const flip = r() < 0.5 ? 1 : -1, X = (x: number) => (flip > 0 ? x : 1080 - x);
  const colours = shuffled(r, p.acc);
  let s = sun(X(between(r, 920, 960)), between(r, 95, 115), 46, '#ffc93c');
  s += cloud(X(between(r, 600, 660)), between(r, 110, 150), 0.85) + cloud(X(between(r, 140, 200)), between(r, 420, 470), 0.7) + cloud(X(between(r, 860, 920)), between(r, 400, 440), 0.6);
  const big = [X(between(r, 320, 370)), between(r, 165, 185)], small = [X(between(r, 690, 740)), between(r, 240, 265)];
  const hand = [X(500), 610], hand2 = [X(580), 616];
  s += `<path d="M${n(big[0])} ${n(big[1] + 10)} Q${n((big[0] + hand[0]) / 2 + flip * 60)} ${n((big[1] + hand[1]) / 2 + 60)} ${n(hand[0])} ${hand[1]}" fill="none" stroke="${p.ink}" stroke-width="3" opacity=".45"/>
<path d="M${n(small[0])} ${n(small[1] + 10)} Q${n((small[0] + hand2[0]) / 2 - flip * 40)} ${n((small[1] + hand2[1]) / 2 + 50)} ${n(hand2[0])} ${hand2[1]}" fill="none" stroke="${p.ink}" stroke-width="3" opacity=".45"/>`;
  s += kite(big[0], big[1], 1.65, colours[0], colours[1], flip * between(r, -18, -8));
  s += kite(small[0], small[1], 1.1, colours[2], colours[3], flip * between(r, 8, 18));
  // The hill they fly from, with a few flowers.
  s += `<path d="M${n(X(180))} 652 Q${n(X(540))} 520 ${n(X(900))} 652 Z" fill="${GREENS[2]}" ${OUTLINE}/>`;
  for (let i = 0; i < 3; i++) {
    const x = X(360 + 170 * i + between(r, -20, 20));
    s += flower(x, 640 - (i === 1 ? 50 : 22), 5, 26, 20, [pick(r, p.acc)], '#ffc93c', r(), 8);
  }
  s += heart(X(between(r, 520, 560)), between(r, 330, 380), 32, colours[4]);
  return s;
};

export const womensDay: Design[] = [bouquet, garden];
export const healthDay: Design[] = [apple, soap];
export const earthDay: Design[] = [hugGlobe, seedlings];
export const mothersDay: Design[] = [ducks, heartBalloons];
export const environmentDay: Design[] = [bigTree, bins];
export const fathersDay: Design[] = [bears, kites];
