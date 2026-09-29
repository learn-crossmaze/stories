import type { ReactNode } from 'react';
import { Route, Routes } from 'react-router';

import { AdminShell } from './AdminShell';
import { NoAccess, Require } from './guards';
import { navItemFor, type Requirement } from './nav';
import { paths } from '../paths';
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
import { AttendancePage } from './people/Attendance';
import { DocumentsPage } from './people/Documents';
import { MyAttendancePage } from './people/MyAttendance';
import { EmployeeProfilePage } from './people/EmployeeProfile';
import { HrSettingsPage } from './people/HrSettings';
import { PeoplePage } from './people/People';
import { OrganizationsPage } from './organization/Organizations';
import { StaffPage } from './organization/Staff';

/** Guards a page with the rule of the menu item it belongs to (the server checks again). */
function guard(path: string, page: ReactNode, requires?: Requirement) {
  const item = navItemFor(path);
  return <Require requires={requires ?? item?.page ?? item?.requires ?? null}>{page}</Require>;
}

const sub = (path: string) => path.slice(paths.admin.length + 1);

/**
 * Staff console (lazy-loaded chunk). Each page is guarded by the rule of its
 * menu item (nav.ts); the server enforces the real permission regardless.
 */
export default function AdminApp() {
  return (
    <Routes>
      <Route element={<AdminShell />}>
        <Route index element={<DashboardPage />} />
        <Route path={sub(paths.adminOrgs)} element={guard(paths.adminOrgs, <OrganizationsPage />)} />
        <Route path={sub(paths.adminBranches)} element={guard(paths.adminBranches, <BranchesPage />)} />
        <Route path={sub(paths.adminDepartments)} element={guard(paths.adminDepartments, <DepartmentsPage />)} />
        <Route path={sub(paths.adminStaff)} element={guard(paths.adminStaff, <StaffPage />)} />
        <Route path={sub(paths.adminPeople)} element={guard(paths.adminPeople, <PeoplePage />)} />
        <Route path={sub(paths.adminEmployee(':employeeId'))} element={guard(paths.adminPeople, <EmployeeProfilePage />)} />
        <Route path={sub(paths.adminAttendance)} element={guard(paths.adminAttendance, <AttendancePage />)} />
        <Route path={sub(paths.adminMyAttendance)} element={<MyAttendancePage />} />
        <Route path={sub(paths.adminDocuments)} element={guard(paths.adminDocuments, <DocumentsPage />)} />
        <Route path={sub(paths.adminHrSettings)} element={guard(paths.adminHrSettings, <HrSettingsPage />)} />
        <Route path={sub(paths.adminAudit)} element={guard(paths.adminAudit, <AuditPage />)} />
        <Route path={sub(paths.adminDesk)} element={guard(paths.adminDesk, <DeskPage />)} />
        <Route path={sub(paths.adminBooks)} element={guard(paths.adminBooks, <CataloguePage />)} />
        <Route path={sub(paths.adminBook(':bookId'))} element={guard(paths.adminBooks, <BookDetailPage />)} />
        <Route path={sub(paths.adminInventory)} element={guard(paths.adminInventory, <InventoryPage />)} />
        <Route path={sub(paths.adminCopy(':copyId'))} element={guard(paths.adminInventory, <CopyDetailPage />)} />
        <Route path={sub(paths.adminLabels)} element={guard(paths.adminInventory, <LabelsPage />)} />
        <Route path={sub(paths.adminReservations)} element={guard(paths.adminReservations, <ReservationsPage />)} />
        <Route path={sub(paths.adminTransfers)} element={guard(paths.adminTransfers, <TransfersPage />)} />
        <Route path={sub(paths.adminMembers)} element={guard(paths.adminMembers, <MembersPage />)} />
        <Route path={sub(paths.adminMember(':memberId'))} element={guard(paths.adminMembers, <MemberDetailPage />)} />
        <Route path={sub(paths.adminPlans)} element={guard(paths.adminPlans, <PlansPage />)} />
        <Route path={sub(paths.adminDeposits)} element={guard(paths.adminDeposits, <DepositApprovalsPage />)} />
        <Route
          path={sub(paths.adminAppearance)}
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
