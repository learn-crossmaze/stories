import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { applyAppearance, DEFAULT_APPEARANCE, loadAppearance } from '../appearance';
import { AppearanceSettings } from '../AppearanceSettings';

const root = document.documentElement;

describe('appearance settings', () => {
  afterEach(() => {
    localStorage.clear();
    applyAppearance(DEFAULT_APPEARANCE);
  });

  it('applies choices straight away and remembers them', async () => {
    render(<AppearanceSettings />);
    await userEvent.click(screen.getByLabelText('Dark'));
    await userEvent.click(screen.getByLabelText('Teal'));
    await userEvent.click(screen.getByLabelText(/^Compact/));
    await userEvent.click(screen.getByLabelText('Larger'));
    expect(root.dataset.scheme).toBe('dark');
    expect(root.dataset.accent).toBe('teal');
    expect(root.dataset.density).toBe('compact');
    expect(root.style.getPropertyValue('--ui-scale')).toBe('1.25');
    expect(loadAppearance()).toMatchObject({ theme: 'dark', accent: 'teal', density: 'compact', textSize: 'larger' });

    await userEvent.click(screen.getByRole('button', { name: 'Reset to default' }));
    expect(loadAppearance()).toEqual(DEFAULT_APPEARANCE);
    expect(root.dataset.accent).toBe('terracotta');
  });

  it('falls back to the defaults for missing or broken saved settings', () => {
    localStorage.setItem('stories.appearance', '{not json');
    expect(loadAppearance()).toEqual(DEFAULT_APPEARANCE);
    localStorage.setItem('stories.appearance', JSON.stringify({ accent: 'neon', theme: 'light' }));
    expect(loadAppearance()).toEqual({ ...DEFAULT_APPEARANCE, theme: 'light' });
  });
});
