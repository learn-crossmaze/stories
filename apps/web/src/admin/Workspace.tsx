import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from 'react';

import { useAuth } from '../auth/AuthContext';
import { type Branch, getOrgs, listAllOrgs, listBranches, type Org } from '../data/org';
import { useAsync } from '../data/useAsync';

interface Workspace {
  orgs: Org[];
  orgsLoading: boolean;
  orgsError: string | null;
  reloadOrgs: () => void;
  org: Org | null;
  setOrgId: (id: string) => void;
  branches: Branch[];
  branchesLoading: boolean;
  branchesError: string | null;
  reloadBranches: () => void;
  branchName: (id: string) => string;
}

const WorkspaceContext = createContext<Workspace | null>(null);

const storageKey = (uid: string) => `stories.org.${uid}`;
const readStored = (uid: string) => {
  try {
    return localStorage.getItem(storageKey(uid));
  } catch {
    return null;
  }
};

/** The organization the staff member is working in (remembered per browser). */
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { user, claims } = useAuth();
  const uid = user?.uid ?? '';
  const orgIds = Object.keys(claims.o).sort().join(',');
  const orgs = useAsync(() => (claims.sa ? listAllOrgs() : getOrgs(orgIds ? orgIds.split(',') : [])), [claims.sa, orgIds]);
  const [orgId, setOrgIdState] = useState<string | null>(() => readStored(uid));

  const list = useMemo(() => orgs.data ?? [], [orgs.data]);
  const org = list.find((o) => o.id === orgId) ?? list[0] ?? null;

  const branches = useAsync(() => (org ? listBranches(org.id) : Promise.resolve([])), [org?.id]);

  useEffect(() => {
    if (org && org.id !== orgId) setOrgIdState(org.id);
  }, [org, orgId]);

  const setOrgId = (id: string) => {
    setOrgIdState(id);
    try {
      localStorage.setItem(storageKey(uid), id);
    } catch {
      /* storage unavailable: selection just isn't remembered */
    }
  };

  const branchList = branches.data ?? [];
  const value: Workspace = {
    orgs: list,
    orgsLoading: orgs.loading,
    orgsError: orgs.error,
    reloadOrgs: orgs.reload,
    org,
    setOrgId,
    branches: branchList,
    branchesLoading: branches.loading,
    branchesError: branches.error,
    reloadBranches: branches.reload,
    branchName: (id) => (id === '*' ? '*' : (branchList.find((b) => b.id === id)?.name ?? id)),
  };
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): Workspace {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error('useWorkspace must be used inside <WorkspaceProvider>');
  return ctx;
}
