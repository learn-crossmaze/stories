// Drawings for International Yoga Day, Doctors' Day, National Sports Day, Teachers' Day and Children's Day.
import { between, pick, whole } from '../palettes';
import { balloon, bunting, cloud, confetti, heart, kite, leaf, n, OUTLINE, sparkle, star, sun } from '../motifs';
import type { Design, Palette, Rng } from '../types';

const GREEN = '#5cbf6a';
const WOOD = '#c98b5a';

/** A soft ink outline for white objects, so they don't vanish on the pale card. */
const soft = (p: Palette, w = 5) => `stroke="${p.ink}" stroke-opacity=".15" stroke-width="${w}" stroke-linejoin="round"`;

/** `count` evenly spaced x positions between x0 and x1, each nudged by up to `jitter`. */
function spaced(r: Rng, count: number, x0: number, x1: number, jitter: number) {
  const xs: number[] = [];
  for (let i = 0; i < count; i++) xs.push(x0 + ((x1 - x0) / Math.max(1, count - 1)) * i + between(r, -jitter, jitter));
  return xs;
}

/** A plus sign with rounded arms (first aid), centred on (x, y). */
const plus = (x: number, y: number, s: number, fill: string, outline = true) =>
  `<path d="M${n(x - s * 0.33)} ${n(y - s)} h${n(s * 0.66)} v${n(s * 0.67)} h${n(s * 0.67)} v${n(s * 0.66)} h${n(-s * 0.67)} v${n(s * 0.67)} h${n(-s * 0.66)} v${n(-s * 0.67)} h${n(-s * 0.67)} v${n(-s * 0.66)} h${n(s * 0.67)} z" fill="${fill}" ${outline ? OUTLINE : ''}/>`;

/* ---------- Yoga Day ---------- */

/** A lotus on its pad; (x, y) is the base of the flower. */
function lotus(x: number, y: number, s: number, fill: string, inner: string) {
  const petal = (len: number, w: number, a: number, c: string) =>
    `<path d="M${n(x)} ${n(y)} Q${n(x - w)} ${n(y - len * 0.55)} ${n(x)} ${n(y - len)} Q${n(x + w)} ${n(y - len * 0.55)} ${n(x)} ${n(y)} Z" transform="rotate(${a} ${n(x)} ${n(y)})" fill="${c}" ${OUTLINE}/>`;
  let out = `<ellipse cx="${n(x)}" cy="${n(y + 6 * s)}" rx="${n(95 * s)}" ry="${n(24 * s)}" fill="${GREEN}" ${OUTLINE}/>`;
  for (const a of [-72, 72]) out += petal(62 * s, 22 * s, a, fill);
  for (const a of [-40, 40]) out += petal(78 * s, 26 * s, a, fill);
  out += petal(92 * s, 30 * s, 0, inner);
  return out;
}

/** A yoga mat rolled up and lying on the floor; (x, y) is its left end on the floor. */
function rolledMat(x: number, y: number, len: number, R: number, fill: string) {
  return `<rect x="${n(x)}" y="${n(y - 2 * R)}" width="${n(len)}" height="${n(2 * R)}" rx="${n(R)}" fill="${fill}" ${OUTLINE}/>
<rect x="${n(x + len * 0.3)}" y="${n(y - 2 * R)}" width="12" height="${n(2 * R)}" fill="#fff" opacity=".55"/>
<circle cx="${n(x + len - R)}" cy="${n(y - R)}" r="${n(R)}" fill="${fill}" ${OUTLINE}/>
<path d="M${n(x + len - R)} ${n(y - R)} m-${n(R * 0.2)} 0 a${n(R * 0.2)} ${n(R * 0.2)} 0 1 1 ${n(R * 0.4)} 0 a${n(R * 0.45)} ${n(R * 0.45)} 0 1 1 ${n(-R * 0.85)} 0 a${n(R * 0.68)} ${n(R * 0.68)} 0 1 1 ${n(R * 1.3)} 0" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" opacity=".85"/>`;
}

/** Yoga Day A: the sun rising over a calm pond of lotus flowers. */
const lotusPond: Design = (r, p) => {
  const sx = between(r, 470, 610);
  let s = cloud(between(r, 170, 260), between(r, 120, 170), 0.9) + cloud(between(r, 830, 920), between(r, 90, 140), 0.75);
  for (let i = 0; i < 3; i++) s += sparkle(between(r, 80, 1000), between(r, 200, 320), between(r, 12, 18), pick(r, p.acc));
  s += sun(sx, 300, 105, '#ffc93c');
  s += `<ellipse cx="540" cy="525" rx="490" ry="118" fill="#8fd3f0" ${OUTLINE}/>`;
  for (let i = 0; i < 5; i++) {
    const x = between(r, 180, 900), y = 455 + i * 32 + between(r, -6, 6);
    s += `<path d="M${n(x - 45)} ${n(y)} h90" stroke="#fff" stroke-width="7" stroke-linecap="round" opacity=".75"/>`;
  }
  const pads = whole(r, 1, 3);
  for (let i = 0; i < pads; i++) {
    const x = 200 + (680 / pads) * (i + 0.5) + between(r, -40, 40), y = between(r, 460, 480);
    s += `<path d="M${n(x)} ${n(y)} l${n(between(r, 30, 50))} -12 a52 18 0 1 1 -10 -8 z" fill="#3f9b52" ${OUTLINE}/>`;
  }
  const count = whole(r, 2, 3);
  const xs = spaced(r, count, count === 2 ? 330 : 260, count === 2 ? 750 : 820, 30);
  xs.forEach((x, i) => {
    const big = count === 3 && i === 1 ? 1.5 : count === 2 ? 1.4 : 1.2;
    s += lotus(x, between(r, 560, 585) - (count === 3 && i === 1 ? 10 : 0), big, pick(r, [p.acc[0], p.acc[1], p.acc[4]]), '#ffd6e5');
  });
  for (const [x, side] of [[between(r, 70, 110), 1], [between(r, 970, 1010), -1]] as const) {
    for (let j = 0; j < 3; j++) {
      const bx = x + side * j * 26, h = 200 - j * 45;
      s += `<path d="M${n(bx)} 600 q${n(side * 10)} ${n(-h / 2)} ${n(side * 4)} ${n(-h)}" fill="none" stroke="#3f9b52" stroke-width="9" stroke-linecap="round"/>`;
      s += `<rect x="${n(bx + side * 4 - 9)}" y="${n(600 - h - 8)}" width="18" height="52" rx="9" fill="#8d5a3b" ${OUTLINE}/>`;
    }
    s += leaf(x - side * 10, 610, 110, GREEN, side > 0 ? -60 : -120);
  }
  return s;
};

/** A cat in a long, happy stretch; (x, y) is under its middle, on the mat. */
function stretchingCat(x: number, y: number, fur: string, stripe: string, ink: string) {
  return `<path d="M${n(x + 105)} ${n(y - 150)} q70 -30 60 -110 q-4 -26 18 -22" fill="none" stroke="#fff" stroke-width="30" stroke-linecap="round"/>
<path d="M${n(x + 105)} ${n(y - 150)} q70 -30 60 -110 q-4 -26 18 -22" fill="none" stroke="${fur}" stroke-width="20" stroke-linecap="round"/>
<rect x="${n(x + 60)}" y="${n(y - 120)}" width="34" height="120" rx="17" fill="${fur}" ${OUTLINE}/>
<rect x="${n(x + 102)}" y="${n(y - 120)}" width="34" height="120" rx="17" fill="${fur}" ${OUTLINE}/>
<ellipse cx="${n(x + 10)}" cy="${n(y - 110)}" rx="125" ry="52" transform="rotate(-24 ${n(x + 10)} ${n(y - 110)})" fill="${fur}" ${OUTLINE}/>
<path d="M${n(x + 40)} ${n(y - 165)} l-14 34 M${n(x + 5)} ${n(y - 150)} l-14 34 M${n(x - 30)} ${n(y - 134)} l-14 32" stroke="${stripe}" stroke-width="10" stroke-linecap="round"/>
<rect x="${n(x - 262)}" y="${n(y - 32)}" width="210" height="32" rx="16" fill="${fur}" ${OUTLINE}/>
<path d="M${n(x - 165)} ${n(y - 100)} l-6 -58 l40 30 z M${n(x - 105)} ${n(y - 108)} l26 -52 l12 48 z" fill="${fur}" ${OUTLINE}/>
<circle cx="${n(x - 130)}" cy="${n(y - 70)}" r="52" fill="${fur}" ${OUTLINE}/>
<path d="M${n(x - 158)} ${n(y - 80)} q10 10 20 0 M${n(x - 116)} ${n(y - 80)} q10 10 20 0" fill="none" stroke="${ink}" stroke-width="5" stroke-linecap="round"/>
<path d="M${n(x - 133)} ${n(y - 62)} h12 l-6 7 z" fill="#ff8fa3"/>
<path d="M${n(x - 139)} ${n(y - 50)} q6 7 12 0 q6 7 12 0" fill="none" stroke="${ink}" stroke-width="4" stroke-linecap="round"/>
<circle cx="${n(x - 166)}" cy="${n(y - 58)}" r="9" fill="#ff8fa3" opacity=".6"/><circle cx="${n(x - 92)}" cy="${n(y - 58)}" r="9" fill="#ff8fa3" opacity=".6"/>`;
}

/** Yoga Day B: a cat stretching on an open mat at sunrise, rolled mats and a plant beside it. */
const catStretch: Design = (r, p) => {
  const left = r() < 0.5;
  let s = sun(left ? between(r, 830, 900) : between(r, 180, 250), between(r, 140, 180), 72, '#ffc93c');
  s += cloud(left ? between(r, 260, 380) : between(r, 700, 820), between(r, 150, 210), 0.8);
  const matCol = pick(r, p.acc), cx = between(r, 520, 580);
  s += `<rect x="${n(cx - 300)}" y="606" width="600" height="30" rx="15" fill="${matCol}" ${OUTLINE}/>`;
  s += stretchingCat(cx + 20, 606, '#f4a259', '#d9822b', p.ink);
  const rolls = whole(r, 1, 2), rx = left ? 70 : 860, others = p.acc.filter((c) => c !== matCol);
  for (let i = 0; i < rolls; i++) s += rolledMat(rx + (left ? 0 : i * 18), 640 - i * 62, 150, 31, others[(i + whole(r, 0, 3)) % others.length]);
  const px = left ? between(r, 920, 960) : between(r, 110, 150);
  for (let j = 0; j < 5; j++) s += leaf(px, 540, between(r, 80, 110), j % 2 ? GREEN : '#3f9b52', -150 + j * 30 + between(r, -6, 6));
  s += `<path d="M${n(px - 55)} 530 h110 l-14 110 h-82 z" fill="${pick(r, others)}" ${OUTLINE}/>`;
  for (let i = 0; i < 3; i++) s += sparkle(between(r, 360, 720), between(r, 90, 300), between(r, 12, 20), pick(r, p.acc));
  return s;
};

/* ---------- Doctors' Day ---------- */

/** Doctors' Day A: a stethoscope wrapped round a big heart with a heartbeat line. */
const stethoHeart: Design = (r, p) => {
  const hx = between(r, 500, 580), hy = 360, hs = 125, flip = r() < 0.5 ? 1 : -1;
  let s = '';
  const slots = [[120, 120], [960, 120], [150, 320], [930, 320], [320, 70], [770, 70]];
  for (let i = 0; i < slots.length; i++) {
    const x = slots[i][0] + between(r, -30, 30), y = slots[i][1] + between(r, -25, 25);
    const k = whole(r, 0, 2), c = pick(r, p.acc);
    s += k === 0 ? plus(x, y, between(r, 18, 26), c) : k === 1 ? sparkle(x, y, between(r, 14, 22), c) : heart(x, y, between(r, 16, 22), c);
  }
  s += heart(hx, hy, hs, pick(r, ['#f45b69', '#ff6f91', '#ef476f']));
  s += `<path d="M${n(hx - 110)} ${n(hy + 5)} h40 l22 -48 l30 100 l28 -92 l20 40 h60" fill="none" stroke="#fff" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/>`;
  const ex = hx + flip * 10, tube = `M${n(ex - 95)} 60 Q${n(ex - 110)} 180 ${n(ex)} 205 Q${n(ex + 110)} 180 ${n(ex + 95)} 60 M${n(ex)} 205 C${n(ex + flip * 330)} 200 ${n(ex + flip * 330)} 600 ${n(ex + flip * 60)} 600 S${n(ex - flip * 300)} 580 ${n(ex - flip * 300)} 500`;
  s += `<path d="${tube}" fill="none" stroke="#fff" stroke-width="28" stroke-linecap="round" stroke-linejoin="round"/>`;
  s += `<path d="${tube}" fill="none" stroke="${p.ink}" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"/>`;
  for (const side of [-1, 1]) s += `<circle cx="${n(ex + side * 95)}" cy="52" r="16" fill="${p.acc[3]}" ${OUTLINE}/>`;
  const cx = ex - flip * 300, cy = 450;
  s += `<circle cx="${n(cx)}" cy="${cy}" r="52" fill="#b0bec5" ${OUTLINE}/><circle cx="${n(cx)}" cy="${cy}" r="32" fill="${pick(r, p.acc)}"/><circle cx="${n(cx - 10)}" cy="${cy - 10}" r="9" fill="#fff" opacity=".6"/>`;
  return s;
};

/** A teddy bear sitting on the floor with a plaster on its head; (x, y) is under its middle. */
function teddy(x: number, y: number, fur: string, light: string, ink: string, tilt: number) {
  return `<g transform="rotate(${n(tilt)} ${n(x)} ${n(y)})">
<circle cx="${n(x - 70)}" cy="${n(y - 30)}" r="36" fill="${fur}" ${OUTLINE}/><circle cx="${n(x + 70)}" cy="${n(y - 30)}" r="36" fill="${fur}" ${OUTLINE}/>
<circle cx="${n(x - 70)}" cy="${n(y - 30)}" r="18" fill="${light}"/><circle cx="${n(x + 70)}" cy="${n(y - 30)}" r="18" fill="${light}"/>
<ellipse cx="${n(x)}" cy="${n(y - 95)}" rx="88" ry="98" fill="${fur}" ${OUTLINE}/>
<ellipse cx="${n(x)}" cy="${n(y - 85)}" rx="52" ry="58" fill="${light}"/>
<rect x="${n(x - 112)}" y="${n(y - 165)}" width="44" height="100" rx="22" transform="rotate(25 ${n(x - 90)} ${n(y - 165)})" fill="${fur}" ${OUTLINE}/>
<rect x="${n(x + 68)}" y="${n(y - 165)}" width="44" height="100" rx="22" transform="rotate(-25 ${n(x + 90)} ${n(y - 165)})" fill="${fur}" ${OUTLINE}/>
<circle cx="${n(x - 62)}" cy="${n(y - 318)}" r="30" fill="${fur}" ${OUTLINE}/><circle cx="${n(x + 62)}" cy="${n(y - 318)}" r="30" fill="${fur}" ${OUTLINE}/>
<circle cx="${n(x - 62)}" cy="${n(y - 318)}" r="14" fill="${light}"/><circle cx="${n(x + 62)}" cy="${n(y - 318)}" r="14" fill="${light}"/>
<circle cx="${n(x)}" cy="${n(y - 255)}" r="82" fill="${fur}" ${OUTLINE}/>
<ellipse cx="${n(x)}" cy="${n(y - 228)}" rx="38" ry="30" fill="${light}"/>
<ellipse cx="${n(x)}" cy="${n(y - 240)}" rx="12" ry="9" fill="${ink}"/>
<path d="M${n(x - 14)} ${n(y - 218)} q14 12 28 0" fill="none" stroke="${ink}" stroke-width="5" stroke-linecap="round"/>
<circle cx="${n(x - 32)}" cy="${n(y - 272)}" r="8" fill="${ink}"/><circle cx="${n(x + 32)}" cy="${n(y - 272)}" r="8" fill="${ink}"/>
<g transform="rotate(-28 ${n(x + 38)} ${n(y - 312)})"><rect x="${n(x + 2)}" y="${n(y - 326)}" width="72" height="28" rx="12" fill="#f5d0a9" ${OUTLINE}/><rect x="${n(x + 26)}" y="${n(y - 326)}" width="24" height="28" fill="#e9b98a"/></g>
</g>`;
}

/** Doctors' Day B: a first-aid kit, a teddy with a plaster and a thermometer. */
const firstAid: Design = (r, p) => {
  const kitCol = pick(r, [p.acc[0], p.acc[2], p.acc[4]]), swap = r() < 0.5;
  const kx = swap ? between(r, 600, 660) : between(r, 420, 480), tx = swap ? between(r, 250, 300) : between(r, 780, 830);
  let s = '';
  for (let i = 0; i < 5; i++) s += plus(between(r, 80, 1000), between(r, 50, 200), between(r, 14, 22), pick(r, p.acc));
  s += `<path d="M${n(kx - 70)} 360 v-50 a26 26 0 0 1 26 -26 h88 a26 26 0 0 1 26 26 v50" fill="none" stroke="#fff" stroke-width="34" stroke-linecap="round"/>
<path d="M${n(kx - 70)} 360 v-50 a26 26 0 0 1 26 -26 h88 a26 26 0 0 1 26 26 v50" fill="none" stroke="${p.ink}" stroke-width="22" stroke-linecap="round"/>
<rect x="${n(kx - 190)}" y="350" width="380" height="290" rx="34" fill="${kitCol}" ${OUTLINE}/>
<rect x="${n(kx - 190)}" y="420" width="380" height="16" fill="#fff" opacity=".35"/>
<circle cx="${n(kx)}" cy="510" r="88" fill="#fff"/>` + plus(kx, 510, 62, kitCol, false);
  s += teddy(tx, 640, '#c98b5a', '#f1d3b3', '#5a3a22', between(r, -6, 6));
  const thx = swap ? between(r, 880, 940) : between(r, 140, 200), tilt = swap ? 18 : -18;
  s += `<g transform="rotate(${tilt} ${n(thx)} 640)"><rect x="${n(thx - 24)}" y="330" width="48" height="300" rx="24" fill="#fff" ${soft(p, 6)}/>
<rect x="${n(thx - 8)}" y="380" width="16" height="230" rx="8" fill="#e8382a"/><circle cx="${n(thx)}" cy="610" r="34" fill="#e8382a" ${OUTLINE}/>
<path d="M${n(thx + 12)} 400 h10 M${n(thx + 12)} 440 h10 M${n(thx + 12)} 480 h10 M${n(thx + 12)} 520 h10" stroke="${p.ink}" stroke-width="4" stroke-linecap="round" opacity=".4"/></g>`;
  s += heart(swap ? kx + 230 : kx - 230, between(r, 250, 290), 26, pick(r, p.acc));
  return s;
};

/* ---------- Sports Day ---------- */

/** A gold medal on a V-shaped ribbon hanging from the top. */
function medal(x: number, y: number, R: number, metal: string, ribbon: string[], tilt: number) {
  return `<g transform="rotate(${n(tilt)} ${n(x)} 20)">
<path d="M${n(x - 70)} 20 h44 l46 ${n(y - R - 20)} h-34 z" fill="${ribbon[0]}" ${OUTLINE}/>
<path d="M${n(x + 70)} 20 h-44 l-46 ${n(y - R - 20)} h34 z" fill="${ribbon[1]}" ${OUTLINE}/>
<circle cx="${n(x)}" cy="${n(y)}" r="${n(R)}" fill="${metal}" ${OUTLINE}/>
<circle cx="${n(x)}" cy="${n(y)}" r="${n(R * 0.72)}" fill="none" stroke="#fff" stroke-width="5" opacity=".6"/>
${star(x, y, R * 0.5, '#fff4c2')}</g>`;
}

/** Sports Day A: a big trophy between hanging medals, with confetti. */
const trophy: Design = (r, p) => {
  const tx = between(r, 500, 580);
  let s = confetti(r, p.acc, 36);
  s += medal(between(r, 150, 210), between(r, 280, 330), 58, '#ffc93c', [p.acc[0], p.acc[2]], between(r, -8, 4));
  s += medal(between(r, 870, 930), between(r, 250, 300), 52, '#c0c8d0', [p.acc[1], p.acc[4]], between(r, -4, 8));
  const gold = '#ffc93c', deep = '#f0a500';
  s += `<path d="M${n(tx - 150)} 200 c-110 0 -110 150 20 170 M${n(tx + 150)} 200 c110 0 110 150 -20 170" fill="none" stroke="#fff" stroke-width="40" stroke-linecap="round"/>
<path d="M${n(tx - 150)} 200 c-110 0 -110 150 20 170 M${n(tx + 150)} 200 c110 0 110 150 -20 170" fill="none" stroke="${deep}" stroke-width="28" stroke-linecap="round"/>
<path d="M${n(tx - 175)} 150 h350 q0 260 -175 270 q-175 -10 -175 -270 z" fill="${gold}" ${OUTLINE}/>
<path d="M${n(tx - 120)} 190 q0 150 60 200" fill="none" stroke="#fff" stroke-width="12" stroke-linecap="round" opacity=".55"/>
<rect x="${n(tx - 26)}" y="410" width="52" height="90" fill="${deep}" ${OUTLINE}/>
<path d="M${n(tx - 80)} 520 q80 -40 160 0 v10 h-160 z" fill="${gold}" ${OUTLINE}/>
<rect x="${n(tx - 130)}" y="528" width="260" height="110" rx="16" fill="${p.ink}" ${OUTLINE}/>
<rect x="${n(tx - 80)}" y="562" width="160" height="42" rx="10" fill="${gold}"/>`;
  s += r() < 0.5 ? star(tx, 280, 56, '#fff4c2', between(r, -0.2, 0.2)) : star(tx - 62, 300, 30, '#fff4c2') + star(tx, 262, 40, '#fff4c2') + star(tx + 62, 300, 30, '#fff4c2');
  for (let i = 0; i < 4; i++) s += sparkle(tx + (i % 2 ? 1 : -1) * between(r, 230, 300), between(r, 60, 140) + (i > 1 ? 380 : 0), between(r, 14, 22), pick(r, p.acc));
  return s;
};

/** A football; (x, y) is its middle. */
function football(x: number, y: number, R: number, p: Palette, spin: number) {
  let s = `<circle cx="${n(x)}" cy="${n(y)}" r="${n(R)}" fill="#fff" ${soft(p, 6)}/>`;
  const pent = (cx: number, cy: number, rr: number, rot: number) => {
    let pts = '';
    for (let i = 0; i < 5; i++) {
      const a = rot + (2 * Math.PI * i) / 5 - Math.PI / 2;
      pts += `${n(cx + Math.cos(a) * rr)},${n(cy + Math.sin(a) * rr)} `;
    }
    return `<polygon points="${pts.trim()}" fill="${p.ink}" stroke="${p.ink}" stroke-width="4" stroke-linejoin="round"/>`;
  };
  s += pent(x, y, R * 0.3, spin);
  for (let i = 0; i < 5; i++) {
    const a = spin + (2 * Math.PI * i) / 5 - Math.PI / 2;
    s += `<line x1="${n(x + Math.cos(a) * R * 0.3)}" y1="${n(y + Math.sin(a) * R * 0.3)}" x2="${n(x + Math.cos(a) * R * 0.66)}" y2="${n(y + Math.sin(a) * R * 0.66)}" stroke="${p.ink}" stroke-width="5"/>`;
    s += pent(x + Math.cos(a) * R * 0.8, y + Math.sin(a) * R * 0.8, R * 0.16, a + Math.PI);
  }
  return s;
}

/** Sports Day B: a football, cricket bat and ball, shuttlecock, cones and a skipping rope on the grass. */
const playground: Design = (r, p) => {
  let s = bunting(40, 30, 1040, 30, [...p.acc].sort(() => r() - 0.5), 11, 30);
  s += cloud(between(r, 400, 460), between(r, 190, 220), 0.75);
  s += `<path d="M30 600 q270 -40 520 -10 t500 0 v50 h-1020 z" fill="${GREEN}" opacity=".55"/>`;
  // cricket stumps with a bat leaning on them
  const sx = between(r, 200, 250);
  for (const dx of [-40, 0, 40]) s += `<rect x="${n(sx + dx - 12)}" y="300" width="24" height="330" rx="10" fill="#e8c07a" ${OUTLINE}/>`;
  s += `<rect x="${n(sx - 58)}" y="286" width="54" height="16" rx="8" fill="#e8c07a" ${OUTLINE}/><rect x="${n(sx + 4)}" y="286" width="54" height="16" rx="8" fill="#e8c07a" ${OUTLINE}/>`;
  s += `<g transform="rotate(${n(between(r, -20, -13))} ${n(sx + 110)} 636)"><rect x="${n(sx + 74)}" y="340" width="72" height="296" rx="26" fill="#f2d39b" ${OUTLINE}/>
<rect x="${n(sx + 94)}" y="200" width="32" height="150" rx="14" fill="${pick(r, p.acc)}" ${OUTLINE}/>
<path d="M${n(sx + 94)} 235 h32 M${n(sx + 94)} 270 h32 M${n(sx + 94)} 305 h32" stroke="#fff" stroke-width="4" opacity=".7"/></g>`;
  const bx = sx - between(r, 115, 135);
  s += `<circle cx="${n(bx)}" cy="598" r="40" fill="#d63031" ${OUTLINE}/><path d="M${n(bx - 24)} 570 q-12 28 0 56 M${n(bx - 9)} 561 q-12 37 0 74" fill="none" stroke="#fff" stroke-width="4" stroke-dasharray="7 7"/>`;
  // football in the middle
  const fx = between(r, 540, 590);
  s += football(fx, 490, 130, p, between(r, 0, 1.2));
  // skipping rope in front
  const rc = pick(r, p.acc);
  s += `<path d="M${n(fx - 190)} 632 q130 30 220 0 t180 -10" fill="none" stroke="#fff" stroke-width="18" stroke-linecap="round"/>
<path d="M${n(fx - 190)} 632 q130 30 220 0 t180 -10" fill="none" stroke="${rc}" stroke-width="10" stroke-linecap="round"/>
<rect x="${n(fx - 260)}" y="618" width="76" height="30" rx="15" fill="${p.ink}" ${OUTLINE}/><rect x="${n(fx + 206)}" y="606" width="76" height="30" rx="15" fill="${p.ink}" ${OUTLINE}/>`;
  // shuttlecock flying with motion lines
  const shx = between(r, 760, 820), shy = between(r, 210, 250);
  s += `<g transform="rotate(${n(between(r, 30, 50))} ${n(shx)} ${n(shy)})">
<path d="M${n(shx - 42)} ${n(shy)} l-32 -140 h148 l-32 140 z" fill="#fff" ${soft(p)}/>
<path d="M${n(shx - 16)} ${n(shy)} l-10 -138 M${n(shx + 16)} ${n(shy)} l10 -138" stroke="${p.ink}" stroke-width="4" opacity=".25"/>
<rect x="${n(shx - 46)}" y="${n(shy - 8)}" width="92" height="18" rx="6" fill="${pick(r, p.acc)}"/>
<path d="M${n(shx - 44)} ${n(shy + 10)} h88 a44 44 0 0 1 -88 0 z" fill="#fff4c2" ${OUTLINE}/></g>`;
  for (let i = 0; i < 3; i++) s += `<path d="M${n(shx - 120 - i * 22)} ${n(shy + 80 + i * 32)} l-80 46" stroke="${p.ink}" stroke-width="7" stroke-linecap="round" opacity=".2"/>`;
  // cones on the right
  const cones = whole(r, 2, 3), cc = pick(r, p.acc);
  spaced(r, cones, cones === 2 ? 880 : 850, 990, 8).forEach((x, i) => {
    const h = i === 0 ? 150 : 115;
    s += `<path d="M${n(x - 56)} 630 L${n(x - 16)} ${n(630 - h)} h32 L${n(x + 56)} 630 z" fill="${cc}" ${OUTLINE}/>
<path d="M${n(x - 34)} ${n(630 - h * 0.45)} h68" stroke="#fff" stroke-width="14" stroke-linecap="round"/>
<rect x="${n(x - 68)}" y="620" width="136" height="18" rx="7" fill="${cc}" ${OUTLINE}/>`;
  });
  return s;
};

/* ---------- Teachers' Day ---------- */

/** An apple; (x, y) is the middle of its bottom. */
const apple = (x: number, y: number, s: number) =>
  `<path d="M${n(x)} ${n(y - 108 * s)} q${n(-4 * s)} ${n(-30 * s)} ${n(10 * s)} ${n(-46 * s)}" fill="none" stroke="#7a4a12" stroke-width="${n(9 * s)}" stroke-linecap="round"/>
${leaf(x + 6 * s, y - 128 * s, 56 * s, GREEN, -30)}
<path d="M${n(x)} ${n(y - 100 * s)} C${n(x - 40 * s)} ${n(y - 125 * s)} ${n(x - 100 * s)} ${n(y - 95 * s)} ${n(x - 92 * s)} ${n(y - 45 * s)} C${n(x - 85 * s)} ${n(y)} ${n(x - 40 * s)} ${n(y + 4 * s)} ${n(x)} ${n(y - 10 * s)} C${n(x + 40 * s)} ${n(y + 4 * s)} ${n(x + 85 * s)} ${n(y)} ${n(x + 92 * s)} ${n(y - 45 * s)} C${n(x + 100 * s)} ${n(y - 95 * s)} ${n(x + 40 * s)} ${n(y - 125 * s)} ${n(x)} ${n(y - 100 * s)} Z" fill="#e8382a" ${OUTLINE}/>
<ellipse cx="${n(x - 45 * s)}" cy="${n(y - 70 * s)}" rx="${n(14 * s)}" ry="${n(22 * s)}" fill="#fff" opacity=".5"/>`;

/** A crayon or pencil lying or standing at an angle; (x, y) is its back end, pointing along `angle`. */
function crayon(x: number, y: number, len: number, w: number, fill: string, angle: number, pencil = false) {
  const body = pencil ? '#ffd166' : fill;
  return `<g transform="rotate(${n(angle)} ${n(x)} ${n(y)})">
<path d="M${n(x)} ${n(y - w / 2)} h${n(len)} l${n(w * 1.2)} ${n(w / 2)} l${n(-w * 1.2)} ${n(w / 2)} h${n(-len)} z" fill="${body}" ${OUTLINE}/>
${pencil ? `<path d="M${n(x + len)} ${n(y - w / 2)} l${n(w * 1.2)} ${n(w / 2)} l${n(-w * 1.2)} ${n(w / 2)} z" fill="#f2d39b"/><path d="M${n(x + len + w * 0.8)} ${n(y - w * 0.17)} l${n(w * 0.4)} ${n(w * 0.17)} l${n(-w * 0.4)} ${n(w * 0.17)} z" fill="${fill}"/><rect x="${n(x - w * 0.5)}" y="${n(y - w / 2)}" width="${n(w * 0.6)}" height="${n(w)}" rx="${n(w * 0.25)}" fill="#ff8fa3"/>` : `<rect x="${n(x + len * 0.2)}" y="${n(y - w / 2)}" width="${n(len * 0.55)}" height="${n(w)}" fill="#fff" opacity=".35"/>`}
</g>`;
}

/** A globe on its stand; (x, y) is the middle of the base on the floor. */
function globe(x: number, y: number, R: number, tilt: number) {
  const cy = y - R - 70;
  return `<rect x="${n(x - 70)}" y="${n(y - 26)}" width="140" height="26" rx="13" fill="${WOOD}" ${OUTLINE}/>
<rect x="${n(x - 10)}" y="${n(y - 80)}" width="20" height="58" fill="${WOOD}"/>
<path d="M${n(x - R - 18)} ${n(cy)} a${n(R + 18)} ${n(R + 18)} 0 0 0 ${n(2 * (R + 18))} 0" fill="none" stroke="${WOOD}" stroke-width="12" stroke-linecap="round" transform="rotate(${n(tilt)} ${n(x)} ${n(cy)})"/>
<circle cx="${n(x)}" cy="${n(cy)}" r="${n(R)}" fill="#4cb8f0" ${OUTLINE}/>
<g transform="rotate(${n(tilt)} ${n(x)} ${n(cy)})">
<path d="M${n(x - R * 0.6)} ${n(cy - R * 0.55)} q${n(R * 0.3)} ${n(-R * 0.3)} ${n(R * 0.6)} ${n(-R * 0.1)} q${n(R * 0.1)} ${n(R * 0.3)} ${n(-R * 0.1)} ${n(R * 0.5)} q${n(-R * 0.3)} ${n(R * 0.1)} ${n(-R * 0.4)} ${n(R * 0.2)} q${n(-R * 0.3)} ${n(-R * 0.2)} ${n(-R * 0.1)} ${n(-R * 0.6)} z" fill="${GREEN}"/>
<path d="M${n(x + R * 0.2)} ${n(cy + R * 0.05)} q${n(R * 0.4)} ${n(-R * 0.15)} ${n(R * 0.55)} ${n(R * 0.15)} q${n(-R * 0.05)} ${n(R * 0.4)} ${n(-R * 0.35)} ${n(R * 0.55)} q${n(-R * 0.25)} ${n(-R * 0.3)} ${n(-R * 0.2)} ${n(-R * 0.7)} z" fill="${GREEN}"/>
<path d="M${n(x - R * 0.7)} ${n(cy + R * 0.45)} q${n(R * 0.25)} ${n(-R * 0.05)} ${n(R * 0.4)} ${n(R * 0.25)} q${n(-R * 0.2)} ${n(R * 0.15)} ${n(-R * 0.4)} ${n(-R * 0.25)} z" fill="${GREEN}"/>
</g>
<circle cx="${n(x)}" cy="${n(cy - R - 18)}" r="8" fill="${WOOD}"/>`;
}

/** Teachers' Day A: an apple on a stack of books, with a pencil pot and a globe. */
const booksApple: Design = (r, p) => {
  const bx = between(r, 500, 580), books = whole(r, 3, 4), cols = [...p.acc].sort(() => r() - 0.5);
  let s = '';
  for (let i = 0; i < 4; i++) s += star(between(r, 80, 1000), between(r, 40, 150), between(r, 14, 22), pick(r, p.acc), between(r, 0, 1));
  let y = 640;
  for (let i = 0; i < books; i++) {
    const w = between(r, 320, 360) - i * 18, h = between(r, 74, 86), x = bx - w / 2 + between(r, -18, 18);
    y -= h;
    s += `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="10" fill="${cols[i % cols.length]}" ${OUTLINE}/>
<rect x="${n(x + w - 26)}" y="${n(y + 10)}" width="20" height="${n(h - 20)}" rx="4" fill="#fff" opacity=".8"/>
<rect x="${n(x + 26)}" y="${n(y + h / 2 - 7)}" width="${n(w * 0.4)}" height="14" rx="7" fill="#fff" opacity=".45"/>`;
  }
  s += apple(bx + between(r, -40, 40), y + 4, 1.4);
  const left = r() < 0.5, px = left ? between(r, 160, 200) : between(r, 880, 920), gx = left ? between(r, 880, 900) : between(r, 180, 200);
  const items = whole(r, 3, 4);
  for (let i = 0; i < items; i++) {
    const a = -90 + (i - (items - 1) / 2) * 12;
    s += crayon(px + (i - (items - 1) / 2) * 26, 540, between(r, 200, 250), 36, cols[(i + 1) % cols.length], a, i % 2 === 0);
  }
  s += `<path d="M${n(px - 84)} 450 h168 l-14 190 h-140 z" fill="${pick(r, p.acc)}" ${OUTLINE}/><path d="M${n(px - 72)} 495 h144" stroke="#fff" stroke-width="8" opacity=".5"/>`;
  s += globe(gx, 640, 118, between(r, -25, -12));
  return s;
};

/** Teachers' Day B: a little chalkboard with doodles, an apple on its ledge and crayons in front. */
const chalkboard: Design = (r, p) => {
  const cx = between(r, 510, 570), chalk = 'stroke="#fff" stroke-width="7" stroke-linecap="round" stroke-linejoin="round" fill="none" opacity=".9"';
  let s = `<path d="M${n(cx - 230)} 640 L${n(cx - 160)} 120 M${n(cx + 230)} 640 L${n(cx + 160)} 120" stroke="#fff" stroke-width="34" stroke-linecap="round"/>
<path d="M${n(cx - 230)} 640 L${n(cx - 160)} 120 M${n(cx + 230)} 640 L${n(cx + 160)} 120" stroke="${WOOD}" stroke-width="22" stroke-linecap="round"/>
<rect x="${n(cx - 270)}" y="110" width="540" height="350" rx="24" fill="${WOOD}" ${OUTLINE}/>
<rect x="${n(cx - 245)}" y="135" width="490" height="300" rx="12" fill="#2f5d50"/>
<rect x="${n(cx - 260)}" y="450" width="520" height="24" rx="10" fill="${WOOD}" ${OUTLINE}/>`;
  // chalk doodles in three slots: sun, house, star or heart, flower, wavy line
  const doodles = [
    (x: number, y: number) => {
      let d = `<circle cx="${n(x)}" cy="${n(y)}" r="28" ${chalk}/>`;
      for (let i = 0; i < 8; i++) {
        const a = (Math.PI * i) / 4;
        d += `<path d="M${n(x + Math.cos(a) * 40)} ${n(y + Math.sin(a) * 40)} L${n(x + Math.cos(a) * 56)} ${n(y + Math.sin(a) * 56)}" ${chalk}/>`;
      }
      return d;
    },
    (x: number, y: number) => `<path d="M${n(x - 50)} ${n(y - 5)} L${n(x)} ${n(y - 55)} L${n(x + 50)} ${n(y - 5)} M${n(x - 38)} ${n(y - 15)} V${n(y + 55)} H${n(x + 38)} V${n(y - 15)} M${n(x - 12)} ${n(y + 55)} v-36 h24 v36" ${chalk}/>`,
    (x: number, y: number) => star(x, y, 56, 'none', 0).replace(/stroke="#fff" stroke-width="4"/, 'stroke="#fff" stroke-width="7" opacity=".9"'),
    (x: number, y: number) => `<path d="M${n(x)} ${n(y + 40)} C${n(x - 80)} ${n(y - 10)} ${n(x - 40)} ${n(y - 70)} ${n(x)} ${n(y - 25)} C${n(x + 40)} ${n(y - 70)} ${n(x + 80)} ${n(y - 10)} ${n(x)} ${n(y + 40)} Z" ${chalk}/>`,
    (x: number, y: number) => {
      let d = `<path d="M${n(x)} ${n(y + 60)} V${n(y + 10)}" ${chalk}/><circle cx="${n(x)}" cy="${n(y - 15)}" r="12" ${chalk}/>`;
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI * i) / 3;
        d += `<circle cx="${n(x + Math.cos(a) * 30)}" cy="${n(y - 15 + Math.sin(a) * 30)}" r="15" ${chalk}/>`;
      }
      return d;
    },
  ];
  const order = [0, 1, 2, 3, 4].sort(() => r() - 0.5).slice(0, 3);
  order.forEach((k, i) => (s += doodles[k](cx - 150 + 150 * i, 265 + between(r, -15, 15))));
  s += `<path d="M${n(cx - 200)} 395 q25 -22 50 0 t50 0 t50 0 t50 0 t50 0 t50 0 t50 0 t50 0" ${chalk.replace('opacity=".9"', `opacity=".7"`)}/>`;
  s += `<rect x="${n(cx + 120)}" y="434" width="40" height="14" rx="6" fill="#fff" ${soft(p, 3)}/>`;
  s += apple(cx - between(r, 120, 170), 452, 0.62);
  // crayons on the floor in front of the easel
  const count = whole(r, 3, 5), left = r() < 0.5, x0 = left ? between(r, 40, 60) : between(r, 820, 835);
  for (let i = 0; i < count; i++) s += crayon(x0 + between(r, -6, 6), 640 - i * 26 - between(r, 0, 4), 170, 30, p.acc[i % p.acc.length], between(r, -6, 6));
  s += `<g transform="translate(${left ? n(between(r, 880, 920)) : n(between(r, 140, 180))} 560)">${star(0, 0, 50, pick(r, p.acc), between(r, 0, 1))}</g>`;
  return s;
};

/* ---------- Children's Day ---------- */

/** A toy building block (a cube seen from the front and top); (x, y) is the bottom-left corner. */
function block(x: number, y: number, s: number, fill: string, mark: string) {
  const d = s * 0.28;
  return `<path d="M${n(x)} ${n(y - s)} l${n(d)} ${n(-d)} h${n(s)} l${n(-d)} ${n(d)} z" fill="${fill}" ${OUTLINE}/>
<path d="M${n(x + s)} ${n(y)} v${n(-s)} l${n(d)} ${n(-d)} v${n(s)} z" fill="${fill}" ${OUTLINE}/>
<path d="M${n(x + s)} ${n(y)} v${n(-s)} l${n(d)} ${n(-d)} v${n(s)} z" fill="#000" opacity=".12"/>
<rect x="${n(x)}" y="${n(y - s)}" width="${n(s)}" height="${n(s)}" rx="6" fill="${fill}" ${OUTLINE}/>
<rect x="${n(x + s * 0.18)}" y="${n(y - s * 0.82)}" width="${n(s * 0.64)}" height="${n(s * 0.64)}" rx="8" fill="none" stroke="${mark}" stroke-width="6" opacity=".7"/>`;
}

/** A wheel; (x, y) is its middle. */
const wheel = (x: number, y: number, R: number, ink: string) =>
  `<circle cx="${n(x)}" cy="${n(y)}" r="${n(R)}" fill="${ink}" ${OUTLINE}/><circle cx="${n(x)}" cy="${n(y)}" r="${n(R * 0.38)}" fill="#ffc93c"/>`;

/** Children's Day A: a toy train carrying blocks, with balloons tied on and a kite above. */
const toyTrain: Design = (r, p) => {
  const cars = whole(r, 2, 3), carW = 170, gap = 26, engW = 230;
  const total = engW + cars * (carW + gap), x0 = 540 - total / 2 + between(r, -30, 30), base = 600;
  const cols = [...p.acc].sort(() => r() - 0.5);
  let s = `<path d="M40 640 H1040" stroke="${p.ink}" stroke-width="8" stroke-linecap="round" opacity=".25"/>`;
  for (let x = 60; x < 1040; x += 60) s += `<rect x="${x}" y="634" width="30" height="12" rx="4" fill="${WOOD}" opacity=".6"/>`;
  // carriages behind (left), engine in front (right)
  let x = x0;
  const tops: number[] = [];
  for (let i = 0; i < cars; i++) {
    const c = cols[i % cols.length];
    s += `<rect x="${n(x + carW - 4)}" y="${base - 46}" width="${gap + 8}" height="12" rx="6" fill="${p.ink}"/>`;
    s += `<rect x="${n(x)}" y="${base - 120}" width="${carW}" height="110" rx="18" fill="${c}" ${OUTLINE}/><rect x="${n(x + 16)}" y="${base - 100}" width="${carW - 32}" height="18" rx="9" fill="#fff" opacity=".45"/>`;
    s += wheel(x + 42, base + 6, 30, p.ink) + wheel(x + carW - 42, base + 6, 30, p.ink);
    const kind = (i + whole(r, 0, 2)) % 3;
    if (kind === 0) s += block(x + 22, base - 120, 62, cols[(i + 2) % 5], '#fff') + block(x + 92, base - 120, 52, cols[(i + 3) % 5], '#fff');
    else if (kind === 1) s += `<circle cx="${n(x + 60)}" cy="${base - 160}" r="40" fill="${cols[(i + 2) % 5]}" ${OUTLINE}/><path d="M${n(x + 22)} ${base - 160} h76" stroke="#fff" stroke-width="8"/>` + block(x + 104, base - 120, 50, cols[(i + 3) % 5], '#fff');
    else s += star(x + carW / 2, base - 170, 52, '#ffc93c', between(r, -0.3, 0.3));
    tops.push(x + carW / 2);
    x += carW + gap;
  }
  const ec = cols[cars % cols.length], ex = x;
  s += `<rect x="${n(ex)}" y="${base - 120}" width="${engW - 40}" height="110" rx="18" fill="${ec}" ${OUTLINE}/>
<rect x="${n(ex)}" y="${base - 240}" width="110" height="140" rx="18" fill="${cols[(cars + 1) % 5]}" ${OUTLINE}/>
<rect x="${n(ex + 22)}" y="${base - 214}" width="66" height="54" rx="12" fill="#fff" ${soft(p, 4)}/>
<rect x="${n(ex - 10)}" y="${base - 262}" width="130" height="30" rx="12" fill="${p.ink}" ${OUTLINE}/>
<path d="M${n(ex + engW - 100)} ${base - 120} v-60 h-14 v-24 h56 v24 h-14 v60 z" fill="${p.ink}" ${OUTLINE}/>
<path d="M${n(ex + engW - 40)} ${base - 50} l40 40 h-40 z" fill="${p.ink}" ${OUTLINE}/>
<circle cx="${n(ex + engW - 52)}" cy="${base - 80}" r="16" fill="#ffc93c" ${OUTLINE}/>`;
  s += wheel(ex + 50, base - 4, 42, p.ink) + wheel(ex + engW - 84, base + 6, 30, p.ink);
  const sx = ex + engW - 72;
  s += `<circle cx="${n(sx + 20)}" cy="${base - 240}" r="24" fill="#fff" ${soft(p, 4)}/><circle cx="${n(sx + 60)}" cy="${base - 288}" r="32" fill="#fff" ${soft(p, 4)}/><circle cx="${n(sx + 110)}" cy="${base - 345}" r="40" fill="#fff" ${soft(p, 4)}/>`;
  // balloons tied to the last carriage
  const tie = tops[0], bc = whole(r, 2, 3);
  for (let i = 0; i < bc; i++) s += balloon(tie - 60 + i * 60 + between(r, -10, 10), base - 120 - 256 - 63 + between(r, -20, 0) - (i === 1 ? 40 : 0), cols[(i + 1) % 5], p.ink, r, 50);
  s += kite(between(r, 760, 880), between(r, 100, 140), 0.75, pick(r, p.acc), pick(r, p.acc), between(r, -15, 15));
  return s;
};

/** A red rose with a curled bud; (x, y) is the middle of the flower. */
function rose(x: number, y: number, R: number) {
  const red = '#e8283c', dark = '#b81d30';
  return `<path d="M${n(x)} ${n(y + R * 0.9)} V${n(y + R * 3.4)}" stroke="#fff" stroke-width="26" stroke-linecap="round"/>
<path d="M${n(x)} ${n(y + R * 0.9)} V${n(y + R * 3.4)}" stroke="#3f9b52" stroke-width="16" stroke-linecap="round"/>
${leaf(x, y + R * 2.1, R * 1.3, GREEN, -35)}${leaf(x, y + R * 2.7, R * 1.2, GREEN, -150)}
<path d="M${n(x - R * 0.7)} ${n(y + R * 0.6)} q${n(-R * 0.2)} ${n(R * 0.5)} ${n(R * 0.7)} ${n(R * 0.55)} q${n(R * 0.9)} ${n(-R * 0.05)} ${n(R * 0.7)} ${n(-R * 0.55)} z" fill="#3f9b52" ${OUTLINE}/>
<path d="M${n(x - R)} ${n(y - R * 0.1)} q${n(-R * 0.15)} ${n(R * 0.95)} ${n(R)} ${n(R)} q${n(R * 1.15)} ${n(-R * 0.05)} ${n(R)} ${n(-R)} q${n(-R * 0.5)} ${n(R * 0.25)} ${n(-R)} ${n(R * 0.1)} q${n(-R * 0.5)} ${n(R * 0.15)} ${n(-R)} ${n(-R * 0.1)} z" fill="${red}" ${OUTLINE}/>
<path d="M${n(x - R * 0.85)} ${n(y - R * 0.15)} q${n(R * 0.05)} ${n(-R * 0.75)} ${n(R * 0.85)} ${n(-R * 0.8)} q${n(R * 0.8)} ${n(R * 0.05)} ${n(R * 0.85)} ${n(R * 0.8)} q${n(-R * 0.45)} ${n(R * 0.35)} ${n(-R * 0.85)} ${n(R * 0.25)} q${n(-R * 0.4)} ${n(R * 0.1)} ${n(-R * 0.85)} ${n(-R * 0.25)} z" fill="${red}" ${OUTLINE}/>
<path d="M${n(x - R * 0.35)} ${n(y - R * 0.3)} q${n(R * 0.35)} ${n(-R * 0.4)} ${n(R * 0.6)} ${n(-R * 0.05)} q${n(R * 0.05)} ${n(R * 0.35)} ${n(-R * 0.35)} ${n(R * 0.3)}" fill="none" stroke="${dark}" stroke-width="${n(R * 0.09)}" stroke-linecap="round"/>
<path d="M${n(x - R * 0.6)} ${n(y + R * 0.15)} q${n(R * 0.6)} ${n(R * 0.45)} ${n(R * 1.2)} 0" fill="none" stroke="${dark}" stroke-width="${n(R * 0.08)}" stroke-linecap="round"/>`;
}

/** Children's Day B: a red rose among balloons and confetti, with building blocks on the floor. */
const roseBalloons: Design = (r, p) => {
  const cols = [...p.acc].sort(() => r() - 0.5), rx = between(r, 510, 570);
  let s = confetti(r, p.acc, 16, { x0: 40, x1: 360, y0: 20, y1: 420 }) + confetti(r, p.acc, 16, { x0: 720, x1: 1040, y0: 20, y1: 420 });
  const bl = whole(r, 1, 2), br = 3 - bl;
  for (let i = 0; i < bl; i++) s += balloon(between(r, 120, 160) + i * 110, between(r, 120, 170) + i * 50, cols[i], p.ink, r, 54);
  for (let i = 0; i < br; i++) s += balloon(between(r, 920, 960) - i * 110, between(r, 120, 170) + i * 50, cols[(i + 2) % 5], p.ink, r, 54);
  s += rose(rx, 200, 105);
  s += `<path d="M${n(rx - 60)} 470 q60 30 120 0 l-20 34 l20 30 q-60 -24 -120 0 l20 -30 z" fill="${pick(r, p.acc)}" ${OUTLINE}/>`;
  // blocks on the floor, a tower on one side and a pair on the other
  const left = r() < 0.5, tx = left ? between(r, 140, 190) : between(r, 820, 870), ox = left ? between(r, 780, 830) : between(r, 160, 210);
  const tower = whole(r, 2, 3);
  for (let i = 0; i < tower; i++) s += block(tx + between(r, -6, 6), 640 - i * 92, 90, cols[(i + 1) % 5], '#fff');
  s += block(ox, 640, 84, cols[3], '#fff') + block(ox + 104, 640, 84, cols[4], '#fff') + block(ox + 52 + between(r, -8, 8), 556, 78, cols[0], '#fff');
  for (let i = 0; i < 3; i++) s += sparkle(rx + (i - 1) * 190 + between(r, -20, 20), between(r, 70, 120) + (i === 1 ? -30 : 40), between(r, 14, 22), pick(r, p.acc));
  return s;
};

export const yogaDay: Design[] = [lotusPond, catStretch];
/** The heart and stethoscope, mirrored in alternate years (a picture with no writing, so it reads either way). */
const stethoHeartTurned: Design = (r, p) => {
  const art = stethoHeart(r, p);
  return r() < 0.5 ? art : `<g transform="translate(1080 0) scale(-1 1)">${art}</g>`;
};

export const doctorsDay: Design[] = [stethoHeartTurned, firstAid];
export const sportsDay: Design[] = [trophy, playground];
export const teachersDay: Design[] = [booksApple, chalkboard];
export const childrensDay: Design[] = [toyTrain, roseBalloons];
