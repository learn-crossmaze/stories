# Stories — Cloud Functions API conventions

All app operations are **callable functions** in `asia-south1`, named `<group>-<name>` (e.g. `branches-create`).
Implementation: `functions/src/core/callable.ts`.

## Two kinds of callable

| Kind | Helper | Pipeline |
|---|---|---|
| **Command** (changes data) | `command(name, schema, handler, after?)` | auth → zod validation (strict: unknown fields rejected) → **one Firestore transaction**: idempotency lookup → handler (permission check via `actor.require`, business rules, writes, `recordAudit`) → store result under `idempotency/{name}:{uid}:{requestId}` → commit → `after` side effects (e.g. claims sync) |
| **Query / idempotent op** | `query(name, schema, handler)` | auth → validation → handler |

- **`requestId`** (UUID, required on commands): the web client generates one per user action (`data/api.ts`
  `command()`); a retry with the same id returns the stored result instead of repeating the change. Records expire
  via Firestore TTL on `expireAt` (30 days).
- **Permissions** are checked against the *authoritative* membership documents inside the transaction, not token
  claims (claims can lag a revocation).
- **Audit**: `recordAudit(tx, …)` writes `orgs/{o}/auditLogs` (or `platformAuditLogs`) in the same transaction, so a
  change can never commit without its audit entry.

## Errors

Domain failures throw `AppError(code, reason, message)`: `message` is written for end users, `reason` is a stable
machine code (`FORBIDDEN`, `INVALID_INPUT`, `NOT_FOUND`, `BRANCH_CODE_TAKEN`, `USER_NOT_FOUND`,
`EMAIL_NOT_VERIFIED`, `ALREADY_BOOTSTRAPPED`, …). Unexpected errors are logged server-side and returned as a generic
"Something went wrong" — internals never reach the client.

## Phase 0 callables

| Name | Permission | Input (besides `requestId`) |
|---|---|---|
| `users-ensureProfile` | signed in | — (query) |
| `platform-bootstrapSuperAdmin` | configured owner email, verified, once | — |
| `orgs-create` / `orgs-update` | Super Admin | `name, type` / `orgId, name?, status?` |
| `branches-create` | `branches.manage` | `orgId, code, name, address, contact, operatingHours, weeklyOffs` |
| `branches-update` / `branches-archive` | `branches.manage` (at branch) | `orgId, branchId, …` / `orgId, branchId, reason` |
| `departments-create` / `-rename` / `-archive` | `departments.manage` | `orgId, name, branchId?` / `…departmentId, name` / `…departmentId, reason` |
| `staff-setRoles` | `staff.manageRoles` + grant rules (RBAC.md §4.1) | `orgId, email, roles[], branchIds[]` |
| `staff-revoke` | same | `orgId, uid, reason` |
