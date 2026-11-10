import { beforeEach, describe, expect, it } from 'vitest';

import { currentTheme, setTheme, THEME_KEY, wireThemeSwitch } from '../theme';

beforeEach(() => {
  localStorage.clear();
  document.documentElement.dataset.theme = 'candy';
  document.body.innerHTML = '<button data-set-theme="candy">Candy</button><button data-set-theme="library">Reading room</button>';
});

describe('website look', () => {
  it('switches between Candy and Reading room, remembers it and marks the pressed button', () => {
    wireThemeSwitch();
    const [candy, library] = [...document.querySelectorAll<HTMLButtonElement>('[data-set-theme]')];
    expect(candy.getAttribute('aria-pressed')).toBe('true');
    library.click();
    expect(currentTheme()).toBe('library');
    expect(document.documentElement.dataset.theme).toBe('library');
    expect(localStorage.getItem(THEME_KEY)).toBe('library');
    expect(library.getAttribute('aria-pressed')).toBe('true');
    expect(candy.getAttribute('aria-pressed')).toBe('false');
    setTheme('candy');
    expect(currentTheme()).toBe('candy');
  });
});
