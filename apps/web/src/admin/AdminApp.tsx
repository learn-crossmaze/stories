import { Route, Routes } from 'react-router';

import { AdminShell } from './AdminShell';
import { NoAccess, Require } from './guards';
import { AppearanceSettings } from '../shared/AppearanceSettings';
import { t } from '../strings';
import { AuditPage } from './organization/Audit';
import { BookDetailPage } from './catalogue/BookDetail';
import { CataloguePage } from './catalogue/Catalogue';
import { DepositApprovalsPage } from './members/DepositApprovals';
import { DeskPage } from './circulation/Desk';
import { CopyDetailPage, InventoryPage, LabelsPage } from './inventory/Inventory';
import { MemberDetailPage } from './members/MemberDetail';
import { MembersPage } from './members/Members';
import { PlansPage } from './members/Plans';
import { ReservationsPage } from './circulation/Reservations';
import { TransfersPage } from './circulation/Transfers';
import { BranchesPage } from './organization/Branches';
import { DashboardPage } from './dashboard/Dashboard';
import { DepartmentsPage } from './organization/Departments';
import { EmployeeProfilePage } from './people/EmployeeProfile';
import { HrSettingsPage } from './people/HrSettings';
import { PeoplePage } from './people/People';
import { OrganizationsPage } from './organization/Organizations';
import { StaffPage } from './organization/Staff';

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
        <Route path="people" element={<Require requires="employees.view"><PeoplePage /></Require>} />
        <Route path="people/:employeeId" element={<Require requires="employees.view"><EmployeeProfilePage /></Require>} />
        <Route path="hr-settings" element={<Require requires="hr.config"><HrSettingsPage /></Require>} />
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
        <Route
          path="appearance"
          element={
            <>
              <header className="page-header">
                <h1>{t.navAppearance}</h1>
                <p className="muted">{t.apIntro}</p>
              </header>
              <AppearanceSettings />
            </>
          }
        />
        <Route path="*" element={<NoAccess />} />
      </Route>
    </Routes>
  );
}
