// The site's two looks (site.css): "candy" (pastel colour flow, the Crossmaze family style) and "library" (white
// with light gradients and library artwork). The head script applies the choice before the first paint; this
// wires the footer switch. The member area (/account, same site) reads the same saved choice.
export const THEMES = ['candy', 'library'] as const;
export type Theme = (typeof THEMES)[number];
export const THEME_KEY = 'stories.siteTheme';

export const currentTheme = (): Theme => (document.documentElement.dataset.theme === 'library' ? 'library' : 'candy');

export function setTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Private windows: the choice lasts for this page only.
  }
  syncSwitches();
}

export function syncSwitches(root: ParentNode = document) {
  root.querySelectorAll<HTMLButtonElement>('[data-set-theme]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.setTheme === currentTheme())));
}

export function wireThemeSwitch(root: ParentNode = document) {
  root.querySelectorAll<HTMLButtonElement>('[data-set-theme]').forEach((b) => b.addEventListener('click', () => setTheme(b.dataset.setTheme as Theme)));
  syncSwitches(root);
}
