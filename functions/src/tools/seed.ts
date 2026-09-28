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
  ['catalogue@stories.test', 'Chitra Catalogue', CORP, ['CATALOGUE_MANAGER'], ['*']],
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

await seedLibrary();
process.exit(0);

// ---------------------------------------------------------------------------
// Phase 1 library demo data. Created through the real commands (in-process,
// as the Super Admin) so it obeys every validation and business rule.
// Runs once: guarded by seed/phase1.

async function seedLibrary() {
  if ((await db.doc('seed/phase1').get()).exists) {
    console.log('Library demo data already present (seed/phase1).');
    return;
  }
  const { randomUUID } = await import('node:crypto');
  const catalog = await import('../catalog/catalog.js');
  const copies = await import('../inventory/copies.js');
  const locations = await import('../inventory/locations.js');
  const members = await import('../members/members.js');
  const plans = await import('../subscriptions/plans.js');
  const subs = await import('../subscriptions/subscriptions.js');
  const circ = await import('../circulation/circulation.js');
  const res = await import('../circulation/reservations.js');
  const sweep = await import('../subscriptions/sweep.js');

  const saUid = (await auth.getUserByEmail('super@stories.test')).uid;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type Callable = { run: (req: any) => unknown };
  const call = async <R>(fn: Callable, data: Record<string, unknown>, withRequestId = true): Promise<R> =>
    (await fn.run({
      data: withRequestId ? { ...data, requestId: randomUUID() } : data,
      auth: { uid: saUid, token: { email: 'super@stories.test', email_verified: true } },
      rawRequest: {},
      acceptsStreaming: false,
    })) as R;

  // Catalogue: public-domain classics (demo data; synopses written for Stories).
  type G = 'FICTION' | 'FANTASY' | 'MYSTERY' | 'ADVENTURE' | 'SCIENCE' | 'BIOGRAPHY' | 'SELF_HELP' | 'CLASSICS' | 'COMICS' | 'EDUCATIONAL';
  const books: [string, string, number, G[], 'CHILDREN' | 'TEENS' | 'ADULTS', string, number | null, string][] = [
    ['The Panchatantra', 'Vishnu Sharma', 300, ['FICTION', 'CLASSICS'], 'CHILDREN', 'BEGINNER', 5, 'Animal fables that teach young princes how to live wisely.'],
    ["Alice's Adventures in Wonderland", 'Lewis Carroll', 1865, ['FANTASY', 'CLASSICS'], 'CHILDREN', 'INTERMEDIATE', 8, 'A curious girl follows a rabbit into a world of nonsense and riddles.'],
    ['The Jungle Book', 'Rudyard Kipling', 1894, ['ADVENTURE', 'CLASSICS'], 'CHILDREN', 'INTERMEDIATE', 8, 'Mowgli grows up among wolves, a bear and a panther in the Indian jungle.'],
    ['Peter Pan', 'J. M. Barrie', 1911, ['FANTASY'], 'CHILDREN', 'INTERMEDIATE', 7, 'The boy who never grows up takes the Darling children to Neverland.'],
    ['The Wonderful Wizard of Oz', 'L. Frank Baum', 1900, ['FANTASY'], 'CHILDREN', 'INTERMEDIATE', 7, 'Dorothy and three unlikely friends travel the yellow brick road.'],
    ['Just So Stories', 'Rudyard Kipling', 1902, ['FICTION'], 'CHILDREN', 'BEGINNER', 5, 'Playful tales of how the leopard got its spots and more.'],
    ['The Tale of Peter Rabbit', 'Beatrix Potter', 1902, ['FICTION'], 'CHILDREN', 'EARLY_READER', 3, 'A mischievous rabbit sneaks into Mr. McGregor’s garden.'],
    ['Little Nemo in Slumberland', 'Winsor McCay', 1905, ['COMICS', 'FANTASY'], 'CHILDREN', 'BEGINNER', 6, 'Dream adventures drawn in glorious early newspaper comics.'],
    ["McGuffey's First Eclectic Reader", 'William Holmes McGuffey', 1836, ['EDUCATIONAL'], 'CHILDREN', 'EARLY_READER', 4, 'Short lessons for children learning to read.'],
    ['Heidi', 'Johanna Spyri', 1881, ['FICTION', 'CLASSICS'], 'CHILDREN', 'INTERMEDIATE', 8, 'An orphan brings warmth to her grandfather’s Alpine hut.'],
    ['Black Beauty', 'Anna Sewell', 1877, ['CLASSICS'], 'CHILDREN', 'INTERMEDIATE', 9, 'A horse tells the story of his life, kind owners and cruel ones.'],
    ['The Chemical History of a Candle', 'Michael Faraday', 1861, ['SCIENCE', 'EDUCATIONAL'], 'TEENS', 'ADVANCED', 11, 'Famous lectures that explain chemistry through a single flame.'],
    ['Treasure Island', 'Robert Louis Stevenson', 1883, ['ADVENTURE', 'CLASSICS'], 'TEENS', 'INTERMEDIATE', 11, 'Young Jim Hawkins, a treasure map and Long John Silver.'],
    ['The Adventures of Tom Sawyer', 'Mark Twain', 1876, ['ADVENTURE'], 'TEENS', 'INTERMEDIATE', 11, 'Mischief, friendship and a hidden treasure on the Mississippi.'],
    ['Little Women', 'Louisa May Alcott', 1868, ['CLASSICS', 'FICTION'], 'TEENS', 'INTERMEDIATE', 12, 'Four sisters grow up through hardship, ambition and love.'],
    ['Anne of Green Gables', 'L. M. Montgomery', 1908, ['FICTION'], 'TEENS', 'INTERMEDIATE', 11, 'An imaginative orphan wins over a quiet island town.'],
    ['The Secret Garden', 'Frances Hodgson Burnett', 1911, ['FICTION', 'CLASSICS'], 'TEENS', 'INTERMEDIATE', 10, 'A lonely girl brings a hidden garden — and a household — back to life.'],
    ['Around the World in Eighty Days', 'Jules Verne', 1872, ['ADVENTURE'], 'TEENS', 'INTERMEDIATE', 12, 'Phileas Fogg bets his fortune on a race around the globe.'],
    ['The Call of the Wild', 'Jack London', 1903, ['ADVENTURE'], 'TEENS', 'INTERMEDIATE', 12, 'A stolen dog learns to survive in the Yukon gold rush.'],
    ['Kim', 'Rudyard Kipling', 1901, ['ADVENTURE', 'CLASSICS'], 'TEENS', 'ADVANCED', 13, 'An orphan on the streets of Lahore joins a lama on a great journey.'],
    ['The Story of My Life', 'Helen Keller', 1903, ['BIOGRAPHY'], 'TEENS', 'INTERMEDIATE', 12, 'Helen Keller’s own account of learning to speak, read and write.'],
    ['Twenty Thousand Leagues Under the Seas', 'Jules Verne', 1870, ['ADVENTURE', 'SCIENCE'], 'TEENS', 'ADVANCED', 12, 'Aboard Captain Nemo’s submarine, the Nautilus.'],
    ['Pride and Prejudice', 'Jane Austen', 1813, ['CLASSICS', 'FICTION'], 'ADULTS', 'ADVANCED', null, 'Elizabeth Bennet and Mr. Darcy misjudge each other, wittily.'],
    ['The Adventures of Sherlock Holmes', 'Arthur Conan Doyle', 1892, ['MYSTERY'], 'ADULTS', 'INTERMEDIATE', null, 'Twelve cases for the world’s most famous consulting detective.'],
    ['The Hound of the Baskervilles', 'Arthur Conan Doyle', 1902, ['MYSTERY'], 'ADULTS', 'INTERMEDIATE', null, 'A spectral hound haunts a family on the moors.'],
    ['The Moonstone', 'Wilkie Collins', 1868, ['MYSTERY', 'CLASSICS'], 'ADULTS', 'ADVANCED', null, 'A cursed Indian diamond vanishes from an English country house.'],
    ['The Mysterious Affair at Styles', 'Agatha Christie', 1920, ['MYSTERY'], 'ADULTS', 'INTERMEDIATE', null, 'Hercule Poirot’s first case: a poisoning at a country manor.'],
    ['Self-Help', 'Samuel Smiles', 1859, ['SELF_HELP'], 'ADULTS', 'INTERMEDIATE', null, 'Stories of perseverance from inventors, artists and workers.'],
    ['The Autobiography of Benjamin Franklin', 'Benjamin Franklin', 1791, ['BIOGRAPHY'], 'ADULTS', 'ADVANCED', null, 'A printer’s path to science, statecraft and self-improvement.'],
    ['On the Origin of Species', 'Charles Darwin', 1859, ['SCIENCE'], 'ADULTS', 'ADVANCED', null, 'The book that set out evolution by natural selection.'],
    ['Gitanjali', 'Rabindranath Tagore', 1910, ['CLASSICS'], 'ADULTS', 'INTERMEDIATE', null, 'Song offerings from the Nobel-winning poet.'],
    ['Frankenstein', 'Mary Shelley', 1818, ['FICTION', 'CLASSICS'], 'ADULTS', 'ADVANCED', null, 'A scientist creates life and cannot escape what he has made.'],
    ['The Time Machine', 'H. G. Wells', 1895, ['FICTION', 'CLASSICS'], 'ADULTS', 'INTERMEDIATE', null, 'A Victorian inventor travels to the far future.'],
    ['Meditations', 'Marcus Aurelius', 180, ['SELF_HELP', 'CLASSICS'], 'ADULTS', 'ADVANCED', null, 'Private notes on calm, duty and a well-lived life.'],
    ['As a Man Thinketh', 'James Allen', 1903, ['SELF_HELP'], 'ADULTS', 'BEGINNER', null, 'A short essay on how thought shapes character.'],
    ['Relativity: The Special and General Theory', 'Albert Einstein', 1916, ['SCIENCE', 'EDUCATIONAL'], 'ADULTS', 'ADVANCED', null, 'Einstein explains relativity for the general reader.'],
  ];
  const authorIds = new Map<string, string>();
  for (const [, author] of books) {
    if (!authorIds.has(author)) authorIds.set(author, (await call<{ id: string }>(catalog.authors.create, { name: author })).id);
  }
  const publisherId = (await call<{ id: string }>(catalog.publishers.create, { name: 'Public domain edition (demo)' })).id;
  const indian = (await call<{ id: string }>(catalog.categories.create, { name: 'Indian authors' })).id;
  const picks = (await call<{ id: string }>(catalog.categories.create, { name: 'Stories picks' })).id;
  const bookIds: { id: string; age: string }[] = [];
  for (const [i, [title, author, year, genres, ageGroup, readingLevel, minAge, synopsis]] of books.entries()) {
    const categoryIds = [...(['Vishnu Sharma', 'Rabindranath Tagore'].includes(author) ? [indian] : []), ...(i % 4 === 0 ? [picks] : [])];
    const { bookId } = await call<{ bookId: string }>(catalog.create, {
      title, authorIds: [authorIds.get(author)!], publisherId, categoryIds, language: 'en', genres, ageGroup, readingLevel, minAge, synopsis,
      publicationYear: year >= 1450 ? year : null, keywords: ['classic', 'demo'], replacementPriceMinor: 35000,
    });
    bookIds.push({ id: bookId, age: ageGroup });
  }

  // Shelves and copies: 2 of every title at Central, 1 of the first 12 at the franchise branch.
  const shelf: Record<string, string> = {};
  for (const [code, label, age] of [['A-01', 'Children · bay 1', 'CHILDREN'], ['B-01', 'Teens · bay 1', 'TEENS'], ['C-01', 'Adults · bay 1', 'ADULTS']]) {
    shelf[age] = (await call<{ locationId: string }>(locations.create, { orgId: CORP, branchId: CENTRAL, code, label, kind: 'SHELF' })).locationId;
  }
  const codes: Record<string, string[]> = {};
  for (const b of bookIds) {
    codes[b.id] = (await call<{ codes: string[] }>(copies.acquire, { orgId: CORP, branchId: CENTRAL, bookId: b.id, quantity: 2, acquisitionCostMinor: 29900, condition: 'GOOD', locationId: shelf[b.age] })).codes;
  }
  for (const b of bookIds.slice(0, 12)) {
    await call(copies.acquire, { orgId: FRAN, branchId: DEMO_FRANCHISE, bookId: b.id, quantity: 1, acquisitionCostMinor: 29900, condition: 'NEW' });
  }

  // Plans (versioned; prices in paise).
  const plan = async (orgId: string, name: string, duration: string, price: number, deposit: number, max: number, audiences: string[]) =>
    (await call<{ planId: string }>(plans.create, { orgId, name, duration, priceMinor: price * 100, depositMinor: deposit * 100, maxSimultaneousBooks: max, audiences, deliveryEligible: max >= 4 })).planId;
  const all = ['CHILDREN', 'TEENS', 'ADULTS'];
  const monthly = await plan(CORP, 'Monthly · 2 books', 'MONTHLY', 299, 1000, 2, all);
  const quarterly = await plan(CORP, 'Quarterly · 4 books', 'QUARTERLY', 799, 1500, 4, all);
  await plan(CORP, 'Half-yearly · 4 books', 'HALF_YEARLY', 1499, 1500, 4, all);
  await plan(CORP, 'Annual · 6 books', 'ANNUAL', 2699, 2000, 6, all);
  const little = await plan(CORP, 'Little Readers · 2 books', 'MONTHLY', 199, 500, 2, ['CHILDREN']);
  const franMonthly = await plan(FRAN, 'Monthly · 2 books', 'MONTHLY', 299, 1000, 2, all);

  // Members, subscriptions (paid at the counter), loans and a reservation.
  const member = async (orgId: string, branchId: string, fullName: string, dob: string, phone: string, extra: Record<string, unknown> = {}) =>
    (await call<{ memberId: string }>(members.register, { orgId, homeBranchId: branchId, fullName, dob, phone, ...extra })).memberId;
  const subscribe = async (orgId: string, memberId: string, planId: string) => {
    const { subscriptionId, amountDue } = await call<{ subscriptionId: string; amountDue: { totalMinor: number } }>(subs.create, { orgId, memberId, planId });
    await call(subs.recordOfflinePayment, { orgId, subscriptionId, method: 'OFFLINE_UPI', amountMinor: amountDue.totalMinor, reference: 'UPI-DEMO-0001' });
    return subscriptionId;
  };
  const issue = (memberId: string, barcodes: string[]) => call(circ.issue, { orgId: CORP, branchId: CENTRAL, memberId, barcodes });

  const asha = await member(CORP, CENTRAL, 'Asha Rao', '1988-04-12', '9876500001');
  await subscribe(CORP, asha, quarterly);
  await issue(asha, [codes[bookIds[23].id][0], codes[bookIds[12].id][0]]);
  const kiran = await member(CORP, CENTRAL, 'Kiran Rao', '2016-08-20', '', { guardianMemberId: asha, guardianRelationship: 'Mother' });
  await subscribe(CORP, kiran, little);
  await issue(kiran, [codes[bookIds[1].id][0]]);
  const ravi = await member(CORP, CENTRAL, 'Ravi Kumar', '1992-11-03', '9876500002');
  await subscribe(CORP, ravi, monthly);
  await issue(ravi, [codes[bookIds[24].id][0]]);
  await call(res.place, { orgId: CORP, memberId: ravi, bookId: bookIds[23].id, branchId: CENTRAL }); // other copy → held
  const farah = await member(CORP, CENTRAL, 'Farah Khan', '1985-01-30', '9876500003');
  const farahSub = await subscribe(CORP, farah, monthly);
  await issue(farah, [codes[bookIds[26].id][0]]);
  await db.doc(`orgs/${CORP}/subscriptions/${farahSub}`).update({ endAt: (await import('firebase-admin/firestore')).Timestamp.fromMillis(Date.now() - 86_400_000) });
  await sweep.expireDueSubscriptions();
  const neel = await member(CORP, CENTRAL, 'Neel Shah', '1999-06-15', '9876500004');
  await call(subs.create, { orgId: CORP, memberId: neel, planId: monthly }); // waiting for payment
  const fatima = await member(FRAN, DEMO_FRANCHISE, 'Fatima Sheikh', '1990-09-09', '9876500005');
  await subscribe(FRAN, fatima, franMonthly);

  await db.doc('seed/phase1').set({ at: FieldValue.serverTimestamp() });
  console.log(`Seeded ${books.length} books, ${books.length * 2 + 12} copies, 6 plans, 6 members with subscriptions, loans and a reservation.`);
}
