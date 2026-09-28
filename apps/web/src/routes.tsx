import { lazy, Suspense } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router';

import { useAuth } from './auth/AuthContext';
import { isStaff } from './auth/claims';
import { MemberShell } from './pages/MemberShell';
import { ExplorePage, HomePage, MembershipPage, MyBooksPage, ProfilePage } from './pages/member';
import { SetupPage } from './pages/Setup';
import { SignInPage } from './pages/SignIn';
import { authRedirect, paths } from './paths';
import { t } from './strings';

// Staff code loads only for staff (keeps the member bundle small).
const AdminApp = lazy(() => import('./admin/AdminApp'));

function AuthGate() {
  const { user, claims } = useAuth();
  const { pathname } = useLocation();
  // Wait for the first auth event (and its claims) before deciding.
  if (user === undefined) return <p className="loading">{t.loading}</p>;
  const target = authRedirect(user !== null, pathname, isStaff(claims));
  return target ? <Navigate to={target} replace /> : <Outlet />;
}

/** Only staff reach the console; members are sent home. The server enforces the real boundary. */
function StaffGate() {
  const { claims } = useAuth();
  if (!isStaff(claims)) return <Navigate to={paths.home} replace />;
  return (
    <Suspense fallback={<p className="loading">{t.loading}</p>}>
      <AdminApp />
    </Suspense>
  );
}

export const routes = [
  {
    element: <AuthGate />,
    children: [
      { path: paths.signIn, element: <SignInPage /> },
      { path: paths.setup, element: <SetupPage /> },
      { path: `${paths.admin}/*`, element: <StaffGate /> },
      {
        element: <MemberShell />,
        children: [
          { path: paths.home, element: <HomePage /> },
          { path: paths.explore, element: <ExplorePage /> },
          { path: paths.myBooks, element: <MyBooksPage /> },
          { path: paths.membership, element: <MembershipPage /> },
          { path: '/orders', element: <Navigate to={paths.membership} replace /> },
          { path: paths.profile, element: <ProfilePage /> },
        ],
      },
      { path: '*', element: <Navigate to={paths.home} replace /> },
    ],
  },
];
