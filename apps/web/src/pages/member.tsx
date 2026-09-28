import { Link } from 'react-router';

import { AppearanceSettings } from '../AppearanceSettings';
import { useAuth } from '../auth/AuthContext';
import { isStaff } from '../auth/claims';
import { paths } from '../paths';
import { t } from '../strings';
import { EmptyState } from '../ui';

// Member pages. Until the library modules ship, each page states truthfully
// that there is nothing to show — no simulated books, loans or orders.

export function HomePage() {
  const { user } = useAuth();
  const name = user?.displayName?.split(' ')[0];
  return (
    <>
      <header className="page-header">
        <h1>{name ? t.greeting(name) : t.greetingFallback}</h1>
        <p className="tagline">{t.tagline}</p>
      </header>
      <EmptyState icon="card" title={t.noMembershipTitle} message={t.noMembershipMessage} />
    </>
  );
}

function EmptyPage(props: { title: string; icon: Parameters<typeof EmptyState>[0]['icon']; emptyTitle: string; emptyMessage: string }) {
  return (
    <>
      <header className="page-header">
        <h1>{props.title}</h1>
      </header>
      <EmptyState icon={props.icon} title={props.emptyTitle} message={props.emptyMessage} />
    </>
  );
}

export const ExplorePage = () => (
  <EmptyPage title={t.navExplore} icon="explore" emptyTitle={t.exploreEmptyTitle} emptyMessage={t.exploreEmptyMessage} />
);
export const MyBooksPage = () => (
  <EmptyPage title={t.navMyBooks} icon="book" emptyTitle={t.myBooksEmptyTitle} emptyMessage={t.myBooksEmptyMessage} />
);
export const OrdersPage = () => (
  <EmptyPage title={t.navOrders} icon="truck" emptyTitle={t.ordersEmptyTitle} emptyMessage={t.ordersEmptyMessage} />
);

export function ProfilePage() {
  const { user, repo, claims } = useAuth();
  return (
    <>
      <header className="page-header">
        <h1>{t.navProfile}</h1>
      </header>
      <section className="profile">
        {user?.displayName && <h2>{user.displayName}</h2>}
        {user?.email && <p className="muted">{t.profileSignedInAs(user.email)}</p>}
        {isStaff(claims) && (
          <Link to={paths.admin} className="btn btn-filled">
            {t.staffConsole}
          </Link>
        )}
        <button type="button" className="btn btn-outlined" onClick={() => repo.signOut()}>
          {t.signOut}
        </button>
      </section>
      <section className="section">
        <h2>{t.navAppearance}</h2>
        <p className="muted">{t.apIntro}</p>
        <AppearanceSettings />
      </section>
    </>
  );
}
