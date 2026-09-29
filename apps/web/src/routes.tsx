import { lazy, Suspense } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router';

import { useAuth } from './auth/AuthContext';
import { homeViewFor, isStaff, type ViewId } from './auth/claims';
import { MemberShell } from './member/MemberShell';
import { SetupPage } from './public/Setup';
import { SignInPage } from './public/SignIn';
import { authRedirect, paths, viewHome } from './paths';
import { t } from './strings';

// Staff code loads only for staff (keeps the member bundle small).
const AdminApp = lazy(() => import('./admin/AdminApp'));
// Member pages load on first visit.
const HomePage = lazy(() => import('./member/HomePage').then((m) => ({ default: m.HomePage })));
const ExplorePage = lazy(() => import('./member/ExplorePage').then((m) => ({ default: m.ExplorePage })));
const MyBooksPage = lazy(() => import('./member/MyBooksPage').then((m) => ({ default: m.MyBooksPage })));
const MembershipPage = lazy(() => import('./member/MembershipPage').then((m) => ({ default: m.MembershipPage })));
const ProfilePage = lazy(() => import('./member/ProfilePage').then((m) => ({ default: m.ProfilePage })));

function AuthGate() {
  const { user, claims } = useAuth();
  const { pathname } = useLocation();
  // Wait for the first auth event (and its claims) before deciding.
  if (user === undefined) return <p className="loading">{t.loading}</p>;
  const target = authRedirect(user !== null, pathname, isStaff(claims) ? viewHome[homeViewFor(claims)] : null);
  return target ? <Navigate to={target} replace /> : <Outlet />;
}

/** Only staff reach the console views; members are sent home. The server enforces the real boundary. */
function StaffGate({ view }: { view: ViewId }) {
  const { claims } = useAuth();
  if (!isStaff(claims)) return <Navigate to={paths.home} replace />;
  return (
    <Suspense fallback={<p className="loading">{t.loading}</p>}>
      <AdminApp view={view} />
    </Suspense>
  );
}

export const routes = [
  {
    element: <AuthGate />,
    children: [
      { path: paths.signIn, element: <SignInPage /> },
      { path: paths.setup, element: <SetupPage /> },
      { path: `${paths.admin}/*`, element: <StaffGate view="admin" /> },
      { path: `${paths.ops}/*`, element: <StaffGate view="ops" /> },
      { path: `${paths.staff}/*`, element: <StaffGate view="staff" /> },
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
