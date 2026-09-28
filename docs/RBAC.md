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

| Role | Scope | Summary |
|---|---|---|
| SUPER_ADMIN | platform | Everything, incl. platform config. Break-glass; MFA required. |
| HEAD_OFFICE_ADMIN | corporate org + consolidated read of franchise orgs | Branches, catalogue, plans, reports, franchise oversight |
| FINANCE_ADMIN | org | Payments, refunds, deposits (approve), payroll approval, settlements |
| HR_ADMIN | org | Employees, documents, attendance/leave config, payroll preparation |
| BRANCH_MANAGER | branch(es) | Operations, approvals (leave, corrections, task skips), branch reports |
| LIBRARIAN | branch(es) | Circulation, inventory, members at counter, reservations, transfers |
| DELIVERY_PERSON | branch(es) | Assigned delivery orders only |
| FRANCHISE_OWNER | own franchise org | Branch-manager-plus powers within their org; franchise reports; no other org |
| EMPLOYEE | self | Self-service: profile, attendance, leave, payslips, tasks, documents |
| MEMBER | self + guarded children | Own member profiles, subscriptions, loans, orders, deposits |

A staff person holds `EMPLOYEE` plus their operational role(s). A person can be both staff and a member (separate
member record; staff discounts are a future plan type).

## 3. Permissions

Roles map to permissions in one file — `firebase/rules-src/permissions.json` — the single source consumed by
(a) Cloud Functions (`Actor.require()` in `functions/src/core/rbac.ts`), (b) the generated `perms()` map in
`firebase/firestore.rules`, and (c) the web app's `can()` (UI only). `npm run gen:rbac` regenerates all three; CI runs
`tools/rbac/generate.mjs --check` and fails if any is stale. Super Admin is not in the map: the `sa` claim (rules)
and `platformRoles` (functions) grant everything.

Initial catalogue (excerpt):

| Permission | SA | HO | FIN | HR | BM | LIB | DEL | FO | EMP | MEM |
|---|---|---|---|---|---|---|---|---|---|---|
| books.view | ✓ | ✓ | ✓ | | ✓ | ✓ | ✓ | ✓ | | ✓ |
| books.create (add titles, authors, publishers, categories; a missing cover) | ✓ | ✓ | | | ✓ | | | | | |
| books.edit (change/archive titles and reference data, covers, book numbering) | ✓ | ✓ | | | | | | | | |
| copies.manage (acquire, locate, condition) | ✓ | ✓ | | | ✓ | ✓ | | ✓ | | |
| books.transfer | ✓ | ✓ | | | ✓ | ✓ | | ✓ | | |
| copies.writeOff (lost/retire) | ✓ | ✓ | ✓ | | ✓ | | | ✓ | | |
| members.view / members.manage | ✓ | ✓ | ✓ | | ✓ | ✓ | | ✓ | | self |
| loans.issue / loans.return / exchanges.process | ✓ | | | | ✓ | ✓ | (via delivery handover) | ✓ | | |
| reservations.manage | ✓ | | | | ✓ | ✓ | | ✓ | | self |
| subscriptions.manage | ✓ | ✓ | ✓ | | ✓ | ✓ | | ✓ | | self (purchase/renew) |
| plans.manage | ✓ | ✓ | | | | | | | | |
| deposits.view | ✓ | ✓ | ✓ | | ✓ | ✓ | | ✓ | | self |
| deposits.adjust (propose) | ✓ | | ✓ | | ✓ | | | ✓ | | |
| deposits.approve / deposits.refund | ✓ | | ✓ | | | | | | | |
| payments.view / payments.recordOffline | ✓ | ✓ | ✓ | | ✓ | ✓ | | ✓ | | self (view) |
| payments.refund | ✓ | | ✓ | | | | | | | |
| delivery.manage / delivery.assign | ✓ | | | | ✓ | ✓ | | ✓ | | |
| delivery.execute (assigned only) | | | | | | | ✓ | | | |
| employees.view / employees.edit | ✓ | ✓ | | ✓ | view (branch) | | | ✓ (own org) | self | |
| employees.privateData | ✓ | | ✓ (bank) | ✓ | | | | | self | |
| attendance.manage / corrections.approve | ✓ | | | ✓ | ✓ | | | ✓ | self (request) | |
| leave.approve | ✓ | | | ✓ | ✓ | | | ✓ | self (apply) | |
| payroll.run | ✓ | | | ✓ | | | | ✓ (own org) | | |
| payroll.approve | ✓ | | ✓ | | | | | ✓ (own org, if configured) | | |
| tasks.assign / tasks.approve / tasks.skip | ✓ | ✓ | | | ✓ | | | ✓ | | |
| tasks.execute | | | | | | | | | self | |
| sops.edit / sops.publish | ✓ | ✓ | | | edit | | | edit (own org) | | |
| reports.view (scope-limited) | ✓ | ✓ | ✓ | ✓ | branch | | | own org | | |
| config.manage | ✓ | ✓ | | | | | | | | |
| audit.view | ✓ | ✓ | ✓ | ✓ (HR entities) | branch | | | own org | | |

Maker-checker: `deposits.adjust` creates a *pending* adjustment; `deposits.approve` must be held by a **different**
user above a configurable threshold. Same pattern for refunds and payroll approval.

## 4. Where authorization data lives

- **Authoritative:** `users/{uid}/memberships/{orgId}` → `{ roles[], branchScope: "ALL" | [branchIds], status }`.
  Written only by functions (`staff.grantRole`, `staff.revokeRole`), audited.
- **Fast path (custom claims)**, synced by `syncClaims(uid)` (`functions/src/core/claims.ts`), which the
  role-changing callables call right after their transaction commits:

```json
{ "v": 7, "sa": false, "hq": false,
  "o": { "<orgId>": { "r": ["BM","LIB","EMP"], "b": ["<branchId>"] } } }
```

  Short role codes keep claims under the 1000-byte limit. `v` is a claims version; on change the sync also writes
  `users/{uid}.claimsVersion`, which the app watches to force an ID-token refresh (so revocation applies within
  seconds, and Functions double-check the authoritative doc for sensitive operations like payroll/refunds).
- **Members need no claims.** Member access is ownership-based: `members/{id}.accountHolderUid == auth.uid`, or an
  active guardianship for a child member.

### 4.1 Who may grant which roles (`grantable` in permissions.json)

| Grantor | May grant | Branch limit |
|---|---|---|
| Super Admin | every org role (respecting org type) | none |
| Head Office Admin | HO, Finance, HR, Branch Manager, Librarian, Delivery, Employee | org-wide |
| Franchise Owner | Finance, HR, Branch Manager, Librarian, Delivery, Employee (own org) | org-wide |
| HR Admin | Employee | org-wide |
| Branch Manager | Librarian, Delivery, Employee | own branches only |

Also enforced: nobody but a Super Admin edits their own roles; a grantor cannot edit or remove someone holding a role
they cannot grant; org-wide roles (HO/FIN/HR/FO) always cover all branches; Head Office Admin only in corporate orgs,
Franchise Owner only in franchise orgs; the person must already have signed in once. The first Super Admin is claimed
once via `/setup` by the email in `functions/.env` (`BOOTSTRAP_SUPER_ADMIN_EMAIL`), which must be verified.

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
