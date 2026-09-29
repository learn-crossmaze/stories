# Stories — Library: catalogue, inventory, members

## Catalogue (M1.1)

One **shared catalogue** for all organizations: top-level `books`, `authors`, `publishers`, `categories`
(readable by any signed-in user; written only by Cloud Functions). Only a Super Admin or someone holding
`books.create`/`books.edit` in a **corporate** organization can change it — franchises cannot. Head office
(`books.edit`) edits and archives titles, authors, publishers and categories and sets book numbering; branch managers
(`books.create`) add new titles (with the book-details search), the authors/publishers they need, and a cover for a
title that has none. A **Catalogue Manager** (corporate orgs) looks after the catalogue: edits titles (archived
ones too), archives and restores them (`books-restore`), and permanently deletes an archived title (`books-delete`,
`books.delete`) only if no library ever stocked or reserved it — otherwise it stays archived to keep history. The
Catalogue page filters by Active / Archived.

| Field | Notes |
|---|---|
| `code` | `BOOK-000001…` from `counters/books`, allocated inside the create transaction; pattern configurable ([NUMBERING.md](NUMBERING.md)) |
| `isbn` | optional; ISBN-10 or ISBN-13 accepted, stored as ISBN-13 digits; unique via `isbnIndex/{isbn}` |
| `authorIds` / `authorNames` | 1–5 authors; names denormalized for display and search, refreshed when an author is renamed |
| `genres` | 1–3 of FICTION, FANTASY, MYSTERY, ADVENTURE, SCIENCE, BIOGRAPHY, SELF_HELP, CLASSICS, COMICS, EDUCATIONAL |
| `ageGroup`, `minAge`, `readingLevel` | CHILDREN / TEENS / ADULTS; EARLY_READER … ADVANCED |
| `replacementPriceMinor` | paise; charged against the deposit if a copy is lost (else the copy's cost) |
| `status` | ACTIVE / ARCHIVED (soft delete — history and copies stay) |

**Search** (`functions/src/catalogue/search.ts`): `searchTokens` holds normalized words of title, subtitle, authors,
ISBN, code and keywords plus their 2–12 character prefixes. The app queries one token with `array-contains`
(prefix search), optionally with an age-group filter, ordered by title. The same scheme powers member search (name,
member code, mobile). A dedicated search service can replace it later behind the same query functions.

**Find book details (new books):** type a title (optionally with the author) or an ISBN at the top of the *New book*
form and press *Search*. `books-lookup` searches **Open Library** (no key) and **Google Books** (needs an API key in
production, see DEPLOYMENT.md) at the same time and returns up to 10 matches, one per ISBN; titles already in the
catalogue are marked and link to the existing record. *Use this* fills title, subtitle, ISBN, authors and publisher
(reusing ones with the same name, otherwise adding them), language, year, synopsis, suggested genres and keywords;
staff check everything before saving. The match's cover is imported when the book is saved (`books-setCover` with
`imageUrl`, allowed only from Google Books / Open Library hosts). If both sources are unreachable, the form says so and
works as before.

**Add books by ISBN (bulk):** *Collection → Add by ISBN* (`/ops/books/bulk`, or the button on the catalogue) is a
list of rows. Type, scan or paste ISBNs (pasting several fills several rows); each one is checked as soon as it is a
valid ISBN-10/13, looked up with `books-lookup`, and the row shows the cover, title, authors and year, or says the
ISBN is not valid, repeated, not found or already in the catalogue. Rows whose match has no author ask for one. Age
group, reading level and a genre fallback are set once for the whole list (genre and age group can be changed per
row). One *Add N books* sends the ready rows with `books-bulkCreate` (up to 25 per call, in one transaction each;
ISBNs already in the catalogue are skipped, authors and publishers are reused by name), then imports their covers.

**Covers:** catalogue editors (Super Admin, head office) add a photo or scan on the book page (**Add cover** /
**Change cover** / **Remove**). The browser shrinks it to a JPEG of at most 800 px (~100 KB) and sends it to
`books-setCover`, which checks the permission and the file type (JPEG, PNG or WebP by content, 1.5 MB at most),
stores it at `covers/{bookId}/{requestId}.{ext}` in Cloud Storage, and saves `coverUrl`/`coverPath` on the book. The
previous file is deleted after the change commits. Covers are public (Storage rules allow reads under `covers/`; no
client writes). Titles without a cover show a generated placeholder (title + colour). Only upload artwork you have the
right to use.

## Inventory (M1.2)

Physical copies live under the owning organization: `orgs/{o}/copies/{copyId}` with an append-only history in
`copies/{id}/events`. **Ownership ≠ location:** `owningBranchId` never changes (transfers move `currentBranchId`).

- **Acquire** (`copies-acquire`, `copies.manage` at the branch): 1–50 copies of an active title. Codes are
  `COPY-<book number>-NN` per organization by default (each branch can set its own pattern, see [NUMBERING.md](NUMBERING.md)); the barcode defaults to the code, or pre-printed barcodes can be scanned in.
  Barcodes are unique per organization via `orgs/{o}/barcodes/{barcode}`. New copies go straight to members waiting
  for that title at the branch.
- **Shelf locations:** `orgs/{o}/branches/{b}/locations` (code, label, kind). Leave the code blank to number it with the
  branch's shelf pattern.
- **Condition:** NEW, GOOD, FAIR, POOR (changes are recorded as events). DAMAGED/LOST/RETIRED are *statuses*.
- **State machine** — see [CIRCULATION.md](CIRCULATION.md). Retired copies are never deleted and never return.
- **Availability** (`copies-availability`): per-branch counts computed live with Firestore count queries (always
  exact, no counters to drift). Any signed-in user may call it (it reveals only counts).
- **Branch visibility:** staff with branch-scoped roles (manager, librarian, delivery, employee) see only their own
  branches on the Branches page, dashboard and departments, and open copies only at their branches. To find a book
  elsewhere, catalogue search shows every branch holding each title (`Central 2/3` = 2 of 3 in-stock copies on the
  shelf; their branch first), the book page lists availability per branch, and scanning a copy held at another branch
  in Inventory says which branch has it and its status (`copies-locate`).
- **Labels:** the console prints A4 sheets (3 × 8). Stories prints **QR codes only** (no 1-D barcodes): each label
  has the QR code of the copy code with the copy code and the book title (small type) beside it; the copy page shows
  the same QR tag, and member ID cards carry a QR code of the member code. Older labels with Code 128 bars and books'
  ISBN barcodes still scan (below).
- **Scanning:** USB/Bluetooth scanners work in every scan field (they type the code and press Enter). The camera
  button next to each scan field reads codes with the laptop webcam or a phone camera (QR, Data Matrix, Code 128,
  EAN-13 / ISBN, Code 39, UPC). Decoding runs in a Web Worker (`admin/barcode.worker.ts`, logic in
  `admin/barcode.ts`) on ZXing, with fixes for webcam pictures: 1-D rows are thresholded locally (ZXing's global
  threshold turns blurred gaps black on a grey desk), QR is tried with both binarizers and at ×2 / ×¾ scale, and
  frames alternate a quick look inside the framing guide with a thorough one over the whole picture (bands, sharpened,
  rotated 90° and tilted ±10–18°). RSS/DataBar is off (its readers invent numbers across frames). A code counts after
  two matching reads within 1.5 s and isn't reported again while it stays in view (2 s). The *Find book details* box
  has a camera button that reads a book's ISBN barcode and searches. Hold labels 20–30 cm away in good light; Codabar
  is rarely read by a webcam. The browser asks for camera permission once per site; it needs https (the live site)
  or localhost.

## Members (M1.3)

`orgs/{o}/members/{memberId}` — code `CEN-M000001` (branch-configurable), name, date of birth, audience (derived from age: under 13
CHILDREN, 13–17 TEENS, 18+ ADULTS), mobile (E.164), home branch, status (ACTIVE / SUSPENDED / CLOSED) and the
circulation counters (`activeLoanCount`, `allocatedCount`, `waitingCount`, lifetime loans/exchanges).

- Registered at the counter (`members-register`, `members.manage`); self-service sign-up is Phase 2.
- **Guardians (D8):** anyone under 18 must name an ACTIVE adult member as guardian (stored on the child as
  `guardian: {memberId, name, relationship}`); the guardian's page lists their children. Family membership is not
  built; `householdId` is reserved for it.
- **Mobile numbers are unique** per organization (`orgs/{o}/phoneIndex/{e164}`); adults must have one.
- **Closing** a membership requires every book returned and the deposit refunded.
- **Member profile** (console): *Overview* (current subscription, books held, deposit, reservations), *History*
  (every subscription, payments in and out, returned books) and *Audit trail* (who did what and when, for staff with
  `audit.view`). Every audit entry about a member carries `memberId` (register, edits, status, subscriptions,
  payments, issues, returns — one entry per member —, exchanges, lost books, reservations, deposits); entries written
  before that field existed still show when they were recorded against the member itself. If a section can't load,
  the page says so (and explains when a database index is still building) instead of showing it empty.


**Member list** (Members page): every member at the branch, 50 at a time, with plan, renewal date ("in 6 days",
"ended yesterday"), books out and status. Chips filter by subscription with counts — active, renewal due within 15
days, expired, never subscribed — plus status and age-group filters; search (name, code, mobile) combines with them.
Members carry `planName` and `renewalDueAt` (end of the latest paid term, pushed out by a pre-paid renewal and kept
after expiry), written when a payment activates a subscription. Branches created before this get them filled once by
`members-indexList` on the first visit (flagged by `memberListIndexedAt` on the branch).

## Transfers

See [CIRCULATION.md §Transfers](CIRCULATION.md#transfers).

## Member app (self-service)

Members sign in with the email the branch recorded on their membership (verified: Google sign-in, or the
verification link for email/password accounts). On the first visit `me-overview` links every unclaimed member record
with that email to the account (`members.accountHolderUid`, audited; matched case-insensitively via `emailLower`).
A guardian's account also sees the children whose `guardian.memberId` is theirs, with a switcher between them.

- **Home**: plan, renewal date, books with them (of the plan limit), deposit; prompts for an unpaid plan, a held
  reservation ready to collect, or a plan ending within 15 days.
- **Explore**: the catalogue (their age group for children), availability per branch of their library, Reserve /
  Join the queue (`me-reserve`, same rules as the desk: active plan, plan limit, one per title).
- **My Books**: borrowed now, reservations (cancel with `me-cancelReservation`), returned books and past reservations.
- **Membership**: current plan; choose a plan or renew (`me-subscribe`, same rules as the counter incl. the renewal
  window); an unpaid plan shows the amount (fee + deposit top-up) with **Pay online** (Razorpay payment page via
  `me-pay` when the branch has online payments on; activated by the webhook, or `me-checkPayment` on return) or
  "pay at the branch", and can be cancelled (`me-cancelPending`); payments, subscription history, deposit ledger.
- **Profile**: membership details and branch contact; changes go through the branch.

All `me-*` actions run on the `members` router and check ownership (account holder, or the guardian's account
holder) instead of staff permissions; members never read other members' data.

### Member ID card

Every member has a credit-card-size ID card (85.6 × 54 mm): library and branch, name, member code, guardian (children),
plan valid-until date, branch phone, and a **QR code of the member code**. At the desk, scanning it into **Find member**
(USB scanner or the camera button) opens the member, like typing the code.
- Staff: member page → **Library ID card** → Print (only the card prints, at real size) or Download (PNG, 300 dpi).
- Members: Profile → **Library ID card** (also linked from Home) → Download to their phone, or Print.
