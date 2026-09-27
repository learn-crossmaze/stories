# Stories — Testing

| Suite | Command | What it covers |
|---|---|---|
| Web unit/component | `npm run test:web` | sign-in flow, route guards (members kept out of the console), permission-filtered navigation, grant rules mirror, error mapping, numbering preview |
| Functions unit | `npm --prefix functions run test:unit` | claims, permissions, grants; ISBN, search tokens, **every copy state transition**, ages/phones, month arithmetic, promo pricing, numbering patterns (22 tests) |
| Functions integration | `npm run test:functions` (runs unit + emulator suites) | every Phase 0 callable against the Firestore + Auth emulators: auth required, validation, idempotent retry, audit entry per change, **concurrent duplicate branch code → exactly one succeeds**, org isolation (franchise owner ↛ corporate), self-escalation blocked, branch-scoped grants, claims sync + revocation. **Phase 1 (18):** codes and duplicate ISBNs, head-office-only catalogue, author rename fan-out, barcodes and availability, retire keeps history, guardian and phone rules, payment idempotency, plan versions don't change sold terms, ledger = balance with maker-checker, settlement blocked with a book out, idempotent expiry sweep and returns after expiry, **two librarians issuing one copy → one wins**, limit and one-slot return, **100 exchanges never blocked and no due date**, lost → proposed deduction, **reservation race**, hold expiry passes to next, transfers keep ownership, return by copy code. **Covers (2):** upload/replace/remove with old files deleted, editors only and images only. **Numbering (6):** branch patterns for copies/members/shelves, only managers change them, clashing patterns refused, employee IDs unique and kept, catalogue book pattern |
| Security Rules | `npm run test:rules` | org/franchise/branch isolation, self-only profiles, staff directory and audit scoping, Phase 1 library scoping and not-found lookups, numbering settings, default deny (24 tests) |
| Generated files | `node tools/rbac/generate.mjs --check` | rules/TS permission maps match `permissions.json` |

All run in CI (`.github/workflows/ci.yml`) on every pull request and push to `main`. Emulator suites need Java 21.

## Manual end-to-end check (emulators)

```bash
npm run emulators   # terminal 1 (builds functions, starts Auth/Firestore/Functions/Storage/Hosting emulators)
npm run seed        # terminal 2 — 10 demo personas, password stories-demo
npm run dev         # terminal 3 — http://localhost:8081
```

Sign in as e.g. `manager@stories.test`, `franchise@stories.test`, `librarian@stories.test` and confirm each sees only
their organization, branches and pages. Phase 0 was verified this way in Chromium (desktop and 390px width).

Phase 1 browser walkthrough (17 checks, all passing on seeded data): librarian dashboard counts; catalogue search
and book availability; member page; desk — collect a held book, limit message, exchange, quick return for an
expired member, inspection; register + subscribe + record payment; minor without guardian blocked; label sheet;
manager declares a loan lost → finance approves the deduction; head office catalogue/plans; librarian can't edit
the catalogue; franchise owner sees only franchise members; desk at 390px without sideways scroll.
