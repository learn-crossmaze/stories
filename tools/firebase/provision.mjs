#!/usr/bin/env node
// Creates (or re-verifies) the Stories Firebase project and publishes the web
// app to it. Idempotent: every step checks current state and skips work done.
//
//   node tools/firebase/provision.mjs --project stories-by-crossmaze
//
// Requires an authenticated Firebase CLI (`npx firebase login --no-localhost`)
// or FIREBASE_TOKEN / GOOGLE_APPLICATION_CREDENTIALS in CI.
// See docs/ENVIRONMENTS.md for what this does and what stays manual.

import { execSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, arg, i, all) => {
    if (arg.startsWith('--')) pairs.push([arg.slice(2), all[i + 1]]);
    return pairs;
  }, []),
);

const PROJECT = args.project;
const LOCATION = args.location ?? 'asia-south1';
const DISPLAY = 'Stories';

if (!PROJECT) {
  console.error('Usage: provision.mjs --project <firebase-project-id> [--location asia-south1]');
  process.exit(2);
}

const root = fileURLToPath(new URL('../../', import.meta.url));
// Run the repo's firebase-tools through node itself: no npx/.cmd shims, so
// this works the same on Windows, macOS and Linux.
const firebaseCli = createRequire(import.meta.url).resolve('firebase-tools/lib/bin/firebase.js');

function firebase(...cmd) {
  const run = spawnSync(process.execPath, [firebaseCli, ...cmd, '--json', '--non-interactive'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
  });
  // Trust the CLI's JSON verdict, not its exit code: on Windows with Node 24
  // firebase-tools can crash while exiting (libuv "UV_HANDLE_CLOSING"
  // assertion) after printing a successful result.
  let parsed;
  try {
    parsed = JSON.parse(run.stdout.slice(run.stdout.indexOf('{')));
  } catch {
    throw new Error(`firebase ${cmd.join(' ')} failed (exit ${run.status}):\n${run.stderr || run.stdout}`);
  }
  if (parsed.status !== 'success') throw new Error(`firebase ${cmd.join(' ')}: ${parsed.error}`);
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
const configPath = join(root, 'apps/web/.env.production');
const previousKey =
  (existsSync(configPath) ? readFileSync(configPath, 'utf8') : '').match(
    /^VITE_APP_CHECK_RECAPTCHA_ENTERPRISE_KEY=(.*)$/m,
  )?.[1] ?? '';
const lines = {
  VITE_STORIES_FLAVOR: 'prod',
  VITE_FIREBASE_PROJECT_ID: sdk.projectId,
  VITE_FIREBASE_API_KEY: sdk.apiKey,
  VITE_FIREBASE_APP_ID: sdk.appId,
  VITE_FIREBASE_MESSAGING_SENDER_ID: sdk.messagingSenderId,
  VITE_FIREBASE_AUTH_DOMAIN: sdk.authDomain,
  VITE_FIREBASE_STORAGE_BUCKET: sdk.storageBucket ?? '',
  VITE_FIREBASE_MEASUREMENT_ID: sdk.measurementId ?? '',
  VITE_APP_CHECK_RECAPTCHA_ENTERPRISE_KEY: previousKey,
};
writeFileSync(
  configPath,
  '# Public Firebase web config, written by tools/firebase/provision.mjs. Not secret.\n' +
    Object.entries(lines).map(([k, v]) => `${k}=${v}`).join('\n') +
    '\n',
);
console.log('  wrote apps/web/.env.production');

// 3. .firebaserc default project ----------------------------------------------
step('Default project in .firebaserc');
const rcPath = join(root, '.firebaserc');
const rc = JSON.parse(readFileSync(rcPath, 'utf8'));
rc.projects.default = PROJECT;
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
    '--delete-protection', 'ENABLED',
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
execSync('npm run build', { cwd: root, stdio: 'inherit' });
firebase('deploy', '--only', 'hosting', '--project', PROJECT);
console.log(`  live at https://${PROJECT}.web.app`);

console.log(`
Remaining console-only steps for ${PROJECT} (see docs/ENVIRONMENTS.md):
  • Authentication → Sign-in method → Google: enable (creates the OAuth client)
  • Upgrade to Blaze before Cloud Functions / Storage
  • Deploys from GitHub: npx firebase init hosting:github
  • App Check → register web app with reCAPTCHA Enterprise, then set
    VITE_APP_CHECK_RECAPTCHA_ENTERPRISE_KEY in apps/web/.env.production`);
