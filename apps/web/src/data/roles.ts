// Master control → Roles and Library rules (docs/RBAC.md §2.1). Server: functions/src/organization/{roles,libraryRules}.ts.
import type { Permission, Role } from '../generated/rbac';
import { call, command } from './api';

export interface CustomRoleView {
  id: string;
  name: string;
  description: string;
  permissions: Permission[];
  /** Made by a Super Admin for every organization. */
  everyOrg: boolean;
  /** Where it may be given (['*']: anywhere). */
  branchIds: string[];
  wholeOrg: boolean;
  holders: number;
  canEdit: boolean;
  canGive: boolean;
}

export interface RolesView {
  standard: { key: Role; holders: number; permissions: Permission[] }[];
  custom: CustomRoleView[];
}

export const listRoles = (orgId: string) => call<RolesView>('roles-list', { orgId });

export interface RoleInput {
  roleId?: string;
  name: string;
  description: string;
  permissions: Permission[];
  branchIds: string[];
  wholeOrg: boolean;
  everyOrg: boolean;
}

export const saveRole = (orgId: string, { roleId, ...input }: RoleInput) =>
  command<{ roleId: string }>('roles-save', { orgId, ...input, ...(roleId ? { roleId } : {}) });
export const deleteRole = (orgId: string, roleId: string) => command('roles-delete', { orgId, roleId });

export interface LibraryRules {
  reservationHoldHours: number;
  makerCheckerThresholdMinor: number;
}

export const libraryRules = (orgId: string) => call<{ rules: LibraryRules; defaults: LibraryRules }>('config-libraryRules', { orgId });
export const setLibraryRules = (orgId: string, rules: LibraryRules) => command('config-setLibraryRules', { orgId, ...rules });
