import { useState } from 'react';

import { useAuth } from '../auth/AuthContext';
import { ApiError } from '../data/api';
import { addChild, joinLibrary, loadJoinOptions, type Membership } from '../data/me';
import { ErrorState, SkeletonRows } from '../shared/ui';
import { useAsync } from '../shared/useAsync';
import { t } from '../strings';
import { FormError, SelectField, TextField } from '../admin/components/Dialog';
import { useMemberData } from './memberData';
import { aadhaarError, cleanAadhaar } from '../shared/aadhaar';

// Self sign-up (me-join) and adding a child (me-addChild): members join a
// branch themselves, then choose and pay for a plan on the Membership page.

const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);
const ageOf = (dob: string) => {
  const d = new Date(`${dob}T00:00:00Z`);
  const now = new Date();
  let age = now.getUTCFullYear() - d.getUTCFullYear();
  if (now.getUTCMonth() < d.getUTCMonth() || (now.getUTCMonth() === d.getUTCMonth() && now.getUTCDate() < d.getUTCDate())) age--;
  return age;
};

/** Shown to a signed-in person with no membership: join a branch in one step. */
export function JoinMembership() {
  const { user } = useAuth();
  const { overview, select } = useMemberData();
  const options = useAsync(() => loadJoinOptions(), []);
  const [f, setF] = useState({ orgId: '', branchId: '', fullName: user?.displayName ?? '', dob: '', phone: '', aadhaar: '' });
  const set = (k: keyof typeof f) => (v: string) => setF((s) => ({ ...s, [k]: v }));
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (options.loading) return <SkeletonRows rows={3} />;
  if (options.error) return <ErrorState message={options.error} onRetry={options.reload} />;
  const orgs = options.data?.organizations ?? [];
  const orgId = f.orgId || (orgs.length === 1 ? orgs[0].orgId : '');
  const branches = orgs.find((o) => o.orgId === orgId)?.branches ?? [];
  const errors = {
    orgId: orgId ? undefined : t.required,
    branchId: f.branchId && branches.some((b) => b.id === f.branchId) ? undefined : t.meJoinPickBranch,
    fullName: f.fullName.trim().length >= 2 ? undefined : t.required,
    dob: !isDate(f.dob) ? t.required : ageOf(f.dob) < 18 ? t.meJoinAdultsOnly : undefined,
    phone: /^\+?[0-9 ]{10,16}$/.test(f.phone.trim()) ? undefined : t.meJoinPhone,
    aadhaar: aadhaarError(f.aadhaar) || undefined,
  };
  const e = (k: keyof typeof errors) => (touched ? errors[k] : undefined);
  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setTouched(true);
    if (Object.values(errors).some(Boolean) || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await joinLibrary({ orgId, branchId: f.branchId, fullName: f.fullName.trim(), dob: f.dob, phone: f.phone.trim(), aadhaar: cleanAadhaar(f.aadhaar) });
      select(res.memberId);
      overview.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.errorGeneric);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="section card join-card" aria-labelledby="join-h">
      <h2 id="join-h">{t.meJoinTitle}</h2>
      <p className="muted">{t.meJoinIntro}</p>
      {!orgs.length ? (
        <p className="muted">{t.meJoinNoBranches}</p>
      ) : (
        <form onSubmit={submit} noValidate>
          <div className="form-grid">
            {orgs.length > 1 && (
              <SelectField
                label={t.meJoinLibrary}
                value={orgId}
                onChange={(v) => setF((s) => ({ ...s, orgId: v, branchId: '' }))}
                error={e('orgId')}
                options={[{ value: '', label: '—' }, ...orgs.map((o) => ({ value: o.orgId, label: o.orgName }))]}
              />
            )}
            <SelectField
              label={t.meJoinBranch}
              value={f.branchId}
              onChange={set('branchId')}
              error={e('branchId')}
              hint={t.meJoinBranchHint}
              options={[{ value: '', label: '—' }, ...branches.map((b) => ({ value: b.id, label: b.city ? `${b.name} · ${b.city}` : b.name }))]}
            />
            <TextField label={t.meJoinName} value={f.fullName} onChange={set('fullName')} autoComplete="name" error={e('fullName')} />
            <TextField label={t.meJoinDob} type="date" value={f.dob} onChange={set('dob')} error={e('dob')} />
            <TextField label={t.meJoinMobile} type="tel" value={f.phone} onChange={set('phone')} autoComplete="tel" error={e('phone')} />
            <TextField label={t.meJoinAadhaar} value={f.aadhaar} onChange={set('aadhaar')} autoComplete="off" hint={t.meJoinAadhaarHint} error={e('aadhaar')} />
          </div>
          <p className="muted small">{t.meJoinEmailNote(user?.email ?? '')}</p>
          <FormError error={error} />
          <button type="submit" className="btn btn-filled" disabled={busy}>
            {busy ? t.saving : t.meJoinButton}
          </button>
        </form>
      )}
    </section>
  );
}

/** On the Membership page: a member adds their child, who then appears in the switcher with plans to buy. */
export function AddChild({ member }: { member: Membership }) {
  const { overview, select } = useMemberData();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ fullName: '', dob: '', relationship: '' });
  const set = (k: keyof typeof f) => (v: string) => setF((s) => ({ ...s, [k]: v }));
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!member.self || member.member.isMinor || member.member.status !== 'ACTIVE') return null;
  const errors = {
    fullName: f.fullName.trim().length >= 2 ? undefined : t.required,
    dob: !isDate(f.dob) ? t.required : ageOf(f.dob) >= 18 ? t.meChildTooOld : undefined,
    relationship: f.relationship.trim().length >= 2 ? undefined : t.required,
  };
  const e = (k: keyof typeof errors) => (touched ? errors[k] : undefined);
  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setTouched(true);
    if (Object.values(errors).some(Boolean) || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await addChild(member, { fullName: f.fullName.trim(), dob: f.dob, relationship: f.relationship.trim() });
      setOpen(false);
      select(res.memberId);
      overview.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.errorGeneric);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="section" aria-labelledby="child-h">
      <h2 id="child-h">{t.meChildTitle}</h2>
      {!open ? (
        <>
          <p className="muted">{t.meChildIntro}</p>
          <button type="button" className="btn btn-outlined" onClick={() => setOpen(true)}>
            {t.meChildAdd}
          </button>
        </>
      ) : (
        <form onSubmit={submit} noValidate>
          <div className="form-grid">
            <TextField label={t.meJoinName} value={f.fullName} onChange={set('fullName')} error={e('fullName')} />
            <TextField label={t.meJoinDob} type="date" value={f.dob} onChange={set('dob')} error={e('dob')} />
            <TextField label={t.meChildRelationship} hint={t.meChildRelationshipHint} value={f.relationship} onChange={set('relationship')} error={e('relationship')} />
          </div>
          <FormError error={error} />
          <div className="row">
            <button type="submit" className="btn btn-filled" disabled={busy}>
              {busy ? t.saving : t.meChildAdd}
            </button>
            <button type="button" className="btn btn-text" onClick={() => setOpen(false)} disabled={busy}>
              {t.cancel}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
