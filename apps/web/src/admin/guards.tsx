import type { ReactNode } from 'react';

import { useAuth } from '../auth/AuthContext';
import { t } from '../strings';
import { EmptyState } from '../ui';
import { allowed, type NavItem } from './nav';
import { useWorkspace } from './Workspace';

export function NoAccess() {
  return <EmptyState icon="alert" title={t.noAccessTitle} message={t.noAccessMessage} />;
}

/**
 * Route guard: renders the page only if the user holds the permission in the
 * current organization. The server enforces the same check independently.
 */
export function Require({ requires, children }: { requires: NavItem['requires']; children: ReactNode }) {
  const { claims } = useAuth();
  const { org } = useWorkspace();
  return allowed(claims, org?.id ?? null, requires) ? <>{children}</> : <NoAccess />;
}
