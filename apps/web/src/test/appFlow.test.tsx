import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';

import { AuthProvider } from '../auth/AuthContext';
import { AuthFailure } from '../auth/models';
import { routes } from '../routes';
import { authErrorMessage, t } from '../strings';
import { fakeAuth } from './fakeAuth';
import type { StoriesClaims } from '../auth/claims';

function renderApp(repo = fakeAuth(), path = '/') {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <AuthProvider repo={repo}>
      <RouterProvider router={router} />
    </AuthProvider>,
  );
  return { repo, router };
}

describe('app flow', () => {
  it('redirects to sign-in, signs in, then signs out', async () => {
    const user = userEvent.setup();
    const { router } = renderApp(fakeAuth(), '/orders');
    expect(await screen.findByRole('heading', { name: t.signInTitle })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/sign-in');

    await user.type(screen.getByLabelText(t.emailLabel), 'reader@example.com');
    await user.type(screen.getByLabelText(t.passwordLabel), 'correct-horse');
    await user.click(screen.getByRole('button', { name: t.signInButton }));

    expect(await screen.findByRole('heading', { name: t.greetingFallback })).toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: t.navProfile }));
    expect(screen.getByText(t.profileSignedInAs('reader@example.com'))).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: t.signOut }));
    expect(await screen.findByRole('heading', { name: t.signInTitle })).toBeInTheDocument();
  });

  it('creates an account and greets by first name', async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(await screen.findByRole('button', { name: t.createAccountButton }));
    await user.type(screen.getByLabelText(t.fullNameLabel), 'Asha Rao');
    await user.type(screen.getByLabelText(t.emailLabel), 'asha@example.com');
    await user.type(screen.getByLabelText(t.passwordLabel), 'long-enough');
    await user.click(screen.getByRole('button', { name: t.createAccountButton }));
    expect(await screen.findByRole('heading', { name: t.greeting('Asha') })).toBeInTheDocument();
  });

  it('validates fields and shows friendly auth errors', async () => {
    const user = userEvent.setup();
    const repo = fakeAuth();
    renderApp(repo);
    await user.click(await screen.findByRole('button', { name: t.signInButton }));
    expect(screen.getByText(t.validationEmail)).toBeInTheDocument();
    expect(screen.getByText(t.validationPassword)).toBeInTheDocument();

    repo.fail = new AuthFailure('invalidCredentials');
    await user.type(screen.getByLabelText(t.emailLabel), 'reader@example.com');
    await user.type(screen.getByLabelText(t.passwordLabel), 'wrong-password');
    await user.click(screen.getByRole('button', { name: t.signInButton }));
    expect(await screen.findByRole('alert')).toHaveTextContent(authErrorMessage.invalidCredentials);
  });

  it('shows the raw Firebase code for unexpected errors', async () => {
    const user = userEvent.setup();
    const repo = fakeAuth();
    repo.fail = AuthFailure.fromFirebaseCode('auth/internal-error');
    renderApp(repo);
    await user.type(await screen.findByLabelText(t.emailLabel), 'reader@example.com');
    await user.type(screen.getByLabelText(t.passwordLabel), 'long-enough');
    await user.click(screen.getByRole('button', { name: t.signInButton }));
    expect(await screen.findByRole('alert')).toHaveTextContent(`${authErrorMessage.unknown} (auth/internal-error)`);
  });

  it('keeps members out of the staff console', async () => {
    const { router } = renderApp(fakeAuth({ uid: 'm1', email: 'm@x.in', displayName: 'Mira', emailVerified: true }), '/admin/staff');
    expect(await screen.findByRole('heading', { name: t.greeting('Mira') })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/');
  });

  it('shows staff the console link in the member menu', async () => {
    const staff: StoriesClaims = { v: 1, sa: false, o: { corp: { r: ['LIB'], b: ['cen'] } } };
    renderApp(fakeAuth({ uid: 's1', email: 's@x.in', displayName: 'Sam', emailVerified: true }, staff), '/profile');
    expect(await screen.findByRole('link', { name: t.staffConsole })).toHaveAttribute('href', '/admin');
  });
});
