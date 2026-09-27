import { Navigate, Outlet, useLocation } from 'react-router';

import { useAuth } from './auth/AuthContext';
import { MemberShell } from './pages/MemberShell';
import { ExplorePage, HomePage, MyBooksPage, OrdersPage, ProfilePage } from './pages/member';
import { SignInPage } from './pages/SignIn';
import { authRedirect, paths } from './paths';
import { t } from './strings';

function AuthGate() {
  const { user } = useAuth();
  const { pathname } = useLocation();
  // Wait for the first auth event before deciding.
  if (user === undefined) return <p className="loading">{t.loading}</p>;
  const target = authRedirect(user !== null, pathname);
  return target ? <Navigate to={target} replace /> : <Outlet />;
}

export const routes = [
  {
    element: <AuthGate />,
    children: [
      { path: paths.signIn, element: <SignInPage /> },
      {
        element: <MemberShell />,
        children: [
          { path: paths.home, element: <HomePage /> },
          { path: paths.explore, element: <ExplorePage /> },
          { path: paths.myBooks, element: <MyBooksPage /> },
          { path: paths.orders, element: <OrdersPage /> },
          { path: paths.profile, element: <ProfilePage /> },
        ],
      },
      { path: '*', element: <Navigate to={paths.home} replace /> },
    ],
  },
];
