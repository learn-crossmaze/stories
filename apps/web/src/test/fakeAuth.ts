import type { AppUser } from '../auth/models';
import type { AuthRepository } from '../auth/repository';

/** In-memory AuthRepository: any 8+ char password signs in; `fail` forces an error. */
export function fakeAuth(initial: AppUser | null = null) {
  let user = initial;
  const listeners = new Set<(u: AppUser | null) => void>();
  const emit = () => listeners.forEach((l) => l(user));
  const repo: AuthRepository & { fail?: Error } = {
    onChange(cb) {
      listeners.add(cb);
      cb(user);
      return () => listeners.delete(cb);
    },
    async signInWithEmail(email) {
      if (repo.fail) throw repo.fail;
      user = { uid: 'u1', email, displayName: null, emailVerified: true };
      emit();
    },
    async createAccount(fullName, email) {
      if (repo.fail) throw repo.fail;
      user = { uid: 'u1', email, displayName: fullName, emailVerified: false };
      emit();
    },
    async signInWithGoogle() {
      if (repo.fail) throw repo.fail;
    },
    async sendPasswordReset() {
      if (repo.fail) throw repo.fail;
    },
    async signOut() {
      user = null;
      emit();
    },
  };
  return repo;
}
