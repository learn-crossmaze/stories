import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';

import { useAuth } from '../../auth/AuthContext';
import { branchScope, can } from '../../auth/claims';
import { command, errorText } from '../../data/api';
import { memberSubscriptions } from '../../data/billing';
import { ISSUE_MAX, memberLoans, memberReservations, RETURN_MAX } from '../../data/circulation';
import { label, toDate } from '../../data/common';
import { type Copy, findCopy, INSPECT_BATCH, listCopies, passInspections } from '../../data/inventory';
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
import { SubscriptionCard } from '../members/memberCards';

type Msg = { tone: 'ok' | 'warn' | 'error'; text: string } | null;

/**
 * A list of scanned copies. Scans are handled back to back, before the screen has drawn the one before, so
 * what is in the list is read from `now` (always current) and never from the render's own `list`.
 */
function useStaged() {
  const [list, setList] = useState<Copy[]>([]);
  const now = useRef<Copy[]>([]);
  const set = (next: Copy[]) => {
    now.current = next;
    setList(next);
  };
  return { list, now, set };
}

/** Scans that were not taken, as "CODE: reason". They stay until cleared: the next scan must not wipe them. */
function useSkipped() {
  const [list, setList] = useState<{ code: string; text: string }[]>([]);
  return {
    list,
    add: (code: string, text: string) => setList((l) => [...l.filter((s) => s.code !== code), { code, text }]),
    drop: (code: string) => setList((l) => (l.some((s) => s.code === code) ? l.filter((s) => s.code !== code) : l)),
    clear: () => setList([]),
  };
}

function Skipped({ skipped }: { skipped: ReturnType<typeof useSkipped> }) {
  if (!skipped.list.length) return null;
  return (
    <div>
      {skipped.list.map((s) => (
        <Notice key={s.code} tone="warn">
          {s.code}: {s.text}
        </Notice>
      ))}
      <button type="button" className="btn btn-text" onClick={skipped.clear}>
        {t.scanClearFailed}
      </button>
    </div>
  );
}

/** Finds the member, then serves them (OpenMember); after a confirmed step it is back here, ready for the next card. */
function MemberDesk({ orgId, branchId }: { orgId: string; branchId: string }) {
  const [member, setMember] = useState<Member | null>(null);
  const [matches, setMatches] = useState<Member[] | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  // The member just served: what was done, and the way back to them.
  const [receipt, setReceipt] = useState<{ memberId: string; text: string } | null>(null);

  const pick = (m: Member) => {
    setMember(m);
    setMatches(null);
    setMsg(null);
    setReceipt(null);
  };
  const lookup = async (q: string) => {
    setMsg(null);
    setReceipt(null);
    const found = await searchMembers(orgId, branchId, q);
    const exact = found.find((m) => m.code === q.trim().toUpperCase());
    if (exact || found.length === 1) pick(exact ?? found[0]);
    else setMatches(found);
    if (!found.length) setMsg({ tone: 'warn', text: lt.membersEmpty });
  };
  const reopen = async (memberId: string) => {
    try {
      // Read again, not kept from before the books moved: the member's counts decide how many more they may take.
      const fresh = await getMember(orgId, memberId);
      if (fresh) pick(fresh);
    } catch (e) {
      reportError(e, 'load', { what: 'member at the desk' });
      setMsg({ tone: 'error', text: errorText(e, t.errorLoad) });
    }
  };

  if (member) {
    return (
      <OpenMember
        key={member.id}
        orgId={orgId}
        branchId={branchId}
        member={member}
        onRefreshed={(fresh) => setMember((cur) => (cur && cur.id === fresh.id ? fresh : cur))}
        onClose={() => setMember(null)}
        onDone={(text) => {
          setReceipt({ memberId: member.id, text });
          setMember(null);
        }}
      />
    );
  }
  return (
    <section className="desk-find">
      <ScanInput label={lt.findMember} placeholder={lt.findMemberHint} onScan={lookup} autoFocus />
      {receipt && (
        <Notice tone="ok">
          {receipt.text}{' '}
          <button type="button" className="btn btn-text" onClick={() => void reopen(receipt.memberId)}>
            {lt.openAgain}
          </button>
        </Notice>
      )}
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

/** One member at the desk: tick or scan the books coming back, scan the books going out, confirm once. */
function OpenMember({
  orgId,
  branchId,
  member,
  onRefreshed,
  onClose,
  onDone,
}: {
  orgId: string;
  branchId: string;
  member: Member;
  onRefreshed: (fresh: Member) => void;
  onClose: () => void;
  onDone: (receipt: string) => void;
}) {
  const { claims } = useAuth();
  const { branches } = useWorkspace();
  const scope = branchScope(claims, orgId);
  const mid = member.id;
  const [returning, setReturning] = useState<string[]>([]);
  const issuing = useStaged();
  const skipped = useSkipped();
  const [msg, setMsg] = useState<Msg>(null);
  // Scans still being looked up: nothing is confirmed, and the member stays open, until they have landed.
  const [pending, setPending] = useState(0);
  const [focusSignal, setFocusSignal] = useState(0);
  const action = useAction();
  const busy = action.busy;
  const loans = useAsync(() => memberLoans(orgId, mid, scope, true), [orgId, mid]);
  const subs = useAsync(() => memberSubscriptions(orgId, mid, scope), [orgId, mid]);
  const holds = useAsync(() => memberReservations(orgId, mid, scope).then((r) => r.filter((x) => x.status === 'ALLOCATED')), [orgId, mid]);

  // The term in force by the clock, as the server judges it (a pre-paid renewal counts from the day it starts).
  const current = (subs.data ?? []).find((s) => s.status === 'ACTIVE' && (toDate(s.startAt)?.getTime() ?? 0) <= Date.now() && (toDate(s.endAt)?.getTime() ?? 0) > Date.now());
  const unpaid = (subs.data ?? []).some((s) => s.status === 'PENDING_PAYMENT');
  const subsKnown = subs.data !== undefined && !subs.loading && !subs.error;
  const max = current?.planSnapshot.maxSimultaneousBooks ?? 0;
  const active = loans.data ?? [];

  // A book scanned straight after the card waits for the member's books: it may be one of them coming back.
  const loansNow = useRef(loans);
  loansNow.current = loans;
  const whenLoaded = useRef<(() => void)[]>([]);
  useEffect(() => {
    if (!loans.loading) whenLoaded.current.splice(0).forEach((resume) => resume());
  }, [loans.loading]);
  const memberBooks = async () => {
    if (loansNow.current.loading) await new Promise<void>((resume) => whenLoaded.current.push(resume));
    return loansNow.current.data ?? [];
  };

  // Renewed and paid here: back to the scan box, where Enter confirms the books already scanned.
  const lapsed = useRef(false);
  const hasTerm = !!current;
  useEffect(() => {
    if (!subsKnown) return;
    if (!hasTerm) lapsed.current = true;
    else if (lapsed.current) {
      lapsed.current = false;
      setFocusSignal((n) => n + 1);
    }
  }, [subsKnown, hasTerm]);

  const scan = async (value: string) => {
    const code = value.trim().toUpperCase();
    const tick = (loanId: string) => {
      skipped.drop(code);
      setReturning((r) => (r.includes(loanId) ? r : [...r, loanId]));
    };
    const mine = await memberBooks();
    // One of the member's own books, by its copy code: no lookup needed.
    const own = mine.find((l) => l.copyCode === code);
    if (own) return tick(own.id);
    const copy = await findCopy(orgId, branchId, code);
    if (!copy) return skipped.add(code, lt.copyNotFound);
    // A label that differs from the copy code is matched by the copy itself.
    const loan = mine.find((l) => l.copyId === copy.id);
    if (loan) return tick(loan.id);
    if (issuing.now.current.some((c) => c.id === copy.id)) return skipped.add(code, lt.alreadyStaged);
    if (copy.status === 'ISSUED') return skipped.add(code, lt.onLoanElsewhere);
    if (copy.status !== 'AVAILABLE' && copy.status !== 'RESERVED') return skipped.add(code, lt.notOnShelf(label(copy.status)));
    if (issuing.now.current.length >= ISSUE_MAX) return skipped.add(code, lt.issueLimit(ISSUE_MAX));
    skipped.drop(code);
    issuing.set([...issuing.now.current, copy]);
  };

  const r = returning.length;
  const i = issuing.list.length;
  const heldAfter = active.length - r + i + (member.allocatedCount - issuing.list.filter((c) => c.status === 'RESERVED').length);
  const actionLabel = r && i ? lt.exchangeN(r, i) : i ? lt.issueN(i) : r ? lt.returnN(r) : lt.nothingStaged;
  const canAct = can(claims, r && i ? 'exchanges.process' : i ? 'loans.issue' : 'loans.return', orgId, branchId);
  // Why the server would refuse to issue, said before asking it. Only from what has loaded for certain: when the
  // subscriptions could not be read the server decides. A return on its own is never held back.
  const blocked = !i
    ? null
    : r > ISSUE_MAX
      ? lt.exchangeLimit(ISSUE_MAX)
      : !subsKnown
        ? null
        : member.status !== 'ACTIVE'
          ? lt.blockedInactive(label(member.status))
          : !current
            ? lt.blockedNoPlan
            : heldAfter > max
              ? lt.blockedLimit(max)
              : null;
  const ready = !busy && pending === 0 && (r > 0 || i > 0) && canAct && !blocked;

  const go = async () => {
    if (!ready) return;
    const returnCodes = active.filter((l) => returning.includes(l.id)).map((l) => l.copyCode);
    const issueCodes = issuing.list.map((c) => c.barcode);
    setMsg(null);
    const done = await action.run(async () => {
      if (returnCodes.length && issueCodes.length) {
        await command('circulation-exchange', { orgId, branchId, memberId: mid, returnBarcodes: returnCodes, issueBarcodes: issueCodes });
      } else if (issueCodes.length) {
        await command('circulation-issue', { orgId, branchId, memberId: mid, barcodes: issueCodes });
      } else {
        await command('circulation-return', { orgId, branchId, barcodes: returnCodes });
      }
    });
    if (done) return onDone(lt.deskReceipt(member.fullName, member.code, returnCodes.length, issueCodes.length));
    // A click on the button took focus from the scan box; it goes back for the fix.
    setFocusSignal((n) => n + 1);
  };

  // After a renewal or payment here: the scanned books stay as they are, only the plan and the counts are read again.
  const refresh = () => {
    subs.reload();
    getMember(orgId, mid).then(
      (fresh) => fresh && onRefreshed(fresh),
      (e: unknown) => reportError(e, 'load', { what: 'member at the desk' }),
    );
  };

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
            ) : subs.loading ? (
              <p className="muted">{t.loading}</p>
            ) : subs.error && !subs.data ? (
              <Notice tone="error">{subs.error}</Notice>
            ) : (
              <Notice tone="warn">
                {lt.cantBorrow}: {lt.returnsOnly}
              </Notice>
            )}
          </div>
          <div className="row">
            <StatusBadge status={member.status} />
            <button type="button" className="btn btn-text" disabled={busy || pending > 0} onClick={onClose}>
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

      {/* Renew and take the payment here: leaving for the member page would lose the scanned books. */}
      {subs.data !== undefined && !subs.loading && (!current || unpaid) && (
        <SubscriptionCard
          orgId={orgId}
          m={member}
          subs={subs}
          perm={(p) => can(claims, p, orgId, member.homeBranchId)}
          canCollectOnline={!!branches.find((x) => x.id === member.homeBranchId)?.payments?.razorpay?.enabled}
          onChanged={refresh}
          onNotice={(text) => setMsg({ tone: 'ok', text })}
        />
      )}

      <div className="desk-cols">
        <section className="card">
          <h3>{lt.currentBooks}</h3>
          {loans.loading ? (
            <SkeletonRows rows={2} />
          ) : loans.error && !loans.data ? (
            <Notice tone="error">{loans.error}</Notice>
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
          <ScanInput
            label={lt.scanToIssue}
            onScan={scan}
            busy={busy}
            autoFocus
            queue
            focusSignal={focusSignal}
            onPendingChange={setPending}
            onEmptyEnter={ready ? () => void go() : undefined}
          />
          <Skipped skipped={skipped} />
          {issuing.list.length > 0 && (
            <ul className="desk-list">
              {issuing.list.map((c) => (
                <li key={c.id}>
                  <span>
                    {c.bookTitle} <span className="mono small">{c.code}</span> {c.status === 'RESERVED' && <CopyStatusBadge status="RESERVED" />}
                  </span>
                  <button type="button" className="btn btn-text" disabled={busy} onClick={() => issuing.set(issuing.now.current.filter((y) => y.id !== c.id))}>
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
      {blocked && <Notice tone="warn">{blocked}</Notice>}
      <div className="desk-actions">
        <button type="button" className="btn btn-filled btn-lg" disabled={!ready} onClick={() => void go()}>
          {busy ? t.saving : ready ? lt.pressEnter(actionLabel) : actionLabel}
        </button>
      </div>
    </div>
  );
}

function QuickReturn({ orgId, branchId }: { orgId: string; branchId: string }) {
  const staged = useStaged();
  const skipped = useSkipped();
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, setPending] = useState(0);
  const [focusSignal, setFocusSignal] = useState(0);
  const action = useAction();
  const ready = !action.busy && pending === 0 && staged.list.length > 0;

  const scan = async (value: string) => {
    const code = value.trim().toUpperCase();
    const c = await findCopy(orgId, branchId, code);
    if (!c) return skipped.add(code, lt.copyNotFound);
    if (c.status !== 'ISSUED') return skipped.add(code, label(c.status));
    skipped.drop(code);
    if (!staged.now.current.some((x) => x.id === c.id)) staged.set([...staged.now.current, c]);
  };

  const go = async () => {
    if (!ready) return;
    const all = staged.now.current;
    let sent = 0;
    setMsg(null);
    const done = await action.run(async () => {
      // One call takes RETURN_MAX books, all or none. Each call is its own request, so the books of a call
      // that went through stay returned (and leave the list) when a later one is refused.
      for (let at = 0; at < all.length; at += RETURN_MAX) {
        const slice = all.slice(at, at + RETURN_MAX);
        await command('circulation-return', { orgId, branchId, barcodes: slice.map((c) => c.barcode) });
        sent += slice.length;
        staged.set(staged.now.current.filter((c) => !slice.some((sent) => sent.id === c.id)));
      }
    });
    if (done) {
      skipped.clear();
      setMsg({ tone: 'ok', text: lt.returned(sent) });
    } else if (sent) setMsg({ tone: 'warn', text: lt.returnedSoFar(sent) });
    setFocusSignal((n) => n + 1);
  };

  return (
    <section className="card">
      <ScanInput
        label={lt.scanToReturn}
        busy={action.busy}
        onScan={scan}
        autoFocus
        queue
        focusSignal={focusSignal}
        onPendingChange={setPending}
        onEmptyEnter={ready ? () => void go() : undefined}
      />
      <Skipped skipped={skipped} />
      {staged.list.length > 0 && (
        <ul className="desk-list">
          {staged.list.map((c) => (
            <li key={c.id}>
              <span>
                {c.bookTitle} <span className="mono small">{c.code}</span>
              </span>
              <button type="button" className="btn btn-text" disabled={action.busy} onClick={() => staged.set(staged.now.current.filter((y) => y.id !== c.id))}>
                {t.cancel}
              </button>
            </li>
          ))}
        </ul>
      )}
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      {action.error && <Notice tone="error">{action.error}</Notice>}
      <button type="button" className="btn btn-filled" disabled={!ready} onClick={() => void go()}>
        {ready ? lt.pressEnter(lt.returnN(staged.list.length)) : lt.returnN(staged.list.length)}
      </button>
    </section>
  );
}

function Inspection({ orgId, branchId }: { orgId: string; branchId: string }) {
  const { claims } = useAuth();
  const queue = useAsync(() => listCopies(orgId, branchId, 'UNDER_INSPECTION').then((p) => p.items), [orgId, branchId]);
  const action = useAction();
  const [msg, setMsg] = useState<Msg>(null);
  // Copies decided here leave the list at once; the list is read again behind them (other staff's returns arrive meanwhile).
  const [decided, setDecided] = useState<string[]>([]);
  const [unticked, setUnticked] = useState<string[]>([]);
  useEffect(() => setDecided([]), [queue.data]);
  const canDecide = can(claims, 'copies.manage', orgId, branchId);
  const rows = (queue.data ?? []).filter((c) => !decided.includes(c.id));
  const ticked = rows.filter((c) => !unticked.includes(c.id)).slice(0, INSPECT_BATCH);

  const settled = (copyIds: string[]) => {
    setDecided((d) => [...d, ...copyIds]);
    queue.reload();
  };
  const decide = (c: Copy, outcome: 'PASS' | 'DAMAGED') => {
    setMsg(null);
    return action.run(async () => {
      await command('copies-inspect', { orgId, copyId: c.id, outcome, condition: outcome === 'PASS' ? c.condition : 'POOR' });
      settled([c.id]);
    }, c.id);
  };
  const passTicked = () => {
    const copyIds = ticked.map((c) => c.id);
    setMsg(null);
    return action.run(async () => {
      const res = await passInspections(orgId, branchId, copyIds);
      setMsg(
        res.skipped.length
          ? { tone: 'warn', text: `${lt.inspectPassed(res.passed.length)} ${lt.inspectSkipped(res.skipped.join(', '))}` }
          : { tone: 'ok', text: lt.inspectPassed(res.passed.length) },
      );
      settled(copyIds);
    }, 'many');
  };

  if (queue.loading) return <SkeletonRows rows={3} />;
  return (
    <>
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      {action.error && <Notice tone="error">{action.error}</Notice>}
      {!rows.length ? (
        <EmptyState icon="check" title={lt.noInspections} message="" />
      ) : (
        <>
          {canDecide && (
            <div className="row">
              <button type="button" className="btn btn-filled" disabled={action.busy || !ticked.length} onClick={() => void passTicked()}>
                {action.pending === 'many' ? t.saving : lt.passN(ticked.length)}
              </button>
            </div>
          )}
          <ul className="plain-list">
            {rows.map((c) => (
              <li key={c.id}>
                <span className="check">
                  {canDecide && (
                    <input
                      type="checkbox"
                      aria-label={`${c.code} ${c.bookTitle}`}
                      checked={!unticked.includes(c.id)}
                      disabled={action.busy}
                      onChange={() => setUnticked((x) => (x.includes(c.id) ? x.filter((y) => y !== c.id) : [...x, c.id]))}
                    />
                  )}
                  <span>
                    <Link to={paths.adminCopy(c.id)} className="mono">
                      {c.code}
                    </Link>{' '}
                    {c.bookTitle} <span className="muted small">· {label(c.condition)}</span>
                  </span>
                </span>
                {canDecide && (
                  <span className="cell-actions">
                    <button type="button" className="btn btn-outlined" disabled={action.busy} onClick={() => void decide(c, 'PASS')}>
                      {lt.passInspection}
                    </button>
                    <button type="button" className="btn btn-text" disabled={action.busy} onClick={() => void decide(c, 'DAMAGED')}>
                      {lt.failInspection}
                    </button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
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
