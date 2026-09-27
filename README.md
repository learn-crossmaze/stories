# Stories

*Every book begins a new story.*

Stories is a subscription-based, multi-branch library platform: members borrow within their plan limit and exchange
books unlimited times, with pickup or home delivery. The same platform runs branch operations, including HRMS,
attendance, leave, payroll, tasks and SOPs, for company-owned and franchise branches.

**Stack:** a web app (Vite + React + TypeScript) on **Firebase** (Hosting, Auth, Firestore), code on **GitHub**.
One Firebase project; pushing to `main` publishes the site.

```bash
npm ci
npm run emulators        # terminal 1: local Firebase (no cloud project touched)
npm run dev              # terminal 2 → http://localhost:8081
npm run test:web         # app tests
npm run test:rules       # Security Rules tests
```

Docs:

- [docs/ENVIRONMENTS.md](docs/ENVIRONMENTS.md): Firebase + GitHub setup, deploys, secrets policy
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): audit, architecture, design, deployment
- [docs/DATABASE.md](docs/DATABASE.md): Firestore data model, ERD, indexes, concurrency
- [docs/RBAC.md](docs/RBAC.md): security architecture, roles & permissions, rules
- [docs/BUSINESS_RULES.md](docs/BUSINESS_RULES.md): final rules, state machines, open decisions
- [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md): phased milestones
