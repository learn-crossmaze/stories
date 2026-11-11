#!/usr/bin/env node
// What you run on your computer: `npm run publish:all`. The same routine as the crossmaze-website project:
//
//   1. Gets the latest code (git pull), refusing a copy with local edits, so you publish exactly what is on GitHub.
//   2. Installs what the lockfiles say (npm ci, for the apps and the functions).
//   3. Signs in to Firebase if this computer isn't yet.
//   4. Deploys the backend: Cloud Functions, Firestore rules and indexes, Storage rules.
//
// The staff app and the website are not built or deployed here: GitHub tests and deploys them by itself after
// every merge to main (.github/workflows/deploy.yml; the website once the DEPLOY_SITE variable is true), as
// crossmaze.in does. Tests run on GitHub too, so none run on this computer.
//
// Options (after `--`, e.g. `npm run publish:all -- --dry-run`):
//   --dry-run       show the steps without doing them
//   --no-pull       deploy this copy as it is, without git pull
//   --no-install    skip npm ci (faster when nothing changed in package-lock.json)
// Works the same in PowerShell, cmd, macOS and Linux.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const PROJECT = 'stories-for-all';
const WEBSITE = 'https://storiesforall-website.web.app';

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const dryRun = flag('dry-run');
const unknown = args.filter((a) => !['--dry-run', '--no-pull', '--no-install'].includes(a));

const started = Date.now();
const colour = (code, s) => (process.stdout.isTTY ? `\x1b[${code}m${s}\x1b[0m` : s);
const step = (n, title) => console.log(`\n${colour('1;35', `▶ ${n}. ${title}`)}`);
function fail(message) {
  console.error(`\n${colour('1;31', '✖ Stopped:')} ${message}`);
  process.exit(1);
}
if (unknown.length) fail(`unknown option ${unknown.join(' ')} (use --dry-run, --no-pull or --no-install).`);

/** Runs a command in the repository, showing its output; stops if it fails. */
function run(command, { env = {}, what = command } = {}) {
  console.log(colour('2', `$ ${command}`));
  if (dryRun) return;
  const r = spawnSync(command, { cwd: root, shell: true, stdio: 'inherit', env: { ...process.env, ...env } });
  if (r.status !== 0) fail(`${what} failed.`);
}
const output = (command) => spawnSync(command, { cwd: root, shell: true, encoding: 'utf8' }).stdout?.trim() ?? '';

// ------------------------------------------------------------------ 1. latest code
step(1, 'Getting the latest code');
const [major] = process.versions.node.split('.').map(Number);
if (major < 22) fail(`Node.js ${process.versions.node} is too old: install Node.js 22 or newer (nodejs.org).`);
if (!flag('no-pull')) {
  const changed = output('git status --porcelain --untracked-files=no');
  if (changed) {
    fail(
      `this copy has local changes to files from GitHub:\n${changed}\n\n` +
        '  Deploy only what is on GitHub: undo them with  git checkout -- .  (or keep them aside with  git stash), then run again.',
    );
  }
  if (output('git rev-parse --abbrev-ref HEAD') !== 'main') run('git checkout main', { what: 'Switching to the main branch' });
  run('git pull --ff-only origin main', { what: 'Getting the latest code (git pull)' });
}
console.log(`Deploying ${output('git log -1 --format="%h %s"')}`);

// ------------------------------------------------------------------ 2. install
if (flag('no-install')) step(2, 'Installing: skipped (--no-install)');
else {
  step(2, 'Installing');
  run('npm ci --no-audit --no-fund', { what: 'Installing (npm ci)' });
  run('npm ci --prefix functions --no-audit --no-fund', { what: 'Installing the functions (npm ci)' });
}

// ------------------------------------------------------------------ 3. sign in
step(3, 'Firebase sign-in');
if (dryRun || /Logged in as/i.test(output('npx firebase login:list'))) console.log(dryRun ? '$ npx firebase login (only if not signed in)' : 'Signed in.');
else run('npx firebase login', { what: 'Firebase sign-in' });

// ------------------------------------------------------------------ 4. backend
step(4, 'Deploying the backend (functions, Firestore rules and indexes, Storage rules)');
// Loading the functions code can take longer than Firebase's default 10 seconds on Windows.
run(`npx firebase deploy --only firestore,functions,storage --project ${PROJECT}`, { env: { FUNCTIONS_DISCOVERY_TIMEOUT: '60' }, what: 'The backend deploy' });

if (dryRun) {
  console.log(`\n${colour('1;32', 'Dry run:')} nothing was installed or deployed.`);
  process.exit(0);
}
let live = '';
try {
  const res = await fetch(`${WEBSITE}/api/public`, { signal: AbortSignal.timeout(20000) });
  live = res.ok ? 'The website’s data answers.' : `The website’s data answered ${res.status}: open ${WEBSITE} to check.`;
} catch {
  live = `Couldn't reach ${WEBSITE} to check: open it in a browser.`;
}
const minutes = ((Date.now() - started) / 60000).toFixed(1);
console.log(`\n${colour('1;32', '✔ Backend deployed')} in ${minutes} minutes. ${live}`);
console.log('  The staff app and the website deploy from GitHub after each merge to main (Actions → Deploy).');
