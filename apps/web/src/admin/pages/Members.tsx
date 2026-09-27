import { useState } from 'react';
import { Link, useNavigate } from 'react-router';

import { useAuth } from '../../auth/AuthContext';
import { can } from '../../auth/claims';
import { command } from '../../data/api';
import { label, type Member, searchMembers } from '../../data/library';
import { useAsync } from '../../data/useAsync';
import { useDebounced } from '../../data/useDebounced';
import { paths } from '../../paths';
import { t } from '../../strings';
import { EmptyState, ErrorState, Icon, SkeletonRows, StatusBadge } from '../../ui';
import { Dialog, DialogActions, FormError, TextField, useSubmit } from '../Dialog';
import { NeedBranch } from '../kit';
import { lt } from '../libraryStrings';
import { useWorkspace } from '../Workspace';

const age = (dob: string) => {
  const d = new Date(dob);
  const n = new Date();
  let a = n.getFullYear() - d.getFullYear();
  if (n.getMonth() < d.getMonth() || (n.getMonth() === d.getMonth() && n.getDate() < d.getDate())) a--;
  return a;
};

/** Search-as-you-type picker for a member at the current branch. */
export function MemberPicker({ orgId, branchId, onPick, adultsOnly, label: text }: { orgId: string; branchId: string; onPick: (m: Member) => void; adultsOnly?: boolean; label: string }) {
  const [q, setQ] = useState('');
  const debounced = useDebounced(q);
  const results = useAsync(() => (debounced.trim().length >= 2 ? searchMembers(orgId, branchId, debounced) : Promise.resolve([])), [orgId, branchId, debounced]);
  const list = (results.data ?? []).filter((m) => (!adultsOnly || !m.isMinor) && m.status !== 'CLOSED');
  return (
    <div className="field picker">
      <label>
        {text}
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={lt.searchMembers} />
      </label>
      {list.length > 0 && (
        <ul className="picker-list">
          {list.map((m) => (
            <li key={m.id}>
              <button type="button" onClick={() => onPick(m)}>
                <strong>{m.fullName}</strong> <span className="mono small">{m.code}</span> <span className="muted small">{m.phone ?? ''}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function MemberDialog({ orgId, branchId, member, onClose, onSaved }: { orgId: string; branchId: string; member?: Member; onClose: () => void; onSaved: (id: string) => void }) {
  const [f, setF] = useState({
    fullName: member?.fullName ?? '',
    dob: member?.dob ?? '',
    phone: member?.phone?.replace('+91', '') ?? '',
    email: member?.email ?? '',
    relationship: member?.guardian?.relationship ?? '',
  });
  const [guardian, setGuardian] = useState<{ id: string; name: string } | null>(member?.guardian ? { id: member.guardian.memberId, name: member.guardian.name } : null);
  const [touched, setTouched] = useState(false);
  const set = (k: keyof typeof f) => (v: string) => setF((s) => ({ ...s, [k]: v }));
  const minor = /^\d{4}-\d{2}-\d{2}$/.test(f.dob) && age(f.dob) < 18;
  const errors = {
    fullName: f.fullName.trim().length >= 2 ? undefined : t.required,
    dob: /^\d{4}-\d{2}-\d{2}$/.test(f.dob) && new Date(f.dob) < new Date() ? undefined : 'Enter the date of birth.',
    phone: !f.phone.trim() ? (minor ? undefined : lt.mobileHint) : /^[+\d\s-]{10,16}$/.test(f.phone.trim()) ? undefined : 'Enter a valid mobile number.',
    guardian: minor && !guardian ? lt.guardianHint : undefined,
  };
  const { busy, error, submit } = useSubmit(async () => {
    setTouched(true);
    if (Object.values(errors).some(Boolean)) return;
    const body = {
      orgId, fullName: f.fullName.trim(), dob: f.dob, phone: f.phone.trim(), email: f.email.trim(),
      guardianMemberId: minor ? guardian!.id : null, guardianRelationship: minor ? f.relationship.trim() : '',
    };
    const res = member
      ? await command<{ memberId: string }>('members-update', { ...body, memberId: member.id })
      : await command<{ memberId: string }>('members-register', { ...body, homeBranchId: branchId });
    onSaved(res.memberId);
    onClose();
  });
  const err = (k: keyof typeof errors) => (touched ? errors[k] : undefined);
  return (
    <Dialog title={member ? t.edit : lt.registerMember} onClose={onClose}>
      <form onSubmit={submit} noValidate className="form-grid">
        <div className="span-2">
          <TextField label={lt.fullName} value={f.fullName} onChange={set('fullName')} error={err('fullName')} autoComplete="off" />
        </div>
        <TextField label={lt.dob} type="date" value={f.dob} onChange={set('dob')} error={err('dob')} />
        <TextField label={lt.mobile} type="tel" value={f.phone} onChange={set('phone')} hint={minor ? undefined : lt.mobileHint} error={err('phone')} />
        <div className="span-2">
          <TextField label={lt.email} type="email" value={f.email} onChange={set('email')} />
        </div>
        {minor && (
          <div className="span-2 guardian-box">
            {guardian ? (
              <p>
                {lt.guardian}: <strong>{guardian.name}</strong>{' '}
                <button type="button" className="btn btn-text" onClick={() => setGuardian(null)}>
                  {t.edit}
                </button>
              </p>
            ) : (
              <MemberPicker orgId={orgId} branchId={branchId} adultsOnly label={lt.guardian} onPick={(m) => setGuardian({ id: m.id, name: m.fullName })} />
            )}
            {touched && errors.guardian && <span className="field-error">{errors.guardian}</span>}
            <TextField label={lt.relationship} value={f.relationship} onChange={set('relationship')} hint="e.g. Mother, Father, Guardian" />
          </div>
        )}
        <div className="span-2">
          <FormError error={error} />
          <DialogActions busy={busy} submitLabel={member ? t.save : lt.registerMember} onCancel={onClose} />
        </div>
      </form>
    </Dialog>
  );
}

function BranchMembers({ orgId, branchId }: { orgId: string; branchId: string }) {
  const { claims } = useAuth();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const debounced = useDebounced(q);
  const [registering, setRegistering] = useState(false);
  const results = useAsync(() => (debounced.trim().length >= 2 ? searchMembers(orgId, branchId, debounced) : Promise.resolve(null)), [orgId, branchId, debounced]);
  const manage = can(claims, 'members.manage', orgId, branchId);
  return (
    <>
      <div className="toolbar">
        <input className="search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={lt.searchMembers} aria-label={lt.searchMembers} autoFocus />
        {manage && (
          <button type="button" className="btn btn-filled" onClick={() => setRegistering(true)}>
            <Icon name="plus" /> {lt.registerMember}
          </button>
        )}
      </div>
      {results.data === null ? (
        <p className="muted">{lt.membersHint}</p>
      ) : results.loading ? (
        <SkeletonRows rows={3} />
      ) : results.error ? (
        <ErrorState message={results.error} onRetry={results.reload} />
      ) : !results.data?.length ? (
        <EmptyState icon="person" title={lt.membersEmpty} message="" />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{lt.fullName}</th>
                <th scope="col">{lt.memberSince}</th>
                <th scope="col">{lt.mobile}</th>
                <th scope="col">{lt.ageGroup}</th>
                <th scope="col">{lt.books}</th>
                <th scope="col">{lt.status}</th>
              </tr>
            </thead>
            <tbody>
              {results.data.map((m) => (
                <tr key={m.id}>
                  <td>
                    <Link to={paths.adminMember(m.id)}>{m.fullName}</Link>
                    {m.guardian && <div className="muted small">{lt.guardian}: {m.guardian.name}</div>}
                  </td>
                  <td className="mono">{m.code}</td>
                  <td className="nowrap">{m.phone ?? '—'}</td>
                  <td>{label(m.audience)}</td>
                  <td>{m.activeLoanCount}</td>
                  <td>
                    <StatusBadge status={m.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {registering && <MemberDialog orgId={orgId} branchId={branchId} onClose={() => setRegistering(false)} onSaved={(id) => navigate(paths.adminMember(id))} />}
    </>
  );
}

export function MembersPage() {
  const { org } = useWorkspace();
  return (
    <>
      <header className="page-header">
        <h1>{lt.membersTitle}</h1>
      </header>
      <NeedBranch>{(branchId) => org && <BranchMembers orgId={org.id} branchId={branchId} />}</NeedBranch>
    </>
  );
}
