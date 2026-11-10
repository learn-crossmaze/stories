// Small drawings the card designs are made of. Each returns SVG markup; sizes are in the illustration's
// 1080 × 680 units. A white outline (OUTLINE) gives every piece the site's sticker-like doodle look.
import { between, pick } from './palettes';
import type { Rng } from './types';

/** Rounds numbers so the markup stays small. */
export const n = (v: number) => Math.round(v * 10) / 10;
export const OUTLINE = 'stroke="#fff" stroke-width="5" stroke-linejoin="round"';

/** A five-pointed star. */
export function star(cx: number, cy: number, R: number, fill: string, rot = 0) {
  let p = '';
  for (let i = 0; i < 10; i++) {
    const a = rot + (Math.PI / 5) * i - Math.PI / 2;
    const rad = i % 2 ? R * 0.45 : R;
    p += `${n(cx + rad * Math.cos(a))},${n(cy + rad * Math.sin(a))} `;
  }
  return `<polygon points="${p.trim()}" fill="${fill}" stroke="#fff" stroke-width="4" stroke-linejoin="round"/>`;
}

/** A four-pointed twinkle. */
export const sparkle = (x: number, y: number, s: number, fill: string) =>
  `<path d="M${n(x)} ${n(y - s)} Q${n(x)} ${n(y)} ${n(x + s)} ${n(y)} Q${n(x)} ${n(y)} ${n(x)} ${n(y + s)} Q${n(x)} ${n(y)} ${n(x - s)} ${n(y)} Q${n(x)} ${n(y)} ${n(x)} ${n(y - s)} Z" fill="${fill}"/>`;

/** Dots and little strips of paper scattered over the whole area. */
export function confetti(r: Rng, colours: string[], count: number, area = { x0: 20, x1: 1060, y0: 10, y1: 640 }) {
  let s = '';
  for (let i = 0; i < count; i++) {
    const x = between(r, area.x0, area.x1), y = between(r, area.y0, area.y1), c = pick(r, colours);
    s += r() < 0.5
      ? `<rect x="${n(x)}" y="${n(y)}" width="16" height="8" rx="2" fill="${c}" transform="rotate(${n(between(r, 0, 180))} ${n(x)} ${n(y)})"/>`
      : `<circle cx="${n(x)}" cy="${n(y)}" r="6" fill="${c}"/>`;
  }
  return s;
}

/** Soft dots (snow, or glowing specks on a dark-free card). */
export function dots(r: Rng, count: number, fill = '#ffffff', rMin = 4, rMax = 11, area = { x0: 20, x1: 1060, y0: 10, y1: 640 }) {
  let s = '';
  for (let i = 0; i < count; i++)
    s += `<circle cx="${n(between(r, area.x0, area.x1))}" cy="${n(between(r, area.y0, area.y1))}" r="${n(between(r, rMin, rMax))}" fill="${fill}" opacity="${between(r, 0.55, 1).toFixed(2)}"/>`;
  return s;
}

/** A balloon with its string. */
export function balloon(x: number, y: number, fill: string, ink: string, r: Rng, rx = 62) {
  const ry = rx * 1.26;
  return `<path d="M${n(x)} ${n(y + ry + 16)} q${n(between(r, -40, 40))} 120 ${n(between(r, -20, 20))} 240" fill="none" stroke="${ink}" stroke-width="3" opacity=".45"/>
<ellipse cx="${n(x)}" cy="${n(y)}" rx="${n(rx)}" ry="${n(ry)}" fill="${fill}" ${OUTLINE}/>
<ellipse cx="${n(x - rx * 0.32)}" cy="${n(y - ry * 0.36)}" rx="${n(rx * 0.19)}" ry="${n(ry * 0.25)}" fill="#fff" opacity=".55"/>
<path d="M${n(x - 10)} ${n(y + ry + 6)} h20 l-10 -10 z" fill="${fill}"/>`;
}

/** A firework burst with a star in the middle. */
export function burst(x: number, y: number, R: number, colour: string, rays = 12, tip = true) {
  let s = '';
  for (let i = 0; i < rays; i++) {
    const a = (2 * Math.PI * i) / rays;
    s += `<line x1="${n(x + Math.cos(a) * R * 0.3)}" y1="${n(y + Math.sin(a) * R * 0.3)}" x2="${n(x + Math.cos(a) * R)}" y2="${n(y + Math.sin(a) * R)}" stroke="${colour}" stroke-width="7" stroke-linecap="round"/>`;
    if (tip) s += `<circle cx="${n(x + Math.cos(a) * (R + 14))}" cy="${n(y + Math.sin(a) * (R + 14))}" r="5" fill="${colour}"/>`;
  }
  return s;
}

/** A clay lamp (diya) with its flame; (x, y) is the middle of the bowl's rim. */
export const diya = (x: number, y: number, s = 1) =>
  `<path d="M${n(x - 58 * s)} ${n(y - 40 * s)} Q${n(x)} ${n(y + 40 * s)} ${n(x + 58 * s)} ${n(y - 40 * s)} Z" fill="#c75b2a" ${OUTLINE}/>
<path d="M${n(x)} ${n(y - 110 * s)} q${n(26 * s)} ${n(34 * s)} 0 ${n(66 * s)} q${n(-26 * s)} ${n(-32 * s)} 0 ${n(-66 * s)} z" fill="#ffb300"/>
<path d="M${n(x)} ${n(y - 88 * s)} q${n(12 * s)} ${n(18 * s)} 0 ${n(38 * s)} q${n(-12 * s)} ${n(-18 * s)} 0 ${n(-38 * s)} z" fill="#fff4c2"/>`;

/** A flower of rounded petals around a centre: rangoli, pookalam, marigold, a garden flower. */
export function flower(cx: number, cy: number, petals: number, len: number, width: number, colours: string[], centre: string, rot = 0, centreR = len * 0.3) {
  let s = '';
  for (let i = 0; i < petals; i++) {
    const a = rot + (2 * Math.PI * i) / petals;
    const x = cx + Math.cos(a) * (len / 2), y = cy + Math.sin(a) * (len / 2);
    s += `<ellipse cx="${n(x)}" cy="${n(y)}" rx="${n(len / 2)}" ry="${n(width / 2)}" transform="rotate(${n((a * 180) / Math.PI)} ${n(x)} ${n(y)})" fill="${colours[i % colours.length]}" ${OUTLINE}/>`;
  }
  return s + `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(centreR)}" fill="${centre}" ${OUTLINE}/>`;
}

/** A hanging paper lantern on its string. */
export function lantern(x: number, top: number, colour: string, ink: string) {
  return `<line x1="${n(x)}" y1="0" x2="${n(x)}" y2="${n(top + 60)}" stroke="${ink}" stroke-width="3" opacity=".45"/>
<path d="M${n(x - 55)} ${n(top + 60)} h110 l-28 160 h-54 z" fill="${colour}" ${OUTLINE}/>
<path d="M${n(x - 40)} ${n(top + 110)} h80 M${n(x - 33)} ${n(top + 160)} h66" stroke="#fff4c2" stroke-width="7" stroke-linecap="round"/>
<path d="M${n(x - 14)} ${n(top + 220)} v40 M${n(x)} ${n(top + 220)} v52 M${n(x + 14)} ${n(top + 220)} v40" stroke="${colour}" stroke-width="5" stroke-linecap="round"/>`;
}

/** A wrapped present with a bow; (x, y) is its top-left corner. */
export const gift = (x: number, y: number, w: number, h: number, body: string, ribbon = '#fff4c2') =>
  `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="10" fill="${body}" stroke="#fff" stroke-width="4"/>
<rect x="${n(x + w / 2 - 7)}" y="${n(y)}" width="14" height="${n(h)}" fill="${ribbon}"/>
<rect x="${n(x)}" y="${n(y + h * 0.3)}" width="${n(w)}" height="12" fill="${ribbon}"/>
<ellipse cx="${n(x + w / 2 - 16)}" cy="${n(y - 8)}" rx="18" ry="11" fill="none" stroke="${ribbon}" stroke-width="7"/>
<ellipse cx="${n(x + w / 2 + 16)}" cy="${n(y - 8)}" rx="18" ry="11" fill="none" stroke="${ribbon}" stroke-width="7"/>`;

/** A heart; (x, y) is its middle. */
export const heart = (x: number, y: number, s: number, fill: string) =>
  `<path d="M${n(x)} ${n(y + s * 0.9)} C${n(x - s * 1.6)} ${n(y - s * 0.1)} ${n(x - s * 0.9)} ${n(y - s * 1.3)} ${n(x)} ${n(y - s * 0.45)} C${n(x + s * 0.9)} ${n(y - s * 1.3)} ${n(x + s * 1.6)} ${n(y - s * 0.1)} ${n(x)} ${n(y + s * 0.9)} Z" fill="${fill}" ${OUTLINE}/>`;

/** A smiling sun with rays. */
export function sun(x: number, y: number, R: number, fill = '#ffc93c', face = true) {
  let s = '';
  for (let i = 0; i < 12; i++) {
    const a = (2 * Math.PI * i) / 12;
    s += `<line x1="${n(x + Math.cos(a) * R * 1.2)}" y1="${n(y + Math.sin(a) * R * 1.2)}" x2="${n(x + Math.cos(a) * R * 1.55)}" y2="${n(y + Math.sin(a) * R * 1.55)}" stroke="${fill}" stroke-width="10" stroke-linecap="round"/>`;
  }
  s += `<circle cx="${n(x)}" cy="${n(y)}" r="${n(R)}" fill="${fill}" ${OUTLINE}/>`;
  if (face)
    s += `<circle cx="${n(x - R * 0.3)}" cy="${n(y - R * 0.12)}" r="${n(R * 0.08)}" fill="#7a4a12"/><circle cx="${n(x + R * 0.3)}" cy="${n(y - R * 0.12)}" r="${n(R * 0.08)}" fill="#7a4a12"/>
<path d="M${n(x - R * 0.32)} ${n(y + R * 0.2)} q${n(R * 0.32)} ${n(R * 0.28)} ${n(R * 0.64)} 0" fill="none" stroke="#7a4a12" stroke-width="${n(R * 0.07)}" stroke-linecap="round"/>`;
  return s;
}

/** A puffy cloud; (x, y) is the middle of its base. */
export const cloud = (x: number, y: number, s: number, fill = '#ffffff') =>
  `<path d="M${n(x - 90 * s)} ${n(y)} a${n(40 * s)} ${n(40 * s)} 0 0 1 ${n(30 * s)} ${n(-62 * s)} a${n(52 * s)} ${n(52 * s)} 0 0 1 ${n(96 * s)} ${n(-18 * s)} a${n(42 * s)} ${n(42 * s)} 0 0 1 ${n(58 * s)} ${n(42 * s)} a${n(30 * s)} ${n(30 * s)} 0 0 1 ${n(-4 * s)} ${n(38 * s)} z" fill="${fill}" opacity=".95"/>`;

/** A leaf pointing up-right by `angle` degrees; (x, y) is its stem end. */
export const leaf = (x: number, y: number, len: number, fill: string, angle = -40) =>
  `<g transform="rotate(${n(angle)} ${n(x)} ${n(y)})"><path d="M${n(x)} ${n(y)} q${n(len * 0.5)} ${n(-len * 0.42)} ${n(len)} 0 q${n(-len * 0.5)} ${n(len * 0.42)} ${n(-len)} 0 z" fill="${fill}" ${OUTLINE}/><path d="M${n(x)} ${n(y)} h${n(len * 0.9)}" stroke="#fff" stroke-width="3" opacity=".7"/></g>`;

/** A diamond kite with a wavy tail; (x, y) is its middle. */
export function kite(x: number, y: number, s: number, fill: string, tail: string, tilt = 0) {
  return `<g transform="rotate(${n(tilt)} ${n(x)} ${n(y)})">
<path d="M${n(x)} ${n(y - 70 * s)} L${n(x + 52 * s)} ${n(y)} L${n(x)} ${n(y + 82 * s)} L${n(x - 52 * s)} ${n(y)} Z" fill="${fill}" ${OUTLINE}/>
<path d="M${n(x)} ${n(y - 70 * s)} V${n(y + 82 * s)} M${n(x - 52 * s)} ${n(y)} H${n(x + 52 * s)}" stroke="#fff" stroke-width="4" opacity=".8"/>
<path d="M${n(x)} ${n(y + 82 * s)} q${n(-30 * s)} ${n(30 * s)} 0 ${n(60 * s)} q${n(30 * s)} ${n(30 * s)} 0 ${n(60 * s)}" fill="none" stroke="${tail}" stroke-width="5" stroke-linecap="round"/>
<path d="M${n(x - 12 * s)} ${n(y + 112 * s)} l${n(24 * s)} ${n(-12 * s)} M${n(x - 12 * s)} ${n(y + 172 * s)} l${n(24 * s)} ${n(-12 * s)}" stroke="${tail}" stroke-width="10" stroke-linecap="round"/></g>`;
}

/**
 * India's flag, waving gently, on a pole; (x, y) is the top of the pole. Saffron, white and green bands with
 * the navy Ashoka Chakra of 24 spokes in the middle.
 */
export function indianFlag(x: number, y: number, s = 1) {
  const w = 180 * s, h = 120 * s, band = h / 3, cx = x + w / 2, cy = y + 12 * s + h / 2, R = band * 0.42;
  const wave = (yy: number) => `M${n(x)} ${n(yy)} q${n(w / 4)} ${n(-10 * s)} ${n(w / 2)} 0 t${n(w / 2)} 0`;
  let spokes = '';
  for (let i = 0; i < 24; i++) {
    const a = (2 * Math.PI * i) / 24;
    spokes += `M${n(cx)} ${n(cy)} L${n(cx + Math.cos(a) * R)} ${n(cy + Math.sin(a) * R)} `;
  }
  return `<line x1="${n(x)}" y1="${n(y)}" x2="${n(x)}" y2="${n(y + 330 * s)}" stroke="#8d6e63" stroke-width="${n(9 * s)}" stroke-linecap="round"/>
<g>
<path d="${wave(y + 12 * s)} v${n(band)} q${n(-w / 4)} ${n(-10 * s)} ${n(-w / 2)} 0 t${n(-w / 2)} 0 z" fill="#FF9933"/>
<path d="${wave(y + 12 * s + band)} v${n(band)} q${n(-w / 4)} ${n(-10 * s)} ${n(-w / 2)} 0 t${n(-w / 2)} 0 z" fill="#ffffff"/>
<path d="${wave(y + 12 * s + 2 * band)} v${n(band)} q${n(-w / 4)} ${n(-10 * s)} ${n(-w / 2)} 0 t${n(-w / 2)} 0 z" fill="#138808"/>
<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(R)}" fill="none" stroke="#000080" stroke-width="${n(2.4 * s)}"/>
<path d="${spokes.trim()}" stroke="#000080" stroke-width="${n(1.1 * s)}"/>
<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(R * 0.14)}" fill="#000080"/>
</g>
<circle cx="${n(x)}" cy="${n(y - 4 * s)}" r="${n(8 * s)}" fill="#ffc93c"/>`;
}

/** A string of small triangular flags (bunting) between two points, sagging in the middle. */
export function bunting(x1: number, y1: number, x2: number, y2: number, colours: string[], count = 9, sag = 60) {
  const mx = (x1 + x2) / 2, my = Math.max(y1, y2) + sag;
  let s = `<path d="M${n(x1)} ${n(y1)} Q${n(mx)} ${n(my + sag * 0.6)} ${n(x2)} ${n(y2)}" fill="none" stroke="#fff" stroke-width="4"/>`;
  for (let i = 1; i < count; i++) {
    const t = i / count;
    const x = (1 - t) * (1 - t) * x1 + 2 * (1 - t) * t * mx + t * t * x2;
    const y = (1 - t) * (1 - t) * y1 + 2 * (1 - t) * t * (my + sag * 0.6) + t * t * y2;
    s += `<path d="M${n(x - 22)} ${n(y)} h44 l-22 46 z" fill="${colours[i % colours.length]}" stroke="#fff" stroke-width="3" stroke-linejoin="round"/>`;
  }
  return s;
}

/** A row of grass tufts along the bottom edge. */
export function grass(r: Rng, colour: string, y = 650) {
  let s = '';
  for (let x = 20; x < 1070; x += between(r, 40, 70)) {
    const h = between(r, 22, 44);
    s += `<path d="M${n(x - 14)} ${n(y)} q${n(4)} ${n(-h)} ${n(14)} ${n(-h - 6)} q${n(-2)} ${n(h * 0.6)} ${n(4)} ${n(h + 6)} q${n(6)} ${n(-h * 0.8)} ${n(16)} ${n(-h * 0.9)} q${n(-6)} ${n(h * 0.5)} ${n(-2)} ${n(h * 0.9)} z" fill="${colour}"/>`;
  }
  return s;
}
