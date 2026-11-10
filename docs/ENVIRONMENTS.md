# Stories — Firebase & GitHub Setup

Two services, nothing in between:

- **GitHub** holds the code and runs CI.
- **Firebase** (one project) hosts the web app and provides Auth and Firestore.

| Where | Firebase project | Config |
|---|---|---|
| Your laptop | `demo-stories` (Emulator Suite only; `demo-` IDs never touch the cloud) | `apps/web/.env.emulator` |
| Live site | `stories-by-crossmaze` | `apps/web/.env.production` (written by `provision.mjs`) |

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
   - Authorized redirect URI: `https://stories-by-crossmaze.firebaseapp.com/__/auth/handler`
     (add `https://storiesforall.in/__/auth/handler` too if the site's auth domain moves to the custom domain).
   - Create, then copy the **Client ID** and **Client Secret**.
2. **Firebase console** → Authentication → Settings → **Upgrade to Firebase Authentication with Identity Platform**
   (needs the Blaze plan, which the project already has; existing users and sign-in methods are unchanged).
3. Authentication → Sign-in method → *Add new provider* → **OpenID Connect**:
   - Grant type: **Code flow**
   - Name: `zoho` (the provider id must become exactly `oidc.zoho`)
   - Client ID and Client secret from step 1
   - Issuer (URL): `https://accounts.zoho.in` (Zoho's India data centre; if your Zoho account was created on another
     data centre, use that one, e.g. `https://accounts.zoho.com`)
4. Authentication → Settings → **Authorized domains**: add `storiesforall.in` once the site is served there.
5. Set `VITE_ZOHO_SIGN_IN=true` in `apps/web/.env.production` and merge: the button appears after the deploy.

**People who already have a Stories account** with the same email (password or Google): their first *Continue with
Zoho Mail* is refused with a message asking them to sign in once the usual way; that sign-in links Zoho to their
account, and from then on either way works. Use the same email in Staff & roles as the Zoho mailbox.

Locally, `.env.emulator` switches the button on and the Auth emulator shows a fake sign-in screen for `oidc.zoho`.
