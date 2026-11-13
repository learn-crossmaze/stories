// Deciding requests that wait in a list (leave, attendance corrections), and doing one thing for several people:
// every decision is its own command, several can be on their way at once, and each row shows its own outcome.
import { useCallback, useEffect, useRef, useState } from 'react';

import { ApiError, errorText } from '../../data/api';
import { t } from '../../strings';
import { ht } from '../../strings/hr';
import { Notice } from '../components/kit';

/** Commands sent side by side when several rows are done in one go (the backend serves a handful at a time). */
export const AT_ONCE = 4;

/**
 * Runs `work` for every item, at most `atOnce` at a time. One failure never stops the others, unless
 * `stopOn` says this failure will meet all of them: then nothing more is started. `settled` hears about each
 * as it ends, with its failure if it failed. Never rejects; answers with the items that were never started.
 */
export async function runEach<T>(items: readonly T[], atOnce: number, work: (item: T) => Promise<unknown>, settled: (item: T, failure: unknown) => void, stopOn: (failure: unknown) => boolean = () => false): Promise<T[]> {
  let next = 0;
  let stopped = false;
  const worker = async () => {
    while (!stopped && next < items.length) {
      const item = items[next++];
      let failure: unknown = null;
      try {
        await work(item);
      } catch (e) {
        failure = e ?? new Error('failed');
        if (stopOn(failure)) stopped = true;
      }
      settled(item, failure);
    }
  };
  await Promise.all(Array.from({ length: Math.min(atOnce, items.length) }, worker));
  return items.slice(next);
}

/** Someone else decided it a moment ago: nothing is left to do, so it is not an error. */
const alreadyDecided = (e: unknown) => e instanceof ApiError && e.reason === 'NOT_PENDING';

export type Decision = 'APPROVE' | 'REJECT';

/**
 * Approving and rejecting rows of a list, each with its own command (`send`).
 * - A row whose decision is on its way is `busy`: a second click on it sends nothing.
 * - A refusal stays with its row (`failed`), whatever happens to the other rows.
 * - A row someone else decided first counts as done (`elsewhere` names it): there is nothing left to do.
 * `onDone` hears about each row that is decided; `onIdle` once nothing is on its way any more.
 */
export function useDecisions<T extends { id: string }>(send: (row: T, decision: Decision, note?: string) => Promise<unknown>, onDone: (row: T) => void, onIdle?: () => void) {
  // A ref as well as state: two clicks in the same frame both see the state before the first.
  const flying = useRef(new Set<string>());
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(new Set());
  const [failed, setFailed] = useState<Readonly<Record<string, string>>>({});
  const [elsewhere, setElsewhere] = useState<T[]>([]);
  const [rejecting, setRejecting] = useState<T | null>(null);
  const decidedSinceIdle = useRef(false);
  const latest = useRef({ send, onDone, onIdle });
  latest.current = { send, onDone, onIdle };
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const start = (row: T) => {
    if (flying.current.has(row.id)) return false;
    flying.current.add(row.id);
    setBusyIds(new Set(flying.current));
    setFailed(({ [row.id]: _retried, ...rest }) => rest);
    return true;
  };
  const end = (row: T, failure: unknown) => {
    flying.current.delete(row.id);
    if (!live.current) return;
    setBusyIds(new Set(flying.current));
    if (failure && !alreadyDecided(failure)) setFailed((f) => ({ ...f, [row.id]: errorText(failure) }));
    else {
      if (failure) setElsewhere((rows) => [...rows.filter((r) => r.id !== row.id), row]);
      decidedSinceIdle.current = true;
      latest.current.onDone(row);
    }
    if (!flying.current.size && decidedSinceIdle.current) {
      decidedSinceIdle.current = false;
      latest.current.onIdle?.();
    }
  };

  const approveMany = useCallback(async (rows: T[]) => {
    const mine = rows.filter(start);
    if (mine.length) setElsewhere([]);
    await runEach(mine, AT_ONCE, (row) => latest.current.send(row, 'APPROVE'), end);
  }, []);
  const approve = useCallback((row: T) => approveMany([row]), [approveMany]);

  /** For the reject dialog: resolves when the row is rejected (or was decided elsewhere); a refusal is thrown for the dialog to show. */
  const confirmReject = async (note: string) => {
    const row = rejecting;
    if (!row || !start(row)) return;
    setElsewhere([]);
    let failure: unknown = null;
    try {
      await latest.current.send(row, 'REJECT', note);
    } catch (e) {
      failure = e ?? new Error('failed');
    }
    if (failure && !alreadyDecided(failure)) {
      flying.current.delete(row.id);
      if (live.current) setBusyIds(new Set(flying.current));
      throw failure;
    }
    if (live.current) setRejecting(null);
    end(row, failure);
  };

  return {
    approve,
    approveMany,
    /** Opens (or, with null, closes) the reject dialog for a row. */
    reject: setRejecting,
    rejecting,
    confirmReject,
    busy: (id: string) => busyIds.has(id),
    /** Some decision is on its way. */
    working: busyIds.size > 0,
    failed,
    elsewhere,
  };
}

/**
 * Rows decided here leave the list at once, without waiting for it to be read again. A fresh read brings back
 * whatever is still there (ids can be reused: a correction for the same day asked again), so the hidden ones
 * belong to the read they were hidden from.
 */
export function useHidden<T extends { id: string }>(rows: T[] | undefined) {
  const [hidden, setHidden] = useState<{ from: unknown; ids: ReadonlySet<string> }>({ from: rows, ids: new Set() });
  const latest = useRef(rows);
  latest.current = rows;
  const hide = useCallback((id: string) => setHidden((h) => ({ from: latest.current, ids: new Set(h.from === latest.current ? h.ids : []).add(id) })), []);
  const current = hidden.from === rows ? hidden.ids : NONE;
  const shown = current.size ? rows?.filter((r) => !current.has(r.id)) : rows;
  return { shown, hide, hidden: (id: string) => current.has(id) };
}

const NONE: ReadonlySet<string> = new Set();
const NO_TICKS: ReadonlyMap<string, unknown> = new Map();
const byIdAlone = () => null;

/**
 * Ticking rows of a list (never pre-selected). `rows` are the ones that may be ticked; a row that left them no
 * longer counts. Where an id can come back as another request (a correction for the same day, asked again),
 * `stamp` says what a tick stands for: the row read again with another stamp is not ticked.
 */
export function useTicks<T extends { id: string }>(rows: T[], stamp: (row: T) => unknown = byIdAlone) {
  // Each ticked id with the stamp of the row as it was ticked.
  const [ticked, setTicked] = useState<ReadonlyMap<string, unknown>>(NO_TICKS);
  const chosen = rows.filter((r) => ticked.has(r.id) && ticked.get(r.id) === stamp(r));
  const chosenIds = new Set(chosen.map((r) => r.id));
  const ticking = (which: T[]) => new Map(which.map((r) => [r.id, stamp(r)]));
  return {
    chosen,
    has: (id: string) => chosenIds.has(id),
    all: rows.length > 0 && chosen.length === rows.length,
    toggle: (id: string, on: boolean) => {
      const row = rows.find((r) => r.id === id);
      setTicked((s) => {
        const next = new Map(s);
        if (on && row) next.set(id, stamp(row));
        else next.delete(id);
        return next;
      });
    },
    toggleAll: (on: boolean) => setTicked(on ? ticking(rows) : NO_TICKS),
    /** Ticks exactly these. */
    set: (ids: string[]) => setTicked(ticking(rows.filter((r) => ids.includes(r.id)))),
  };
}

/** What the person should know after deciding: rows someone else got to first, and how many were refused (each row says why). */
export function DecisionNotices<T extends { id: string }>({ decision, rows, name }: { decision: { failed: Readonly<Record<string, string>>; elsewhere: T[]; working: boolean }; rows: T[]; name: (row: T) => string }) {
  const notDone = rows.filter((r) => decision.failed[r.id]).length;
  return (
    <>
      {decision.elsewhere.length > 0 && <Notice tone="warn">{ht.decidedElsewhere(decision.elsewhere.map(name))}</Notice>}
      {!decision.working && notDone > 0 && <Notice tone="error">{ht.notApproved(notDone)}</Notice>}
    </>
  );
}

/**
 * Approve and Reject for one waiting request: both are off, and say so, while its decision is on its way.
 * `hold` keeps them off without saying so (the list is being read again and the row may already be decided).
 */
export function DecideButtons({ busy, hold, onApprove, onReject, approveLabel, rejectLabel }: { busy: boolean; hold?: boolean; onApprove: () => void; onReject: () => void; approveLabel: string; rejectLabel: string }) {
  return (
    <>
      <button type="button" className="btn btn-text" disabled={busy || hold} onClick={onApprove} aria-label={approveLabel}>
        {busy ? t.saving : ht.approve}
      </button>
      <button type="button" className="btn btn-text" disabled={busy || hold} onClick={onReject} aria-label={rejectLabel}>
        {ht.reject}
      </button>
    </>
  );
}
