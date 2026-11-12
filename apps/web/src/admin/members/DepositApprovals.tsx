import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';

import { useAuth } from '../../auth/AuthContext';
import { branchScope } from '../../auth/claims';
import { ApiError, command, errorText } from '../../data/api';
import { type Adjustment, pendingAdjustments } from '../../data/billing';
import { label } from '../../data/common';
import { useAsync } from '../../shared/useAsync';
import { day, money } from '../../shared/format';
import { paths } from '../../paths';
import { t } from '../../strings';
import { EmptyState, ErrorState, SkeletonRows, TableWrap } from '../../shared/ui';
import { ConfirmWithReason, Dialog, DialogActions, FormError, TextField, useSubmit } from '../components/Dialog';
import { Notice } from '../components/kit';
import { lt } from '../../strings/library';
import { useWorkspace } from '../Workspace';

/** Members whose approvals run side by side when several are approved at once. */
const MEMBERS_AT_ONCE = 3;

/**
 * Approves several adjustments, each with its own request. One member's adjustments all change the same
 * deposit, so they go strictly one after another, oldest first (`rows` is oldest first); a few members run
 * side by side. `settled` hears about each as it ends, with its failure if it failed. Never rejects.
 */
export async function approveInOrder(rows: Adjustment[], approve: (a: Adjustment) => Promise<unknown>, settled: (a: Adjustment, failure: unknown) => void): Promise<void> {
  const chains = new Map<string, Adjustment[]>();
  for (const a of rows) chains.set(a.memberId, [...(chains.get(a.memberId) ?? []), a]);
  const waiting = [...chains.values()];
  const worker = async () => {
    for (let chain = waiting.shift(); chain; chain = waiting.shift()) {
      for (const a of chain) {
        try {
          await approve(a);
          settled(a, null);
        } catch (e) {
          settled(a, e);
        }
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(MEMBERS_AT_ONCE, waiting.length) }, worker));
}

/** Someone else decided it a moment ago: nothing is left to do, so it counts as done. */
const alreadyDecided = (e: unknown) => e instanceof ApiError && e.reason === 'ALREADY_DECIDED';
const signed = (a: Adjustment) => <span className={a.deltaMinor < 0 ? 'neg' : undefined}>{money(a.deltaMinor)}</span>;

/** Maker-checker queue: deposit deductions/adjustments proposed by others. */
export function DepositApprovalsPage() {
  const { claims, user } = useAuth();
  const { org, branchName } = useWorkspace();
  const scope = org ? branchScope(claims, org.id) : 'ALL';
  const list = useAsync(() => (org ? pendingAdjustments(org.id, scope) : Promise.resolve([])), [org?.id, JSON.stringify(scope)]);
  const [dialog, setDialog] = useState<{ kind: 'approve' | 'reject'; adj: Adjustment } | { kind: 'many' } | null>(null);
  // Decided here: hidden at once, without waiting for the list to be read again.
  const [decided, setDecided] = useState<ReadonlySet<string>>(new Set());
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  // Approving several: how far it is, and why a row could not be approved (the server's words).
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [failed, setFailed] = useState<Record<string, string>>({});
  // Decided by someone else first: the row goes, and the person is told their own decision was not used.
  const [elsewhere, setElsewhere] = useState<Adjustment[]>([]);
  const heading = useRef<HTMLHeadingElement>(null);
  const running = useRef(false);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const rows = (list.data ?? []).filter((a) => !decided.has(a.id));
  // A convenience only: the server decides who may approve what (a different person, above the limit it is set to).
  const own = (a: Adjustment) => a.proposedBy === user?.uid;
  const approvable = rows.filter((a) => !own(a));
  // Only rows still on screen count, so a decided row or another branch's never stays selected unseen.
  const chosen = approvable.filter((a) => selected.has(a.id));
  const busy = progress !== null;
  const notDone = rows.filter((a) => failed[a.id]).length;
  // The confirmation for several has nothing left to confirm (a reload took its rows away): close it for good,
  // or it would open by itself at the next tick of a box.
  const emptied = dialog?.kind === 'many' && !chosen.length;
  useEffect(() => {
    if (emptied) setDialog(null);
  }, [emptied]);
  // The confirmation hands focus back to "Approve selected", which is switched off while the batch runs:
  // the heading takes it, so the keyboard stays on this page's content.
  useEffect(() => {
    if (busy && (!document.activeElement || document.activeElement === document.body)) heading.current?.focus();
  }, [busy]);
  if (!org) return null;
  const orgId = org.id;

  const hide = (id: string) => setDecided((s) => new Set(s).add(id));
  const toggle = (id: string, on: boolean) =>
    setSelected((s) => {
      const next = new Set(s);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  const decide = (adj: Adjustment, decision: 'APPROVE' | 'REJECT', note: string) => command('deposits-decide', { orgId, adjustmentId: adj.id, decision, note });

  /** One decision from its dialog: the row goes at once; the dialog shows a failure. */
  const decideOne = async (adj: Adjustment, decision: 'APPROVE' | 'REJECT', note: string) => {
    setElsewhere([]);
    try {
      await decide(adj, decision, note);
    } catch (e) {
      if (!alreadyDecided(e)) throw e;
      // The other person may have decided the opposite: say so on the page, never close as if this went through.
      setElsewhere([adj]);
    }
    hide(adj.id);
    setFailed(({ [adj.id]: _gone, ...rest }) => rest);
    list.reload();
    setDialog(null);
  };

  const approveMany = async (batch: Adjustment[], note: string) => {
    if (running.current || !batch.length) return;
    running.current = true;
    setFailed({});
    setElsewhere([]);
    setProgress({ done: 0, total: batch.length });
    await approveInOrder(
      batch,
      (a) => decide(a, 'APPROVE', note),
      (a, failure) => {
        if (!live.current) return;
        setProgress((p) => p && { ...p, done: p.done + 1 });
        if (!failure || alreadyDecided(failure)) hide(a.id);
        // Kept, with the reason, and still selected for another try.
        else setFailed((f) => ({ ...f, [a.id]: errorText(failure) }));
        if (alreadyDecided(failure)) setElsewhere((others) => [...others, a]);
      },
    );
    running.current = false;
    if (!live.current) return;
    setProgress(null);
    list.reload();
  };

  return (
    <>
      <header className="page-header">
        <h1 ref={heading} tabIndex={-1}>
          {lt.approvalsTitle}
        </h1>
      </header>
      {list.error && list.data && <Notice tone="error">{list.error}</Notice>}
      {elsewhere.length > 0 && (
        <Notice tone="warn">
          {elsewhere.length === 1
            ? lt.decidedElsewhere(money(elsewhere[0].deltaMinor), elsewhere[0].memberName)
            : lt.decidedElsewhereMany(elsewhere.map((a) => `${money(a.deltaMinor)} · ${a.memberName}`))}
        </Notice>
      )}
      {progress && <Notice tone="ok">{lt.approvingProgress(progress.done, progress.total)}</Notice>}
      {!progress && notDone > 0 && <Notice tone="error">{lt.approvalsNotDone(notDone)}</Notice>}
      {list.loading ? (
        <SkeletonRows />
      ) : list.error && !list.data ? (
        <ErrorState message={list.error} onRetry={list.reload} />
      ) : !rows.length ? (
        <EmptyState icon="check" title={lt.approvalsEmpty} message="" />
      ) : (
        <>
          <div className="toolbar">
            <button type="button" className="btn btn-filled" disabled={busy || !chosen.length} onClick={() => setDialog({ kind: 'many' })}>
              {lt.approveSelected(chosen.length)}
            </button>
          </div>
          <TableWrap>
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">
                    <input
                      type="checkbox"
                      aria-label={lt.selectAllApprovable}
                      title={lt.selectAllApprovable}
                      disabled={busy || !approvable.length}
                      checked={approvable.length > 0 && chosen.length === approvable.length}
                      onChange={(e) => setSelected(new Set(e.target.checked ? approvable.map((a) => a.id) : []))}
                    />
                  </th>
                  <th scope="col">{lt.membersTitle}</th>
                  <th scope="col">{lt.adjustmentType}</th>
                  <th scope="col">{lt.amount.replace(' (₹)', '')}</th>
                  <th scope="col">{lt.proposedBy}</th>
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={lt.selectAdjustment(money(a.deltaMinor), a.memberName)}
                        title={own(a) ? lt.ownProposal : undefined}
                        disabled={busy || own(a)}
                        checked={!own(a) && selected.has(a.id)}
                        onChange={(e) => toggle(a.id, e.target.checked)}
                      />
                    </td>
                    <td>
                      <Link to={paths.adminMember(a.memberId)}>{a.memberName}</Link> <span className="mono small">{a.memberCode}</span>
                      <div className="muted small">{branchName(a.branchId)}</div>
                    </td>
                    <td>
                      {label(a.kind)}
                      <div className="muted small">{a.reason}</div>
                      {failed[a.id] && (
                        <div className="field-error" role="alert">
                          {failed[a.id]}
                        </div>
                      )}
                    </td>
                    <td className="nowrap">{signed(a)}</td>
                    <td className="small">
                      {a.proposedByEmail ?? a.proposedBy}
                      <div className="muted">{day(a.createdAt)}</div>
                    </td>
                    <td className="cell-actions">
                      <button type="button" className="btn btn-outlined" disabled={busy || own(a)} title={own(a) ? lt.ownProposal : undefined} onClick={() => setDialog({ kind: 'approve', adj: a })}>
                        {lt.approve}
                      </button>
                      <button type="button" className="btn btn-text" disabled={busy} onClick={() => setDialog({ kind: 'reject', adj: a })}>
                        {lt.reject}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </>
      )}
      {dialog?.kind === 'approve' && (
        <ApproveDialog
          title={lt.approveTitle(money(dialog.adj.deltaMinor), dialog.adj.memberName)}
          noteLabel={lt.note}
          confirmLabel={lt.approve}
          onClose={() => setDialog(null)}
          onConfirm={(note) => decideOne(dialog.adj, 'APPROVE', note)}
        >
          <p className="muted">{dialog.adj.reason}</p>
        </ApproveDialog>
      )}
      {dialog?.kind === 'reject' && (
        <ConfirmWithReason
          title={lt.rejectTitle(money(dialog.adj.deltaMinor), dialog.adj.memberName)}
          body={dialog.adj.reason}
          confirmLabel={lt.reject}
          onClose={() => setDialog(null)}
          onConfirm={(note) => decideOne(dialog.adj, 'REJECT', note)}
        />
      )}
      {dialog?.kind === 'many' && !emptied && (
        <ApproveDialog
          title={lt.approveManyTitle(chosen.length)}
          noteLabel={lt.approveManyNote}
          confirmLabel={lt.approveSelected(chosen.length)}
          onClose={() => setDialog(null)}
          onConfirm={async (note) => {
            // The page shows how far it is and what could not be approved; nothing waits on this dialog.
            setDialog(null);
            void approveMany(chosen, note);
          }}
        >
          <Selection rows={chosen} />
        </ApproveDialog>
      )}
    </>
  );
}

/** A plain confirmation: what is being approved, and a note that may be left empty. */
function ApproveDialog({
  title,
  noteLabel,
  confirmLabel,
  children,
  onConfirm,
  onClose,
}: {
  title: string;
  noteLabel: string;
  confirmLabel: string;
  children: ReactNode;
  onConfirm: (note: string) => Promise<void>;
  onClose: () => void;
}) {
  const [note, setNote] = useState('');
  const { busy, error, submit } = useSubmit(() => onConfirm(note.trim()));
  return (
    <Dialog title={title} onClose={onClose} narrow>
      <form onSubmit={submit} noValidate>
        {children}
        <TextField label={noteLabel} value={note} onChange={setNote} />
        <FormError error={error} />
        <DialogActions busy={busy} submitLabel={confirmLabel} onCancel={onClose} />
      </form>
    </Dialog>
  );
}

/** Every adjustment about to be approved, with money taken and money given back added up apart. */
function Selection({ rows }: { rows: Adjustment[] }) {
  const sum = (list: Adjustment[]) => list.reduce((n, a) => n + a.deltaMinor, 0);
  const deductions = rows.filter((a) => a.deltaMinor < 0);
  const credits = rows.filter((a) => a.deltaMinor > 0);
  return (
    <>
      <TableWrap>
        <table className="table compact">
          <thead>
            <tr>
              <th scope="col">{lt.membersTitle}</th>
              <th scope="col">{lt.amount.replace(' (₹)', '')}</th>
              <th scope="col">{t.reasonLabel}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.id}>
                <td>
                  {a.memberName} <span className="mono small">{a.memberCode}</span>
                </td>
                <td className="nowrap">{signed(a)}</td>
                <td className="small">{a.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
      <dl className="facts">
        {deductions.length > 0 && (
          <>
            <dt>{lt.deductionsTotal}</dt>
            <dd className="neg">{money(sum(deductions))}</dd>
          </>
        )}
        {credits.length > 0 && (
          <>
            <dt>{lt.creditsTotal}</dt>
            <dd>{money(sum(credits))}</dd>
          </>
        )}
      </dl>
    </>
  );
}
