// The public website: its data (/api/public), its server-rendered pages, the forms it sends (/api/submit, /api/tap),
// and the console's Website section.
import { routes as adminRoutes } from './admin.js';
import { routes as inboxRoutes } from './inbox.js';

export const routes = { ...adminRoutes, ...inboxRoutes };
