import { Route, Routes } from 'react-router';

import { AdminShell } from './AdminShell';
import { NoAccess, Require } from './guards';
import { AuditPage } from './pages/Audit';
import { BookDetailPage } from './pages/BookDetail';
import { CataloguePage } from './pages/Catalogue';
import { DepositApprovalsPage } from './pages/DepositApprovals';
import { DeskPage } from './pages/Desk';
import { CopyDetailPage, InventoryPage, LabelsPage } from './pages/Inventory';
import { MemberDetailPage } from './pages/MemberDetail';
import { MembersPage } from './pages/Members';
import { PlansPage } from './pages/Plans';
import { ReservationsPage } from './pages/Reservations';
import { TransfersPage } from './pages/Transfers';
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
        <Route path="desk" element={<Require requires="loans.issue"><DeskPage /></Require>} />
        <Route path="books" element={<Require requires="books.view"><CataloguePage /></Require>} />
        <Route path="books/:bookId" element={<Require requires="books.view"><BookDetailPage /></Require>} />
        <Route path="inventory" element={<Require requires="books.view"><InventoryPage /></Require>} />
        <Route path="inventory/:copyId" element={<Require requires="books.view"><CopyDetailPage /></Require>} />
        <Route path="labels" element={<Require requires="books.view"><LabelsPage /></Require>} />
        <Route path="reservations" element={<Require requires="reservations.manage"><ReservationsPage /></Require>} />
        <Route path="transfers" element={<Require requires="books.transfer"><TransfersPage /></Require>} />
        <Route path="members" element={<Require requires="members.view"><MembersPage /></Require>} />
        <Route path="members/:memberId" element={<Require requires="members.view"><MemberDetailPage /></Require>} />
        <Route path="plans" element={<Require requires="plans.manage"><PlansPage /></Require>} />
        <Route path="deposits" element={<Require requires="deposits.approve"><DepositApprovalsPage /></Require>} />
        <Route path="*" element={<NoAccess />} />
      </Route>
    </Routes>
  );
}
