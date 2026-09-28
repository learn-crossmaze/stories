import { useEffect, useState } from 'react';

/**
 * Personal appearance settings (each person, remembered in this browser).
 * Applied as data-* attributes on <html>; styles.css maps them to tokens.
 * index.html applies the saved choice before the first paint (no flash) with the same rules.
 */
export interface Appearance {
  theme: 'system' | 'light' | 'dark';
  accent: Accent;
  textSize: 'default' | 'large' | 'larger';
  density: 'comfortable' | 'compact';
  corners: 'rounded' | 'square';
  contrast: 'default' | 'more';
  motion: 'system' | 'reduce';
}

export const ACCENTS = {
  terracotta: { label: 'Terracotta', light: '#b4502b', dark: '#f0b49a' },
  teal: { label: 'Teal', light: '#0f766e', dark: '#5eead4' },
  indigo: { label: 'Indigo', light: '#4338ca', dark: '#a5b4fc' },
  forest: { label: 'Forest', light: '#2e7d32', dark: '#a5d6a7' },
  plum: { label: 'Plum', light: '#8e3a8a', dark: '#e8a6e0' },
  slate: { label: 'Slate', light: '#475569', dark: '#cbd5e1' },
} as const;
export type Accent = keyof typeof ACCENTS;

export const DEFAULT_APPEARANCE: Appearance = {
  theme: 'system',
  accent: 'terracotta',
  textSize: 'default',
  density: 'comfortable',
  corners: 'rounded',
  contrast: 'default',
  motion: 'system',
};

const KEY = 'stories.appearance';
const TEXT_SCALE: Record<Appearance['textSize'], string> = {
  default: '1',
  large: '1.125',
  larger: '1.25',
};
const darkQuery = () => (typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: dark)') : null);

export function loadAppearance(): Appearance {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Appearance>;
    const merged = { ...DEFAULT_APPEARANCE, ...saved };
    return merged.accent in ACCENTS ? merged : { ...merged, accent: DEFAULT_APPEARANCE.accent };
  } catch {
    return DEFAULT_APPEARANCE;
  }
}

function save(a: Appearance) {
  try {
    localStorage.setItem(KEY, JSON.stringify(a));
  } catch {
    /* storage unavailable: the choice lasts for this visit only */
  }
}

export function applyAppearance(a: Appearance, root: HTMLElement = document.documentElement) {
  const scheme = a.theme === 'system' ? (darkQuery()?.matches ? 'dark' : 'light') : a.theme;
  root.dataset.scheme = scheme;
  root.dataset.accent = a.accent;
  root.dataset.density = a.density;
  root.dataset.corners = a.corners;
  root.dataset.contrast = a.contrast;
  root.dataset.motion = a.motion;
  root.style.setProperty('--ui-scale', TEXT_SCALE[a.textSize]);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', ACCENTS[a.accent][scheme]);
}

/** Current settings plus a setter that saves and applies them (main.tsx follows the system theme). */
export function useAppearance() {
  const [appearance, setAppearance] = useState(loadAppearance);
  useEffect(() => applyAppearance(appearance), [appearance]);
  const update = (next: Appearance) => {
    save(next);
    setAppearance(next);
  };
  return [appearance, update] as const;
}
