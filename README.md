# Stories

*Every book begins a new story.*

Stories is a subscription-based, multi-branch library platform: members borrow within their plan limit and exchange
books unlimited times, with pickup or home delivery. The same platform runs branch operations, including HRMS,
attendance, leave, payroll, tasks and SOPs, for company-owned and franchise branches.

**Stack:** a web app (Vite + React + TypeScript) on **Firebase** (Hosting, Auth, Firestore, Cloud Functions), code
on **GitHub**. One Firebase project; pushing to `main` publishes the site; the backend deploys with
`npm run deploy:backend`.

**Status:** Phase 0 (foundation) complete — sign-in, organizations, branches, departments, staff roles with
server-enforced permissions, audit log. Phase 1 (core library) is next.

```bash
npm ci && npm --prefix functions ci
npm run emulators        # terminal 1: local Firebase incl. Cloud Functions (no cloud project touched)
npm run seed             # terminal 2: demo orgs, branches and one user per role (password stories-demo)
npm run dev              # terminal 2 → http://localhost:8081
npm run test:web && npm run test:functions && npm run test:rules
```

Docs:

- [docs/ENVIRONMENTS.md](docs/ENVIRONMENTS.md): Firebase + GitHub setup, local development, secrets policy
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md): hosting and backend deploys, one-time console steps
- [docs/API.md](docs/API.md): Cloud Functions conventions and callables
- [docs/FIRESTORE_RULES.md](docs/FIRESTORE_RULES.md): security rules and indexes
- [docs/TESTING.md](docs/TESTING.md): test suites
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): audit, architecture, design, deployment
- [docs/DATABASE.md](docs/DATABASE.md): Firestore data model, ERD, indexes, concurrency
- [docs/RBAC.md](docs/RBAC.md): security architecture, roles & permissions, rules
- [docs/BUSINESS_RULES.md](docs/BUSINESS_RULES.md): final rules, state machines, open decisions
- [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md): phased milestones
