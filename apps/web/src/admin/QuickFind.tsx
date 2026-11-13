import { type FormEvent, type KeyboardEvent as ReactKeyboardEvent, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router';

import { useAuth } from '../auth/AuthContext';
import { can } from '../auth/claims';
import { ApiError } from '../data/api';
import { type Book, findBooks } from '../data/catalogue';
import { label } from '../data/common';
import { type CopyWhereabouts, findCopy, locateCopy } from '../data/inventory';
import { type Member, searchMembers } from '../data/members';
import { paths } from '../paths';
import { Dialog } from '../shared/Dialog';
import { normalizeIsbn } from '../shared/isbn';
import { reportError } from '../shared/reportError';
import { t } from '../strings';
import { lt } from '../strings/library';
import { visibleNav } from './nav';
import { useWorkspace } from './Workspace';

/** What a copy code or barcode can look like (functions/src/inventory/copies.ts). */
const COPY_CODE = /^[A-Z0-9-]{4,32}$/i;
/** Titles listed; one more is asked for to know whether there are others. */
const TITLES = 5;
const MEMBERS = 8;
/** Keys closer together than this come from a scanner, not from a hand. */
const SCAN_GAP_MS = 80;

const inField = (target: EventTarget | null) =>
  target instanceof Element && !!target.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="textbox"]');
const dialogOpen = () => !!document.querySelector('[role="dialog"][aria-modal="true"]');

interface Found {
  q: string;
  members: Member[];
  titles: Book[];
  /** More members or titles matched than are listed. */
  more: boolean;
  /** One of the lookups failed: what is shown may not be everything. */
  failed: boolean;
  /** The copy is held by a branch the person can't open copies of. */
  elsewhere: CopyWhereabouts | null;
}

/**
 * The header's find box: scan or type a copy code, a member or a title from any page and go straight there.
 * It only saves the trip through the menu: every lookup is the one the Inventory, Members and Catalogue pages
 * make, and nothing is offered that the person's menu does not have.
 *
 * Opens with the button, Ctrl/Cmd+K, or "/" when no field has the keyboard. It never opens or takes focus on
 * its own, so a page still lands on its own scan field.
 */
export function QuickFind() {
  const { claims } = useAuth();
  const { org, branch } = useWorkspace();
  const [open, setOpen] = useState(false);
  const orgId = org?.id ?? null;
  const menu = visibleNav(claims, orgId);
  const inMenu = (to: string) => !!orgId && menu.some((i) => i.to === to);
  // The rules read the branch on copies and members: those are looked up at the working branch only.
  const scope: Scope = {
    titles: inMenu(paths.adminBooks),
    locate: inMenu(paths.adminInventory),
    copies: inMenu(paths.adminInventory) && !!branch && can(claims, 'books.view', orgId, branch.id),
    members: inMenu(paths.adminMembers) && !!branch && can(claims, 'members.view', orgId, branch.id),
  };
  const usable = scope.titles || scope.locate || scope.members;

  useEffect(() => {
    if (!usable) return;
    let lastKey = -Infinity;
    const onKey = (e: KeyboardEvent) => {
      const sinceLast = e.timeStamp - lastKey;
      lastKey = e.timeStamp;
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
        // Ours everywhere (the browser's own use of it is its address bar). Another dialog keeps the keyboard.
        e.preventDefault();
        if (!dialogOpen()) setOpen(true);
        return;
      }
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey || e.repeat || e.isComposing) return;
      // Typing in a field, or over a dialog: the key is theirs. Mid-scan (a scanned web address, say): not ours either.
      if (inField(e.target) || dialogOpen() || sinceLast < SCAN_GAP_MS) return;
      e.preventDefault();
      setOpen(true);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [usable]);

  if (!usable || !orgId) return null;
  const mac = /Mac|iPhone|iPad/.test(navigator.platform);
  return (
    <>
      <button type="button" className="btn btn-text quick-find" aria-label={lt.find} aria-haspopup="dialog" title={lt.findShortcut(mac)} onClick={() => setOpen(true)}>
        <svg className="icon" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
          <path d="m19.6 21-6.3-6.3q-.75.6-1.72.95T9.5 16q-2.72 0-4.61-1.89T3 9.5q0-2.72 1.89-4.61T9.5 3q2.72 0 4.61 1.89T16 9.5q0 1.1-.35 2.08t-.95 1.72l6.3 6.3-1.4 1.4ZM9.5 14q1.88 0 3.19-1.31T14 9.5q0-1.88-1.31-3.19T9.5 5Q7.62 5 6.31 6.31T5 9.5q0 1.88 1.31 3.19T9.5 14Z" fill="currentColor" />
        </svg>
        <span className="quick-find-text" aria-hidden="true">
          {lt.find}
        </span>
        <kbd aria-hidden="true">{mac ? '⌘K' : 'Ctrl K'}</kbd>
      </button>
      {/* On the body like any page's dialog, not inside the sticky header. */}
      {open && createPortal(<FindDialog orgId={orgId} branchId={branch?.id ?? null} scope={scope} onClose={() => setOpen(false)} />, document.body)}
    </>
  );
}

interface Scope {
  titles: boolean;
  locate: boolean;
  copies: boolean;
  members: boolean;
}

function FindDialog({ orgId, branchId, scope, onClose }: { orgId: string; branchId: string | null; scope: Scope; onClose: () => void }) {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [found, setFound] = useState<Found | null>(null);
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  // Each Enter takes the next number; an answer counts only if no later Enter (or the close) came after it.
  const request = useRef(0);
  useEffect(
    () => () => {
      request.current++;
    },
    [],
  );

  // Closed in the same step as the move, so the arriving page takes focus itself (useRouteFocus leaves an open dialog alone).
  const go = (to: string, state?: unknown) => {
    onClose();
    navigate(to, state === undefined ? undefined : { state });
  };

  const find = async (e: FormEvent) => {
    e.preventDefault();
    const v = q.trim();
    if (!v) return;
    const mine = ++request.current;
    setBusy(true);
    setFound(null);
    try {
      const codeLike = COPY_CODE.test(v);
      // Side by side, and one failing does not blank the others. A typed number can be a mobile, a copy barcode
      // and an ISBN all at once, so none of them is tried instead of another.
      const settled = await Promise.allSettled([
        scope.copies && branchId && codeLike ? findCopy(orgId, branchId, v) : null,
        scope.members && branchId ? searchMembers(orgId, branchId, v) : [],
        // An ISBN in any form finds its title exactly; anything else is a title search (data/catalogue.ts).
        scope.titles ? findBooks(v, TITLES + 1) : [],
      ]);
      if (mine !== request.current) return;
      let failed = false;
      const answer = <T,>(s: PromiseSettledResult<T>, none: T): T => {
        if (s.status === 'fulfilled') return s.value;
        failed = true;
        if (!(s.reason instanceof ApiError)) reportError(s.reason, 'find');
        return none;
      };
      const copy = answer(settled[0], null);
      const members = answer(settled[1], []);
      const titles = answer(settled[2], []);

      // 1. The copy with this code or barcode at the branch (a barcode may look like an ISBN: the copy wins).
      if (copy) return go(paths.adminCopy(copy.id), { copy });
      // 2. The member whose code was typed or scanned in full.
      const code = v.toUpperCase();
      const member = members.find((m) => m.code === code);
      if (member) return go(paths.adminMember(member.id));
      // 3. The title with this ISBN. Ten digits that pass the ISBN check are often a mobile number: with a member
      //    matching as well, the person chooses.
      const isbn = normalizeIsbn(v);
      const byIsbn = isbn ? titles.find((b) => b.isbn === isbn) : undefined;
      if (byIsbn && (v.replace(/[\s-]/g, '').length === 13 || !members.length)) return go(paths.adminBook(byIsbn.id));
      // 4. A single match opens; several are listed.
      if (!failed && members.length + titles.length === 1) return go(members[0] ? paths.adminMember(members[0].id) : paths.adminBook(titles[0].id));
      const list: Found = {
        q: v,
        members: members.slice(0, MEMBERS),
        titles: titles.slice(0, TITLES),
        more: members.length > MEMBERS || titles.length > TITLES,
        failed,
        elsewhere: null,
      };
      // 5. Nothing here: a copy code may belong to a copy held at another branch (a server call, so only now).
      if (!members.length && !titles.length && scope.locate && codeLike) {
        try {
          const where = await locateCopy(orgId, v);
          if (mine !== request.current) return;
          if (where?.canOpen) return go(paths.adminCopy(where.copyId));
          list.elsewhere = where;
        } catch (err) {
          if (mine !== request.current) return;
          // "No such copy" is an answer; anything else means we could not tell.
          if (!(err instanceof ApiError)) reportError(err, 'find');
          if (!(err instanceof ApiError) || err.reason !== 'NOT_FOUND') list.failed = true;
        }
      }
      setFound(list);
    } finally {
      // Unless a later search has taken over.
      if (mine === request.current) setBusy(false);
    }
  };

  // Up and down move between the field and the results (Tab works too).
  const onArrows = (e: ReactKeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const stops = [...(box.current?.querySelectorAll<HTMLElement>('input, a[href]') ?? [])];
    const at = stops.indexOf(document.activeElement as HTMLElement);
    const next = stops[at + (e.key === 'ArrowDown' ? 1 : -1)];
    if (at < 0 || !next) return;
    e.preventDefault();
    next.focus();
  };

  const kinds = [(scope.copies || scope.locate) && lt.findKindCopy, scope.members && branchId && lt.findKindMember, scope.titles && lt.findKindTitle].filter(
    (k): k is string => !!k,
  );
  const nothing = !!found && !found.members.length && !found.titles.length && !found.elsewhere;
  return (
    <Dialog title={lt.find} onClose={onClose} narrow>
      <div ref={box} onKeyDown={onArrows}>
        <form onSubmit={(e) => void find(e)} role="search">
          <div className="field">
            <label htmlFor={id}>{lt.findLabel}</label>
            <input id={id} type="search" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" spellCheck={false} aria-describedby={`${id}-hint`} data-autofocus />
            <span id={`${id}-hint`} className="field-hint">
              {lt.findHint(kinds)}
            </span>
          </div>
          <div className="dialog-actions">
            <button type="button" className="btn btn-text" onClick={onClose}>
              {t.close}
            </button>
            <button type="submit" className="btn btn-filled" disabled={busy || !q.trim()}>
              {busy ? lt.findLooking : lt.find}
            </button>
          </div>
        </form>
        {found?.failed && (
          <p className="notice notice-warn" role="alert">
            {lt.findPartFailed}
          </p>
        )}
        {found?.elsewhere && (
          <p className="notice notice-ok" role="status">
            {lt.copyElsewhere(found.elsewhere.code, found.elsewhere.bookTitle, found.elsewhere.currentBranchName, label(found.elsewhere.status))}{' '}
            {scope.titles && (
              <Link to={paths.adminBook(found.elsewhere.bookId)} onClick={onClose}>
                {lt.viewBook}
              </Link>
            )}
          </p>
        )}
        {found && !found.elsewhere && (
          <p className="find-status" role="status">
            {nothing ? (found.failed ? '' : lt.findNothing(found.q)) : lt.findChoose(found.members.length + found.titles.length)}
            {found.more && ` ${lt.findMore}`}
          </p>
        )}
        {!!found?.members.length && (
          <section className="find-group" aria-labelledby={`${id}-members`}>
            <h3 id={`${id}-members`}>{lt.membersTitle}</h3>
            <ul className="find-list">
              {found.members.map((m) => (
                <li key={m.id}>
                  <Link to={paths.adminMember(m.id)} onClick={onClose}>
                    <strong>{m.fullName}</strong>
                    <span className="muted small">
                      <span className="mono">{m.code}</span>
                      {m.phone && ` · ${m.phone}`}
                      {m.status !== 'ACTIVE' && ` · ${label(m.status)}`}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
        {!!found?.titles.length && (
          <section className="find-group" aria-labelledby={`${id}-titles`}>
            <h3 id={`${id}-titles`}>{lt.findTitles}</h3>
            <ul className="find-list">
              {found.titles.map((b) => (
                <li key={b.id}>
                  <Link to={paths.adminBook(b.id)} onClick={onClose}>
                    <strong>{b.title}</strong>
                    <span className="muted small">
                      {b.authorNames.join(', ')}
                      {' · '}
                      <span className="mono">{b.code}</span>
                      {b.status !== 'ACTIVE' && ` · ${label(b.status)}`}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </Dialog>
  );
}
