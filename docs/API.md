# Stories — Cloud Functions API conventions

All app operations are **actions** named `<group>-<name>` (e.g. `branches-create`), implemented in
`functions/src/core/callable.ts`. They are deployed through **six router functions** in `asia-south1` —
`admin`, `catalogue`, `inventory`, `members`, `billing`, `circulation` (`functions/src/index.ts`) — plus two scheduled
jobs. The client calls a router with `{ action, ...data }` (`apps/web/src/data/api.ts` picks the router from the
action prefix). Each Cloud Function is its own Cloud Run service reserving CPU; ~60 separate functions exceeded the
project's regional CPU quota, eight services stay well inside it. Routing doesn't change behaviour: the router
passes the request to the action's own handler, so every check below applies unchanged; unknown actions are rejected.

## Two kinds of callable

| Kind | Helper | Pipeline |
|---|---|---|
| **Command** (changes data) | `command(name, schema, handler, after?)` | auth → zod validation (strict: unknown fields rejected) → **one Firestore transaction**: idempotency lookup → handler (permission check via `actor.require`, business rules, writes, `recordAudit`) → store result under `idempotency/{name}:{uid}:{requestId}` → commit → `after` side effects (e.g. claims sync) |
| **Query / idempotent op** | `query(name, schema, handler)` | auth → validation → handler |

- **`requestId`** (UUID, required on commands): the web client generates one per user action (`data/api.ts`
  `command()`); a retry with the same id returns the stored result instead of repeating the change. Records expire
  via Firestore TTL on `expireAt` (30 days).
- **Permissions** are checked against the *authoritative* membership documents inside the transaction, not token
  claims (claims can lag a revocation).
- **Audit**: `recordAudit(tx, …)` writes `orgs/{o}/auditLogs` (or `platformAuditLogs`) in the same transaction, so a
  change can never commit without its audit entry.

## Errors

Domain failures throw `AppError(code, reason, message)`: `message` is written for end users, `reason` is a stable
machine code (`FORBIDDEN`, `INVALID_INPUT`, `NOT_FOUND`, `BRANCH_CODE_TAKEN`, `USER_NOT_FOUND`,
`EMAIL_NOT_VERIFIED`, `ALREADY_BOOTSTRAPPED`, …). Unexpected errors are logged server-side and returned as a generic
"Something went wrong" — internals never reach the client.

## Phase 0 callables

| Name | Permission | Input (besides `requestId`) |
|---|---|---|
| `users-ensureProfile` | signed in | — (query) |
| `platform-bootstrapSuperAdmin` | configured owner email, verified, once | — |
| `orgs-create` / `orgs-update` | Super Admin | `name, type` / `orgId, name?, status?` |
| `branches-create` | `branches.manage` | `orgId, code, name, address, contact, operatingHours, weeklyOffs` |
| `branches-update` / `branches-archive` | `branches.manage` (at branch) | `orgId, branchId, …` / `orgId, branchId, reason` |
| `departments-create` / `-rename` / `-archive` | `departments.manage` | `orgId, name, branchId?` / `…departmentId, name` / `…departmentId, reason` |
| `branches-setNumbering` | `branches.manage` (at branch) | `orgId, branchId, copy, member, location, employee` (patterns, `''` = default; see NUMBERING.md) |
| `staff-setRoles` | `staff.manageRoles` + grant rules (RBAC.md §4.1) | `orgId, email, roles[], branchIds[], employeeId?` (blank = keep or auto-number) |
| `staff-revoke` | same | `orgId, uid, reason` |

## Phase 1 callables

| Group | Callables | Permission |
|---|---|---|
| Catalogue | `books-create/update/archive/setNumbering/setCover` (`bookId, image` base64 or `null`), `authors-`, `publishers-`, `categories-` `create/rename/archive` | `books.create`/`books.edit` in a corporate org (or Super Admin) |
| Inventory | `copies-acquire/relocate/recordCondition/inspect/repair/found`, `locations-create/archive` | `copies.manage` at the copy's branch |
| | `copies-markLost/retire` | `copies.writeOff` |
| | `copies-availability` (query) | any signed-in user |
| Members | `members-register/update/setStatus` | `members.manage` at the home branch |
| Plans | `plans-create/update/archive` | `plans.manage` |
| Subscriptions | `subscriptions-create/cancelPending` | `subscriptions.manage` |
| Payments | `payments-recordOffline` | `payments.recordOffline` |
| Deposits | `deposits-proposeAdjustment`, `deposits-startSettlement` / `deposits-decide` / `deposits-refund` | `deposits.adjust` / `deposits.approve` / `deposits.refund` |
| Circulation | `circulation-issue/return/exchange/declareLost` | `loans.issue` / `loans.return` / `exchanges.process` / `copies.writeOff` |
| Reservations | `reservations-place/cancel` | `reservations.manage` |
| Transfers | `transfers-create/dispatch/cancel` (sending branch), `transfers-receive` (destination) | `books.transfer` |

Scheduled: `scheduled-expireSubscriptions` (hourly), `scheduled-expireHolds` (every 15 minutes), both idempotent.
