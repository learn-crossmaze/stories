# Stories web app

Vite + React + TypeScript, Firebase JS SDK. Served by Firebase Hosting from `dist/`.

```bash
npm run emulators          # repo root, terminal 1
npm run dev                # repo root, terminal 2 → http://localhost:8081
npm run test:web           # unit + component tests
```

## Configuration

Each environment is a Vite mode with its own `.env.<mode>` file:

| File | Used by | Committed |
|---|---|---|
| `.env.emulator` | `npm run dev` (Emulator Suite, `demo-stories`) | yes |
| `.env.dev`, `.env.staging`, `.env.prod` | `vite build --mode <env>`, written by `tools/firebase/provision.mjs` | yes (public web config only) |

Firebase **web** config values identify the project and are not secrets: access is controlled by Security Rules,
App Check and API-key restrictions. **Never** put service-account keys, App Check debug tokens or payment keys in
these files. Everything prefixed `VITE_` is embedded in the public bundle.

Keys read by `src/config/env.ts`: `VITE_STORIES_FLAVOR`, `VITE_USE_EMULATORS`, `VITE_EMULATOR_HOST`,
`VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_APP_ID`, `VITE_FIREBASE_MESSAGING_SENDER_ID`,
`VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MEASUREMENT_ID`,
`VITE_APP_CHECK_RECAPTCHA_ENTERPRISE_KEY`.
