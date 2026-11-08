import { useState } from 'react';
import { Link } from 'react-router';

import { useAuth } from '../../auth/AuthContext';
import { branchScope, can } from '../../auth/claims';
import { command } from '../../data/api';
import { memberSubscriptions } from '../../data/billing';
import { type Loan, memberLoans, memberReservations } from '../../data/circulation';
import { label, toDate } from '../../data/common';
import { type Copy, findCopy, listCopies } from '../../data/inventory';
import { getMember, type Member, searchMembers } from '../../data/members';
import { useAsync } from '../../shared/useAsync';
import { day, since } from '../../shared/format';
import { paths } from '../../paths';
import { t } from '../../strings';
import { EmptyState, SkeletonRows, StatusBadge } from '../../shared/ui';
import { useAction } from '../components/Dialog';
import { NeedBranch, Notice, ScanInput, Tabs } from '../components/kit';
import { reportError } from '../../shared/reportError';
import { lt } from '../../strings/library';
import { useWorkspace } from '../Workspace';
import { CopyStatusBadge } from '../inventory/Inventory';

type Msg = { tone: 'ok' | 'warn' | 'error'; text: string } | null;

function MemberDesk({ orgId, branchId }: { orgId: string; branchId: string }) {
  const { claims } = useAuth();
  const scope = branchScope(claims, orgId);
  const [member, setMember] = useState<Member | null>(null);
  const [matches, setMatches] = useState<Member[] | null>(null);
  const [returning, setReturning] = useState<string[]>([]);
  const [issuing, setIssuing] = useState<Copy[]>([]);
  const [msg, setMsg] = useState<Msg>(null);
  const action = useAction();
  const busy = action.busy;
  const [tick, setTick] = useState(0);
  const mid = member?.id ?? '';
  const loans = useAsync(() => (mid ? memberLoans(orgId, mid, scope, true) : Promise.resolve([] as Loan[])), [orgId, mid, tick]);
  const subs = useAsync(() => (mid ? memberSubscriptions(orgId, mid, scope) : Promise.resolve([])), [orgId, mid, tick]);
  const holds = useAsync(() => (mid ? memberReservations(orgId, mid, scope).then((r) => r.filter((x) => x.status === 'ALLOCATED')) : Promise.resolve([])), [orgId, mid, tick]);

  const current = (subs.data ?? []).find((s) => s.status === 'ACTIVE' && (toDate(s.startAt)?.getTime() ?? 0) <= Date.now() && (toDate(s.endAt)?.getTime() ?? 0) > Date.now());
  const max = current?.planSnapshot.maxSimultaneousBooks ?? 0;
  const active = loans.data ?? [];

  const lookup = async (q: string) => {
    setMsg(null);
    const found = await searchMembers(orgId, branchId, q);
    const exact = found.find((m) => m.code === q.trim().toUpperCase());
    if (exact || found.length === 1) pick(exact ?? found[0]);
    else setMatches(found);
    if (!found.length) setMsg({ tone: 'warn', text: lt.membersEmpty });
  };
  const pick = (m: Member) => {
    setMember(m);
    setMatches(null);
    setReturning([]);
    setIssuing([]);
    setMsg(null);
  };

  const scan = async (value: string) => {
    setMsg(null);
    const copy = await findCopy(orgId, branchId, value);
    if (!copy) return setMsg({ tone: 'warn', text: lt.copyNotFound });
    const loan = active.find((l) => l.copyId === copy.id);
    if (loan) {
      setReturning((r) => (r.includes(loan.id) ? r : [...r, loan.id]));
      return;
    }
    if (issuing.some((c) => c.id === copy.id)) return setMsg({ tone: 'warn', text: lt.alreadyStaged });
    if (copy.status === 'ISSUED') return setMsg({ tone: 'warn', text: lt.onLoanElsewhere });
    if (copy.status !== 'AVAILABLE' && copy.status !== 'RESERVED') return setMsg({ tone: 'warn', text: lt.notOnShelf(label(copy.status)) });
    setIssuing((list) => [...list, copy]);
  };

  const go = async () => {
    if (!member) return;
    const returnCodes = active.filter((l) => returning.includes(l.id)).map((l) => l.copyCode);
    const issueCodes = issuing.map((c) => c.barcode);
    setMsg(null);
    const done = await action.run(async () => {
      if (returnCodes.length && issueCodes.length) {
        await command('circulation-exchange', { orgId, branchId, memberId: member.id, returnBarcodes: returnCodes, issueBarcodes: issueCodes });
      } else if (issueCodes.length) {
        await command('circulation-issue', { orgId, branchId, memberId: member.id, barcodes: issueCodes });
      } else {
        await command('circulation-return', { orgId, branchId, barcodes: returnCodes });
      }
    });
    if (!done) return;
    setMsg({ tone: 'ok', text: lt.done });
    setReturning([]);
    setIssuing([]);
    setTick((n) => n + 1);
    // Refresh the member's counters (books held, holds). The books went out either way:
    // a failed refresh only leaves the old counters on screen.
    try {
      setMember((await getMember(orgId, member.id)) ?? member);
    } catch (e) {
      reportError(e, 'load', { what: 'member after desk action' });
    }
  };

  if (!member) {
    return (
      <section className="desk-find">
        <ScanInput label={lt.findMember} placeholder={lt.findMemberHint} onScan={lookup} />
        {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
        {matches && matches.length > 0 && (
          <ul className="picker-list">
            {matches.map((m) => (
              <li key={m.id}>
                <button type="button" onClick={() => pick(m)}>
                  <strong>{m.fullName}</strong> <span className="mono small">{m.code}</span> <span className="muted small">{m.phone ?? ''}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    );
  }

  const r = returning.length;
  const i = issuing.length;
  const heldAfter = active.length - r + i + (member.allocatedCount - issuing.filter((c) => c.status === 'RESERVED').length);
  const actionLabel = r && i ? lt.exchangeN(r, i) : i ? lt.issueN(i) : r ? lt.returnN(r) : lt.nothingStaged;
  const canAct = can(claims, r && i ? 'exchanges.process' : i ? 'loans.issue' : 'loans.return', orgId, branchId);

  return (
    <div className="desk">
      <section className="card desk-member">
        <div className="page-header-row">
          <div>
            <h2>
              <Link to={paths.adminMember(member.id)}>{member.fullName}</Link> <span className="mono small">{member.code}</span>
            </h2>
            {current ? (
              <p>
                {current.planSnapshot.name} · {lt.activeUntil(day(current.endAt))} ·{' '}
                <strong className={heldAfter > max ? 'neg' : ''}>{lt.held(heldAfter, max)}</strong>
              </p>
            ) : (
              <Notice tone="warn">
                {lt.cantBorrow}: {subs.loading ? t.loading : 'no active subscription — returns only.'}
              </Notice>
            )}
          </div>
          <div className="row">
            <StatusBadge status={member.status} />
            <button type="button" className="btn btn-text" onClick={() => setMember(null)}>
              {lt.changeMember}
            </button>
          </div>
        </div>
        {!!holds.data?.length && (
          <p className="small">
            {lt.holdsReady}: {holds.data.map((h) => `${h.bookTitle} (${h.allocatedCopyCode})`).join(', ')}
          </p>
        )}
      </section>

      <div className="desk-cols">
        <section className="card">
          <h3>{lt.currentBooks}</h3>
          {loans.loading ? (
            <SkeletonRows rows={2} />
          ) : !active.length ? (
            <p className="muted">{lt.noCurrentBooks}</p>
          ) : (
            <ul className="desk-list">
              {active.map((l) => (
                <li key={l.id}>
                  <label className="check">
                    <input type="checkbox" checked={returning.includes(l.id)} onChange={() => setReturning((x) => (x.includes(l.id) ? x.filter((y) => y !== l.id) : [...x, l.id]))} />
                    <span>
                      {l.bookTitle} <span className="mono small">{l.copyCode}</span>
                      <span className="muted small"> · {since(l.issuedAt)}</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="card">
          <h3>{lt.toIssue}</h3>
          <ScanInput label={lt.scanToIssue} onScan={scan} busy={busy} />
          {issuing.length > 0 && (
            <ul className="desk-list">
              {issuing.map((c) => (
                <li key={c.id}>
                  <span>
                    {c.bookTitle} <span className="mono small">{c.code}</span> {c.status === 'RESERVED' && <CopyStatusBadge status="RESERVED" />}
                  </span>
                  <button type="button" className="btn btn-text" onClick={() => setIssuing((x) => x.filter((y) => y.id !== c.id))}>
                    {t.cancel}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      {action.error && <Notice tone="error">{action.error}</Notice>}
      <div className="desk-actions">
        <button type="button" className="btn btn-filled btn-lg" disabled={busy || (!r && !i) || !canAct} onClick={go}>
          {busy ? t.saving : actionLabel}
        </button>
      </div>
    </div>
  );
}

function QuickReturn({ orgId, branchId }: { orgId: string; branchId: string }) {
  const [staged, setStaged] = useState<Copy[]>([]);
  const [msg, setMsg] = useState<Msg>(null);
  const action = useAction();
  return (
    <section className="card">
      <ScanInput
        label={lt.scanToReturn}
        busy={action.busy}
        onScan={async (v) => {
          setMsg(null);
          const c = await findCopy(orgId, branchId, v);
          if (!c) return setMsg({ tone: 'warn', text: lt.copyNotFound });
          if (c.status !== 'ISSUED') return setMsg({ tone: 'warn', text: `${c.code}: ${label(c.status)}` });
          setStaged((s) => (s.some((x) => x.id === c.id) ? s : [...s, c]));
        }}
      />
      {staged.length > 0 && (
        <ul className="desk-list">
          {staged.map((c) => (
            <li key={c.id}>
              {c.bookTitle} <span className="mono small">{c.code}</span>
            </li>
          ))}
        </ul>
      )}
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      {action.error && <Notice tone="error">{action.error}</Notice>}
      <button
        type="button"
        className="btn btn-filled"
        disabled={action.busy || !staged.length}
        onClick={() => {
          setMsg(null);
          void action.run(async () => {
            await command('circulation-return', { orgId, branchId, barcodes: staged.map((c) => c.barcode) });
            setMsg({ tone: 'ok', text: lt.returned(staged.length) });
            setStaged([]);
          });
        }}
      >
        {lt.returnN(staged.length)}
      </button>
    </section>
  );
}

function Inspection({ orgId, branchId }: { orgId: string; branchId: string }) {
  const queue = useAsync(() => listCopies(orgId, branchId, 'UNDER_INSPECTION').then((p) => p.items), [orgId, branchId]);
  const action = useAction();
  const decide = (c: Copy, outcome: 'PASS' | 'DAMAGED') =>
    action.run(async () => {
      await command('copies-inspect', { orgId, copyId: c.id, outcome, condition: outcome === 'PASS' ? c.condition : 'POOR' });
      queue.reload();
    }, c.id);
  if (queue.loading) return <SkeletonRows rows={3} />;
  if (!queue.data?.length) return <EmptyState icon="check" title={lt.noInspections} message="" />;
  return (
    <>
      {action.error && <Notice tone="error">{action.error}</Notice>}
      <ul className="plain-list">
        {queue.data.map((c) => (
          <li key={c.id}>
            <span>
              <Link to={paths.adminCopy(c.id)} className="mono">
                {c.code}
              </Link>{' '}
              {c.bookTitle} <span className="muted small">· {label(c.condition)}</span>
            </span>
            <span className="cell-actions">
              <button type="button" className="btn btn-outlined" disabled={action.busy} onClick={() => void decide(c, 'PASS')}>
                {lt.passInspection}
              </button>
              <button type="button" className="btn btn-text" disabled={action.busy} onClick={() => void decide(c, 'DAMAGED')}>
                {lt.failInspection}
              </button>
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}

export function DeskPage() {
  const { org } = useWorkspace();
  const [mode, setMode] = useState<'member' | 'return' | 'inspect'>('member');
  return (
    <>
      <header className="page-header">
        <h1>{lt.deskTitle}</h1>
      </header>
      <NeedBranch>
        {(branchId) =>
          org && (
            <>
              <Tabs
                tabs={[
                  { value: 'member', label: lt.deskModeMember },
                  { value: 'return', label: lt.deskModeReturn },
                  { value: 'inspect', label: lt.deskModeInspect },
                ]}
                value={mode}
                onChange={setMode}
              />
              {mode === 'member' && <MemberDesk key={branchId} orgId={org.id} branchId={branchId} />}
              {mode === 'return' && <QuickReturn key={branchId} orgId={org.id} branchId={branchId} />}
              {mode === 'inspect' && <Inspection key={branchId} orgId={org.id} branchId={branchId} />}
            </>
          )
        }
      </NeedBranch>
    </>
  );
}
