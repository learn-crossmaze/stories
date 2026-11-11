import { type ComponentType, lazy, type ReactNode } from 'react';
import { Route, Routes } from 'react-router';

import { AdminShell } from './AdminShell';
import { NoAccess, Require } from './guards';
import { navItemFor, type Requirement } from './nav';
import { paths } from '../paths';
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
const ShelvePage = lazyPage(() => import('./inventory/Shelve'), 'ShelvePage');
const MemberDetailPage = lazyPage(() => import('./members/MemberDetail'), 'MemberDetailPage');
const MembersPage = lazyPage(() => import('./members/Members'), 'MembersPage');
const PaymentsPage = lazyPage(() => import('./members/Payments'), 'PaymentsPage');
const PlansPage = lazyPage(() => import('./members/Plans'), 'PlansPage');
const ReservationsPage = lazyPage(() => import('./circulation/Reservations'), 'ReservationsPage');
const TransfersPage = lazyPage(() => import('./circulation/Transfers'), 'TransfersPage');
const DeliveriesPage = lazyPage(() => import('./circulation/Deliveries'), 'DeliveriesPage');
const MyDeliveriesPage = lazyPage(() => import('./circulation/Deliveries'), 'MyDeliveriesPage');
const DeliverySettingsPage = lazyPage(() => import('./organization/DeliverySettings'), 'DeliverySettingsPage');
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
const MyOnboardingPage = lazyPage(() => import('./people/MyOnboarding'), 'MyOnboardingPage');
const PayrollPage = lazyPage(() => import('./people/Payroll'), 'PayrollPage');
const PeopleOverviewPage = lazyPage(() => import('./people/PeopleOverview'), 'PeopleOverviewPage');
const EmployeeProfilePage = lazyPage(() => import('./people/EmployeeProfile'), 'EmployeeProfilePage');
const JobSettingsPage = lazyPage(() => import('./people/HrSettings'), 'JobSettingsPage');
const DocumentTypesSettingsPage = lazyPage(() => import('./people/SettingsPages'), 'DocumentTypesSettingsPage');
const LeaveTypesSettingsPage = lazyPage(() => import('./people/SettingsPages'), 'LeaveTypesSettingsPage');
const LetterTemplatesSettingsPage = lazyPage(() => import('./people/SettingsPages'), 'LetterTemplatesSettingsPage');
const PayrollSettingsPage = lazyPage(() => import('./people/SettingsPages'), 'PayrollSettingsPage');
const WhatsAppPage = lazyPage(() => import('./organization/WhatsApp'), 'WhatsAppPage');
const ScheduleSettingsPage = lazyPage(() => import('./people/SettingsPages'), 'ScheduleSettingsPage');
const PeoplePage = lazyPage(() => import('./people/People'), 'PeoplePage');
const OrganizationsPage = lazyPage(() => import('./organization/Organizations'), 'OrganizationsPage');
const StaffPage = lazyPage(() => import('./organization/Staff'), 'StaffPage');
const WebsiteOverviewPage = lazyPage(() => import('./website/Overview'), 'WebsiteOverviewPage');
const SectionsPage = lazyPage(() => import('./website/Sections'), 'SectionsPage');
const JobsPage = lazyPage(() => import('./website/Collections'), 'JobsPage');
const JobEditorPage = lazyPage(() => import('./website/Collections'), 'JobEditorPage');
const TestimonialsPage = lazyPage(() => import('./website/Collections'), 'TestimonialsPage');
const TestimonialEditorPage = lazyPage(() => import('./website/Collections'), 'TestimonialEditorPage');
const SubmissionsPage = lazyPage(() => import('./website/Submissions'), 'SubmissionsPage');
const SubmissionPage = lazyPage(() => import('./website/Submissions'), 'SubmissionPage');
const CallsPage = lazyPage(() => import('./website/Calls'), 'CallsPage');
const ConnectionsPage = lazyPage(() => import('./website/People'), 'ConnectionsPage');
const AdminsPage = lazyPage(() => import('./website/People'), 'AdminsPage');
const BlogPage = lazyPage(() => import('./website/Blog'), 'BlogPage');
const PostEditorPage = lazyPage(() => import('./website/Blog'), 'PostEditorPage');
const BranchPagesPage = lazyPage(() => import('./website/BranchPages'), 'BranchPagesPage');
const BranchPageEditorPage = lazyPage(() => import('./website/BranchPages'), 'BranchPageEditorPage');
const PromotionsPage = lazyPage(() => import('./website/Promotions'), 'PromotionsPage');
const PromotionEditorPage = lazyPage(() => import('./website/Promotions'), 'PromotionEditorPage');
const CardsPage = lazyPage(() => import('./website/Cards'), 'CardsPage');
const SiteSettingsPage = lazyPage(() => import('./website/Settings'), 'SiteSettingsPage');

/** Guards a page with the rule of the menu item it belongs to (the server checks again). */
function guard(path: string, page: ReactNode, requires?: Requirement) {
  const item = navItemFor(path);
  return <Require requires={requires ?? item?.page ?? item?.requires ?? null}>{page}</Require>;
}

/** Every page of the console, by its address. */
function allRoutes(): [string, ReactNode][] {
  return [
    ...([
        [paths.adminDesk, guard(paths.adminDesk, <DeskPage />)],
        [paths.adminBooks, guard(paths.adminBooks, <CataloguePage />)],
        [paths.adminBooksBulk, guard(paths.adminBooksBulk, <BulkAddBooksPage />)],
        [paths.adminBook(':bookId'), guard(paths.adminBooks, <BookDetailPage />)],
        [paths.adminInventory, guard(paths.adminInventory, <InventoryPage />)],
        [paths.adminShelve, guard(paths.adminShelve, <ShelvePage />)],
        [paths.adminCopy(':copyId'), guard(paths.adminInventory, <CopyDetailPage />)],
        [paths.adminLabels, guard(paths.adminInventory, <LabelsPage />)],
        [paths.adminReservations, guard(paths.adminReservations, <ReservationsPage />)],
        [paths.adminTransfers, guard(paths.adminTransfers, <TransfersPage />)],
        [paths.opsDeliveries, guard(paths.opsDeliveries, <DeliveriesPage />)],
        [paths.adminMembers, guard(paths.adminMembers, <MembersPage />)],
        [paths.adminMember(':memberId'), guard(paths.adminMembers, <MemberDetailPage />)],
        [paths.adminPlans, guard(paths.adminPlans, <PlansPage />)],
        [paths.adminPayments, guard(paths.adminPayments, <PaymentsPage />)],
        [paths.adminDeposits, guard(paths.adminDeposits, <DepositApprovalsPage />)],
    ] as [string, ReactNode][]),
    ...([
        [paths.adminMyAttendance, <MyAttendancePage />],
        [paths.adminMyOnboarding, <MyOnboardingPage />],
        [paths.adminMyLeave, <MyLeavePage />],
        [paths.adminMyPayslips, <MyPayslipsPage />],
        [paths.adminMyDeliveries, guard(paths.adminMyDeliveries, <MyDeliveriesPage />)],
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
    ] as [string, ReactNode][]),
    ...([
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
        [paths.adminSettingsWhatsApp, guard(paths.adminSettingsWhatsApp, <WhatsAppPage />)],
        [paths.adminSettingsDelivery, guard(paths.adminSettingsDelivery, <DeliverySettingsPage />)],
        [paths.adminAudit, guard(paths.adminAudit, <AuditPage />)],
    ] as [string, ReactNode][]),
    ...([
        [paths.adminWebsiteSettings, guard(paths.adminWebsiteSettings, <SiteSettingsPage />)],
        [paths.adminWebsiteSections, guard(paths.adminWebsiteSections, <SectionsPage />)],
        [paths.adminWebsiteBranches, guard(paths.adminWebsiteBranches, <BranchPagesPage />)],
        [paths.adminWebsiteBranch(':orgId', ':branchId'), guard(paths.adminWebsiteBranches, <BranchPageEditorPage />)],
        [paths.adminWebsitePromotions, guard(paths.adminWebsitePromotions, <PromotionsPage />)],
        [paths.adminWebsitePromotion(':promotionId'), guard(paths.adminWebsitePromotions, <PromotionEditorPage />)],
        [paths.adminWebsiteJobs, guard(paths.adminWebsiteJobs, <JobsPage />)],
        [paths.adminWebsiteJob(':jobId'), guard(paths.adminWebsiteJobs, <JobEditorPage />)],
        [paths.adminWebsiteBlog, guard(paths.adminWebsiteBlog, <BlogPage />)],
        [paths.adminWebsitePost(':postId'), guard(paths.adminWebsiteBlog, <PostEditorPage />)],
        [paths.adminWebsiteCards, guard(paths.adminWebsiteCards, <CardsPage />)],
        [paths.adminWebsiteTestimonials, guard(paths.adminWebsiteTestimonials, <TestimonialsPage />)],
        [paths.adminWebsiteTestimonial(':testimonialId'), guard(paths.adminWebsiteTestimonials, <TestimonialEditorPage />)],
        [paths.adminWebsiteSubmissions, guard(paths.adminWebsiteSubmissions, <SubmissionsPage />)],
        [paths.adminWebsiteSubmission(':submissionId'), guard(paths.adminWebsiteSubmissions, <SubmissionPage />)],
        [paths.adminWebsiteCalls, guard(paths.adminWebsiteCalls, <CallsPage />)],
        [paths.adminWebsiteConnections, guard(paths.adminWebsiteConnections, <ConnectionsPage />)],
        [paths.adminWebsiteAdmins, guard(paths.adminWebsiteAdmins, <AdminsPage />)],
    ] as [string, ReactNode][]),
  ];
}

/**
 * The staff console (lazy-loaded chunk): one shell with one menu (nav.ts) for every staff page. Each page is guarded
 * by the rule of its menu item; the server enforces the real permission regardless.
 */
export default function AdminApp() {
  const rel = (path: string) => path.replace(/^\//, '');
  return (
    <Routes>
      <Route element={<AdminShell />}>
        <Route path={rel(paths.admin)} element={<DashboardPage />} />
        <Route path={rel(paths.web)} element={guard(paths.adminWebsite, <WebsiteOverviewPage />)} />
        <Route path={rel(paths.staff)} element={<MyProfilePage />} />
        {allRoutes().map(([path, element]) => (
          <Route key={path} path={rel(path)} element={element} />
        ))}
        <Route path="*" element={<NoAccess />} />
      </Route>
    </Routes>
  );
}
