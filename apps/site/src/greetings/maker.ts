// The card maker: a new drawing for an occasion from its own symbols (src/greetings/kits), for the admin
// panel's "Try another". A seed picks one of several layouts (a centrepiece, a row on the ground, a ring, a
// scatter, a garland, an arch, a frame, a pattern, a pair), a background and the accents, then places the
// day's symbols, so every click gives a different card that still belongs to the day. The same seed always
// draws the same card, so a saved choice ("gen" in site.greetings.picks) looks the same on the website.
import { confetti, dots, grass, n, sparkle, star } from './motifs';
import { between, pick, whole } from './palettes';
import type { Palette, Rng } from './types';

/**
 * One of an occasion's symbols (a diya, a kite, a flag…), drawn in a 200 × 200 box centred on (0, 0): keep
 * everything inside x and y −95…95. The maker moves, sizes and tilts it. Use the palette for colours that
 * can follow the website's theme, and fixed colours where the symbol has its own (flags, a diya's flame).
 */
export type Piece = (r: Rng, p: Palette) => string;

/** The symbols the maker draws a card for one occasion with. */
export interface Kit {
  /** Big symbols that can carry the card on their own, in the middle. At least two. */
  hero: Piece[];
  /** Smaller symbols placed around, in rows, rings and scatters. At least four. */
  small: Piece[];
  /** Symbols that hang from a string (lanterns, bells, flags on a line); the garland layout uses them. */
  hang?: Piece[];
  /** Colours that belong to the day (the tricolour, Kannada red and yellow), for confetti and bunting. */
  colours?: string[];
  /** A solemn day: calm layouts and soft accents, no confetti or party bunting. */
  quiet?: boolean;
  /** A gentle day (Mahavir Jayanti, Gandhi Jayanti): any layout, but no confetti or party bunting. */
  calm?: boolean;
}

type Spot = { x: number; y: number; size: number; tilt?: number };

/** Draws a piece at a spot: (x, y) its middle, `size` the width of its box. */
const place = (svg: string, { x, y, size, tilt = 0 }: Spot) =>
  `<g transform="translate(${n(x)} ${n(y)})${tilt ? ` rotate(${n(tilt)})` : ''} scale(${n(size / 200)})">${svg}</g>`;

const draw = (r: Rng, p: Palette, list: Piece[]) => pick(r, list)(r, p);

/** Picks `count` different items from a list where it can (repeats once the list runs out). */
function several<T>(r: Rng, list: T[], count: number): T[] {
  const pool = [...list];
  const out: T[] = [];
  for (let i = 0; i < count; i++) {
    if (!pool.length) pool.push(...list);
    out.push(pool.splice(Math.floor(r() * pool.length), 1)[0]);
  }
  return out;
}

/** Spots for `count` pieces that don't overlap each other or the `taken` circles. */
function scatterSpots(r: Rng, count: number, sizes: [number, number], taken: { x: number; y: number; rad: number }[], area = { x0: 60, x1: 1020, y0: 50, y1: 610 }) {
  const spots: Spot[] = [];
  for (let tries = 0; spots.length < count && tries < 600; tries++) {
    const size = between(r, sizes[0], sizes[1]);
    const rad = size * 0.48;
    const x = between(r, area.x0 + rad, area.x1 - rad), y = between(r, area.y0 + rad, area.y1 - rad);
    if (taken.some((t) => Math.hypot(t.x - x, t.y - y) < t.rad + rad + 10)) continue;
    taken.push({ x, y, rad });
    spots.push({ x, y, size, tilt: between(r, -14, 14) });
  }
  return spots;
}

// ---------------------------------------------------------------- backgrounds

const backdrops: Record<string, (r: Rng, p: Palette, cx: number, cy: number) => string> = {
  none: () => '',
  rays: (r, _p, cx, cy) => {
    const count = 2 * whole(r, 7, 11);
    let s = '';
    for (let i = 0; i < count; i += 2) {
      const a1 = (2 * Math.PI * i) / count, a2 = (2 * Math.PI * (i + 1)) / count;
      s += `<path d="M${cx} ${cy} L${n(cx + Math.cos(a1) * 900)} ${n(cy + Math.sin(a1) * 900)} L${n(cx + Math.cos(a2) * 900)} ${n(cy + Math.sin(a2) * 900)} Z"/>`;
    }
    return `<g fill="#fff" opacity=".38">${s}</g>`;
  },
  rings: (r, _p, cx, cy) => {
    let s = '';
    const step = between(r, 46, 70);
    for (let rad = 150; rad < 700; rad += step) s += `<circle cx="${cx}" cy="${cy}" r="${n(rad)}"/>`;
    return `<g fill="none" stroke="#fff" stroke-width="${n(between(r, 6, 12))}" opacity=".5">${s}</g>`;
  },
  halo: (_r, _p, cx, cy) => `<circle cx="${cx}" cy="${cy}" r="250" fill="#fff" opacity=".55"/><circle cx="${cx}" cy="${cy}" r="300" fill="none" stroke="#fff" stroke-width="10" stroke-dasharray="2 26" stroke-linecap="round" opacity=".8"/>`,
  dotgrid: (r) => {
    let s = '';
    const gap = between(r, 50, 70);
    for (let y = 30; y < 650; y += gap) for (let x = 40 + ((y / gap) % 2) * (gap / 2); x < 1050; x += gap) s += `<circle cx="${n(x)}" cy="${n(y)}" r="5"/>`;
    return `<g fill="#fff" opacity=".7">${s}</g>`;
  },
};

// ---------------------------------------------------------------- accents

function accents(r: Rng, p: Palette, kit: Kit, busy: { x: number; y: number; rad: number }[]) {
  const colours = kit.colours ?? p.acc;
  let s = '';
  // Twinkles and stars in the gaps.
  const spots = scatterSpots(r, whole(r, 5, 9), [30, 56], busy, { x0: 40, x1: 1040, y0: 20, y1: 630 });
  for (const sp of spots)
    s += r() < 0.6 ? sparkle(sp.x, sp.y, sp.size * 0.45, r() < 0.5 ? '#fff' : pick(r, colours)) : kit.quiet ? '' : star(sp.x, sp.y, sp.size * 0.42, pick(r, colours), r());
  if (!kit.quiet && !kit.calm && r() < 0.55) {
    // Confetti only where nothing is drawn yet.
    const bits = confetti(r, colours, whole(r, 14, 26)).split('/>').filter(Boolean).map((b) => `${b}/>`);
    s += bits
      .filter((b) => {
        const m = /(?:x|cx)="([\d.]+)" (?:y|cy)="([\d.]+)"/.exec(b);
        return m && !busy.some((t) => Math.hypot(t.x - Number(m[1]), t.y - Number(m[2])) < t.rad + 8);
      })
      .join('');
  } else if (r() < 0.6) s += dots(r, whole(r, 10, 18), '#ffffff', 4, 9);
  return s;
}

// ---------------------------------------------------------------- layouts

type Layout = (r: Rng, p: Palette, kit: Kit) => { art: string; busy: { x: number; y: number; rad: number }[]; centre: [number, number] };

const at = (spot: Spot, rad = spot.size * 0.48) => ({ x: spot.x, y: spot.y, rad });

const layouts: Record<string, Layout> = {
  /** One big symbol in the middle, the same small ones in pairs on either side. */
  centre: (r, p, kit) => {
    const hero: Spot = { x: 540, y: 345, size: between(r, 430, 480) };
    let art = place(draw(r, p, kit.hero), hero);
    const busy = [at(hero)];
    const pairs = whole(r, 2, 3);
    const picks = several(r, kit.small, pairs);
    for (let i = 0; i < pairs; i++) {
      const size = between(r, 150, 190);
      const dx = 330 + i * 120 + between(r, -15, 15), y = pairs === 2 ? [230, 500][i] : [150, 350, 560][i];
      const svg = picks[i](r, p);
      for (const side of [-1, 1]) {
        const spot = { x: 540 + side * dx, y, size, tilt: side * between(r, 4, 12) };
        if (spot.x - size / 2 < 40 || spot.x + size / 2 > 1040) continue;
        art += place(svg, spot);
        busy.push(at(spot));
      }
    }
    return { art, busy, centre: [540, 345] };
  },
  /** Three symbols side by side on the ground, the middle one biggest. */
  row: (r, p, kit) => {
    const ground = 640;
    const mid = between(r, 400, 450), side = between(r, 270, 310);
    const pieces = [draw(r, p, kit.small), draw(r, p, kit.hero), draw(r, p, kit.small)];
    const spots: Spot[] = [
      { x: 540 - mid / 2 - side / 2 + between(r, 0, 20), y: ground - side / 2, size: side },
      { x: 540, y: ground - mid / 2, size: mid },
      { x: 540 + mid / 2 + side / 2 - between(r, 0, 20), y: ground - side / 2, size: side },
    ];
    let art = r() < 0.5 ? grass(r, pick(r, p.acc), 665) : '';
    spots.forEach((s, i) => (art += place(pieces[i], s)));
    return { art, busy: spots.map((s) => at(s)), centre: [540, ground - mid / 2] };
  },
  /** A symbol in the middle with small ones in a ring around it. */
  ring: (r, p, kit) => {
    const hero: Spot = { x: 540, y: 345, size: between(r, 330, 370) };
    let art = place(draw(r, p, kit.hero), hero);
    const busy = [at(hero)];
    const count = whole(r, 6, 8), rot = r() * Math.PI;
    const picks = several(r, kit.small, count);
    for (let i = 0; i < count; i++) {
      const a = rot + (2 * Math.PI * i) / count;
      const spot = { x: 540 + Math.cos(a) * 405, y: 345 + Math.sin(a) * 250, size: between(r, 130, 150), tilt: between(r, -10, 10) };
      art += place(picks[i](r, p), spot);
      busy.push(at(spot));
    }
    return { art, busy, centre: [540, 345] };
  },
  /** Many small symbols scattered over the card. */
  scatter: (r, p, kit) => {
    const busy: { x: number; y: number; rad: number }[] = [];
    const spots = scatterSpots(r, whole(r, 9, 12), [150, 230], busy, { x0: 40, x1: 1040, y0: 30, y1: 670 });
    let art = '';
    const all = [...kit.small, ...kit.small, ...kit.hero];
    for (const s of spots) art += place(draw(r, p, all), s);
    return { art, busy, centre: [540, 330] };
  },
  /** A string across the top with symbols hanging from it, and a big one below. */
  garland: (r, p, kit) => {
    const hangers = kit.hang?.length ? kit.hang : kit.small;
    const sag = between(r, 50, 110);
    const colours = kit.colours ?? p.acc;
    let art = `<path d="M20 30 Q540 ${n(30 + sag * 2)} 1060 30" fill="none" stroke="${p.ink}" stroke-width="4" opacity=".4"/>`;
    const count = whole(r, 5, 7);
    const busy: { x: number; y: number; rad: number }[] = [];
    const picks = several(r, hangers, count);
    for (let i = 0; i < count; i++) {
      const t = (i + 0.5) / count, x = 20 + t * 1040, y0 = 30 + 2 * t * (1 - t) * sag * 2;
      const drop = between(r, 30, 90) * (i % 2 ? 1 : 0.55), size = between(r, 120, 150);
      art += `<line x1="${n(x)}" y1="${n(y0)}" x2="${n(x)}" y2="${n(y0 + drop)}" stroke="${p.ink}" stroke-width="3" opacity=".4"/>`;
      if (!kit.quiet && !kit.calm && i < count - 1) art += `<path d="M${n(x + 520 / count - 20)} ${n(y0 + 8)} h40 l-20 40 z" fill="${pick(r, colours)}" stroke="#fff" stroke-width="3" stroke-linejoin="round"/>`;
      const spot = { x, y: y0 + drop + size / 2, size };
      art += place(picks[i](r, p), spot);
      busy.push(at(spot));
    }
    const hero: Spot = { x: 540 + between(r, -40, 40), y: 470, size: between(r, 340, 370) };
    art += place(draw(r, p, kit.hero), hero);
    busy.push(at(hero));
    return { art, busy, centre: [hero.x, hero.y] };
  },
  /** Small symbols in an arch over a big one. */
  arch: (r, p, kit) => {
    const hero: Spot = { x: 540, y: 470, size: between(r, 340, 380) };
    let art = place(draw(r, p, kit.hero), hero);
    const busy = [at(hero)];
    const count = whole(r, 6, 7);
    const picks = several(r, kit.small, count);
    for (let i = 0; i < count; i++) {
      const a = Math.PI + (Math.PI * (i + 0.5)) / count;
      const spot = { x: 540 + Math.cos(a) * 440, y: 600 + Math.sin(a) * 470, size: between(r, 130, 150), tilt: ((a * 180) / Math.PI + 270) * 0.3 };
      art += place(picks[i](r, p), spot);
      busy.push(at(spot));
    }
    return { art, busy, centre: [540, 470] };
  },
  /** A big symbol framed by small ones in the corners and at the sides. */
  frame: (r, p, kit) => {
    const hero: Spot = { x: 540, y: 345, size: between(r, 430, 470) };
    let art = place(draw(r, p, kit.hero), hero);
    const busy = [at(hero)];
    const corners: Spot[] = [
      { x: 140, y: 120, size: 190 },
      { x: 940, y: 120, size: 190 },
      { x: 140, y: 570, size: 190 },
      { x: 940, y: 570, size: 190 },
      { x: 190, y: 345, size: 130 },
      { x: 890, y: 345, size: 130 },
    ];
    const pair = several(r, kit.small, 3);
    corners.forEach((c, i) => {
      const spot = { ...c, size: c.size * between(r, 0.85, 1.1), tilt: between(r, -14, 14) };
      art += place(pair[Math.floor(i / 2) % 3](r, p), spot);
      busy.push(at(spot));
    });
    return { art, busy, centre: [540, 330] };
  },
  /** A soft pattern of small symbols, with a big one on a white circle in front. */
  pattern: (r, p, kit) => {
    const picks = several(r, kit.small, 3);
    let pattern = '';
    for (let row = 0; row < 4; row++)
      for (let col = 0; col < 7; col++) {
        const spot = { x: 80 + col * 155 + (row % 2) * 77, y: 70 + row * 180, size: 110, tilt: (row + col) % 2 ? 12 : -12 };
        pattern += place(picks[(row + col) % 3](r, p), spot);
      }
    const hero: Spot = { x: 540, y: 345, size: between(r, 380, 420) };
    const art = `<g opacity=".38">${pattern}</g><circle cx="540" cy="345" r="${n(hero.size * 0.6)}" fill="#fff" opacity=".85"/>${place(draw(r, p, kit.hero), hero)}`;
    return { art, busy: [{ x: 540, y: 345, rad: hero.size * 0.6 }, { x: 0, y: 0, rad: 2000 }], centre: [540, 345] };
  },
  /** Two different big symbols side by side. */
  pair: (r, p, kit) => {
    const [a, b] = several(r, kit.hero, 2);
    const left: Spot = { x: between(r, 290, 320), y: between(r, 330, 380), size: between(r, 380, 420), tilt: between(r, -6, 6) };
    const right: Spot = { x: between(r, 760, 790), y: between(r, 330, 380), size: between(r, 380, 420), tilt: between(r, -6, 6) };
    let art = place(a(r, p), left) + place(b(r, p), right);
    const busy = [at(left), at(right)];
    for (const s of scatterSpots(r, whole(r, 2, 4), [110, 140], busy)) art += place(draw(r, p, kit.small), s);
    return { art, busy, centre: [540, 345] };
  },
};

const backdropFor: Record<string, string[]> = {
  centre: ['rays', 'rings', 'halo', 'dotgrid', 'none'],
  row: ['rays', 'dotgrid', 'none'],
  ring: ['rings', 'halo', 'dotgrid', 'none'],
  scatter: ['none', 'dotgrid'],
  garland: ['halo', 'none', 'dotgrid'],
  arch: ['rays', 'halo', 'none'],
  frame: ['halo', 'rings', 'rays', 'none'],
  pattern: ['none'],
  pair: ['dotgrid', 'rays', 'none'],
};

/** The layouts a solemn day uses. */
const QUIET = ['centre', 'row', 'frame', 'arch'];

/** A new drawing for an occasion: the illustration area of a card (1080 × 680, like a Design). */
export function compose(kit: Kit, r: Rng, p: Palette): string {
  const names = kit.quiet ? QUIET : Object.keys(layouts);
  const name = pick(r, names);
  const backdropName = pick(r, kit.quiet ? ['halo', 'none', 'rays'] : backdropFor[name]);
  const { art, busy, centre } = layouts[name](r, p, kit);
  const back = backdrops[backdropName](r, p, centre[0], centre[1]);
  return back + art + accents(r, p, kit, busy);
}

/** The layout names, for tests and the gallery. */
export const layoutNames = Object.keys(layouts);
