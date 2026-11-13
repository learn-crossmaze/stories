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
| `authorIds` / `authorNames` | 1–5 authors; names denormalized for display and search, refreshed when an author (publisher, category) is renamed: after the rename commits, every book referring to it is updated page by page in write batches of 400 (no transaction; each write applies only if the book is unchanged since it was read, and a page with a book edited meanwhile is redone from fresh reads). A failure is logged and never fails the rename |
| `genres` | 1–3 of FICTION, FANTASY, MYSTERY, ADVENTURE, SCIENCE, BIOGRAPHY, SELF_HELP, CLASSICS, COMICS, EDUCATIONAL |
| `ageGroup`, `minAge`, `readingLevel` | CHILDREN / TEENS / ADULTS; EARLY_READER … ADVANCED |
| `replacementPriceMinor` | paise; charged against the deposit if a copy is lost (else the copy's cost) |
| `status` | ACTIVE / ARCHIVED (soft delete — history and copies stay) |

**Search** (`functions/src/catalogue/search.ts`): `searchTokens` holds normalized words of title, subtitle, authors,
ISBN, code and keywords plus their 2–12 character prefixes. The app queries one token with `array-contains`
(prefix search), optionally with an age-group filter, ordered by title. The same scheme powers member search (name,
member code, mobile). A dedicated search service can replace it later behind the same query functions.
Member search (`searchMembers` in `apps/web/src/data/members.ts`) narrows by **every** typed word: the database is
asked for the longest word (up to 50 members; the next word as well when that page is full) and the rest are matched
against each member's own `searchTokens`. A mobile number is one word however it is typed (spaces, `+91`, a leading
0), and a number that itself starts with 91 is found. Digits with dashes or spaces may also be a member code (a
branch can number members `{YYYY}-{SEQ:6}`), so they are looked up both ways at once: as one number and as the
code's separate words. On the Members page, Enter (a scanned member card ends with
one) opens the member whose code was typed in full, or the only match.

**Find book details (new books):** type a title (optionally with the author) or an ISBN at the top of the *New book*
form and press *Search*. An ISBN is looked for in **our own catalogue first** (one read, no outside lookup): a title
we already have is shown at once with a link to its record, also when the public catalogues are down. Otherwise
`books-lookup` searches **Open Library** (no key) and **Google Books** (needs an API key in production, see
DEPLOYMENT.md) at the same time and returns up to 10 matches, one per ISBN; titles already in the catalogue are
marked and link to the existing record. A caller that wants one ISBN only can send `exact: true`: the answer then
goes out as soon as Google Books has that very ISBN (the record the merge would put first anyway) and Open Library
is not waited for (`sources` reports it as `skipped`); in every other case both are waited for. Each match carries
suggested genres and, when its subject headings name the audience ("Juvenile Fiction", "Young Adult Fiction",
"Children's stories", "Picture books"), a suggested `ageGroup` (the older group when both are named, otherwise
`null`; never from a bare "children" or "teen", which also head books about them). *Use this* fills title, subtitle,
ISBN, authors and publisher, language, year, synopsis, suggested genres, age group and keywords; staff check
everything before saving. A suggested age group belongs to its match: using another match that suggests none puts
back the age group the form had before, unless someone has chosen one in the select meanwhile. When an ISBN search
has exactly one match with that ISBN, the title is not ours and nothing has been typed into the form yet, that match is filled in without a click (the other matches stay listed). Filling
the form sends nothing: authors and a publisher we have are chosen from the loaded lists (names compared as the
server compares them, so case and accents don't count), the others stay in the form **by name** (so do authors
typed with *+ name*) and `books-create` matches or adds them in the same transaction as the book (`newAuthors`,
`newPublisher`; the names it added are listed in the `book.create` audit entry). A complete ISBN typed or scanned
into the form's own ISBN field is checked against our catalogue too, and a title we have is linked under the field
(saving would be refused with `DUPLICATE_ISBN`). If both sources are unreachable, the form says so and works as
before.

**After Create (new books):** someone who can add copies at the branch in use (`copies.manage`) gets *Create and add
copies*, which saves the title and opens its page with *Add copies* ready (`?acquire=1`, dropped from the address
once used; the page opens the dialog only for someone who may add copies to that title; closing it leaves focus on
the page's *Add copies* button), and *Create only*, which stays on the catalogue. Everyone else, and anyone with no
branch in use, gets plain *Create*. The match's cover is
imported after the book is saved, without anyone waiting for it (`books-setCover` with `imageUrl`, allowed only from
Google Books / Open Library hosts): the list or the book page shows it when it lands, and one that can't be fetched
can be added from a photo. A new book starts from the age group and reading level last chosen in this browser
(genres always start empty so that someone chooses them).

**Receive books (a delivery):** *Collection → Receive books* (`/ops/books/bulk`, or the button on Inventory and on
the catalogue) takes a delivery in one pass, for staff who look after copies at the branch in use (`copies.manage`):

- **Scan each book** as it comes out of the box. The row shows the title from **our catalogue first** (by ISBN, no
  outside lookup, so restocking works offline and for everyone), otherwise the public-catalogue match as below.
  Scanning a book already on the list **adds a copy to that row** (the scan field stays ready for the next book), so
  a stack of 5 copies is 5 scans or one row with *Copies* = 5.
- **Scan-ready:** the page opens with the cursor in the first ISBN field (the field carries `data-autofocus`, see
  ARCHITECTURE.md), a delivery that was saved puts it in the next empty row, and *Clear list* in the first row of
  the fresh list; after a delivery that could not be saved it stays where it is. Rows already received stay listed
  and no longer count as repeats, so the same title in the next carton is a new line. **Scan ISBNs with the
  camera** reads the ISBN barcode on the back cover (for a laptop or phone without a hand scanner): a new ISBN goes
  into the first empty row and is looked up like a typed one, a title already on the list counts another copy on
  its row, and any other barcode (a price sticker, a copy label) is refused with a message.
- **New titles:** looked up (see below); if nobody knows the ISBN, or the lookup services are down, type the title
  and author in the row. Adding titles needs `books.create` (head office, branch managers, librarians, catalogue
  managers) in a corporate organization; others can only receive titles already in the catalogue. Each row is
  looked up with `books-lookup` and `exact: true`, so it is answered as soon as Google Books has that ISBN. A row
  whose book details name the audience starts at that **age group** ("From the book details. Check it."); a guess,
  or an age group picked on the row, is kept when the page's own choice changes, and a guess goes when another ISBN
  is typed over the row.
- **This delivery:** shelf location, condition and price per copy are set once (price can be changed per row). The
  **shelf** last picked is offered again at that branch in this browser (only while it is still an active shelf
  there), and is named beside the *Receive* button ("going on shelf A-01"). The condition and the price are never
  remembered: a stale one would be written to every copy. The choices under *For new titles* (age group, reading
  level, genre) are the ones last made in this browser, shared with the *New book* form.
- **One click** (*Receive N copies*, `copies-receive`) adds the new titles to the catalogue and every copy to the
  branch in one transaction per batch of up to 25 titles / 100 copies: copy codes from the branch's pattern
  (copies of several titles sharing one counter get consecutive numbers), barcodes, `ACQUIRED` events, and members
  already waiting for a title get the new copies first. An ISBN that turns out to be in the catalogue just gets
  copies; the same title listed twice is one line. The result and **Print N labels** show as soon as the copies
  are saved, and the page is free for the next carton. Firestore takes at most 500 writes per transaction: the writes a batch needs
  (three per copy, about five more per copy handed to a waiting member, plus new titles, authors and publishers) are
  counted first, and a batch that would go over is refused whole with "Receive it in two or more parts"
  (`RECEIVE_TOO_LARGE`) instead of failing half-way.
- **Covers** of the new titles are imported behind the scenes, three at a time (`queueCovers` in
  `apps/web/src/data/bulkBooks.ts`, one queue for the whole console): nothing waits for them, a quiet line counts
  them ("Adding covers 6 of 20…"), and they keep coming while the label sheet or another page is open. A cover that
  can't be fetched leaves the generated one. Closing or reloading the tab while covers are still waiting asks first,
  because the rest would be lost (the book page takes a photo, not a link).
- **Labels:** *Print N labels* covers every copy received since the page was opened or cleared (a second carton,
  or a retry after a batch failed, adds to it; *Clear list* starts again). The labels travel with the link, so the
  sheet shows at once and takes any number; see *Labels* under Inventory.
- **Send to branches** (staff with `books.transfer` at this branch, when another branch is open): type how many
  copies of each title go to each branch, and one click makes one transfer per branch, already on its way
  (`transfers-create` with the copy ids and `dispatch: true`; a branch that gets more than 50 copies gets several
  transfers). Nothing is scanned again: copies of a title are alike until labelled, so each branch gets the next
  ones in code order. Send **before** sticking labels on: afterwards there is one *Print N labels for <branch>*
  per branch and one for the books staying. Copies held for members waiting at this branch are never offered
  (when the delivery served someone, the copies of titles we already had are read first to see which). If a copy
  was taken meanwhile (reserved, issued), that branch's transfer is refused whole and named with the reason, the
  other branches still go, and the copy is left out so the rest can be sent again. The receiving branch scans
  each book in as usual ([CIRCULATION.md §Transfers](CIRCULATION.md#transfers)); the copies stay owned by the
  branch that received the delivery.
- `copies-receive` shares its code with `books-bulkCreate` (planning new titles) and `copies-acquire` (planning
  copies), so receiving, "Add by ISBN" and *Add copies* on a book page number and record copies the same way.

**Add books by ISBN (titles only):** the same page, for catalogue managers without a branch, is a
list of rows. Type, scan or paste ISBNs (pasting several fills several rows); each one is checked as soon as it is a
valid ISBN-10/13, looked up with `books-lookup`, and the row shows the cover, title, authors and year, or says the
ISBN is not valid, repeated, not found or already in the catalogue. Rows whose match has no author ask for one. Age
group, reading level and a genre fallback are set once for the whole list (genre and age group can be changed per
row). One *Add N books* sends the ready rows with `books-bulkCreate` (up to 25 per call, in one transaction each;
ISBNs already in the catalogue are skipped, authors and publishers are reused by name); their covers are imported
behind the scenes, as for a delivery. Scan-ready rows, the camera, the age-group guess and the remembered choices
for new titles work the same here.

**Covers:** catalogue editors (Super Admin, head office) add a photo or scan on the book page (**Add cover** /
**Change cover** / **Remove**). The browser shrinks it to a JPEG of at most 800 px (~100 KB) and sends it to
`books-setCover`, which checks the permission and the file type (JPEG, PNG or WebP by content, 1.5 MB at most),
uploads it **once, before any transaction**, to `covers/{bookId}/{requestId}.{ext}` in Cloud Storage, then saves
`coverUrl`/`coverPath` on the book in a short transaction that re-checks the permission. If saving fails, the
uploaded file is deleted; once saved, the previous file is. A retried request finds its own file already set and
returns it. Covers are public (Storage rules allow reads under `covers/`; no
client writes). Titles without a cover show a generated placeholder (title + colour). Only upload artwork you have the
right to use.

## Inventory (M1.2)

Physical copies live under the owning organization: `orgs/{o}/copies/{copyId}` with an append-only history in
`copies/{id}/events`. **Ownership ≠ location:** `owningBranchId` never changes (transfers move `currentBranchId`).

- **Acquire** (`copies-acquire`, `copies.manage` at the branch): 1–50 copies of an active title. Codes are
  `COPY-<book number>-NN` per organization by default (each branch can set its own pattern, see [NUMBERING.md](NUMBERING.md)); the barcode defaults to the code, or pre-printed barcodes can be scanned in.
  Barcodes are unique per organization via `orgs/{o}/barcodes/{barcode}`. New copies go straight to members waiting
  for that title at the branch, who are told the book is ready (as when any copy comes back to the shelf).
- **Shelf locations:** `orgs/{o}/branches/{b}/locations` (code, label, kind). Leave the code blank to number it with the
  branch's shelf pattern. Creating and archiving a shelf are audited (`location.create` / `location.archive`).
- **Shelve books** (Collection → *Shelve books*, `/ops/inventory/shelve`, `copies-shelve`, `copies.manage` at the
  branch): lists every copy at the branch that is **available but not on a shelf** (`locationId == null`): new stock
  received without a shelf, transfers received without a shelf (a shelf can be picked on receipt, see
  [CIRCULATION.md §Transfers](CIRCULATION.md#transfers)), and returned books that passed inspection (issuing clears
  a copy's shelf). Pick the shelf,
  tick the books or scan them (scanning also brings in a copy already on another shelf, to move it), and one click
  puts them all there: one transaction per 100 copies, all or none, with a `SHELVED` event per copy. Copies on loan,
  in transit, lost or retired, or at another branch, are refused; copies already on that shelf are left alone.
  Inventory shows these copies as *Not on a shelf*, and its **Shelve books (N)** button opens the page.
  - **Usual shelf:** a returned book shows the shelf it was last issued from (`lastLocationId`, kept on issue), and
    the list is in the order of those shelves. **Put N back on their usual shelves** sends the ticked books that
    have one, one `copies-shelve` per shelf, all at once: each shelf is all or none on its own, with its own audit
    entry; a refused shelf is named with the reason and its books stay ticked. A usual shelf is offered only when it
    is an active shelf of this branch (not one since archived, not one of the branch the book was lent at), and only
    for a copy that is off the shelf; new stock, and books issued before shelves were remembered, have none and go
    through the shelf picker. The picker's button puts every ticked book on the picked shelf, whatever its usual one.
  - **Scan-ready:** the scan field has the keyboard on arrival, after each save and after a shelf is picked with the
    mouse. Scanning or typing an active shelf's code picks that shelf (a book in the list is matched first; a copy
    already shelved whose pre-printed barcode equals a shelf code would be read as the shelf, so the page always
    says which shelf it chose; **Print shelf labels** in Inventory's shelf locations prints a QR label per active
    shelf to stick on it). The list is read once: shelved books are hidden on the page, and it is read again
    only when it was cut at 300, when nothing is left to show, when a save of more than 100 was refused part-way,
    or with **Check for more books** (books inspected while the page is open show only then). Reading it again
    keeps the work in hand: the ticks on books still listed and the copies scanned in from other shelves. Both
    save buttons wait while the list is being read, so an older read can't show a book just shelved as unshelved.
  - **Print labels for ticked (N)** prints labels for the ticked books from what is on the page (no shelf needed):
    a lost or never-printed label of anything not yet shelved. Copies received straight onto a shelf, or held for
    a member, are not in this list; their labels print from the book page.
- **Condition:** NEW, GOOD, FAIR, POOR (changes are recorded as events). DAMAGED/LOST/RETIRED are *statuses*.
- **State machine** — see [CIRCULATION.md](CIRCULATION.md). Retired copies are never deleted and never return.
- **Availability** (`copies-availability`): per-branch counts computed live with Firestore count queries (always
  exact, no counters to drift). Any signed-in user may call it (it reveals only counts).
- **Branch visibility:** staff with branch-scoped roles (manager, librarian, delivery, employee) see only their own
  branches on the Branches page, dashboard and departments, and open copies only at their branches. To find a book
  elsewhere, catalogue search shows every branch holding each title (`Central 2/3` = 2 of 3 in-stock copies on the
  shelf; their branch first), the book page lists availability per branch, and scanning a copy held at another branch
  in Inventory says which branch has it and its status (`copies-locate`).
- **Finding copies:** Inventory's *Find a copy* takes a scanned or typed copy code or barcode; *Search by title*
  lists the branch's copies of every title matching the word typed (the catalogue's title search), with the status
  filter still applied. A scan asks for the barcode and the code together (a barcode match wins). The copy page
  opened from a scan or a list row shows the copy just read while it reads it afresh (never once that read has
  answered), so its shelves and book load alongside. Its *Record condition* and *Inspect* dialogs start from the
  copy's condition (*Repaired* from Good), and *Move* starts on the copy's shelf and saves only a real move. The
  action buttons wait for the page's own read, so a dialog never starts from the copy that was carried there.
- **Labels:** the console prints A4 sheets (3 × 8). Stories prints **QR codes only** (no 1-D barcodes): each label
  has the QR code of the copy code with the copy code and the book title (small type) beside it; the copy page shows
  the same QR tag, and member ID cards carry a QR code of the member code. Older labels with Code 128 bars and books'
  ISBN barcodes still scan (below). The links that lead to the sheet (Receive books, a book's page, *Print labels
  for ticked* on Shelve books) hand it the labels they already hold (`labelsLink` in
  `apps/web/src/admin/inventory/Inventory.tsx`, router state): no copy is read, and any number prints. The address
  also carries the first 120 copy ids (`?copies=`), which is what a new tab or a pasted link reads instead; a copy
  that can't be read there is left out and counted, not a blank sheet. The page says how many labels and sheets.
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
- **Aadhaar number** (optional): typed at registration, on *Edit*, or by the member at sign-up; checked as 12 digits
  with the Verhoeff check digit. The member record keeps only `aadhaarLast4` (pages show `XXXX XXXX 1234`); the full
  number is in `members/{m}/private/aadhaar`, which no client can read. Staff who manage members at the branch can
  press **Show** (`members-revealAadhaar`, audited as `member.revealAadhaar`). One Aadhaar number per member in an
  organization (`DUPLICATE_AADHAAR`), checked through `orgs/{o}/aadhaarIndex/{sha256}` so the index holds no numbers.
  Leaving the field empty on *Edit* keeps the number on file.
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
  Right after *Register member* the new member's page opens with the plan chooser already open (once: not on reload
  or Back, and only where the *Subscribe* button would show). *Current books* reads only the loans still out, and the
  deposit card reads the account and the pending adjustments together, then the latest 8 ledger entries.


**Member list** (Members page): every member at the branch, 50 at a time, with plan, renewal date ("in 6 days",
"ended yesterday"), books out and status. Chips filter by subscription with counts — active, renewal due within 15
days, expired, never subscribed — plus status and age-group filters; search (name, code, mobile) combines with them.
Members carry `planName` and `renewalDueAt` (end of the latest paid term, pushed out by a pre-paid renewal and kept
after expiry), written when a payment activates a subscription. Every way of creating a member must write both
fields (as `null` until a plan is paid for): the "never subscribed" list asks for `renewalDueAt == null`, which does
not match a member without the field. `renewalsDueCount` (`apps/web/src/data/members.ts`) asks for the "renewal
due" count alone, with the same bounds as the chip, for the menu.

## Transfers

See [CIRCULATION.md §Transfers](CIRCULATION.md#transfers).

## Staff dashboard

The Dashboard (`admin/dashboard/Dashboard.tsx`) answers "what do I need to do
now?". Each part shows only when the person may see it:

- **Needs attention:** inspections, books to put back on the shelf (new or returned, for staff who look after
  copies; opens *Shelve books*), incoming transfers, deposit approvals, memberships to renew in the next 15 days,
  and the HR items (documents, corrections, leave, payroll runs, last month's attendance). Each links to its page.
- **Today at the branch:** issued, exchanges, holds ready, members waiting, awaiting inspection, not on a shelf,
  incoming transfers.
- **Members at the branch:** active, renewal due, expired and all. Each opens the member list with that filter
  (`/ops/members?renewal=DUE`).
- **Catalogue** (catalogue owners): titles, and titles added this month.
- **Organization:** branches, and staff with access.

Figures are count queries (one read per 1,000 documents). "Nothing needs your attention" appears only once
everything has loaded; if a part fails, a note says the list may be incomplete, with a retry.

## Member app (self-service)

> Since 2026-11-10 these pages are the **member area on the website** (`storiesforall.in/account`, docs/SITE.md);
> the staff app no longer shows them and sends members there.

Members sign in with the email the branch recorded on their membership (verified: Google sign-in, or the
verification link for email/password accounts). On the first visit `me-overview` links every unclaimed member record
with that email to the account (`members.accountHolderUid`, audited; matched case-insensitively via `emailLower`).
A guardian's account also sees the children whose `guardian.memberId` is theirs, with a switcher between them.

**Self sign-up.** Anyone signed in with a verified email but no membership sees **Become a member** (on every member
page, including Membership): they pick the library and branch (`me-joinOptions` lists active branches of active
organizations), enter name, date of birth and mobile, and `me-join` creates their member record at that branch
(numbered with the branch's member pattern, `accountHolderUid` = them, email = their sign-in email, `source: SELF`,
audited as `member.selfRegister`). They then choose a plan and billing option and pay online or at the branch, as
below. Rules: adults only (a child is added by a parent); one own membership per organization; an email the branch
already registered is linked instead (reload); the mobile number must not belong to another member.
**Add a child** (Membership page, own adult membership): `me-addChild` creates the child's record at the same branch
with the member as guardian; the child appears in the switcher with their plans to buy.

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
(USB scanner or the camera button) opens the member, like typing the code. The desk opens in that field and comes back
to it after each member, so a visit is: scan the card, scan the books, press Enter (see [CIRCULATION.md](CIRCULATION.md),
*The desk*).
- Staff: member page → **Library ID card** → Print (only the card prints, at real size) or Download (PNG, 300 dpi).
- Members: Profile → **Library ID card** (also linked from Home) → Download to their phone, or Print.
