// Drawings for Raksha Bandhan, Janmashtami, Onam, Ganesh Chaturthi, Dussehra and Guru Nanak Jayanti.
import { between, pick, whole } from '../palettes';
import { cloud, diya, flower, gift, heart, n, OUTLINE, sparkle, star, sun } from '../motifs';
import type { Design, Rng } from '../types';

/** Marigold orange and yellow, with the darker middle of the flower. */
const MARIGOLD = ['#ff9f1c', '#ffc93c'];
const MARIGOLD_MID = '#e8750a';
const LEAF = ['#2fa84f', '#46b862'];
const BRASS = '#f2b134', BRASS_LIGHT = '#ffd36b', BRASS_DARK = '#d98e1a';
const STEEL = '#cfd6df', STEEL_LIGHT = '#eef2f6';
const CREAM = '#fff4c2';

/** A soft ink outline for pale shapes (steel, cream sweets) that would vanish on the pale card. */
const soft = (ink: string, w = 5) => `stroke="${ink}" stroke-opacity=".18" stroke-width="${w}" stroke-linejoin="round"`;

/** A point on a quadratic curve. */
const quad = (x1: number, y1: number, cx: number, cy: number, x2: number, y2: number, t: number): [number, number] => [
  (1 - t) * (1 - t) * x1 + 2 * (1 - t) * t * cx + t * t * x2,
  (1 - t) * (1 - t) * y1 + 2 * (1 - t) * t * cy + t * t * y2,
];

/** A shuffled copy of a list. */
function shuffle<T>(r: Rng, list: readonly T[]) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** A round marigold. */
const marigold = (x: number, y: number, R: number, colour = MARIGOLD[0]) => {
  let s = `<circle cx="${n(x)}" cy="${n(y)}" r="${n(R)}" fill="${colour}" stroke="#fff" stroke-width="4"/>`;
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i;
    s += `<circle cx="${n(x + Math.cos(a) * R * 0.55)}" cy="${n(y + Math.sin(a) * R * 0.55)}" r="${n(R * 0.3)}" fill="${colour === MARIGOLD[0] ? MARIGOLD[1] : MARIGOLD[0]}"/>`;
  }
  return s + `<circle cx="${n(x)}" cy="${n(y)}" r="${n(R * 0.3)}" fill="${MARIGOLD_MID}"/>`;
};

/** A string of marigolds hanging between two points. */
function garland(x1: number, y1: number, x2: number, y2: number, sag: number, step = 40, R = 17) {
  const cx = (x1 + x2) / 2, cy = Math.max(y1, y2) + sag * 2;
  const count = Math.max(2, Math.round((Math.hypot(x2 - x1, y2 - y1) + sag) / step));
  let s = `<path d="M${n(x1)} ${n(y1)} Q${n(cx)} ${n(cy)} ${n(x2)} ${n(y2)}" fill="none" stroke="#2f8f46" stroke-width="5"/>`;
  for (let i = 0; i <= count; i++) {
    const [x, y] = quad(x1, y1, cx, cy, x2, y2, i / count);
    s += `<circle cx="${n(x)}" cy="${n(y)}" r="${R}" fill="${MARIGOLD[i % 2]}" stroke="#fff" stroke-width="3"/><circle cx="${n(x)}" cy="${n(y)}" r="${n(R * 0.38)}" fill="${MARIGOLD_MID}"/>`;
  }
  return s;
}

/** A toran: a straight marigold string with mango leaves hanging from it, across the top. */
function toran(r: Rng, x1: number, x2: number, y: number) {
  let s = '';
  const leaves = Math.round((x2 - x1) / 62);
  for (let i = 0; i <= leaves; i++) {
    const x = x1 + ((x2 - x1) / leaves) * i, len = between(r, 58, 74);
    s += `<path d="M${n(x)} ${n(y)} Q${n(x + 22)} ${n(y + len * 0.45)} ${n(x)} ${n(y + len)} Q${n(x - 22)} ${n(y + len * 0.45)} ${n(x)} ${n(y)} Z" fill="${LEAF[i % 2]}" stroke="#fff" stroke-width="3" stroke-linejoin="round"/>`;
  }
  return s + garland(x1, y, x2, y, 0, 36, 15);
}

/** A string of fairy lights between two points. */
function lights(x1: number, y1: number, x2: number, y2: number, sag: number, count: number, colours: string[], ink: string) {
  const cx = (x1 + x2) / 2, cy = Math.max(y1, y2) + sag * 2;
  let s = `<path d="M${n(x1)} ${n(y1)} Q${n(cx)} ${n(cy)} ${n(x2)} ${n(y2)}" fill="none" stroke="${ink}" stroke-width="3" opacity=".4"/>`;
  for (let i = 1; i < count; i++) {
    const [x, y] = quad(x1, y1, cx, cy, x2, y2, i / count), c = colours[i % colours.length];
    s += `<circle cx="${n(x)}" cy="${n(y + 18)}" r="24" fill="${c}" opacity=".22"/>
<rect x="${n(x - 6)}" y="${n(y)}" width="12" height="9" rx="2" fill="${ink}" opacity=".45"/>
<ellipse cx="${n(x)}" cy="${n(y + 20)}" rx="10" ry="14" fill="${c}" stroke="#fff" stroke-width="3"/>`;
  }
  return s;
}

/** A modak: a pleated teardrop sweet; (x, y) is the middle of its base, s its half-width. */
function modak(x: number, y: number, s: number, fill: string, ink: string) {
  let m = `<path d="M${n(x)} ${n(y - 1.55 * s)} C${n(x + 0.25 * s)} ${n(y - 1.15 * s)} ${n(x + s)} ${n(y - 0.85 * s)} ${n(x + s)} ${n(y - 0.35 * s)} Q${n(x + s)} ${n(y)} ${n(x)} ${n(y)} Q${n(x - s)} ${n(y)} ${n(x - s)} ${n(y - 0.35 * s)} C${n(x - s)} ${n(y - 0.85 * s)} ${n(x - 0.25 * s)} ${n(y - 1.15 * s)} ${n(x)} ${n(y - 1.55 * s)} Z" fill="${fill}" ${soft(ink)}/>`;
  for (const k of [-2, -1, 0, 1, 2])
    m += `<path d="M${n(x)} ${n(y - 1.45 * s)} Q${n(x + k * 0.42 * s)} ${n(y - 0.75 * s)} ${n(x + k * 0.36 * s)} ${n(y - 0.1 * s)}" fill="none" stroke="#d9a35b" stroke-width="${n(Math.max(3, s * 0.08))}" stroke-linecap="round" opacity=".7"/>`;
  return m;
}

/** A tiny bare footprint; (x, y) is the middle of the sole. */
function footprint(x: number, y: number, s: number, fill: string, tilt: number, left: boolean) {
  const side = left ? -1 : 1;
  let f = `<g transform="rotate(${n(tilt)} ${n(x)} ${n(y)})" fill="${fill}"><ellipse cx="${n(x)}" cy="${n(y)}" rx="${n(11 * s)}" ry="${n(18 * s)}"/>`;
  const toes: [number, number, number][] = [[-8, -26, 5], [-1, -29, 4.4], [5, -27, 3.8], [10, -23, 3.4], [13, -17, 3]];
  for (const [dx, dy, rr] of toes) f += `<circle cx="${n(x + side * dx * s)}" cy="${n(y + dy * s)}" r="${n(rr * s)}"/>`;
  return f + '</g>';
}

/** A crossed bow and two arrows pointing up, as a decoration; (x, y) is where they cross. */
function bowAndArrows(x: number, y: number, s: number, ink: string, feather: string) {
  const arrow = (angle: number) => `<g transform="rotate(${angle} ${n(x)} ${n(y)})">
<line x1="${n(x)}" y1="${n(y + 170 * s)}" x2="${n(x)}" y2="${n(y - 150 * s)}" stroke="#8d5a3b" stroke-width="${n(14 * s)}" stroke-linecap="round"/>
<path d="M${n(x)} ${n(y - 200 * s)} l${n(20 * s)} ${n(46 * s)} h${n(-40 * s)} z" fill="#ffc93c" stroke="#fff" stroke-width="4" stroke-linejoin="round"/>
<path d="M${n(x)} ${n(y + 120 * s)} l${n(-24 * s)} ${n(30 * s)} v${n(34 * s)} l${n(24 * s)} ${n(-22 * s)} l${n(24 * s)} ${n(22 * s)} v${n(-34 * s)} z" fill="${feather}" stroke="#fff" stroke-width="4" stroke-linejoin="round"/></g>`;
  const bow = `<path d="M${n(x - 30 * s)} ${n(y - 190 * s)} Q${n(x + 140 * s)} ${n(y)} ${n(x - 30 * s)} ${n(y + 190 * s)}" fill="none" stroke="#fff" stroke-width="${n(26 * s)}" stroke-linecap="round"/>
<path d="M${n(x - 30 * s)} ${n(y - 190 * s)} Q${n(x + 140 * s)} ${n(y)} ${n(x - 30 * s)} ${n(y + 190 * s)}" fill="none" stroke="#a0522d" stroke-width="${n(16 * s)}" stroke-linecap="round"/>
<line x1="${n(x - 30 * s)}" y1="${n(y - 190 * s)}" x2="${n(x - 30 * s)}" y2="${n(y + 190 * s)}" stroke="${ink}" stroke-width="4" opacity=".45"/>
<circle cx="${n(x + 55 * s)}" cy="${n(y)}" r="${n(16 * s)}" fill="${feather}" stroke="#fff" stroke-width="4"/>`;
  return bow + arrow(-28) + arrow(28) + marigold(x, y, 26 * s);
}

// ---------------------------------------------------------------- Raksha Bandhan

/** Raksha Bandhan A: one big rakhi across the card, with beads, tassels and hearts. */
const bigRakhi: Design = (r, p) => {
  const cols = shuffle(r, p.acc), cx = between(r, 500, 580), cy = between(r, 310, 350);
  const thread = cols[0], beads = [cols[1], cols[2]];
  let s = '';
  // Hearts and twinkles in the corners, kept clear of the thread.
  const spots: [number, number][] = [[between(r, 110, 190), between(r, 90, 150)], [between(r, 880, 960), between(r, 90, 150)], [between(r, 150, 260), between(r, 540, 600)], [between(r, 820, 930), between(r, 540, 600)]];
  spots.forEach(([x, y], i) => (s += heart(x, y, between(r, 30, 44), cols[(i + 3) % 5])));
  for (let i = 0; i < 4; i++) s += sparkle(between(r, 300, 780), i < 2 ? between(r, 40, 90) : between(r, 590, 630), between(r, 12, 20), pick(r, p.acc));
  for (const side of [-1, 1]) {
    const x1 = side < 0 ? 70 : 1010, y1 = cy + between(r, 20, 60), bx = (x1 + cx) / 2, by = cy + between(r, -50, 50);
    const d = `M${n(x1)} ${n(y1)} Q${n(bx)} ${n(by)} ${n(cx)} ${n(cy)}`;
    s += `<path d="${d}" fill="none" stroke="#fff" stroke-width="28" stroke-linecap="round"/>
<path d="${d}" fill="none" stroke="${thread}" stroke-width="18" stroke-linecap="round"/>
<path d="${d}" fill="none" stroke="${CREAM}" stroke-width="18" stroke-dasharray="8 16"/>`;
    const count = whole(r, 2, 3);
    for (let i = 1; i <= count; i++) {
      const [x, y] = quad(x1, y1, bx, by, cx, cy, 0.18 + (0.5 / count) * i);
      s += `<circle cx="${n(x)}" cy="${n(y)}" r="17" fill="${beads[i % 2]}" ${OUTLINE}/><circle cx="${n(x - 5)}" cy="${n(y - 5)}" r="5" fill="#fff" opacity=".6"/>`;
    }
    // A tassel at the end of the thread.
    s += `<path d="M${n(x1 - 12)} ${n(y1 + 20)} v62 M${n(x1)} ${n(y1 + 20)} v76 M${n(x1 + 12)} ${n(y1 + 20)} v62" stroke="${thread}" stroke-width="7" stroke-linecap="round"/>
<circle cx="${n(x1)}" cy="${n(y1 + 10)}" r="18" fill="${beads[0]}" ${OUTLINE}/>`;
  }
  // The centrepiece: a scalloped backing, two rings of petals and a jewel.
  const petals = 8 + 2 * whole(r, 0, 3), rot = r() * Math.PI, scallops = 18;
  for (let i = 0; i < scallops; i++) {
    const a = (2 * Math.PI * i) / scallops + rot;
    s += `<circle cx="${n(cx + Math.cos(a) * 160)}" cy="${n(cy + Math.sin(a) * 160)}" r="30" fill="${i % 2 ? cols[3] : cols[4]}" ${OUTLINE}/>`;
  }
  s += `<circle cx="${n(cx)}" cy="${n(cy)}" r="162" fill="${cols[3]}" ${OUTLINE}/>`;
  s += flower(cx, cy, petals, 140, 58, [cols[1], cols[2]], '#ffc93c', rot, 40);
  s += flower(cx, cy, petals, 86, 38, [CREAM, '#ffc93c'], '#ffc93c', rot + Math.PI / petals, 40);
  s += `<circle cx="${n(cx)}" cy="${n(cy)}" r="20" fill="${p.head[1]}"/><circle cx="${n(cx - 7)}" cy="${n(cy - 7)}" r="6" fill="#fff" opacity=".7"/>`;
  return s;
};

/** Raksha Bandhan B: a brass thali with sweets, a diya and a little rakhi, gifts and hearts. */
const thali: Design = (r, p) => {
  const cols = shuffle(r, p.acc);
  let s = '';
  const hearts = 5;
  for (let i = 0; i < hearts; i++) {
    const x = 200 + 170 * i + between(r, -20, 20), y = 150 - Math.sin((Math.PI * i) / (hearts - 1)) * 60 + between(r, -15, 15);
    s += heart(x, y, i % 2 ? between(r, 28, 36) : between(r, 40, 50), cols[i % 5]);
  }
  for (let i = 0; i < 5; i++) s += sparkle(between(r, 80, 1000), between(r, 240, 330), between(r, 12, 18), pick(r, p.acc));
  // Gifts on the floor either side.
  const gw = between(r, 100, 130), gh = between(r, 80, 110);
  s += gift(115 - gw / 2 + 30, 640 - gh, gw, gh, cols[1]);
  s += gift(965 - gw / 2 - 30, 640 - gh * 0.85, gw * 0.9, gh * 0.85, cols[2]);
  // The plate.
  s += `<ellipse cx="540" cy="560" rx="330" ry="80" fill="${BRASS}" ${OUTLINE}/>
<ellipse cx="540" cy="552" rx="282" ry="58" fill="${BRASS_LIGHT}"/>`;
  for (let i = 0; i < 30; i++) {
    const a = (2 * Math.PI * i) / 30;
    s += `<circle cx="${n(540 + Math.cos(a) * 308)}" cy="${n(557 + Math.sin(a) * 70)}" r="5" fill="${BRASS_DARK}"/>`;
  }
  const flip = r() < 0.5 ? 1 : -1;
  // A little pyramid of laddoos.
  const lx = 540 - flip * 170;
  const balls: [number, number][] = [[-76, 0], [0, 0], [76, 0], [-38, -62], [38, -62], [0, -124]];
  for (const [dx, dy] of balls) {
    const x = lx + dx, y = 535 + dy;
    s += `<circle cx="${n(x)}" cy="${n(y)}" r="40" fill="#ffa62b" ${OUTLINE}/><circle cx="${n(x - 12)}" cy="${n(y - 6)}" r="4" fill="#e07b00"/><circle cx="${n(x + 10)}" cy="${n(y + 8)}" r="4" fill="#e07b00"/><circle cx="${n(x + 6)}" cy="${n(y - 16)}" r="4" fill="#e07b00"/>`;
  }
  s += diya(540, 555, 1.05);
  // A small rakhi lying on the plate.
  const rx = 540 + flip * 180, ry = 520;
  s += `<path d="M${n(rx - 120)} ${n(ry + 26)} Q${n(rx - 60)} ${n(ry - 20)} ${n(rx)} ${n(ry)} Q${n(rx + 60)} ${n(ry + 20)} ${n(rx + 120)} ${n(ry - 10)}" fill="none" stroke="${cols[0]}" stroke-width="12" stroke-linecap="round"/>`;
  s += flower(rx, ry, 10, 70, 32, [cols[3], cols[4]], '#ffc93c', r() * Math.PI, 18);
  return s;
};

// ---------------------------------------------------------------- Janmashtami

/** Janmashtami A: a pot of butter hung high on a rope (dahi handi), marigolds and little footprints. */
const dahiHandi: Design = (r, p) => {
  const cols = shuffle(r, p.acc), px = between(r, 480, 600), lift = between(r, 0, 30);
  const y1 = 40, cy = 210 - lift, k = 1.25;
  // The rope low point is under the pot.
  const [, low] = quad(30, y1, px, cy, 1050, y1, 0.5);
  let s = `<path d="M30 ${y1} Q${n(px)} ${n(cy)} 1050 ${y1}" fill="none" stroke="#a1774a" stroke-width="10" stroke-linecap="round"/>`;
  for (let i = 1; i < 14; i++) {
    if (i === 7) continue;
    const [x, y] = quad(30, y1, px, cy, 1050, y1, i / 14);
    s += marigold(x, y, 18, MARIGOLD[i % 2]);
    if (i % 3 === 0) s += `<line x1="${n(x)}" y1="${n(y + 18)}" x2="${n(x)}" y2="${n(y + 70)}" stroke="#2f8f46" stroke-width="4"/>` + marigold(x, y + 76, 13, MARIGOLD[(i + 1) % 2]);
  }
  const [hx] = quad(30, y1, px, cy, 1050, y1, 0.5);
  const top = low + 90, bodyY = top + 130;
  s += `<path d="M${n(hx)} ${n(low)} L${n(hx - 70)} ${n(top)} M${n(hx)} ${n(low)} L${n(hx + 70)} ${n(top)} M${n(hx)} ${n(low)} V${n(top)}" stroke="#a1774a" stroke-width="6" stroke-linecap="round"/>`;
  // The clay pot, drawn a little larger around the rope's low point.
  s += `<g transform="translate(${n(hx)} ${n(low)}) scale(${k}) translate(${n(-hx)} ${n(-low)})">`;
  s += `<circle cx="${n(hx)}" cy="${n(bodyY)}" r="128" fill="#c75b2a" ${OUTLINE}/>
<rect x="${n(hx - 82)}" y="${n(top - 4)}" width="164" height="40" rx="14" fill="#b04a1f" ${OUTLINE}/>
<path d="M${n(hx - 118)} ${n(bodyY - 20)} Q${n(hx)} ${n(bodyY + 10)} ${n(hx + 118)} ${n(bodyY - 20)} L${n(hx + 124)} ${n(bodyY + 22)} Q${n(hx)} ${n(bodyY + 52)} ${n(hx - 124)} ${n(bodyY + 22)} Z" fill="${cols[0]}"/>`;
  for (let i = 0; i < 7; i++) s += `<circle cx="${n(hx - 90 + 30 * i)}" cy="${n(bodyY + 10 + Math.sin((Math.PI * i) / 6) * 20)}" r="7" fill="${CREAM}"/>`;
  // Butter heaped over the rim.
  s += `<path d="M${n(hx - 78)} ${n(top)} q-6 -40 30 -48 q14 -40 54 -24 q40 -20 52 22 q30 10 20 50 q-6 24 -14 0 q-30 6 -60 2 q-10 30 -20 0 q-30 0 -62 -2 z" fill="#fffaf0" ${soft(p.ink)}/>`;
  s += marigold(hx - 82, top + 16, 16) + marigold(hx + 82, top + 16, 16, MARIGOLD[1]) + '</g>';
  // Little footprints walking in towards the pot.
  const from = r() < 0.5 ? -1 : 1, fill = p.head[1];
  for (let i = 0; i < 4; i++) {
    const x = 540 + from * (440 - 92 * i), y = 618 - i * 6;
    s += footprint(x, y + (i % 2 ? -24 : 0), 1.6, fill, from * -90 + (i % 2 ? 6 : -6), i % 2 === 0);
  }
  for (const x of [from < 0 ? 900 : 180]) s += flower(x, 590, 6, 60, 34, [cols[1], cols[2]], '#ffc93c', r(), 14);
  for (let i = 0; i < 4; i++) s += sparkle(i < 2 ? between(r, 120, 300) : between(r, 780, 960), between(r, 220, 420), between(r, 12, 20), pick(r, p.acc));
  return s;
};

/** A peacock feather; (x, y) is the bottom of the quill, standing up, tilted by `tilt` degrees. */
function peacockFeather(x: number, y: number, s: number, tilt: number) {
  const P = (dx: number, dy: number) => `${n(x + dx * s)} ${n(y + dy * s)}`;
  return `<g transform="rotate(${n(tilt)} ${n(x)} ${n(y)})">
<path d="M${P(0, 0)} L${P(0, -420)}" stroke="#8d6e63" stroke-width="${n(8 * s)}" stroke-linecap="round"/>
<path d="M${P(0, -40)} q${n(-40 * s)} ${n(-40 * s)} ${n(-60 * s)} ${n(-90 * s)} M${P(0, -40)} q${n(40 * s)} ${n(-40 * s)} ${n(60 * s)} ${n(-90 * s)} M${P(0, -80)} q${n(-50 * s)} ${n(-30 * s)} ${n(-80 * s)} ${n(-90 * s)} M${P(0, -80)} q${n(50 * s)} ${n(-30 * s)} ${n(80 * s)} ${n(-90 * s)}" fill="none" stroke="#3fae5a" stroke-width="${n(6 * s)}" stroke-linecap="round"/>
<path d="M${P(0, -110)} C${P(120, -200)} ${P(130, -420)} ${P(0, -480)} C${P(-130, -420)} ${P(-120, -200)} ${P(0, -110)} Z" fill="#3fae5a" ${OUTLINE}/>
<ellipse cx="${n(x)}" cy="${n(y - 360 * s)}" rx="${n(64 * s)}" ry="${n(80 * s)}" fill="#e8b33a"/>
<ellipse cx="${n(x)}" cy="${n(y - 356 * s)}" rx="${n(46 * s)}" ry="${n(60 * s)}" fill="#18a6a0"/>
<path d="M${P(0, -312)} C${P(-40, -340)} ${P(-30, -390)} ${P(0, -384)} C${P(30, -390)} ${P(40, -340)} ${P(0, -312)} Z" fill="#1a3c8f"/></g>`;
}

/** A music note floating up. */
const note = (x: number, y: number, s: number, fill: string, double = false) =>
  double
    ? `<ellipse cx="${n(x)}" cy="${n(y)}" rx="${n(14 * s)}" ry="${n(10 * s)}" fill="${fill}" transform="rotate(-20 ${n(x)} ${n(y)})"/><ellipse cx="${n(x + 44 * s)}" cy="${n(y - 10 * s)}" rx="${n(14 * s)}" ry="${n(10 * s)}" fill="${fill}" transform="rotate(-20 ${n(x + 44 * s)} ${n(y - 10 * s)})"/>
<path d="M${n(x + 12 * s)} ${n(y - 4 * s)} V${n(y - 64 * s)} L${n(x + 56 * s)} ${n(y - 74 * s)} V${n(y - 14 * s)}" fill="none" stroke="${fill}" stroke-width="${n(6 * s)}" stroke-linejoin="round"/>`
    : `<ellipse cx="${n(x)}" cy="${n(y)}" rx="${n(14 * s)}" ry="${n(10 * s)}" fill="${fill}" transform="rotate(-20 ${n(x)} ${n(y)})"/>
<path d="M${n(x + 12 * s)} ${n(y - 4 * s)} V${n(y - 64 * s)} q${n(10 * s)} ${n(20 * s)} ${n(28 * s)} ${n(26 * s)}" fill="none" stroke="${fill}" stroke-width="${n(6 * s)}" stroke-linecap="round"/>`;

/** Janmashtami B: a flute with a peacock feather, music notes and flowers. */
const flute: Design = (r, p) => {
  const cols = shuffle(r, p.acc), angle = between(r, -18, -10), cx = 540, cy = 380;
  let s = '';
  s += peacockFeather(between(r, 560, 640), 610, 1, between(r, 18, 30));
  if (r() < 0.6) s += peacockFeather(between(r, 400, 460), 600, 0.75, between(r, -34, -22));
  // The flute, drawn level and turned.
  let f = `<rect x="150" y="${cy - 24}" width="780" height="48" rx="24" fill="#d9a35b" ${OUTLINE}/>
<rect x="160" y="${cy - 14}" width="760" height="10" rx="5" fill="#f0c98a"/>`;
  for (const x of [210, 238, 840, 868]) f += `<rect x="${x}" y="${cy - 24}" width="16" height="48" fill="${x < 500 ? cols[0] : cols[1]}"/>`;
  f += `<ellipse cx="300" cy="${cy}" rx="11" ry="8" fill="#7a4a12"/>`;
  for (let i = 0; i < 6; i++) f += `<ellipse cx="${520 + 50 * i}" cy="${cy}" rx="9" ry="7" fill="#7a4a12"/>`;
  s += `<g transform="rotate(${n(angle)} ${cx} ${cy})">${f}</g>`;
  // A tassel hanging straight down from the far end.
  const a = (angle * Math.PI) / 180, ex = cx + Math.cos(a) * 330, ey = cy + Math.sin(a) * 330 + 20;
  s += `<path d="M${n(ex)} ${n(ey)} V${n(ey + 70)}" stroke="${cols[2]}" stroke-width="6"/><circle cx="${n(ex)}" cy="${n(ey + 76)}" r="14" fill="${cols[2]}" ${OUTLINE}/>
<path d="M${n(ex - 10)} ${n(ey + 92)} v44 M${n(ex)} ${n(ey + 92)} v54 M${n(ex + 10)} ${n(ey + 92)} v44" stroke="${cols[2]}" stroke-width="6" stroke-linecap="round"/>`;
  // Notes rising from the mouthpiece end.
  const mx = cx - Math.cos(a) * 260, my = cy - Math.sin(a) * 260;
  s += note(mx - 120, my - 120, 1.1, cols[3]) + note(mx - 20, my - 230, 0.9, cols[4], true) + note(mx - 190, my - 290, 0.8, cols[0]);
  for (let i = 0; i < 6; i++) s += sparkle(between(r, 680, 1000), between(r, 50, 250), between(r, 12, 20), pick(r, p.acc));
  // Flowers on the floor.
  const count = whole(r, 3, 4);
  for (let i = 0; i < count; i++) {
    const x = i < 2 ? 90 + 110 * i : 990 - 110 * (i - 2), y = between(r, 580, 610);
    s += flower(x, y, 6, 58, 32, [cols[(i + 1) % 5], cols[(i + 2) % 5]], '#ffc93c', r(), 13);
  }
  return s;
};

// ---------------------------------------------------------------- Onam

/** A ring segment between radii R1 < R2, from angle a0 to a1. */
function wedge(cx: number, cy: number, R1: number, R2: number, a0: number, a1: number, fill: string) {
  const pt = (R: number, a: number) => `${n(cx + Math.cos(a) * R)} ${n(cy + Math.sin(a) * R)}`;
  return `<path d="M${pt(R2, a0)} A${R2} ${R2} 0 0 1 ${pt(R2, a1)} L${pt(R1, a1)} A${R1} ${R1} 0 0 0 ${pt(R1, a0)} Z" fill="${fill}" ${OUTLINE}/>`;
}

/** Onam A: a pookalam, a round flower carpet of rings, between banana leaves and diyas. */
const pookalam: Design = (r, p) => {
  const cols = shuffle(r, p.acc), cx = 540, cy = 335, rot = r() * Math.PI;
  const red = '#e8382a';
  let s = '';
  // Banana leaves rising behind the diyas in both bottom corners.
  for (const side of [-1, 1]) {
    const bx = side < 0 ? 120 : 960;
    for (const [dx, len, ang] of [[-10, 300, -72], [40, 240, -48]] as const) {
      const x = bx + side * dx, a = side < 0 ? ang : -180 - ang;
      s += `<g transform="rotate(${n(a)} ${n(x)} 640)"><path d="M${n(x)} 640 q${n(len * 0.4)} ${n(-len * 0.34)} ${n(len)} -4 q${n(-len * 0.5)} ${n(len * 0.24)} ${n(-len)} 4 z" fill="${LEAF[dx < 0 ? 0 : 1]}" ${OUTLINE}/><path d="M${n(x)} 640 q${n(len * 0.5)} -20 ${n(len * 0.95)} -6" fill="none" stroke="#fff" stroke-width="4" opacity=".7"/></g>`;
    }
    s += diya(bx + side * 20, 640, 0.85);
  }
  // Outer scallops of petals.
  const scallops = 36;
  const edge = [MARIGOLD[0], cols[0]];
  for (let i = 0; i < scallops; i++) {
    const a = (2 * Math.PI * i) / scallops + rot;
    s += `<circle cx="${n(cx + Math.cos(a) * 276)}" cy="${n(cy + Math.sin(a) * 276)}" r="24" fill="${edge[i % 2]}" ${OUTLINE}/>`;
  }
  s += `<circle cx="${cx}" cy="${cy}" r="272" fill="${LEAF[0]}" ${OUTLINE}/>`;
  // A ring of coloured wedges.
  const K = pick(r, [8, 10, 12, 16]), ring = [MARIGOLD[1], red, cols[1], MARIGOLD[0]].slice(0, K % 3 === 0 ? 3 : 2 + whole(r, 0, 1));
  for (let i = 0; i < K; i++) s += wedge(cx, cy, 168, 248, rot + (2 * Math.PI * i) / K, rot + (2 * Math.PI * (i + 1)) / K, ring[i % ring.length]);
  // Small petals along the wedge ring's inner edge.
  s += `<circle cx="${cx}" cy="${cy}" r="168" fill="${CREAM}" ${OUTLINE}/>`;
  const petals = K >= 12 ? K : K * 2;
  s += flower(cx, cy, petals, 160, 50, [cols[2], cols[3]], MARIGOLD[1], rot + Math.PI / petals, 46);
  s += flower(cx, cy, 8, 80, 34, [red, MARIGOLD[0]], MARIGOLD[1], rot, 26);
  s += `<circle cx="${cx}" cy="${cy}" r="12" fill="${p.head[1]}"/>`;
  return s;
};

/** Onam B: a snake boat with oars and festive umbrellas on the backwaters, under a smiling sun. */
const snakeBoat: Design = (r, p) => {
  const cols = shuffle(r, p.acc);
  let s = sun(between(r, 150, 260), between(r, 120, 170), 62);
  s += cloud(between(r, 420, 520), between(r, 120, 160), 0.8) + cloud(between(r, 700, 820), between(r, 70, 110), 0.65);
  // Water.
  const waves = (y: number, fill: string, amp: number) => {
    let d = `M30 ${y}`;
    for (let x = 30; x < 1050; x += 85) d += ` q21 ${-amp} 42.5 0 t42.5 0`;
    return `<path d="${d} V650 H30 Z" fill="${fill}"/>`;
  };
  s += waves(540, '#8fd3f0', 12);
  // Oars, dipping into the water, behind the hull.
  const oars = whole(r, 11, 14), lean = between(r, 30, 50);
  let oarMarks = '';
  for (let i = 0; i < oars; i++) {
    const x = 230 + (600 / (oars - 1)) * i;
    oarMarks += `<line x1="${n(x)}" y1="500" x2="${n(x - lean)}" y2="592" stroke="#8d6e63" stroke-width="8" stroke-linecap="round"/>
<ellipse cx="${n(x - lean - 4)}" cy="598" rx="10" ry="20" fill="${cols[(i % 2) + 2]}" stroke="#fff" stroke-width="3" transform="rotate(${n((lean / 140) * 57)} ${n(x - lean - 4)} 598)"/>`;
  }
  // The hull: low at the bow, the stern sweeping up high like a snake's hood.
  s += `<path d="M110 492 L860 492 Q930 476 960 360 Q972 320 1010 290 Q1000 330 992 380 Q972 520 860 548 L210 548 Q140 540 110 492 Z" fill="#6d4c41" ${OUTLINE}/>
<path d="M150 512 L870 512 Q925 500 950 420" fill="none" stroke="#ffc93c" stroke-width="10" stroke-linecap="round"/>
<circle cx="1008" cy="292" r="14" fill="#ffc93c" ${OUTLINE}/>`;
  s += oarMarks;
  // Festive umbrellas on the boat.
  const brollies = whole(r, 2, 3);
  for (let i = 0; i < brollies; i++) {
    const x = brollies === 2 ? 340 + 300 * i : 280 + 230 * i, top = between(r, 330, 360), c = cols[i % 2];
    s += `<line x1="${n(x)}" y1="492" x2="${n(x)}" y2="${n(top)}" stroke="#8d6e63" stroke-width="8"/>
<path d="M${n(x - 70)} ${n(top + 14)} Q${n(x - 64)} ${n(top - 60)} ${n(x)} ${n(top - 64)} Q${n(x + 64)} ${n(top - 60)} ${n(x + 70)} ${n(top + 14)} Z" fill="#ffc93c" ${OUTLINE}/>
<path d="M${n(x - 50)} ${n(top - 12)} Q${n(x)} ${n(top - 40)} ${n(x + 50)} ${n(top - 12)}" fill="none" stroke="${c}" stroke-width="10" stroke-linecap="round"/>
<circle cx="${n(x)}" cy="${n(top - 72)}" r="10" fill="${c}" ${OUTLINE}/>`;
    for (let k = 0; k < 7; k++) s += `<circle cx="${n(x - 60 + 20 * k)}" cy="${n(top + 22)}" r="9" fill="${c}" stroke="#fff" stroke-width="3"/>`;
  }
  s += waves(608, '#5ec3ea', 12);
  for (let i = 0; i < 7; i++) s += sparkle(between(r, 80, 1000), between(r, 618, 642), between(r, 8, 13), '#fff');
  return s;
};

// ---------------------------------------------------------------- Ganesh Chaturthi

/** Ganesh Chaturthi A: a heaped plate of modaks under a toran, with diyas. */
const modakPlate: Design = (r, p) => {
  const cols = shuffle(r, p.acc), saffron = '#ffc58a', white = '#fff6e3';
  let s = toran(r, 40, 1040, 34);
  for (let i = 0; i < 6; i++) s += sparkle(i < 3 ? between(r, 90, 300) : between(r, 780, 990), between(r, 170, 420), between(r, 12, 20), pick(r, p.acc));
  // Diyas on little stands either side.
  for (const x of [between(r, 150, 200), between(r, 880, 930)])
    s += `<path d="M${n(x - 40)} 640 h80 l-14 -46 h-52 z" fill="${cols[0]}" ${OUTLINE}/>` + diya(x, 596, 0.8);
  // The plate on its stand.
  s += `<path d="M470 640 h140 l-30 -64 h-80 z" fill="${BRASS_DARK}" ${OUTLINE}/>
<ellipse cx="540" cy="570" rx="300" ry="66" fill="${BRASS}" ${OUTLINE}/>
<ellipse cx="540" cy="562" rx="256" ry="44" fill="${BRASS_LIGHT}"/>`;
  const rows = whole(r, 3, 4), size = rows === 4 ? 50 : 62, mix = r() < 0.5;
  for (let row = 0; row < rows; row++) {
    const count = rows - row, y = 575 - row * size * 1.15;
    for (let i = 0; i < count; i++) {
      const x = 540 + (i - (count - 1) / 2) * size * 2.05;
      s += modak(x, y, size, mix ? ((i + row) % 2 ? saffron : white) : white, p.ink);
    }
  }
  // Marigolds tucked round the plate's edge.
  for (const x of [272, 808]) s += marigold(x, 572, 22, MARIGOLD[x < 540 ? 0 : 1]);
  return s;
};

/** Ganesh Chaturthi B: a cheerful little mouse holding a modak, under marigold garlands, between lamps. */
const mouse: Design = (r, p) => {
  const cols = shuffle(r, p.acc), fur = pick(r, ['#b0aec4', '#b8a99a', '#a9b4c2']), belly = '#ecebf3', pink = '#ffb3c7';
  const x = between(r, 500, 580);
  let s = garland(40, 30, 540, 30, between(r, 30, 45)) + garland(540, 30, 1040, 30, between(r, 30, 45));
  s += marigold(540, 30, 24) + marigold(40, 30, 20, MARIGOLD[1]) + marigold(1040, 30, 20, MARIGOLD[1]);
  for (let i = 0; i < 5; i++) s += sparkle(i < 3 ? between(r, 90, 330) : between(r, 760, 990), between(r, 170, 400), between(r, 12, 20), pick(r, p.acc));
  // Lamps on both sides, with a modak or two beside them.
  for (const side of [-1, 1]) {
    const lx = x + side * between(r, 320, 380);
    s += `<path d="M${n(lx - 46)} 640 h92 l-16 -56 h-60 z" fill="${cols[side < 0 ? 0 : 1]}" ${OUTLINE}/>` + diya(lx, 586, 0.8);
    s += modak(lx + side * 110, 640, 28, '#fff6e3', p.ink);
  }
  // Tail.
  s += `<path d="M${n(x + 100)} 600 q120 20 110 -70 q-6 -50 40 -60" fill="none" stroke="#fff" stroke-width="22" stroke-linecap="round"/>
<path d="M${n(x + 100)} 600 q120 20 110 -70 q-6 -50 40 -60" fill="none" stroke="${pink}" stroke-width="12" stroke-linecap="round"/>`;
  // Body, feet and head.
  s += `<ellipse cx="${n(x)}" cy="500" rx="120" ry="128" fill="${fur}" ${OUTLINE}/>
<ellipse cx="${n(x)}" cy="525" rx="78" ry="90" fill="${belly}"/>
<ellipse cx="${n(x - 58)}" cy="630" rx="42" ry="18" fill="${pink}" ${OUTLINE}/>
<ellipse cx="${n(x + 58)}" cy="630" rx="42" ry="18" fill="${pink}" ${OUTLINE}/>`;
  for (const side of [-1, 1]) s += `<circle cx="${n(x + side * 92)}" cy="240" r="58" fill="${fur}" ${OUTLINE}/><circle cx="${n(x + side * 92)}" cy="240" r="36" fill="${pink}"/>`;
  s += `<circle cx="${n(x)}" cy="320" r="100" fill="${fur}" ${OUTLINE}/>
<circle cx="${n(x - 36)}" cy="308" r="12" fill="${p.ink}"/><circle cx="${n(x + 36)}" cy="308" r="12" fill="${p.ink}"/>
<circle cx="${n(x - 32)}" cy="303" r="4" fill="#fff"/><circle cx="${n(x + 40)}" cy="303" r="4" fill="#fff"/>
<circle cx="${n(x - 62)}" cy="345" r="15" fill="${pink}" opacity=".6"/><circle cx="${n(x + 62)}" cy="345" r="15" fill="${pink}" opacity=".6"/>
<circle cx="${n(x)}" cy="342" r="14" fill="${pink}" ${OUTLINE}/>
<path d="M${n(x - 18)} 362 q18 18 36 0" fill="none" stroke="${p.ink}" stroke-width="5" stroke-linecap="round"/>
<path d="M${n(x - 30)} 345 l-70 -12 M${n(x - 30)} 352 l-70 10 M${n(x + 30)} 345 l70 -12 M${n(x + 30)} 352 l70 10" stroke="${p.ink}" stroke-width="4" stroke-linecap="round" opacity=".35"/>`;
  // The modak, held in both paws.
  s += modak(x, 560, 50, pick(r, ['#fff6e3', '#ffc58a']), p.ink);
  s += `<ellipse cx="${n(x - 52)}" cy="520" rx="22" ry="18" fill="${fur}" ${OUTLINE}/><ellipse cx="${n(x + 52)}" cy="520" rx="22" ry="18" fill="${fur}" ${OUTLINE}/>`;
  return s;
};

// ---------------------------------------------------------------- Dussehra

/** Dussehra A: a festive arch with a toran, a crossed bow and arrows inside, and diyas at its feet. */
const arch: Design = (r, p) => {
  const cols = shuffle(r, p.acc), c = cols[0];
  let s = '';
  for (let i = 0; i < 6; i++) s += sparkle(i < 3 ? between(r, 70, 220) : between(r, 860, 1010), between(r, 60, 380), between(r, 12, 20), pick(r, p.acc));
  s += `<path d="M260 640 V300 A280 280 0 0 1 820 300 V640 H750 V300 A210 210 0 0 0 330 300 V640 Z" fill="${c}" ${OUTLINE}/>`;
  // Dots along the arch, in two colours.
  const dotsN = 15;
  for (let i = 0; i <= dotsN; i++) {
    const a = Math.PI + (Math.PI * i) / dotsN;
    s += `<circle cx="${n(540 + Math.cos(a) * 245)}" cy="${n(300 + Math.sin(a) * 245)}" r="10" fill="${i % 2 ? CREAM : cols[1]}"/>`;
  }
  for (let y = 340; y < 600; y += 52) s += `<circle cx="295" cy="${y}" r="10" fill="${CREAM}"/><circle cx="785" cy="${y}" r="10" fill="${CREAM}"/>`;
  s += `<rect x="236" y="604" width="118" height="40" rx="8" fill="${cols[1]}" ${OUTLINE}/><rect x="726" y="604" width="118" height="40" rx="8" fill="${cols[1]}" ${OUTLINE}/>`;
  // Marigold strings hanging down the inside of the arch.
  const swag = between(r, 12, 22);
  s += garland(330, 300, 750, 300, swag, 38, 16);
  for (let i = 0; i < 2; i++) {
    const x = i ? 750 : 330;
    for (let k = 1; k <= 3; k++) s += marigold(x + (i ? -1 : 1) * 4, 300 + k * 34, 15, MARIGOLD[k % 2]);
  }
  s += marigold(540, 22, 26) + marigold(330, 300, 20, MARIGOLD[1]) + marigold(750, 300, 20, MARIGOLD[1]);
  s += bowAndArrows(540, between(r, 484, 494), 0.8, p.ink, cols[2]);
  // Diyas and flowers outside the arch.
  for (const side of [-1, 1]) {
    const x = 540 + side * between(r, 360, 400);
    s += diya(x, 640, 0.9);
    s += flower(x + side * -10, 520, 8, 60, 30, [cols[3], cols[4]], '#ffc93c', r(), 14);
  }
  return s;
};

/** Dussehra B: a decorated elephant in a procession, with a golden howdah, under marigold garlands. */
const elephant: Design = (r, p) => {
  const cols = shuffle(r, p.acc), grey = '#9ea7b8', ear = '#8a93a6', gold = '#ffc93c';
  let s = garland(30, 30, 300, 30, 25, 40, 15) + garland(780, 30, 1050, 30, 25, 40, 15);
  for (let i = 0; i < 4; i++) s += sparkle(i < 2 ? between(r, 80, 220) : between(r, 880, 1010), between(r, 160, 360), between(r, 12, 20), pick(r, p.acc));
  let e = '';
  // Tail and the far legs.
  e += `<path d="M290 420 q-30 40 -20 120" fill="none" stroke="${grey}" stroke-width="10" stroke-linecap="round"/><circle cx="270" cy="545" r="10" fill="${p.ink}" opacity=".5"/>`;
  e += `<rect x="345" y="490" width="66" height="150" rx="22" fill="${ear}" ${OUTLINE}/><rect x="620" y="490" width="66" height="150" rx="22" fill="${ear}" ${OUTLINE}/>`;
  // Body and near legs.
  e += `<ellipse cx="500" cy="440" rx="220" ry="150" fill="${grey}" ${OUTLINE}/>
<rect x="400" y="500" width="70" height="140" rx="22" fill="${grey}" ${OUTLINE}/><rect x="560" y="500" width="70" height="140" rx="22" fill="${grey}" ${OUTLINE}/>`;
  for (const x of [400, 560]) e += `<rect x="${x}" y="606" width="70" height="16" fill="${gold}"/>`;
  // Cloth over the back, with a scalloped border.
  const cloth = cols[0], border = cols[1];
  e += `<path d="M360 330 Q500 270 640 330 L650 520 L350 520 Z" fill="${cloth}" ${OUTLINE}/>
<rect x="350" y="490" width="300" height="26" fill="${border}"/>`;
  for (let i = 0; i < 10; i++) e += `<circle cx="${365 + 30 * i}" cy="526" r="13" fill="${gold}" stroke="#fff" stroke-width="3"/>`;
  for (let i = 0; i < 4; i++) e += flower(410 + 60 * i, 420, 6, 34, 20, [CREAM], gold, 0, 8);
  // The golden howdah.
  e += `<rect x="415" y="240" width="170" height="70" rx="10" fill="${gold}" ${OUTLINE}/>
<path d="M430 240 V170 M570 240 V170" stroke="${BRASS_DARK}" stroke-width="10"/>
<path d="M410 180 Q500 70 590 180 Z" fill="${cols[2]}" ${OUTLINE}/>
<circle cx="500" cy="108" r="14" fill="${gold}" ${OUTLINE}/>`;
  for (let i = 0; i < 5; i++) e += `<circle cx="${440 + 30 * i}" cy="275" r="8" fill="${cols[(i % 2) + 3]}"/>`;
  // Head, trunk, ear and face.
  e += `<path d="M790 400 Q830 470 820 560 Q815 600 850 600" fill="none" stroke="#fff" stroke-width="58" stroke-linecap="round"/>
<path d="M790 400 Q830 470 820 560 Q815 600 850 600" fill="none" stroke="${grey}" stroke-width="46" stroke-linecap="round"/>
<circle cx="740" cy="350" r="105" fill="${grey}" ${OUTLINE}/>
<path d="M800 455 q30 10 40 -6" fill="none" stroke="#fffaf0" stroke-width="14" stroke-linecap="round"/>
<ellipse cx="680" cy="370" rx="62" ry="92" fill="${ear}" ${OUTLINE}/>
<path d="M740 250 Q800 250 820 300 Q800 360 790 400 Q770 340 740 250 Z" fill="${gold}" ${OUTLINE}/>
<circle cx="795" cy="310" r="9" fill="${cols[3]}"/><circle cx="795" cy="345" r="7" fill="${cols[4]}"/>
<circle cx="765" cy="335" r="10" fill="${p.ink}"/><path d="M756 360 q12 10 26 4" fill="none" stroke="${p.ink}" stroke-width="5" stroke-linecap="round"/>`;
  for (let i = 0; i < 4; i++) e += `<circle cx="${n(812 + i * 3)}" cy="${470 + 32 * i}" r="6" fill="${cols[(i % 3) + 1]}"/>`;
  const flip = r() < 0.5;
  s += flip ? `<g transform="translate(1080 0) scale(-1 1)">${e}</g>` : e;
  // Flowers and a diya on the ground, on the side the elephant is walking away from.
  const back = flip ? 920 : 160;
  s += diya(back, 640, 0.85);
  s += flower(back + (flip ? -1 : 1) * -40, 470, 8, 56, 30, [cols[3], cols[4]], gold, r(), 13);
  s += marigold(flip ? 80 : 1000, 610, 24) + marigold(flip ? 130 : 950, 625, 18, MARIGOLD[1]);
  return s;
};

// ---------------------------------------------------------------- Guru Nanak Jayanti

/** A soft round moon. */
const moon = (x: number, y: number, R: number) =>
  `<circle cx="${n(x)}" cy="${n(y)}" r="${n(R + 22)}" fill="#fff4c2" opacity=".5"/><circle cx="${n(x)}" cy="${n(y)}" r="${n(R)}" fill="#ffe9a8" ${OUTLINE}/>
<circle cx="${n(x - R * 0.3)}" cy="${n(y - R * 0.2)}" r="${n(R * 0.16)}" fill="#f5d98a"/><circle cx="${n(x + R * 0.25)}" cy="${n(y + R * 0.3)}" r="${n(R * 0.11)}" fill="#f5d98a"/>`;

/** Guru Nanak Jayanti A: rows of diyas and flowers under strings of lights and a calm moonlit sky. */
const lampRows: Design = (r, p) => {
  const cols = shuffle(r, p.acc), mx = r() < 0.5 ? between(r, 150, 230) : between(r, 850, 930);
  let s = moon(mx, between(r, 320, 350), 70);
  for (let i = 0; i < 6; i++) {
    const x = 130 + 165 * i + between(r, -30, 30);
    if (Math.abs(x - mx) > 130) s += star(x, between(r, 280, 420), between(r, 20, 28), i % 2 ? '#ffc93c' : cols[i % 5], between(r, -0.3, 0.3));
  }
  s += lights(30, 30, 1050, 30, between(r, 60, 80), 14, [cols[0], '#ffc93c', cols[1]], p.ink);
  s += lights(30, 140, 1050, 140, between(r, 40, 55), 11, ['#ffc93c', cols[2], cols[3]], p.ink);
  // Back row of small diyas, then marigolds, then the front row.
  const back = whole(r, 6, 7);
  for (let i = 0; i < back; i++) s += diya(160 + (760 / (back - 1)) * i, 540, 0.72);
  const front = 5;
  for (let i = 0; i < front - 1; i++) s += marigold(200 + 170 * i + 85, 616, 22, MARIGOLD[i % 2]);
  for (let i = 0; i < front; i++) s += diya(200 + 170 * i, 640, i === 2 ? 1.25 : 1);
  for (const x of [70, 1010]) s += flower(x, 590, 8, 64, 32, [cols[4], cols[0]], '#ffc93c', r(), 15);
  return s;
};

/** A steel plate with rotis and two little bowls, seen from the front; (x, y) is the middle of the plate. */
function plate(r: Rng, x: number, y: number, s: number, ink: string) {
  const dal = '#ffc94a', kheer = '#fff1d6';
  let m = `<ellipse cx="${n(x)}" cy="${n(y)}" rx="${n(140 * s)}" ry="${n(42 * s)}" fill="${STEEL}" ${soft(ink)}/>
<ellipse cx="${n(x)}" cy="${n(y - 4 * s)}" rx="${n(112 * s)}" ry="${n(28 * s)}" fill="${STEEL_LIGHT}"/>`;
  // A stack of rotis.
  for (let k = 0; k < 3; k++) {
    const ry = y - 6 * s - k * 9 * s, rx = x - 52 * s;
    m += `<ellipse cx="${n(rx)}" cy="${n(ry)}" rx="${n(56 * s)}" ry="${n(18 * s)}" fill="#e8c38a" stroke="#fff" stroke-width="3"/>`;
  }
  m += `<circle cx="${n(x - 70 * s)}" cy="${n(y - 26 * s)}" r="${n(4 * s)}" fill="#b07a3c"/><circle cx="${n(x - 40 * s)}" cy="${n(y - 22 * s)}" r="${n(3.5 * s)}" fill="#b07a3c"/>`;
  // Two bowls.
  const bowl = (bx: number, fill: string) =>
    `<path d="M${n(bx - 34 * s)} ${n(y - 34 * s)} Q${n(bx - 30 * s)} ${n(y + 4 * s)} ${n(bx)} ${n(y + 4 * s)} Q${n(bx + 30 * s)} ${n(y + 4 * s)} ${n(bx + 34 * s)} ${n(y - 34 * s)} Z" fill="${STEEL}" ${soft(ink, 4)}/>
<ellipse cx="${n(bx)}" cy="${n(y - 34 * s)}" rx="${n(34 * s)}" ry="${n(10 * s)}" fill="${fill}" ${soft(ink, 3)}/>`;
  const order = r() < 0.5 ? [dal, kheer] : [kheer, dal];
  m += bowl(x + 30 * s, order[0]) + bowl(x + 92 * s, order[1]);
  return m;
}

/** Guru Nanak Jayanti B: sharing a meal: plates of rotis and bowls on a long mat, a big pot, lights above. */
const langar: Design = (r, p) => {
  const cols = shuffle(r, p.acc);
  let s = lights(30, 30, 1050, 30, between(r, 55, 75), 13, [cols[0], '#ffc93c', cols[1]], p.ink);
  for (let i = 0; i < 6; i++) {
    const x = 120 + 168 * i + between(r, -25, 25);
    if (x < 370 || x > 710) s += star(x, between(r, 190, 330), between(r, 14, 22), i % 2 ? '#ffc93c' : cols[(i + 2) % 5], between(r, -0.3, 0.3));
  }
  // A big steel pot, steaming gently.
  const px = 540;
  for (const dx of [-40, 0, 40]) s += `<path d="M${px + dx} 300 q-18 -30 0 -60 q18 -30 0 -60" fill="none" stroke="${p.ink}" stroke-width="7" stroke-linecap="round" opacity=".2"/>`;
  s += `<path d="M${px - 140} 340 Q${px - 150} 520 ${px} 530 Q${px + 150} 520 ${px + 140} 340 Z" fill="${STEEL}" ${soft(p.ink)}/>
<ellipse cx="${px}" cy="340" rx="150" ry="34" fill="${STEEL_LIGHT}" ${soft(p.ink)}/>
<ellipse cx="${px}" cy="342" rx="122" ry="22" fill="#ffc94a"/>
<path d="M${px - 150} 370 h-26 M${px + 150} 370 h26" stroke="${STEEL}" stroke-width="16" stroke-linecap="round"/>
<path d="M${px + 40} 340 L${px + 120} 220" stroke="#8d6e63" stroke-width="12" stroke-linecap="round"/>`;
  // The long mat, with stripes.
  s += `<rect x="50" y="548" width="980" height="96" rx="20" fill="${cols[2]}" ${OUTLINE}/>`;
  for (const y of [566, 626]) s += `<line x1="70" y1="${y}" x2="1010" y2="${y}" stroke="${CREAM}" stroke-width="8" stroke-dasharray="26 18" stroke-linecap="round"/>`;
  const plates = whole(r, 2, 3);
  const xs = plates === 3 ? [215, 540, 865] : [270, 810];
  for (const x of xs) s += plate(r, x, 598, plates === 3 ? 0.9 : 1.05, p.ink);
  // Flowers either side of the pot.
  for (const side of [-1, 1]) s += marigold(px + side * between(r, 230, 330), 500, 22, MARIGOLD[side < 0 ? 0 : 1]);
  return s;
};

export const rakshaBandhan: Design[] = [bigRakhi, thali];
export const janmashtami: Design[] = [dahiHandi, flute];
export const onam: Design[] = [pookalam, snakeBoat];
export const ganeshChaturthi: Design[] = [modakPlate, mouse];
export const dussehra: Design[] = [arch, elephant];
export const guruNanakJayanti: Design[] = [lampRows, langar];
