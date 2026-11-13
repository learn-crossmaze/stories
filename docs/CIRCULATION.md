# Stories — Circulation

All circulation changes are Cloud Function commands (one Firestore transaction each, audited, idempotent via
`requestId`). The rules below are enforced on the server; the desk UI only mirrors them (see *The desk* below for
what it checks before asking).

## Final rules (BUSINESS_RULES 5–8)

- **Limit = books held at the same time**: `activeLoanCount + allocatedCount ≤ plan.maxSimultaneousBooks`.
  Allocated reservation holds count (D2). A return frees exactly one slot.
- **Unlimited exchanges.** `exchangesThisTerm` and `lifetimeExchanges` are counters, never limits.
- **No borrowing period, no due date, no fines.** Loans have no `dueAt`; the UI shows only how long a book has
  been with the member. (Tested: no loan field matches due/fine/overdue.)
- **Active subscription required to borrow, exchange or reserve** — checked against the clock inside the
  transaction, not the hourly sweep. **Returns are always allowed**, even after expiry.

## Copy state machine

```text
                        ┌──────────── dispatch ─────────────┐
 acquire ─► AVAILABLE ──┼── allocate ─► RESERVED ── issue ─►│ ISSUED ── return ─► UNDER_INSPECTION ── pass ─► AVAILABLE
                │  ▲    │               │  (release/expire/  │   │                        │
                │  └────┼───────────────┘   cancel)          │   └─ declare lost ─► LOST  └── fail ─► DAMAGED
                │       └─► IN_TRANSIT ── receive ─► AVAILABLE / DAMAGED (at destination)
                ├─► DAMAGED ── repair ─► AVAILABLE;   DAMAGED ─► LOST / RETIRED
                ├─► LOST (missing from shelf) ── found ─► UNDER_INSPECTION;   LOST ─► RETIRED
                └─► RETIRED (terminal, kept forever)
```

Every transition not drawn is rejected (`functions/src/inventory/copyState.ts`, unit-tested for all 64 pairs).

## Commands

| Command | Permission (at branch) | Does |
|---|---|---|
| `circulation-issue` | `loans.issue` | 1–10 scanned copies to a member, all-or-nothing. Copy must be at this branch and AVAILABLE, or RESERVED **for this member** (fulfils the reservation) |
| `circulation-return` | `loans.return` | 1–30 copies, all-or-nothing (a drop-box pile; issue and exchange keep 1–10 each way). Loans → RETURNED; copies → UNDER_INSPECTION at the receiving branch; one audit entry and one message per member |
| `circulation-exchange` | `exchanges.process` | Returns + issues in one transaction; exchange count = min(returned, issued) |
| `circulation-declareLost` | `copies.writeOff` | Loan and copy → LOST, slot freed, **deposit deduction proposed** (D5: replacement price, else copy cost; capped at the balance, remainder recorded as `uncoveredMinor`) |
| `copies-inspect` | `copies.manage` | UNDER_INSPECTION → AVAILABLE (or straight to the next waiting member) / DAMAGED; audited either way (`copy.inspected` / `copy.damaged`) |
| `copies-inspectMany` | `copies.manage` | Passes 1–50 copies at one branch in one transaction: each UNDER_INSPECTION → AVAILABLE in the condition on record (or to a waiting member; copies of one title go to different members, oldest first), one `copy.inspected` entry per copy. A copy someone else already decided is skipped and named in `skipped`; a copy at another branch refuses the whole call (`OTHER_BRANCH`). Damaged copies still go through `copies-inspect` |
| `copies-repair` | `copies.manage` | DAMAGED → AVAILABLE (or to the next waiting member); audited (`copy.repair`) |

Issuing at the desk, in an exchange and on a home-delivery dispatch all go through `writeIssue`, which also updates
the member's counters once (books out, holds used, lifetime loans and exchanges, a pending term rollover) and keeps
the shelf the copy left as its `lastLocationId` (its usual shelf, for putting it back; never cleared).

A list that names one copy twice, by its barcode and by its copy code, is refused (`INVALID_INPUT`) in issue, return
and exchange.

Concurrency: two librarians issuing the same copy — both transactions read the copy; Firestore retries the loser,
which then sees ISSUED and fails with "not available". Tested.

## The desk (`/ops/desk`, `apps/web/src/admin/circulation/Desk.tsx`)

- **Member desk, from the keyboard:** the page opens in *Find member*. Scan the card, scan the books, press Enter in
  the empty scan box (or the button, which says so); the desk goes back to *Find member* with a line saying what was
  done for whom and **Open again** (which reads the member afresh). A scanner's own Enter never confirms. When the
  server refuses, the member and the scanned books stay and the scan box has the keyboard again.
- **No scan is lost:** books can be scanned faster than they are looked up; they wait their turn and nothing can be
  confirmed until all have landed. A book the member holds is ticked for return from the list on screen, with no
  lookup (by copy code; a label that differs from the code is looked up and matched by the copy). A scan that is not
  taken stays listed as "CODE: reason" until cleared. The desk stops at 10 books to issue.
- **Checked before asking the server** (only for books to issue, and only when the subscriptions have loaded): no
  term in force by the clock, a membership that is not active, or more books than the plan allows. The reason is
  shown and the button waits. A return on its own is never held back, and when the subscriptions could not be read
  the server decides.
- **Renew and pay at the desk:** a member with no term in force, or with a payment pending, gets the member page's
  subscription card under their name (Subscribe, Record payment, Collect online, with the same permissions at the
  member's home branch). The scanned books stay; afterwards only the plan and the member's counts are read again.
- **Quick return:** any number of books; they are sent 30 to a call, and the books of a call that went through
  leave the list even when a later call is refused. Each row can be taken off the list.
- **Inspection:** every waiting copy is ticked; **Back on the shelf (N)** passes the ticked ones in one call
  (`copies-inspectMany`). *Damaged* stays one copy at a time. Staff still decide: untick a book to leave it waiting.

## Reservations (M1.6)

`orgs/{o}/reservations`: WAITING → ALLOCATED → FULFILLED, or CANCELLED / EXPIRED.

- **Place** (`reservations.manage`): needs an active term; one open reservation per member per title;
  `waitingCount + allocatedCount < plan limit` (D2). If a copy is on the shelf it is **allocated immediately**
  (copy → RESERVED, held `reservationHoldHours`, default 48 — D3, `orgs/{o}/config/circulation`); otherwise WAITING.
- **Allocation** happens atomically whenever a copy becomes available at the branch (acquired or received,
  passed inspection, repaired, transfer received, hold released): the oldest WAITING reservation for the title gets
  it. Every path uses the one helper `allocate()` (`circulation/allocation.ts`), so the copy, reservation and member
  counters always change together and the member is always told the book is ready (`reservation_ready`).
- **Hold expiry** (`reservations-expireHolds`, every 15 min, idempotent): expired holds pass to the next member
  waiting, else back to the shelf.
- Two members racing for the last copy: one ALLOCATED, one WAITING (tested).
- **The Reservations page** reads both lists (ready for pickup, waiting) once and shows their counts on the tabs
  (no count on a full page of 100). The first time *Waiting* is opened it asks `copies-availabilityMany` (60 titles
  a call) which **other branch has each title on its shelf** and shows "Branch N" beside the row. This is a hint
  of that moment to ask that branch for a transfer: reservations stay per branch, the queue order is not changed,
  and the list works when the counts can't be read.

## Transfers

`orgs/{o}/transfers`: DRAFT → IN_TRANSIT → RECEIVED (or CANCELLED while DRAFT). Within one organization only.

- **Create/dispatch** (`books.transfer` at the sending branch): `transfers-create` takes **copy ids** (1–50, each
  once), not barcodes; every copy must be AVAILABLE on that branch's shelf, or nothing is written. With
  `dispatch: true` (what the console sends) the transfer is created already IN_TRANSIT in the same transaction:
  the copies move to IN_TRANSIT (`TRANSFER_DISPATCHED` each) and both audit entries (`transfer.create`,
  `transfer.dispatch`) are written. Without it the transfer is a DRAFT, sent later with `transfers-dispatch` or
  cancelled with `transfers-cancel`. Each item keeps the copy's `barcode`, and from dispatch its `conditionOut`.
- **Receive** (`books.transfer` at the destination): each scan is matched against the transfer's own copies
  (label first, then copy code), read in one go. A value that matches none is `NOT_IN_TRANSFER`, a copy received
  before is `ALREADY_RECEIVED`, and a copy named twice in one call is refused. Good copies go on the shelf there
  (or to a waiting member, oldest first), damaged ones to DAMAGED. A copy **keeps its condition** unless one is sent
  for it. With `locationId` (an open shelf of the destination; also needs `copies.manage` there) the copies free to
  shelve go **straight onto that shelf**; copies held for a member and damaged ones are not shelved. The answer
  says how many were shelved and lists the copies now **held for waiting members** (`allocated`, with the member's
  name and code only for staff with `members.view` there). `owningBranchId` never changes.
- **In the console** (`apps/web/src/admin/circulation/Transfers.tsx`): *New transfer* opens on the scan field;
  each scan is listed at once and looked up behind, so the next book can be scanned straight away. Rows can be
  removed, the list stops at 50, and Dispatch waits until every row is a copy that can go. *Dispatch and start
  another* keeps the dialog open for the next box. *Receive* lists the copies still to come: scan or tick each,
  a scan that is not part of the transfer is refused at once, and a shelf can be picked for the lot. Afterwards
  the page says which books to set aside for members (the notice goes when the workspace moves to another
  branch). Both dialogs ask before a scanned list is thrown away. In both, a scan that lands on a tick box or a
  list does nothing (Enter does not press the main button there, and typed characters pick no option; arrow keys
  and Space still work), and a tick or a pick made with the mouse gives the keyboard back to the scan field.
- **From Receive books** (`apps/web/src/admin/catalogue/ReceiveSend.tsx`): a delivery just received can be sent
  on without scanning it again. *Send to branches* takes a number per title and branch and sends one
  `transfers-create` with `dispatch: true` per branch (the copy ids come from the `copies-receive` answer; over
  50 copies for a branch are split into several transfers). Copies held for members waiting at the sending
  branch are left out, and a refusal (`COPY_NOT_AVAILABLE`) is shown for that branch only. Receiving at the
  destination is unchanged. See [LIBRARY.md](LIBRARY.md) (Receive books).
- All steps audited. Cross-branch *member* borrowing is a later phase.
