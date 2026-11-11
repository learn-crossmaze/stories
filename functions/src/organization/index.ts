// Organization: orgs, branches, departments, staff roles, roles of one's own (admin router).
import * as online from '../billing/online.js';
import * as branches from './branches.js';
import * as departments from './departments.js';
import * as libraryRules from './libraryRules.js';
import * as numbering from './numbering.js';
import * as orgs from './orgs.js';
import * as roles from './roles.js';
import * as staff from './staff.js';

export const routes = {
  'orgs-create': orgs.create,
  'orgs-update': orgs.update,
  'orgs-setNumbering': numbering.setHeadOfficeNumbering,
  'branches-create': branches.create,
  'branches-update': branches.update,
  'branches-archive': branches.archive,
  'branches-setNumbering': numbering.setBranchNumbering,
  // The branch's payment gateway settings (code lives with billing).
  'branches-setPaymentGateway': online.setGateway,
  'branches-testPaymentGateway': online.testGateway,
  'departments-create': departments.create,
  'departments-rename': departments.rename,
  'departments-archive': departments.archive,
  'staff-setRoles': staff.setRoles,
  'staff-revoke': staff.revoke,
  'roles-list': roles.list,
  'roles-save': roles.save,
  'roles-delete': roles.remove,
  'config-libraryRules': libraryRules.get,
  'config-setLibraryRules': libraryRules.set,
};
