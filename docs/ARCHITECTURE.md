# Stories — Architecture

> Status: **Approved; Phase 0 implemented.** Where this document says Flutter, read "the web app" (see the decision below).
> Companion documents: [DATABASE.md](DATABASE.md) · [RBAC.md](RBAC.md) · [BUSINESS_RULES.md](BUSINESS_RULES.md) · [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md)
>
> **Decision (2026-09-27): web only, one Firebase project.** The client is a Vite + React + TypeScript web app in
> `apps/web`, hosted on Firebase Hosting; there are no Android/iOS apps and no dev/staging/prod split. Sections below
> that mention Flutter, mobile apps, flavors or multiple environments are superseded by this; read "Flutter" as
> "the web app". Setup lives in [ENVIRONMENTS.md](ENVIRONMENTS.md); deployment in [DEPLOYMENT.md](DEPLOYMENT.md);
> callable conventions in [API.md](API.md).
>
> **As built (Phase 0):** `apps/web` (React, React Router, Firebase JS SDK) · `functions/` (2nd-gen TypeScript Cloud
> Functions, `asia-south1`) · `firebase/` (rules generated from `firebase/rules-src/`) · `tools/rbac` (generator).
> Claims are synced directly by the role-changing callables after commit, not by a Firestore trigger (simpler, no
> Eventarc; see RBAC.md §4).

---

## 1. Repository audit (2026-09-27)

| Item | Finding |
|---|---|
| Repository | `learn-crossmaze/stories` (GitHub, private) |
| Commits / branches / files | **None.** The remote has no refs; the repository is empty. |
| Flutter / Dart version | Not present (no `pubspec.yaml`) |
| Firebase configuration | Not present (no `firebase.json`, `.firebaserc`, rules, indexes) |
| Cloud Functions | Not present |
| Screens / routes / models / state management | Not present |
| Design system / reusable components | Not present |
| Tests | Not present |
| CI/CD | Not present (no `.github/workflows`) |
| Environment configuration | Not present |

**Conclusion:** greenfield. There is nothing to reuse, refactor, or conflict with. We adopt the target stack directly
(the brief allows this when the repository is empty).

### 1.1 Development-container audit

| Tool | Status | Impact |
|---|---|---|
| Node.js 22 / npm | Available | Cloud Functions (TypeScript), Firebase CLI, rules tests |
| Java | Available | Required by Firestore/Auth/Storage emulators |
| Flutter / Dart SDK | **Not installed**; SDK download host is reachable | Phase 0 installs a pinned Flutter SDK (via a SessionStart hook) so `flutter analyze/test` run in every session |
| Firebase CLI | Not installed; npm reachable | Installed as a dev dependency (`firebase-tools`) — pinned, no global install |
| firebase.google.com | Blocked by proxy | Not required for emulators; real project deploys happen from GitHub Actions |

### 1.2 Technology stack verification

| Required | Current | Action |
|---|---|---|
| Flutter + Dart (Material 3) | absent | Adopt — Flutter stable (3.3x), Dart 3.x, null-safe |
| Firebase Auth | absent | Adopt — email/password, phone OTP, Google |
| Cloud Firestore | absent | Adopt — sole transactional DB |
| Cloud Functions | absent | Adopt — **2nd gen, TypeScript, Node 22** |
| Firebase Storage | absent | Adopt |
| FCM, Crashlytics, Analytics, App Check | absent | Adopt (Crashlytics mobile-only; App Check reCAPTCHA Enterprise on web, Play Integrity / App Attest on mobile) |
| Firebase Hosting | absent | Adopt — Flutter Web |
| Emulator Suite | absent | Adopt — Auth, Firestore, Functions, Storage, Pub/Sub (scheduled jobs) |
| GitHub + GitHub Actions | repo exists, no CI | Adopt |
| Riverpod / GoRouter | absent | Adopt — Riverpod 2.x with code generation, GoRouter |
| Freezed + json_serializable | absent | Adopt for domain models |

No deviations from the required stack are proposed.

### 1.3 Technical & security risks identified up-front

| # | Risk | Mitigation |
|---|---|---|
| R1 | Firestore has no joins, no unique constraints, no cross-document `CHECK`s | All invariant-bearing writes go through Cloud Functions inside Firestore transactions; uniqueness via *index documents* (e.g. `barcodes/{barcode}`) created in the same transaction |
| R2 | Custom-claims size limit (1000 bytes) vs. multi-org, multi-branch staff | Claims carry only compact role/branch scope; authoritative membership lives in Firestore (see RBAC.md §4) |
| R3 | Scheduled functions retry / overlap | Deterministic document IDs for generated records (tasks, attendance, reminders) make generation idempotent |
| R4 | Hot documents (global counters, per-branch daily stats) | Per-scope counters, sharded counters for high-write aggregates, human-readable codes allocated per scope |
| R5 | Clients writing financial/inventory state directly | Rules **deny client writes** on every invariant-bearing collection; only the Admin SDK (functions) writes them |
| R6 | Offline cache showing stale availability or unconfirmed operations as done | Critical operations are callables (online-only); UI shows `Syncing / Confirmed / Failed` states; no optimistic success. Lists a page kept from an earlier visit are session memory only, always read again, and never used for availability, limits or money (§3, Loading) |
| R7 | Cost blow-ups from listeners and dashboard aggregation | Listeners only where real-time matters (librarian queue, delivery status, my tasks); dashboards read pre-aggregated summary docs |
| R8 | Firestore search is weak (no full-text) | `SearchService` abstraction; Phase 1 uses normalized prefix tokens + exact ISBN/barcode lookups; can be swapped for Typesense/Algolia extension later without UI changes |
| R9 | Time zones (attendance, task due times, subscription end) | All instants stored as UTC `Timestamp`; every branch has an IANA `timeZone`; calendar keys (`2026-09-27`) computed in branch-local time |
| R10 | Money rounding | All money stored as **integer minor units** (paise) + ISO currency; never floating point |
| R11 | Flutter Web bundle serving both members and admins | Single codebase, but two web entrypoints/hosting sites (member vs. staff console) so the member bundle stays lean — decided in M0 |
| R12 | Cloud Functions require the Blaze (pay-as-you-go) plan | Needs to be enabled on `stories-dev/staging/prod` by the project owner |

---

## 2. High-level architecture

```text
                              STORIES
                                 │
          ┌──────────────────────┴───────────────────────┐
          │                                              │
   Flutter mobile (Android / iOS)              Flutter Web (Firebase Hosting)
   one app, role-gated modules:                ├─ app.   → member experience
   Member · Employee · Librarian · Delivery    └─ admin. → HQ · Branch · HR · Finance · Franchise
          │                                              │
          └──────────────────────┬───────────────────────┘
                                 │ Firebase SDKs (+ App Check token)
       ┌─────────────┬───────────┼──────────────┬──────────────┐
       │             │           │              │              │
  Firebase Auth   Firestore    Storage       FCM        Crashlytics / Analytics
  (identity)      (reads via   (files via       ▲
       │          rules;       rules + signed   │
       │          client       URLs)            │
       │          writes only                   │
       │          on low-risk                   │
       │          docs)                         │
       │             ▲                          │
       ▼             │ Admin SDK (transactions) │
  ┌──────────────────┴──────────────────────────┴───────────────┐
  │              Cloud Functions (2nd gen, TypeScript)          │
  │  callable   → trusted business operations (issue, return,   │
  │               exchange, deposit adjust, payroll approve…)   │
  │  https      → payment webhooks (Razorpay), QR attendance    │
  │  scheduled  → subscription expiry, task generation,         │
  │               reminders, escalations, daily aggregates      │
  │  triggers   → claims sync, audit fan-out, notifications,    │
  │               availability & summary counters               │
  └─────────────────────────────────────────────────────────────┘
                                 │
                        Razorpay (payments/refunds) · Email provider (later SMS)

   GitHub ─► GitHub Actions ─► stories-dev ─► stories-staging ─► stories-prod
```

### 2.1 Where business logic lives

| Layer | Responsibility | Never does |
|---|---|---|
| Flutter | Presentation, input validation for UX, state, offline-tolerant reads | Decide availability, borrowing limits, money, statuses |
| Security Rules | Read authorization (org/branch/role/ownership), write authorization for the few client-writable docs, field-shape validation on those | Complex cross-document business rules |
| Cloud Functions | Every state change with an invariant: circulation, subscriptions, deposits, payments, delivery, attendance, leave, payroll, tasks, audit | Trust anything from the client beyond the authenticated uid + validated input |
| Firestore | Source of truth | — |
| Storage | Binary files; Firestore holds metadata + path | — |

**Write policy (important):** clients write directly *only* to low-risk, self-owned documents — notification read
flags, wishlist, preferences, draft checklist responses, and file uploads to their own staging paths. Everything else is
written by functions. This makes rules simpler (mostly read rules), makes audit logging uniform (one server-side
helper), and makes concurrency testable.

---

## 3. Repository layout

Code is organized **by domain**, and the same domain names are used in the backend, the web app and the docs.
Each domain on the server is one folder whose `index.ts` lists its actions; `functions/src/routes.ts` joins
them into the one deployed function, `api`.

```text
stories/
├─ apps/web/                        # the web app (React 19 + Vite + TypeScript), npm workspace
│  └─ src/
│     ├─ main.tsx  routes.tsx  paths.ts  styles.css
│     ├─ auth/                      # Firebase Auth context, claims, repository
│     ├─ config/                    # environment and Firebase bootstrap
│     ├─ data/                      # Firestore reads and server calls, one file per domain
│     │    api.ts (command/call/warm)  files.ts (PDFs and uploads)  services.ts  common.ts (vocabularies, query helpers)
│     │    catalogue.ts  inventory.ts  members.ts  billing.ts  circulation.ts  org.ts  hr.ts  me.ts
│     ├─ shared/                    # UI used by both apps: ui.tsx, format.ts, dates.ts (IST), useAsync, useDebounced,
│     │                             # appearance, BookCover, QrCode, IdCard
│     ├─ strings/                   # user-facing text: index.ts (t), library.ts (lt), hr.ts (ht)
│     ├─ public/                    # SignIn, Setup
│     ├─ member/                    # member app: MemberShell, memberData, one file per page, common.tsx
│     ├─ admin/                     # staff console (lazy-loaded chunk; each page its own chunk)
│     │  ├─ AdminApp.tsx AdminShell.tsx Workspace.tsx nav.ts guards.tsx grants.ts
│     │  ├─ components/             # Dialog, kit, CameraScanner, scan.ts, barcode (+ worker)
│     │  ├─ dashboard/  catalogue/  inventory/  circulation/  members/  organization/  people/
│     ├─ generated/rbac.ts          # generated from permissions.json (never edit)
│     └─ test/
├─ functions/                       # Cloud Functions v2, TypeScript, Node 22
│  ├─ src/
│  │  ├─ index.ts                   # deployed functions only (api, webhooks, scheduled jobs)
│  │  ├─ routes.ts                  # every domain's actions joined for `api` (and the older routers, kept one release)
│  │  ├─ core/                      # callable pipeline, router, RBAC actor, audit, errors, numbering, counters
│  │  ├─ platform/                  # user profiles, Super Admin bootstrap
│  │  ├─ organization/              # orgs, branches, numbering, departments, staff
│  │  ├─ catalogue/                 # books, covers, ISBN lookup, search tokens
│  │  ├─ inventory/                 # copies, copy state machine, locations
│  │  ├─ members/                   # members, member self-service (me-*)
│  │  ├─ billing/                   # plans, subscriptions, payments, Razorpay, deposits, expiry sweep
│  │  ├─ circulation/               # issue/return/exchange, reservations, transfers
│  │  ├─ hr/                        # employees, lifecycle, HR settings
│  │  ├─ generated/rbac.ts
│  │  └─ tools/seed.ts              # emulator demo data
│  └─ test/  unit/  emulator/
├─ firebase/                        # rules (generated from rules-src), indexes, storage rules, rules tests
├─ tools/rbac/generate.mjs          # permissions.json → rules, functions and web RBAC
└─ docs/
```

**Conventions**

- A new action goes in its domain's `index.ts` (`'<prefix>-<verb>': handler`); `api` then serves it. Two domains
  may not define the same action (`routes.ts` refuses to start, and `functions/test/unit/routers.test.ts` fails).
  While the seven older routers are kept (one release, see docs/API.md), a new prefix also goes in the web `ROUTERS`
  table (`apps/web/src/data/api.ts`), which the same test checks against them.
- The deployed function names (`api`, `razorpayWebhook`, `scheduled-*`, …) do not change; moving code between
  folders does not change them. The older router names (`admin`, `catalogue`, `inventory`, `members`, `billing`,
  `circulation`, `hr`) go away in a later release.
- Cross-domain calls go through exported functions (for example, member self-service calls the billing and
  circulation cores with an ownership check); a domain never writes another domain's collections except inside
  those shared cores.
- **One menu (as in LITMUS):** the staff console has a single sidebar, the same for everyone, showing only what
  each person's roles allow (no view switcher). In order: **Dashboard**; **Circulation**, **Collection** and
  **Members** (a branch's daily work); **Website** and **Enquiries** (storiesforall.in); **Staff** (employees,
  documents, letters, attendance, leave, payroll); **Organization** (organizations, branches, departments, staff
  access, website admins, audit log); **Master control** (Roles — the ready-made roles and roles of one's own,
  docs/RBAC.md §2.1 —, Library rules, then the HR, payroll, WhatsApp, delivery and website-connection settings); and **My employment** for every staff member (my profile,
  attendance, leave, payslips, deliveries, completing the profile). Members (no staff role) never see the console:
  they are sent to the member area on the website. Staff who are also members open it from the account menu.

  **Landing:** after sign-in, people whose roles go beyond their own job land on the Dashboard (`/admin`); everyone
  else on My profile (`/me`) (`staffHome` in `auth/claims.ts`).

  **What waits for you** (as in LITMUS): beside each menu page, a count of what waits there for the person (books to
  inspect or shelve, incoming transfers, deliveries, deposit approvals, renewals due, documents to verify,
  attendance corrections and the month to finalize, leave and payroll to approve, website changes to publish, posts
  to review, new enquiries, the person's own missing profile items); a closed group shows its total, and the browser
  tab the overall total ("(5) Dashboard · Stories"). The same checks as the Dashboard's list (`admin/attention.ts`).
  - **When they are read:** once the organization's branches are known (one run at the start), then on moving
    between pages (at most every 30 seconds), every 2 minutes while the tab is in view, every 10 minutes while it
    is not (the total is in the tab's title), and straight away when the tab comes back into view. Each count shows
    as soon as its own read answers; a run under way is never dropped because the person moved to another page,
    only replaced by a newer run or a new organization or branch.
  - **Only what the menu shows is asked for:** three branch counts, one renewals count, two delivery counts
    (`deliveries-counts`), two document counts. The Website counts come from the shared 30-second read of the
    overview (`siteOverview(uid)`, docs/WEBSITE_ADMIN.md) and are asked only for people who manage the website or
    a branch's pages in some organization (`countsWebsite`); they are read again, alone, when something in the
    Website section is saved or published. The person's own missing profile items come from the shell's one
    shared read (`OnboardingProvider`, docs/HRMS.md §14), not from a read of the menu's own.
  - **Shared with the Dashboard:** what both read goes through `waiting` in `admin/attention.ts`
    (`sharedLoad` in `data/shared.ts`: one read for askers at the same moment, its answer kept 5 seconds, a
    failure never kept, the person's uid in every key), so opening the console asks once, not once each.
  - **Master control counts** show only where something there is missing or broken and needs the person to act:
    Shifts & holidays (no holiday entered for this year in India; from December also next year), Leave types (none
    active), Letter templates (drafts never published), Payroll settings (never saved although a salary exists),
    WhatsApp at the chosen branch (notifications Meta rejected, paused or disabled, plus, while WhatsApp is switched
    on there, ones switched on but never sent to Meta), Delivery at the chosen branch (a courier app still on its
    test account while home delivery is on) and Connections (nobody on the enquiry alerts list). Roles, Library
    rules, Job titles & checklists and Document types have none. Each is asked only of people who see its menu
    item, and one that cannot be read shows no count. They have their own slow cycle: a new organization or branch,
    leaving a Master control page (so a fix shows at once), and otherwise at most every 10 minutes. The reads are
    one row or one count each (`data/setupCounts.ts`); WhatsApp is one `whatsapp-overview` call, made only when the
    branch is connected; Delivery is read from the branch document the workspace already holds. The Dashboard
    lists the same items from the same answer (`useWaiting`). The rules are small pure functions in
    `admin/attention.ts`, covered by `test/attention.test.ts`.

  The menu only arranges screens; the rules and functions still check every read and write.
- **Menus and page access:** the menu is defined once in `apps/web/src/admin/nav.ts` (`MENU`): pages and groups of
  pages, at most one level deep, with icon, who sees each item and who may open the page. Routes in `AdminApp.tsx`
  take their guard from it.
  - **Groups** open and close. The group holding the current page opens on arrival, and open groups are
    remembered on the device.
  - **Emptied groups:** a group with nothing visible to you is removed.
  - **Account menu:** personal actions (my profile, appearance, member view, sign out).
  - **Small screens:** under 900px the menu, switcher included, is a drawer behind a Menu button.
- **Accessibility:** every page has one `<h1>` (a page that is only an empty state uses `EmptyState page`, whose
  title becomes the heading); `shared/useRouteFocus.ts` names the browser tab after it and moves focus to it after
  navigation. Both shells have a "Skip to content" link. Dialogs keep focus inside and return
  it on close. Every interactive element shows a focus outline, and text meets WCAG AA contrast (checked with axe).
  - **Pages that open ready to scan or type** mark that one field with `data-autofocus` (`ScanInput autoFocus`
    does it): focus then goes to the field instead of the heading, on the first load too, and the tab is still
    named after the heading. A dialog starts on its marked field the same way, otherwise on its first control. A
    plain `autoFocus` is not enough on a page: the heading takes focus after it.
  - **Scan fields** (`ScanInput` in `admin/components/kit.tsx`) hold one lookup at a time. Screens where a stack is
    scanned use `queue` (later scans wait their turn under a "Looking up N scans" line; failures are listed as
    "CODE: message"), `focusSignal` to take focus back after a save, and `onEmptyEnter` to confirm with Enter. A
    scanner's own Enter never confirms. A page that confirms what was scanned listens to `onPendingChange` and
    holds its confirm button, and keeps the field on screen, until the count is back to 0: codes still waiting
    when the field goes away are dropped. The field never takes focus from a dialog that has opened over it.
  - **Remembered choices** (last shelf, last rider) go through `shared/remember.ts`: kept in the browser per
    organization and branch, checked against what is still on offer when read, never anything personal.
- Web pages live with their feature; anything used by two features moves to `shared/` (UI), `admin/components/`
  (console-only UI) or `data/` (reads and calls).
- **Shared helpers:** server calls go through `command` (replay-safe writes) or `call` (reads and jobs) in
  `data/api.ts`, which turn failures into user-facing `ApiError`s. PDFs are opened or downloaded with
  `openFile`/`downloadFile` (`data/files.ts`). Business dates in India come from `shared/dates.ts` (`todayIST`,
  `monthIST`, `addDays`, `daysUntil`). Money: `money` (paise) and `rupees` (whole rupees, payroll) in
  `shared/format.ts`. On the server, `core/time.ts` has the dates and `core/pdfText.ts` makes text safe for the
  standard PDF fonts.
- **Loading:** every page is loaded on first visit (`lazyPage` in `AdminApp.tsx`, `lazy` in `routes.tsx`); the
  shells show a skeleton meanwhile. Firebase and React are built into their own files (`vite.config.ts`) so they
  stay cached across deploys. The barcode decoder (ZXing) loads only inside its Web Worker.
  - **First screen:** the console's code (`AdminApp`) starts downloading when `routes.tsx` loads, while sign-in is
    still being checked; `index.html` opens the connections to sign-in and the database early (`preconnect`).
    Later pages are not fetched ahead: a speculative fetch that fails in a tab from before a deploy would reload
    the page.
  - **Organization and branches** are read side by side (`admin/Workspace.tsx`): the branches of the remembered
    organization, or the first by id in the person's claims, are asked for while the organizations load (a Super
    Admin's list is not in the claims, so only a remembered one is). The rows carry their organization and are
    used only once that organization is the one resolved; `branchesLoading` stays true from the moment the
    organization is known until its own branches are in, so nothing runs once without the branch and again with it.
  - **Coming back to a page** (`useAsync`'s `cache` option, `shared/asyncCache.ts`): a read that opts in paints
    what it showed last time with the same inputs, marked `cached`, while it reads again; if that read fails the
    old data goes and the error shows. Memory only (never the disk), at most 5 minutes old and 100 answers, and
    emptied when another person signs in, permissions change or the console is left. Always read again, and never
    used for forms, availability, limits or money; one-click actions stay disabled while `cached` is true. The
    Dashboard uses it today.
- **Dashboards** never say "all clear" while loading, and say so when part of them could not be loaded (with a
  retry) instead of hiding the items that failed.

---

## 4. Flutter architecture

- **Feature-first.** Each feature folder owns its providers, repositories, and widgets. `data/domain/presentation`
  split only for complex features (circulation, tasks, payroll); simple ones (e.g. holidays) stay flat.
- **Riverpod 2 with code generation** (`@riverpod`). Rules:
  - Repositories are providers; widgets never call Firebase SDKs directly.
  - Streams (`snapshots()`) only for genuinely live screens; everything else `get()` + pull-to-refresh.
    `autoDispose` by default so listeners detach with the screen.
  - Mutations are `AsyncNotifier` methods that call a `FunctionsGateway` and expose
    `idle → submitting → confirmed | failed`; there is no optimistic "success".
  - Session state: `authStateProvider` → `sessionProvider` (user + memberships + active org/branch)
    → `permissionsProvider` (resolved from the same matrix as the backend).
- **GoRouter** with `ShellRoute`s per persona (member bottom-nav, employee/librarian, delivery, staff console
  side-nav). A single redirect guard checks: signed in → profile complete → has permission for the route.
  Deep links: `/book/:bookId`, `/subscription/:planId`, `/orders/:orderId`, `/task/:taskId`
  (mobile scheme `stories://`).
- **Models:** Freezed + json_serializable. Firestore converters live in the repository layer; `Timestamp` ↔ `DateTime`
  (UTC) and money as `Money(minorUnits, currency)`.
- **Errors:** functions return typed error codes (`COPY_NOT_AVAILABLE`, `BORROW_LIMIT_REACHED`,
  `SUBSCRIPTION_NOT_ACTIVE`, …). The app maps codes → localized, actionable messages. Raw `FirebaseException`
  text is never shown; unknown errors go to Crashlytics (PII-scrubbed) and show a generic message.
- **Flavors:** `dev`, `staging`, `prod` via `--dart-define-from-file` + `flutterfire configure` per flavor.
  Dev builds connect to the emulators when `USE_EMULATORS=true`.
- **Scanning:** `mobile_scanner` for camera; hardware (HID/Bluetooth keyboard-wedge) scanners supported on web and
  Android via a focused scan-input widget — scanner-first librarian flows.
- **Localization:** `flutter_localizations` + ARB from day one; no literal user-facing strings in widgets.
- **Accessibility:** semantic labels, 48dp targets, text-scale-safe layouts, status badges carry icon + text (never
  color only).

---

## 5. Cloud Functions architecture

- **Runtime:** 2nd-gen functions, Node 22, TypeScript strict, region `asia-south1` (Mumbai), `maxInstances: 5`.
  Every action is served by one function, `api` (docs/API.md), so any call keeps the whole backend awake; the app
  also pings it when it opens, and browsers may cache its CORS preflight for 2 hours. With the seven older routers
  kept for one release there are 19 services in all, 12 once they are removed (docs/DEPLOYMENT.md).
- **Every command follows one pipeline** (`core/callable.ts`, details in docs/API.md):

```text
App Check (when enforced) → authenticated → zod-validate input (+ requestId)
→ load actor (profile; a disabled account is refused), in parallel with the transaction's first read below
→ prepare (optional: calls to other services, outside the transaction; skipped on a replay)
→ db.runTransaction(idempotency lookup + the caller's membership of input.orgId, in one read
   → permission checks (from that read) → business rules → writes → audit → idempotency record)
→ after (optional, idempotent: claims sync, notifications; retried with the same requestId until it succeeds)
→ result, plus one structured log line (fn, uid, orgId, requestId, phase, ms)
```

- **Idempotency:** each command takes a client-generated `requestId`; the transaction creates
  `idempotency/{fn}:{uid}:{requestId}` with the result (TTL 30 days); a retry returns it. The web retries transient
  failures with the same id. Webhooks dedupe on the gateway's own ids; scheduled jobs use deterministic ids (e.g.
  one renewal reminder per plan and threshold).
- **Audit:** `recordAudit(tx, …)` is called *inside* the same transaction as the change, so an audited change can
  never commit without its audit entry.
- **Callable vs HTTPS:** callables for app operations; HTTPS only for the Razorpay, WhatsApp (Meta) and courier
  webhooks, each verified (HMAC signature or per-branch token, compared in constant time via `core/crypto.ts`).
- **Scheduled jobs** (`core/sweep.ts`: paged, one failing document never blocks the rest, 540 s timeout, one summary
  log line): subscription expiry and renewal reminders (hourly), reservation holds (15 min), maintenance (15 min:
  stale claims, stuck WhatsApp messages), document expiry and leave accrual (daily). All idempotent.
- **Triggers:** one Firestore trigger, `whatsapp-send` (each queued message). Custom claims are synced by the
  role-changing commands after commit; users stay `claimsStale` until the token is updated, and the maintenance job
  finishes any sync that failed.
- **Secrets:** per-branch payment, WhatsApp and courier keys live in `branches/{b}/private/*` documents that Security
  Rules deny to every client; function settings: non-secret ones (`BOOTSTRAP_SUPER_ADMIN_EMAIL`) in the committed `functions/.env`
  (`functions/.env.local` for the emulator); private ones (`GOOGLE_BOOKS_API_KEY`, `ENFORCE_APP_CHECK`) in the
  git-ignored `functions/.env.stories-for-all` (the optional `FUNCTIONS_ENV` secret for CI deploys).
- **Testing:** unit tests on pure domain functions (state machines, payroll math, recurrence) with Vitest;
  integration tests against the emulators (including concurrency tests that fire parallel callables).

---

## 6. Module dependency map

```text
                     ┌──────────────────────── Platform core ────────────────────────┐
                     │ Auth · Organizations · Branches · RBAC · Config · Audit ·     │
                     │ Notifications · Files                                         │
                     └───────────────────────────────┬───────────────────────────────┘
                                                     │ (every module depends on core)
      ┌──────────────────────────────┬───────────────┴────────────┬──────────────────────────┐
      ▼                              ▼                            ▼                          ▼
   Catalogue (Books) ──► Inventory (Copies, Locations, Transfers)          HRMS (Employees, Assignments, Docs)
      │                              │                                        │
      │        Members ──► Subscriptions ──► Deposits                         ├──► Shifts ──► Attendance ──┐
      │           │             │  ▲            ▲                             │                            │
      │           │             │  └─ Payments ─┘ (subscription, deposit,     ├──► Leave ──────────────────┤
      │           │             │                 delivery, refunds)          │                            ▼
      ▼           ▼             ▼                    ▲                        │                        Payroll
   Reservations ──► Circulation (Loans, Returns, Exchanges)                   │
                         │                           │                        └──► Tasks ◄── SOPs
                         ▼                           │                              ▲ (uses Shifts, Leave,
                     Delivery (Orders, Items, Zones)─┘                              │  Holidays, Attendance)
                                                                                    │
   Franchise (royalty, settlements, revenue attribution) ◄── Payments, Inventory, Circulation
   Reports / Analytics ◄── summary documents produced by every module
```

Rules of the map: dependencies point one way; circulation never calls HRMS; tasks read HRMS but HRMS doesn't know
about tasks; reports only consume summary docs.

---

## 7. Deployment architecture

```text
feature/* ─PR─► develop ──auto──► stories-dev      (functions, rules, indexes, hosting preview channels)
                   │
               release/* ──auto──► stories-staging (+ Play internal track, TestFlight)
                   │
                 main (tag vX.Y.Z, manual approval via GitHub Environment) ──► stories-prod
hotfix/* ─► main + back-merge to develop
```

**CI (every PR):** `dart format --set-exit-if-changed` → `flutter analyze` → unit & widget tests → functions lint +
typecheck + unit tests → emulator suite: rules tests + functions integration tests → `flutter build web` (both
entrypoints) + `flutter build apk --debug` as build validation. PR preview channel on Firebase Hosting (dev project).

**CD:** Workload Identity Federation from GitHub Actions to each GCP project (no long-lived JSON keys); per-environment
GitHub Environments with required reviewers on `prod`.

| Environment | Firebase project | Deploy from | Data |
|---|---|---|---|
| Development | `stories-dev` | `develop` | seed/demo only |
| Staging | `stories-staging` | `release/*` | anonymized/seed |
| Production | `stories-prod` | tagged `main`, manual approval | real |

Backups: Firestore **PITR** (7-day) + scheduled daily managed exports to a separate GCS bucket with retention lock;
quarterly restore drill into staging. Documented in DEPLOYMENT.md at M0.
