# Stories — Staff HRMS

The staff HRMS is part of the existing Stories app. It uses the same React staff console, Cloud Functions, Firestore
and Storage. There is no second app and no second database. It is built in six phases. Each phase ships only when
it is tested and documented.

| Phase | Scope | Status |
|---|---|---|
| 1. Foundation | Employee records, private and bank details, designations, directory, profile tabs, effective-dated history, lifecycle, account linking, backfill of existing staff, onboarding and offboarding checklists, new permissions, `hr` router | **Done** |
| 2. Documents | Document types, private uploads, verification, expiry reminders, required-document tracking | **Done** |
| 3. Attendance & shifts | Shifts and rosters, check-in and check-out, corrections, month finalization | Planned |
| 4. Leave | Leave types and policies, a balance ledger, applications and approvals, holidays | Planned |
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
| leave.adjust | HR (Phase 4) |
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
