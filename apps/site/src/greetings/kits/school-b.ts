// Symbols for the card maker (src/greetings/maker.ts) for International Yoga Day, Doctors' Day, National Sports
// Day, Teachers' Day and Children's Day. Every piece is drawn in a 200 × 200 box centred on (0, 0), inside −95…95.
import type { Kit, Piece } from '../maker';
import { flower, heart, leaf, n, OUTLINE, sparkle, star, sun } from '../motifs';
import { between, pick, whole } from '../palettes';
import type { Palette, Rng } from '../types';

const GREEN = '#5cbf6a';
const DARK_GREEN = '#3f9b52';
const WOOD = '#c98b5a';
const GOLD = '#ffc93c';
const GOLD_DEEP = '#f0a500';
const CREAM = '#fff4c2';
const RED = '#e8382a';

/** A soft ink outline for white objects, so they don't vanish on the pale card. */
const soft = (p: Palette, w = 5) => `stroke="${p.ink}" stroke-opacity=".18" stroke-width="${w}" stroke-linejoin="round"`;

/** A thick line with a white edge (arms, legs, tubes, ropes). */
const line = (d: string, colour: string, w: number, edge = 8) =>
  `<path d="${d}" fill="none" stroke="#fff" stroke-width="${w + edge}" stroke-linecap="round" stroke-linejoin="round"/><path d="${d}" fill="none" stroke="${colour}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;

/** A plus sign made of two rounded bars (first aid), centred on (x, y); `s` is half its width. */
const plus = (x: number, y: number, s: number, fill: string, outline = false) => {
  const t = s * 0.36;
  const bars = (e: string) => `<rect x="${n(x - s)}" y="${n(y - t)}" width="${n(2 * s)}" height="${n(2 * t)}" rx="${n(t * 0.45)}" fill="${fill}" ${e}/><rect x="${n(x - t)}" y="${n(y - s)}" width="${n(2 * t)}" height="${n(2 * s)}" rx="${n(t * 0.45)}" fill="${fill}" ${e}/>`;
  return outline ? bars(OUTLINE) + bars('') : bars('');
};

/** Plus-sign colours for first aid: green or red. */
const PLUS = ['#2fa84f', '#e8382a'];

/* ---------------------------------------------------------------- children (doodle figures for yoga) */

const SKIN = ['#f6cfa8', '#e7b07f', '#c98a5a', '#a86d45'];
const HAIR = ['#3b2a20', '#1f1a17', '#5a3a22'];

/** A child's head with calm closed eyes and a smile; (x, y) is its middle. */
function head(r: Rng, x: number, y: number, R: number, skin: string, hair: string) {
  const style = whole(r, 0, 2);
  let s = '';
  if (style === 1) s += `<circle cx="${n(x)}" cy="${n(y - R * 1.05)}" r="${n(R * 0.42)}" fill="${hair}" ${OUTLINE}/>`;
  if (style === 2) s += `<circle cx="${n(x - R * 0.98)}" cy="${n(y - R * 0.1)}" r="${n(R * 0.36)}" fill="${hair}" ${OUTLINE}/><circle cx="${n(x + R * 0.98)}" cy="${n(y - R * 0.1)}" r="${n(R * 0.36)}" fill="${hair}" ${OUTLINE}/>`;
  s += `<circle cx="${n(x)}" cy="${n(y)}" r="${n(R)}" fill="${skin}" ${OUTLINE}/>`;
  s += `<path d="M${n(x - R)} ${n(y - R * 0.05)} A${n(R)} ${n(R)} 0 0 1 ${n(x + R)} ${n(y - R * 0.05)} Q${n(x + R * 0.5)} ${n(y - R * 0.62)} ${n(x - R * 0.05)} ${n(y - R * 0.5)} Q${n(x - R * 0.55)} ${n(y - R * 0.4)} ${n(x - R)} ${n(y - R * 0.05)} Z" fill="${hair}"/>`;
  const ink = '#4a2e1c', w = n(Math.max(2.5, R * 0.1));
  s += `<path d="M${n(x - R * 0.52)} ${n(y + R * 0.08)} q${n(R * 0.17)} ${n(R * 0.16)} ${n(R * 0.34)} 0 M${n(x + R * 0.18)} ${n(y + R * 0.08)} q${n(R * 0.17)} ${n(R * 0.16)} ${n(R * 0.34)} 0" fill="none" stroke="${ink}" stroke-width="${w}" stroke-linecap="round"/>`;
  s += `<path d="M${n(x - R * 0.24)} ${n(y + R * 0.42)} q${n(R * 0.24)} ${n(R * 0.22)} ${n(R * 0.48)} 0" fill="none" stroke="${ink}" stroke-width="${w}" stroke-linecap="round"/>`;
  s += `<circle cx="${n(x - R * 0.62)}" cy="${n(y + R * 0.36)}" r="${n(R * 0.15)}" fill="#ff8fa3" opacity=".6"/><circle cx="${n(x + R * 0.62)}" cy="${n(y + R * 0.36)}" r="${n(R * 0.15)}" fill="#ff8fa3" opacity=".6"/>`;
  return s;
}

/** The colours of one child: skin, hair, top and trousers. */
function child(r: Rng, p: Palette) {
  const top = pick(r, p.acc);
  return { skin: pick(r, SKIN), hair: pick(r, HAIR), top, pants: pick(r, p.acc.filter((c) => c !== top)) };
}

const mat = (x0: number, x1: number, y: number, fill: string) => `<rect x="${n(x0)}" y="${n(y)}" width="${n(x1 - x0)}" height="13" rx="6.5" fill="${fill}" ${OUTLINE}/>`;

/* ---------------------------------------------------------------- Yoga Day */

/** A child in tree pose: on one leg, the other foot on the knee, hands joined above the head. */
const treePose: Piece = (r, p) => {
  const c = child(r, p), flip = r() < 0.5 ? -1 : 1;
  let s = mat(-78, 78, 82, pick(r, p.acc.filter((x) => x !== c.pants && x !== c.top)));
  let body = line('M-16 -22 Q-48 -56 -3 -84', c.skin, 11) + line('M16 -22 Q48 -56 3 -84', c.skin, 11);
  body += `<ellipse cx="0" cy="-85" rx="6" ry="9" fill="${c.skin}"/>`;
  body += line('M-5 26 L-5 80', c.pants, 16) + line('M-6 80 h12', c.skin, 8, 6);
  body += line('M7 26 L44 52 L3 58', c.pants, 16);
  body += `<path d="M-20 -26 q20 -8 40 0 l6 56 h-52 z" fill="${c.top}" ${OUTLINE}/>`;
  body += head(r, 0, -48, 19, c.skin, c.hair);
  return s + `<g transform="scale(${flip} 1)">${body}</g>`;
};

/** A child sitting cross-legged (easy lotus pose), hands resting on the knees. */
const lotusPose: Piece = (r, p) => {
  const c = child(r, p);
  let s = '';
  if (r() < 0.6) s += `<circle cx="0" cy="-34" r="${n(between(r, 62, 70))}" fill="#fff" opacity=".55"/>`;
  s += mat(-92, 92, 72, pick(r, p.acc.filter((x) => x !== c.pants && x !== c.top)));
  s += `<ellipse cx="0" cy="52" rx="80" ry="24" fill="${c.pants}" ${OUTLINE}/>`;
  s += `<path d="M-28 -26 q28 -10 56 0 l12 70 h-80 z" fill="${c.top}" ${OUTLINE}/>`;
  s += `<ellipse cx="-24" cy="50" rx="17" ry="9" transform="rotate(14 -24 50)" fill="${c.skin}" ${OUTLINE}/><ellipse cx="24" cy="50" rx="17" ry="9" transform="rotate(-14 24 50)" fill="${c.skin}" ${OUTLINE}/>`;
  s += line('M-24 -18 Q-52 12 -62 40', c.skin, 12) + line('M24 -18 Q52 12 62 40', c.skin, 12);
  for (const x of [-64, 64]) s += `<circle cx="${x}" cy="42" r="9" fill="${c.skin}" ${OUTLINE}/><circle cx="${x}" cy="42" r="3" fill="#fff" opacity=".8"/>`;
  s += head(r, 0, -52, 24, c.skin, c.hair);
  return s;
};

/** A child in butterfly pose: soles together, knees out like wings; a little butterfly flies by. */
const butterflyPose: Piece = (r, p) => {
  const c = child(r, p);
  let s = mat(-92, 92, 76, pick(r, p.acc.filter((x) => x !== c.pants && x !== c.top)));
  s += line('M-14 44 L-70 52 L-8 70', c.pants, 18) + line('M14 44 L70 52 L8 70', c.pants, 18);
  s += `<ellipse cx="-7" cy="70" rx="8" ry="11" fill="${c.skin}" ${OUTLINE}/><ellipse cx="7" cy="70" rx="8" ry="11" fill="${c.skin}" ${OUTLINE}/>`;
  s += `<path d="M-26 -22 q26 -10 52 0 l10 70 h-72 z" fill="${c.top}" ${OUTLINE}/>`;
  s += line('M-24 -16 Q-50 12 -62 42', c.skin, 11) + line('M24 -16 Q50 12 62 42', c.skin, 11);
  for (const x of [-63, 63]) s += `<circle cx="${x}" cy="45" r="9" fill="${c.skin}" ${OUTLINE}/>`;
  s += head(r, 0, -46, 23, c.skin, c.hair);
  const bx = pick(r, [-62, 62]), by = -62, w = pick(r, p.acc);
  s += `<g transform="rotate(${bx < 0 ? -15 : 15} ${bx} ${by})"><ellipse cx="${bx - 11}" cy="${by - 6}" rx="12" ry="15" fill="${w}" ${OUTLINE}/><ellipse cx="${bx + 11}" cy="${by - 6}" rx="12" ry="15" fill="${w}" ${OUTLINE}/><ellipse cx="${bx - 9}" cy="${by + 11}" rx="8" ry="9" fill="${w}" ${OUTLINE}/><ellipse cx="${bx + 9}" cy="${by + 11}" rx="8" ry="9" fill="${w}" ${OUTLINE}/><rect x="${bx - 3}" y="${by - 14}" width="6" height="32" rx="3" fill="${p.ink}"/></g>`;
  return s;
};

/** A child in cobra pose: lying on the tummy, chest lifted, looking up. */
const cobraPose: Piece = (r, p) => {
  const c = child(r, p), flip = r() < 0.5 ? -1 : 1;
  let s = mat(-95, 95, 66, pick(r, p.acc.filter((x) => x !== c.pants && x !== c.top)));
  let body = line('M-84 58 L-14 56', c.pants, 18) + line('M-90 54 v8', c.skin, 9, 6);
  body += line('M-20 54 Q24 54 34 14', c.top, 32);
  body += line('M40 18 L48 60', c.skin, 12) + line('M46 61 h12', c.skin, 9, 6);
  body += `<g transform="rotate(-14 44 -12)">${head(r, 44, -12, 22, c.skin, c.hair)}</g>`;
  return s + `<g transform="scale(${flip} 1)">${body}</g>`;
};

/** A lotus flower on its pad. */
const lotusFlower: Piece = (r, p) => {
  const petal = (len: number, w: number, a: number, c: string) =>
    `<path d="M0 46 Q${-w} ${n(46 - len * 0.55)} 0 ${n(46 - len)} Q${w} ${n(46 - len * 0.55)} 0 46 Z" transform="rotate(${a} 0 46)" fill="${c}" ${OUTLINE}/>`;
  const outer = pick(r, [p.acc[0], '#ff8fb8', '#f7a1c4', p.acc[1]]), inner = '#ffd6e5';
  let s = `<ellipse cx="0" cy="56" rx="90" ry="22" fill="${GREEN}" ${OUTLINE}/><path d="M-48 58 q48 14 96 0" stroke="#fff" stroke-width="4" fill="none" opacity=".6"/>`;
  for (const a of [-74, 74]) s += petal(78, 26, a, outer);
  for (const a of [-40, 40]) s += petal(104, 32, a, outer);
  s += petal(128, 38, 0, inner);
  s += `<path d="M0 30 v-50" stroke="#fff" stroke-width="4" opacity=".7" stroke-linecap="round"/>`;
  return s;
};

/** The morning sun, for the sun salutation. */
const morningSun: Piece = (r) => sun(0, 0, between(r, 50, 54), GOLD) + (r() < 0.5 ? sparkle(-72, -70, 12, '#fff') : '');

/** A sun rising over soft hills. */
const sunrise: Piece = (r, p) => {
  let s = sun(0, -2, 46, GOLD);
  s += `<path d="M-90 86 Q-88 52 -60 40 Q-30 30 0 54 Q46 14 80 50 Q94 66 90 86 Q88 92 80 92 H-82 Q-90 92 -90 86 Z" fill="${GREEN}" ${OUTLINE}/>`;
  s += `<path d="M-88 84 Q-30 58 30 80 Q60 68 88 78 Q88 90 80 90 H-80 Q-88 90 -88 84 Z" fill="${DARK_GREEN}"/>`;
  if (r() < 0.7) s += `<path d="M-60 -60 q8 -8 16 0 q8 -8 16 0 M40 -76 q7 -7 14 0 q7 -7 14 0" fill="none" stroke="${p.ink}" stroke-width="4" stroke-linecap="round" opacity=".45"/>`;
  return s;
};

/** A yoga mat rolled up, lying on the floor. */
const rolledMat: Piece = (r, p) => {
  const one = (x: number, y: number, len: number, R: number, fill: string) => `<rect x="${n(x)}" y="${n(y - 2 * R)}" width="${n(len)}" height="${n(2 * R)}" rx="${n(R)}" fill="${fill}" ${OUTLINE}/>
<rect x="${n(x + len * 0.3)}" y="${n(y - 2 * R)}" width="12" height="${n(2 * R)}" fill="#fff" opacity=".55"/>
<circle cx="${n(x + len - R)}" cy="${n(y - R)}" r="${n(R)}" fill="${fill}" ${OUTLINE}/>
<path d="M${n(x + len - R)} ${n(y - R)} m-${n(R * 0.2)} 0 a${n(R * 0.2)} ${n(R * 0.2)} 0 1 1 ${n(R * 0.4)} 0 a${n(R * 0.45)} ${n(R * 0.45)} 0 1 1 ${n(-R * 0.85)} 0 a${n(R * 0.68)} ${n(R * 0.68)} 0 1 1 ${n(R * 1.3)} 0" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" opacity=".85"/>`;
  const a = pick(r, p.acc);
  if (r() < 0.5) return one(-88, 44, 176, 40, a);
  const b = pick(r, p.acc.filter((c) => c !== a));
  return one(-92, 88, 170, 34, a) + one(-74, 20, 160, 34, b);
};

/** A big calm leaf with a dew drop. */
const calmLeaf: Piece = (r) => {
  const c = pick(r, [GREEN, '#7cc576', '#8fb07a']);
  return `<path d="M-70 72 Q-80 -30 -10 -70 Q50 -98 80 -82 Q92 -20 50 34 Q10 80 -70 72 Z" fill="${c}" ${OUTLINE}/>
<path d="M-70 72 Q0 0 66 -72 M-30 30 l-14 -40 M-4 2 l-8 -46 M22 -26 l-4 -36 M-30 30 l40 6 M-4 2 l44 2 M22 -26 l38 0" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" opacity=".75"/>
<path d="M-78 84 q4 -8 8 -12" stroke="${DARK_GREEN}" stroke-width="7" stroke-linecap="round"/>
<path d="M36 -8 q12 16 0 22 q-12 -6 0 -22 z" fill="#bfe6ff" stroke="#fff" stroke-width="3"/>`;
};

/** A water bottle. */
const waterBottle: Piece = (r, p) => {
  const c = pick(r, p.acc);
  return `<rect x="-14" y="-92" width="28" height="16" rx="6" fill="${p.ink}" ${OUTLINE}/>
<rect x="-26" y="-80" width="52" height="22" rx="8" fill="${c}" ${OUTLINE}/>
<path d="M-26 -58 h52 q16 0 16 18 v116 q0 16 -16 16 h-52 q-16 0 -16 -16 v-116 q0 -18 16 -18 z" fill="#d8f1ff" ${OUTLINE}/>
<path d="M-38 -14 h76 v90 q0 12 -12 12 h-52 q-12 0 -12 -12 z" fill="#8fd3f0"/>
<rect x="-42" y="8" width="84" height="34" fill="${c}" ${OUTLINE}/>
${heart(0, 26, 11, '#fff')}
<rect x="-30" y="-48" width="9" height="40" rx="4.5" fill="#fff" opacity=".7"/>`;
};

/** A string of leaves hanging down. */
const leafStrand: Piece = (r) => {
  let s = `<path d="M0 -95 V82" stroke="${DARK_GREEN}" stroke-width="4"/>`;
  for (let i = 0; i < 5; i++) {
    const y = -72 + i * 36, side = i % 2 ? 1 : -1;
    s += leaf(0, y, between(r, 54, 64), i % 2 ? GREEN : '#7cc576', side > 0 ? 25 : 155);
  }
  return s + `<circle cx="0" cy="86" r="8" fill="${GOLD}" ${OUTLINE}/>`;
};

/** A paper lotus hanging on a string. */
const hangingLotus: Piece = (r, p) => {
  const c = pick(r, [p.acc[0], '#ff8fb8', p.acc[1]]);
  let s = `<path d="M0 -95 V-20" stroke="${p.ink}" stroke-width="4" opacity=".45"/>`;
  const petal = (len: number, w: number, a: number, col: string) => `<path d="M0 50 Q${-w} ${n(50 - len * 0.55)} 0 ${n(50 - len)} Q${w} ${n(50 - len * 0.55)} 0 50 Z" transform="rotate(${a} 0 50)" fill="${col}" ${OUTLINE}/>`;
  for (const a of [-62, 62]) s += petal(66, 22, a, c);
  for (const a of [-32, 32]) s += petal(80, 26, a, c);
  s += petal(92, 30, 0, '#ffd6e5');
  s += `<path d="M-14 62 v24 M0 64 v28 M14 62 v24" stroke="${GOLD}" stroke-width="5" stroke-linecap="round"/><circle cx="0" cy="56" r="10" fill="${GOLD}" ${OUTLINE}/>`;
  return s;
};

const yogaKit: Kit = {
  hero: [treePose, lotusPose, butterflyPose, cobraPose, lotusFlower, sunrise],
  small: [lotusFlower, morningSun, rolledMat, calmLeaf, waterBottle, treePose, lotusPose],
  hang: [leafStrand, hangingLotus],
  colours: ['#8fd3c7', '#b9a7e6', '#ffd27a', '#9fd99a', '#f7b2c4', '#a9d6f5'],
};

/* ---------------------------------------------------------------- Doctors' Day */

/** A heart with a heartbeat line. */
const beatingHeart: Piece = (r) => heart(0, 6, 64, pick(r, ['#f45b69', '#ff6f91', '#ef476f'])) + `<path d="M-62 4 h26 l14 -30 l20 62 l18 -56 l12 24 h34" fill="none" stroke="#fff" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>`;

/** The stethoscope's ear tubes, the long tube and the chest piece. */
function stethoscope(_p: Palette, tube: string, tip: string, path: string, chest: [number, number], R = 22) {
  return line(path, tube, 11) + `<circle cx="-40" cy="-84" r="8" fill="${tip}" ${OUTLINE}/><circle cx="40" cy="-84" r="8" fill="${tip}" ${OUTLINE}/>
<circle cx="${chest[0]}" cy="${chest[1]}" r="${R}" fill="#b0bec5" ${OUTLINE}/><circle cx="${chest[0]}" cy="${chest[1]}" r="${n(R * 0.62)}" fill="${tip}"/><circle cx="${chest[0] - R * 0.25}" cy="${chest[1] - R * 0.25}" r="${n(R * 0.18)}" fill="#fff" opacity=".7"/>`;
}

/** A stethoscope round a big heart. */
const stethoHeart: Piece = (r, p) => {
  const flip = r() < 0.5 ? -1 : 1;
  let s = heart(0, 22, 56, pick(r, ['#f45b69', '#ff6f91', '#ef476f']));
  s += `<path d="M-46 22 h16 l12 -26 l18 54 l16 -48 l10 20 h22" fill="none" stroke="#fff" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>`;
  s += stethoscope(p, p.ink, pick(r, p.acc), 'M-40 -84 Q-46 -50 0 -46 Q46 -50 40 -84 M0 -46 C96 -44 104 92 20 86 C-24 84 -54 80 -62 60', [-64, 52]);
  return `<g transform="scale(${flip} 1)">${s}</g>`;
};

/** A stethoscope on its own, its tube in a loop. */
const stethoscopeAlone: Piece = (r, p) => {
  const tube = pick(r, [p.ink, p.acc[1], p.acc[2]]);
  return stethoscope(p, tube, pick(r, p.acc.filter((c) => c !== tube)), 'M-40 -84 Q-48 -40 0 -36 Q48 -40 40 -84 M0 -36 C0 20 -80 10 -70 60 C-60 96 40 92 54 50', [56, 40], 26);
};

/** A first-aid kit with a rounded plus. */
const firstAidKit: Piece = (r, p) => {
  const c = pick(r, [p.acc[0], p.acc[2], p.acc[4], RED]), pl = c === RED ? PLUS[0] : pick(r, PLUS);
  return `${line('M-36 -36 v-22 a16 16 0 0 1 16 -16 h40 a16 16 0 0 1 16 16 v22', p.ink, 14)}
<rect x="-90" y="-40" width="180" height="128" rx="22" fill="${c}" ${OUTLINE}/>
<rect x="-90" y="-8" width="180" height="10" fill="#fff" opacity=".35"/>
<circle cx="0" cy="34" r="42" fill="#fff"/>${plus(0, 34, 28, pl)}
<rect x="-78" y="-30" width="10" height="34" rx="5" fill="#fff" opacity=".5"/>`;
};

/** A thermometer. */
const thermometer: Piece = (_r, p) => `<g transform="rotate(28)">
<rect x="-20" y="-92" width="40" height="160" rx="20" fill="#fff" ${soft(p, 6)}/>
<rect x="-7" y="-60" width="14" height="120" rx="7" fill="${RED}"/>
<circle cx="0" cy="66" r="28" fill="${RED}" ${OUTLINE}/><circle cx="-9" cy="58" r="7" fill="#fff" opacity=".6"/>
<path d="M10 -70 h9 M10 -50 h9 M10 -30 h9 M10 -10 h9 M10 10 h9" stroke="${p.ink}" stroke-width="4" stroke-linecap="round" opacity=".4"/></g>`;

/** One or two plasters (bandages). */
const plaster: Piece = (r) => {
  const one = (a: number, len = 88) => `<g transform="rotate(${a})"><rect x="${-len}" y="-26" width="${2 * len}" height="52" rx="24" fill="#f5d0a9" ${OUTLINE}/>
<rect x="-28" y="-26" width="56" height="52" rx="6" fill="#e9b98a"/>
<circle cx="${n(-len * 0.62)}" cy="-8" r="3.5" fill="#e9b98a"/><circle cx="${n(-len * 0.72)}" cy="8" r="3.5" fill="#e9b98a"/><circle cx="${n(len * 0.62)}" cy="-8" r="3.5" fill="#e9b98a"/><circle cx="${n(len * 0.72)}" cy="8" r="3.5" fill="#e9b98a"/></g>`;
  return r() < 0.5 ? one(-34, 90) : one(-38, 84) + one(38, 84);
};

/** A medicine bottle and a capsule. */
const medicine: Piece = (r, p) => {
  const c = pick(r, ['#f0a04b', p.acc[2], p.acc[1]]), cap = pick(r, p.acc.filter((x) => x !== c));
  const pill = pick(r, p.acc.filter((x) => x !== c && x !== cap));
  return `<rect x="-60" y="-90" width="68" height="30" rx="10" fill="${cap}" ${OUTLINE}/>
<rect x="-50" y="-62" width="48" height="16" fill="${c}"/>
<path d="M-62 -48 h76 q16 0 16 16 v104 q0 16 -16 16 h-76 q-16 0 -16 -16 v-104 q0 -16 16 -16 z" fill="${c}" ${OUTLINE}/>
<rect x="-78" y="-8" width="108" height="52" fill="#fff" ${soft(p, 3)}/>${plus(-24, 18, 17, pick(r, PLUS))}
<rect x="-68" y="-38" width="9" height="26" rx="4.5" fill="#fff" opacity=".55"/>
<g transform="rotate(-30 66 66)"><rect x="40" y="52" width="52" height="28" rx="14" fill="#fff" ${OUTLINE}/><path d="M66 52 h12 a14 14 0 0 1 0 28 h-12 z" fill="${pill}"/></g>`;
};

/** A teddy bear sitting down, optionally with a plaster on its head and a bandaged arm. */
function teddy(r: Rng, p: Palette, hurt: boolean) {
  const fur = pick(r, ['#c98b5a', '#d9a066', '#b5835a']), light = '#f1d3b3', ink = '#5a3a22';
  let s = `<circle cx="-46" cy="66" r="24" fill="${fur}" ${OUTLINE}/><circle cx="46" cy="66" r="24" fill="${fur}" ${OUTLINE}/>
<circle cx="-46" cy="66" r="12" fill="${light}"/><circle cx="46" cy="66" r="12" fill="${light}"/>
<ellipse cx="0" cy="36" rx="56" ry="60" fill="${fur}" ${OUTLINE}/><ellipse cx="0" cy="42" rx="33" ry="36" fill="${light}"/>
<rect x="-80" y="-6" width="28" height="64" rx="14" transform="rotate(25 -66 -6)" fill="${fur}" ${OUTLINE}/>
<rect x="52" y="-6" width="28" height="64" rx="14" transform="rotate(-25 66 -6)" fill="${fur}" ${OUTLINE}/>`;
  if (hurt) s += `<g transform="rotate(-25 66 -6)"><rect x="50" y="18" width="32" height="20" rx="4" fill="#fff" ${soft(p, 3)}/></g>`;
  else s += `<path d="M-26 -12 l26 12 l26 -12 v24 l-26 -12 l-26 12 z" fill="${pick(r, p.acc)}" ${OUTLINE}/>`;
  s += `<circle cx="-40" cy="-76" r="19" fill="${fur}" ${OUTLINE}/><circle cx="40" cy="-76" r="19" fill="${fur}" ${OUTLINE}/>
<circle cx="-40" cy="-76" r="9" fill="${light}"/><circle cx="40" cy="-76" r="9" fill="${light}"/>
<circle cx="0" cy="-36" r="52" fill="${fur}" ${OUTLINE}/><ellipse cx="0" cy="-20" rx="24" ry="19" fill="${light}"/>
<ellipse cx="0" cy="-27" rx="8" ry="6" fill="${ink}"/><path d="M-9 -14 q9 8 18 0" fill="none" stroke="${ink}" stroke-width="3.5" stroke-linecap="round"/>
<circle cx="-20" cy="-47" r="5.5" fill="${ink}"/><circle cx="20" cy="-47" r="5.5" fill="${ink}"/>
<circle cx="-34" cy="-28" r="7" fill="#ff8fa3" opacity=".5"/><circle cx="34" cy="-28" r="7" fill="#ff8fa3" opacity=".5"/>`;
  if (hurt) s += `<g transform="rotate(-28 24 -72)"><rect x="0" y="-81" width="48" height="18" rx="8" fill="#f5d0a9" ${OUTLINE}/><rect x="16" y="-81" width="16" height="18" fill="#e9b98a"/></g>`;
  return s;
}

const hurtTeddy: Piece = (r, p) => `<g transform="scale(.94)">${teddy(r, p, true)}</g>`;

/** A doctor's white coat (with a pocket pen and a stethoscope). */
function coat(r: Rng, p: Palette) {
  const shirt = pick(r, p.acc);
  return `<path d="M-56 -50 L-22 -62 L0 -30 L22 -62 L56 -50 L72 46 L50 50 L44 -2 L46 88 H-46 L-44 -2 L-50 50 L-72 46 Z" fill="#fff" ${soft(p, 5)}/>
<path d="M-22 -62 L0 -30 L22 -62 Z" fill="${shirt}"/>
<path d="M-22 -62 L-8 -6 L0 -30 M22 -62 L8 -6 L0 -30 M0 -30 V88 M-44 -2 l-2 -40 M44 -2 l2 -40" fill="none" stroke="${p.ink}" stroke-opacity=".2" stroke-width="4" stroke-linejoin="round"/>
<circle cx="0" cy="14" r="4" fill="${p.ink}" opacity=".35"/><circle cx="0" cy="40" r="4" fill="${p.ink}" opacity=".35"/><circle cx="0" cy="66" r="4" fill="${p.ink}" opacity=".35"/>
<rect x="18" y="-20" width="22" height="6" rx="3" fill="${p.ink}" opacity=".2"/><rect x="28" y="-34" width="6" height="18" rx="3" fill="${pick(r, p.acc)}"/>
${line('M-16 -56 Q-30 0 -20 30', p.ink, 6, 5)}<circle cx="-20" cy="34" r="9" fill="#b0bec5" ${OUTLINE}/>
<rect x="-38" y="38" width="22" height="22" rx="4" fill="none" stroke="${p.ink}" stroke-opacity=".2" stroke-width="4"/>`;
}

const doctorCoat: Piece = (r, p) => `<g transform="translate(0 4)">${coat(r, p)}</g>`;

/** A doctor's coat on a hanger. */
const coatOnHanger: Piece = (r, p) => `<path d="M0 -94 q12 0 12 9 q0 9 -12 11 v8" fill="none" stroke="${p.ink}" stroke-width="5" stroke-linecap="round" opacity=".6"/>
<path d="M-62 -48 L0 -68 L62 -48" fill="none" stroke="${WOOD}" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>
<g transform="translate(0 6) scale(.94)">${coat(r, p)}</g>`;

/** A friendly hospital with a plus sign on its roof. */
const hospital: Piece = (r, p) => {
  const roof = pick(r, p.acc), pl = pick(r, PLUS);
  let s = `<rect x="-88" y="-22" width="176" height="110" rx="10" fill="#fff" ${soft(p, 5)}/>
<rect x="-36" y="-60" width="72" height="148" rx="10" fill="#fff" ${soft(p, 5)}/>
<rect x="-94" y="-30" width="64" height="14" rx="6" fill="${roof}" ${OUTLINE}/><rect x="30" y="-30" width="64" height="14" rx="6" fill="${roof}" ${OUTLINE}/>
<rect x="-42" y="-66" width="84" height="14" rx="6" fill="${roof}" ${OUTLINE}/>
<circle cx="0" cy="-80" r="16" fill="#fff" ${soft(p, 4)}/>${plus(0, -80, 11, pl)}`;
  for (const x of [-76, -54, 34, 56]) for (const y of [-2, 32]) s += `<rect x="${x}" y="${y}" width="18" height="20" rx="4" fill="#bfe6ff"/>`;
  s += `<rect x="-22" y="-40" width="44" height="34" rx="6" fill="#bfe6ff"/>${plus(0, -23, 11, pl)}`;
  s += `<path d="M-30 50 h60 l-6 -10 h-48 z" fill="${roof}" ${OUTLINE}/><rect x="-18" y="52" width="36" height="36" rx="6" fill="${roof}"/><path d="M0 52 v36" stroke="#fff" stroke-width="3"/>`;
  s += `<path d="M-95 90 H95" stroke="${GREEN}" stroke-width="8" stroke-linecap="round"/>`;
  for (const x of [-72, 72]) s += `<circle cx="${x}" cy="74" r="13" fill="${GREEN}" ${OUTLINE}/>`;
  return s;
};

/** A plus sign badge on a string. */
const hangingPlus: Piece = (r, p) => `<path d="M0 -95 V-30" stroke="${p.ink}" stroke-width="4" opacity=".45"/><circle cx="0" cy="18" r="50" fill="#fff" ${soft(p, 5)}/>${plus(0, 18, 34, pick(r, PLUS))}`;

/** A heart on a string. */
const hangingHeart: Piece = (r, p) => `<path d="M0 -95 V-30" stroke="${p.ink}" stroke-width="4" opacity=".45"/>${heart(0, 22, 50, pick(r, ['#f45b69', '#ff6f91', p.acc[0]]))}<path d="M-40 20 h16 l9 -18 l14 40 l12 -36 l8 14 h22" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>`;

const doctorsKit: Kit = {
  hero: [stethoHeart, firstAidKit, hurtTeddy, hospital, doctorCoat],
  small: [beatingHeart, stethoscopeAlone, firstAidKit, thermometer, plaster, medicine, hurtTeddy],
  hang: [coatOnHanger, hangingPlus, hangingHeart],
};

/* ---------------------------------------------------------------- Sports Day */

/** A trophy cup with a star. */
const trophyCup: Piece = (r, p) => `${line('M-56 -66 c-32 0 -32 52 6 60 M56 -66 c32 0 32 52 -6 60', GOLD_DEEP, 12, 10)}
<path d="M-64 -84 h128 q0 96 -64 100 q-64 -4 -64 -100 z" fill="${GOLD}" ${OUTLINE}/>
<path d="M-42 -70 q0 54 22 74" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round" opacity=".55"/>
<rect x="-11" y="14" width="22" height="34" fill="${GOLD_DEEP}" ${OUTLINE}/>
<path d="M-32 56 q32 -16 64 0 v4 h-64 z" fill="${GOLD}" ${OUTLINE}/>
<rect x="-50" y="58" width="100" height="34" rx="8" fill="${pick(r, [p.ink, WOOD])}" ${OUTLINE}/>
<rect x="-30" y="68" width="60" height="14" rx="5" fill="${GOLD}"/>${star(0, -38, 26, CREAM, between(r, -0.2, 0.2))}`;

/** A medal on its ribbon, hanging from the top of the box. */
const medal: Piece = (r, p) => {
  const metal = pick(r, [GOLD, GOLD, '#c0c8d0', '#e0915a']), a = pick(r, p.acc), b = pick(r, p.acc.filter((c) => c !== a));
  return `<path d="M-56 -94 h32 l44 92 h-30 z" fill="${a}" ${OUTLINE}/><path d="M56 -94 h-32 l-44 92 h30 z" fill="${b}" ${OUTLINE}/>
<circle cx="0" cy="38" r="50" fill="${metal}" ${OUTLINE}/><circle cx="0" cy="38" r="36" fill="none" stroke="#fff" stroke-width="5" opacity=".6"/>
${star(0, 38, 24, CREAM, between(r, -0.2, 0.2))}<path d="M-30 14 a36 36 0 0 1 16 -12" stroke="#fff" stroke-width="5" fill="none" stroke-linecap="round" opacity=".7"/>`;
};

/** A football: a dark pentagon in the middle, five more at the rim and thin seams between. */
const football: Piece = (r, p) => {
  const R = 86, spin = between(r, 0, 1.2), dark = '#2d3142';
  const corner = (cx: number, cy: number, rr: number, rot: number, i: number) => {
    const a = rot + (2 * Math.PI * i) / 5 - Math.PI / 2;
    let x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
    const d = Math.hypot(x, y);
    if (d > R - 2) (x *= (R - 2) / d), (y *= (R - 2) / d);
    return [x, y];
  };
  const pent = (cx: number, cy: number, rr: number, rot: number) => {
    let pts = '';
    for (let i = 0; i < 5; i++) pts += corner(cx, cy, rr, rot, i).map(n).join(',') + ' ';
    return `<polygon points="${pts.trim()}" fill="${dark}" stroke="${dark}" stroke-width="3" stroke-linejoin="round"/>`;
  };
  let s = `<circle cx="0" cy="0" r="${R}" fill="#fff" ${soft(p, 6)}/>`, seams = '';
  s += pent(0, 0, R * 0.3, spin);
  for (let i = 0; i < 5; i++) {
    const a = spin + (2 * Math.PI * i) / 5 - Math.PI / 2;
    const [x1, y1] = corner(0, 0, R * 0.3, spin, i);
    const ox = Math.cos(a) * R * 0.84, oy = Math.sin(a) * R * 0.84;
    s += pent(ox, oy, R * 0.27, a + Math.PI);
    const [x2, y2] = corner(ox, oy, R * 0.27, a + Math.PI, 0);
    seams += `M${n(x1)} ${n(y1)} L${n(x2)} ${n(y2)} `;
  }
  s += `<path d="${seams.trim()}" stroke="${dark}" stroke-width="3" opacity=".55" stroke-linecap="round"/>`;
  return s + `<path d="M-54 -50 a74 74 0 0 1 22 -20" stroke="#fff" stroke-width="8" fill="none" stroke-linecap="round" opacity=".9"/>`;
};

/** A red cricket ball with its seam. */
const cricketBall = (x: number, y: number, R: number) =>
  `<circle cx="${n(x)}" cy="${n(y)}" r="${n(R)}" fill="#d63031" ${OUTLINE}/><path d="M${n(x - R * 0.5)} ${n(y - R * 0.82)} q${n(-R * 0.35)} ${n(R * 0.82)} 0 ${n(R * 1.64)} M${n(x - R * 0.18)} ${n(y - R * 0.98)} q${n(-R * 0.35)} ${n(R * 0.98)} 0 ${n(R * 1.96)}" fill="none" stroke="#fff" stroke-width="3" stroke-dasharray="5 5"/><circle cx="${n(x + R * 0.35)}" cy="${n(y - R * 0.35)}" r="${n(R * 0.18)}" fill="#fff" opacity=".5"/>`;

/** Cricket stumps with a bat leaning on them and a ball. */
const cricket: Piece = (r, p) => {
  let s = '';
  for (const x of [-72, -50, -28]) s += `<rect x="${x - 7}" y="-56" width="14" height="144" rx="6" fill="#e8c07a" ${OUTLINE}/>`;
  s += `<rect x="-84" y="-66" width="28" height="9" rx="4.5" fill="#e8c07a" ${OUTLINE}/><rect x="-44" y="-66" width="28" height="9" rx="4.5" fill="#e8c07a" ${OUTLINE}/>`;
  s += `<g transform="rotate(16 30 88)"><rect x="6" y="-24" width="48" height="112" rx="16" fill="#f2d39b" ${OUTLINE}/><path d="M30 -10 v86" stroke="#e0b878" stroke-width="5" stroke-linecap="round"/>
<rect x="20" y="-92" width="20" height="74" rx="9" fill="${pick(r, p.acc)}" ${OUTLINE}/><path d="M20 -76 h20 M20 -60 h20 M20 -44 h20" stroke="#fff" stroke-width="3" opacity=".7"/></g>`;
  s += cricketBall(70, 70, 19);
  return s;
};

/** A cricket bat and ball on their own. */
const batAndBall: Piece = (r, p) => `<g transform="rotate(35)"><rect x="-24" y="-30" width="48" height="122" rx="16" fill="#f2d39b" ${OUTLINE}/><path d="M0 -16 v94" stroke="#e0b878" stroke-width="5" stroke-linecap="round"/>
<rect x="-10" y="-94" width="20" height="70" rx="9" fill="${pick(r, p.acc)}" ${OUTLINE}/><path d="M-10 -78 h20 M-10 -62 h20 M-10 -46 h20" stroke="#fff" stroke-width="3" opacity=".7"/></g>${cricketBall(56, -50, 22)}`;

/** Two crossed hockey sticks and a ball (for Major Dhyan Chand's birthday). */
const hockey: Piece = (r, p) => {
  const stick = (c: string) => line('M-60 -86 L30 50 Q42 74 72 62', c, 14, 9) + `<path d="M-60 -86 L-42 -59" stroke="${p.ink}" stroke-width="14" stroke-linecap="round"/>`;
  const a = pick(r, [WOOD, p.acc[2], p.acc[0]]), b = pick(r, [WOOD, p.acc[1], p.acc[4]]);
  return stick(a) + `<g transform="scale(-1 1)">${stick(b)}</g>` + `<circle cx="0" cy="74" r="15" fill="#fff" ${soft(p, 4)}/><circle cx="-4" cy="70" r="2.5" fill="${p.ink}" opacity=".25"/><circle cx="5" cy="76" r="2.5" fill="${p.ink}" opacity=".25"/><circle cx="-3" cy="80" r="2.5" fill="${p.ink}" opacity=".25"/>`;
};

/** A running shoe. */
const shoe: Piece = (r, p) => {
  const c = pick(r, p.acc), lace = '#fff';
  return `<path d="M-84 46 V-14 q0 -14 14 -14 h28 q12 0 16 12 l10 20 q10 14 30 16 l36 6 q26 4 34 30 z" fill="${c}" ${OUTLINE}/>
<path d="M-90 46 h176 q8 0 8 10 v6 q0 12 -14 12 h-162 q-12 0 -12 -12 v-6 q0 -10 4 -10 z" fill="#fff" ${soft(p, 4)}/>
<path d="M-86 62 h172" stroke="${p.ink}" stroke-opacity=".15" stroke-width="4"/>
<path d="M-28 -4 l14 -8 M-18 10 l14 -8 M-6 22 l14 -8" stroke="${lace}" stroke-width="6" stroke-linecap="round"/>
<path d="M-70 30 q40 -2 70 -26" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round" opacity=".7"/>
<rect x="-90" y="-26" width="12" height="30" rx="6" fill="${pick(r, p.acc.filter((x) => x !== c))}" ${OUTLINE}/>
<path d="M-48 -50 h-36 M-42 -40 h-22" stroke="${p.ink}" stroke-width="5" stroke-linecap="round" opacity=".25"/>`;
};

/** A whistle on its cord (the cord's top at the top of the box). */
const whistle: Piece = (r, p) => {
  const c = pick(r, ['#c0c8d0', p.acc[0], p.acc[2], GOLD]);
  return `<path d="M0 -94 L-48 -22 M0 -94 L-34 -18" fill="none" stroke="${pick(r, p.acc)}" stroke-width="5" stroke-linecap="round"/>
<circle cx="-46" cy="-14" r="10" fill="none" stroke="#c0c8d0" stroke-width="5"/>
<rect x="-56" y="-12" width="100" height="36" rx="10" fill="${c}" ${OUTLINE}/>
<circle cx="30" cy="36" r="50" fill="${c}" ${OUTLINE}/>
<rect x="-8" y="-20" width="28" height="12" rx="4" fill="${p.ink}" opacity=".7"/>
<circle cx="30" cy="36" r="18" fill="#fff" opacity=".45"/><path d="M8 18 a30 30 0 0 1 18 -12" stroke="#fff" stroke-width="5" fill="none" stroke-linecap="round" opacity=".7"/>`;
};

/** A skipping rope. */
const skippingRope: Piece = (r, p) => {
  const rope = pick(r, p.acc), h = pick(r, p.acc.filter((c) => c !== rope));
  return line('M-62 -30 C-90 140 90 140 62 -30', rope, 7, 7) + `<g transform="rotate(-12 -62 -58)"><rect x="-74" y="-92" width="24" height="64" rx="12" fill="${h}" ${OUTLINE}/><rect x="-70" y="-84" width="6" height="40" rx="3" fill="#fff" opacity=".55"/></g><g transform="rotate(12 62 -58)"><rect x="50" y="-92" width="24" height="64" rx="12" fill="${h}" ${OUTLINE}/><rect x="54" y="-84" width="6" height="40" rx="3" fill="#fff" opacity=".55"/></g>`;
};

/** A shuttlecock; (x, y) is the middle of its cork, the feathers point along `rot` degrees (0 = up). */
const shuttle = (p: Palette, x: number, y: number, s: number, rot: number, band: string) => `<g transform="translate(${n(x)} ${n(y)}) rotate(${n(rot)}) scale(${s})">
<path d="M-18 0 l-14 -64 h64 l-14 64 z" fill="#fff" ${soft(p, 4)}/>
<path d="M-6 0 l-5 -62 M6 0 l5 -62" stroke="${p.ink}" stroke-width="3" opacity=".22"/>
<rect x="-24" y="-30" width="48" height="8" rx="3" fill="${band}" opacity=".85"/>
<path d="M-19 2 h38 a19 19 0 0 1 -38 0 z" fill="${CREAM}" ${OUTLINE}/></g>`;

/** A badminton racket and a shuttlecock. */
const badminton: Piece = (r, p) => {
  const c = pick(r, p.acc), rx = 40, ry = 50, cy = -36;
  let strings = '';
  for (let x = -30; x <= 30; x += 10) {
    const h = ry * Math.sqrt(1 - (x / rx) ** 2);
    strings += `M${x} ${n(cy - h)} V${n(cy + h)} `;
  }
  for (let y = -40; y <= 40; y += 10) {
    const w = rx * Math.sqrt(1 - (y / ry) ** 2);
    strings += `M${n(-w)} ${n(cy + y)} H${n(w)} `;
  }
  const racket = `<g transform="translate(-22 4) rotate(-32)">
${line('M0 14 V44', '#c0c8d0', 7, 7)}<rect x="-8" y="40" width="16" height="50" rx="7" fill="${p.ink}" ${OUTLINE}/>
<ellipse cx="0" cy="${cy}" rx="${rx}" ry="${ry}" fill="#fff" fill-opacity=".5" stroke="#fff" stroke-width="16"/>
<path d="${strings.trim()}" stroke="${p.ink}" stroke-opacity=".3" stroke-width="2"/>
<ellipse cx="0" cy="${cy}" rx="${rx}" ry="${ry}" fill="none" stroke="${c}" stroke-width="9"/></g>`;
  return racket + shuttle(p, 46, 44, 0.85, between(r, 25, 40), pick(r, p.acc.filter((x) => x !== c)));
};

/** A shuttlecock on its own. */
const shuttleAlone: Piece = (r, p) => shuttle(p, 0, 36, 1.7, between(r, -12, 12), pick(r, p.acc));

/** A winners' podium with a small trophy on top. */
const podium: Piece = (r, p) => {
  const cols = [...p.acc].sort(() => r() - 0.5);
  return `<rect x="-92" y="22" width="62" height="70" rx="6" fill="${cols[0]}" ${OUTLINE}/>
<rect x="-31" y="-12" width="62" height="104" rx="6" fill="${cols[1]}" ${OUTLINE}/>
<rect x="30" y="42" width="62" height="50" rx="6" fill="${cols[2]}" ${OUTLINE}/>
<circle cx="-61" cy="50" r="13" fill="#c0c8d0" ${OUTLINE}/><circle cx="0" cy="20" r="15" fill="${GOLD}" ${OUTLINE}/><circle cx="61" cy="64" r="12" fill="#e0915a" ${OUTLINE}/>
${star(0, 20, 8, CREAM)}<g transform="translate(0 -52) scale(.44)">${trophyCup(r, p)}</g>`;
};

/** A triangular pennant flag on a string. */
const pennant: Piece = (r, p) => {
  const c = pick(r, p.acc);
  return `<path d="M0 -95 V-58" stroke="${p.ink}" stroke-width="4" opacity=".45"/><path d="M-56 -62 H56 L0 88 Z" fill="${c}" ${OUTLINE}/>${star(0, -18, 24, '#fff', 0)}<path d="M-40 -46 h80" stroke="#fff" stroke-width="5" opacity=".5"/>`;
};

const sportsKit: Kit = {
  hero: [trophyCup, medal, football, cricket, hockey, podium, badminton],
  small: [football, batAndBall, hockey, shoe, whistle, skippingRope, shuttleAlone, medal, trophyCup],
  hang: [medal, whistle, pennant],
};

/* ---------------------------------------------------------------- Teachers' Day */

/** An apple; (x, y) is the middle of its bottom. */
const apple = (x: number, y: number, s: number) =>
  `<path d="M${n(x)} ${n(y - 108 * s)} q${n(-4 * s)} ${n(-30 * s)} ${n(10 * s)} ${n(-46 * s)}" fill="none" stroke="#7a4a12" stroke-width="${n(9 * s)}" stroke-linecap="round"/>
${leaf(x + 6 * s, y - 128 * s, 56 * s, GREEN, -30)}
<path d="M${n(x)} ${n(y - 100 * s)} C${n(x - 40 * s)} ${n(y - 125 * s)} ${n(x - 100 * s)} ${n(y - 95 * s)} ${n(x - 92 * s)} ${n(y - 45 * s)} C${n(x - 85 * s)} ${n(y)} ${n(x - 40 * s)} ${n(y + 4 * s)} ${n(x)} ${n(y - 10 * s)} C${n(x + 40 * s)} ${n(y + 4 * s)} ${n(x + 85 * s)} ${n(y)} ${n(x + 92 * s)} ${n(y - 45 * s)} C${n(x + 100 * s)} ${n(y - 95 * s)} ${n(x + 40 * s)} ${n(y - 125 * s)} ${n(x)} ${n(y - 100 * s)} Z" fill="${RED}" ${OUTLINE}/>
<ellipse cx="${n(x - 45 * s)}" cy="${n(y - 70 * s)}" rx="${n(14 * s)}" ry="${n(22 * s)}" fill="#fff" opacity=".5"/>`;

const appleAlone: Piece = () => apple(0, 76, 0.94);

/** An apple on a stack of books. */
const booksApple: Piece = (r, p) => {
  const cols = [...p.acc].sort(() => r() - 0.5);
  let s = '', y = 90;
  for (let i = 0; i < 3; i++) {
    const w = 172 - i * 16, h = 32, x = -w / 2 + between(r, -8, 8);
    y -= h;
    s += `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${h}" rx="7" fill="${cols[i]}" ${OUTLINE}/>
<rect x="${n(x + w - 16)}" y="${n(y + 6)}" width="10" height="${h - 12}" rx="3" fill="#fff" opacity=".85"/>
<rect x="${n(x + 14)}" y="${n(y + h / 2 - 4)}" width="${n(w * 0.38)}" height="8" rx="4" fill="#fff" opacity=".45"/>`;
  }
  return s + apple(between(r, -14, 14), y + 3, 0.52);
};

/** A pencil. */
function pencilAt(x: number, y: number, len: number, w: number, tip: string, angle: number) {
  return `<g transform="rotate(${n(angle)} ${n(x)} ${n(y)})">
<path d="M${n(x)} ${n(y - w / 2)} h${n(len)} l${n(w * 1.2)} ${n(w / 2)} l${n(-w * 1.2)} ${n(w / 2)} h${n(-len)} z" fill="#ffd166" ${OUTLINE}/>
<path d="M${n(x + len)} ${n(y - w / 2)} l${n(w * 1.2)} ${n(w / 2)} l${n(-w * 1.2)} ${n(w / 2)} z" fill="#f2d39b"/>
<path d="M${n(x + len + w * 0.8)} ${n(y - w * 0.17)} l${n(w * 0.4)} ${n(w * 0.17)} l${n(-w * 0.4)} ${n(w * 0.17)} z" fill="${tip}"/>
<path d="M${n(x + 6)} ${n(y)} h${n(len - 10)}" stroke="#f0b43c" stroke-width="4"/>
<rect x="${n(x - w * 0.55)}" y="${n(y - w / 2)}" width="${n(w * 0.6)}" height="${n(w)}" rx="${n(w * 0.25)}" fill="#ff8fa3" ${OUTLINE}/>
<rect x="${n(x - 2)}" y="${n(y - w / 2)}" width="${n(w * 0.3)}" height="${n(w)}" fill="#c0c8d0"/></g>`;
}

const pencil: Piece = (r, p) => pencilAt(-70, 70, 150, 32, p.ink, -45 + between(r, -4, 4));

/** A box of crayons. */
const crayonBox: Piece = (r, p) => {
  const cols = [...p.acc].sort(() => r() - 0.5);
  let s = '';
  for (let i = 0; i < 5; i++) {
    const x = -52 + i * 26, top = -62 + ((i * 37) % 3) * 9 - (i === 2 ? 12 : 0), c = cols[i];
    s += `<path d="M${x - 10} ${top + 16} l10 -24 l10 24 z" fill="${c}" ${OUTLINE}/><rect x="${x - 11}" y="${top + 14}" width="22" height="80" rx="3" fill="${c}" ${OUTLINE}/><rect x="${x - 11}" y="${top + 26}" width="22" height="8" fill="#fff" opacity=".5"/>`;
  }
  const box = pick(r, [p.acc[1], p.acc[2], GOLD]);
  return s + `<path d="M-76 -2 h152 l-8 92 h-136 z" fill="${box}" ${OUTLINE}/><path d="M-76 -2 q76 34 152 0" fill="#fff" opacity=".3"/>${star(0, 50, 18, '#fff', 0)}`;
};

/** A blackboard on an easel, with chalk doodles and a "sum" in dots. */
const blackboard: Piece = (r, _p) => {
  const chalk = 'stroke="#fff" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round" fill="none" opacity=".9"';
  let s = `${line('M-66 40 L-86 92 M66 40 L86 92', WOOD, 10, 8)}
<rect x="-92" y="-82" width="184" height="128" rx="12" fill="${WOOD}" ${OUTLINE}/>
<rect x="-80" y="-70" width="160" height="104" rx="6" fill="#2f5d50"/>
<rect x="-88" y="40" width="176" height="12" rx="5" fill="${WOOD}" ${OUTLINE}/>`;
  const doodles = [
    (x: number, y: number) => {
      let d = `<circle cx="${x}" cy="${y}" r="10" ${chalk}/>`;
      for (let i = 0; i < 8; i++) {
        const a = (Math.PI * i) / 4;
        d += `<path d="M${n(x + Math.cos(a) * 15)} ${n(y + Math.sin(a) * 15)} L${n(x + Math.cos(a) * 21)} ${n(y + Math.sin(a) * 21)}" ${chalk}/>`;
      }
      return d;
    },
    (x: number, y: number) => `<path d="M${x - 20} ${y - 2} L${x} ${y - 22} L${x + 20} ${y - 2} M${x - 15} ${y - 6} V${y + 20} H${x + 15} V${y - 6} M${x - 5} ${y + 20} v-12 h10 v12" ${chalk}/>`,
    (x: number, y: number) => star(x, y, 22, 'none', 0).replace(/stroke="#fff" stroke-width="4"/, 'stroke="#fff" stroke-width="4.5" opacity=".9"'),
    (x: number, y: number) => `<path d="M${x} ${y + 16} C${x - 32} ${y - 4} ${x - 16} ${y - 28} ${x} ${y - 10} C${x + 16} ${y - 28} ${x + 32} ${y - 4} ${x} ${y + 16} Z" ${chalk}/>`,
    (x: number, y: number) => {
      let d = `<path d="M${x} ${y + 22} V${y + 4}" ${chalk}/><circle cx="${x}" cy="${y - 6}" r="5" ${chalk}/>`;
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI * i) / 3;
        d += `<circle cx="${n(x + Math.cos(a) * 12)}" cy="${n(y - 6 + Math.sin(a) * 12)}" r="6" ${chalk}/>`;
      }
      return d;
    },
  ];
  const order = [0, 1, 2, 3, 4].sort(() => r() - 0.5);
  s += doodles[order[0]](-46, -36) + doodles[order[1]](0, -36) + doodles[order[2]](46, -36);
  // A sum in dots: 2 + 1 = 3 (or 1 + 2 = 3, or 2 + 2 = 4), with the plus and equals drawn as lines.
  const [a, b] = pick(r, [[2, 1], [1, 2], [2, 2], [1, 1]]);
  const dot = (x: number) => `<circle cx="${x}" cy="12" r="4.5" fill="#fff" opacity=".9"/>`;
  let x = -66, sum = '';
  for (let i = 0; i < a; i++) (sum += dot(x)), (x += 12);
  sum += `<path d="M${x + 2} 12 h12 M${x + 8} 6 v12" ${chalk}/>`;
  x += 24;
  for (let i = 0; i < b; i++) (sum += dot(x)), (x += 12);
  sum += `<path d="M${x + 2} 8 h12 M${x + 2} 16 h12" ${chalk}/>`;
  x += 24;
  for (let i = 0; i < a + b; i++) (sum += dot(x)), (x += 12);
  s += sum;
  s += `<rect x="40" y="34" width="22" height="8" rx="3" fill="#fff"/>`;
  if (r() < 0.6) s += apple(-56, 40, 0.3);
  return s;
};

/** A globe on its stand. */
const globe: Piece = (r) => {
  const R = 62, cy = -12, tilt = between(r, -24, -12);
  return `<rect x="-48" y="76" width="96" height="16" rx="8" fill="${WOOD}" ${OUTLINE}/>
<rect x="-8" y="50" width="16" height="30" fill="${WOOD}"/>
<path d="M${-R - 12} ${cy} a${R + 12} ${R + 12} 0 0 0 ${2 * (R + 12)} 0" fill="none" stroke="${WOOD}" stroke-width="9" stroke-linecap="round" transform="rotate(${n(tilt)} 0 ${cy})"/>
<circle cx="0" cy="${cy}" r="${R}" fill="#4cb8f0" ${OUTLINE}/>
<g transform="rotate(${n(tilt)} 0 ${cy})">
<path d="M${n(-R * 0.6)} ${n(cy - R * 0.55)} q${n(R * 0.3)} ${n(-R * 0.3)} ${n(R * 0.6)} ${n(-R * 0.1)} q${n(R * 0.1)} ${n(R * 0.3)} ${n(-R * 0.1)} ${n(R * 0.5)} q${n(-R * 0.3)} ${n(R * 0.1)} ${n(-R * 0.4)} ${n(R * 0.2)} q${n(-R * 0.3)} ${n(-R * 0.2)} ${n(-R * 0.1)} ${n(-R * 0.6)} z" fill="${GREEN}"/>
<path d="M${n(R * 0.2)} ${n(cy + R * 0.05)} q${n(R * 0.4)} ${n(-R * 0.15)} ${n(R * 0.55)} ${n(R * 0.15)} q${n(-R * 0.05)} ${n(R * 0.4)} ${n(-R * 0.35)} ${n(R * 0.55)} q${n(-R * 0.25)} ${n(-R * 0.3)} ${n(-R * 0.2)} ${n(-R * 0.7)} z" fill="${GREEN}"/>
<path d="M${n(-R * 0.7)} ${n(cy + R * 0.45)} q${n(R * 0.25)} ${n(-R * 0.05)} ${n(R * 0.4)} ${n(R * 0.25)} q${n(-R * 0.2)} ${n(R * 0.15)} ${n(-R * 0.4)} ${n(-R * 0.25)} z" fill="${GREEN}"/>
</g><circle cx="-22" cy="-40" r="9" fill="#fff" opacity=".35"/>`;
};

/** A school bell; with `rope` it hangs from the top of the box, otherwise it is a hand bell. */
function bell(p: Palette, rope: boolean, c = GOLD) {
  const body = `<path d="M-50 44 Q-52 -38 0 -46 Q52 -38 50 44 Q66 50 66 60 H-66 Q-66 50 -50 44 Z" fill="${c}" ${OUTLINE}/>
<path d="M-30 30 Q-32 -20 -6 -30" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round" opacity=".55"/>
<rect x="-60" y="52" width="120" height="10" rx="5" fill="${GOLD_DEEP}"/>
<circle cx="0" cy="74" r="13" fill="${GOLD_DEEP}" ${OUTLINE}/>`;
  return rope
    ? `<path d="M0 -95 V-58" stroke="${p.ink}" stroke-width="4" opacity=".45"/><circle cx="0" cy="-52" r="9" fill="none" stroke="${GOLD_DEEP}" stroke-width="6"/>${body}`
    : `<g transform="rotate(-18)"><rect x="-11" y="-94" width="22" height="54" rx="10" fill="${WOOD}" ${OUTLINE}/>${body}</g><path d="M62 -46 q14 10 14 26 M74 -62 q20 16 20 40" fill="none" stroke="${p.ink}" stroke-width="5" stroke-linecap="round" opacity=".3"/>`;
}

const handBell: Piece = (_r, p) => bell(p, false);
const hangingBell: Piece = (_r, p) => bell(p, true);

/** A thank-you bouquet of flowers, wrapped, with a bow. */
const bouquet: Piece = (r, p) => {
  const cols = [...p.acc].sort(() => r() - 0.5), wrap = pick(r, ['#fff4c2', '#ffe0ec', '#e6f6ff']);
  let s = '';
  for (const [x, a] of [[-46, -150], [46, -30], [-20, -120], [20, -60]] as const) s += leaf(x * 0.4, 0, 46, GREEN, a);
  s += `<path d="M-4 -10 L-50 -50 M0 -10 L0 -64 M4 -10 L50 -50 M-2 -10 L-24 -30 M2 -10 L24 -32" stroke="${DARK_GREEN}" stroke-width="5" stroke-linecap="round"/>`;
  const spots: [number, number, number][] = [[-50, -46, 31], [50, -46, 31], [0, -60, 33], [-24, -20, 28], [26, -22, 28]];
  spots.forEach(([x, y, len], i) => (s += flower(x, y, whole(r, 5, 7), len, len * 0.7, [cols[i]], i % 2 ? GOLD : '#fff4c2', r() * Math.PI, len * 0.32)));
  s += `<path d="M-60 -6 L60 -6 L14 92 L-14 92 Z" fill="${wrap}" ${soft(p, 4)}/><path d="M-30 -6 L-4 92 M30 -6 L4 92" stroke="${p.ink}" stroke-opacity=".12" stroke-width="4"/>`;
  const bow = pick(r, p.acc);
  s += `<path d="M0 44 l-30 -16 v32 z M0 44 l30 -16 v32 z" fill="${bow}" ${OUTLINE}/><path d="M-4 48 l-14 32 M4 48 l14 32" stroke="${bow}" stroke-width="7" stroke-linecap="round"/><circle cx="0" cy="44" r="9" fill="${bow}" ${OUTLINE}/>`;
  return s;
};

/** A ruler with tick marks. */
const ruler: Piece = (r, p) => {
  const c = pick(r, ['#ffd166', p.acc[3], p.acc[4]]);
  let ticks = '';
  for (let i = 0; i <= 18; i++) ticks += `M${-80 + i * 9} -20 v${i % 5 === 0 ? 18 : i % 2 ? 8 : 12} `;
  return `<g transform="rotate(${n(-35 + between(r, -4, 4))})"><rect x="-96" y="-22" width="192" height="44" rx="6" fill="${c}" ${OUTLINE}/>
<path d="${ticks.trim()}" stroke="${p.ink}" stroke-opacity=".5" stroke-width="3" stroke-linecap="round"/>
<circle cx="80" cy="8" r="6" fill="#fff" opacity=".8"/></g>`;
};

/** An abacus with coloured beads. */
const abacus: Piece = (r, p) => {
  let s = `<rect x="-88" y="-76" width="16" height="168" rx="6" fill="${WOOD}" ${OUTLINE}/><rect x="72" y="-76" width="16" height="168" rx="6" fill="${WOOD}" ${OUTLINE}/>`;
  const rows = [-46, -18, 10, 38, 66].slice(0, 4);
  for (const y of rows) s += `<path d="M-74 ${y} H74" stroke="#c0c8d0" stroke-width="4"/>`;
  rows.forEach((y, i) => {
    const c = p.acc[i % p.acc.length], left = whole(r, 1, 5);
    for (let k = 0; k < 6; k++) {
      const x = k < left ? -62 + k * 15 : 62 - (5 - k) * 15;
      s += `<ellipse cx="${x}" cy="${y}" rx="8" ry="11" fill="${c}" stroke="#fff" stroke-width="2.5"/>`;
    }
  });
  s += `<rect x="-90" y="-82" width="180" height="16" rx="6" fill="${WOOD}" ${OUTLINE}/><rect x="-90" y="64" width="180" height="16" rx="6" fill="${WOOD}" ${OUTLINE}/>`;
  return s;
};

/** A star ornament on a ribbon. */
const hangingStar: Piece = (r, p) => `<path d="M0 -95 V-40" stroke="${p.ink}" stroke-width="4" opacity=".45"/>${star(0, 16, 62, pick(r, [GOLD, ...p.acc]), 0)}${sparkle(0, 16, 14, '#fff')}`;

const teachersKit: Kit = {
  hero: [booksApple, blackboard, globe, bouquet, abacus],
  small: [appleAlone, pencil, crayonBox, handBell, ruler, globe, booksApple, abacus],
  hang: [hangingBell, hangingStar],
};

/* ---------------------------------------------------------------- Children's Day */

/** A red rose (Nehru's rose); (x, y) is the middle of the flower. */
function roseAt(x: number, y: number, R: number) {
  const red = '#e8283c', dark = '#b81d30';
  return `<path d="M${n(x)} ${n(y + R * 0.9)} V${n(y + R * 3.4)}" stroke="#fff" stroke-width="16" stroke-linecap="round"/>
<path d="M${n(x)} ${n(y + R * 0.9)} V${n(y + R * 3.4)}" stroke="${DARK_GREEN}" stroke-width="9" stroke-linecap="round"/>
${leaf(x, y + R * 2.1, R * 1.3, GREEN, -35)}${leaf(x, y + R * 2.7, R * 1.2, GREEN, -150)}
<path d="M${n(x - R * 0.7)} ${n(y + R * 0.6)} q${n(-R * 0.2)} ${n(R * 0.5)} ${n(R * 0.7)} ${n(R * 0.55)} q${n(R * 0.9)} ${n(-R * 0.05)} ${n(R * 0.7)} ${n(-R * 0.55)} z" fill="${DARK_GREEN}" ${OUTLINE}/>
<path d="M${n(x - R)} ${n(y - R * 0.1)} q${n(-R * 0.15)} ${n(R * 0.95)} ${n(R)} ${n(R)} q${n(R * 1.15)} ${n(-R * 0.05)} ${n(R)} ${n(-R)} q${n(-R * 0.5)} ${n(R * 0.25)} ${n(-R)} ${n(R * 0.1)} q${n(-R * 0.5)} ${n(R * 0.15)} ${n(-R)} ${n(-R * 0.1)} z" fill="${red}" ${OUTLINE}/>
<path d="M${n(x - R * 0.85)} ${n(y - R * 0.15)} q${n(R * 0.05)} ${n(-R * 0.75)} ${n(R * 0.85)} ${n(-R * 0.8)} q${n(R * 0.8)} ${n(R * 0.05)} ${n(R * 0.85)} ${n(R * 0.8)} q${n(-R * 0.45)} ${n(R * 0.35)} ${n(-R * 0.85)} ${n(R * 0.25)} q${n(-R * 0.4)} ${n(R * 0.1)} ${n(-R * 0.85)} ${n(-R * 0.25)} z" fill="${red}" ${OUTLINE}/>
<path d="M${n(x - R * 0.35)} ${n(y - R * 0.3)} q${n(R * 0.35)} ${n(-R * 0.4)} ${n(R * 0.6)} ${n(-R * 0.05)} q${n(R * 0.05)} ${n(R * 0.35)} ${n(-R * 0.35)} ${n(R * 0.3)}" fill="none" stroke="${dark}" stroke-width="${n(R * 0.09)}" stroke-linecap="round"/>
<path d="M${n(x - R * 0.6)} ${n(y + R * 0.15)} q${n(R * 0.6)} ${n(R * 0.45)} ${n(R * 1.2)} 0" fill="none" stroke="${dark}" stroke-width="${n(R * 0.08)}" stroke-linecap="round"/>`;
}

const rose: Piece = (r) => `<g transform="rotate(${n(between(r, -8, 8))})">${roseAt(0, -48, 40)}</g>`;

/** A balloon (no string); (x, y) is its middle. */
const ball = (x: number, y: number, rx: number, fill: string) => `<ellipse cx="${n(x)}" cy="${n(y)}" rx="${rx}" ry="${n(rx * 1.24)}" fill="${fill}" ${OUTLINE}/>
<ellipse cx="${n(x - rx * 0.34)}" cy="${n(y - rx * 0.44)}" rx="${n(rx * 0.2)}" ry="${n(rx * 0.3)}" fill="#fff" opacity=".55"/>
<path d="M${n(x - 7)} ${n(y + rx * 1.24 + 8)} h14 l-7 -9 z" fill="${fill}" stroke="#fff" stroke-width="2"/>`;

/** A bunch of balloons tied with a bow. */
const balloons: Piece = (r, p) => {
  const cols = [...p.acc].sort(() => r() - 0.5);
  const spots: [number, number][] = [[-46, -24], [46, -28], [0, -50]];
  let s = '';
  for (const [x, y] of spots) s += `<path d="M${x} ${n(y + 30 * 1.24 + 8)} Q${n(x * 0.4)} 44 0 66" fill="none" stroke="${p.ink}" stroke-width="3" opacity=".45"/>`;
  spots.forEach(([x, y], i) => (s += ball(x, y, 32, cols[i])));
  s += `<path d="M0 66 Q-6 80 -2 92" fill="none" stroke="${p.ink}" stroke-width="3" opacity=".45"/><path d="M0 64 l-16 -9 v18 z M0 64 l16 -9 v18 z" fill="${cols[3]}" ${OUTLINE}/>`;
  return s;
};

/** One balloon with a curly string. */
const oneBalloon: Piece = (r, p) => ball(0, -30, 52, pick(r, p.acc)) + `<path d="M0 44 q-14 12 0 24 q14 12 0 24" fill="none" stroke="${p.ink}" stroke-width="3" opacity=".45"/>`;

/** A kite in two colours with a bowed tail. */
const kitePiece: Piece = (r, p) => {
  const c = pick(r, p.acc), d = pick(r, p.acc.filter((x) => x !== c)), t = pick(r, p.acc.filter((x) => x !== c && x !== d));
  return `<g transform="translate(4 -6) rotate(${n(between(r, -22, -8))}) scale(.84)">
<path d="M0 50 q-30 14 -6 30 q22 14 -4 28" fill="none" stroke="${t}" stroke-width="5" stroke-linecap="round"/>
<path d="M-6 74 l-12 -8 v16 z M-6 74 l12 -8 v16 z M-6 98 l-11 -7 v14 z M-6 98 l11 -7 v14 z" fill="${t}" stroke="#fff" stroke-width="2"/>
<path d="M0 -96 L52 -30 L0 0 Z M0 0 L-52 -30 L0 54 Z" fill="${c}" ${OUTLINE}/>
<path d="M0 -96 L-52 -30 L0 0 Z M0 0 L52 -30 L0 54 Z" fill="${d}" ${OUTLINE}/>
<path d="M0 -96 V54 M-52 -30 Q0 -14 52 -30" fill="none" stroke="#fff" stroke-width="4" opacity=".85"/></g>`;
};

/** A teddy bear with a bow tie. */
const teddyBear: Piece = (r, p) => `<g transform="scale(.94)">${teddy(r, p, false)}</g>`;

/** A toy building block (front and top); (x, y) is the bottom-left corner. */
function block(x: number, y: number, s: number, fill: string, mark: number) {
  const d = s * 0.28, m = '#fff', cx = x + s / 2, cy = y - s / 2;
  const marks = [
    `<rect x="${n(x + s * 0.2)}" y="${n(y - s * 0.8)}" width="${n(s * 0.6)}" height="${n(s * 0.6)}" rx="6" fill="none" stroke="${m}" stroke-width="5" opacity=".8"/>`,
    `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(s * 0.24)}" fill="${m}" opacity=".8"/>`,
    star(cx, cy, s * 0.3, m),
    heart(cx, cy, s * 0.22, m),
  ];
  return `<path d="M${n(x)} ${n(y - s)} l${n(d)} ${n(-d)} h${n(s)} l${n(-d)} ${n(d)} z" fill="${fill}" ${OUTLINE}/>
<path d="M${n(x + s)} ${n(y)} v${n(-s)} l${n(d)} ${n(-d)} v${n(s)} z" fill="${fill}" ${OUTLINE}/>
<path d="M${n(x + s)} ${n(y)} v${n(-s)} l${n(d)} ${n(-d)} v${n(s)} z" fill="#000" opacity=".12"/>
<rect x="${n(x)}" y="${n(y - s)}" width="${n(s)}" height="${n(s)}" rx="6" fill="${fill}" ${OUTLINE}/>${marks[mark % 4]}`;
}

/** Three toy blocks stacked. */
const blocks: Piece = (r, p) => {
  const cols = [...p.acc].sort(() => r() - 0.5), k = whole(r, 0, 3);
  return block(-84, 90, 64, cols[0], k) + block(0, 90, 64, cols[1], k + 1) + block(-44 + between(r, -6, 6), 8, 64, cols[2], k + 2);
};

/** A wheel; (x, y) is its middle. */
const wheel = (x: number, y: number, R: number, ink: string) =>
  `<circle cx="${n(x)}" cy="${n(y)}" r="${n(R)}" fill="${ink}" ${OUTLINE}/><circle cx="${n(x)}" cy="${n(y)}" r="${n(R * 0.38)}" fill="${GOLD}"/>`;

/** A toy train: an engine pulling one carriage of blocks. */
const toyTrain: Piece = (r, p) => {
  const cols = [...p.acc].sort(() => r() - 0.5);
  let s = `<rect x="-26" y="34" width="20" height="8" rx="4" fill="${p.ink}"/>`;
  s += `<rect x="-94" y="-2" width="72" height="56" rx="10" fill="${cols[0]}" ${OUTLINE}/><rect x="-86" y="8" width="56" height="9" rx="4.5" fill="#fff" opacity=".45"/>`;
  s += block(-86, -2, 30, cols[2], 1) + block(-50, -2, 26, cols[3], 2);
  s += wheel(-74, 62, 15, p.ink) + wheel(-42, 62, 15, p.ink);
  s += `<rect x="-12" y="-2" width="96" height="56" rx="10" fill="${cols[1]}" ${OUTLINE}/>
<rect x="-12" y="-62" width="52" height="66" rx="10" fill="${cols[4]}" ${OUTLINE}/>
<rect x="-2" y="-50" width="32" height="26" rx="6" fill="#fff" ${soft(p, 3)}/>
<rect x="-20" y="-74" width="68" height="15" rx="6" fill="${p.ink}" ${OUTLINE}/>
<path d="M52 -2 L56 -30 H46 L50 -44 H80 L84 -30 H74 L78 -2 Z" fill="${p.ink}" ${OUTLINE}/>
<path d="M84 26 l12 26 h-12 z" fill="${p.ink}" ${OUTLINE}/>
<circle cx="74" cy="20" r="8" fill="${GOLD}" ${OUTLINE}/>`;
  s += wheel(12, 56, 22, p.ink) + wheel(62, 62, 15, p.ink);
  s += `<circle cx="68" cy="-56" r="9" fill="#fff" ${soft(p, 3)}/><circle cx="80" cy="-74" r="12" fill="#fff" ${soft(p, 3)}/>`;
  return s;
};

/** A spinning top (lattu) with its string. */
const spinningTop: Piece = (r, p) => {
  const cols = [...p.acc].sort(() => r() - 0.5);
  return `<g transform="rotate(${n(between(r, -10, 10))} 0 88)">
<rect x="-10" y="-88" width="20" height="30" rx="7" fill="${WOOD}" ${OUTLINE}/>
<path d="M-66 -26 Q-66 -62 0 -62 Q66 -62 66 -26 Q60 18 0 72 Q-60 18 -66 -26 Z" fill="${cols[0]}" ${OUTLINE}/>
<path d="M-64 -16 Q0 4 64 -16 L56 6 Q0 26 -56 6 Z" fill="${cols[1]}"/>
<path d="M-44 30 Q0 46 44 30 L30 46 Q0 58 -30 46 Z" fill="${cols[2]}"/>
<path d="M-44 -44 q10 -8 24 -10" stroke="#fff" stroke-width="6" stroke-linecap="round" fill="none" opacity=".6"/>
<path d="M0 70 V90" stroke="#9aa5b1" stroke-width="6" stroke-linecap="round"/></g>
<path d="M-90 -30 q-6 30 4 54 M86 -30 q8 30 -4 54" stroke="${p.ink}" stroke-width="5" stroke-linecap="round" fill="none" opacity=".25"/>
<path d="M-40 92 q40 -10 80 0" stroke="${p.ink}" stroke-width="4" stroke-linecap="round" fill="none" opacity=".2"/>`;
};

/** An ice cream cone with two scoops and a cherry. */
const iceCream: Piece = (r, p) => {
  const cols = [...p.acc].sort(() => r() - 0.5);
  const lines = (x0: number) => {
    const k = (40 - x0) / 80;
    return `M${x0} 0 L${n(x0 + 40 * k)} ${n(92 * k)} M${-x0} 0 L${n(-x0 - 40 * k)} ${n(92 * k)}`;
  };
  let sprinkles = '';
  for (let i = 0; i < 6; i++) sprinkles += `<rect x="${n(between(r, -26, 22))}" y="${n(between(r, -66, -40))}" width="9" height="4" rx="2" fill="${pick(r, p.acc)}" transform="rotate(${n(between(r, 0, 180))} 0 -50)" opacity=".9"/>`;
  return `<path d="M-44 0 L44 0 L0 92 Z" fill="#e8b469" ${OUTLINE}/><path d="${lines(-14)} ${lines(14)}" stroke="#c98b3a" stroke-width="3.5"/>
<path d="M-48 2 q-6 -40 48 -46 q54 6 48 46 q-12 10 -24 0 q-12 10 -24 0 q-12 10 -24 0 q-12 10 -24 0 z" fill="${cols[0]}" ${OUTLINE}/>
<circle cx="0" cy="-54" r="32" fill="${cols[1]}" ${OUTLINE}/>${sprinkles}
<circle cx="-12" cy="-66" r="7" fill="#fff" opacity=".5"/>
<path d="M2 -84 q4 -10 14 -12" stroke="#3f9b52" stroke-width="3.5" fill="none" stroke-linecap="round"/><circle cx="0" cy="-84" r="10" fill="${RED}" ${OUTLINE}/>`;
};

/** A rainbow with clouds at its ends. */
const rainbow: Piece = () => {
  const bands = ['#ff6b6b', '#ffa94d', '#ffd43b', '#69db7c', '#4dabf7', '#9775fa'];
  let s = '';
  bands.forEach((c, i) => {
    const R = 84 - i * 11;
    s += `<path d="M${-R} 46 A${R} ${R} 0 0 1 ${R} 46" fill="none" stroke="${c}" stroke-width="11.5"/>`;
  });
  const puff = (x: number) => `<g fill="#fff" ${'stroke="#cfd8e3" stroke-width="3"'}><circle cx="${x - 18}" cy="52" r="16"/><circle cx="${x + 2}" cy="42" r="21"/><circle cx="${x + 20}" cy="54" r="15"/><rect x="${x - 30}" y="50" width="62" height="20" rx="10"/></g><g fill="#fff"><circle cx="${x - 18}" cy="52" r="14.5"/><circle cx="${x + 2}" cy="42" r="19.5"/><circle cx="${x + 20}" cy="54" r="13.5"/><rect x="${x - 28.5}" y="51.5" width="59" height="17" rx="8.5"/></g>`;
  return `<g transform="translate(0 -6)">${s}${puff(-66)}${puff(64)}</g>`;
};

/** A paper boat on little waves. */
const paperBoat: Piece = (r, p) => {
  const c = pick(r, p.acc), d = pick(r, p.acc.filter((x) => x !== c));
  return `<path d="M-46 6 L0 -84 L46 6 Z" fill="${d}" ${OUTLINE}/><path d="M0 -84 L0 6" stroke="#000" stroke-opacity=".12" stroke-width="4"/>
<path d="M-94 -16 L-40 6 H40 L94 -16 L62 58 H-62 Z" fill="${c}" ${OUTLINE}/>
<path d="M-94 -16 L-62 58 M94 -16 L62 58" stroke="#fff" stroke-width="3" opacity=".7"/><path d="M-62 58 L-40 6 M62 58 L40 6" stroke="#000" stroke-opacity=".1" stroke-width="4"/>
<path d="M-92 76 q15 -10 30 0 t30 0 t30 0 t30 0 t30 0 t30 0" fill="none" stroke="#4dabf7" stroke-width="7" stroke-linecap="round"/>
<path d="M-62 90 q15 -10 30 0 t30 0 t30 0 t30 0" fill="none" stroke="#8fd3f0" stroke-width="6" stroke-linecap="round"/>`;
};

/** A paper windmill (pinwheel) on a stick. */
const pinwheel: Piece = (r, p) => {
  const cols = [...p.acc].sort(() => r() - 0.5), spin = between(r, 0, 90);
  let blades = '';
  for (let i = 0; i < 4; i++) blades += `<path d="M0 0 L0 -60 Q44 -58 44 -14 Z" fill="${cols[i]}" ${OUTLINE} transform="rotate(${n(spin + i * 90)})"/>`;
  return `${line('M0 -20 V92', WOOD, 8, 6)}<g transform="translate(0 -24)">${blades}<circle cx="0" cy="0" r="8" fill="${GOLD}" ${OUTLINE}/></g>`;
};

/** A swing hanging from the top of the box, with flowers twined on its ropes. */
const swing: Piece = (r, p) => {
  const rope = pick(r, [WOOD, p.acc[1], p.acc[2]]), seat = pick(r, p.acc);
  let s = `<path d="M-52 -95 V54 M52 -95 V54" stroke="${rope}" stroke-width="6" stroke-linecap="round"/>`;
  for (const [x, y] of [[-52, -50], [52, -20], [-52, 10]] as const) s += flower(x, y, 5, 14, 11, [pick(r, p.acc)], GOLD, r(), 5);
  s += leaf(52, -64, 24, GREEN, -30) + leaf(-52, -24, 24, GREEN, -150);
  s += `<rect x="-74" y="50" width="148" height="18" rx="7" fill="${seat}" ${OUTLINE}/><rect x="-64" y="54" width="40" height="5" rx="2.5" fill="#fff" opacity=".5"/>`;
  return s + `<g transform="translate(14 30) scale(.32)">${teddy(r, p, false)}</g>`;
};

const childrensKit: Kit = {
  hero: [rose, balloons, teddyBear, toyTrain, rainbow, kitePiece],
  small: [rose, oneBalloon, kitePiece, blocks, spinningTop, iceCream, paperBoat, pinwheel, rainbow, teddyBear],
  hang: [swing, hangingStar, oneBalloon],
};

export const schoolKitsB: Record<string, Kit> = {
  'yoga-day': yogaKit,
  'doctors-day': doctorsKit,
  'sports-day': sportsKit,
  'teachers-day': teachersKit,
  'childrens-day': childrensKit,
};
