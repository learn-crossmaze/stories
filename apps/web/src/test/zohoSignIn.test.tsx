import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../config/env', async (original) => {
  const mod = await original<typeof import('../config/env')>();
  return { ...mod, env: { ...mod.env, zohoSignIn: true } };
});

const { AuthProvider } = await import('../auth/AuthContext');
const { AuthFailure } = await import('../auth/models');
const { routes } = await import('../routes');
const { authErrorMessage, t } = await import('../strings');
const { fakeAuth } = await import('./fakeAuth');

function renderSignIn(repo = fakeAuth()) {
  render(
    <AuthProvider repo={repo}>
      <RouterProvider router={createMemoryRouter(routes, { initialEntries: ['/sign-in'] })} />
    </AuthProvider>,
  );
  return repo;
}

describe('Continue with Zoho Mail', () => {
  it('signs staff in with their Zoho account', async () => {
    const user = userEvent.setup();
    const repo = renderSignIn();
    const zoho = vi.spyOn(repo, 'signInWithZoho');
    await user.click(await screen.findByRole('button', { name: t.continueWithZoho }));
    expect(zoho).toHaveBeenCalledOnce();
  });

  it('explains how to link Zoho when the email already has an account', async () => {
    const user = userEvent.setup();
    const repo = fakeAuth();
    repo.fail = new AuthFailure('linkRequired', 'auth/account-exists-with-different-credential');
    renderSignIn(repo);
    await user.click(await screen.findByRole('button', { name: t.continueWithZoho }));
    expect(await screen.findByText(authErrorMessage.linkRequired)).toBeInTheDocument();
  });

  it('is not offered while creating an account', async () => {
    const user = userEvent.setup();
    renderSignIn();
    await user.click(await screen.findByRole('button', { name: t.createAccountButton }));
    expect(screen.queryByRole('button', { name: t.continueWithZoho })).not.toBeInTheDocument();
  });
});
