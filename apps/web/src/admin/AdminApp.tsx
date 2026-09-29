import type { ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router';

import type { ViewId } from '../auth/claims';
import { AdminShell } from './AdminShell';
import { NoAccess, Require } from './guards';
import { MOVED, movedTo, navItemFor, type Requirement } from './nav';
import { paths, viewHome } from '../paths';
import { AppearanceSettings } from '../shared/AppearanceSettings';
import { t } from '../strings';
import { AuditPage } from './organization/Audit';
import { BookDetailPage } from './catalogue/BookDetail';
import { BulkAddBooksPage } from './catalogue/BulkAddBooks';
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
import { OfferLettersPage } from './people/OfferLetters';
import { LeavePage } from './people/Leave';
import { MyAttendancePage } from './people/MyAttendance';
import { MyLeavePage } from './people/MyLeave';
import { MyPayslipsPage } from './people/MyPayslips';
import { MyProfilePage } from './people/MyProfile';
import { PayrollPage } from './people/Payroll';
import { PeopleOverviewPage } from './people/PeopleOverview';
import { EmployeeProfilePage } from './people/EmployeeProfile';
import { JobSettingsPage } from './people/HrSettings';
import { DocumentTypesSettingsPage, LeaveTypesSettingsPage, PayrollSettingsPage, ScheduleSettingsPage } from './people/SettingsPages';
import { PeoplePage } from './people/People';
import { OrganizationsPage } from './organization/Organizations';
import { StaffPage } from './organization/Staff';

/** Guards a page with the rule of the menu item it belongs to (the server checks again). */
function guard(path: string, page: ReactNode, requires?: Requirement) {
  const item = navItemFor(path);
  return <Require requires={requires ?? item?.page ?? item?.requires ?? null}>{page}</Require>;
}

function Moved() {
  const { pathname, search } = useLocation();
  return <Navigate to={movedTo(pathname, search) ?? paths.admin} replace />;
}

/** Routes of one view, relative to its base (e.g. '/ops/desk' → 'desk'). */
function viewRoutes(view: ViewId): [string, ReactNode][] {
  switch (view) {
    case 'ops':
      return [
        [paths.adminDesk, guard(paths.adminDesk, <DeskPage />)],
        [paths.adminBooks, guard(paths.adminBooks, <CataloguePage />)],
        [paths.adminBooksBulk, guard(paths.adminBooksBulk, <BulkAddBooksPage />)],
        [paths.adminBook(':bookId'), guard(paths.adminBooks, <BookDetailPage />)],
        [paths.adminInventory, guard(paths.adminInventory, <InventoryPage />)],
        [paths.adminCopy(':copyId'), guard(paths.adminInventory, <CopyDetailPage />)],
        [paths.adminLabels, guard(paths.adminInventory, <LabelsPage />)],
        [paths.adminReservations, guard(paths.adminReservations, <ReservationsPage />)],
        [paths.adminTransfers, guard(paths.adminTransfers, <TransfersPage />)],
        [paths.adminMembers, guard(paths.adminMembers, <MembersPage />)],
        [paths.adminMember(':memberId'), guard(paths.adminMembers, <MemberDetailPage />)],
        [paths.adminPlans, guard(paths.adminPlans, <PlansPage />)],
        [paths.adminDeposits, guard(paths.adminDeposits, <DepositApprovalsPage />)],
        [paths.opsAttendance, guard(paths.opsAttendance, <AttendancePage />)],
        [paths.opsLeave, guard(paths.opsLeave, <LeavePage />)],
        [paths.opsOffers, guard(paths.opsOffers, <OfferLettersPage />)],
      ];
    case 'staff':
      return [
        [paths.adminMyAttendance, <MyAttendancePage />],
        [paths.adminMyLeave, <MyLeavePage />],
        [paths.adminMyPayslips, <MyPayslipsPage />],
        [
          paths.adminAppearance,
          <>
            <header className="page-header">
              <h1>{t.navAppearance}</h1>
              <p className="muted">{t.apIntro}</p>
            </header>
            <AppearanceSettings />
          </>,
        ],
      ];
    case 'admin':
      return [
        [paths.adminOrgs, guard(paths.adminOrgs, <OrganizationsPage />)],
        [paths.adminBranches, guard(paths.adminBranches, <BranchesPage />)],
        [paths.adminDepartments, guard(paths.adminDepartments, <DepartmentsPage />)],
        [paths.adminStaff, guard(paths.adminStaff, <StaffPage />)],
        [paths.adminPeopleOverview, guard(paths.adminPeopleOverview, <PeopleOverviewPage />)],
        [paths.adminPeople, guard(paths.adminPeople, <PeoplePage />)],
        [paths.adminEmployee(':employeeId'), guard(paths.adminPeople, <EmployeeProfilePage />)],
        [paths.adminDocuments, guard(paths.adminDocuments, <DocumentsPage />)],
        [paths.adminOffers, guard(paths.adminOffers, <OfferLettersPage />)],
        [paths.adminAttendance, guard(paths.adminAttendance, <AttendancePage />)],
        [paths.adminLeave, guard(paths.adminLeave, <LeavePage />)],
        [paths.adminPayroll, guard(paths.adminPayroll, <PayrollPage />)],
        [paths.adminHrSettings, guard(paths.adminHrSettings, <JobSettingsPage />)],
        [paths.adminSettingsSchedule, guard(paths.adminSettingsSchedule, <ScheduleSettingsPage />)],
        [paths.adminSettingsLeave, guard(paths.adminSettingsLeave, <LeaveTypesSettingsPage />)],
        [paths.adminSettingsDocuments, guard(paths.adminSettingsDocuments, <DocumentTypesSettingsPage />)],
        [paths.adminSettingsPayroll, guard(paths.adminSettingsPayroll, <PayrollSettingsPage />)],
        [paths.adminAudit, guard(paths.adminAudit, <AuditPage />)],
      ];
  }
}

const HOME: Record<ViewId, ReactNode> = { admin: <DashboardPage />, ops: <DashboardPage />, staff: <MyProfilePage /> };

/**
 * Staff console (lazy-loaded chunk), mounted once per view at its base
 * (/admin, /ops, /me). Each page is guarded by the rule of its menu item
 * (nav.ts); the server enforces the real permission regardless.
 */
export default function AdminApp({ view }: { view: ViewId }) {
  const base = viewHome[view];
  const rel = (path: string) => path.slice(base.length + 1);
  return (
    <Routes>
      <Route element={<AdminShell view={view} />}>
        <Route index element={HOME[view]} />
        {viewRoutes(view).map(([path, element]) => (
          <Route key={path} path={rel(path)} element={element} />
        ))}
        {view === 'admin' && MOVED.map(([from]) => <Route key={from} path={`${rel(from)}/*`} element={<Moved />} />)}
        <Route path="*" element={<NoAccess />} />
      </Route>
    </Routes>
  );
}
