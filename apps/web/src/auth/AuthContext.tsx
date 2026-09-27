import { createContext, type ReactNode, useContext, useEffect, useState } from 'react';

import { NO_CLAIMS, type StoriesClaims } from './claims';
import type { AppUser } from './models';
import type { AuthRepository, UserProfile } from './repository';

interface AuthState {
  repo: AuthRepository;
  /** `undefined` until the first auth event arrives. */
  user: AppUser | null | undefined;
  claims: StoriesClaims;
  profile: UserProfile | null;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ repo, children }: { repo: AuthRepository; children: ReactNode }) {
  const [user, setUser] = useState<AppUser | null | undefined>(undefined);
  const [claims, setClaims] = useState<StoriesClaims>(NO_CLAIMS);
  const [profile, setProfile] = useState<UserProfile | null>(null);

  useEffect(
    () =>
      repo.onChange((u) => {
        // Resolve claims before exposing the user so guards never see a
        // signed-in user with not-yet-loaded permissions.
        if (!u) {
          setClaims(NO_CLAIMS);
          setUser(null);
          return;
        }
        repo.getClaims().then(
          (c) => {
            setClaims(c);
            setUser(u);
          },
          () => setUser(u),
        );
      }),
    [repo],
  );

  const uid = user?.uid;
  useEffect(() => {
    if (!uid) {
      setProfile(null);
      return;
    }
    let ensured = false;
    return repo.watchProfile(uid, (p) => {
      setProfile(p);
      if (!p && !ensured) {
        ensured = true;
        repo.ensureProfile().catch((e) => console.warn('ensureProfile failed', e));
      }
    });
  }, [repo, uid]);

  // Roles changed on the server (claims sync bumps claimsVersion): refresh the
  // ID token so rules and the UI see the new permissions within seconds.
  const serverVersion = profile?.claimsVersion ?? 0;
  useEffect(() => {
    if (uid && serverVersion > claims.v) repo.getClaims(true).then(setClaims, () => undefined);
  }, [repo, uid, serverVersion, claims.v]);

  return <AuthContext.Provider value={{ repo, user, claims, profile }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
