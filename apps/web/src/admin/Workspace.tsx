import { createContext, type ReactNode, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { useAuth } from '../auth/AuthContext';
import { branchScope, type StoriesClaims } from '../auth/claims';
import { type Branch, getOrgs, listAllOrgs, listBranches, type Org } from '../data/org';
import { useAsync } from '../shared/useAsync';

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
  /** Active branches the user works at in this org (all, for org-wide roles). */
  myBranches: Branch[];
  /** The branch the user is working at right now (desk, inventory, members). */
  branch: Branch | null;
  setBranchId: (id: string) => void;
}

const WorkspaceContext = createContext<Workspace | null>(null);

const storageKey = (uid: string) => `stories.org.${uid}`;
const readStored = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const writeStored = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable: selection just isn't remembered */
  }
};

/**
 * The organization whose branches to read while the organizations themselves are still loading: the one this
 * browser remembers, if the person is still in it, else the first by id (the same choice the loaded list makes).
 * A Super Admin's list is not in their claims, so only the remembered one is known. A wrong guess costs one read.
 */
export function likelyOrgId(claims: Pick<StoriesClaims, 'sa' | 'o'>, stored: string | null): string | null {
  if (claims.sa) return stored;
  if (stored && Object.hasOwn(claims.o, stored)) return stored;
  return Object.keys(claims.o).sort()[0] ?? null;
}

const NO_BRANCHES: Branch[] = [];

/** The organization the staff member is working in (remembered per browser). */
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { user, claims } = useAuth();
  const uid = user?.uid ?? '';
  const orgIds = Object.keys(claims.o).sort().join(',');
  const orgs = useAsync(() => (claims.sa ? listAllOrgs() : getOrgs(orgIds ? orgIds.split(',') : [])), [claims.sa, orgIds]);
  const [orgId, setOrgIdState] = useState<string | null>(() => readStored(storageKey(uid)));
  const [branchPick, setBranchPick] = useState<string | null>(null);

  const list = useMemo(() => orgs.data ?? [], [orgs.data]);
  const org = list.find((o) => o.id === orgId) ?? list[0] ?? null;

  // Branches are read alongside the organizations, not after them. The rows carry the organization they belong
  // to and are used only once that organization is the one resolved, so a wrong guess or a switch never pairs an
  // organization with another's branches.
  const branchOrgId = org?.id ?? (orgs.loading ? likelyOrgId(claims, orgId) : null);
  const reading = useRef<string | null>(null);
  const branches = useAsync(() => {
    reading.current = branchOrgId;
    return branchOrgId ? listBranches(branchOrgId).then((rows) => ({ orgId: branchOrgId, rows })) : Promise.resolve(null);
  }, [branchOrgId]);
  const mine = !!org && branches.data?.orgId === org.id;
  // useAsync starts a read in an effect, so for one render after the organization changes its error is still the
  // previous organization's.
  const failed = !!org && reading.current === org.id ? branches.error : null;

  useEffect(() => {
    if (!org || org.id === orgId) return;
    setOrgIdState(org.id);
    // Remembered also for someone who never used the switcher, so the next visit can read its branches at once.
    writeStored(storageKey(uid), org.id);
  }, [org, orgId, uid]);

  const setOrgId = (id: string) => {
    setOrgIdState(id);
    setBranchPick(null);
    writeStored(storageKey(uid), id);
  };

  const branchList = mine ? branches.data!.rows : NO_BRANCHES;
  const scope = org ? branchScope(claims, org.id) : [];
  const myBranches = branchList.filter((b) => b.status === 'ACTIVE' && (scope === 'ALL' || scope.includes(b.id)));
  const branchKey = `stories.branch.${uid}.${org?.id ?? ''}`;
  const pickedId = branchPick ?? readStored(branchKey);
  const branch = myBranches.find((b) => b.id === pickedId) ?? myBranches[0] ?? null;
  const setBranchId = (id: string) => {
    setBranchPick(id);
    writeStored(branchKey, id);
  };
  const value: Workspace = {
    orgs: list,
    orgsLoading: orgs.loading,
    orgsError: orgs.error,
    reloadOrgs: orgs.reload,
    org,
    setOrgId,
    branches: branchList,
    // True until the resolved organization's own branches are in (or their read failed): never false in between.
    branchesLoading: org ? branches.loading || (!mine && !failed) : orgs.loading,
    branchesError: failed,
    reloadBranches: branches.reload,
    branchName: (id) => (id === '*' ? '*' : (branchList.find((b) => b.id === id)?.name ?? id)),
    myBranches,
    branch,
    setBranchId,
  };
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): Workspace {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error('useWorkspace must be used inside <WorkspaceProvider>');
  return ctx;
}
