# Stories — Business Rules

> Status: rules 1–37 are **final** (from the product brief). Decisions D1–D11 in section 3 were **accepted by the
> product owner on 2026-09-27** and are now binding for implementation.

## 1. Final rules (current version)

1. Stories is a subscription-based physical library.
2. Audience = Children, Teenagers, Adults.
3. Subscription durations = Monthly, Quarterly, Half-yearly, Annual.
4. Plans have different simultaneous borrowing limits.
5. Unlimited exchanges are allowed while the subscription is active.
6. There is no monthly exchange quota.
7. There is no fixed maximum borrowing period.
8. There are no conventional overdue fines based solely on borrowing duration.
9. Every member pays a refundable security deposit.
10. The security deposit is separate from subscription revenue.
11. Home delivery is available.
12. Every home delivery is chargeable separately.
13. Physical library pickup is included.
14. Company-owned branches are supported.
15. Franchise branches are supported.
16. Cross-branch inventory transfers are supported.
17. Family membership is NOT part of the MVP.
18. The database architecture must support future family membership.
19. HRMS is part of the platform.
20. Attendance is part of the platform.
21. Leave management is part of the platform.
22. Payroll is part of the platform.
23. Employee self-service is part of the platform.
24. Task management is part of the platform.
25. Recurring checklists are part of the platform.
26. SOPs are part of the platform.
27. Scheduled reminders are part of the platform.
28. Overdue task escalation is part of the platform.
29. Task scheduling integrates with shifts and leave.
30. Company and franchise data must be isolated.
31. Important financial and operational actions must be auditable.
32. Firebase is the primary backend platform.
33. Firestore is the primary database.
34. The client is a web application (Vite + React + TypeScript), decided 2026-09-27; no mobile apps in scope.
35. GitHub is the source-code repository.
36. Firebase Security Rules and Cloud Functions enforce trusted backend behavior.
37. Critical inventory and financial operations must be transaction-safe and idempotent.

## 2. Circulation state machines

**Copy status** (physical copy):

```text
            ┌──────────── transfer ─────────────┐
            ▼                                   │
 (acquire) AVAILABLE ──allocate──► RESERVED ──issue──► ISSUED ──return──► UNDER_INSPECTION ──pass──► AVAILABLE
            │   ▲                    │                   │                     │
            │   └──release/expire────┘                   └──declare lost──► LOST (terminal; may be FOUND → UNDER_INSPECTION)
            ├──dispatch──► IN_TRANSIT ──receive──► UNDER_INSPECTION         └──fail──► DAMAGED ──repair──► AVAILABLE
            └──retire──► RETIRED (terminal)                                             └──retire──► RETIRED
```

**Loan status:** `ACTIVE → RETURNED | LOST → (WRITTEN_OFF)`. "RETURNED" in the brief's example flow is a *loan*
state; the copy moves `ISSUED → UNDER_INSPECTION`. Any transition not drawn above is rejected by the function.

**Condition** (`NEW, GOOD, FAIR, DAMAGED, UNUSABLE`) changes are recorded as copy events, never silently overwritten.

## 3. Interpretations & decisions (accepted 2026-09-27)

| # | Topic | Proposed rule | Why |
|---|---|---|---|
| D1 | Payments before Phase 2 | In Phase 1, subscriptions and deposits are activated by **staff-recorded offline payments** (cash/UPI/card at counter) — a real `payments` record with `method=OFFLINE_*`, recorded by an authorized user and audited. Online gateway (Razorpay) arrives in Phase 2. | Phase 1 includes subscriptions/deposits but payments are Phase 2; this avoids fake payments. |
| D2 | Do allocated reservations count toward the borrowing limit? | **Yes** for `ALLOCATED` (a copy is set aside for the member); **no** for `WAITING` in queue. Max waiting reservations per member configurable (default = plan limit). | Prevents members hoarding copies beyond their plan. |
| D3 | Reservation pickup window | Allocated copy held for a configurable window (default 48h, branch-local), then released to next in queue. | Otherwise copies are stranded. |
| D4 | Expired subscription + delivery | Members with expired subscriptions may book a **return pickup** (charged) but not delivery of new books. | Follows rule "can return books". |
| D5 | Lost/damaged charges | Charge = configurable policy per book (default: acquisition cost or catalogue replacement price) × condition factor; applied via deposit **deduction** (maker-checker) or a separate payment. | Needed for deposit settlement. |
| D6 | Renewal timing | Renewal before expiry creates a new subscription starting at the old `endAt` (no gap, no overlap); after expiry it starts on payment. Loans carry over to the new term automatically (loan keeps original `subscriptionId`; limit counted against the active term). | Preserves history, continuous borrowing. |
| D7 | Plan changes mid-term (upgrade/downgrade) | Out of MVP; members change plan at renewal. Downgrade below current loan count allowed but blocks new issues until under the new limit. | Keeps Phase 1 small. |
| D8 | Minimum member age for own login | Children (< 13, configurable) have no login; guardian manages them. Teens may get own login linked to guardian (configurable). | Privacy / consent. |
| D9 | Catalogue ownership | Single Stories-wide catalogue managed by head office; franchises own copies. Franchise-specific titles later via `visibility`. | Avoids duplicate titles; consistent discovery. |
| D10 | Region/currency/jurisdiction | India: `asia-south1`, INR, Indian payroll statutory components as configurable rules. | Implied by PF/ESI/PT/TDS. |
| D11 | Branch a member borrows from | MVP: member's home branch (and its delivery zones). Cross-branch borrowing is a future phase. | Brief §57. |
