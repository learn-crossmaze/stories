# Numbering (nomenclature)

Stories numbers every book, copy, member, shelf and employee automatically. Each **branch** chooses the patterns
for the codes it creates (Branches → **Numbering**). Book codes are one pattern for the whole catalogue, because every
organization shares it (Catalogue → **Book numbering**). Changing a pattern affects **new records only**: existing codes,
printed labels and member cards never change.

| Code | Where it's set | Who can change it | Default | Example |
|---|---|---|---|---|
| Book (catalogue title) | Catalogue → Book numbering | Super Admin, head office (`books.edit`) | `BOOK-{SEQ:6}` | BOOK-000123 |
| Book copy (also the default barcode) | Branch → Numbering | `branches.manage` (head office, franchise owner) | `COPY-{BOOK}-{SEQ:2}` | COPY-000123-04 |
| Member | Branch (home branch) → Numbering | same | `MEM-{SEQ:6}` | MEM-000045 |
| Shelf / location (when no code is typed) | Branch → Numbering | same | `{KIND}-{SEQ:3}` | SH-007 |
| Employee ID | Branch (the person's first branch) → Numbering | same | `EMP-{SEQ:4}` | EMP-0012 |

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
- The default patterns continue the numbering used before patterns were configurable.
- If a new pattern would produce a code that already exists (for example one that imitates an older pattern), the
  action is refused with "The numbering pattern … produced …, which is already in use". Change the pattern.

## Employee IDs

- An employee ID is assigned the first time someone is given roles in an organization, using the employee pattern of
  their first branch. Organization-wide staff use the default `EMP-{SEQ:4}`.
- HR (or whoever manages the person's roles) can type a specific ID instead in **Staff & roles → Edit**. IDs are unique
  within the organization (`orgs/{o}/employeeIds/{id}`, not readable by clients).
- The ID stays when roles change or are removed. Staff who had roles before this feature get an ID the next time
  their roles are saved.

## Storage

- Branch overrides: `orgs/{o}/branches/{b}.numbering` `{copy?, member?, location?, employee?}`. A missing value means
  the default.
- Book pattern: `config/numbering.book` (readable by any signed-in user; written only by `books-setNumbering`).
- Counters: `counters/books`, `orgs/{o}/counters/{kind}:{fixed parts}` (defaults keep `copies-<book code>` and
  `members`), `orgs/{o}/branches/{b}/counters/location:{fixed parts}`.
- New books store `number` (their catalogue number), which `{BOOK}` uses. Older books use the digits at the end of
  their code.
