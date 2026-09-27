import { Route, Routes } from 'react-router';

import { AdminShell } from './AdminShell';
import { NoAccess, Require } from './guards';
import { AuditPage } from './pages/Audit';
import { BranchesPage } from './pages/Branches';
import { DashboardPage } from './pages/Dashboard';
import { DepartmentsPage } from './pages/Departments';
import { OrganizationsPage } from './pages/Organizations';
import { StaffPage } from './pages/Staff';

/**
 * Staff console (lazy-loaded chunk). Each page is guarded by the same rule as
 * its navigation item; the server enforces the real permission regardless.
 */
export default function AdminApp() {
  return (
    <Routes>
      <Route element={<AdminShell />}>
        <Route index element={<DashboardPage />} />
        <Route path="organizations" element={<Require requires="superAdmin"><OrganizationsPage /></Require>} />
        <Route path="branches" element={<Require requires="branches.view"><BranchesPage /></Require>} />
        <Route path="departments" element={<Require requires="branches.view"><DepartmentsPage /></Require>} />
        <Route path="staff" element={<Require requires="staff.view"><StaffPage /></Require>} />
        <Route path="audit" element={<Require requires="audit.view"><AuditPage /></Require>} />
        <Route path="*" element={<NoAccess />} />
      </Route>
    </Routes>
  );
}
