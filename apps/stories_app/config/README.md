# App configuration

Each file is passed to Flutter with `--dart-define-from-file`:

| File | Target | Committed |
|---|---|---|
| `emulator.json` | Local Firebase Emulator Suite (`demo-stories`, no cloud project touched) | yes |
| `dev.json` | Firebase project for development | yes, once the project exists |
| `staging.json`, `prod.json` | Staging / production | yes (web config only) |

Firebase **web** config values (API key, app ID, project ID) identify the project and are not secrets: access is
controlled by Security Rules, App Check and API-key restrictions. **Never** put service-account keys, App Check debug
tokens or payment keys in these files.

Keys read by `lib/app/config/env.dart`:
`STORIES_FLAVOR`, `USE_EMULATORS`, `EMULATOR_HOST`, `FIREBASE_PROJECT_ID`, `FIREBASE_API_KEY`, `FIREBASE_APP_ID`,
`FIREBASE_MESSAGING_SENDER_ID`, `FIREBASE_AUTH_DOMAIN`, `FIREBASE_STORAGE_BUCKET`, `FIREBASE_MEASUREMENT_ID`,
`APP_CHECK_RECAPTCHA_ENTERPRISE_KEY`.
