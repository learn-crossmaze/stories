# Stories — Implementation Plan

> Status: **Proposed (awaiting approval)**. Phases 0–1 are detailed milestone-by-milestone; later phases are outlined
> and will be detailed before they start. Each milestone lands as its own set of logical commits and PR.

**Sequencing note:** Phase 1 depends on Phase 0 (auth, RBAC, org/branch model, rules codegen, design system, CI).
Recommended instruction order: **START PHASE 0**, review, then **START PHASE 1**. If you prefer to say only
"START PHASE 1", I will build the Phase 0 milestones first as its prerequisite and report them separately.

---

## PHASE 0 — Foundation

### M0.1 Tooling, repository & environments
- **Objective:** a repo anyone can clone and run against emulators with one command.
- **Firestore:** none. `firebase.json` with emulators (auth, firestore, functions, storage, pubsub, hosting); `.firebaserc` aliases `dev/staging/prod`.
- **Rules:** deny-all baseline for Firestore and Storage.
- **Functions:** TypeScript project skeleton, ESLint, Vitest, `core/` (errors, clock, money, logger with PII scrubbing).
- **Flutter:** pub workspace; `apps/stories_app` with flavors (dev/staging/prod), `--dart-define-from-file`, emulator wiring, `very_good_analysis`-level lints, l10n scaffold.
- **CI:** GitHub Actions PR pipeline (format → analyze → tests → functions typecheck/tests → emulator rules tests → web + debug APK build). SessionStart hook installing pinned Flutter SDK for cloud sessions.
- **Tests:** smoke tests for each package; deny-all rules test.
- **Acceptance:** `make dev` (or `npm run dev`) starts emulators + app; CI green on an empty-feature PR.
- **Docs:** ENVIRONMENTS.md, DEPLOYMENT.md (incl. backups/PITR, Workload Identity Federation), TESTING.md.

### M0.2 Design system
- **Objective:** Stories' visual language as reusable tokens and components before any feature screen.
- **Flutter:** `packages/stories_design_system`: color/typography/spacing/radius/elevation tokens (warm editorial palette, serif display + clean sans body), light/dark `ThemeData` (Material 3), components — buttons, inputs, cards, book cover card, badges/status chips (icon + text), data table, dialogs, bottom sheets, nav shells (bottom nav / rail / side nav), skeleton loaders, empty/error/offline states, `AsyncValue` view helper, scan input field. Widgetbook-style gallery page in dev flavor.
- **Tests:** golden tests for core components (light/dark, text scale 1.0/2.0), accessibility guideline tests (contrast, tap targets, labels).
- **Acceptance:** gallery renders every component; goldens committed; no hard-coded colors outside tokens (lint).
- **Docs:** DESIGN_SYSTEM.md.

### M0.3 Auth, users, organizations, branches, RBAC
- **Objective:** a signed-in user lands in the right shell with the right permissions, enforced server-side.
- **Firestore:** `users`, `users/*/memberships`, `orgs`, `orgs/*/branches`, `orgs/*/departments`, `orgs/*/auditLogs`, `orgs/*/idempotency`, `orgs/*/counters`, `phoneIndex`.
- **Rules:** generated helper layer from `permissions.json` (`can`, `canAt`, `inBranch`); rules for users (self), memberships (self read), orgs/branches (members of org read), audit (audit.view).
- **Functions:** callable pipeline (App Check, auth, zod, permission, idempotency, transaction + audit); `onUserCreate` profile bootstrap; `staff.grantRole/revokeRole`; membership → custom-claims sync trigger + `claimsVersion` refresh; `orgs.create`, `branches.create/update/archive`, `departments.*`.
- **Flutter:** sign-in (email/password, phone OTP, Google), profile completion, session/permissions providers, GoRouter shells + guards, org/branch switcher, branch management screens (staff console).
- **Permissions:** `org.manage`, `branches.manage`, `staff.manageRoles`, `audit.view`.
- **Tests:** rules tests (org isolation, branch isolation, franchise A ↛ B, self-only user docs); function tests (unauthorized role denied, claims sync, idempotent retry); widget tests for route guards.
- **Acceptance:** seeded 9 persona users each see only their shell/routes; direct Firestore reads outside scope fail in emulator; every admin change produces an audit log.
- **Docs:** RBAC.md (final), FIRESTORE_RULES.md, API.md (callable contract conventions).

### M0.4 Seed & demo data foundation
- **Objective:** reproducible emulator/dev data flagged `seed: true`.
- **Functions/tools:** `tools/seed` (Admin SDK) — 2 orgs (Stories Corporate, Stories Franchise Demo), 2 branches, 9 persona users with roles.
- **Acceptance:** `npm run seed` idempotent; refuses to run against `prod` alias.

---

## PHASE 1 — Core Library

### M1.1 Catalogue
- **Objective:** head office curates the Stories catalogue.
- **Firestore:** `catalog/books|authors|publishers|categories`; search tokens; indexes for explore filters.
- **Rules:** catalogue readable by any signed-in user (and public book pages later); writes denied.
- **Functions:** `catalog.upsertBook/Author/Publisher/Category`, archive; ISBN-13 validation + uniqueness; code allocation `BOOK-000123`; cover upload finalize (resize via extension or function); title fan-out trigger.
- **Flutter:** staff catalogue list (paginated, filter, search), book editor with authors/categories pickers, cover upload; `SearchService` (Firestore token impl).
- **Permissions:** `books.view`, `books.create`, `books.edit`.
- **Tests:** ISBN validation, duplicate ISBN rejected, search tokenization, pagination, librarian cannot edit.
- **Acceptance:** 20–50 seed titles across Children/Teens/Adults and the 10 genres, with legally safe generated placeholder covers.
- **Docs:** LIBRARY.md.

### M1.2 Physical copies, barcodes, locations, inventory
- **Objective:** every physical copy is individually tracked from acquisition onward.
- **Firestore:** `copies`, `copies/*/events`, `barcodes`, `branches/*/locations`, `branches/*/availability`.
- **Rules:** branch staff read copies in scope; members read only `availability`.
- **Functions:** `copies.acquire` (bulk, generates `COPY-000123-01` + barcode, unique via `barcodes/`), `copies.relocate`, `copies.recordCondition`, `copies.inspect` (UNDER_INSPECTION → AVAILABLE/DAMAGED), `copies.markLost/retire` (with reason, audit), availability projection maintenance, reconciliation job; printable barcode/QR label sheet (PDF).
- **Flutter:** inventory by branch/location/status, copy detail with history timeline, scan-first lookup (camera + HID scanner), label printing.
- **Permissions:** `copies.manage`, `copies.writeOff`.
- **Tests:** state-machine unit tests (all illegal transitions rejected), duplicate barcode rejected, retire never deletes, availability counter correctness under concurrent changes.
- **Docs:** LIBRARY.md (inventory), CIRCULATION.md (state machine).

### M1.3 Members & guardians
- **Objective:** register adult, teen and child members; guardians manage children.
- **Firestore:** `members`, `guardianships`, `addresses`, `phoneIndex`.
- **Rules:** account holder / guardian reads own members; branch staff read members in scope.
- **Functions:** `members.register` (counter and self-service), `members.addChild` (guardian required for minors — D8), `members.update`, `members.setStatus`; phone uniqueness.
- **Flutter:** counter registration flow for librarians; member search (code, phone, name prefix); member profile (staff view).
- **Tests:** minor without guardian rejected, duplicate phone rejected, guardian sees child, other user doesn't.
- **Docs:** MEMBERS section in LIBRARY.md; BUSINESS_RULES D8.

### M1.4 Subscription plans, subscriptions, offline payments, deposits
- **Objective:** activate a membership correctly, with deposit held separately in a ledger.
- **Firestore:** `plans` (versioned), `subscriptions`, `payments`, `depositAccounts` + `transactions`, `config`.
- **Functions:** `plans.create/newVersion/archive`; `subscriptions.create` (PENDING_PAYMENT, plan snapshot); `payments.recordOffline` (subscription + deposit lines) → activates subscription and posts `DEPOSIT_COLLECTED` in one transaction; `subscriptions.renew` (D6); scheduled `subscriptions.expireSweep` (hourly) + expiry-reminder notification stubs; `deposits.proposeAdjustment` / `deposits.approve` (maker-checker); `deposits.startSettlement` / `deposits.refund` (blocked while any loan ACTIVE); nightly deposit reconciliation.
- **Flutter:** plan admin (HQ), subscribe/renew at counter, record payment, member subscription & deposit panels, deposit ledger view, settlement wizard.
- **Permissions:** `plans.manage`, `subscriptions.manage`, `payments.recordOffline`, `deposits.*`.
- **Tests:** plan edit doesn't change existing subscription terms; payment recorded twice with same requestId → one activation; deposit balance == ledger sum; refund blocked with outstanding loan; same user can't propose and approve above threshold; expiry sweep idempotent.
- **Docs:** SUBSCRIPTIONS.md, PAYMENTS.md (offline part), BUSINESS_RULES D1/D6.

### M1.5 Circulation: issue, return, exchange
- **Objective:** the core Stories loop — borrow up to the plan limit, return, exchange unlimited times.
- **Firestore:** `loans`, `exchanges`, `branches/*/dailyStats`.
- **Rules:** staff read loans in scope; account holder reads own members' loans; all writes via functions.
- **Functions:** `circulation.issue` (copy status + active subscription + `now < endAt` + limit check, one transaction), `circulation.return` (→ UNDER_INSPECTION, frees one slot, increments exchange counters when paired), `circulation.exchange` (N returns + M issues atomically; M ≤ free slots after returns), `circulation.declareLost` (→ D5 charge proposal), loan-count reconciliation job.
- **Flutter:** librarian scan-first desk: scan member card → scan copies → confirm; return desk with inspection prompt; member "current books" panel in staff console; librarian dashboard v1 (today's issues/returns/exchanges/pending inspections).
- **Permissions:** `loans.issue`, `loans.return`, `exchanges.process`.
- **Tests (critical):** two librarians issue the same copy concurrently → exactly one succeeds; limit 4 with 4 loans → 5th rejected; return one → exactly one slot; 100 sequential exchanges → never blocked; expired subscription → issue/exchange rejected, return allowed; no due date or fine ever computed.
- **Docs:** CIRCULATION.md.

### M1.6 Reservations & inter-branch transfers
- **Objective:** members can queue for titles; branches move stock safely.
- **Firestore:** `reservations`, `transfers`.
- **Functions:** `reservations.place` (active subscription, D2 limits), `reservations.cancel`, allocation on copy becoming AVAILABLE (oldest WAITING first, atomic), hold expiry sweep (D3), fulfil on issue; `transfers.create`, `transfers.dispatch` (scan, → IN_TRANSIT), `transfers.receive` (scan, condition check, → UNDER_INSPECTION/AVAILABLE at destination, ownership unchanged), `transfers.cancel`.
- **Flutter:** reservation queue board for librarians; transfer create/dispatch/receive screens with scanning.
- **Permissions:** `reservations.manage`, `books.transfer`.
- **Tests:** two members race for last copy → one allocation; hold expiry passes copy to next; receiving a copy not in the transfer rejected; transferred copy keeps `owningBranchId`.
- **Docs:** CIRCULATION.md (reservations), LIBRARY.md (transfers).

**Phase 1 exit criteria:** every M1 test green in CI on emulators; rules tests cover every Phase 1 collection;
audit entries verified for: subscription changes, deposit postings, lost/retired copies, transfers; docs updated;
summary report (files, features, tests, security, known issues, next milestone).

---

## PHASE 2 — Member app (outline)
M2.1 Member onboarding & self-registration (phone OTP) · M2.2 Home/Explore/Book detail with branch availability ·
M2.3 My Books (current, reserved, history, wishlist) + self-service reservations · M2.4 Razorpay: order creation,
checkout, HMAC webhook, idempotent activation, refunds · M2.5 Profile: subscription, deposit, payments, addresses ·
M2.6 Notification center + FCM + preferences · M2.7 Analytics events & Crashlytics.

## PHASE 3 — Delivery (outline)
M3.1 Zones, postal-code serviceability, slots, versioned charges · M3.2 Delivery/return-pickup/exchange orders with
upfront charge + payment · M3.3 Dispatcher board & assignment · M3.4 Delivery-person app: route list, OTP handover,
photo proof, failed-delivery flow; handover performs issue/return via circulation functions.

## PHASE 4 — HRMS (outline)
M4.1 Employee master, private profile, effective-dated assignments, lifecycle · M4.2 Documents with verification ·
M4.3 Shifts, holidays, weekly offs · M4.4 QR (rotating signed token) / GPS / assisted attendance, status computation,
missing-checkout job · M4.5 Corrections workflow + payroll lock · M4.6 Leave policies, balances, requests, approvals ·
M4.7 Employee self-service.

## PHASE 5 — Tasks & SOPs (outline)
M5.1 SOPs with immutable published versions · M5.2 Templates, checklists, schedules (RRULE) · M5.3 Idempotent
instance generation aware of shifts/leave/holidays + reassignment suggestions · M5.4 My Work dashboard, completion
with mandatory items & evidence, approvals · M5.5 Reminder/escalation dispatcher (bounded, cancels on completion) ·
M5.6 Branch manager dashboard · seed the 13 sample templates.

## PHASE 6 — Payroll (outline)
M6.1 Salary structures & configurable statutory rules (PF, ESI, PT, TDS) · M6.2 Payroll run: attendance/leave
finalization, LOP · M6.3 Review, maker-checker approval, lock/reopen · M6.4 Payslip PDF generation & self-service.

## PHASE 7 — Franchise (outline)
M7.1 Franchise onboarding (org + owner + branches) · M7.2 Revenue attribution · M7.3 Royalty rules & settlements ·
M7.4 HQ consolidated read model.

## PHASE 8 — Analytics (outline)
M8.1 Aggregation pipeline hardening · M8.2 HQ, branch, subscription, library, delivery, HR, task/SOP-compliance
dashboards built on summary documents.

---

## Before M0 starts, I need from you
1. Confirmation of the decisions D1–D11 in BUSINESS_RULES.md (or corrections).
2. Whether Firebase projects `stories-dev`, `stories-staging`, `stories-prod` exist and are on the **Blaze** plan.
   Until they do, all work runs on the Emulator Suite (nothing blocks Phase 0/1 development).
3. Confirmation of region `asia-south1` and payment gateway Razorpay (Phase 2).
