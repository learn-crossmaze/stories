// Stories Cloud Functions. Every callable goes through core/callable.ts
// (auth → validation → permission → transaction + audit → idempotency).
// Deployed names are `<group>-<name>`, e.g. `branches-create`.
import { setGlobalOptions } from 'firebase-functions/v2';

import { REGION } from './core/firebase.js';

setGlobalOptions({ region: REGION, maxInstances: 10 });

export * as users from './users/profile.js';
export * as platform from './platform/bootstrap.js';
export * as orgs from './orgs/orgs.js';
export * as branches from './branches/branches.js';
export * as departments from './departments/departments.js';
export * as staff from './staff/roles.js';
