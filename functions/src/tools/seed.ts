// Seeds the local Emulator Suite with demo data (docs/IMPLEMENTATION_PLAN.md M0.4).
//
//   npm run emulators   # terminal 1
//   npm run seed        # terminal 2
//
// Safety: this script *forces* the emulator hosts and the `demo-stories`
// project before Firebase is initialized, so it cannot reach a real project.
// Everything it writes is marked `seed: true`. Re-running is safe (idempotent).

process.env.GCLOUD_PROJECT = 'demo-stories';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '127.0.0.1:9099';
if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(process.env.FIRESTORE_EMULATOR_HOST) || !/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(process.env.FIREBASE_AUTH_EMULATOR_HOST)) {
  throw new Error('Refusing to seed: emulator hosts must be local.');
}

const { FieldValue } = await import('firebase-admin/firestore');
const { auth, db } = await import('../core/firebase.js');
const { syncClaims } = await import('../core/claims.js');
type Role = import('../generated/rbac.js').Role;

const PASSWORD = 'stories-demo';
const CORP = 'seed-corporate';
const FRAN = 'seed-franchise';
const CENTRAL = 'seed-central';
const DEMO_FRANCHISE = 'seed-demo-franchise';
const now = FieldValue.serverTimestamp();

const address = (line1: string, city: string, postalCode: string) => ({ line1, line2: '', city, state: 'Karnataka', postalCode });
const hours = ['TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'].map((day) => ({ day, open: '10:00', close: '20:00' }));

async function user(email: string, displayName: string, platformRoles: string[] = []) {
  let uid: string;
  try {
    uid = (await auth.getUserByEmail(email)).uid;
  } catch {
    uid = (await auth.createUser({ email, password: PASSWORD, displayName, emailVerified: true })).uid;
  }
  await db.doc(`users/${uid}`).set(
    { uid, email, displayName, status: 'ACTIVE', platformRoles, seed: true, createdAt: now, updatedAt: now },
    { merge: true },
  );
  return uid;
}

async function org(id: string, name: string, type: 'CORPORATE' | 'FRANCHISE') {
  await db.doc(`orgs/${id}`).set({ name, type, status: 'ACTIVE', seed: true, createdAt: now, updatedAt: now }, { merge: true });
}

async function branch(orgId: string, id: string, code: string, name: string, type: string, addr: ReturnType<typeof address>) {
  await db.doc(`orgs/${orgId}/branchCodes/${code}`).set({ branchId: id });
  await db.doc(`orgs/${orgId}/branches/${id}`).set(
    {
      orgId, code, name, type, address: addr, contact: { phone: '+91 80 4000 0000', email: '' },
      operatingHours: hours, weeklyOffs: ['MON'], timeZone: 'Asia/Kolkata', status: 'ACTIVE', seed: true, createdAt: now, updatedAt: now,
    },
    { merge: true },
  );
}

async function grant(uid: string, email: string, displayName: string, orgId: string, orgName: string, orgType: string, roles: Role[], branchIds: string[]) {
  await db.doc(`users/${uid}/memberships/${orgId}`).set({
    orgId, orgName, orgType, uid, email, displayName, roles, branchIds, status: 'ACTIVE', grantedBy: 'seed', seed: true, updatedAt: now,
  });
}

await org(CORP, 'Stories Corporate', 'CORPORATE');
await org(FRAN, 'Stories Franchise Demo', 'FRANCHISE');
await branch(CORP, CENTRAL, 'CEN', 'Stories Central', 'COMPANY_OWNED', address('12 MG Road', 'Bengaluru', '560001'));
await branch(FRAN, DEMO_FRANCHISE, 'DFR', 'Stories Demo Franchise', 'FRANCHISE', address('44 Indiranagar 100 Ft Road', 'Bengaluru', '560038'));
for (const [id, name] of [['seed-dept-circulation', 'Circulation'], ['seed-dept-delivery', 'Delivery'], ['seed-dept-admin', 'Administration']]) {
  await db.doc(`orgs/${CORP}/departments/${id}`).set({ orgId: CORP, name, branchId: null, status: 'ACTIVE', seed: true, createdAt: now, updatedAt: now });
}
await db.doc('platform/state').set({ superAdminBootstrapped: true, bootstrappedBy: 'seed' }, { merge: true });

// One persona per role (docs/RBAC.md §2). Member has no staff role.
const personas: [string, string, string | null, Role[], string[], string[]?][] = [
  ['super@stories.test', 'Sara Super', null, [], [], ['SUPER_ADMIN']],
  ['ho@stories.test', 'Hari Head Office', CORP, ['HEAD_OFFICE_ADMIN'], ['*']],
  ['finance@stories.test', 'Farah Finance', CORP, ['FINANCE_ADMIN'], ['*']],
  ['hr@stories.test', 'Hema HR', CORP, ['HR_ADMIN'], ['*']],
  ['manager@stories.test', 'Manoj Manager', CORP, ['BRANCH_MANAGER', 'EMPLOYEE'], [CENTRAL]],
  ['librarian@stories.test', 'Lata Librarian', CORP, ['LIBRARIAN', 'EMPLOYEE'], [CENTRAL]],
  ['delivery@stories.test', 'Dev Delivery', CORP, ['DELIVERY_PERSON', 'EMPLOYEE'], [CENTRAL]],
  ['employee@stories.test', 'Esha Employee', CORP, ['EMPLOYEE'], [CENTRAL]],
  ['franchise@stories.test', 'Farhan Franchise Owner', FRAN, ['FRANCHISE_OWNER'], ['*']],
  ['member@stories.test', 'Meera Member', null, [], []],
];

for (const [email, name, orgId, roles, branchIds, platformRoles] of personas) {
  const uid = await user(email, name, platformRoles ?? []);
  if (orgId) {
    const orgName = orgId === CORP ? 'Stories Corporate' : 'Stories Franchise Demo';
    await grant(uid, email, name, orgId, orgName, orgId === CORP ? 'CORPORATE' : 'FRANCHISE', roles, branchIds);
  }
  await syncClaims(uid);
  console.log(`  ${email.padEnd(26)} ${[...(platformRoles ?? []), ...roles].join(', ') || 'member'}`);
}

console.log(`\nSeeded 2 organizations, 2 branches, 3 departments, ${personas.length} users. Password for all: ${PASSWORD}`);
process.exit(0);
