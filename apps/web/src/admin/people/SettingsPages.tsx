// Settings pages (Admin → Settings), one per topic; the sections live beside their features.
import type { ReactNode } from 'react';

import { getChecklistTemplates } from '../../data/hr';
import { NoOrgState } from '../../shared/ui';
import { useAsync } from '../../shared/useAsync';
import { ht } from '../../strings/hr';
import { useWorkspace } from '../Workspace';
import { DocumentTypesSection } from './DocumentTypesSettings';
import { LeaveTypesSection } from './LeaveTypesSettings';
import { LetterTemplatesSection } from './LetterTemplatesSettings';
import { PayrollSettingsSection } from './PayrollSettings';
import { HolidaysSection, ShiftsSection } from './ScheduleSettings';

function SettingsPage({ title, children }: { title: string; children: (orgId: string) => ReactNode }) {
  const { org } = useWorkspace();
  if (!org) return <NoOrgState />;
  return (
    <>
      <header className="page-header">
        <h1>{title}</h1>
      </header>
      {children(org.id)}
    </>
  );
}

export const ScheduleSettingsPage = () => (
  <SettingsPage title={ht.navScheduleSettings}>
    {(orgId) => (
      <>
        <ShiftsSection orgId={orgId} />
        <HolidaysSection orgId={orgId} />
      </>
    )}
  </SettingsPage>
);

export const LeaveTypesSettingsPage = () => <SettingsPage title={ht.navLeaveTypes}>{(orgId) => <LeaveTypesSection orgId={orgId} />}</SettingsPage>;

export const PayrollSettingsPage = () => <SettingsPage title={ht.navPayrollSettings}>{(orgId) => <PayrollSettingsSection orgId={orgId} />}</SettingsPage>;

function DocumentTypes({ orgId }: { orgId: string }) {
  // Document types can tick an onboarding checklist item.
  const templates = useAsync(() => getChecklistTemplates(orgId), [orgId]);
  return <DocumentTypesSection orgId={orgId} checklist={templates.data?.onboarding ?? []} />;
}

export const LetterTemplatesSettingsPage = () => <SettingsPage title={ht.navLetterTemplates}>{(orgId) => <LetterTemplatesSection orgId={orgId} />}</SettingsPage>;

export const DocumentTypesSettingsPage =() => <SettingsPage title={ht.navDocumentTypes}>{(orgId) => <DocumentTypes orgId={orgId} />}</SettingsPage>;
