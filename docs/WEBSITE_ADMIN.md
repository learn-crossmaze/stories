# Managing the website (console → Website)

The staff console has a **Website** view (next to Admin, Operations and Staff) at
`https://stories-by-crossmaze.web.app/website` (later `app.storiesforall.in/website`). It is laid out like the
crossmaze.in admin panel, in the same order: **Dashboard**, then **Website**, **Stories**, **Enquiries** and
**Settings**, with a **Publish all** button in the top bar.

| Group | Page | What it changes | On the website |
| --- | --- | --- | --- |
| | Dashboard | Changes waiting to be published (and Publish all), new enquiries, taps on call buttons this week, posts waiting for review, links to every page, what was published lately | — |
| Website | Site settings | Contact details (main phone, WhatsApp, email, franchise and careers emails), the home page banner, the About page (story, figures, photos), the people behind Stories (with a switch to show them), social links | Footer, Contact, Franchise, Careers, home banner, `/about` |
| | Page sections | Lists on the pages: the home page's promises, steps and reader groups; How it works' steps and questions; the Franchise and Careers points. An empty list keeps the page's own words | Home, How it works, Franchise, Careers |
| | Branches | Each branch's page: tagline, welcome, about, photos, figures, amenities, **notices with dates**, good to know, **what's on**, the **head librarian's profile** and **their picks**, WhatsApp number, Google Maps link | `/branches/<address>`, with a call-me-back form |
| | Plans | The plans and prices (the same page as Operations → Plans; head office) | `/plans` |
| | Offers | A bar on every page, a once-a-day pop-up or a home page banner, with dates, a code and the pages it shows on | Every page / home / those branches' pages |
| | Jobs | Open roles: title, where, type, overview, qualification, experience, timings, responsibilities | `/careers`, with an application form (CV upload) |
| Stories | Blog | Posts in seven designs, private previews, review by a manager | `/blog`, the home page, branch pages |
| | Festival greetings | 36 days a year (festivals, national days, library days): switch a day off, own words or picture, new drawings, books for the day, the offer beside the card | A toast and a card on the day |
| | Testimonials | Readers' words, with the name they chose | Home page: "What readers say" |
| Enquiries | Submissions | Every membership enquiry, message, franchise enquiry and job application from the website's forms: call or WhatsApp back, note, mark as handled, download the CV, export to CSV | — |
| | Calls | Every tap on a call or WhatsApp button: by branch, page, how the visitor found the site and device; 7 days, 30 days or 3 months; CSV | — |
| Settings | Connections | Enquiry alerts (staff told about each new enquiry in the staff app and, where set up, on WhatsApp; and each branch's managers for their branch), and which branches have WhatsApp and online payments set up | — |
| | Admins | Everyone who can change the website and what they may do; **Give someone access** opens Roles & access | — |

## Who can do what

| Role | Website view |
| --- | --- |
| Head Office Admin, **Website Editor** (corporate) | Everything, every branch; publish (Plans: head office only) |
| Franchise Owner, Branch Manager | Their branches' pages and enquiries; posts about their branches (write, review, publish) |
| Librarian | Write posts (their own) and **send them for review** |

The server decides (functions/src/site/admin.ts, inbox.ts); the menu only hides pages. Give someone the Website
Editor role on Admin → Roles & access; they land in the Website view when they sign in.

## Forms and calls

- The website's forms post to `/api/submit` (served by `sitePublic`): saved first (`siteSubmissions`), then the
  alerts go out. A hidden field catches robots; each visitor may send 8 an hour. CVs (PDF or Word, 2 MB) are kept in
  Cloud Storage (`submissions/<id>/`), never public: the console downloads them through `site-resume`.
- Taps on call and WhatsApp buttons post to `/api/tap` (`siteCalls`, kept 400 days). Nothing that identifies the
  visitor is stored: the visit code is random and forgotten when the tab closes.

## Save, preview, publish

- **Save** keeps a draft; the website doesn't change.
- **Preview** (posts and branch pages) opens the saved draft at a private address (`/preview/…?t=…`), not indexed.
- **Publish** puts the saved draft on the website; it shows within 5 minutes (the website's data and pages are
  cached for 5 minutes). Ticking **Hide from the website** and publishing takes an item off; **Take off the
  website** does the same; the draft is kept. **Go back to the live version** throws away unpublished changes.
- Offers show only between their dates (India's date) once published, and stop by themselves.
- Every save and publish is in the audit log; publishes are also listed on the Overview.

## How it works

- Content: Firestore `siteContent/{settings|sections|greetings}`, `siteBranches/{branchId}`, `sitePosts/{id}`,
  `sitePromotions/{id}`, `siteJobs/{id}`, `siteTestimonials/{id}`, each with `draft` and `live`; `sitePublishLog`. Clients can't read or write them
  directly (rules deny); everything goes through the `site-*` actions (admin router).
- Pictures: `site-uploadImage` stores them in Cloud Storage (`site/<month>/<id>.jpg`, shrunk in the browser first).
- The website reads published content through `/api/public` (offers, festive cards, branch page links, latest posts,
  questions, social links) and through the **server-rendered pages** of the `sitePages` function: `/blog`,
  `/blog/<address>`, `/branches/<address>`, `/about`, `/careers`, `/preview/…` and `/sitemap.xml`. Those pages fill the site's own
  template (`apps/site/_t/page.html`, deployed with the site), so search engines read them in full; posts and branch
  pages carry structured data (BlogPosting, Library).
- Festive cards: the card engine is the Crossmaze website's (`apps/site/src/greetings`, from
  learn-crossmaze/crossmaze-website), with library words (`greetings/library.ts`), the library days and their
  drawings (`designs/library.ts`, `kits/library.ts`). Every page checks the date with a small schedule
  (`greetings/today.ts`); the drawings load only on greeting days. Festival dates that move (Diwali, Eid…) are in
  `greetings/dates.json` (to 2031); `node tools/site/festival-dates.mjs` refreshes them from Google's calendar of
  Indian holidays.

## Deploying

As for crossmaze.in: the website and staff app deploy from GitHub after each merge (with `DEPLOY_SITE` = `true`);
the backend (the `site-*` actions, `sitePublic`, `sitePages`, Firestore indexes) with `npm run publish:all` on your
computer (docs/DEPLOYMENT.md §2). The website's new addresses (`/blog`, `/branches/<address>`, `/about`,
`/careers`, `/api/submit`, `/sitemap.xml`) rely on those functions, so deploy the backend the first time.

## Ideas for later

- **Events with sign-ups**: storytime, author visits, summer reading camp, with seats, a reminder on WhatsApp and a
  list for the branch.
- **Reading challenges**: "read 10 books this summer", with badges in the member area.
- **Email alerts** for enquiries (crossmaze.in's Zoho email alerts), once a mail service is chosen.
- **Book donations** and **book requests**: readers suggest titles; the catalogue team sees the most asked-for.
- **Reader reviews** on books, shown on the website after a librarian approves them.
- **Newsletter**: the month's new arrivals and posts, by email or WhatsApp.
- **Scheduled posts** (publish on a date) and **drafts written by Claude** from a topic (as on crossmaze.in).
- **Kannada and Hindi** versions of the main pages.
