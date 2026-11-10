# Stories — Firebase & GitHub Setup

Two services, nothing in between:

- **GitHub** holds the code and runs CI.
- **Firebase** (one project) hosts the web app and provides Auth and Firestore.

| Where | Firebase project | Config |
|---|---|---|
| Your laptop | `demo-stories` (Emulator Suite only; `demo-` IDs never touch the cloud) | `apps/web/.env.emulator` |
| Live site | `stories-for-all` (alias of the permanent project ID `stories-by-crossmaze`) | `apps/web/.env.production` (written by `provision.mjs`) |

## 1. Local development (no cloud access needed)

```bash
npm ci && npm --prefix functions ci
npm run emulators      # builds functions; Auth :9099, Firestore :8080, Functions :5001, Storage :9199, UI :4000 (Java 21)
npm run seed           # demo data: orgs, branches, 10 personas (password stories-demo), 36 books, 84 copies, plans, members — emulator only
npm run dev            # app on http://localhost:8081 against the emulators
```

Demo personas: `super@`, `ho@`, `finance@`, `hr@`, `manager@`, `librarian@`, `delivery@`, `employee@`,
`franchise@`, `member@` — all `@stories.test`. The seed script forces the emulator hosts and the `demo-stories`
project, so it cannot touch the live project. Tests: see [TESTING.md](TESTING.md).

## 2. Create the Firebase project (once)

Firebase project IDs are globally unique and permanent; pick it deliberately. The owner account is
`learn@crossmaze.in`.

Run these from the repository folder (not your home or System32 folder), after `npm ci`:

```bash
npx firebase login --reauth
node tools/firebase/provision.mjs --project stories-by-crossmaze
```

If login fails with "Unable to authenticate using the provided code", run `npx firebase logout`, then
`npx firebase login` again and finish the browser sign-in within a few minutes.

`provision.mjs` is idempotent. It creates the project, registers the **Stories Web** app, writes its public config to
`apps/web/.env.production`, sets the project as the default in `.firebaserc`, creates Firestore in **asia-south1**
(delete protection on), enables **email/password** sign-in, deploys Firestore rules + indexes, and publishes the site
to `https://<project>.web.app`. Commit the two changed files.

## 3. Deploy from GitHub (done)

Backend deploys (functions, rules, indexes): see [DEPLOYMENT.md](DEPLOYMENT.md).


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
| **Zoho Mail sign-in** for staff (OpenID Connect) | Authentication → Identity Platform, Sign-in method | When staff mailboxes exist; see §6 |

## 5. Configuration & secrets policy

- `apps/web/.env.*` hold only the **public** Firebase web config. Everything prefixed `VITE_` ends up in the browser
  bundle, so nothing secret may go there. They are committed.
- The only secret is the deploy key GitHub stores for you in step 3. Never commit service-account keys, App Check
  debug tokens, payment keys or SMTP credentials.
- Restrict the web API key in Google Cloud Console → APIs & Services → Credentials to the Firebase APIs and your
  site's domains.

## 6. Staff sign-in with Zoho Mail (single sign-on)

Staff with a Zoho Mail mailbox (e.g. `name@storiesforall.in`) can sign in with **Continue with Zoho Mail** instead
of a separate Stories password. Zoho is added to Firebase Authentication as an OpenID Connect provider with the id
`oidc.zoho`. Access still comes only from roles: a Zoho sign-in alone gives no staff access until someone grants
roles to that email in **Staff & roles**. Members keep signing in with email/password or Google.

**Cost:** Firebase charges nothing for the first 49 monthly users of OpenID Connect providers, then about $0.015
per monthly user (Identity Platform pricing). Zoho charges nothing for the sign-in itself.

Set up once (owner):

1. **Zoho API Console** (<https://api-console.zoho.in>, signed in as the Zoho Mail admin) → *Add Client* →
   *Server-based Applications*:
   - Client name: `Stories`; Homepage URL: `https://storiesforall.in`
   - Authorized redirect URIs: `https://app.storiesforall.in/__/auth/handler` and, until §7 step 3 is done,
     `https://stories-by-crossmaze.firebaseapp.com/__/auth/handler`.
   - Create, then copy the **Client ID** and **Client Secret**.
2. **Firebase console** → Authentication → Settings → **Upgrade to Firebase Authentication with Identity Platform**
   (needs the Blaze plan, which the project already has; existing users and sign-in methods are unchanged).
3. Authentication → Sign-in method → *Add new provider* → **OpenID Connect**:
   - Grant type: **Code flow**
   - Name: `zoho` (the provider id must become exactly `oidc.zoho`)
   - Client ID and Client secret from step 1
   - Issuer (URL): `https://accounts.zoho.in` (Zoho's India data centre; if your Zoho account was created on another
     data centre, use that one, e.g. `https://accounts.zoho.com`)
4. Authentication → Settings → **Authorized domains**: add `app.storiesforall.in` once the app is served there.
5. Set `VITE_ZOHO_SIGN_IN=true` in `apps/web/.env.production` and merge: the button appears after the deploy.

**People who already have a Stories account** with the same email (password or Google): their first *Continue with
Zoho Mail* is refused with a message asking them to sign in once the usual way; that sign-in links Zoho to their
account, and from then on either way works. Use the same email in Staff & roles as the Zoho mailbox.

Locally, `.env.emulator` switches the button on and the Auth emulator shows a fake sign-in screen for `oidc.zoho`.

## 7. Name and addresses: stories-for-all and storiesforall.in

A Firebase project ID can never change, so the live project keeps the ID `stories-by-crossmaze`. Everything people
see uses the new name instead:

| Where | Name |
|---|---|
| CLI and workflows | `--project stories-for-all` (alias in `.firebaserc`) |
| Function settings | `functions/.env` (committed, non-secret); private ones in `functions/.env.stories-for-all` (git-ignored; the CLI loads `.env.<alias>`) |
| App (members and staff) | `https://app.storiesforall.in` (custom domain on Hosting site `stories-by-crossmaze`) |
| Public website | `https://storiesforall.in` and `www` (Hosting site `storiesforall-website`; docs/SITE.md) |
| Sign-in windows, password-reset links | `app.storiesforall.in` (after step 3) |
| Firebase console, Google sign-in consent screen | "Stories for All" (display names) |

The old ID stays only where Google needs the real one: `VITE_FIREBASE_PROJECT_ID`, the storage bucket
(`stories-by-crossmaze.firebasestorage.app`), service-account emails, Cloud Functions URLs (the Razorpay, WhatsApp and
courier webhooks keep working unchanged) and the `projectId` of the Hosting deploy action.

One-time steps (owner), in this order:

1. **Private function settings (only if you have them):** if you kept a local `functions/.env.stories-by-crossmaze`
   (e.g. with a Google Books key), rename it to `functions/.env.stories-for-all`; the CLI refuses to deploy while
   both exist. Non-secret settings stay in the committed `functions/.env`.
2. **App domain:** Firebase console → Hosting → the **stories-by-crossmaze** site → *Add custom domain* →
   `app.storiesforall.in`. Add the DNS record it shows at your registrar (host `app`), next to Zoho's mail records,
   and wait until Hosting says *Connected* (SSL can take up to a day). Then Authentication → Settings →
   **Authorized domains** → add `app.storiesforall.in`. The bare `storiesforall.in` and `www` go to the public
   website (docs/SITE.md).
3. **Sign-in on your own domain:** Google Cloud console → APIs & Services → Credentials → the *Web client (auto created
   by Google Service)* → add the authorized redirect URI `https://app.storiesforall.in/__/auth/handler`. Then set
   `VITE_FIREBASE_AUTH_DOMAIN=app.storiesforall.in` in `apps/web/.env.production` and merge. Don't do this before step 2
   is *Connected*: until then Google sign-in would fail.
4. **Names people see:** Firebase console → Project settings → *Project name* → `Stories for All`. Google Cloud
   console → APIs & Services → OAuth consent screen → *App name* `Stories for All`, home page
   `https://storiesforall.in`, authorized domain `storiesforall.in` (covers `app.`).
5. **Emails:** Authentication → Templates → sender name `Stories for All`; *Customize domain* → `storiesforall.in`
   (adds DNS records); *Customize action URL* → `https://app.storiesforall.in/__/auth/action`.
6. **Payments and messages (optional):** the Razorpay, Meta and Porter webhook URLs don't change. Update only the
   business name and website shown to customers in the Razorpay dashboard and the WhatsApp Business profile.
