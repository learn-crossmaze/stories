import { act, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { StoriesClaims } from '../auth/claims';
import type { Branch, Org } from '../data/org';

let claims: StoriesClaims = { v: 1, sa: false, o: {} };
const getOrgs = vi.fn<(ids: string[]) => Promise<Org[]>>();
const listAllOrgs = vi.fn<() => Promise<Org[]>>();
const listBranches = vi.fn<(orgId: string) => Promise<Branch[]>>();

vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ user: { uid: 'u1' }, claims }) }));
vi.mock('../data/org', () => ({
  getOrgs: (ids: string[]) => getOrgs(ids),
  listAllOrgs: () => listAllOrgs(),
  listBranches: (orgId: string) => listBranches(orgId),
}));

const { likelyOrgId, useWorkspace, WorkspaceProvider } = await import('../admin/Workspace');

const org = (id: string) => ({ id, name: id.toUpperCase(), status: 'ACTIVE' }) as Org;
const branch = (id: string) => ({ id, code: id, name: id, status: 'ACTIVE' }) as Branch;
/** A read answered by hand. */
function pending<T>() {
  let resolve: (v: T) => void = () => undefined;
  let reject: (e: unknown) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

interface Seen {
  org: string | null;
  branch: string | null;
  branches: string[];
  loading: boolean;
  error: string | null;
}
let seen: Seen[] = [];
let workspace: ReturnType<typeof useWorkspace>;
function Probe() {
  workspace = useWorkspace();
  seen.push({
    org: workspace.org?.id ?? null,
    branch: workspace.branch?.id ?? null,
    branches: workspace.branches.map((b) => b.id),
    loading: workspace.branchesLoading,
    error: workspace.branchesError,
  });
  return null;
}
const mount = () =>
  render(
    <WorkspaceProvider>
      <Probe />
    </WorkspaceProvider>,
  );
const last = () => seen[seen.length - 1];
/** Every render so far paired an organization only with its own branches, and never said "loaded" before they were in. */
const neverMixed = (own: Record<string, string[]>) => {
  for (const s of seen) {
    if (s.org === null) {
      expect(s.branches).toEqual([]);
      expect(s.branch).toBeNull();
      continue;
    }
    for (const b of s.branches) expect(own[s.org]).toContain(b);
    if (s.branch) expect(own[s.org]).toContain(s.branch);
    if (!s.loading && !s.error) expect(s.branches).toEqual(own[s.org]);
  }
};

beforeEach(() => {
  localStorage.clear();
  seen = [];
  claims = { v: 1, sa: false, o: { beta: { r: ['OWN'], b: ['*'] }, alpha: { r: ['OWN'], b: ['*'] } } };
  getOrgs.mockReset();
  listAllOrgs.mockReset();
  listBranches.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('the organization whose branches are read alongside the organizations', () => {
  it('is the one this browser remembers, if the person is still in it, else the first by id', () => {
    const o = { beta: { r: [], b: [] }, alpha: { r: [], b: [] } };
    expect(likelyOrgId({ sa: false, o }, 'beta')).toBe('beta');
    expect(likelyOrgId({ sa: false, o }, null)).toBe('alpha');
    expect(likelyOrgId({ sa: false, o }, 'gone')).toBe('alpha');
    expect(likelyOrgId({ sa: false, o: {} }, 'gone')).toBeNull();
  });

  it('for a Super Admin is only the remembered one (their list is not in the claims)', () => {
    expect(likelyOrgId({ sa: true, o: {} }, 'beta')).toBe('beta');
    expect(likelyOrgId({ sa: true, o: {} }, null)).toBeNull();
  });
});

describe('WorkspaceProvider', () => {
  it('asks for the branches before the organizations have answered, and only once when the guess was right', async () => {
    const orgs = pending<Org[]>();
    getOrgs.mockReturnValue(orgs.promise);
    listBranches.mockResolvedValue([branch('a1'), branch('a2')]);
    mount();
    await waitFor(() => expect(listBranches).toHaveBeenCalledWith('alpha'));
    expect(getOrgs).toHaveBeenCalledWith(['alpha', 'beta']);
    // The branches are in, the organization is not: nothing is shown as loaded yet.
    await act(async () => undefined);
    expect(last()).toMatchObject({ org: null, branch: null, branches: [], loading: true });

    await act(async () => orgs.resolve([org('alpha'), org('beta')]));
    expect(last()).toMatchObject({ org: 'alpha', branch: 'a1', branches: ['a1', 'a2'], loading: false });
    expect(listBranches).toHaveBeenCalledTimes(1);
    neverMixed({ alpha: ['a1', 'a2'] });
    // Remembered for the next visit, also for someone who never used the switcher.
    expect(localStorage.getItem('stories.org.u1')).toBe('alpha');
  });

  it('starts from the remembered organization', async () => {
    localStorage.setItem('stories.org.u1', 'beta');
    getOrgs.mockResolvedValue([org('alpha'), org('beta')]);
    listBranches.mockResolvedValue([branch('b1')]);
    mount();
    await waitFor(() => expect(last()).toMatchObject({ org: 'beta', branch: 'b1', loading: false }));
    expect(listBranches.mock.calls).toEqual([['beta']]);
    neverMixed({ beta: ['b1'] });
  });

  it('reads again when the organization turns out to be another, and never shows the first one’s branches', async () => {
    // The remembered organization was deleted: the claims still name it, the read no longer returns it.
    localStorage.setItem('stories.org.u1', 'alpha');
    const orgs = pending<Org[]>();
    const second = pending<Branch[]>();
    getOrgs.mockReturnValue(orgs.promise);
    listBranches.mockImplementation((id) => (id === 'alpha' ? Promise.resolve([branch('a1')]) : second.promise));
    mount();
    await waitFor(() => expect(listBranches).toHaveBeenCalledWith('alpha'));
    await act(async () => orgs.resolve([org('beta')]));
    expect(last()).toMatchObject({ org: 'beta', branch: null, branches: [], loading: true });
    await waitFor(() => expect(listBranches).toHaveBeenCalledWith('beta'));
    await act(async () => second.resolve([branch('b1')]));
    expect(last()).toMatchObject({ org: 'beta', branch: 'b1', branches: ['b1'], loading: false });
    expect(listBranches).toHaveBeenCalledTimes(2);
    neverMixed({ beta: ['b1'] });
  });

  it('says "loading" from the moment the organization is known until its own branches are in', async () => {
    const rows = pending<Branch[]>();
    getOrgs.mockResolvedValue([org('alpha'), org('beta')]);
    listBranches.mockReturnValue(rows.promise);
    mount();
    await waitFor(() => expect(last().org).toBe('alpha'));
    expect(seen.filter((s) => s.org === 'alpha').every((s) => s.loading)).toBe(true);
    await act(async () => rows.resolve([branch('a1')]));
    expect(last()).toMatchObject({ org: 'alpha', branch: 'a1', loading: false });
    neverMixed({ alpha: ['a1'] });
  });

  it('switching organization never pairs the new one with the old one’s branch', async () => {
    getOrgs.mockResolvedValue([org('alpha'), org('beta')]);
    const beta = pending<Branch[]>();
    listBranches.mockImplementation((id) => (id === 'alpha' ? Promise.resolve([branch('a1')]) : beta.promise));
    mount();
    await waitFor(() => expect(last()).toMatchObject({ org: 'alpha', branch: 'a1', loading: false }));
    act(() => workspace.setOrgId('beta'));
    expect(last()).toMatchObject({ org: 'beta', branch: null, branches: [], loading: true });
    await act(async () => beta.resolve([branch('b1'), branch('b2')]));
    expect(last()).toMatchObject({ org: 'beta', branch: 'b1', loading: false });
    neverMixed({ alpha: ['a1'], beta: ['b1', 'b2'] });
  });

  it('a Super Admin with nothing remembered waits for the organizations, as before', async () => {
    claims = { v: 1, sa: true, o: {} };
    const orgs = pending<Org[]>();
    listAllOrgs.mockReturnValue(orgs.promise);
    listBranches.mockResolvedValue([branch('a1')]);
    mount();
    await act(async () => undefined);
    expect(listBranches).not.toHaveBeenCalled();
    expect(last()).toMatchObject({ org: null, loading: true });
    await act(async () => orgs.resolve([org('alpha')]));
    await waitFor(() => expect(last()).toMatchObject({ org: 'alpha', branch: 'a1', loading: false }));
    expect(listBranches.mock.calls).toEqual([['alpha']]);
    neverMixed({ alpha: ['a1'] });
  });

  it('with no organization at all shows nothing and stops loading', async () => {
    getOrgs.mockResolvedValue([]);
    listBranches.mockResolvedValue([branch('a1')]);
    mount();
    await waitFor(() => expect(last()).toMatchObject({ org: null, branch: null, branches: [], loading: false }));
    neverMixed({});
  });

  it('reports a failed branches read only for the organization in use, and stops loading', async () => {
    getOrgs.mockResolvedValue([org('alpha')]);
    listBranches.mockRejectedValue(new Error('offline'));
    mount();
    await waitFor(() => expect(last()).toMatchObject({ org: 'alpha', branches: [], loading: false }));
    expect(last().error).toBeTruthy();
    // Try again really reads again.
    listBranches.mockResolvedValue([branch('a1')]);
    act(() => workspace.reloadBranches());
    await waitFor(() => expect(last()).toMatchObject({ org: 'alpha', branch: 'a1', loading: false, error: null }));
  });

  it('reloadBranches refreshes behind the list (Branches page, settings pages after a save)', async () => {
    getOrgs.mockResolvedValue([org('alpha')]);
    listBranches.mockResolvedValueOnce([branch('a1')]).mockResolvedValueOnce([branch('a1'), branch('a2')]);
    mount();
    await waitFor(() => expect(last()).toMatchObject({ branches: ['a1'], loading: false }));
    const from = seen.length;
    act(() => workspace.reloadBranches());
    await waitFor(() => expect(last().branches).toEqual(['a1', 'a2']));
    expect(seen.slice(from).every((s) => !s.loading && s.org === 'alpha')).toBe(true);
  });
});
