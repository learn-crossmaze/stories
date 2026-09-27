# Stories — Environments & Firebase Setup

## 1. Environments

| Environment | Firebase project | App config | Deploys from | Data |
|---|---|---|---|---|
| Local | `demo-stories` (Emulator Suite only; the `demo-` prefix guarantees no cloud project is touched) | `config/emulator.json` | — | throwaway |
| Development | `stories-crossmaze-dev` *(proposed ID)* | `config/dev.json` | `develop` | seed/demo |
| Staging | `stories-crossmaze-staging` *(proposed)* | `config/staging.json` | `release/*` | anonymized/seed |
| Production | `stories-crossmaze-prod` *(proposed)* | `config/prod.json` | tagged `main`, manual approval | real |

Firebase project IDs are globally unique and permanent; `stories-dev` is almost certainly taken, hence the
`stories-crossmaze-*` proposal. The owner account is `learn@crossmaze.in`.

## 2. Local development (no cloud access needed)

```bash
npm ci                                  # Firebase CLI, rules-test tooling
flutter pub get                         # Dart workspace
npm run emulators                       # Auth :9099, Firestore :8080, Storage :9199, Hosting :5000, UI :4000
npm run web:emulator                    # app on http://localhost:8081 against the emulators
npm run test:rules                      # Security Rules tests
(cd apps/stories_app && flutter test)   # unit + widget tests
```

## 3. Provisioning a cloud environment

The Firebase CLI must be signed in as the project owner. In a cloud session the network policy must allow
`auth.firebase.tools`, `firebase-public.firebaseio.com`, `*.firebaseio.com` and `firebase.google.com` (Google API
hosts `*.googleapis.com` are already reachable).

```bash
npx firebase login --no-localhost       # open the printed link, sign in, paste the code back
node tools/firebase/provision.mjs --env dev --project stories-crossmaze-dev
```

`provision.mjs` is idempotent. It:

1. Creates the GCP/Firebase project if it doesn't exist.
2. Registers the **Stories Web** app and writes its SDK config to `apps/stories_app/config/dev.json`.
3. Adds the `dev` alias to `.firebaserc`.
4. Creates the default Firestore database in **asia-south1** (delete protection on in prod).
5. Enables Firebase Authentication with **email/password**.
6. Deploys Firestore rules + indexes, builds the Flutter web app and deploys it to Hosting
   (`https://<project>.web.app`).

### Steps that stay in the console (owner only)

| Step | Where | Why manual |
|---|---|---|
| Enable **Google** sign-in | Authentication → Sign-in method | Creates the OAuth client + consent screen |
| Enable **Phone** sign-in (Phase 2) | Authentication → Sign-in method | Needs SMS region policy + billing |
| Upgrade to **Blaze** | Project settings → Usage and billing | Needs a payment method; required for Cloud Functions, Storage buckets, PITR |
| Budget alerts | Google Cloud Billing → Budgets | Cost guardrail (recommend alerts at ₹1k/₹5k for dev) |
| **App Check** (reCAPTCHA Enterprise) | App Check → Apps | Register web app; put the site key in `config/<env>.json`; enforce after monitoring |
| Authorized domains for custom domains | Authentication → Settings | When `app.` / `admin.` domains are decided |

## 4. Configuration & secrets policy

- `config/*.json` hold only the **public** Firebase web config (identifies the project; protected by rules, App
  Check and API-key restrictions). They are committed.
- Never commit service-account keys, App Check debug tokens, payment keys or SMTP credentials. Server secrets go to
  **Secret Manager** (Cloud Functions `defineSecret`); CI uses **Workload Identity Federation**, not JSON keys.
- Web API keys are restricted in Google Cloud Console → APIs & Services → Credentials to the Firebase APIs and the
  environment's HTTP referrers.

## 5. Web build note

FlutterFire web loads the Firebase JS SDK from `www.gstatic.com` and CanvasKit from Google's CDN at runtime. Production
browsers reach these normally. For offline/sandboxed builds use `flutter build web --no-web-resources-cdn`.
