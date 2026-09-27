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

import { type AppUser, AuthFailure } from './models';

export interface AuthRepository {
  /** Calls back on sign-in, sign-out and profile updates. Returns an unsubscribe function. */
  onChange(callback: (user: AppUser | null) => void): () => void;
  signInWithEmail(email: string, password: string): Promise<void>;
  createAccount(fullName: string, email: string, password: string): Promise<void>;
  signInWithGoogle(): Promise<void>;
  sendPasswordReset(email: string): Promise<void>;
  signOut(): Promise<void>;
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

export function firebaseAuthRepository(auth: Auth): AuthRepository {
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
  };
}
