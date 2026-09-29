# Stories — Cloud Functions API conventions

All app operations are **actions** named `<group>-<name>` (e.g. `branches-create`), implemented in
`functions/src/core/callable.ts`. They are deployed through **seven router functions** in `asia-south1` —
`admin`, `catalogue`, `inventory`, `members`, `billing`, `circulation`, `hr` (`functions/src/index.ts`) — plus the
scheduled jobs listed at the end. The client calls a router with `{ action, ...data }` (`apps/web/src/data/api.ts` picks the router from the
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
| Catalogue | `books-create/update/archive/restore/delete/setNumbering/setCover` (`bookId, image` base64 or `null`, or `imageUrl` from a lookup), `books-lookup` (query: `q` title or ISBN), `authors-`, `publishers-`, `categories-` `create/rename/archive` | `books.create` (HO, BM) for `books-create`, `books-lookup`, `*-create` and a first cover; `books.edit` (HO) for the rest; in a corporate org (or Super Admin) |
| Inventory | `copies-acquire/relocate/recordCondition/inspect/repair/found`, `locations-create/archive` | `copies.manage` at the copy's branch |
| | `copies-markLost/retire` | `copies.writeOff` |
| | `copies-availability` (query) | any signed-in user |
| | `copies-availabilityMany` (query) — per-branch counts for up to 60 titles (catalogue search) | any signed-in user |
| | `copies-locate` (query) — which branch holds a copy, by barcode or code | `books.view` in the org (any branch) |
| Members | `members-register/update/setStatus` | `members.manage` at the home branch |
| | `members-indexList` (query) — one-time fill of plan/renewal date for a branch's older members | `members.view` at the branch |
| Plans | `plans-create/update/archive` | `plans.manage` |
| Subscriptions | `subscriptions-create/cancelPending` | `subscriptions.manage` |
| Payments | `payments-recordOffline` | `payments.recordOffline` |
| | `payments-createRequest` (`subscriptionId, channel: LINK\|QR, requestId`), `payments-cancelRequest` | `payments.recordOffline` at the subscription's branch |
| | `payments-checkRequest` (query) | `payments.view` |
| | `branches-setPaymentGateway`, `branches-testPaymentGateway` (query) | `branches.manage` |
| | `razorpayWebhook` (HTTPS, signed by Razorpay) | webhook secret of the branch in `?o=&b=` |
| Deposits | `deposits-proposeAdjustment`, `deposits-startSettlement` / `deposits-decide` / `deposits-refund` | `deposits.adjust` / `deposits.approve` / `deposits.refund` |
| Circulation | `circulation-issue/return/exchange/declareLost` | `loans.issue` / `loans.return` / `exchanges.process` / `copies.writeOff` |
| Reservations | `reservations-place/cancel` | `reservations.manage` |
| Transfers | `transfers-create/dispatch/cancel` (sending branch), `transfers-receive` (destination) | `books.transfer` |

## HRMS callables (`hr` router, docs/HRMS.md)

| Group | Callables | Permission |
|---|---|---|
| Employees | `employees-create` (DRAFT record; links a Stories account with the same email), `employees-update` (job changes recorded with `effectiveDate`), `employees-linkAccount`, `employees-backfill` (records for staff who only had roles; safe to repeat) | `employees.edit` at the employee's branch (org-wide for head-office records and backfill) |
| | `employees-transition` (`START_ONBOARDING, ACTIVATE, RESIGN, WITHDRAW_RESIGNATION, START_OFFBOARDING, COMPLETE_OFFBOARDING, REHIRE`), `employees-checkItem` | `employees.lifecycle` (never on yourself) |
| | `employees-setPrivate` | `employees.privateData` |
| | `employees-setBank`, `employees-revealBank` (audited) | `employees.bank` |
| Settings | `designations-create/rename/archive`, `hr-setChecklists`, `documentTypes-save/archive` | `hr.config` |
| Documents | `documents-upload` (base64 PDF/JPEG/PNG, 5 MB), `documents-remove` | `documents.verify` or `employees.edit` at the employee's branch; the employee for self-upload types (and to withdraw a pending upload) |
| | `documents-review` (`VERIFY` / `REJECT` with reason; never your own upload) | `documents.verify` |
| | `documents-open` (query, audited) | as upload, or the employee |
| Attendance | `shifts-save/archive`, `holidays-save/remove` | `hr.config` |
| | `attendance-assignShift`, `attendance-adjust` (reason; never your own day) | `attendance.manage` at the employee's branch |
| | `attendance-punch` (`punch: IN\|OUT`; own, or for someone else at the desk) | the employee; `attendance.manage` for others |
| | `attendance-requestCorrection` / `attendance-decideCorrection` | the employee / `corrections.approve` (never your own) |
| | `attendance-finalize` (query; writes the month; refused while corrections or leave wait), `attendance-reopen` | `attendance.finalize` for the branch (org-wide for head office) |
| Leave | `leaveTypes-save/archive` | `hr.config` |
| | `leave-apply` (`typeId`, `from`, `to`, `halfDay: NONE\|FIRST\|SECOND`, reason; own, or `employeeId` for someone else) | the employee; `leave.approve` at the branch for others |
| | `leave-decide` (`APPROVE` / `REJECT` with note; never your own) | `leave.approve` at the employee's branch |
| | `leave-cancel` (note required for someone else's) | the employee (waiting, or approved and not started); `leave.adjust` for any |
| | `leave-adjust` (`typeId`, `year`, `days` ±, reason; never your own) | `leave.adjust` at the employee's branch |
| | `leave-accrue` (query; credits a month, safe to repeat) | `leave.adjust` org-wide |

No action may take an input named `action`: the router uses that field for the action name (`test/unit/routers.test.ts` checks it).

`staff-setRoles` (admin router) links or creates the person's employee record, so nobody has two.

Scheduled: `scheduled-expireSubscriptions` (hourly), `scheduled-expireHolds` (every 15 minutes), `scheduled-expireDocuments` (daily 00:30 IST), `scheduled-accrueLeave` (daily 00:45 IST), all idempotent.
