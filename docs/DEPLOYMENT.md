# Stories — Deployment

One Firebase project, `stories-by-crossmaze` (Blaze), region `asia-south1`.

| What | How | When |
|---|---|---|
| Web app (Hosting) | GitHub Actions `firebase-hosting-merge.yml` (build + deploy) | automatically on every push to `main` |
| PR previews | `firebase-hosting-pull-request.yml` | every pull request from this repo |
| Cloud Functions, Firestore rules & indexes | `npm run deploy:backend` from a signed-in machine | whenever `functions/` or `firebase/` change — **before** merging web changes that depend on them |

The GitHub deploy key (secret `FIREBASE_SERVICE_ACCOUNT_STORIES_BY_CROSSMAZE`) only has Hosting permissions, so the
backend is deployed by the owner. To automate it later, grant that service account *Cloud Functions Admin*, *Service
Account User*, *Firebase Rules Admin* and *Cloud Datastore Index Admin*, then add `firebase deploy --only
functions,firestore` to the merge workflow.

## Deploying the backend

```bash
git pull
npm ci && npm --prefix functions ci
npx firebase login
npm run deploy:backend
```

The first deploy enables the Cloud Functions, Cloud Build, Artifact Registry and Cloud Run APIs (a few minutes).

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
