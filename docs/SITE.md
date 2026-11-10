# Stories — Public website (storiesforall.in)

The public website is a small, fast static site for everyone, including search engines: what Stories is, plans and
prices, branches and hours, how it works, franchising and contact, plus a **Books** page of what's popular and new. The app (members and staff) lives separately at
`app.storiesforall.in`.

| Address | What | Code | Hosting target |
|---|---|---|---|
| `storiesforall.in`, `www.storiesforall.in` | Public website | `apps/site` | `site` (Hosting site `storiesforall-website`) |
| `storiesforall.in/account` | **Member area**: everything a member does | `apps/web` member pages (`member.html`, `src/memberMain.tsx`, `src/memberRoutes.tsx`) | `site` (built into `apps/site/dist/account`) |
| `app.storiesforall.in` | Staff app (console only) | `apps/web` | `app` (Hosting site `stories-by-crossmaze`) |

## How it's built

- **Plain HTML pages** (`apps/site/index.html`, `books/`, `plans/`, `branches/`, `how-it-works/`, `franchise/`, `contact/`,
  `404.html`), so every page's text is in the HTML that search engines read. Vite builds them; the shared header,
  footer and head tags are in `apps/site/src/partials` (included with `<!-- include:header -->`).
- **Two looks**, both kept (`apps/site/src/site.css`; fonts Poppins and Nunito, self-hosted):
  - **Candy** (`data-theme="candy"`, the Crossmaze family style, as on crossmaze.in): a pastel colour flow down the
    page, frosted-glass cards and a floating glass header, pink-to-purple headings with a sunshine squiggle, sunshine
    buttons, a plum footer, floating star/book/pencil doodles and candy-coloured shelves.
  - **Reading room** (`data-theme="library"`): white pages with soft pastel washes and light gradients, white cards,
    teal-to-indigo headings, library artwork (a bookcase hero with a ladder, plant and owl; bookmark and book doodles;
    a row of book spines along section edges; a navy footer topped with books) and light-oak shelves.
  - **Choosing:** the default is `VITE_SITE_THEME` in `apps/site/.env` (and in `apps/web/.env.production` for the
    member area). Visitors can switch in the footer (*Look: Candy · Reading room*); the choice is saved in the browser
    for the website and the member area. Preview either with `?theme=candy` or `?theme=library`.
  - Text meets WCAG AA in both, light and dark; animation stops for people who prefer reduced motion.
  - The member area uses the same two looks (`apps/web/src/member/memberTheme.css`). Logo: `public/logo.svg`.
- **Live data:** plans with today's prices (offers included), branches with hours, phone and delivery, and the number
  of titles come from `GET /api/public`. That's a Hosting rewrite to the `sitePublic` function
  (`functions/src/site/public.ts`), which returns only public fields of active organizations, branches and plans.
  The CDN caches it for 15 minutes, so a price change shows on the site within about 15 minutes. Rendering is in
  `apps/site/src/render.ts` (every value escaped) and tested in `apps/site/src/test`.
- **Book shelves** (Books page, and two on the home page): *Trending this month* (most loans in 30 days), *New to
  the library* (newest titles), *All-time favourites* (sum of every copy's loans), *Most wanted* (members waiting
  in reservation queues), *Top picks for every age* (most loans in 90 days per age group, as tabs) and *Explore by
  genre* (titles per genre). They're built from counts only, never member details, by `functions/src/site/showcase.ts`
  into `public/showcase` (rules deny clients), rebuilt by the maintenance job every 6 hours, and shown as
  sideways-scrolling candy shelves with the cover (or a drawn pastel cover), a ribbon (#1, New, 5 waiting)
  and why the book is there. An empty shelf hides its section, so a new library never shows blank shelves. Each
  book links to the catalogue in the app.
- **Settings** (`apps/site/.env`): `VITE_APP_URL` (where *Become a member* and *Sign in* go) and
  `VITE_CONTACT_EMAIL` (shown on Contact and Franchise; empty hides it and points people to the branches).
- **SEO:** a title, description, canonical URL and Open Graph tags per page, `robots.txt`, `sitemap.xml`, and an
  Organization description on the home page.

To change wording, edit the HTML page. To change what plans or branches show, change them in the app (Plans,
Branches); the site follows.

## Member area (storiesforall.in/account)

Members don't use the staff app. Everything they do is in the member area on the website, in the same look:
their account (plan, renewal, books with them, deposit; switch between their own and their children's
memberships), Explore and reserve, My books (borrowed, reservations, history, home delivery), Membership (choose or
renew a plan, upgrade, pay online or at the branch, payments, subscription history, deposit ledger, add a child) and
Profile (library ID card, details, appearance). It is the member pages of `apps/web`, built on their own by
`vite.member.config.ts` (base `/account/`) into the website's build, with the website's header, account tabs and
footer (`src/member/MemberShell.tsx`, `src/member/memberTheme.css`). Sign-in is on `/account/sign-in` (email and
password or Google; Zoho sign-in is for staff only). The backend is unchanged: the same `me-*` actions.

- The website's *Become a member* and *Sign in* go to `/account` (`VITE_APP_URL` in `apps/site/.env`); book cards
  link to `/account/explore`.
- The staff app sends anyone who isn't staff to the member area, and old member addresses (`/membership`,
  `/my-books`…) to the same page there (`VITE_MEMBER_URL` in `apps/web/.env.production`). Staff see a *Staff
  console* link in the member area (`VITE_STAFF_URL`) and *Member view* in the console.
- Hosting serves `/account` and its pages from `account/member.html` (`firebase.json`, target `site`).
- **Sign-in needs the website's address authorized:** Firebase → Authentication → Settings → Authorized domains →
  add `storiesforall-website.web.app` (and `storiesforall.in` once connected).

## Local development

```bash
npm run emulators   # terminal 1 (serves sitePublic from the seeded data)
npm run seed        # terminal 2, once
npm run dev:site    # terminal 2 → http://localhost:8082 (the website)
npm run dev:member  # terminal 3 → http://localhost:8083/account/ (the member area)
```

Tests and build: `npm run test:site`, `npm run build:site` (CI runs both).

## Going live (once)

1. **Create the Hosting site:** Firebase console → Hosting → *Add another site* → site ID `storiesforall-website`. Site IDs
   are unique across all of Firebase; if it's taken, pick another (e.g. `storiesforall-in`) and change `"site"` in
   `.firebaserc` → `targets` to that ID.
2. **Deploy the backend** (adds the `sitePublic` function): `npm run deploy:backend`.
3. **Deploy the site once by hand:** `npm run deploy:site`. It's then live at `https://storiesforall-website.web.app` (or
   your site ID). Check the pages and that plans and branches load.
4. **Automatic deploys:** GitHub → Settings → Secrets and variables → Actions → **Variables** → `DEPLOY_SITE` =
   `true`. From then on every merge to `main` deploys the site after the tests (and the backend, when automatic).
5. **Domains** (docs/ENVIRONMENTS.md §7): in Hosting, open the **storiesforall-website** site → *Add custom domain* →
   `storiesforall.in`, then `www.storiesforall.in` redirecting to it. Open the **stories-by-crossmaze** site → *Add
   custom domain* → `app.storiesforall.in`. Add each record Hosting shows at your registrar.
6. **Update the addresses** once the domains say *Connected*: in `apps/web/.env.production`, set
   `VITE_MEMBER_URL=https://storiesforall.in/account` and `VITE_STAFF_URL=https://app.storiesforall.in`, and merge.
