# Stories

*Every book begins a new story.*

Stories is a subscription-based, multi-branch library platform: members borrow within their plan limit and exchange
books unlimited times, with pickup or home delivery. The same platform runs branch operations, including HRMS,
attendance, leave, payroll, tasks and SOPs, for company-owned and franchise branches.

**Stack:** Flutter (mobile + web) · Firebase (Auth, Firestore, Cloud Functions, Storage, FCM, App Check,
Crashlytics, Analytics, Hosting) · GitHub Actions.

**Status:** Foundation in progress. Flutter web app with Firebase Auth runs against the emulators; cloud project
provisioning is scripted (see [docs/ENVIRONMENTS.md](docs/ENVIRONMENTS.md)).

```bash
npm ci && flutter pub get
npm run emulators        # terminal 1
npm run web:emulator     # terminal 2 → http://localhost:8081
```

Docs:

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): audit, architecture, Flutter & Functions design, deployment
- [docs/DATABASE.md](docs/DATABASE.md): Firestore data model, ERD, indexes, concurrency
- [docs/RBAC.md](docs/RBAC.md): security architecture, roles & permissions, rules
- [docs/BUSINESS_RULES.md](docs/BUSINESS_RULES.md): final rules, state machines, open decisions
- [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md): phased milestones
- [docs/ENVIRONMENTS.md](docs/ENVIRONMENTS.md): environments, Firebase provisioning, secrets policy
