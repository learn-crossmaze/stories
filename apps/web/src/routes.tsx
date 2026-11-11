import { lazy, Suspense, useEffect } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router';

import { useAuth } from './auth/AuthContext';
import { isStaff, staffHome } from './auth/claims';
import { env } from './config/env';
import { SetupPage } from './public/Setup';
import { SignInPage } from './public/SignIn';
import { authRedirect, paths } from './paths';
import { RouteError } from './shared/RouteError';
import { t } from './strings';

// The staff app (app.storiesforall.in). Members don't use it: their pages are the member area on the website
// (memberRoutes.tsx, served at storiesforall.in/account); anyone who isn't staff is sent there.
const AdminApp = lazy(() => import('./admin/AdminApp'));

/** Where a page of the old member app lives now: the same path inside the member area. */
export const memberAreaUrl = (path = '/') => `${env.memberUrl}${path === '/' ? '' : path}`;

/** Leaves the staff app for the member area (a full page load: it's another site). */
export function ToMemberArea({ path }: { path?: string }) {
  const { pathname } = useLocation();
  const target = memberAreaUrl(path ?? pathname);
  useEffect(() => {
    window.location.replace(target);
  }, [target]);
  return (
    <p className="loading">
      {t.toMemberArea} <a href={target}>{t.toMemberAreaLink}</a>
    </p>
  );
}

function AuthGate() {
  const { user, claims } = useAuth();
  const { pathname } = useLocation();
  // Wait for the first auth event (and its claims) before deciding.
  if (user === undefined) return <p className="loading">{t.loading}</p>;
  const target = authRedirect(user !== null, pathname, isStaff(claims) ? staffHome(claims) : null);
  return target ? <Navigate to={target} replace /> : <Outlet />;
}

/** Only staff reach the console; everyone else goes to the member area. The server enforces the real boundary. */
function StaffGate() {
  const { claims } = useAuth();
  if (!isStaff(claims)) return <ToMemberArea path="/" />;
  return (
    <Suspense fallback={<p className="loading">{t.loading}</p>}>
      <AdminApp />
    </Suspense>
  );
}

/** "/" and the old member addresses: staff go to their view, everyone else to the member area. */
function Home() {
  const { claims } = useAuth();
  const { pathname } = useLocation();
  if (isStaff(claims) && pathname === paths.home) return <Navigate to={staffHome(claims)} replace />;
  return <ToMemberArea />;
}

export const routes = [
  {
    element: <AuthGate />,
    // A page that fails to render or load (e.g. a chunk from before a deploy) shows this, not a blank screen.
    errorElement: <RouteError />,
    children: [
      { path: paths.signIn, element: <SignInPage /> },
      { path: paths.setup, element: <SetupPage /> },
      // One console with one menu for every staff page (one shell, so moving between sections keeps it).
      {
        element: <StaffGate />,
        children: [`${paths.admin}/*`, `${paths.web}/*`, `${paths.ops}/*`, `${paths.staff}/*`].map((path) => ({ path, element: null })),
      },
      { path: paths.home, element: <Home /> },
      ...[paths.explore, paths.myBooks, paths.membership, paths.profile, '/orders'].map((path) => ({ path, element: <Home /> })),
      { path: '*', element: <Navigate to={paths.home} replace /> },
    ],
  },
];
