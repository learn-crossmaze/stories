// Physical copies and shelf locations (inventory router).
import * as copies from './copies.js';
import * as locations from './locations.js';

export const routes = {
  'copies-acquire': copies.acquire,
  'copies-relocate': copies.relocate,
  'copies-recordCondition': copies.recordCondition,
  'copies-inspect': copies.inspect,
  'copies-repair': copies.repair,
  'copies-markLost': copies.markLost,
  'copies-found': copies.found,
  'copies-retire': copies.retire,
  'copies-availability': copies.availability,
  'copies-availabilityMany': copies.availabilityMany,
  'copies-locate': copies.locate,
  'locations-create': locations.create,
  'locations-archive': locations.archive,
};
