import { lazy } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router';

import { useAuth } from './auth/AuthContext';
import { env } from './config/env';
import { MemberShell } from './member/MemberShell';
import { SignInPage } from './public/SignIn';
import { memberRedirect, paths } from './paths';
import { RouteError } from './shared/RouteError';
import { t } from './strings';

// The member area, built on its own (memberMain.tsx) and served by the website at /account (docs/SITE.md).
// Pages load on first visit; the staff console isn't part of this build.
const HomePage = lazy(() => import('./member/HomePage').then((m) => ({ default: m.HomePage })));
const ExplorePage = lazy(() => import('./member/ExplorePage').then((m) => ({ default: m.ExplorePage })));
const MyBooksPage = lazy(() => import('./member/MyBooksPage').then((m) => ({ default: m.MyBooksPage })));
const MembershipPage = lazy(() => import('./member/MembershipPage').then((m) => ({ default: m.MembershipPage })));
const ProfilePage = lazy(() => import('./member/ProfilePage').then((m) => ({ default: m.ProfilePage })));

/** Everyone in the member area is a reader: signed out → sign-in (then back to the page they asked for), signed in → their account. Staff may use it too. */
function MemberGate() {
  const { user } = useAuth();
  const { pathname, search } = useLocation();
  if (user === undefined) return <p className="loading">{t.loading}</p>;
  const target = memberRedirect(user !== null, pathname, search);
  return target ? <Navigate to={target} replace /> : <Outlet />;
}

export const memberRoutes = [
  {
    element: <MemberGate />,
    errorElement: <RouteError />,
    children: [
      { path: paths.signIn, element: <SignInPage staff={false} websiteUrl={env.memberUrl.replace(/\/account$/, '') || '/'} /> },
      {
        element: <MemberShell />,
        children: [
          { path: paths.home, element: <HomePage /> },
          { path: paths.explore, element: <ExplorePage /> },
          { path: paths.myBooks, element: <MyBooksPage /> },
          { path: paths.membership, element: <MembershipPage /> },
          { path: paths.profile, element: <ProfilePage /> },
        ],
      },
      { path: '*', element: <Navigate to={paths.home} replace /> },
    ],
  },
];
