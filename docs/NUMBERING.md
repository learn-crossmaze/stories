# Numbering (nomenclature)

Stories numbers every book, copy, member, shelf and employee automatically. Each **branch** chooses the patterns
for the codes it creates (Branches → **Numbering**). Book codes are one pattern for the whole catalogue, because every
organization shares it (Catalogue → **Book numbering**). Changing a pattern affects **new records only**: existing codes,
printed labels and member cards never change.

| Code | Where it's set | Who can change it | Default | Example |
|---|---|---|---|---|
| Book (catalogue title) | Catalogue → Book numbering | Super Admin, head office (`books.edit`) | `BOOK-{SEQ:6}` | BOOK-000123 |
| Book copy (also the default barcode) | Branch → Numbering | `branches.manage` (head office, franchise owner) | `BK{BOOK}-CP{SEQ:2}` | BK000123-CP04 |
| Member | Branch (home branch) → Numbering | same | `{BRANCH}-M{SEQ:6}` | CEN-M000045 |
| Shelf / location (when no code is typed) | Branch → Numbering | same | `{BRANCH}-{KIND}-{SEQ:3}` | CEN-SH-007 |
| Employee ID | Branch (the person's first branch) → Numbering | same | `{BRANCH}-E{SEQ:4}` | CEN-E0012 (head office: HO-E0012) |

## Pattern tokens

| Token | Meaning | Allowed in |
|---|---|---|
| `{SEQ}`, `{SEQ:n}` | running number, zero-padded to *n* digits; **required, exactly once** | all |
| `{BRANCH}` | branch code (e.g. CEN) | copy, member, shelf, employee |
| `{BOOK}` | the title's catalogue number, 6 digits | copy |
| `{KIND}` | shelf type: SH shelf, DS display, DK desk, BR back room | shelf |
| `{YYYY}`, `{YY}`, `{MM}` | year / short year / month, India time | book, copy, member, employee |

Everything else in a pattern is literal: capital letters, digits and dashes. Maximum lengths: copies 32 (they are
also barcodes), shelves 16, others 24.

## How running numbers work

- Codes whose fixed parts come out the same share one running number, so a pattern never repeats a code. For
  example `{BRANCH}-{SEQ:4}` counts separately per branch, and `M{YY}-{SEQ:4}` starts again at 0001 each year.
  Shelf numbers are counted per branch.
- Book numbers always come from one catalogue-wide counter, whatever the pattern, so `{BOOK}` is unique.
- **Defaults changed (September 2026).** The defaults were `COPY-{BOOK}-{SEQ:2}`, `MEM-{SEQ:6}`, `{KIND}-{SEQ:3}` and
  `EMP-{SEQ:4}`. Branches without their own pattern now use the new defaults for new records; existing codes stay as
  they are. To keep an old format at a branch, type it as that branch's pattern: `MEM-{SEQ:6}` and
  `COPY-{BOOK}-{SEQ:2}` then continue their earlier running numbers.
- A title's copies keep one running number under `BK{BOOK}-CP{SEQ:2}` and `COPY-{BOOK}-{SEQ:2}`, so a title that
  already has COPY-000123-01 to -03 gets BK000123-CP04 next. Members, shelves and employee IDs under the new defaults
  count per branch from 1.
- If a new pattern would produce a code that already exists (for example one that imitates an older pattern), the
  action is refused with "The numbering pattern … produced …, which is already in use". Change the pattern.

## Employee IDs

- An employee ID is assigned when the person is added in **People → Employees → Add employee** (or, for older data,
  the first time they are given roles), using the employee pattern of their branch.
- **Head office** (staff without a branch) has its own setting: **Branches → Head office numbering** (`branches.manage`
  across all branches: head office admin, franchise owner). It sets the head-office employee ID pattern (default
  `{BRANCH}-E{SEQ:4}`) and the code `{BRANCH}` stands for (default `HO`), e.g. HO-E0001 or HQ-S001. Stored on
  `orgs/{o}` as `numbering.employee` and `headOfficeCode`; set with `orgs-setNumbering`. New IDs only.
- Staff given records by the **backfill** (People → Employees) are numbered the same way: their first branch's
  pattern, or head office's.
- A specific ID can be typed instead when adding the employee. IDs are unique within the organization
  (`orgs/{o}/employeeIds/{id}`, not readable by clients). Roles & access no longer edits IDs.
- The ID stays when roles change or are removed. Staff who had roles before this feature get an ID the next time
  their roles are saved.

## Storage

- Branch overrides: `orgs/{o}/branches/{b}.numbering` `{copy?, member?, location?, employee?}`. A missing value means
  the default.
- Book pattern: `config/numbering.book` (readable by any signed-in user; written only by `books-setNumbering`).
- Counters: `counters/books`, `orgs/{o}/counters/{kind}:{fixed parts}` (copy numbers per title stay in `copies-<book code>`,
  and `MEM-{SEQ:6}` keeps `members`), `orgs/{o}/branches/{b}/counters/location:{fixed parts}`.
- New books store `number` (their catalogue number), which `{BOOK}` uses. Older books use the digits at the end of
  their code.
