# Stories — Deployment

One Firebase project, `stories-by-crossmaze` (Blaze), region `asia-south1`.

| What | How | When |
|---|---|---|
| Web app (Hosting) | GitHub Actions `firebase-hosting-merge.yml` (build + deploy) | automatically on every push to `main` |
| PR previews | `firebase-hosting-pull-request.yml` | every pull request from this repo |
| Cloud Functions, Firestore rules & indexes, Storage rules | `npm run deploy:backend` from a signed-in machine | whenever `functions/` or `firebase/` change — **before** merging web changes that depend on them |

The GitHub deploy key (secret `FIREBASE_SERVICE_ACCOUNT_STORIES_BY_CROSSMAZE`) only has Hosting permissions, so the
backend is deployed by the owner. To automate it later, grant that service account *Cloud Functions Admin*, *Service
Account User*, *Firebase Rules Admin* and *Cloud Datastore Index Admin*, then add `firebase deploy --only
functions,firestore` to the merge workflow.

## Deploying the backend

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

The first deploy enables the Cloud Functions, Cloud Build, Artifact Registry and Cloud Run APIs (a few minutes).
Scheduled functions (Phase 1: subscription expiry hourly, reservation holds every 15 minutes) also enable Cloud
Scheduler. The backend deploys as **8 services** (6 routers + 2 jobs, `maxInstances: 5` each) to stay inside the
project's Cloud Run CPU quota — don't split actions back into separate exported functions. When a deploy removes
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

1. **TTL for idempotency records:** Firestore → TTL policies → Create → collection group `idempotency`, field
   `expireAt`.
2. **Claim Super Admin:** sign in to the site as `learn@crossmaze.in` (email verified), open `/setup`, click
   *Become Super Admin*. This works once; afterwards grant roles from *Staff & roles*.
3. **App Check (before launch):** register the web app with reCAPTCHA Enterprise, put the site key in
   `apps/web/.env.production`, then set `ENFORCE_APP_CHECK=true` in `functions/.env` and redeploy.

## Backups

Enable Firestore **point-in-time recovery** (Firestore → Disaster recovery) before real member data is entered.
Scheduled exports are a later hardening step.
