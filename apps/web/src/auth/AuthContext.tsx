import { createContext, type ReactNode, useContext, useEffect, useState } from 'react';

import type { AppUser } from './models';
import type { AuthRepository } from './repository';

interface AuthState {
  repo: AuthRepository;
  /** `undefined` until the first auth event arrives. */
  user: AppUser | null | undefined;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ repo, children }: { repo: AuthRepository; children: ReactNode }) {
  const [user, setUser] = useState<AppUser | null | undefined>(undefined);
  useEffect(() => repo.onChange(setUser), [repo]);
  return <AuthContext.Provider value={{ repo, user }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
