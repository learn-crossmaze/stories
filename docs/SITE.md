# Stories — Public website (storiesforall.in)

The public website is a small, fast static site for everyone, including search engines: what Stories is, plans and
prices, branches and hours, how it works, franchising and contact. The app (members and staff) lives separately at
`app.storiesforall.in`.

| Address | What | Code | Hosting target |
|---|---|---|---|
| `storiesforall.in`, `www.storiesforall.in` | Public website | `apps/site` | `site` (Hosting site `storiesforall`) |
| `app.storiesforall.in` | Stories app | `apps/web` | `app` (Hosting site `stories-by-crossmaze`) |

## How it's built

- **Plain HTML pages** (`apps/site/index.html`, `plans/`, `branches/`, `how-it-works/`, `franchise/`, `contact/`,
  `404.html`), so every page's text is in the HTML that search engines read. Vite builds them; the shared header,
  footer and head tags are in `apps/site/src/partials` (included with `<!-- include:header -->`).
- **Bright and playful**, for a children's library: rainbow palette, Fredoka and Nunito fonts (self-hosted from
  `@fontsource-variable/*`), sticker-style cards with chunky outlines, wavy section edges and an illustrated hero
  (inline SVG in `index.html`). Text keeps WCAG AA contrast; light and dark; animation stops for people who
  prefer reduced motion (`apps/site/src/site.css`).
- **Live data:** plans with today's prices (offers included), branches with hours, phone and delivery, and the number
  of titles come from `GET /api/public`. That's a Hosting rewrite to the `sitePublic` function
  (`functions/src/site/public.ts`), which returns only public fields of active organizations, branches and plans.
  The CDN caches it for 15 minutes, so a price change shows on the site within about 15 minutes. Rendering is in
  `apps/site/src/render.ts` (every value escaped) and tested in `apps/site/src/test`.
- **Settings** (`apps/site/.env`): `VITE_APP_URL` (where *Become a member* and *Sign in* go) and
  `VITE_CONTACT_EMAIL` (shown on Contact and Franchise; empty hides it and points people to the branches).
- **SEO:** a title, description, canonical URL and Open Graph tags per page, `robots.txt`, `sitemap.xml`, and an
  Organization description on the home page.

To change wording, edit the HTML page. To change what plans or branches show, change them in the app (Plans,
Branches); the site follows.

## Local development

```bash
npm run emulators   # terminal 1 (serves sitePublic from the seeded data)
npm run seed        # terminal 2, once
npm run dev:site    # terminal 2 → http://localhost:8082
```

Tests and build: `npm run test:site`, `npm run build:site` (CI runs both).

## Going live (once)

1. **Create the Hosting site:** Firebase console → Hosting → *Add another site* → site ID `storiesforall`. Site IDs
   are unique across all of Firebase; if it's taken, pick another (e.g. `storiesforall-in`) and change `"site"` in
   `.firebaserc` → `targets` to that ID.
2. **Deploy the backend** (adds the `sitePublic` function): `npm run deploy:backend`.
3. **Deploy the site once by hand:** `npm run deploy:site`. It's then live at `https://storiesforall.web.app` (or
   your site ID). Check the pages and that plans and branches load.
4. **Automatic deploys:** GitHub → Settings → Secrets and variables → Actions → **Variables** → `DEPLOY_SITE` =
   `true`. From then on every merge to `main` deploys the site after the tests (and the backend, when automatic).
5. **Domains** (docs/ENVIRONMENTS.md §7): in Hosting, open the **storiesforall** site → *Add custom domain* →
   `storiesforall.in`, then `www.storiesforall.in` redirecting to it. Open the **stories-by-crossmaze** site → *Add
   custom domain* → `app.storiesforall.in`. Add each record Hosting shows at your registrar.
6. **Point the site at the app's new address:** once `app.storiesforall.in` says *Connected*, set
   `VITE_APP_URL=https://app.storiesforall.in` in `apps/site/.env` and merge.
