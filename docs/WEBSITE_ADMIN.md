# Managing the website (console → Website)

The staff console has a **Website** section (Admin view) for everything storiesforall.in shows beyond the live
catalogue, plans and branches. It follows the crossmaze.in admin panel's way of working (save, preview, publish;
branch admins for their own branch; festival greetings), adapted to a library and to the Stories roles.

| Page | What it changes | On the website |
| --- | --- | --- |
| Overview | What is waiting to be published or reviewed, what was published lately; **Publish all** | — |
| Blog | Posts in seven designs, drafts with a private preview link, review by a manager | `/blog`, `/blog/<address>`, the home page's "From the library", the branch page's news |
| Branch pages | Per branch: tagline, welcome, about, photos, figures, amenities, **notices with dates** (closures, changed hours), good to know, **what's on** (storytime, book club), the **head librarian's profile** (photo, words, quote, languages, books they love) and **their picks** from the catalogue, WhatsApp number, Google Maps link | `/branches/<address>`, linked from the branch cards |
| Offers and promotions | Headline, message, button, code, picture, colour, **dates**, whole site or some branches, and where: a **bar** on top of every page, a **pop-up** once a day, or a **home page banner** | Every page / the home page / those branches' pages |
| Festive cards | 36 days a year (festivals, national days, and the library days: Children's Book Day, World Book Day, Reading Day, Librarians' Day, Literacy Day): switch a day off, change the card's words, add your own picture, **Try another drawing**, books for the day, the offer beside the card | A toast on the day, and a pop-up with the card (Share on WhatsApp, Download), what the day is about, a reading idea and the offer |
| Site settings | The About page (story, figures, photos), the people behind Stories, more questions for How it works, social links | `/about`, How it works, the footer |

## Who can do what

| Role | Website section |
| --- | --- |
| Head Office Admin, **Website Editor** (new role, corporate) | Everything, every branch; publish |
| Franchise Owner, Branch Manager | Their branches' pages; posts about their branches (write, review, publish) |
| Librarian | Write posts (their own) and **send them for review**; a manager of the branch the post is about, or the website team, publishes |

The server decides (functions/src/site/admin.ts); the menu only hides pages. Give someone the Website Editor role
on Admin → Roles & access (head office).

## Save, preview, publish

- **Save** keeps a draft; the website doesn't change.
- **Preview** (posts and branch pages) opens the saved draft at a private address (`/preview/…?t=…`), not indexed.
- **Publish** puts the saved draft on the website; it shows within 5 minutes (the website's data and pages are
  cached for 5 minutes). Ticking **Hide from the website** and publishing takes an item off; **Take off the
  website** does the same; the draft is kept. **Go back to the live version** throws away unpublished changes.
- Offers show only between their dates (India's date) once published, and stop by themselves.
- Every save and publish is in the audit log; publishes are also listed on the Overview.

## How it works

- Content: Firestore `siteContent/{settings|greetings}`, `siteBranches/{branchId}`, `sitePosts/{id}`,
  `sitePromotions/{id}`, each with `draft` and `live`; `sitePublishLog`. Clients can't read or write them
  directly (rules deny); everything goes through the `site-*` actions (admin router).
- Pictures: `site-uploadImage` stores them in Cloud Storage (`site/<month>/<id>.jpg`, shrunk in the browser first).
- The website reads published content through `/api/public` (offers, festive cards, branch page links, latest posts,
  questions, social links) and through the **server-rendered pages** of the `sitePages` function: `/blog`,
  `/blog/<address>`, `/branches/<address>`, `/about`, `/preview/…` and `/sitemap.xml`. Those pages fill the site's own
  template (`apps/site/_t/page.html`, deployed with the site), so search engines read them in full; posts and branch
  pages carry structured data (BlogPosting, Library).
- Festive cards: the card engine is the Crossmaze website's (`apps/site/src/greetings`, from
  learn-crossmaze/crossmaze-website), with library words (`greetings/library.ts`), the library days and their
  drawings (`designs/library.ts`, `kits/library.ts`). Every page checks the date with a small schedule
  (`greetings/today.ts`); the drawings load only on greeting days. Festival dates that move (Diwali, Eid…) are in
  `greetings/dates.json` (to 2031); `node tools/site/festival-dates.mjs` refreshes them from Google's calendar of
  Indian holidays.

## Deploying

`npm run publish:all` (docs/DEPLOYMENT.md §2): it deploys the backend (the `site-*` actions, the `sitePages`
function and the blog's Firestore index) before the website, whose new addresses (`/blog`, `/branches/<address>`,
`/about`, `/sitemap.xml`) are rewrites to that function.

## Ideas for later

- **Events with sign-ups**: storytime, author visits, summer reading camp, with seats, a reminder on WhatsApp and a
  list for the branch.
- **Reading challenges**: "read 10 books this summer", with badges in the member area.
- **Enquiries inbox** (as on crossmaze.in): membership, franchise and "suggest a book" forms on the website, saved in
  Firestore, followed up on WhatsApp.
- **Calls and WhatsApp taps** per branch (crossmaze.in's "Calls" page), to see which pages bring visitors.
- **Book donations** and **book requests**: readers suggest titles; the catalogue team sees the most asked-for.
- **Reader reviews** on books, shown on the website after a librarian approves them.
- **Newsletter**: the month's new arrivals and posts, by email or WhatsApp.
- **Scheduled posts** (publish on a date) and **drafts written by Claude** from a topic (as on crossmaze.in).
- **Kannada and Hindi** versions of the main pages.
