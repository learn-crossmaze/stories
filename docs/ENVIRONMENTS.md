# Stories — Firebase & GitHub Setup

Two services, nothing in between:

- **GitHub** holds the code and runs CI.
- **Firebase** (one project) hosts the web app and provides Auth and Firestore.

| Where | Firebase project | Config |
|---|---|---|
| Your laptop | `demo-stories` (Emulator Suite only; `demo-` IDs never touch the cloud) | `apps/web/.env.emulator` |
| Live site | your project, e.g. `stories-crossmaze` | `apps/web/.env.production` (written by `provision.mjs`) |

## 1. Local development (no cloud access needed)

```bash
npm ci
npm run emulators      # Auth :9099, Firestore :8080, Storage :9199, UI :4000 (needs Java 21)
npm run dev            # app on http://localhost:8081 against the emulators
npm run test:web       # app tests
npm run test:rules     # Security Rules tests
```

## 2. Create the Firebase project (once)

Firebase project IDs are globally unique and permanent; pick it deliberately. The owner account is
`learn@crossmaze.in`.

Run these from the repository folder (not your home or System32 folder), after `npm ci`:

```bash
npx firebase login --reauth
node tools/firebase/provision.mjs --project stories-crossmaze
```

If login fails with "Unable to authenticate using the provided code", run `npx firebase logout`, then
`npx firebase login` again and finish the browser sign-in within a few minutes.

`provision.mjs` is idempotent. It creates the project, registers the **Stories Web** app, writes its public config to
`apps/web/.env.production`, sets the project as the default in `.firebaserc`, creates Firestore in **asia-south1**
(delete protection on), enables **email/password** sign-in, deploys Firestore rules + indexes, and publishes the site
to `https://<project>.web.app`. Commit the two changed files.

## 3. Deploy from GitHub (once)

```bash
npx firebase init hosting:github
```

Answers: repository `learn-crossmaze/stories`; run a build script → **Yes**, `npm ci && npm run build`; deploy on
merge → **Yes**, branch `main`. This stores a deploy key as a GitHub secret and writes the workflows to
`.github/workflows/`. Commit them. It also writes a pull-request preview workflow; delete
`firebase-hosting-pull-request.yml` if you don't want preview links on PRs.

From then on: **merge to `main` → site is live.** Hosting deploys from GitHub; Security Rules and indexes are
deployed with `npx firebase deploy --only firestore` when they change (or `npm run deploy` for everything).

In GitHub → Settings → Branches, make `main` the default branch and protect it (require PRs and the CI checks).

## 4. Console-only steps (owner)

| Step | Where | When |
|---|---|---|
| Enable **Google** sign-in | Authentication → Sign-in method | Now (creates the OAuth client) |
| Custom domain | Hosting → Add custom domain; then Authentication → Settings → Authorized domains | When the domain is decided |
| Upgrade to **Blaze** + budget alert | Usage and billing | Before Cloud Functions / Storage |
| **App Check** (reCAPTCHA Enterprise) | App Check → Apps | Before launch; put the site key in `VITE_APP_CHECK_RECAPTCHA_ENTERPRISE_KEY` |

## 5. Configuration & secrets policy

- `apps/web/.env.*` hold only the **public** Firebase web config. Everything prefixed `VITE_` ends up in the browser
  bundle, so nothing secret may go there. They are committed.
- The only secret is the deploy key GitHub stores for you in step 3. Never commit service-account keys, App Check
  debug tokens, payment keys or SMTP credentials.
- Restrict the web API key in Google Cloud Console → APIs & Services → Credentials to the Firebase APIs and your
  site's domains.
