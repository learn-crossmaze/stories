// Platform: user profiles and Super Admin bootstrap (admin router).
import * as platform from './bootstrap.js';
import * as users from './users.js';

export const routes = {
  'users-ensureProfile': users.ensureProfile,
  'platform-bootstrapSuperAdmin': platform.bootstrapSuperAdmin,
};
