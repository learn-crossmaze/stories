# Stories — Testing

| Suite | Command | What it covers |
|---|---|---|
| Web unit/component | `npm run test:web` | sign-in flow, route guards (members kept out of the console), permission-filtered navigation, grant rules mirror, error mapping |
| Functions unit | `npm --prefix functions run test:unit` | claims building, permission map, grantable roles |
| Functions integration | `npm run test:functions` (runs unit + emulator suites) | every Phase 0 callable against the Firestore + Auth emulators: auth required, validation, idempotent retry, audit entry per change, **concurrent duplicate branch code → exactly one succeeds**, org isolation (franchise owner ↛ corporate), self-escalation blocked, branch-scoped grants, claims sync + revocation |
| Security Rules | `npm run test:rules` | org/franchise/branch isolation, self-only profiles, staff directory and audit scoping, default deny |
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
