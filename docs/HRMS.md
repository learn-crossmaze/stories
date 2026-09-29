# Stories — Staff HRMS

The staff HRMS is part of the existing Stories app. It uses the same React staff console, Cloud Functions, Firestore
and Storage. There is no second app and no second database. It is built in six phases. Each phase ships only when
it is tested and documented.

| Phase | Scope | Status |
|---|---|---|
| 1. Foundation | Employee records, private and bank details, designations, directory, profile tabs, effective-dated history, lifecycle, account linking, backfill of existing staff, onboarding and offboarding checklists, new permissions, `hr` router | **Done** |
| 2. Documents | Document types, private uploads, verification, expiry reminders, required-document tracking | **Done** |
| 3. Attendance & shifts | Shifts, weekly offs, holidays, check-in and check-out, corrections, month finalization with payable days | **Done** |
| 4. Leave | Leave types and policies, a balance ledger with accrual, applications and approvals, leave on attendance | **Done** |
| 5. Payroll | Salary structures (effective-dated), PF, ESI and PT settings, TDS entered per month, payroll runs (maker-checker), PDF payslips | Planned |
| 6. Self-service & dashboards | My profile, attendance, leave and payslips; HR dashboards; in-app notifications | Planned |

Decisions for later phases (approved): the Tasks module is deferred, so "My tasks" is a placeholder. Notifications
are in-app first. TDS is entered manually per employee per month. PF, ESI and PT are configurable with effective
dates. The full bank account number is stored only in a restricted document, shown masked, and every reveal is
audited.

## 1. Data model (Phase 1)

| Path | Contents | Who reads it (rules) |
|---|---|---|
| `orgs/{o}/employees/{e}` | `code` (employee ID), `uid` (linked Stories account or null), `email`, `emailLower`, `fullName`, `phone`, `branchId` (null = head office), `departmentId/Name`, `designationId/Name`, `managerId/Name`, `employmentType`, `joiningDate`, `status`, `noticeEndDate`, `exitDate`, `exitReason`, `onboarding[]`, `offboarding[]`, `source` (HR, ROLES or BACKFILL) | `employees.view` at the employee's branch (org-wide viewers also see head-office records); the employee themselves |
| `…/employees/{e}/history/{h}` | `type` (CREATED, JOB_CHANGE, DETAILS, STATUS or ACCOUNT), `effectiveDate`, `changes {field: {from, to}}`, `note`, `by`, `at` | same as the record |
| `…/employees/{e}/private/profile` | date of birth, gender, blood group, personal contact, addresses, emergency contact, PAN, UAN, ESI number, `bank` (masked: holder, bank, IFSC, last 4 digits) | `employees.privateData` at the branch; the employee |
| `…/employees/{e}/private/bank` | full account number, IFSC, holder, bank | nobody (functions only; `employees-revealBank` is audited) |
| `orgs/{o}/designations/{d}` | `name`, `nameLower`, `status` | anyone in the org |
| `orgs/{o}/config/hr` | `onboarding[]`, `offboarding[]` checklist templates (`key`, `label`, `required`) | anyone in the org |
| `orgs/{o}/employeeIds/{code}` | `{uid, employeeDocId}`, which keeps employee IDs unique | nobody (functions only) |

Roles stay where they were, in `users/{uid}/memberships/{orgId}`. The employee record is the HR view of the same
person, and `membership.employeeId` always equals the record's `code`.

## 2. Lifecycle

```
DRAFT ──start onboarding──▶ ONBOARDING ──mark as joined──▶ ACTIVE ──resign──▶ NOTICE_PERIOD
                                 ▲                          │  ▲                    │
                                 │                          │  └──withdraw──────────┤
                              rehire                start offboarding (termination)  │ start offboarding
                                 │                          ▼                       ▼
                            OFFBOARDED ◀──complete offboarding── OFFBOARDING ◀──────┘
```

- **Mark as joined** needs every required onboarding item ticked and a joining date.
- **Resign** needs the last working day and a reason. **Start offboarding** needs an exit date and a reason; it
  defaults to the end of the notice period.
- **Complete offboarding** needs every required offboarding item ticked. It revokes all roles in the organization in
  the same transaction and refreshes the person's token claims. Roles can't be granted to an offboarded person until
  they are rehired.
- Nobody can change their own status (Super Admin excepted).
- Each transition writes a STATUS history entry and an audit entry.
- Checklists copy the organization's template when they start. Later template changes don't alter a checklist that
  is already running.

## 3. No duplicates: linking and backfill

- `staff-setRoles` finds the person's record, first by `uid`, then by an unlinked record with the same email. It
  links that record, or creates an ACTIVE record (source ROLES) if there is none.
- `employees-create` links a Stories account that uses the email. It refuses an email or account that already
  belongs to another record, and an employee ID that is already taken.
- `employees-linkAccount` links an account later. If the account had a roles-only employee ID, that ID is released
  and the record's ID is used.
- `employees-backfill` creates records for staff whose roles predate People, keeping their employee IDs, or links a
  matching unlinked record. It handles 100 per call and is safe to repeat. The Employees page offers it when some
  staff have no record.

## 4. Permissions

| Permission | Roles |
|---|---|
| employees.view | HO, HR, FO, BM (own branches) |
| employees.edit | HO, HR, FO |
| employees.lifecycle | HO, HR, FO |
| employees.privateData | HR, FIN |
| employees.bank | HR, FIN |
| hr.config | HO, HR, FO |
| documents.verify | HR, FO (Phase 2) |
| attendance.view / attendance.finalize | HO, HR, FO, BM, FIN / HR, FO (Phase 3) |
| leave.adjust / leave.approve | HR, FO / HR, FO, BM (Phase 4) |
| salary.view / salary.edit / payslips.viewAll | HR, FIN, FO / HR, FO / HR, FIN, FO (Phase 5) |

Records without a branch (head office staff) need the permission across all branches.

## 5. Screens (staff console → People)

- **Employees** (`/admin/people`): status chips with counts, search by name, ID or email, a branch filter, "Add
  employee", and the backfill notice.
- **Employee profile** (`/admin/people/:id`) has six tabs:
  - Overview: job and contact details.
  - Personal: personal and statutory details, visible to HR and finance.
  - Bank: masked account, change, and an audited "Show full number".
  - Onboarding & exit: status actions and checklists.
  - History: effective-dated changes.
  - Access: link a Stories account, see and manage roles.
- **Staff & roles**: unchanged, and now under People.
- **HR settings** (`/admin/hr-settings`): designations, and the onboarding and offboarding checklist templates.

## 6. Known limits (Phase 1)

- A job change is applied when it is saved. The effective date is recorded for history and later payroll
  proration, but a future-dated change isn't held back until that date.
- The directory loads up to 1,000 records per organization and filters them in the browser.
- Employees can read their own record and personal details through the rules. Their self-service screens arrive in
  Phase 6.

## 7. Documents (Phase 2)

| Path | Contents | Who reads it |
|---|---|---|
| `orgs/{o}/documentTypes/{id}` | `name`, `category`, `required`, `hasExpiry`, `reminderDays`, `selfUpload`, `checklistKey`, `status` (overrides a default type with the same id, or adds a new type) | anyone in the org |
| `orgs/{o}/employees/{e}/documents/{d}` | `typeId/typeName`, `fileName`, `contentType`, `size`, `storagePath`, `storageBucket`, `number`, `issuedOn`, `expiresOn`, `status`, uploader, verifier, `rejectReason`, and copies of `orgId`, `branchId`, `employeeUid`, `employeeName`, `employeeCode` for the queue | HR who may verify documents or edit employees, at the employee's branch; the employee |
| Storage `hr/{orgId}/{employeeId}/{d}.{pdf,jpg,png}` | the file | nobody directly (Storage rules deny it); through `documents-open` only |

**Default types:** Aadhaar card, PAN card, bank proof, and signed offer letter are required. Address proof, photograph,
education certificate and previous employment letter are optional. Driving licence and police verification have
expiry dates. HR changes or adds types under **HR settings → Document types**.

**Flow**

- **Upload** (`documents-upload`): the file is a PDF, JPEG or PNG of 5 MB at most. The server checks the file's
  real type from its first bytes, not its name.
  - A verifier uploading for someone else: the document is **verified** at once.
  - An employee uploading a self-upload type, or HR staff uploading about themselves: it is **awaiting
    verification**.
- **Review** (`documents-review`): verify, or reject with a reason. Nobody verifies a document they uploaded.
- **On verification:**
  - older verified or expired copies of the same type become **replaced**;
  - the matching onboarding checklist item is ticked (for example, a PAN card ticks "PAN recorded").
- **Open** (`documents-open`): returns the file to HR at the branch or to the employee, and writes an
  `employee.document.open` audit entry. There are no signed URLs, so no extra Google Cloud permission is needed.
- **Remove** (`documents-remove`): HR can remove any document; employees can withdraw their own upload while it
  is pending or rejected. The record and file are kept.
- **Expiry:** the daily job `scheduled-expireDocuments` (00:30 IST) marks verified documents past their expiry
  date as **expired**. The Documents page and the dashboard list documents expiring within each type's reminder
  window, and those that have expired.

**Screens**

- People → **Documents**: a queue with Awaiting verification, Expiring soon and Expired.
- The employee profile's **Documents** tab: required documents (verified, awaiting verification, missing…) and the
  documents on file, with upload, open, verify, reject and remove.
- **HR settings → Document types.**
- **Dashboard**: HR sees counts of documents to verify, expiring and expired.

**Known limits:** employees' own screens to upload and view their documents arrive with Phase 6 (self-service).
The server already supports them. Files are capped at 5 MB, the size a callable request can carry.

## 8. Attendance (Phase 3)

| Path | Contents | Who reads it |
|---|---|---|
| `orgs/{o}/shifts/{id}` | `name`, `start`, `end` (HH:MM, India time; an end earlier than the start is overnight), `breakMinutes`, `graceMinutes`, `halfDayMinutes`, `fullDayMinutes`, `status` | anyone in the org |
| `orgs/{o}/holidays/{date}` | `name`, `branchIds` (empty = every branch), `year` | anyone in the org |
| employee record | `shiftId`, `shiftName`, `weeklyOffs` (null = the branch's days off) | as the record |
| `orgs/{o}/attendance/{employeeId}_{date}` | `checkIn`, `checkOut` (server times), `status` (PRESENT, HALF_DAY, ABSENT, WEEKLY_OFF, HOLIDAY, ON_LEAVE; IN_PROGRESS until check-out), `workedMinutes`, `lateMinutes`, `late`, `earlyExit`, `missedCheckout`, `source` (SELF, DESK, ADJUSTED, CORRECTION, FINALIZE, LEAVE), `leave` (approved leave on the day, §9), `payable`, `finalized`, plus copies of the employee's name, code, uid and branch | attendance viewers at the branch; the employee |
| `orgs/{o}/attendanceCorrections/{employeeId}_{date}` | requested times, reason, `status` (PENDING, APPROVED, REJECTED), decision | as above |
| `orgs/{o}/attendanceSummaries/{employeeId}_{month}` | present, half days, absent, weekly offs, holidays, leave days and paid leave days, late days, missed check-outs, worked minutes, **payableDays**, `stale` | as above |
| `orgs/{o}/attendanceLocks/{month}_{branchId or HO}` | `status` (FINALIZED, REOPENED), who and when | anyone in the org |

**Rules** (`functions/src/hr/attendanceRules.ts`, unit tested):

- **Worked time and lateness:**
  - Worked minutes are check-out minus check-in, less the shift's break.
  - An employee is late when they check in more than the grace minutes after the shift start.
  - They left early when they checked out before the shift end.
- **Day status:**
  - Full-day minutes or more count as present; half-day minutes or more count as a half day; less counts as absent.
  - Without punches, a day is a holiday, a weekly off, or absent. Working on a day off counts as present.
- **Payable days** are present days, plus half days divided by two, plus weekly offs, plus holidays, plus paid leave
  (§9).
- **Default rules:** without a shift, an employee is never late, and 8 hours counts as a full day (4 hours for a
  half day).

**Flow**

- **Check in and out** (`attendance-punch`, with `punch: IN | OUT`): staff use the Today card on the dashboard or
  My attendance. The server sets the time.
  - A manager (`attendance.manage`) can record a check-in or check-out for someone at the desk.
  - A check-out after midnight closes an overnight shift that started the day before.
- **Adjust** (`attendance-adjust`): a manager sets a day's times with a reason. It is audited, and nobody can adjust
  their own day.
- **Corrections:**
  - An employee asks with `attendance-requestCorrection`. A manager or HR decides with
    `attendance-decideCorrection`; approving applies the times.
  - Nobody decides their own correction, and rejecting one needs a reason.
- **Finalize** (`attendance-finalize`, `attendance.finalize`) runs per branch and month, or for head office staff.
  It only works on a month that is over, and never while corrections are waiting.
  - Every employed day gets a final record: days without a record become absent, weekly off or holiday, and a
    missing check-out counts as a half day.
  - Each employee gets a summary with payable days, and the month is locked. Punches, adjustments and corrections
    are then refused.
- **Reopen** (`attendance-reopen`): unlocks the month with a reason and marks the summaries out of date until the
  month is finalized again.

**Screens**

- People → **Attendance**:
  - **Day**: who is in, check in or out at the desk, adjust, change a shift.
  - **Month**: summaries, finalize and reopen.
  - **Corrections**: approve or reject.
- **Today** card on the dashboard, and **My attendance** (account menu): check in and out, see the month, request a
  correction.
- The employee profile's **Attendance** tab: shift, weekly offs, and the month with adjust.
- **HR settings → Shifts** and **Holidays**.
- **Dashboard reminders:** corrections to decide, and last month not yet finalized.

**Known limits:**

- Check-in has no location or device check.
- Each employee has one shift; day-by-day rosters and shift swaps are not built yet.
- Finalizing writes one record per employee per day and suits branches of up to a few hundred staff.
- All times are India time (IST).

## 9. Leave (Phase 4)

| Path | Contents | Who reads it |
|---|---|---|
| `orgs/{o}/leaveTypes/{id}` | `name`, `code`, `paid`, `annualQuota`, `accrual` (MONTHLY, YEARLY, MANUAL), `carryForwardMax`, `allowHalfDay`, `unlimited`, `status`. Four defaults live in code (casual 12 a year monthly, sick 12 yearly, earned 15 monthly carrying up to 30, loss of pay unlimited); an org document with the same id overrides one | anyone in the org |
| `orgs/{o}/leaveBalances/{employeeId}_{year}` | per type: `credited`, `adjusted`, `used`, `pending`. Available = credited + adjusted − used − pending | attendance viewers at the branch; the employee |
| `orgs/{o}/leaveLedger/{id}` | append-only: `kind` (ACCRUAL, CARRY, ADJUST, TAKEN, RETURNED), `typeId`, `year`, `days` (+/−), `period`, `note`, `requestId`, who and when | as above |
| `orgs/{o}/leaveRequests/{id}` | employee copies, type (name, code, paid), `from`, `to`, `halfDay` (NONE, FIRST, SECOND), `dates` (the working days it covers), `months`, `days`, `year`, `reason`, `status` (PENDING, APPROVED, REJECTED, CANCELLED), decision | as above |

**Rules** (`functions/src/hr/leaveRules.ts`, unit tested):

- The leave year is the calendar year. A request stays within one year and spans at most 45 calendar days.
- Leave days skip the employee's weekly offs and holidays at their branch. A half day is a single date counting 0.5.
- **Accrual:**
  - MONTHLY types credit a twelfth of the quota each month (1.25 days for 15 a year).
  - YEARLY types credit the quota once a year. Someone who joins that year gets a share for the months left,
    counting the joining month, rounded down to the half day.
  - MANUAL types (maternity, bereavement) are never credited automatically; HR grants days with an adjustment.
  - Types with `carryForwardMax` carry unused days from last year's balance, up to that many, when the year's first
    accrual runs. Later changes to last year do not change the carried amount.
  - Every credit has a fixed ledger id (employee, type and month or year), so accrual can run any number of times.
    The daily job `scheduled-accrueLeave` (00:45 IST) credits the current month for every organization; HR can
    run a past month with **Credit leave**.
- **On attendance** (`attendanceRules.evaluateDay`): a full day of leave is ON_LEAVE and payable if the leave is
  paid. A half day of leave is paid for half a day, and the other half counts if at least a half day was worked.
  Payable days in the month summary include paid leave; leave days and paid leave days are listed too.

**Flow**

- **Apply** (`leave-apply`): the employee applies for their own leave. A leave approver can also record leave for
  someone at their branch.
  - Refused when the dates overlap a waiting or approved request, fall in a finalized month, or come before
    the joining date.
  - Refused when the balance does not cover the days, unless the type is unlimited.
  - The days are held as `pending` until a decision.
- **Decide** (`leave-decide`, `leave.approve` at the employee's branch, never your own):
  - Approving moves the days from pending to used, writes a TAKEN ledger entry, and marks each day on attendance.
  - Rejecting needs a reason and releases the days.
- **Cancel** (`leave-cancel`): the employee can cancel waiting leave, or approved leave that has not started. HR
  (`leave.adjust`) can cancel anyone else's leave outside a finalized month, with a note. Approved days return with
  a RETURNED entry, and attendance for those days is worked out again (future days without punches are removed).
- **Adjust** (`leave-adjust`, `leave.adjust`, reason required, never your own): adds or removes days, for opening
  balances and corrections. It cannot take a balance below zero.
- **Finalize** (§8) is refused while leave touching the month is waiting for a decision.

**Screens**

- People → **Leave**:
  - **Requests**: approve or reject.
  - **Away**: approved leave in a month, and who is on leave today.
  - **Balances**: everyone's days left for a year, record leave, adjust, and **Credit leave**.
- **My leave** (account menu): balances, apply, cancel, and the ledger history.
- The employee profile's **Leave** tab: balances, requests with decisions, the ledger, record and adjust.
- **HR settings → Leave types**.
- The attendance board shows **On leave**. The dashboard reminds approvers of leave to decide.

**Known limits:**

- There are no sandwich rules: weekly offs and holidays inside a leave are never counted.
- There is no encashment, compensatory off or negative balance; loss of pay is its own unlimited type.
- One approval step. Leave does not go to a reporting manager first.
- Changing a type applies to future credits and requests only; balances already credited stay.

