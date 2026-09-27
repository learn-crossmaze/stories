# Stories — Circulation

All circulation changes are Cloud Function commands (one Firestore transaction each, audited, idempotent via
`requestId`). The rules below are enforced on the server; the desk UI only mirrors them.

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
| `circulation-return` | `loans.return` | Loans → RETURNED; copies → UNDER_INSPECTION at the receiving branch |
| `circulation-exchange` | `exchanges.process` | Returns + issues in one transaction; exchange count = min(returned, issued) |
| `circulation-declareLost` | `copies.writeOff` | Loan and copy → LOST, slot freed, **deposit deduction proposed** (D5: replacement price, else copy cost; capped at the balance, remainder recorded as `uncoveredMinor`) |
| `copies-inspect` | `copies.manage` | UNDER_INSPECTION → AVAILABLE (or straight to the next waiting member) / DAMAGED |

Concurrency: two librarians issuing the same copy — both transactions read the copy; Firestore retries the loser,
which then sees ISSUED and fails with "not available". Tested.

## Reservations (M1.6)

`orgs/{o}/reservations`: WAITING → ALLOCATED → FULFILLED, or CANCELLED / EXPIRED.

- **Place** (`reservations.manage`): needs an active term; one open reservation per member per title;
  `waitingCount + allocatedCount < plan limit` (D2). If a copy is on the shelf it is **allocated immediately**
  (copy → RESERVED, held `reservationHoldHours`, default 48 — D3, `orgs/{o}/config/circulation`); otherwise WAITING.
- **Allocation** happens atomically whenever a copy becomes available at the branch (acquired, passed inspection,
  repaired, transfer received, hold released): the oldest WAITING reservation for the title gets it.
- **Hold expiry** (`reservations-expireHolds`, every 15 min, idempotent): expired holds pass to the next member
  waiting, else back to the shelf.
- Two members racing for the last copy: one ALLOCATED, one WAITING (tested).

## Transfers

`orgs/{o}/transfers`: DRAFT → IN_TRANSIT → RECEIVED (or CANCELLED while DRAFT). Within one organization only.

- **Create/dispatch** (`books.transfer` at the sending branch): copies must be on that branch's shelf; dispatch
  moves them to IN_TRANSIT.
- **Receive** (`books.transfer` at the destination): each scanned copy must belong to the transfer; good copies go
  on the shelf there (or to a waiting member), damaged ones to DAMAGED. `owningBranchId` never changes.
- All steps audited. Cross-branch *member* borrowing is a later phase.
