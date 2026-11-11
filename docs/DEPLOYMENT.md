# Stories — Deployment

One Firebase project, `stories-for-all` (alias of the permanent project ID `stories-by-crossmaze`; docs/ENVIRONMENTS.md §7),
Blaze plan, region `asia-south1`. The app is at `https://app.storiesforall.in`, the public website at
`https://storiesforall.in` (docs/SITE.md).

| What | How | When |
|---|---|---|
| Tests | `.github/workflows/ci.yml` | every pull request, and as the first step of every deploy |
| Backend: Cloud Functions, Firestore rules, indexes and TTL policies, Storage rules | `deploy.yml` → *Backend* job once `DEPLOY_BACKEND` is on (§1); otherwise `npm run deploy:backend` by hand | every push to `main` |
| Web app (Hosting target `app`) | `deploy.yml` → *Web app* job | every push to `main`, **after** the tests pass and the backend deployed |
| Public website (Hosting target `site`) | `deploy.yml` → *Public website* job, once `DEPLOY_SITE` is on (docs/SITE.md); or `npm run deploy:site` | every push to `main`, after the tests and the backend |
| PR previews | `firebase-hosting-pull-request.yml` | every pull request from this repo |

`deploy.yml` runs one deploy at a time (a newer merge waits for the running one) and never publishes a site whose tests
failed or whose backend deploy failed, so the site can't get ahead of the backend ("the server is out of date").

## 1. Turning on automatic backend deploys (once)

Until this is done the *Backend* job is skipped and the owner deploys the backend by hand (next section) **before**
merging web changes that depend on it.

1. Google Cloud console → IAM → the service account in the GitHub secret `FIREBASE_SERVICE_ACCOUNT_STORIES_BY_CROSSMAZE`
   (it ends in `@stories-by-crossmaze.iam.gserviceaccount.com`; today it can only deploy Hosting) → add the roles
   *Cloud Functions Admin*, *Cloud Run Admin*, *Service Account User*, *Cloud Scheduler Admin*, *Firebase Rules Admin*,
   *Cloud Datastore Index Admin*, *Cloud Datastore Owner* (TTL policies), *Artifact Registry Administrator*,
   *Secret Manager Viewer*, *Firebase Extensions Viewer* and *Service Usage Consumer*.
2. Only if you keep private settings in a local `functions/.env.stories-for-all` (e.g. `GOOGLE_BOOKS_API_KEY=…`, and
   after App Check `ENFORCE_APP_CHECK=true`): GitHub → Settings → Secrets and variables → Actions → **Secrets** →
   `FUNCTIONS_ENV` = that file's whole content, so CI deploys keep them. `BOOTSTRAP_SUPER_ADMIN_EMAIL` is committed in
   `functions/.env` and needs nothing.
3. Same page → **Variables** → `DEPLOY_BACKEND` = `true`.
4. Run it once by hand: Actions → *Deploy* → *Run workflow*. If it fails on a missing permission, the error names the
   role to add.

The job deploys without `--force`: if a change removes a function, the deploy stops and asks for confirmation — run
`npm run deploy:backend` once by hand and answer **yes**, then re-run the workflow. Unchanged functions are skipped,
so a deploy that touches only the web app adds about a minute.

## 2. Publishing: GitHub for the sites, `npm run publish:all` for the backend

The same routine as the crossmaze-website project:

- **The staff app and the website deploy from GitHub by themselves** after every merge to `main` (Actions →
  *Deploy*): GitHub runs all the tests, builds, and publishes. Nothing to do on your computer. For the website,
  set the repository variable `DEPLOY_SITE` = `true` once (GitHub → Settings → Secrets and variables → Actions →
  Variables); the staff app already deploys this way.
- **The backend deploys from your computer**, when a change touches the functions or the Firestore/Storage rules
  (the change's notes say so). One command:

```bash
npm run publish:all
```

It gets the latest code (refusing a copy with local edits), installs (`npm ci` for the apps and the functions),
signs you in to Firebase if needed, and deploys `firestore,functions,storage` (with `FUNCTIONS_DISCOVERY_TIMEOUT`
set for Windows). No tests and no site builds run on your computer: GitHub has done them. Options:
`--dry-run`, `--no-pull`, `--no-install`. The script is `tools/publish.mjs`.

If a deploy would delete a function, Firebase asks first: answer **yes** when the function was removed on purpose.

To publish a site from your computer instead (if GitHub is unavailable): `npm run build && npx firebase deploy
--only hosting:app --project stories-for-all`, and `npm run deploy:site` for the website.

## 3. Deploying the backend by hand

**Once, before the first deploy that includes Storage** (book covers): Firebase console → **Storage** → *Get started* →
location **asia-south1** (or the default), *production mode*. This creates the default bucket
(`stories-by-crossmaze.firebasestorage.app`); `deploy:backend` then publishes `firebase/storage.rules` and fails with
"Firebase Storage has not been set up" until this is done.

```bash
git pull
npm ci && npm --prefix functions ci
npx firebase login
npm run deploy:backend
```

Later deploys need only `git pull` and `npm run deploy:backend`: the functions predeploy step (`firebase.json`)
installs any new function dependencies before building.

The first deploy enables the Cloud Functions, Cloud Build, Artifact Registry and Cloud Run APIs (a few minutes).
Scheduled functions also enable Cloud Scheduler. The backend deploys as **18 services** (`maxInstances: 5` each) to
stay inside the project's Cloud Run CPU quota: 7 routers (`admin`, `catalogue`, `inventory`, `members`, `billing`,
`circulation`, `hr`), 3 webhooks (`razorpayWebhook`, `whatsappWebhook`, `deliveryWebhook`), the public website's
data endpoint `sitePublic` and its server-rendered pages `sitePages` (blog, branch pages, About, sitemap), the `whatsapp-send`
trigger and 5 scheduled jobs (`expireSubscriptions` hourly, `expireHolds` and `maintenance` every 15 minutes,
`expireDocuments` and `accrueLeave` daily). `maintenance` finishes interrupted work: token updates after role changes
(users marked `claimsStale`), WhatsApp messages whose send never ran or was cut off, and the website's book shelves
(rebuilt every 6 hours). Don't split actions back into separate exported functions: add them to a router
(`functions/src/routes.ts`). When a deploy removes
functions that no longer exist in the code, the CLI asks to delete them: answer **yes**. New Firestore indexes build in the background for a few minutes after deploy; until then the affected
screens show "couldn't load" and recover on their own.

## Optional: Google Books for "Find book details"

Book search works with Open Library alone. To add Google Books (better coverage of Indian editions):

1. Google Cloud console (project `stories-by-crossmaze`, shown as "Stories for All") → **APIs & Services → Library** → enable **Books API**.
2. **Credentials → Create credentials → API key**; restrict it to the **Books API**.
3. Create `functions/.env.stories-for-all` (git-ignored) with `GOOGLE_BOOKS_API_KEY=<the key>` and run
   `npm run deploy:backend`.

Without a key Google Books' shared anonymous quota is usually exhausted, and the search quietly uses Open Library only.

## One-time console steps after the first backend deploy

1. **TTL policies** are deployed with the indexes (`fieldOverrides` with `"ttl": true` in
   `firebase/firestore.indexes.json`): `idempotency` (30 days), `notifications` and `whatsappOutbox` (90 days), all on
   `expireAt`. Nothing to do by hand; Firestore → TTL shows them a few minutes after the deploy.
2. **Claim Super Admin:** sign in to the site as `learn@crossmaze.in` (email verified), open `/setup`, click
   *Become Super Admin*. This works once; afterwards grant roles from *Staff & roles*.
3. **App Check (before launch):** register the web app with reCAPTCHA Enterprise, put the site key in
   `apps/web/.env.production`, then set `ENFORCE_APP_CHECK=true` in `functions/.env.stories-for-all` (and in the
   `FUNCTIONS_ENV` secret, §1) and redeploy.

## Monitoring

Create these log-based alerts once (Cloud Logging → Logs Explorer → *Create alert*), sending to the owner's email:

| Alert | Query |
|---|---|
| Unexpected errors in actions | `resource.type="cloud_run_revision" severity>=ERROR jsonPayload.fn:*` |
| A scheduled job skipped documents or ran out of time | `severity>=WARNING jsonPayload.job:*` |
| WhatsApp webhook signature failures | `jsonPayload.message="whatsapp webhook: bad signature"` |

Also set a **budget alert** (Billing → Budgets) if not done yet.

## Backups

Enable Firestore **point-in-time recovery** (Firestore → Disaster recovery) before real member data is entered.
Scheduled exports are a later hardening step.
