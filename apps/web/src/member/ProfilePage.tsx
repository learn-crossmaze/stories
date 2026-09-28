import { useEffect } from 'react';
import { Link, useLocation } from 'react-router';

import { AppearanceSettings } from '../shared/AppearanceSettings';
import { useAuth } from '../auth/AuthContext';
import { isStaff } from '../auth/claims';
import { type IdCardInfo, IdCardPanel } from '../shared/IdCard';
import { currentTerm, type Membership } from '../data/me';
import { day } from '../shared/format';
import { paths } from '../paths';
import { t } from '../strings';
import { useMemberData } from './memberData';
import { MemberSwitcher } from './common';

// Profile, ID card and appearance settings.
const cardInfo = (m: Membership): IdCardInfo => ({
  orgName: m.orgName,
  branchName: m.branch.name,
  branchPhone: m.branch.phone || null,
  fullName: m.member.fullName,
  code: m.member.code,
  validUntil: currentTerm(m) ? m.member.renewalDueAt : null,
  guardianName: m.member.guardian?.name ?? null,
});

export function ProfilePage() {
  const { user, repo, claims } = useAuth();
  const { current } = useMemberData();
  const { hash } = useLocation();
  // "Show my ID card" links here with #id-card: scroll to it once the membership has loaded.
  useEffect(() => {
    if (hash === '#id-card' && current) document.getElementById('id-card')?.scrollIntoView({ block: 'start' });
  }, [hash, current]);
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
      {current && (
        <section className="section" id="id-card">
          <MemberSwitcher />
          <h2>{t.idCardTitle}</h2>
          <p className="muted">{t.idCardIntro}</p>
          <IdCardPanel info={cardInfo(current)} />
        </section>
      )}
      {current && (
        <section className="section">
          <h2>{t.meMembershipDetails}</h2>
          <dl className="facts">
            <dt>{t.meName}</dt>
            <dd>{current.member.fullName}</dd>
            <dt>{t.meMemberCode}</dt>
            <dd className="mono">{current.member.code}</dd>
            <dt>{t.meDob}</dt>
            <dd>{day(new Date(current.member.dob))}</dd>
            <dt>{t.meMobile}</dt>
            <dd>{current.member.phone ?? '—'}</dd>
            <dt>{t.meEmail}</dt>
            <dd>{current.member.email ?? '—'}</dd>
            {current.member.guardian && (
              <>
                <dt>{t.meGuardian}</dt>
                <dd>
                  {current.member.guardian.name} ({current.member.guardian.relationship})
                </dd>
              </>
            )}
            <dt>{t.meLibrary}</dt>
            <dd>
              {current.orgName} · {current.branch.name}
              {current.branch.phone && <div className="muted small">{current.branch.phone}</div>}
              {current.branch.address && (
                <div className="muted small">
                  {[current.branch.address.line1, current.branch.address.city, current.branch.address.postalCode].filter(Boolean).join(', ')}
                </div>
              )}
            </dd>
            <dt>{t.meBorrowedSoFar}</dt>
            <dd>{t.meLifetime(current.member.lifetimeLoans, current.member.lifetimeExchanges)}</dd>
          </dl>
          <p className="muted small">{t.meChangeDetails}</p>
        </section>
      )}
      <section className="section">
        <h2>{t.navAppearance}</h2>
        <p className="muted">{t.apIntro}</p>
        <AppearanceSettings />
      </section>
    </>
  );
}
