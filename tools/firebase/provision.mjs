#!/usr/bin/env node
// Provisions (or re-verifies) a Stories Firebase environment. Idempotent:
// every step checks current state first and skips work already done.
//
//   node tools/firebase/provision.mjs --env dev --project stories-crossmaze-dev
//
// Requires an authenticated Firebase CLI (`npx firebase login --no-localhost`)
// or FIREBASE_TOKEN / GOOGLE_APPLICATION_CREDENTIALS in CI.
// See docs/ENVIRONMENTS.md for what this does and what stays manual.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, arg, i, all) => {
    if (arg.startsWith('--')) pairs.push([arg.slice(2), all[i + 1]]);
    return pairs;
  }, []),
);

const ENV = args.env;
const PROJECT = args.project;
const LOCATION = args.location ?? 'asia-south1';
const DISPLAY = { dev: 'Stories Dev', staging: 'Stories Staging', prod: 'Stories' }[ENV];

if (!DISPLAY || !PROJECT) {
  console.error('Usage: provision.mjs --env dev|staging|prod --project <gcp-project-id> [--location asia-south1]');
  process.exit(2);
}

const root = new URL('../../', import.meta.url).pathname;

function firebase(...cmd) {
  const out = execFileSync('npx', ['firebase', ...cmd, '--json', '--non-interactive'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const parsed = JSON.parse(out.slice(out.indexOf('{')));
  if (parsed.status !== 'success') throw new Error(`${cmd.join(' ')}: ${parsed.error}`);
  return parsed.result;
}

function step(name) {
  console.log(`\n▸ ${name}`);
}

function accessToken() {
  if (process.env.FIREBASE_ACCESS_TOKEN) return process.env.FIREBASE_ACCESS_TOKEN;
  const store = join(homedir(), '.config/configstore/firebase-tools.json');
  const token = JSON.parse(readFileSync(store, 'utf8'))?.tokens?.access_token;
  if (!token) throw new Error('No Firebase CLI access token; run `npx firebase login --no-localhost`.');
  return token;
}

async function google(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken()}`,
      'x-goog-user-project': PROJECT,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${url} → ${res.status} ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : {};
}

// 1. Project -----------------------------------------------------------------
step(`Project ${PROJECT}`);
const projects = firebase('projects:list');
if (projects.some((p) => p.projectId === PROJECT)) {
  console.log('  exists');
} else {
  firebase('projects:create', PROJECT, '--display-name', DISPLAY);
  console.log('  created');
}

// 2. Web app + SDK config ------------------------------------------------------
step('Web app');
let webApp = firebase('apps:list', 'WEB', '--project', PROJECT).find(
  (a) => a.displayName === 'Stories Web',
);
if (!webApp) {
  webApp = firebase('apps:create', 'WEB', 'Stories Web', '--project', PROJECT);
  console.log(`  created ${webApp.appId}`);
} else {
  console.log(`  exists ${webApp.appId}`);
}
const sdk = firebase('apps:sdkconfig', 'WEB', webApp.appId, '--project', PROJECT).sdkConfig;
const configPath = join(root, `apps/stories_app/config/${ENV}.json`);
const previous = existsSync(configPath) ? JSON.parse(readFileSync(configPath, 'utf8')) : {};
writeFileSync(
  configPath,
  JSON.stringify(
    {
      STORIES_FLAVOR: ENV,
      USE_EMULATORS: false,
      FIREBASE_PROJECT_ID: sdk.projectId,
      FIREBASE_API_KEY: sdk.apiKey,
      FIREBASE_APP_ID: sdk.appId,
      FIREBASE_MESSAGING_SENDER_ID: sdk.messagingSenderId,
      FIREBASE_AUTH_DOMAIN: sdk.authDomain,
      FIREBASE_STORAGE_BUCKET: sdk.storageBucket ?? '',
      FIREBASE_MEASUREMENT_ID: sdk.measurementId ?? '',
      APP_CHECK_RECAPTCHA_ENTERPRISE_KEY: previous.APP_CHECK_RECAPTCHA_ENTERPRISE_KEY ?? '',
    },
    null,
    2,
  ) + '\n',
);
console.log(`  wrote apps/stories_app/config/${ENV}.json`);

// 3. .firebaserc alias -------------------------------------------------------
step(`Alias "${ENV}"`);
const rcPath = join(root, '.firebaserc');
const rc = JSON.parse(readFileSync(rcPath, 'utf8'));
rc.projects[ENV] = PROJECT;
writeFileSync(rcPath, JSON.stringify(rc, null, 2) + '\n');
console.log('  updated .firebaserc');

// 4. Firestore -----------------------------------------------------------------
step(`Firestore (default) in ${LOCATION}`);
const dbs = firebase('firestore:databases:list', '--project', PROJECT);
if ((dbs ?? []).some((d) => d.name?.endsWith('/databases/(default)'))) {
  console.log('  exists');
} else {
  firebase(
    'firestore:databases:create', '(default)',
    '--location', LOCATION,
    '--delete-protection', ENV === 'prod' ? 'ENABLED' : 'DISABLED',
    '--project', PROJECT,
  );
  console.log('  created');
}

// 5. Authentication: email/password -------------------------------------------
step('Authentication (email/password)');
await google(
  'POST',
  `https://serviceusage.googleapis.com/v1/projects/${PROJECT}/services/identitytoolkit.googleapis.com:enable`,
  {},
);
await google(
  'PATCH',
  `https://identitytoolkit.googleapis.com/admin/v2/projects/${PROJECT}/config` +
    '?updateMask=signIn.email.enabled,signIn.email.passwordRequired',
  { signIn: { email: { enabled: true, passwordRequired: true } } },
);
console.log('  email/password enabled');

// 6. Rules, indexes, hosting ---------------------------------------------------
step('Deploy Firestore rules + indexes');
firebase('deploy', '--only', 'firestore:rules,firestore:indexes', '--project', PROJECT);
console.log('  deployed');

step('Build + deploy web app to Hosting');
execFileSync(
  'flutter',
  ['build', 'web', '--release', `--dart-define-from-file=config/${ENV}.json`],
  { cwd: join(root, 'apps/stories_app'), stdio: 'inherit' },
);
firebase('deploy', '--only', 'hosting', '--project', PROJECT);
console.log(`  live at https://${PROJECT}.web.app`);

console.log(`
Remaining console-only steps for ${PROJECT} (see docs/ENVIRONMENTS.md):
  • Authentication → Sign-in method → Google: enable (creates the OAuth client)
  • Upgrade to Blaze before Cloud Functions / Storage
  • App Check → register web app with reCAPTCHA Enterprise, then set
    APP_CHECK_RECAPTCHA_ENTERPRISE_KEY in apps/stories_app/config/${ENV}.json`);
