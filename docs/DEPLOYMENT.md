# Stories — Deployment

One Firebase project, `stories-by-crossmaze` (Blaze), region `asia-south1`.

| What | How | When |
|---|---|---|
| Tests | `.github/workflows/ci.yml` | every pull request, and as the first step of every deploy |
| Backend: Cloud Functions, Firestore rules, indexes and TTL policies, Storage rules | `deploy.yml` → *Backend* job once `DEPLOY_BACKEND` is on (§1); otherwise `npm run deploy:backend` by hand | every push to `main` |
| Web app (Hosting) | `deploy.yml` → *Web app* job | every push to `main`, **after** the tests pass and the backend deployed |
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
2. GitHub → Settings → Secrets and variables → Actions → **Secrets** → `FUNCTIONS_ENV`: paste the whole content of
   your `functions/.env.stories-by-crossmaze` (at least `BOOTSTRAP_SUPER_ADMIN_EMAIL=learn@crossmaze.in`; also
   `GOOGLE_BOOKS_API_KEY=…` and, after App Check, `ENFORCE_APP_CHECK=true`). Without it a deploy would lose these
   values, so the job stops with an error instead.
3. Same page → **Variables** → `DEPLOY_BACKEND` = `true`.
4. Run it once by hand: Actions → *Deploy* → *Run workflow*. If it fails on a missing permission, the error names the
   role to add.

The job deploys without `--force`: if a change removes a function, the deploy stops and asks for confirmation — run
`npm run deploy:backend` once by hand and answer **yes**, then re-run the workflow. Unchanged functions are skipped,
so a deploy that touches only the web app adds about a minute.

## 2. Deploying the backend by hand

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
Scheduled functions also enable Cloud Scheduler. The backend deploys as **16 services** (`maxInstances: 5` each) to
stay inside the project's Cloud Run CPU quota: 7 routers (`admin`, `catalogue`, `inventory`, `members`, `billing`,
`circulation`, `hr`), 3 webhooks (`razorpayWebhook`, `whatsappWebhook`, `deliveryWebhook`), the `whatsapp-send`
trigger and 5 scheduled jobs (`expireSubscriptions` hourly, `expireHolds` and `maintenance` every 15 minutes,
`expireDocuments` and `accrueLeave` daily). `maintenance` finishes interrupted work: token updates after role changes
(users marked `claimsStale`) and WhatsApp messages whose send never ran or was cut off. Don't split actions back into separate exported functions: add them to a router
(`functions/src/routes.ts`). When a deploy removes
functions that no longer exist in the code, the CLI asks to delete them: answer **yes**. New Firestore indexes build in the background for a few minutes after deploy; until then the affected
screens show "couldn't load" and recover on their own.

## Optional: Google Books for "Find book details"

Book search works with Open Library alone. To add Google Books (better coverage of Indian editions):

1. Google Cloud console (project `stories-by-crossmaze`) → **APIs & Services → Library** → enable **Books API**.
2. **Credentials → Create credentials → API key**; restrict it to the **Books API**.
3. Create `functions/.env.stories-by-crossmaze` (git-ignored) with `GOOGLE_BOOKS_API_KEY=<the key>` and run
   `npm run deploy:backend`.

Without a key Google Books' shared anonymous quota is usually exhausted, and the search quietly uses Open Library only.

## One-time console steps after the first backend deploy

1. **TTL policies** are deployed with the indexes (`fieldOverrides` with `"ttl": true` in
   `firebase/firestore.indexes.json`): `idempotency` (30 days), `notifications` and `whatsappOutbox` (90 days), all on
   `expireAt`. Nothing to do by hand; Firestore → TTL shows them a few minutes after the deploy.
2. **Claim Super Admin:** sign in to the site as `learn@crossmaze.in` (email verified), open `/setup`, click
   *Become Super Admin*. This works once; afterwards grant roles from *Staff & roles*.
3. **App Check (before launch):** register the web app with reCAPTCHA Enterprise, put the site key in
   `apps/web/.env.production`, then set `ENFORCE_APP_CHECK=true` in `functions/.env.stories-by-crossmaze` (and in the
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
