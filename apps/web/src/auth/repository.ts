import { FirebaseError } from 'firebase/app';
import {
  type Auth,
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  onIdTokenChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
  type User,
} from 'firebase/auth';

import { doc, type Firestore, onSnapshot } from 'firebase/firestore';
import { type Functions, httpsCallable } from 'firebase/functions';

import { parseClaims, type StoriesClaims, NO_CLAIMS } from './claims';
import { type AppUser, AuthFailure } from './models';

export interface AuthRepository {
  /** Calls back on sign-in, sign-out and profile updates. Returns an unsubscribe function. */
  onChange(callback: (user: AppUser | null) => void): () => void;
  signInWithEmail(email: string, password: string): Promise<void>;
  createAccount(fullName: string, email: string, password: string): Promise<void>;
  signInWithGoogle(): Promise<void>;
  sendPasswordReset(email: string): Promise<void>;
  signOut(): Promise<void>;
  /** Current role claims; `forceRefresh` fetches a new ID token (after a role change). */
  getClaims(forceRefresh?: boolean): Promise<StoriesClaims>;
  /** Watches users/{uid}; `null` while it doesn't exist yet. */
  watchProfile(uid: string, callback: (profile: UserProfile | null) => void): () => void;
  /** Creates users/{uid} on first sign-in (server-side). */
  ensureProfile(): Promise<void>;
  resendVerification(): Promise<void>;
  /** Reloads the user (e.g. to pick up a just-verified email) and refreshes the token. */
  reload(): Promise<void>;
}

export interface UserProfile {
  uid: string;
  displayName: string | null;
  email: string | null;
  platformRoles: string[];
  claimsVersion: number;
  status: 'ACTIVE' | 'DISABLED';
}

const toAppUser = (u: User | null): AppUser | null =>
  u && { uid: u.uid, email: u.email, displayName: u.displayName, emailVerified: u.emailVerified };

async function guard(action: () => Promise<unknown>): Promise<void> {
  try {
    await action();
  } catch (e) {
    if (e instanceof FirebaseError) {
      // Unknown codes surface as a generic message; keep the code for diagnostics.
      console.warn('Auth error code:', e.code);
      throw AuthFailure.fromFirebaseCode(e.code);
    }
    throw e;
  }
}

export function firebaseAuthRepository(auth: Auth, db: Firestore, fns: Functions): AuthRepository {
  return {
    // onIdTokenChanged also fires after updateProfile() + reload, unlike onAuthStateChanged.
    onChange: (cb) => onIdTokenChanged(auth, (u) => cb(toAppUser(u))),
    signInWithEmail: (email, password) =>
      guard(() => signInWithEmailAndPassword(auth, email.trim(), password)),
    createAccount: (fullName, email, password) =>
      guard(async () => {
        const { user } = await createUserWithEmailAndPassword(auth, email.trim(), password);
        await updateProfile(user, { displayName: fullName.trim() });
        await user.getIdToken(true);
        await sendEmailVerification(user);
      }),
    signInWithGoogle: () =>
      guard(() => signInWithPopup(auth, new GoogleAuthProvider().addScope('email'))),
    sendPasswordReset: (email) => guard(() => sendPasswordResetEmail(auth, email.trim())),
    signOut: () => signOut(auth),
    getClaims: async (forceRefresh = false) =>
      auth.currentUser ? parseClaims((await auth.currentUser.getIdTokenResult(forceRefresh)).claims) : NO_CLAIMS,
    watchProfile: (uid, cb) =>
      onSnapshot(
        doc(db, `users/${uid}`),
        (snap) => cb(snap.exists() ? (snap.data() as UserProfile) : null),
        () => cb(null),
      ),
    ensureProfile: async () => {
      await httpsCallable(fns, 'users-ensureProfile')({});
    },
    resendVerification: async () => {
      if (auth.currentUser) await guard(() => sendEmailVerification(auth.currentUser!));
    },
    reload: async () => {
      if (!auth.currentUser) return;
      await auth.currentUser.reload();
      await auth.currentUser.getIdToken(true);
    },
  };
}
