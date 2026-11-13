# Stories — Cloud Functions API conventions

All app operations are **actions** named `<group>-<name>` (e.g. `branches-create`), implemented in
`functions/src/core/callable.ts`. They are all served by **one function, `api`**, in `asia-south1`
(`functions/src/index.ts`), plus the scheduled jobs listed at the end. The client calls it with
`{ action, ...data }` (`apps/web/src/data/api.ts`). Each Cloud Function is its own Cloud Run service that reserves CPU
and goes to sleep on its own when idle, so one function for everything means any call from any screen keeps the whole
backend awake (the services are listed in docs/DEPLOYMENT.md). Routing doesn't change behaviour: the router
(`core/router.ts`) passes the request to the action's own handler, so every check below applies unchanged; unknown
actions are rejected (`not-found`, "Unknown action.").

- **The seven older routers** (`admin`, `catalogue`, `inventory`, `members`, `billing`, `circulation`, `hr`) still
  serve the actions they always served, **for one release**: browser tabs still open on the older app keep working,
  and so does a web build that reaches people before the backend is deployed (the web falls back to them, with the
  same `requestId`, while `api` is not there yet). Remove them, and the web's fallback, in a later release.
- **`{ action: 'ping' }`** is the router's own: a signed-in caller gets `{ ok: true }`, nothing is written. The
  console and the member area send it when they open and when their tab comes back into view (at most once in
  10 minutes), so the first real action does not wait for the function to start.
- **The CORS preflight is cached for 2 hours** (`Access-Control-Max-Age: 7200`), so a call is one HTTP round trip,
  not two.

## Two kinds of callable

| Kind | Helper | Pipeline |
|---|---|---|
| **Command** (changes data) | `command(name, schema, handler, after?, { prepare? })` | signed in → zod validation (strict: unknown fields rejected) → optional `prepare` (network calls, outside the transaction; skipped on a replay) → **one Firestore transaction**: idempotency lookup, read together with the caller's membership of `input.orgId`, while their profile loads (a disabled account is refused, also on a replay) → handler (permission check via `actor.require`, business rules, writes, `recordAudit`) → store result under `idempotency/{name}:{uid}:{requestId}` → commit → `after` side effects (e.g. claims sync) |
| **Query / idempotent op** | `query(name, schema, handler)` | signed in → validation → load the caller (with their membership of `input.orgId`, in the same read) → handler |

- **`requestId`** (UUID, required on commands): the web client generates one per user action (`data/api.ts`
  `command()`); a retry with the same id returns the stored result instead of repeating the change. Records expire
  via Firestore TTL on `expireAt` (30 days).
- **`after` must be idempotent.** Until it succeeds the stored record stays `afterPending`; the caller gets
  `aborted`/`AFTER_PENDING` and a retry with the same requestId runs `after` again (the web retries automatically).
- **Never call another service inside the transaction** (it re-runs on contention and holds the transaction open):
  use `prepare`, which must check permissions itself before reading anything private.
- **The web client retries** `aborted`, `unavailable`, `deadline-exceeded` and dropped connections with the same
  requestId, and remembers the requestId of a command whose outcome stayed unknown, so a second click replays it.
- **Don't return secrets from a command**: its result is stored in `idempotency/*` for 30 days. Reveal private
  values with a `query` plus `recordAuditNow`.
- **Permissions** are checked against the *authoritative* membership documents inside the transaction, not token
  claims (claims can lag a revocation).
- **Audit**: `recordAudit(tx, …)` writes `orgs/{o}/auditLogs` (or `platformAuditLogs`) in the same transaction, so a
  change can never commit without its audit entry.

## Errors

Domain failures throw `AppError(code, reason, message)`: `message` is written for end users, `reason` is a stable
machine code (`FORBIDDEN`, `INVALID_INPUT`, `NOT_FOUND`, `BRANCH_CODE_TAKEN`, `USER_NOT_FOUND`,
`EMAIL_NOT_VERIFIED`, `ALREADY_BOOTSTRAPPED`, …). Firestore contention or overload returns `aborted`/`BUSY`
(retryable). Unexpected errors are logged server-side and returned as a generic "Something went wrong" — internals
never reach the client.

## Logs

Every call writes one structured line (`fn`, `uid`, `orgId`, `requestId`, `phase`, `ms`, `replayed`); domain errors
are logged at info level with their `reason`, unexpected ones at error level with the stack. Inputs are never
logged. Scheduled jobs log one summary per run (`job`, `processed`, `changed`, `failed`, `complete`) and one error
line per failed document (`path`). Useful Cloud Logging filters: `jsonPayload.fn="copies-receive"`,
`severity>=WARNING AND jsonPayload.job:*`.

## Phase 0 callables

| Name | Permission | Input (besides `requestId`) |
|---|---|---|
| `users-ensureProfile` | signed in | — (query) |
| `platform-bootstrapSuperAdmin` | configured owner email, verified, once | — |
| `orgs-create` / `orgs-update` | Super Admin | `name, type` / `orgId, name?, status?` |
| `branches-create` | `branches.manage` | `orgId, code, name, address, contact, operatingHours, weeklyOffs` |
| `branches-update` / `branches-archive` | `branches.manage` (at branch) | `orgId, branchId, …` / `orgId, branchId, reason` |
| `departments-create` / `-rename` / `-archive` | `departments.manage` | `orgId, name, branchId?` / `…departmentId, name` / `…departmentId, reason` |
| `orgs-setNumbering` | `branches.manage` across all branches | `orgId, employee, headOfficeCode` (head-office employee ID pattern and the code `{BRANCH}` stands for; `''` = default / HO) |
| `branches-setNumbering` | `branches.manage` (at branch) | `orgId, branchId, copy, member, location, employee` (patterns, `''` = default; see NUMBERING.md) |
| `staff-setRoles` | `staff.manageRoles` + grant rules (RBAC.md §4.1) | `orgId, email, roles[], branchIds[], employeeId?` (blank = keep or auto-number; the web no longer sends it: IDs are set on the employee record) |
| `staff-revoke` | same | `orgId, uid, reason` |

## Phase 1 callables

| Group | Callables | Permission |
|---|---|---|
| Catalogue | `books-create/update/archive/restore/delete/setNumbering/setCover`, `books-bulkCreate` (`items`: 1–25 looked-up titles; returns `created` and `skipped`) (`bookId, image` base64 or `null`, or `imageUrl` from a lookup), `books-create` takes authors and the publisher by id (`authorIds`, `publisherId`) and/or by name (`newAuthors`: up to 5 names, `newPublisher`: a name or `null`; matched to the active author or publisher of that name, else added in the same transaction; 1–5 authors in all, one publisher at most; `books-update` takes ids only), `books-lookup` (query: `q` title or ISBN, optional `exact: true` = "only this ISBN": answered as soon as Google Books has it; each candidate has `ageGroup`, a guess or `null`; `sources` entries are `{ source, ok }`, or `{ source, ok: null, skipped: true }` for a source not waited for), `books-usage` (query: `bookId`), `authors-`, `publishers-`, `categories-` `create/rename/archive` | `books.create` (HO, BM, LIB, CM) for `books-create`, `books-bulkCreate`, `books-lookup`, `*-create` and a first cover; `books.edit` (HO) for the rest; in a corporate org (or Super Admin) |
| Inventory | `copies-acquire/relocate/recordCondition/inspect/repair/found`, `locations-create/archive` | `copies.manage` at the copy's branch |
| | `copies-receive` (`branchId, locationId, condition, items`: 1–25 of `{bookId}` or `{book}` (a looked-up or typed title) with `quantity`, `acquisitionCostMinor`; ≤ 100 copies) | `copies.manage` at the branch; `books.create` too when a title is new |
| | `copies-shelve` (`branchId, locationId, copyIds`: 1–100; returns `shelved`, `unchanged`) — puts copies at the branch on one shelf | `copies.manage` at the branch |
| | `copies-inspectMany` (`branchId, copyIds`: 1–50; returns `passed` copy ids and `skipped` codes) — passes the inspection of many returned copies, each kept in the condition on record; a copy no longer under inspection is skipped | `copies.manage` at the branch |
| | `copies-markLost/retire` | `copies.writeOff` |
| | `copies-availability` (query) | any signed-in user |
| | `copies-availabilityMany` (query) — per-branch counts for up to 60 titles (catalogue search; the Reservations waiting list, to show which other branch has a title on its shelf) | any signed-in user |
| | `copies-locate` (query) — which branch holds a copy, by barcode or code | `books.view` in the org (any branch) |
| WhatsApp | `whatsapp-overview`, `whatsapp-saveConnection` (`phoneNumberId, wabaId, accessToken` write-only, `appSecret`, `language`, `enabled`), `whatsapp-saveTemplate` (`event, enabled, name, language, body`), `whatsapp-addTemplates` (`events[]`: adds the ones the branch lacks with the default wording, switched off; returns `{ added }`), `whatsapp-switchTemplates` (`events[], enabled`: only templates the branch has; returns `{ switched }`), `whatsapp-removeTemplate` (`event`), `whatsapp-submitTemplate` (`event`), `whatsapp-syncTemplates`, `whatsapp-sendTest` (`to`, `event` or null for hello_world), `whatsapp-log` — see [WHATSAPP.md](WHATSAPP.md) | `messaging.manage` at the branch (HO, FO, BM) |
| Members | `members-register/update/setStatus` (optional `aadhaar`: 12 digits; empty keeps the one on file), `members-revealAadhaar` (audited) | `members.manage` at the home branch |
| Plans | `plans-create/update/archive` (`options[]`: 1–4 of `{duration, priceMinor}`; `discount`: `{type AMOUNT|PERCENT, value, from, to, durations[], label}` or null; see SUBSCRIPTIONS.md) | `plans.manage` |
| Subscriptions | `subscriptions-create/cancelPending` (`duration`: the billing option; optional when the plan has one). `subscriptions-create` also takes an optional `payment: {method, amountMinor, reference}` (staff only; `me-subscribe` refuses it): the plan is sold and the counter payment recorded in one step, and the result adds `paymentId, startAt, endAt` | `subscriptions.manage`; with `payment` also `payments.recordOffline`, both at the member's branch |
| | `subscriptions-upgradeQuote` (query: `memberId`; returns `current` with `termDays`, `unusedDays`, `creditMinor`, and `options` with fee, deposit, total and new dates, or `blocked`), `subscriptions-upgrade` (`memberId, planId, duration`) — pro-rated mid-term upgrade; members: `me-upgradeQuote`, `me-upgrade` | `subscriptions.manage` at the member's branch; members for their own or their wards' memberships |
| Payments | `payments-recordOffline` | `payments.recordOffline` |
| | `payments-createRequest` (`subscriptionId, channel: LINK\|QR, requestId`), `payments-cancelRequest` | `payments.recordOffline` at the subscription's branch |
| | `payments-checkRequest` (query) | `payments.view` |
| | `payments-refund` (query; `paymentId, amountMinor, depositMinor, method: RAZORPAY\|OFFLINE_*, reference, speed, reason, requestId`) | `payments.refund` at the payment's branch |
| | `payments-checkRefund` (query) | `payments.view` |
| | `branches-setPaymentGateway`, `branches-testPaymentGateway` (query) | `branches.manage` |
| | `razorpayWebhook` (HTTPS, signed by Razorpay) | webhook secret of the branch in `?o=&b=` |
| Deposits | `deposits-proposeAdjustment`, `deposits-startSettlement` / `deposits-decide` / `deposits-refund` | `deposits.adjust` / `deposits.approve` / `deposits.refund` |
| Circulation | `circulation-issue/return/exchange/declareLost` (`barcodes`: 1–10 to issue, 1–30 in a return; `returnBarcodes`, `issueBarcodes`: 1–10 each in an exchange; a copy named twice, by its barcode and its code, is refused) | `loans.issue` / `loans.return` / `exchanges.process` / `copies.writeOff` |
| Reservations | `reservations-place/cancel` | `reservations.manage` |
| Transfers | `transfers-create` (`fromBranchId, toBranchId, copyIds[1–50, each once], note?, dispatch?`; with `dispatch: true` the transfer is created already in transit, otherwise a draft; returns `transferId`), `transfers-dispatch` / `transfers-cancel` (a draft; sending branch), `transfers-receive` (destination: `transferId, items[1–50]{barcode (label or copy code), condition? (kept when left out), damaged?}, locationId?`; returns `complete`, `shelved` and `allocated[{code, bookTitle, memberName, memberCode}]`, the copies now held for waiting members, named only with `members.view` there) | `books.transfer`; `transfers-receive` with `locationId` also `copies.manage` at the destination |
| Home delivery | `deliveries-settings` (query), `deliveries-saveSettings` (fee, PIN codes, slots, location, ways, courier keys write-only) — see [DELIVERY.md](DELIVERY.md) | `delivery.configure` (HO, FO, BM); settings read also `delivery.manage` |
| | `deliveries-create` (`branchId, memberId, kind DELIVER\|PICKUP\|EXCHANGE, date, slot, address{…, geo}, note, holdIds, collectLoanIds`; the address is also kept on the member as `deliveryAddress` for the next booking), `deliveries-list` (query: `branchId, closed?`; returns `{open, closed}`, with `closed` empty unless `closed: true` asks for the visits closed in the last 14 days), `deliveries-counts` (query: `branchId`; returns `{requested, returning}`, the visits to dispatch and the bags to receive), `deliveries-get` (query), `deliveries-receive`, `deliveries-cancel` (`reason`), `deliveries-recordFee` (`method` OFFLINE_* or WAIVED), `deliveries-sync` (query: `branchId, deliveryId?`; courier statuses of up to 10 orders asked together, or of one delivery of that branch) | `delivery.manage` at the branch |
| | `deliveries-dispatch` (`barcodes, method OWN\|MANUAL\|PORTER, riderUid, courier{name, reference, trackingUrl}, waiveFee`; books are issued, a courier app is booked after commit), `deliveries-quote` (query: `courier`), `deliveries-book` (query: book the courier again) | `delivery.assign` at the branch |
| | `deliveries-mine` (query), `deliveries-report` (`outcome DELIVERED\|FAILED, collectedLoanIds, failReason, handedTo, fee{method, reference}`) | the assigned rider (`delivery.execute`), or `delivery.manage` |
| | `me-requestDelivery`, `me-cancelDelivery` (member self-service) | the member's account holder or guardian; plan must include home delivery |
| | `deliveryWebhook` (HTTPS, courier status updates) | the branch's token in `?o=&b=&t=` |

## Website callables (docs/WEBSITE_ADMIN.md)

Rights are worked out across all of the caller's organizations (`rightsOf` in `functions/src/site/admin.ts`), so no
`orgId` is sent except for a branch page.

| Group | Callables | Permission |
|---|---|---|
| Overview and lists | `site-overview` (query; `counts`: `newSubmissions`, `callsThisWeek`, `openJobs`, and `alertRecipients`, the number of people on the enquiry alerts list, `null` unless a website manager), `site-list` (query: `kind`), `site-get` (query: `kind, id?, orgId?`) | `website.manage`, `website.branch` or `blog.write`; each sees what they may edit |
| Items | `site-save` (`kind, id?, orgId?, draft, publish?`; with `publish: true` the saved draft goes on the website in the same transaction, and nothing is saved if it can't be published), `site-publish`, `site-unpublish`, `site-requestReview` (posts). All four return how the item now stands (`id, exists, status, isLive, changed, liveSlug, liveOn, previewToken, review, updatedAt, updatedBy, publishedAt, publishedBy, canPublish, canDelete`), never the draft; the publishing ones also `result` (`publish`, `unpublish` or `none`) | `website.manage` for everything; `website.branch` for the branch's page and posts about the branch; `blog.write` to save one's own posts and ask for a review |
| | `site-discard`, `site-delete`, `site-publishAll` (returns `published`, `blocked`), `site-uploadImage` (query: `image` base64, 2 MB at most; the file is named after `requestId`) | as above |
| Enquiries | `site-submissions` (query: `limit?`, `open?`; `open: true` = only those not handled yet), `site-submission` (query: `id`; one enquiry, not found when it is another branch's), `site-resume` (query) | `website.manage` (all) or `website.branch` (their branches') |
| | `site-markHandled` (`id, handled, note?`; the note changes only when one is sent), `site-deleteSubmission` | as above; delete: `website.manage` |
| Settings | `site-calls` (query: `days`), `site-connections` (query), `site-saveConnections`, `site-admins` (query) | `website.manage` |

## HRMS callables (docs/HRMS.md)

| Group | Callables | Permission |
|---|---|---|
| Employees | `employees-create` (DRAFT record; links a Stories account with the same email), `employees-update` (job changes recorded with `effectiveDate`), `employees-linkAccount`, `employees-backfill` (records for staff who only had roles; safe to repeat) | `employees-create`: `employees.add` (HO, HR, FO, and BM at their own branches); the rest `employees.edit` at the employee's branch (org-wide for head-office records and backfill) |
| | `employees-transition` (`START_ONBOARDING, ACTIVATE, RESIGN, WITHDRAW_RESIGNATION, START_OFFBOARDING, COMPLETE_OFFBOARDING, REHIRE`), `employees-checkItem` | `employees.lifecycle` (never on yourself) |
| | `employees-setPrivate` | `employees.privateData`, or the employee themselves (self-onboarding) |
| | `employees-setPhoto` (`image`: base64 JPEG/PNG/WebP ≤ 1 MB, or `null` to remove) | `employees.edit`, or the employee themselves |
| | `employees-revealAadhaar` (audited) | `employees.privateData`, or the employee themselves |
| | `employees-setBank`, `employees-revealBank` (audited) | `employees.bank`; the employee may add their own bank account once (`setBank`) |
| | `hr-setSelfOnboarding` (`requiredFields`: personal details staff must fill in) | `hr.config` |
| Settings | `designations-create/rename/archive`, `hr-setChecklists`, `documentTypes-save/archive` | `hr.config` |
| Documents | `documents-upload` (base64 PDF/JPEG/PNG, 5 MB), `documents-remove` | `documents.verify` or `employees.edit` at the employee's branch; the employee for self-upload types (and to withdraw a pending upload) |
| Offer letters | `offers-preview` (query; PDF marked PREVIEW), `offers-release` (files the PDF in the employee's documents), `offers-withdraw` (`offerId`, `reason`), `offers-open` (query; audited) | `offers.release` (HR, FO, BM) at the employee's branch; never your own letter. `offers-open` also for the employee |
| Letters and templates | `letters-preview` (query), `letters-issue` (`kind` APPOINTMENT or CUSTOM, `templateId`, values the template uses); `letterTemplates-save/publish/archive`, `letterTemplates-preview` (query, sample values), `letterTemplates-defaults` (query: built-in wording and placeholders) | `letters.issue` at the employee's branch (never your own) for letters; `hr.config` for templates; `letterTemplates-defaults` any member |
| | `documents-review` (`VERIFY` / `REJECT` with reason; never your own upload) | `documents.verify` |
| | `documents-open` (query, audited) | as upload, or the employee |
| Attendance | `shifts-save/archive`, `holidays-save/remove` | `hr.config` |
| | `attendance-assignShift`, `attendance-adjust` (reason; never your own day) | `attendance.manage` at the employee's branch |
| | `attendance-punch` (`punch: IN\|OUT`; own, or for someone else at the desk). Returns the day it wrote: `date` (a check-out can close yesterday's overnight day), `status`, `late`, `lateMinutes`, `earlyExit`, `missedCheckout`, `workedMinutes`, and `checkIn` / `checkOut` in milliseconds | the employee; `attendance.manage` for others |
| | `attendance-requestCorrection` / `attendance-decideCorrection` | the employee / `corrections.approve` (never your own) |
| | `attendance-finalize` (query; writes the month; refused while corrections or leave wait), `attendance-reopen` (refused while that month's payroll is submitted or approved) | `attendance.finalize` for the branch (org-wide for head office) |
| Leave | `leaveTypes-save/archive` | `hr.config` |
| | `leave-apply` (`typeId`, `from`, `to`, `halfDay: NONE\|FIRST\|SECOND`, reason; own, or `employeeId` for someone else; `approve: true` approves leave recorded for someone else in the same step, never your own). Returns `leaveId`, `days`, `status` | the employee; `leave.approve` at the branch for others |
| | `leave-decide` (`APPROVE` / `REJECT` with note; never your own) | `leave.approve` at the employee's branch |
| | `leave-cancel` (note required for someone else's) | the employee (waiting, or approved and not started); `leave.adjust` for any |
| | `leave-adjust` (`typeId`, `year`, `days` ±, reason; never your own) | `leave.adjust` at the employee's branch |
| | `leave-accrue` (query; credits a month, safe to repeat) | `leave.adjust` org-wide |
| Payroll | `payrollSettings-save` (a version from a month) | `salary.edit` org-wide |
| | `salary-save` (a version from a month; reason; never your own) | `salary.edit` at the employee's branch |
| | `payroll-setInputs` (TDS, other earnings and deductions for a month; never your own) | `payroll.run` at the employee's branch |
| | `payroll-prepare` (query; writes the run and payslips), `payroll-submit` | `payroll.run` for the branch (org-wide for head office) |
| | `payroll-decide` (`APPROVE` publishes payslips / `REJECT` with note; never the preparer or submitter) | `payroll.approve` for the branch |
| | `payslips-download` (query; PDF, base64; audited unless your own) | the employee (published) or `payslips.viewAll` |

No action may take an input named `action`: the router uses that field for the action name (`test/unit/routers.test.ts` checks it).

`staff-setRoles` links or creates the person's employee record, so nobody has two.

Scheduled: `scheduled-expireSubscriptions` (hourly), `scheduled-expireHolds` (every 15 minutes), `scheduled-expireDocuments` (daily 00:30 IST), `scheduled-accrueLeave` (daily 00:45 IST), all idempotent.
