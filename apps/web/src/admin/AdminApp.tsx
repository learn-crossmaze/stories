import { type ComponentType, lazy, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router';

import type { ViewId } from '../auth/claims';
import { AdminShell } from './AdminShell';
import { NoAccess, Require } from './guards';
import { MOVED, movedTo, navItemFor, type Requirement } from './nav';
import { paths, viewHome } from '../paths';
import { AppearanceSettings } from '../shared/AppearanceSettings';
import { t } from '../strings';

/** A page loaded on first visit (each page is its own chunk). */
const lazyPage = <K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K) =>
  lazy(() => load().then((m) => ({ default: m[name] })));

const AuditPage = lazyPage(() => import('./organization/Audit'), 'AuditPage');
const BookDetailPage = lazyPage(() => import('./catalogue/BookDetail'), 'BookDetailPage');
const BulkAddBooksPage = lazyPage(() => import('./catalogue/BulkAddBooks'), 'BulkAddBooksPage');
const CataloguePage = lazyPage(() => import('./catalogue/Catalogue'), 'CataloguePage');
const DepositApprovalsPage = lazyPage(() => import('./members/DepositApprovals'), 'DepositApprovalsPage');
const DeskPage = lazyPage(() => import('./circulation/Desk'), 'DeskPage');
const CopyDetailPage = lazyPage(() => import('./inventory/Inventory'), 'CopyDetailPage');
const InventoryPage = lazyPage(() => import('./inventory/Inventory'), 'InventoryPage');
const LabelsPage = lazyPage(() => import('./inventory/Inventory'), 'LabelsPage');
const MemberDetailPage = lazyPage(() => import('./members/MemberDetail'), 'MemberDetailPage');
const MembersPage = lazyPage(() => import('./members/Members'), 'MembersPage');
const PaymentsPage = lazyPage(() => import('./members/Payments'), 'PaymentsPage');
const PlansPage = lazyPage(() => import('./members/Plans'), 'PlansPage');
const ReservationsPage = lazyPage(() => import('./circulation/Reservations'), 'ReservationsPage');
const TransfersPage = lazyPage(() => import('./circulation/Transfers'), 'TransfersPage');
const BranchesPage = lazyPage(() => import('./organization/Branches'), 'BranchesPage');
const DashboardPage = lazyPage(() => import('./dashboard/Dashboard'), 'DashboardPage');
const DepartmentsPage = lazyPage(() => import('./organization/Departments'), 'DepartmentsPage');
const AttendancePage = lazyPage(() => import('./people/Attendance'), 'AttendancePage');
const DocumentsPage = lazyPage(() => import('./people/Documents'), 'DocumentsPage');
const OfferLettersPage = lazyPage(() => import('./people/OfferLetters'), 'OfferLettersPage');
const LeavePage = lazyPage(() => import('./people/Leave'), 'LeavePage');
const MyAttendancePage = lazyPage(() => import('./people/MyAttendance'), 'MyAttendancePage');
const MyLeavePage = lazyPage(() => import('./people/MyLeave'), 'MyLeavePage');
const MyPayslipsPage = lazyPage(() => import('./people/MyPayslips'), 'MyPayslipsPage');
const MyProfilePage = lazyPage(() => import('./people/MyProfile'), 'MyProfilePage');
const PayrollPage = lazyPage(() => import('./people/Payroll'), 'PayrollPage');
const PeopleOverviewPage = lazyPage(() => import('./people/PeopleOverview'), 'PeopleOverviewPage');
const EmployeeProfilePage = lazyPage(() => import('./people/EmployeeProfile'), 'EmployeeProfilePage');
const JobSettingsPage = lazyPage(() => import('./people/HrSettings'), 'JobSettingsPage');
const DocumentTypesSettingsPage = lazyPage(() => import('./people/SettingsPages'), 'DocumentTypesSettingsPage');
const LeaveTypesSettingsPage = lazyPage(() => import('./people/SettingsPages'), 'LeaveTypesSettingsPage');
const LetterTemplatesSettingsPage = lazyPage(() => import('./people/SettingsPages'), 'LetterTemplatesSettingsPage');
const PayrollSettingsPage = lazyPage(() => import('./people/SettingsPages'), 'PayrollSettingsPage');
const ScheduleSettingsPage = lazyPage(() => import('./people/SettingsPages'), 'ScheduleSettingsPage');
const PeoplePage = lazyPage(() => import('./people/People'), 'PeoplePage');
const OrganizationsPage = lazyPage(() => import('./organization/Organizations'), 'OrganizationsPage');
const StaffPage = lazyPage(() => import('./organization/Staff'), 'StaffPage');

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
        [paths.adminPayments, guard(paths.adminPayments, <PaymentsPage />)],
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
        [paths.adminSettingsLetters, guard(paths.adminSettingsLetters, <LetterTemplatesSettingsPage />)],
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
