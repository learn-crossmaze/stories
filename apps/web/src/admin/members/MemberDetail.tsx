import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';

import { useAuth } from '../../auth/AuthContext';
import { branchScope, can } from '../../auth/claims';
import { command } from '../../data/api';
import { memberSubscriptions } from '../../data/billing';
import { label, toDate } from '../../data/common';
import { getMember, wardsOf } from '../../data/members';
import type { Permission } from '../../generated/rbac';
import { useAsync } from '../../shared/useAsync';
import { paths } from '../../paths';
import { t } from '../../strings';
import { EmptyState, ErrorState, SkeletonRows, StatusBadge } from '../../shared/ui';
import { ConfirmWithReason, Dialog } from '../components/Dialog';
import { Notice, Tabs } from '../components/kit';
import { lt } from '../../strings/library';
import { IdCardPanel } from '../../shared/IdCard';
import { useWorkspace } from '../Workspace';
import { MemberDialog } from './Members';
import { MemberAudit, PaymentHistory, SubscriptionHistory } from './MemberHistory';
import { CurrentLoans, DepositCard, MemberReservations, PastLoans, subscriptionState, SubscriptionCard } from './memberCards';
import { AadhaarValue } from '../../shared/aadhaar';

type DialogKind = 'idCard' | 'edit' | 'suspend' | 'reactivate' | 'close';

export function MemberDetailPage() {
  const { memberId = '' } = useParams();
  const { claims } = useAuth();
  const { org, branchName, branches } = useWorkspace();
  const orgId = org?.id ?? '';
  const scope = org ? branchScope(claims, org.id) : 'ALL';
  const deps = [orgId, memberId, JSON.stringify(scope)];
  const member = useAsync(() => (orgId ? getMember(orgId, memberId) : Promise.resolve(null)), deps);
  const m = member.data;
  const b = m?.homeBranchId ?? '';
  // Subscriptions are read here: the subscription card, the ID card, reservations and the history all use them.
  const subs = useAsync(() => (orgId ? memberSubscriptions(orgId, memberId, scope) : Promise.resolve([])), deps);
  const wards = useAsync(() => (orgId && m && !m.isMinor ? wardsOf(orgId, b, memberId) : Promise.resolve([])), [...deps, b]);
  const [dialog, setDialog] = useState<DialogKind | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [tab, setTab] = useState<'overview' | 'history' | 'audit'>('overview');
  // Bumped after every change: the sections re-read their data in the background.
  const [reloadKey, setReloadKey] = useState(0);
  // Arriving from "Register member": the plan chooser opens by itself, once, for that member only
  // (this page stays mounted when a guardian or ward link leads to another member).
  const location = useLocation();
  const navigate = useNavigate();
  const fromRegister = (location.state as { subscribe?: unknown } | null)?.subscribe === true;
  const [autoSubscribeFor, setAutoSubscribeFor] = useState(() => (fromRegister ? memberId : null));
  useEffect(() => {
    // Forget it in the browser history too, so Reload, Back and Forward never open the chooser again.
    if (fromRegister) void navigate(location.pathname + location.search, { replace: true, state: null });
  }, [fromRegister, location.pathname, location.search, navigate]);

  if (member.loading) return <SkeletonRows rows={5} />;
  // A failed refresh keeps the page (and any open dialog); only a member we couldn't load at all gives way to the error.
  if (member.error && !m) return <ErrorState message={member.error} onRetry={member.reload} />;
  if (!m) return <EmptyState page icon="person" title={t.notFoundTitle} message="" />;

  const refresh = () => {
    member.reload();
    subs.reload();
    setReloadKey((k) => k + 1);
  };
  const perm = (p: Permission) => can(claims, p, orgId, b);
  const allSubs = subs.data ?? [];
  const { current } = subscriptionState(allSubs, m);

  return (
    <>
      <p className="breadcrumb">
        <Link to={paths.adminMembers}>{lt.membersTitle}</Link> / <span className="mono">{m.code}</span>
      </p>
      <header className="page-header page-header-row">
        <div>
          <h1>{m.fullName}</h1>
          <p className="muted">
            <span className="mono">{m.code}</span> · {label(m.audience)} · {m.phone ?? '—'} · {branchName(m.homeBranchId)}
          </p>
          {m.aadhaarLast4 && (
            <p className="muted">
              {lt.aadhaarShort}:{' '}
              <AadhaarValue
                last4={m.aadhaarLast4}
                reveal={perm('members.manage') ? () => command<{ aadhaar: string }>('members-revealAadhaar', { orgId, memberId: m.id }).then((r) => r.aadhaar) : undefined}
              />
            </p>
          )}
          {m.guardian && (
            <p>
              {lt.guardian}: <Link to={paths.adminMember(m.guardian.memberId)}>{m.guardian.name}</Link> ({m.guardian.relationship})
            </p>
          )}
          {!!wards.data?.length && (
            <p>
              {lt.wards}:{' '}
              {wards.data.map((w, i) => (
                <span key={w.id}>
                  {i > 0 && ', '}
                  <Link to={paths.adminMember(w.id)}>{w.fullName}</Link>
                </span>
              ))}
            </p>
          )}
        </div>
        <div className="row">
          <StatusBadge status={m.status} />
          {m.status !== 'CLOSED' && (
            <button type="button" className="btn btn-outlined" onClick={() => setDialog('idCard')}>
              {t.idCardTitle}
            </button>
          )}
          {perm('members.manage') && m.status !== 'CLOSED' && (
            <>
              <button type="button" className="btn btn-outlined" onClick={() => setDialog('edit')}>
                {t.edit}
              </button>
              {m.status === 'ACTIVE' ? (
                <button type="button" className="btn btn-text" onClick={() => setDialog('suspend')}>
                  {lt.suspend}
                </button>
              ) : (
                <button type="button" className="btn btn-text" onClick={() => setDialog('reactivate')}>
                  {lt.reactivate}
                </button>
              )}
              <button type="button" className="btn btn-text" onClick={() => setDialog('close')}>
                {lt.closeMembership}
              </button>
            </>
          )}
        </div>
      </header>
      {notice && <Notice tone="ok">{notice}</Notice>}
      {member.error && <Notice tone="error">{member.error}</Notice>}

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'overview' as const, label: lt.tabOverview },
          { value: 'history' as const, label: lt.tabHistory },
          ...(perm('audit.view') ? [{ value: 'audit' as const, label: lt.tabAudit }] : []),
        ]}
      />

      {tab === 'overview' && (
        <>
          <div className="panels">
            <SubscriptionCard
              orgId={orgId}
              m={m}
              subs={subs}
              perm={perm}
              canCollectOnline={!!branches.find((x) => x.id === b)?.payments?.razorpay?.enabled}
              onChanged={refresh}
              onNotice={setNotice}
              autoOpen={autoSubscribeFor === m.id}
              onAutoOpened={() => setAutoSubscribeFor(null)}
            />
            {perm('deposits.view') && <DepositCard orgId={orgId} memberId={m.id} scope={scope} perm={perm} reloadKey={reloadKey} onChanged={refresh} />}
          </div>
          <CurrentLoans orgId={orgId} memberId={m.id} scope={scope} reloadKey={reloadKey} onChanged={refresh} />
          <MemberReservations
            orgId={orgId}
            memberId={m.id}
            branchId={b}
            scope={scope}
            canPlace={perm('reservations.manage') && !!current}
            reloadKey={reloadKey}
            onChanged={refresh}
            onNotice={setNotice}
          />
        </>
      )}

      {tab === 'history' && (
        <>
          <section className="section">
            <h2>{lt.subscriptionHistory}</h2>
            <SubscriptionHistory subs={allSubs} loading={subs.loading} error={subs.data ? null : subs.error} onRetry={subs.reload} />
          </section>
          {perm('payments.view') && (
            <section className="section">
              <h2>{lt.paymentHistory}</h2>
              <PaymentHistory
                orgId={orgId}
                memberId={m.id}
                memberName={m.fullName}
                scope={scope}
                reloadKey={reloadKey}
                canRefund={perm('payments.refund')}
                onChanged={() => setReloadKey((k) => k + 1)}
              />
            </section>
          )}
          <section className="section">
            <h2>{lt.loanHistory}</h2>
            <PastLoans orgId={orgId} memberId={m.id} scope={scope} reloadKey={reloadKey} />
          </section>
        </>
      )}

      {tab === 'audit' && perm('audit.view') && (
        <section className="section">
          <MemberAudit orgId={orgId} memberId={m.id} scope={scope} branchName={branchName} reloadKey={reloadKey} />
        </section>
      )}

      {dialog === 'idCard' && (
        <Dialog title={t.idCardTitle} onClose={() => setDialog(null)} narrow>
          <IdCardPanel
            info={{
              orgName: org?.name ?? '',
              branchName: branchName(m.homeBranchId),
              branchPhone: branches.find((x) => x.id === m.homeBranchId)?.contact.phone ?? null,
              fullName: m.fullName,
              code: m.code,
              validUntil: current ? (toDate(current.endAt)?.toISOString() ?? null) : null,
              guardianName: m.guardian?.name ?? null,
            }}
          />
        </Dialog>
      )}
      {dialog === 'edit' && <MemberDialog orgId={orgId} branchId={b} member={m} onClose={() => setDialog(null)} onSaved={() => member.reload()} />}
      {(dialog === 'suspend' || dialog === 'reactivate' || dialog === 'close') && (
        <ConfirmWithReason
          title={lt.statusTitle(dialog === 'suspend' ? lt.suspend : dialog === 'reactivate' ? lt.reactivate : lt.closeMembership)}
          body=""
          confirmLabel={dialog === 'suspend' ? lt.suspend : dialog === 'reactivate' ? lt.reactivate : lt.closeMembership}
          onClose={() => setDialog(null)}
          onConfirm={async (reason) => {
            await command('members-setStatus', {
              orgId,
              memberId: m.id,
              status: dialog === 'suspend' ? 'SUSPENDED' : dialog === 'reactivate' ? 'ACTIVE' : 'CLOSED',
              reason,
            });
            member.reload();
            setDialog(null);
          }}
        />
      )}
    </>
  );
}
