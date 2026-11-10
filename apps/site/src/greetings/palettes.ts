// Card colours for each website theme (src/data/themes.ts), so a greeting card matches the site that day.
// Cards are pictures people save and share, so they keep these light colours in dark mode too.
import type { Palette, Rng } from './types';

export const palettes: Record<string, Palette> = {
  pastel: { bg: ['#eef0ff', '#fde9f3', '#e6f6ff'], ink: '#14307f', head: ['#14307f', '#5b3fc2'], acc: ['#ff7aa8', '#7b6cf6', '#4cb8f0', '#ffc94a', '#5cc98a'] },
  meadow: { bg: ['#eefae6', '#fff6d6', '#e3f5ff'], ink: '#1b5a2b', head: ['#1b5a2b', '#4f9a2f'], acc: ['#4caf50', '#ffb703', '#fb8500', '#219ebc', '#e5527a'] },
  ocean: { bg: ['#e2f6fb', '#e9f1ff', '#dff7ef'], ink: '#0a4f70', head: ['#0a4f70', '#1c8db5'], acc: ['#1ba3c6', '#ff8a65', '#ffd166', '#3fbf9f', '#5a7bf2'] },
  crayon: { bg: ['#fff4e0', '#ffe9e4', '#eaf3ff'], ink: '#7a1d14', head: ['#b8261a', '#e0631c'], acc: ['#e8382a', '#ffb300', '#2f7de1', '#2fa84f', '#8e44ad'] },
  calm: { bg: ['#f5f1e8', '#eef3e6', '#f7ece4'], ink: '#3b5537', head: ['#3b5537', '#8a6f4d'], acc: ['#8fb07a', '#e0a96d', '#c97b63', '#7aa6a1', '#d8b65a'] },
  candy: { bg: ['#ffe8f4', '#f3e8ff', '#e8fbff'], ink: '#7a0d5c', head: ['#7a0d5c', '#c2188f'], acc: ['#ff4fa3', '#9b5cff', '#3ad1e6', '#ffd23f', '#ff8c42'] },
  /** Stories' "Reading room" look: white with soft washes, teal and indigo. */
  library: { bg: ['#fff3ef', '#eefaf7', '#eeedff'], ink: '#1d2a5b', head: ['#0b6f78', '#2f55c9'], acc: ['#ffb4a2', '#12a4a6', '#b4b0f7', '#ffd166', '#9ad0ff'] },
  tropical: { bg: ['#e0faf3', '#fff3dc', '#e6f4ff'], ink: '#004d44', head: ['#00695c', '#ff6f3c'], acc: ['#00a896', '#ff6f3c', '#ffc93c', '#2ec4b6', '#e84a8a'] },
};

/** Quiet colours for solemn days (Good Friday), whatever the theme. */
export const solemnPalette: Palette = {
  bg: ['#f3f1f7', '#eef1f6', '#f6f3ee'],
  ink: '#3d3a5c',
  head: ['#3d3a5c', '#6b6496'],
  acc: ['#b9a7d6', '#e8d9a8', '#a9c2d6', '#d6c3b0', '#c9d6b4'],
};

export const paletteFor = (theme: string | undefined, solemn = false): Palette => (solemn ? solemnPalette : (palettes[theme ?? ''] ?? palettes.candy));

/** The same occasion and year always give the same numbers (FNV-1a seed, then mulberry32). */
export function rng(seedText: string): Rng {
  let h = 2166136261;
  for (const c of seedText) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const pick = <T>(r: Rng, list: readonly T[]): T => list[Math.floor(r() * list.length)];
export const between = (r: Rng, a: number, b: number) => a + r() * (b - a);
export const whole = (r: Rng, a: number, b: number) => Math.floor(between(r, a, b + 1));
