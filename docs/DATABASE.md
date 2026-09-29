# Stories — Firestore Data Model

> Status: **Proposed (awaiting approval)**. Field lists show key fields, not every field.

> **As built (Phase 1, 2026-09-27) — differences from the design below:**
> - Catalogue collections are **top-level** `books`, `authors`, `publishers`, `categories` (plus `isbnIndex`,
>   `counters/books`); `catalog/books/{id}` is not a valid document path.
> - **No availability projection**: per-branch availability is counted live with count queries
>   (`copies-availability`), so there are no counters to drift or reconcile.
> - The **book limit is tracked on the member** (`activeLoanCount`, `allocatedCount`, `waitingCount`), so loans
>   carry over renewals; the subscription keeps `exchangesThisTerm`.
> - **Guardian** is stored on the child member (`guardian.memberId`); no `guardianships` collection.
> - Circulation dashboards use count queries instead of `dailyStats` for now.
> - Details per module: [LIBRARY.md](LIBRARY.md), [CIRCULATION.md](CIRCULATION.md), [SUBSCRIPTIONS.md](SUBSCRIPTIONS.md).

## 1. Principles

1. **Tenant-scoped paths.** Everything owned by an organization lives under `orgs/{orgId}/…`. Isolation is then
   visible in the path itself, rules are simple (`orgId` is a path variable, not a trusted field), and a mis-scoped
   query fails instead of leaking. Every document *also* stores `orgId` (and `branchId` where branch-scoped) so
   collection-group queries and exports stay filterable.
2. **Global only what is genuinely shared:** user identities, the Stories book catalogue, platform config.
3. **Immutable IDs.** Firestore auto-IDs as document IDs. Human-readable codes (`BOOK-000123`, `BK000123-CP01`,
   `EMP-C-00042`, `MEM-CEN-000981`) are separate, unique, indexed fields allocated from per-scope counters inside the
   creating transaction. Display names are never keys.
4. **Deterministic IDs where duplicates must be impossible:** attendance `{employeeId}_{yyyyMMdd}`, task instance
   `{scheduleId}_{occurrenceKey}`, reminder `{taskId}_{ruleIdx}_{n}`, payroll entry `{runId}_{employeeId}`,
   uniqueness indexes (`barcodes/{barcode}`, `phoneIndex/{e164}`).
5. **Append-only ledgers** for money and history: deposit transactions, payments, condition history, copy events,
   audit logs. Balances are cached projections updated *in the same transaction* as the ledger entry.
6. **Snapshots for versioned configuration:** a subscription copies its plan terms; a delivery order copies the charge;
   a task instance references the exact `sopVersionId`; a payroll entry stores every input it used.
7. **Timestamps:** `createdAt`/`updatedAt` = `serverTimestamp()` written by functions; business instants in UTC;
   calendar keys (`dateKey: "2026-09-27"`) computed in the branch time zone.
8. **Money:** `{ amountMinor: int, currency: "INR" }`.
9. **Soft delete** (`status: ARCHIVED`, `archivedAt`, `archivedBy`) for catalogue, branches, employees, plans,
   templates, SOPs. Physical copies are never deleted — they end in `RETIRED`/`LOST`.
10. **Every denormalized field is documented** in §6 with its source of truth and repair path.

## 2. Conceptual ERD

```text
Organization (CORPORATE | FRANCHISE) ─1:N─ Branch ─1:N─ Department
     │                                    │  └─1:N─ Shift ─1:N─ ShiftAssignment ─N:1─ Employee
     │                                    ├─1:N─ Holiday, DeliveryZone, BookLocation (shelves)
     │                                    └─1:N─ QrAttendanceToken (rotating)
     ├─1:N─ Membership (user ↔ org roles & branch scope) ─N:1─ User (global identity)
     ├─1:N─ Employee ─1:N─ EmployeeAssignment (branch/dept/designation, effective-dated)
     │        ├─1:N─ EmployeeDocument ─► Storage object
     │        ├─1:N─ Attendance ─1:N─ AttendanceCorrection
     │        ├─1:N─ LeaveBalance (per policy/year) ; LeaveRequest
     │        └─1:N─ SalaryStructure (effective-dated) ; PayrollEntry ─N:1─ PayrollRun ; Payslip
     │
     ├─1:N─ SubscriptionPlan (versioned)
     ├─1:N─ Member ─N:1─ User (accountHolder; guardian for a child)
     │        ├─0:N─ GuardianRelationship (child member ↔ guardian user)
     │        ├─1:N─ Subscription (plan snapshot; renewals chain via previousSubscriptionId)
     │        ├─1:1─ DepositAccount ─1:N─ DepositTransaction (ledger)
     │        ├─1:N─ Payment ─1:N─ PaymentEvent (gateway webhooks)
     │        ├─1:N─ Address
     │        ├─1:N─ Reservation ─N:1─ Book (title) ─0:1─ allocated BookCopy
     │        ├─1:N─ Loan ─N:1─ BookCopy ; Loan ─N:1─ Subscription (under which it was issued)
     │        ├─1:N─ ExchangeOrder (returns loans A,B + issues copies C,D)
     │        └─1:N─ DeliveryOrder ─1:N─ DeliveryItem (→ Loan / Reservation / Copy)
     │
     ├─1:N─ BookCopy ─N:1─ Book (global catalogue)
     │        ├─ owningBranchId  vs  currentBranchId + locationId   (ownership ≠ location)
     │        ├─1:N─ CopyEvent (status/condition history)
     │        └─N:M─ BookTransfer (via transfer items)
     │
     ├─1:N─ SOP ─1:N─ SopVersion (immutable once PUBLISHED)
     ├─1:N─ TaskTemplate ─1:N─ ChecklistItemDef ; ─0:1─ SOP
     │        └─1:N─ TaskSchedule (recurrence, target: employee|role|branch|dept|shift)
     │                  └─1:N─ TaskInstance (sopVersionId snapshot, checklist snapshot)
     │                            ├─1:N─ TaskAssignment ─N:1─ Employee
     │                            ├─1:N─ TaskResponse (checklist answers + evidence)
     │                            ├─1:N─ TaskReminder / TaskEscalation
     │                            └─0:N─ TaskApproval
     ├─1:N─ Notification ─N:1─ User
     ├─1:N─ AuditLog
     └─1:N─ FranchiseAgreement (royalty rules) ─1:N─ Settlement            [Phase 7]

Global catalogue: Book ─N:M─ Author, Book ─N:1─ Publisher, Book ─N:M─ Category/Genre
```

## 3. Collection layout

### 3.1 Global

| Path | Purpose | Key fields | Written by |
|---|---|---|---|
| `users/{uid}` | Identity profile (uid = Firebase Auth uid) | displayName, phoneE164, email, photoPath, defaultOrgId, fcmTokens (subcoll), status | function (profile fields: client, validated by rules) |
| `users/{uid}/memberships/{orgId}` | **Authoritative** roles per org | roles[], branchScope (`ALL` \| branchIds[]), status | function only |
| `users/{uid}/preferences/app` | Notification prefs, locale | channels{}, locale | client (own) |
| `catalog/books/{bookId}` | Title-level catalogue (Stories-wide) | code, isbn13, title, subtitle, titleNormalized, searchTokens[], authorIds[], authorNames[], publisherId, language, genres[], categoryIds[], ageGroup (CHILDREN/TEENS/ADULTS), minAge, maxAge, readingLevel, contentTags[], synopsis, edition, publicationYear, coverPath, status | function |
| `catalog/authors/{id}`, `catalog/publishers/{id}`, `catalog/categories/{id}` | Reference data | name, nameNormalized, status | function |
| `platform/config` | Platform defaults (currency, statutory defaults) | versioned map | function |
| `phoneIndex/{e164}` | Uniqueness guard for member phone | uid | function |

> The catalogue is global so titles aren't duplicated per franchise; **copies, availability and all circulation
> are tenant-scoped.** A future "org-private title" is a `visibility: ORG` field, not a restructure.

### 3.2 Tenant-scoped: `orgs/{orgId}` (type: `CORPORATE` \| `FRANCHISE`, parentOrgId, status)

| Subcollection | Key fields | Notes |
|---|---|---|
| `branches/{branchId}` | code, name, type (COMPANY_OWNED/FRANCHISE), address, geo, contact, timeZone, operatingHours[], weeklyOffs[], serviceablePostalCodes[], status | |
| `branches/{branchId}/locations/{locationId}` | code (e.g. `A-03-2`), label, kind (SHELF/DESK/BACKROOM) | |
| `branches/{branchId}/availability/{bookId}` | availableCount, totalCount, reservedCount | **projection**, see §6 |
| `branches/{branchId}/dailyStats/{dateKey}` | issued, returned, exchanges, deliveries, tasksDone… | projection for dashboards |
| `departments/{id}` | branchId?, name, status | |
| `counters/{scope}` | next | code allocation |
| `barcodes/{barcode}` | copyId | uniqueness index |
| `copies/{copyId}` | code, barcode, bookId, bookTitle, owningBranchId, currentBranchId, locationId, status, condition, acquiredAt, acquisitionCost, activeLoanId, activeReservationId, transferId, lifetimeLoans | status ∈ AVAILABLE, RESERVED, ISSUED, IN_TRANSIT, UNDER_INSPECTION, DAMAGED, LOST, RETIRED |
| `copies/{copyId}/events/{eventId}` | type, fromStatus, toStatus, condition, actor, at, ref | append-only history |
| `transfers/{transferId}` | fromBranchId, toBranchId, items[{copyId, conditionOut, conditionIn}], status (DRAFT, IN_TRANSIT, RECEIVED, CANCELLED), dispatchedBy/At, receivedBy/At | |
| `plans/{planId}` | name, duration (MONTHLY/QUARTERLY/HALF_YEARLY/ANNUAL), durationMonths, price, depositAmount, maxSimultaneousBooks, memberCategory, ageGroups[], deliveryEligible, deliveryRules, promo{price, from, to}, renewalRules, effectiveFrom, version, status | edits create a new version; old versions kept |
| `members/{memberId}` | code, accountHolderUid, isMinor, dob, audience, homeBranchId, status, activeSubscriptionId, activeLoanCount (projection), lifetimeExchanges, householdId (**null in MVP — family-membership seam**) | |
| `guardianships/{id}` | childMemberId, guardianUid, relationship, verifiedBy, status | required when `isMinor` |
| `subscriptions/{subId}` | memberId, branchId, planId, planVersion, **planSnapshot**, status (PENDING_PAYMENT, ACTIVE, EXPIRED, CANCELLED, CLOSED), startAt, endAt, activeLoanCount, maxSimultaneousBooks, exchangesThisTerm, previousSubscriptionId, renewalSource, paymentIds[] | |
| `depositAccounts/{memberId}` | balanceMinor, heldMinor, status (OPEN, SETTLING, CLOSED) | balance = Σ ledger |
| `depositAccounts/{memberId}/transactions/{txId}` | type (COLLECTED, HOLD, DEDUCTION, REFUND, ADJUSTMENT), amountMinor, reason, reference, createdBy, approval{by, at}, balanceAfter | append-only |
| `payments/{paymentId}` | memberId, purpose (SUBSCRIPTION, DEPOSIT, DELIVERY, CHARGE), lines[], amountMinor, currency, method (GATEWAY, OFFLINE_CASH, OFFLINE_UPI…), gateway, gatewayOrderId, gatewayPaymentId, status (INITIATED, PENDING, SUCCESS, FAILED, REFUNDED, PARTIALLY_REFUNDED), recordedBy | |
| `paymentRequests/{razorpayId}` | gateway, mode, channel (LINK, QR, QR_LINK), url, qrImageUrl, subscriptionId, memberId, branchId, amountMinor, status (OPEN, PAID, CANCELLED), sentTo, requestId, expiresAt, paymentId, gatewayPaymentId, needsAttention | function-only write; read with payments.view at the branch |
| `branches/{b}/private/razorpay` | keySecret, webhookSecret | functions only; no client access |
| `paymentEvents/{gatewayEventId}` | raw (redacted), processedAt, result | webhook dedupe |
| `reservations/{resId}` | memberId, bookId, branchId, status (WAITING, ALLOCATED, FULFILLED, EXPIRED, CANCELLED), allocatedCopyId, queuedAt, holdUntil | |
| `loans/{loanId}` | memberId, subscriptionId, copyId, bookId, branchId, status (ACTIVE, RETURNED, LOST, WRITTEN_OFF), issuedAt, issuedBy, channel (COUNTER, DELIVERY), returnedAt, returnedBy, returnCondition, exchangeId | no dueAt by design |
| `exchanges/{exchangeId}` | memberId, returnLoanIds[], issueCopyIds[], status, deliveryOrderId | one exchange = N returns + M issues in one transaction |
| `addresses/{id}` | memberId, lines, postalCode, geo, isDefault | |
| `deliveryZones/{id}` | branchId, postalCodes[], charge, slots[], operatingDays[], version | |
| `deliveryOrders/{id}` | memberId, branchId, addressSnapshot, type (DELIVERY, RETURN_PICKUP, EXCHANGE), chargeSnapshot, paymentId, status (CREATED, CONFIRMED, ASSIGNED, OUT_FOR_DELIVERY, DELIVERED, FAILED, RETURNED, CANCELLED), assigneeEmployeeId, slot, otpHash, proof{photoPath, at, geo} | |
| `deliveryOrders/{id}/items/{itemId}` | direction (OUT/IN), copyId, loanId, reservationId, status | |
| `employees/{employeeId}` | code, uid, fullName, contact, dob, gender, employmentType, designation, reportingManagerId, dateOfJoining, lifecycle (ADDED, ONBOARDING, ACTIVE, NOTICE_PERIOD, OFFBOARDED), currentBranchId (projection), pfApplicable, esiApplicable, exit{} | public-within-org fields only |
| `employees/{id}/private/profile` | address, emergencyContact, bankAccount (masked + tokenized ref), PAN/UAN/ESIC numbers | HR/Finance + self only |
| `employees/{id}/assignments/{id}` | branchId, departmentId, designation, effectiveFrom, effectiveTo | history preserved |
| `employees/{id}/documents/{id}` | type, storagePath, verificationStatus, uploadedBy/At, verifiedBy/At | files under `private/` Storage paths |
| `shifts/{shiftId}` | branchId, name, start, end, breakMins, graceMins, lateAfterMins, earlyExitBeforeMins, workingDays[], activeFrom/To | |
| `shiftAssignments/{id}` | employeeId, shiftId, effectiveFrom/To | |
| `holidays/{id}` | branchId \| null (org-wide), dateKey, name | |
| `attendance/{employeeId_dateKey}` | branchId, dateKey, checkIn{at, method, device, geo}, checkOut{…}, status, lockedByPayrollRunId | deterministic ID |
| `attendanceCorrections/{id}` | attendanceId, requested{}, reason, status, reviewer, reviewedAt | |
| `branches/{id}/qrTokens/current` | secret rotation seed, validFrom | QR = signed rotating token |
| `leavePolicies/{id}`, `leaveBalances/{employeeId_policyId_year}`, `leaveRequests/{id}` | configurable types, accrual, carry-forward, encashment, approval chain | |
| `salaryStructures/{id}` | employeeId, components[], effectiveFrom | |
| `payrollRuns/{id}`, `payrollRuns/{id}/entries/{employeeId}`, `payslips/{id}` | period, status (DRAFT, REVIEW, APPROVED, LOCKED, REOPENED), rulesSnapshot, inputs, outputs | |
| `sops/{sopId}`, `sops/{sopId}/versions/{n}` | title, owner, status; version: steps[], media[], checklist[], effectiveFrom, approvedBy, publishedAt | versions immutable once PUBLISHED |
| `taskTemplates/{id}` | title, priority, checklist[{id, text, mandatory, evidence}], sopId, evidenceRequired, requiresApproval, reminderPolicy, escalationPolicy | |
| `taskSchedules/{id}` | templateId, branchId, frequency (ONE_TIME…CUSTOM), rrule, dueTimeLocal, target{type, id}, shiftAnchor, active | |
| `taskInstances/{scheduleId_occurrenceKey}` | templateSnapshot, sopVersionId, branchId, dateKey, dueAt, status, assigneeEmployeeIds[], nextReminderAt, escalationLevel, completedAt | |
| `taskInstances/{id}/responses/{employeeId}` | checklist answers, evidencePaths[], submittedAt | |
| `taskInstances/{id}/log/{id}` | reminders, escalations, reassignments, approvals | |
| `notifications/{id}` | built as `users/{uid}/notifications/{id}` (docs/HRMS.md §11): orgId, kind, title, body, link, read, at, TTL `expireAt` (+90 days) | owner may only set `read` to true; push/email channels not built |
| `auditLogs/{id}` | actorUid, actorRoles, action, entityType, entityId, branchId, memberId (member-related entries), before, after, reason, requestId, ip/device (where relevant), at | function-only write; no client update/delete |
| `idempotency/{fn:requestId}` | result, createdAt, TTL `expireAt` (+30 days) | Firestore TTL policy |
| `config/{key}` | versioned business settings | audited |

## 4. Index plan (initial — only for known queries)

| Collection | Query | Composite index |
|---|---|---|
| `copies` | branch shelf/status lists | `currentBranchId ASC, status ASC, bookId ASC` |
| `copies` | find available copy of a title at a branch | `bookId ASC, currentBranchId ASC, status ASC` |
| `loans` | member's current books | `memberId ASC, status ASC, issuedAt DESC` |
| `loans` | branch issued today | `branchId ASC, issuedAt DESC` |
| `reservations` | queue for a title at a branch | `bookId ASC, branchId ASC, status ASC, queuedAt ASC` |
| `subscriptions` | expiry sweep / expiring soon | `status ASC, endAt ASC` |
| `deliveryOrders` | dispatcher board / my deliveries | `branchId ASC, status ASC, slot.start ASC`; `assigneeEmployeeId ASC, status ASC` |
| `taskInstances` | my work / branch board / reminder sweep | `assigneeEmployeeIds CONTAINS, dateKey ASC`; `branchId ASC, status ASC, dueAt ASC`; `status ASC, nextReminderAt ASC` |
| `attendance` | branch day view | `branchId ASC, dateKey ASC` |
| `catalog/books` | explore filters | `status, ageGroup, genres CONTAINS, titleNormalized`; `searchTokens CONTAINS, titleNormalized` |
| `members` | lookup | single-field on `code`; phone via `phoneIndex` |

Single-field exemptions for large text fields (`synopsis`, `before`/`after` in audit) to avoid index write costs.

## 5. Concurrency & invariants (enforced in function transactions)

| Invariant | Mechanism |
|---|---|
| A copy is issued to at most one loan | Transaction reads copy; requires `status ∈ {AVAILABLE, RESERVED(for this member)}`; sets `ISSUED`, `activeLoanId`. Second concurrent transaction retries, re-reads `ISSUED`, fails with `COPY_NOT_AVAILABLE`. |
| Member never exceeds plan limit | Same transaction reads `subscription.activeLoanCount` and `maxSimultaneousBooks`; increments on issue, decrements on return. Return frees exactly one slot. |
| No borrowing without an active term | Transaction checks `status == ACTIVE && now < endAt` (does not wait for the expiry sweep). |
| No exchange quota | There is none: `exchangesThisTerm` / `lifetimeExchanges` are counters, never limits. |
| Reservation allocation is atomic | Allocation transaction takes the oldest `WAITING` reservation and an `AVAILABLE` copy together. |
| Transfers are valid state machines | `IN_TRANSIT` only from `AVAILABLE`; receive only if `transfer.status == IN_TRANSIT` and copy in the transfer. |
| Deposit balance == Σ ledger | Balance changed only by `deposits.post()` in the same transaction as the ledger entry; nightly reconciliation job flags drift. |
| Webhook processed once | Transaction `create()`s `paymentEvents/{eventId}`; already-exists → no-op. |
| One attendance per employee/day | Deterministic ID; check-in uses `create()`; check-out requires existing doc without checkout. |
| One task completion | Completion transaction requires `status ∈ {PENDING, IN_PROGRESS, OVERDUE, REJECTED}` and all mandatory items answered. |

## 6. Denormalized fields register

| Field | Source of truth | Updated by | If inconsistent |
|---|---|---|---|
| `subscriptions.activeLoanCount` | count of ACTIVE loans for subscription | circulation transactions | nightly `reconcileLoanCounts` recomputes + audit |
| `members.activeLoanCount` | same | same | same job |
| `depositAccounts.balanceMinor` | ledger | `deposits.post()` | reconciliation flags, finance adjusts via ledger |
| `branches/*/availability/{bookId}` | copies by status | circulation/transfer transactions | rebuild job per branch; UI shows "check at counter" semantics — never used for issuing |
| `copies.bookTitle`, `loans.bookTitle` | `catalog/books` | catalogue edit trigger (fan-out, batched) | cosmetic only; rebuild job |
| `employees.currentBranchId` | current effective assignment | assignment function + daily job | daily job recomputes |
| `dailyStats`, org summaries | transactional collections | triggers / scheduled aggregation | rebuild from source for a date range |

## 7. Future-proofing seams

- **Family membership:** `members.accountHolderUid` already decouples the person who pays from the reader;
  add `households/{id}` + household-level plans later, populate `members.householdId`. No migration of loans.
- **Cross-branch borrowing:** loans already carry `branchId` (issuing) separate from the copy's `owningBranchId`;
  revenue attribution can be derived later.
- **Advanced search:** `SearchService` interface; Firestore-token implementation now.
