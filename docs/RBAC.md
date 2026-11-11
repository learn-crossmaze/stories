# Stories — Security Architecture & RBAC

> Status: **Implemented for Phase 0 (M0.3).** Source of truth: `firebase/rules-src/permissions.json`.

## 1. Layers

```text
Request ─► App Check (is this our app?) ─► Firebase Auth (who?) ─► Authorization (may they?)
                                                                    ├─ Firestore/Storage Rules  (reads + few client writes)
                                                                    └─ Cloud Functions          (every trusted mutation)
```

Authentication ≠ authorization. App Check ≠ authorization. The Flutter UI hides what a user can't do, but hiding is
**never** the control.

## 2. Roles

Ready-made roles (`firebase/rules-src/permissions.json`). The main ladder is Super Admin → Branch Owner → Senior
Librarian → Librarian; the helper roles cover jobs a library also has.

| Role | Scope | Summary |
|---|---|---|
| SUPER_ADMIN (SA) | platform | Everything in every organization: organizations, the shared catalogue, Master control; makes roles for every organization. MFA required. |
| BRANCH_OWNER (OWN) | chosen branches, or all | Runs their branches: the counter, members and money, staff and their roles, approvals, branch settings (delivery, WhatsApp, branch pages), and roles of their own. With **all branches** also the organization-wide settings, HR, payroll, plans and Library rules (a franchise's owner is a Branch Owner with all branches; in the corporate organization also the website and the shared catalogue). |
| SENIOR_LIBRARIAN (SLIB) | chosen branches | A Librarian who also approves: leave and attendance corrections, task skips, write-offs, deposit adjustments; gives Librarian, Delivery Person and Employee; branch delivery, WhatsApp and website pages; branch reports and audit. |
| LIBRARIAN (LIB) | chosen branches | Circulation, reservations, members and payments at the counter, shelving and transfers, blog posts. |
| DELIVERY_PERSON (DEL) | chosen branches | Their assigned deliveries only. |
| WEBSITE_EDITOR (WEB) | corporate organization | The website (docs/WEBSITE_ADMIN.md): blog, branch pages, offers, festive cards, settings; publish. |
| HR_ADMIN (HR) | organization | Employees, documents, attendance and leave, HR settings, preparing payroll. |
| FINANCE_ADMIN (FIN) | organization | Payments, refunds, deposit approvals, payroll approval, bank details. |
| EMPLOYEE (EMP) | chosen branches | Self-service only: profile, attendance, leave, payslips, tasks. |
| MEMBER | self + guarded children | Own member profiles, subscriptions, loans, orders, deposits (not a staff role). |

A staff person can hold several roles in an organization (one branch scope for all of them). A person can be both
staff and a member.

### 2.1 Roles of one's own (Master control → Roles)

Besides the ready-made roles, **Super Admins and Branch Owners make roles**, permission by permission
(`functions/src/organization/roles.ts`, stored in `roles/{id}`), or copy a ready-made role and change it:

- A role belongs to one organization; a Super Admin may also make one for **every** organization.
- It says where it may be given (all branches, or chosen ones) and may be a **whole-organization** role (holders must
  have all branches, like HR Admin).
- **A Branch Owner's roles give only what they hold themselves, at their own branches**; they change or delete a role
  only if they could have made it as it is and as it will be. A Super Admin makes anything except Super Admin-only
  permissions (`superAdminOnly`: organizations).
- **Giving one** (Staff access, or an employee's Access tab) needs `staff.manageRoles` and every permission in it, so no
  one hands out more than they can do; a Senior Librarian may give a Branch Owner's "Shelver" role.
- A role's permissions are copied onto each holder's membership (`customRoles`, `customPerms`, `customRoleNames`) and
  into their token; changing a role updates every holder straight away (claims re-synced), and a role can be deleted
  only when no one holds it. Names are unique, ready-made ones included.

## 3. Permissions

Each permission, its wording in the role editor (`areas`) and which ready-made roles hold it are in
`firebase/rules-src/permissions.json` — the single source consumed by (a) Cloud Functions (`Actor.require()` and
`permissionsOf()` in `functions/src/core/rbac.ts`), (b) the generated `perms()` map in `firebase/firestore.rules`, and
(c) the web app's `can()` (UI only). `npm run gen:rbac` regenerates all of them; CI runs
`tools/rbac/generate.mjs --check` and fails if any is stale. Master control → Roles shows the same list, area by area.

Two rules apply whatever role gives a permission:

- **Organization-wide permissions** (`orgWide`: branches.manage, departments, plans, HR records and settings,
  attendance finalizing, leave adjustments, salaries and payroll, deposit approval and refunds, the catalogue's edits,
  the website, Library rules, publishing procedures) count only for someone whose access covers **all branches**. So a
  Branch Owner of one corporate branch runs that branch, and the head office (Super Admin, or a Branch Owner with all
  branches) runs the organization.
- **Head office permissions** (`corporateOnly`: books.edit, books.delete, website.manage) count only in the corporate
  organization: the shared catalogue and the website belong to it.

Maker-checker: `deposits.adjust` creates a *pending* adjustment; `deposits.approve` must be held by a **different**
user above a configurable threshold (Master control → Library rules). Same pattern for refunds and payroll approval.

## 4. Where authorization data lives

- **Authoritative:** `users/{uid}/memberships/{orgId}` → `{ roles[], branchScope: "ALL" | [branchIds], status }`.
  Written only by functions (`staff.grantRole`, `staff.revokeRole`), audited.
- **Fast path (custom claims)**, synced by `syncClaims(uid)` (`functions/src/core/claims.ts`), which the
  role-changing callables call right after their transaction commits:

```json
{ "v": 7, "sa": false,
  "o": { "<orgId>": { "r": ["SLIB","EMP"], "b": ["<branchId>"], "p": "0a0b0c…" } } }
```

  `p` is every permission the person holds there — from ready-made roles and roles of their own, after the two rules
  in §3 — as 2-character codes run together (`firebase/rules-src/permission-codes.json`, append-only so a token issued
  before a deploy keeps its meaning). Rules check `p` (`holds()` in the rules); `r` is kept for display.

  Short role codes keep claims under the 1000-byte limit. `v` is a claims version; on change the sync also writes
  `users/{uid}.claimsVersion`, which the app watches to force an ID-token refresh (so revocation applies within
  seconds, and Functions double-check the authoritative doc for sensitive operations like payroll/refunds).
- **Members need no claims.** Member access is ownership-based: `members/{id}.accountHolderUid == auth.uid`, or an
  active guardianship for a child member.

### 4.1 Who may give which roles (`grantable` in permissions.json)

| Giver | May give | Branch limit |
|---|---|---|
| Super Admin | every role (respecting org type), and any role of one's own where it may be given | none |
| Branch Owner | Senior Librarian, Librarian, Delivery Person, Employee; HR Admin, Finance Admin, Website Editor (organization-wide: only a Branch Owner with all branches) | own branches only |
| Senior Librarian | Librarian, Delivery Person, Employee | own branches only |
| HR Admin | Employee | org-wide |
| Anyone with staff.manageRoles | roles of the organization's own that give nothing they can't do themselves | own branches, and where the role may be given |

Also enforced: nobody but a Super Admin edits their own roles; a giver cannot edit or remove someone holding a role
they cannot give (ready-made or their own); organization-wide roles (HR/FIN/WEB, whole-organization roles of one's
own) always cover all branches; Website Editor only in the corporate organization; the person must already have
signed in once. The first Super Admin is claimed once via `/setup` by the email in `functions/.env`
(`BOOTSTRAP_SUPER_ADMIN_EMAIL`), which must be verified.

## 5. Isolation model

```text
auth.token.o[orgId]        → user may act in org          (org isolation)
auth.token.o[orgId].b      → branches within org           (branch isolation; "*" = all)
role → permission           → action allowed               (RBAC)
resource ownership          → member/employee self-access  (privacy)
```

- **Franchise isolation:** a franchise owner's claims contain only their own `orgId`; every tenant path is
  `orgs/{orgId}/…`, so no rule grants access to another franchise's path. Test: *Franchise A requesting
  Franchise B employee records → denied* (rules test + callable test).
- **Head-office consolidated view:** `hq: true` users may read franchise orgs' **summary** documents
  (`dailyStats`, org summaries, settlements) and operational collections listed in an allow-list; never
  `employees/*/private`, documents, or payroll entries of franchise orgs unless the franchise agreement grants it
  (configurable, Phase 7).

## 6. Firestore rules pattern

```js
// generated helpers (excerpt)
function signedIn()          { return request.auth != null; }
function org(o)              { return signedIn() && (o in request.auth.token.o); }
function inBranch(o, b)      { return org(o) && (request.auth.token.o[o].b.hasAny(['*', b])); }
function can(o, perm)        { return org(o) && request.auth.token.o[o].r.hasAny(PERM[perm]); } // PERM generated
function canAt(o, b, perm)   { return can(o, perm) && inBranch(o, b); }

match /orgs/{o}/loans/{id} {
  allow read: if canAt(o, resource.data.branchId, 'loans.view')
              || isAccountHolder(o, resource.data.memberId);
  allow write: if false;                          // functions only
}
match /orgs/{o}/notifications/{id} {
  allow read: if resource.data.recipientUid == request.auth.uid;
  allow update: if resource.data.recipientUid == request.auth.uid
                && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['readAt']);
}
match /orgs/{o}/auditLogs/{id} { allow read: if can(o, 'audit.view'); allow write: if false; }
```

No `allow read, write: if request.auth != null` anywhere; a lint step greps generated rules for it.
List queries must include the scoping filters the rules check (e.g. `where('branchId', '==', b)`), which the
repositories enforce.

## 7. Storage rules

```text
catalog/covers/{bookId}/{file}                         public read (covers only), function write
orgs/{o}/employees/{e}/documents/{file}                HR/self read via rules; upload to staging path, function verifies
orgs/{o}/copies/{c}/damage/{file}                      branch staff
orgs/{o}/tasks/{t}/evidence/{uid}/{file}               assignee write (size/type limits), branch managers read
orgs/{o}/sops/{s}/v{n}/{file}                          org staff read; immutable after publish
orgs/{o}/payslips/{e}/{file}                           self + HR/Finance; generated by function
```

Sensitive files are served via short-lived signed URLs from a callable when finer-grained checks are needed.

## 8. Cloud Function authorization checklist (every callable)

1. App Check token (enforced).
2. `request.auth` present; user `status == ACTIVE`.
3. Input validated by zod schema; unknown fields rejected.
4. `requirePermission(actor, perm, { orgId, branchId })` using the **authoritative** membership for
   finance/HR/payroll operations, claims for the rest.
5. Resource ownership / scope (the loan's branch is in the actor's scope, the member is theirs, …).
6. Business state checks inside the transaction.
7. Audit entry in the same transaction.
8. Rate limiting per uid on sensitive callables (OTP, payment initiation, QR check-in) via a token bucket doc.

## 9. Privacy

- No PII in logs, analytics events, FCM payload bodies for sensitive types (payslip notification says "Your payslip
  is available", not the amount), URLs, or error messages.
- Bank account numbers stored masked + reference; full value only in `employees/{id}/private` with field-level
  read restriction (HR/Finance/self).
- Crashlytics: custom keys limited to role and screen; user identifier = opaque uid.
