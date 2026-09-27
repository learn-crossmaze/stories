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
| R6 | Offline cache showing stale availability or unconfirmed operations as done | Critical operations are callables (online-only); UI shows `Syncing / Confirmed / Failed` states; no optimistic success |
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

```text
stories/
├─ apps/
│  └─ stories_app/                 # the single Flutter app (mobile + web)
│     ├─ lib/
│     │  ├─ main_member.dart        # web entrypoint: member site
│     │  ├─ main_staff.dart         # web entrypoint: staff/admin console
│     │  ├─ main.dart               # mobile entrypoint: role-gated after login
│     │  ├─ app/                    # router, theme wiring, flavor config, root providers
│     │  ├─ core/                   # errors, result types, extensions, firebase bootstrap, logging
│     │  ├─ features/<feature>/     # data / domain / presentation (only where justified)
│     │  └─ l10n/                   # ARB files (English first)
│     ├─ test/  integration_test/
│     └─ android/ ios/ web/
├─ packages/
│  ├─ stories_design_system/       # tokens, theme, components, empty/error/loading states
│  └─ stories_contracts/           # Dart models for callable requests/responses + enums
│                                   # (generated from functions/src/contracts → single source)
├─ functions/                      # Cloud Functions, TypeScript
│  ├─ src/
│  │  ├─ core/        # auth context, permission checks, idempotency, audit, errors, clock, money
│  │  ├─ contracts/   # zod schemas = API contract (source for Dart codegen)
│  │  ├─ auth/ orgs/ branches/ members/ books/ inventory/ circulation/ subscriptions/
│  │  ├─ deposits/ payments/ delivery/ employees/ attendance/ leave/ payroll/
│  │  ├─ tasks/ sops/ notifications/ reports/ franchise/ audit/ scheduled/
│  │  └─ index.ts     # re-exports only
│  └─ test/           # unit + emulator integration tests
├─ firebase/
│  ├─ firestore.rules              # generated from rules/src + permissions.json
│  ├─ rules-src/                   # rule modules + permission matrix codegen
│  ├─ storage.rules
│  ├─ firestore.indexes.json
│  └─ rules-tests/                 # @firebase/rules-unit-testing
├─ tools/seed/                     # emulator/dev seed (clearly flagged `seed: true`)
├─ docs/
├─ .github/workflows/
├─ firebase.json  .firebaserc      # aliases: dev / staging / prod
└─ pubspec.yaml                    # Dart pub workspace root
```

Dart **pub workspaces** (Dart ≥ 3.6) tie the app and packages together — no Melos needed.

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

- **Runtime:** 2nd-gen functions, Node 22, TypeScript strict, region `asia-south1` (Mumbai) for data residency and
  latency (confirm).
- **Every callable follows one pipeline** (implemented once in `core/`):

```text
App Check verified → authenticated → zod-validate input → load actor (memberships)
→ requirePermission(perm, {orgId, branchId}) → idempotency check (requestId)
→ db.runTransaction(business logic + audit entry + idempotency record)
→ post-commit side effects (notifications) → typed result
```

- **Idempotency:** each mutating callable takes a client-generated `requestId` (UUIDv4). The transaction creates
  `orgs/{orgId}/idempotency/{fn}:{requestId}` storing the result; a retry returns the stored result. Webhooks
  dedupe on the gateway event id. Scheduled generators use deterministic document IDs.
- **Audit:** `audit.record(tx, {...})` is called *inside* the same transaction as the change, so an audited change can
  never commit without its audit entry.
- **Callable vs HTTPS:** callables for app operations; HTTPS only for Razorpay webhooks (HMAC-verified) and future
  third-party integrations.
- **Scheduled jobs** (Cloud Scheduler): subscription expiry sweep (hourly), task generation (every 15 min, generating
  the next 48h window), reminder/escalation dispatcher (every 5 min), daily summaries (branch-local midnight),
  missing-checkout marker (after branch closing). All retry-safe.
- **Triggers:** membership → custom-claims sync; copy/loan changes → availability counters; notification docs →
  FCM send.
- **Secrets:** Razorpay keys, email provider keys in **Secret Manager** (`defineSecret`), never in the repo.
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
