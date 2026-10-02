# Stories — full build prompt (as live on main, 2026-10-02)

> A single prompt that describes everything currently built, deployed and working in `learn-crossmaze/stories`
> (main @ `43bc5f9`). Give it to an engineer or an AI coding agent to rebuild the system from scratch, or use it as
> the reference for what "done" means today. Details live in the other files in `docs/`; this file is the summary
> that ties them together.

---

## 0. The prompt

You are building **Stories**, a subscription-based physical lending library for India (company-owned branches and
franchises) **with a staff HRMS and WhatsApp notifications**, as **one web app on one Firebase project**. Build it exactly as specified below. Everything that
changes money, stock or membership state runs in **Cloud Functions inside Firestore transactions**, is
**idempotent** (client `requestId`) and **audited**; clients never write those collections directly.

### 0.1 Stack and layout

- **Web:** Vite + React 19 + TypeScript, React Router, Firebase JS SDK (Auth, Firestore, Functions, Storage), in
  `apps/web` (npm workspace). Plain CSS with design tokens (`src/styles.css`); no UI framework. Fonts: Fraunces
  (display), Inter (text). Hosted on Firebase Hosting (`stories-by-crossmaze.web.app`); `index.html` is served
  `no-cache`, hashed assets are immutable.
- **Backend:** Firebase Functions v2, TypeScript, Node 22, region **`asia-south1`**, `maxInstances: 5`, in
  `functions/`. Code layout by domain (platform, organization, catalogue, inventory, members, billing,
  circulation, hr, messaging) on both server and web: see docs/ARCHITECTURE.md §3. Zod for input validation.
  Firebase Admin SDK. PDFs (payslips, letters) are drawn on the server.
- **Data:** Cloud Firestore (single database), Cloud Storage (book covers; employee documents and photos, read only
  through functions or download-token URLs). Money is **integer paise**, currency
  INR. Times are UTC `Timestamp`s; business dates are India time (IST).
- **Security:** Firestore/Storage rules in `firebase/` — `firestore.rules` is **generated** from
  `firebase/rules-src/firestore.rules.tmpl` + `permissions.json` by `tools/rbac/generate.mjs`, which also generates
  `functions/src/generated/rbac.ts` and `apps/web/src/generated/rbac.ts`. CI fails if generated files are stale.
- **Scripts (root):** `dev`, `build`, `test:web`, `test:functions` (unit + emulator), `test:rules`, `emulators`,
  `seed`, `gen:rbac`, `deploy:backend` (`firebase deploy --only firestore,functions,storage`). Hosting deploys from
  GitHub Actions on merge to `main`; every PR gets a Firebase preview channel.
- **CI (GitHub Actions):** web (typecheck, test, build), functions (typecheck, unit + emulator tests), security rules
  tests (emulator), RBAC generator `--check`, hosting preview.

### 0.2 Business rules (non-negotiable)

1. Subscription library; audiences Children (<13), Teens (13–17), Adults (18+) derived from date of birth.
2. Plan durations Monthly (1), Quarterly (3), Half-yearly (6), Annual (12 months); each plan has a books-at-a-time
   limit, price, refundable security deposit, audiences, delivery eligibility, optional promo price with a date
   window (IST), and a renewal window (days before expiry).
3. **Unlimited exchanges; no due dates; no fines.** Limit = books held at once:
   `activeLoanCount + allocatedCount ≤ plan limit` (allocated reservation holds count, waiting ones don't — D2).
4. Active subscription needed to borrow, exchange or reserve (checked against the clock in the transaction);
   **returns are always allowed**.
5. Deposit is separate from revenue: an append-only ledger per member; balance changes only with a ledger entry.
6. Renewal before expiry starts exactly at the old end (no gap/overlap, D6); after expiry it starts on payment.
7. Guardian required for everyone under 18 (D8); children have no login of their own — the guardian's account sees them.
8. One Stories-wide catalogue owned by head office (corporate org); franchises own copies (D9).
9. Company and franchise data are isolated per organization; staff are further scoped to branches.
10. Holds on reserved copies last `reservationHoldHours` (default 48, D3), then pass to the next member or the shelf.
11. Lost books: deposit deduction proposed (replacement price, else copy cost), maker-checker approved (D5).

### 0.3 Core backend pipeline (`functions/src/core`)

- `query(name, schema, handler)` for reads and `command(name, schema, handler, after?)` for writes. Command
  pipeline: auth → load `Actor` (uid, email, emailVerified, profile) → zod validate (+ `requestId: uuid`) → **one
  Firestore transaction** running the handler (permission checks, rules, writes, audit) → result stored in
  `idempotency/{name}:{uid}:{requestId}` (TTL 30 days) so a retry returns the stored result → optional `after`
  side effect post-commit. App Check enforcement behind `ENFORCE_APP_CHECK`.
- **Routers:** actions are grouped into a few deployed callables to stay within the Cloud Run CPU quota —
  `admin` (platform, organization, `whatsapp-*`), `catalogue`, `inventory`, `members`, `billing`, `circulation`,
  `hr` — called as `{ action: 'books-create', ...data }`. The web maps action prefixes to routers
  (`apps/web/src/data/api.ts`, kept equal to `functions/src/routes.ts` by a unit test); `me-*` actions go to
  `members`. Unknown action → 404, which the web reports as "backend outdated, deploy".
- Scheduled (all idempotent): `scheduled-expireHolds` (every 15 min: expired reservation holds pass on),
  `scheduled-expireSubscriptions` (hourly: ended terms EXPIRED, pre-paid renewals take over, WhatsApp renewal
  reminders 7 and 1 days ahead), `scheduled-expireDocuments` (employee document expiry reminders) and
  `scheduled-accrueLeave` (monthly/yearly leave credits). HTTP: `razorpayWebhook`, `whatsappWebhook`. Firestore
  trigger: `whatsapp-send` (one run per queued WhatsApp message).
- `Actor.require(perm, orgId, branchId?, tx?)` reads `users/{uid}/memberships/{orgId}` (roles, branchIds, status);
  `requireCatalog(perm)` needs the permission in a **CORPORATE** org (or Super Admin). Errors are typed
  (`errors.forbidden/notFound/invalid/conflict(reason, message)`) and the web shows the message.
- `recordAudit(tx, ctx, orgId, {action, entityType, entityId, branchId?, memberId?, before?, after?, reason?})` →
  `orgs/{o}/auditLogs` (or platform log).
- Uniqueness via index docs in the same transaction: `isbnIndex/{isbn}`, `orgs/{o}/barcodes/{code}`,
  `orgs/{o}/phoneIndex/{phone}`, `orgs/{o}/employeeIds/{id}`, `orgs/{o}/aadhaarIndex/{sha256}` (members and employees: no duplicate Aadhaar).

### 0.4 Roles and permissions (`firebase/rules-src/permissions.json`)

Roles (code, scope): SUPER_ADMIN (SA, platform — everything), HEAD_OFFICE_ADMIN (HO, corporate org),
FINANCE_ADMIN (FIN, org), HR_ADMIN (HR, org), **CATALOGUE_MANAGER (CM, corporate org)**, FRANCHISE_OWNER (FO,
franchise org), BRANCH_MANAGER (BM, branch), LIBRARIAN (LIB, branch), DELIVERY_PERSON (DEL, branch), EMPLOYEE
(EMP, branch). Members are not a role — access is by ownership.

Key permissions: `branches.view` (all staff), `branches.manage` (HO, FO), `departments.manage` (HO, HR, FO),
`staff.view`/`staff.manageRoles` (HO, HR, FO, BM), `audit.view` (HO, FIN, HR, FO, BM), `books.view` (HO, FIN, FO,
BM, LIB, DEL, CM), `books.create` (HO, BM, LIB, CM), `books.edit` (HO, CM), `books.delete` (HO, CM), `copies.manage`
(HO, FO, BM, LIB), `books.transfer` (HO, FO, BM, LIB), `copies.writeOff` (HO, FIN, FO, BM), `members.view/manage`
(HO, FIN, FO, BM, LIB), `loans.issue/return`, `exchanges.process`, `reservations.manage` (FO, BM, LIB),
`subscriptions.manage` (HO, FIN, FO, BM, LIB), `plans.manage` (HO), `deposits.view` (HO, FIN, FO, BM, LIB),
`deposits.adjust` (FIN, FO, BM), `deposits.approve`/`deposits.refund` (FIN), `payments.view`/`payments.recordOffline`
(HO, FIN, FO, BM, LIB), `payments.refund` (FIN, FO, BM, LIB), `messaging.manage` (HO, FO, BM). HRMS: `employees.view` (HO, HR, FO, BM),
`employees.add` (HO, HR, FO, BM), `employees.edit`/`employees.lifecycle`/`hr.config` (HO, HR, FO),
`employees.privateData`/`employees.bank` (FIN, HR), `documents.verify` (HR, FO), `offers.release`/`letters.issue`
(HR, FO, BM), `attendance.view` (HO, HR, FO, BM, FIN), `attendance.manage`/`leave.approve` (HR, FO, BM),
`attendance.finalize`/`leave.adjust`/`salary.edit`/`payroll.run` (HR, FO), `salary.view`/`payslips.viewAll` (HR,
FIN, FO), `payroll.approve` (FIN, FO). Tasks/delivery/reports permissions are reserved for later phases.

Grantable: SA → every org role (respecting org type); HO → HO, FIN, HR, CM, BM, LIB, DEL, EMP; FO → FIN, HR, BM,
LIB, DEL, EMP; HR → EMP; BM → LIB, DEL, EMP (own branches only). Nobody but SA edits their own roles. Org-wide roles
always cover all branches (`b: ['*']`).

Custom claims (synced by the role-changing callables after commit): `{ v, sa, o: { <orgId>: { r: [codes], b:
[branchIds] | ['*'] } } }`; `users/{uid}.claimsVersion` makes the app refresh its token. Rules use `can`, `canAt`,
`inBranch`, `allBranches` helpers generated from the permission map; every invariant-bearing collection denies client
writes. Branch-scoped list queries must filter on the branch field the rules check.

### 0.5 Data model (Firestore)

`users/{uid}` (+ `memberships/{orgId}`), `orgs/{o}` (type CORPORATE | FRANCHISE), `orgs/{o}/branches/{b}` (code,
name, address, contact, hours, weekly offs, `numbering`, `payments.razorpay` public settings,
`memberListIndexedAt`) with `locations/{l}`, `counters/*` and `private/razorpay` (secrets, rules-denied),
`orgs/{o}/departments`, `books/{id}` (shared catalogue; `searchTokens`, `titleNormalized`, author/publisher/category
names denormalized, `coverUrl`/`coverPath`, `status` ACTIVE | ARCHIVED), `authors`, `publishers`, `categories`,
`config/numbering`, `counters/books`, `isbnIndex`, `orgs/{o}/copies/{c}` (+ `events`), `orgs/{o}/barcodes`,
`orgs/{o}/members/{m}` (code, fullName, dob, audience, isMinor, phone, email, `emailLower`, address, homeBranchId,
status ACTIVE | SUSPENDED | CLOSED, guardian, `accountHolderUid`, activeSubscriptionId, nextSubscriptionId,
subscriptionEndsAt, **`planName`, `renewalDueAt`**, activeLoanCount, allocatedCount, waitingCount, lifetime
counters, searchTokens), `orgs/{o}/plans` (+ `versions`), `subscriptions`, `payments`, `paymentRequests`,
`depositAccounts/{m}` (+ `transactions`), `depositAdjustments`, `loans`, `reservations`, `transfers`,
`auditLogs`, `config/{circulation|deposits|hr|whatsapp}`, `idempotency`. Members also hold `aadhaarLast4` (full
number only in `members/{m}/private/aadhaar`, functions-only, audited reveal) and `whatsappOptOut`. HRMS
collections (docs/HRMS.md): `employees` (+ `history`, `private/{profile|bank|aadhaar}`, `documents`),
`designations`, `documentTypes`, `shifts`, `holidays`, `attendance`, `attendanceCorrections`,
`attendanceSummaries`, `attendanceLocks`, `leaveTypes`, `leaveBalances`, `leaveLedger`, `leaveRequests`,
`payrollSettings`, `salaries`, `payrollInputs`, `payrollRuns`, `payslips`, `offerLetters`, `letterTemplates`;
`users/{uid}/notifications`. WhatsApp (docs/WHATSAPP.md): `branches/{b}.whatsapp` (public settings),
`branches/{b}/private/whatsapp` (token, app secret, verify token), `branches/{b}/whatsappTemplates/{event}`,
`whatsappOutbox` (queue and message log, 90-day TTL). Composite indexes and collection-group field overrides
(`copies.bookId`, `reservations.bookId`, `members.email`, `members.emailLower`, `members.accountHolderUid`) are in
`firebase/firestore.indexes.json`.

### 0.6 Features — staff console (lazy-loaded chunk)

Shell: three **views** with a switcher — **Admin** (`/admin`: setup and back office — Organization, People, Time,
Payroll, Settings, Audit), **Operations** (`/ops`: the day's work — Circulation, Collection, Members, Team) and
**Staff** (`/me`: My profile, attendance, leave, payslips, Complete my profile) — plus a link to the **Member** app.
Menus are filtered by permission, grouped one level deep; org and branch switchers (branch staff only see their own
branches); header with the notification bell, user and sign-out. Old `/admin/...` links redirect to their view. Dialogs: 800 px form dialogs,
560 px `narrow` for confirmations/rename; fields shrink to their column (no horizontal scroll); every destructive
action asks for a reason (audited).

1. **Organizations** (SA), **Branches** (branch staff see only theirs; HO/FO manage: create/edit/archive, hours,
   **Numbering**, **Payments** gateway), **Departments** (org-wide + own branches), **Staff & roles** (grant/revoke
   by email, branch scope, employee IDs), **Audit log**, **Dashboard** (to-dos, today's desk stats).
2. **Numbering** (docs/NUMBERING.md): patterns per branch for copy/member/shelf/employee codes (plus a head-office
   employee pattern) and one catalogue pattern for books; tokens `{SEQ:n}` (required once), `{BRANCH}`, `{BOOK}`, `{KIND}`, `{YYYY}`, `{YY}`, `{MM}`;
   counters keyed by fixed parts; collisions refused.
3. **Catalogue** (`/admin/books`): search (prefix tokens), age and status (All/Active/Archived) filters; each row
   shows which branches hold the title with shelf counts (`copies-availabilityMany`), own branch first. **New book**
   (HO, BM, CM in corporate orgs) with **book-details lookup** (Google Books + Open Library by title or ISBN, camera
   ISBN scan) that fills the form and imports the cover; authors/publishers created inline. Reference data and book
   numbering (editors). Book page: cover editor (Storage `covers/{bookId}/…`, JPEG/PNG/WebP ≤1.5 MB, shrunk to 800 px
   client-side; book creators may only add a missing cover), availability per branch, copies here, add copies, edit
   (archived too), archive, **restore**, **delete permanently** (HO, CM; only archived titles with **no copy in any
   status and no reservation in any org** — `books-usage` explains what blocks it, e.g. "1 copy (1 retired)"; frees
   the ISBN and deletes the cover).
   **Receive books** (Collection → Receive books, `/ops/books/bulk`): type or scan ISBNs of a delivery, each row is
   looked up and validated, then one click (`copies-receive`, `books-bulkCreate`) adds the new titles to the
   catalogue and every copy (with shelf, condition, cost) and offers QR labels to print. Librarians may add new
   titles in a corporate org.
4. **Inventory**: branch copies list with status filter; scan/type a code to open a copy — a copy held at another
   branch shows "COPY-… (Title) is at North · Available" (`copies-locate`); shelf locations; copy page with a
   **QR tag** (QR of the copy code with the copy code in bold and the book title in small type beside it), status,
   condition, location, history, actions (relocate, record condition, inspect, repair, lost/found, retire).
   **Print labels**: A4 sheets 3 × 8, each label a QR tag (26 mm QR + "Stories", copy code, title). **No 1-D
   barcodes are printed anywhere.** **Shelve books** (`/ops/inventory/shelve`, `copies-shelve`): bulk-assign a
   shelf to up to 100 copies that are not on one (new or returned after inspection); the dashboard shows a to-do
   while any are left.
5. **Circulation desk**: find member (name, code, phone, or scan the member ID card QR), issue (1–10 copies,
   all-or-nothing; reserved-for-this-member copies fulfil the reservation), return (by scan or checkbox; copies go
   to UNDER_INSPECTION), exchange (return + issue in one transaction), declare lost, inspection queue.
   Copy state machine enforced server-side for all 64 status pairs.
6. **Reservations** (place/cancel, holds ready, waiting) and **Transfers** (create → dispatch → receive, within an
   org; owning branch never changes).
7. **Members** (`/admin/members`): list of the branch's members, 50 per page, with plan, renewal date ("in 6 days",
   "ended yesterday"), books out, status; subscription chips with counts (All, Active, Renewal due in 15 days,
   Expired, Never subscribed) plus status and age filters; search combined with filters. First visit per branch runs
   `members-indexList` to fill `planName`/`renewalDueAt` for older members; payments keep them current. Register /
   edit (phone unique per org, guardian required under 18, optional **Aadhaar** — Verhoeff-checked, unique per org,
shown masked with an audited *Show*, and a *Send WhatsApp updates* switch). Member page: overview (plan, subscribe/renew, record
   counter payment, **collect online**, cancel unpaid, deposit and ledger, adjustments, settlement/refund,
   reservations, loans), history and audit tabs, **Library ID card** (print/download).
8. **Plans** (HO): versioned plans with one to four **billing options** (monthly, quarterly, half-yearly, yearly,
   each its own price) and an optional **promotional discount** (amount or 1–90 %, date window, which options),
   archive. **Upgrade mid-term, pro-rated** (docs/SUBSCRIPTIONS.md, D7): a quote lists every bigger plan/option with
   credit = floor(price × unused days ÷ term days); paying starts the new plan today, the old term becomes UPGRADED,
   deposit top-up collected; **Deposit approvals** (Finance, maker-checker).
9. **Payments**: counter payments (cash/UPI/card/bank transfer; amount must equal amount due; one transaction
   activates the subscription and collects the deposit) and **Razorpay per branch** (docs/PAYMENTS.md): payment
   links sent by SMS/email, single-use UPI QR (falls back to a link-as-QR), signed webhook (`payment_link.paid`,
   `qr_code.credited`, HMAC-SHA256) or "check status" via the Razorpay API; never trusts the browser; mismatches
   recorded as NEEDS_ATTENTION. **Refunds** (Operations → Members → Payments & refunds, `payments.refund`):
   Razorpay payments refunded through Razorpay (reserved → SUCCESS/FAILED by webhook or *Check status*), counter
   payments recorded; full or partial; the deposit part leaves the deposit ledger.
10. **Camera scanning** (`admin/barcode.ts`, `barcode.worker.ts`): ZXing in a Web Worker, 1920 px frames alternating
    quick (inside the framing guide) and thorough (whole frame: bands, sharpened, 90°, ±10°/±18° tilts); local
    row binarizer for 1-D (ISBN, older labels); QR tried first with both binarizers and ×2/×¾ scaling; RSS off; a
    code counts after 2 matching reads within 1.5 s. USB/Bluetooth scanners work in every scan field (keyboard
    wedge + Enter).
11. **Appearance** (Personal → Appearance; also on the member Profile): theme (match device/light/dark), accent
    (terracotta, teal, indigo, forest, plum, slate), text size (100/112.5/125 % via `zoom`), density
    (comfortable/compact), corners, more contrast, reduce motion; saved in `localStorage`
    (`stories.appearance`), applied as `data-*` on `<html>` before first paint by an inline script in `index.html`.

12. **WhatsApp** (Admin → Settings → WhatsApp, `messaging.manage`, per branch; docs/WHATSAPP.md): connect the
    branch's WhatsApp Business number with three values from Meta (Phone number ID, WABA ID, permanent System User
    token; optional app secret) — saving checks the number and that it belongs to the WABA. **Notifications** list
    (compact rows: name, Meta status, On/Off; full editor on click) with **Add notification** grouped by
    Membership, Payments, Borrowing, Reservations, Staff — 17 events: welcome, plan activated/upgraded/ended,
    renewal reminder, membership paused/resumed/closed, books issued/returned, book declared lost, waiting list,
    reservation ready/cancelled/not collected, payment link, refund, deposit refunded, staff notification. Each is
    a Meta template (`{{named}}` values → `{{1}}…`, category UTILITY, ≥ 3 fixed words per value, can't start/end
    with a value) submitted from Stories; approvals arrive by webhook or *Check approvals*; test sends; message log
    (sent, delivered, read, failed, not sent with reason); STOP replies opt the member out. Messages are queued
    with `queueWhatsApp(tx, …)` in the same transaction as the change (a cached per-branch switchboard skips
    events that are off) and sent by the `whatsapp-send` trigger.

### 0.7 Features — member app (`/`, `/explore`, `/my-books`, `/membership`, `/profile`)

Members sign in (email/password with verification, or Google). `me-overview` **links** every unclaimed member
record whose `email`/`emailLower` equals the verified sign-in email (sets `accountHolderUid`, audited) and returns,
for each membership the caller owns plus the children whose guardian they are: org and branch (contact, hours,
online payments on/off), member details, subscriptions, payments, open payment requests, loans, reservations,
deposit and ledger, and eligible plans. All `me-*` actions check **ownership** (account holder, or the guardian's
account holder), never staff permissions, and reuse the staff cores via an `authorize` callback
(`startSubscription`, `cancelPendingSubscription`, `requestOnlinePayment`, `placeReservation`, `cancelReservation`).

- **Self sign-up:** a verified account without a membership sees **Become a member**: pick library and branch,
  name, date of birth, mobile (`me-join`, adults only, one per org); **Add a child** (`me-addChild`) from
  Membership. Then choose a plan and billing option and pay online or at the branch.
- **Home:** plan, renewal date, books with them of the limit, deposit; prompts for an unpaid plan, a hold ready to
  collect (with deadline) or a plan ending within 15 days; borrowed books; link to the ID card. Switcher between
  own and children's memberships.
- **Explore:** active catalogue (children see their age group), per-branch availability, **Reserve** / **Join the
  queue** (`me-reserve`, same rules as the desk).
- **My Books:** borrowed now, reservations with cancel, history.
- **Membership:** current plan, plan cards to choose/renew (`me-subscribe`, renewal window enforced), unpaid plan
  card (fee + deposit top-up + total), **Upgrade now** (pro-rated quote, `me-upgradeQuote`/`me-upgrade`), with
  **Pay online** (`me-pay` opens a Razorpay payment page; activation by
  webhook or `me-checkPayment` on return/focus) or "pay at the branch", cancel and choose another; payments,
  subscription history, deposit ledger.
- **Profile:** **Library ID card** (credit-card size 85.6 × 54 mm: library, name, member code, branch, guardian,
  plan valid-until, branch phone, **QR of the member code**) with **Download** (300 dpi PNG drawn on canvas) and
  **Print** (only the card prints); membership details; Appearance.

### 0.8 Features — staff HRMS (docs/HRMS.md)

- **Employees** (Admin → People): status chips, search, branch filter; **Add employee** is the only way in (HR, HO,
  FO; BM at own branches) with an optional *Give Stories access* step; lifecycle DRAFT → ONBOARDING → ACTIVE →
  NOTICE_PERIOD → OFFBOARDING → OFFBOARDED (rehire) with checklists; completing offboarding revokes all roles.
  Profile tabs: Overview, Personal (incl. Aadhaar, PAN, UAN, ESI), Bank (masked, audited reveal, IFSC lookup),
  Documents, Attendance, Leave, Salary, Letters, Onboarding & exit, History (effective-dated), Access. Profile
  **photo** (JPEG/PNG/WebP ≤ 1 MB, shrunk to 480 px in the browser).
- **Documents:** types (required, expiry, reminders, employee may upload), private uploads (PDF/JPEG/PNG ≤ 5 MB,
  type checked by bytes), verification queue, expiry reminders.
- **Attendance:** shifts (grace, half/full-day minutes, overnight), weekly offs, holidays, self check-in/out and desk
  marking, corrections with approval, month **finalize** per branch giving payable days (reopen allowed).
- **Leave:** types (paid, quota, MONTHLY/YEARLY/MANUAL accrual, carry forward, half days), append-only ledger and
  balances, apply/approve/reject/cancel, approved leave shown on attendance.
- **Payroll:** effective-dated salary structures (BASIC required), PF/ESI/PT settings by month (Indian defaults),
  TDS entered monthly, payroll runs per month and branch (prepare → submit → approve, maker-checker), PDF
  **payslips** published to employees.
- **Letters:** offer letters (prepare, preview, release, withdraw; nobody releases their own) and letter templates
  (offer, appointment, custom; per branch; draft → published) issuing PDFs filed in the employee's documents.
- **Self-service:** My profile hub, My attendance, My leave, My payslips; **Complete my profile** (self-onboarding:
  personal details, bank once, required documents, photo; HR picks mandatory fields) with a banner and a reminder
  pop-up **every 4 hours** until complete; People overview dashboard; in-app **notifications** (bell) for
  decisions on your leave, attendance, documents and payroll.

### 0.9 Seed and environments

`npm run seed` (emulators, project `demo-stories`) creates a corporate and a franchise org, 2 branches, 3
departments, 36 books with copies, 6 plans, members with subscriptions, loans and a reservation, and users (password
`stories-demo`): super@, ho@, finance@, hr@, **catalogue@**, manager@, librarian@, delivery@, employee@, franchise@,
**member@** (linked to member Asha Rao and her child Kiran) — all `@stories.test`. Production project
`stories-by-crossmaze`; the owner deploys the backend with `npm run deploy:backend` after each merge that touches
functions, rules or indexes (indexes build in a few minutes).

Seed also creates employees with HR data (documents, shifts, attendance, leave balances and requests, salaries and a
payroll run waiting for Finance to approve).

### 0.10 Quality bar

- Tests: web (Vitest + Testing Library, 58), functions unit (51) and emulator (132: every command's rules, races,
  idempotency, permissions, member self-service, ownership, HRMS, WhatsApp with a fake Graph API), security rules
  (41), camera decoder tests on synthetic webcam frames. No test is skipped to get green.
- Accessibility: labelled controls, status never shown by colour alone, focus management in dialogs, reduced motion.
- Every user-facing error explains what to do; an out-of-date backend is reported as such.
- Workflow: each change on a branch → PR with tests → merge to `main` when CI is green → hosting deploys
  automatically → backend deployed by the owner.

---

## 1. Where the details are

| Topic | Document |
|---|---|
| Architecture, risks, decisions | [ARCHITECTURE.md](ARCHITECTURE.md) |
| Business rules and decisions D1–D11 | [BUSINESS_RULES.md](BUSINESS_RULES.md) |
| Roles, permissions, claims, grants | [RBAC.md](RBAC.md) |
| Collections and fields | [DATABASE.md](DATABASE.md) |
| Callable actions and permissions | [API.md](API.md) |
| Catalogue, inventory, members, scanning, member app | [LIBRARY.md](LIBRARY.md) |
| Circulation, reservations, transfers | [CIRCULATION.md](CIRCULATION.md) |
| Plans, subscriptions, deposits | [SUBSCRIPTIONS.md](SUBSCRIPTIONS.md) |
| Counter and Razorpay payments | [PAYMENTS.md](PAYMENTS.md) |
| Numbering patterns | [NUMBERING.md](NUMBERING.md) |
| Security rules | [FIRESTORE_RULES.md](FIRESTORE_RULES.md) |
| Environments, deployment, testing | [ENVIRONMENTS.md](ENVIRONMENTS.md), [DEPLOYMENT.md](DEPLOYMENT.md), [TESTING.md](TESTING.md) |
| Staff HRMS (employees, documents, attendance, leave, payroll, letters, self-onboarding) | [HRMS.md](HRMS.md) |
| WhatsApp setup, templates, troubleshooting | [WHATSAPP.md](WHATSAPP.md) |
| Phases and what is still planned (tasks, delivery, reports) | [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) |
