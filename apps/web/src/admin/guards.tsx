import type { ReactNode } from 'react';

import { useAuth } from '../auth/AuthContext';
import { t } from '../strings';
import { EmptyState } from '../shared/ui';
import { allowed, type Requirement } from './nav';
import { useWorkspace } from './Workspace';

export function NoAccess() {
  return <EmptyState icon="alert" title={t.noAccessTitle} message={t.noAccessMessage} />;
}

/**
 * Route guard: renders the page only if the user holds the permission in the
 * current organization. The server enforces the same check independently.
 */
export function Require({ requires, children }: { requires: Requirement; children: ReactNode }) {
  const { claims } = useAuth();
  const { org } = useWorkspace();
  return allowed(claims, org?.id ?? null, requires) ? <>{children}</> : <NoAccess />;
}
