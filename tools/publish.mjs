#!/usr/bin/env node
// Publishes everything from this computer, in the safe order: `npm run publish:all`.
//
//   1. Checks: Firebase sign-in, a clean copy on the main branch, then gets the latest code (git pull).
//   2. Installs exactly what the lockfiles say (npm ci, for the apps and the functions).
//   3. Quick checks: permissions files up to date, functions compile, website and app tests.
//   4. Builds the staff app, the website and the member area.
//   5. Deploys the backend (Cloud Functions, Firestore rules and indexes, Storage rules) first,
//   6. then both Hosting sites (the staff app and the website), which call that backend,
//   7. and finally checks that the live sites answer.
//
// Options (after `--`, e.g. `npm run publish:all -- --skip-tests`):
//   --skip-tests    skip step 3's tests (GitHub already ran them on main)
//   --no-pull       publish this copy as it is, without git pull
//   --no-install    skip npm ci (faster when nothing changed in package-lock.json)
//   --only=backend,app,site   deploy only some parts (default: all three)
//   --dry-run       show what it would do, without installing, building or deploying anything
// Works the same on Windows (PowerShell, cmd), macOS and Linux.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const PROJECT = 'stories-for-all';
const WEBSITE = 'https://storiesforall-website.web.app';
const APP = 'https://stories-by-crossmaze.web.app';

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const dryRun = flag('dry-run');
const only = (args.find((a) => a.startsWith('--only='))?.slice(7).split(',') ?? ['backend', 'app', 'site']).map((s) => s.trim());

const started = Date.now();
const done = [];
const colour = (code, s) => (process.stdout.isTTY ? `\x1b[${code}m${s}\x1b[0m` : s);
const step = (n, title) => console.log(`\n${colour('1;35', `▶ ${n}. ${title}`)}`);

function fail(message) {
  console.error(`\n${colour('1;31', '✖ Stopped:')} ${message}`);
  if (done.length) console.error(`  Already done: ${done.join(', ')}.`);
  process.exit(1);
}
for (const part of only) if (!['backend', 'app', 'site'].includes(part)) fail(`Unknown part "${part}" in --only (use backend, app, site).`);


/** Runs a command in the repository, showing its output; stops everything if it fails. */
function run(command, { env = {}, what = command, quiet = false } = {}) {
  console.log(colour('2', `$ ${command}`));
  if (dryRun) return '';
  const r = spawnSync(command, { cwd: root, shell: true, stdio: quiet ? 'pipe' : 'inherit', env: { ...process.env, ...env }, encoding: 'utf8' });
  if (r.status !== 0) fail(`${what} failed${quiet && r.stderr ? `:\n${r.stderr.trim()}` : ''}.`);
  return quiet ? `${r.stdout ?? ''}`.trim() : '';
}
const output = (command) => spawnSync(command, { cwd: root, shell: true, encoding: 'utf8' }).stdout?.trim() ?? '';

// ------------------------------------------------------------------ 1. checks and latest code
step(1, 'Checking this computer and getting the latest code');
const [major] = process.versions.node.split('.').map(Number);
if (major < 22) fail(`Node.js ${process.versions.node} is too old: install Node.js 22 or newer (nodejs.org).`);
if (!existsSync(`${root}/node_modules/.bin`)) console.log('First run: dependencies are installed in step 2.');

if (!flag('no-pull')) {
  const changed = output('git status --porcelain --untracked-files=no');
  if (changed) {
    fail(
      `this copy has local changes to files from GitHub:\n${changed}\n\n` +
        '  Publish only what is on GitHub: undo them with  git checkout -- .  (or keep them aside with  git stash), then run again.',
    );
  }
  const branch = output('git rev-parse --abbrev-ref HEAD');
  if (branch !== 'main') run('git checkout main', { what: 'Switching to the main branch' });
  run('git pull --ff-only origin main', { what: 'Getting the latest code (git pull)' });
}
console.log(`Publishing ${output('git log -1 --format="%h %s"')}`);

// ------------------------------------------------------------------ 2. install
if (!flag('no-install')) {
  step(2, 'Installing exactly what the lockfiles say');
  run('npm ci --no-audit --no-fund', { what: 'Installing the apps (npm ci)' });
  run('npm --prefix functions ci --no-audit --no-fund', { what: 'Installing the functions (npm ci)' });
} else step(2, 'Installing: skipped (--no-install)');

// Firebase sign-in (after install, so the project's own firebase-tools is used).
const login = dryRun ? 'Logged in as (dry run)' : output('npx firebase login:list');
if (!/Logged in as/i.test(login)) {
  console.log('Not signed in to Firebase on this computer: a browser window opens to sign in.');
  run('npx firebase login', { what: 'Firebase sign-in' });
}

// ------------------------------------------------------------------ 3. checks
step(3, 'Quick checks');
run('node tools/rbac/generate.mjs --check', { what: 'The permissions files are out of date (run npm run gen:rbac and commit). The check' });
if (only.includes('backend')) run('npm --prefix functions run build', { what: 'Compiling the functions' });
if (flag('skip-tests')) console.log('Tests skipped (--skip-tests).');
else {
  if (only.includes('site')) run('npm run test:site', { what: 'The website tests' });
  if (only.includes('app') || only.includes('site')) run('npm run test:web', { what: 'The staff app and member area tests' });
}

// ------------------------------------------------------------------ 4. build
step(4, 'Building');
if (only.includes('app')) run('npm run build', { what: 'Building the staff app' });
if (only.includes('site')) run('npm run build:site', { what: 'Building the website and member area' });

// ------------------------------------------------------------------ 5. backend
const firebase = (what) => `npx firebase deploy --only ${what} --project ${PROJECT}`;
if (only.includes('backend')) {
  step(5, 'Deploying the backend (functions, Firestore rules and indexes, Storage rules)');
  // A slow first load of the functions code on Windows needs more than Firebase's default 10 seconds.
  run(firebase('firestore,functions,storage'), { env: { FUNCTIONS_DISCOVERY_TIMEOUT: '60' }, what: 'The backend deploy' });
  done.push('backend');
} else step(5, 'Backend: not deployed (--only)');

// ------------------------------------------------------------------ 6. hosting
const targets = [only.includes('app') && 'hosting:app', only.includes('site') && 'hosting:site'].filter(Boolean);
if (targets.length) {
  step(6, `Deploying ${targets.map((t) => (t === 'hosting:app' ? 'the staff app' : 'the website')).join(' and ')}`);
  run(firebase(targets.join(',')), { what: 'The Hosting deploy' });
  done.push(...targets.map((t) => (t === 'hosting:app' ? 'staff app' : 'website')));
} else step(6, 'Hosting: not deployed (--only)');

// ------------------------------------------------------------------ 7. smoke checks
if (dryRun) {
  console.log(`\n${colour('1;32', 'Dry run:')} nothing was installed, built or deployed.`);
  process.exit(0);
}
step(7, 'Checking the live sites');
async function check(url, test, label) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20000), headers: { 'cache-control': 'no-cache' } });
    const body = await res.text();
    const ok = res.ok && test(body);
    console.log(`${ok ? colour('32', '✔') : colour('33', '!')} ${label}: ${res.status}${ok ? '' : ' (looks wrong: open it in a browser)'}`);
    return ok;
  } catch (e) {
    console.log(`${colour('33', '!')} ${label}: no answer (${e instanceof Error ? e.message : e})`);
    return false;
  }
}
const checks = [];
if (only.includes('site') || only.includes('backend')) {
  checks.push(check(`${WEBSITE}/api/public`, (b) => b.includes('"branches"'), 'Website data (/api/public)'));
  checks.push(check(`${WEBSITE}/blog`, (b) => b.includes('From the library'), 'Blog page (/blog)'));
}
if (only.includes('site')) checks.push(check(`${WEBSITE}/`, (b) => b.includes('Stories'), 'Website home'));
if (only.includes('app')) checks.push(check(`${APP}/`, (b) => b.includes('<div id="root"') || b.includes('Stories'), 'Staff app'));
const results = await Promise.all(checks);

const minutes = ((Date.now() - started) / 60000).toFixed(1);
console.log(`\n${colour('1;32', '✔ Published')} ${done.join(', ')} in ${minutes} minutes.`);
if (results.some((r) => !r)) console.log('  A check above looks wrong. Pages can take a minute to update; open them in a browser, and run again if needed.');
console.log(`  Website: ${WEBSITE}    Staff app: ${APP}`);
