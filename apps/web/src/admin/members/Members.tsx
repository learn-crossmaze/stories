import type { DocumentSnapshot } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';

import { useAuth } from '../../auth/AuthContext';
import { can } from '../../auth/claims';
import { command } from '../../data/api';
import { AGE_GROUPS, label } from '../../data/common';
import { indexMemberList, listMembers, type Member, memberCounts, type MemberFilters, RENEWAL_DUE_DAYS, type RenewalFilter, renewalState, searchMembers } from '../../data/members';
import { useAsync } from '../../shared/useAsync';
import { useDebounced } from '../../shared/useDebounced';
import { day, relativeDays } from '../../shared/format';
import { paths } from '../../paths';
import { t } from '../../strings';
import { EmptyState, ErrorState, Icon, SkeletonRows, StatusBadge, TableWrap } from '../../shared/ui';
import { Dialog, DialogActions, FormError, TextField, useSubmit } from '../components/Dialog';
import { NeedBranch } from '../components/kit';
import { lt } from '../../strings/library';
import { useWorkspace } from '../Workspace';
import { aadhaarError, aadhaarHint, cleanAadhaar } from '../../shared/aadhaar';

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
    aadhaar: '',
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
    aadhaar: aadhaarError(f.aadhaar) || undefined,
  };
  const { busy, error, submit } = useSubmit(async () => {
    setTouched(true);
    if (Object.values(errors).some(Boolean)) return;
    const body = {
      orgId, fullName: f.fullName.trim(), dob: f.dob, phone: f.phone.trim(), email: f.email.trim(),
      guardianMemberId: minor ? guardian!.id : null, guardianRelationship: minor ? f.relationship.trim() : '',
      // Keep what is on file: the address (entered at sign-up) and, when left empty, the Aadhaar number.
      address: member?.address ?? null,
      aadhaar: cleanAadhaar(f.aadhaar),
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
        <div className="span-2">
          <TextField label={lt.aadhaar} value={f.aadhaar} onChange={set('aadhaar')} autoComplete="off" hint={aadhaarHint(member?.aadhaarLast4)} error={f.aadhaar ? errors.aadhaar : err('aadhaar')} />
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

const RENEWAL_FILTERS: RenewalFilter[] = ['ACTIVE', 'DUE', 'EXPIRED', 'NONE'];
const RENEWAL_TONE: Record<Exclude<RenewalFilter, ''>, string> = { ACTIVE: 'ok', DUE: 'warn', EXPIRED: 'danger', NONE: 'muted' };

/** Plan and renewal date, with how soon it is (text, never colour alone). */
function RenewalCell({ m }: { m: Member }) {
  const state = renewalState(m);
  if (state === 'NONE') return <span className="muted">{lt.noSubscription}</span>;
  return (
    <>
      <span className="nowrap">{day(m.renewalDueAt)}</span>
      <div>
        <span className={`badge badge-${RENEWAL_TONE[state]} nowrap`}>{state === 'EXPIRED' ? lt.expiredAgo(relativeDays(m.renewalDueAt)) : relativeDays(m.renewalDueAt)}</span>
      </div>
    </>
  );
}

function BranchMembers({ orgId, branchId }: { orgId: string; branchId: string }) {
  const { claims } = useAuth();
  const navigate = useNavigate();
  const { branch } = useWorkspace();
  const [q, setQ] = useState('');
  const debounced = useDebounced(q);
  // The dashboard links here with ?renewal=DUE (etc.).
  const [params] = useSearchParams();
  const [filters, setFilters] = useState<MemberFilters>(() => ({ status: '', audience: '', renewal: RENEWAL_FILTERS.find((r) => r === params.get('renewal')) ?? '' }));
  const [registering, setRegistering] = useState(false);
  const [rows, setRows] = useState<Member[]>([]);
  const [cursor, setCursor] = useState<DocumentSnapshot | undefined>();
  const [state, setState] = useState<{ loading: boolean; error: string | null }>({ loading: true, error: null });
  const [attempt, setAttempt] = useState(0);
  // Older branches get plan and renewal dates filled in once, before the first listing.
  const [indexed, setIndexed] = useState(false);
  const manage = can(claims, 'members.manage', orgId, branchId);
  const searching = debounced.trim().length >= 2;
  const set = <K extends keyof MemberFilters>(k: K) => (v: MemberFilters[K]) => setFilters((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    let live = true;
    setIndexed(false);
    (branch?.id === branchId && branch.memberListIndexedAt ? Promise.resolve() : indexMemberList(orgId, branchId))
      .catch((e) => console.warn('member list index', e))
      .finally(() => live && setIndexed(true));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, branchId]);

  const counts = useAsync(() => (indexed ? memberCounts(orgId, branchId) : Promise.resolve(null)), [orgId, branchId, indexed, attempt]);

  const load = async (after?: DocumentSnapshot) => {
    setState({ loading: true, error: null });
    try {
      if (searching) {
        // Search matches name, code or mobile; the filters then narrow those matches.
        const found = (await searchMembers(orgId, branchId, debounced)).filter(
          (m) =>
            (!filters.status || m.status === filters.status) &&
            (!filters.audience || m.audience === filters.audience) &&
            (!filters.renewal || renewalState(m) === filters.renewal || (filters.renewal === 'ACTIVE' && renewalState(m) === 'DUE')),
        );
        setRows(found);
        setCursor(undefined);
      } else {
        const p = await listMembers(orgId, branchId, filters, after);
        setRows((prev) => (after ? [...prev, ...p.items] : p.items));
        setCursor(p.cursor);
      }
      setState({ loading: false, error: null });
    } catch (e) {
      console.error(e);
      setState({ loading: false, error: t.errorLoad });
    }
  };
  useEffect(() => {
    if (indexed) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, branchId, indexed, debounced, filters, attempt]);

  const c = counts.data;
  const chips: { key: RenewalFilter; label: string; n: number | undefined }[] = [
    { key: '', label: lt.allMembers, n: c?.ALL },
    { key: 'ACTIVE', label: lt.subActive, n: c?.ACTIVE },
    { key: 'DUE', label: lt.subDue(RENEWAL_DUE_DAYS), n: c?.DUE },
    { key: 'EXPIRED', label: lt.subExpired, n: c?.EXPIRED },
    { key: 'NONE', label: lt.subNone, n: c?.NONE },
  ];
  const filtered = !!(filters.status || filters.audience || filters.renewal || searching);

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
      <div className="filter-chips" role="group" aria-label={lt.subscription}>
        {chips.map((chip) => (
          <button key={chip.key || 'all'} type="button" className="chip" aria-pressed={filters.renewal === chip.key} onClick={() => set('renewal')(chip.key)}>
            {chip.label}
            {chip.n !== undefined && <span className="chip-count">{chip.n}</span>}
          </button>
        ))}
      </div>
      <div className="toolbar">
        <select value={filters.status} onChange={(e) => set('status')(e.target.value as MemberFilters['status'])} aria-label={lt.status}>
          <option value="">{lt.allStatuses}</option>
          {(['ACTIVE', 'SUSPENDED', 'CLOSED'] as const).map((st) => (
            <option key={st} value={st}>
              {label(st)}
            </option>
          ))}
        </select>
        <select value={filters.audience} onChange={(e) => set('audience')(e.target.value as MemberFilters['audience'])} aria-label={lt.ageGroup}>
          <option value="">{lt.allAges}</option>
          {AGE_GROUPS.map((a) => (
            <option key={a} value={a}>
              {label(a)}
            </option>
          ))}
        </select>
        {filtered && (
          <button
            type="button"
            className="btn btn-text"
            onClick={() => {
              setQ('');
              setFilters({ status: '', audience: '', renewal: '' });
            }}
          >
            {lt.clearFilters}
          </button>
        )}
      </div>
      {state.error && rows.length === 0 ? (
        <ErrorState message={state.error} onRetry={() => setAttempt((n) => n + 1)} />
      ) : (!indexed || state.loading) && rows.length === 0 ? (
        <SkeletonRows rows={6} />
      ) : rows.length === 0 ? (
        <EmptyState icon="person" title={filtered ? lt.membersEmpty : lt.membersNone} message="" />
      ) : (
        <>
          <TableWrap>
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">{lt.fullName}</th>
                  <th scope="col">{lt.memberSince}</th>
                  <th scope="col">{lt.mobile}</th>
                  <th scope="col">{lt.plan}</th>
                  <th scope="col">{lt.renewalDate}</th>
                  <th scope="col">{lt.books}</th>
                  <th scope="col">{lt.status}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((m) => (
                  <tr key={m.id}>
                    <td>
                      <Link to={paths.adminMember(m.id)}>{m.fullName}</Link>
                      <div className="muted small">
                        {label(m.audience)}
                        {m.guardian && ` · ${lt.guardian}: ${m.guardian.name}`}
                      </div>
                    </td>
                    <td className="mono">{m.code}</td>
                    <td className="nowrap">{m.phone ?? '—'}</td>
                    <td>{m.planName ?? '—'}</td>
                    <td>
                      <RenewalCell m={m} />
                    </td>
                    <td>{m.activeLoanCount}</td>
                    <td>
                      <StatusBadge status={m.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
          {cursor && (
            <button type="button" className="btn btn-outlined load-more" disabled={state.loading} onClick={() => load(cursor)}>
              {state.loading ? t.loading : t.loadMore}
            </button>
          )}
        </>
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
