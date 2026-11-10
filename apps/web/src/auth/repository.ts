import { FirebaseError } from 'firebase/app';
import {
  type Auth,
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  linkWithCredential,
  type OAuthCredential,
  OAuthProvider,
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
import type { Functions } from 'firebase/functions';

import { callAction } from '../data/api';

import { parseClaims, type StoriesClaims, NO_CLAIMS } from './claims';
import { type AppUser, AuthFailure } from './models';

export interface AuthRepository {
  /** Calls back on sign-in, sign-out and profile updates. Returns an unsubscribe function. */
  onChange(callback: (user: AppUser | null) => void): () => void;
  /** Resolves to true when this sign-in also linked a remembered Zoho account (see signInWithZoho). */
  signInWithEmail(email: string, password: string): Promise<boolean | void>;
  createAccount(fullName: string, email: string, password: string): Promise<void>;
  /** Resolves to true when this sign-in also linked a remembered Zoho account. */
  signInWithGoogle(): Promise<boolean | void>;
  /**
   * Staff single sign-on with a Zoho (Mail) account. If the email already has
   * a Stories account, it fails with `linkRequired` and remembers the Zoho
   * sign-in: the next successful sign-in with that email links it.
   */
  signInWithZoho(): Promise<void>;
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

/** Zoho Accounts as a Firebase OpenID Connect provider (Authentication → Sign-in method → `oidc.zoho`). */
export const ZOHO_PROVIDER_ID = 'oidc.zoho';
function zohoProvider() {
  const provider = new OAuthProvider(ZOHO_PROVIDER_ID);
  provider.addScope('email');
  provider.addScope('profile');
  return provider;
}

export function firebaseAuthRepository(auth: Auth, db: Firestore, fns: Functions): AuthRepository {
  /** A Zoho sign-in refused because the email already has an account, waiting to be linked. */
  let pendingZoho: { credential: OAuthCredential; email: string } | null = null;

  /** Links the waiting Zoho sign-in to the account just signed in, if it is for the same email. */
  async function linkPendingZoho(user: User): Promise<boolean> {
    const pending = pendingZoho;
    pendingZoho = null;
    if (!pending || user.email?.toLowerCase() !== pending.email) return false;
    try {
      await linkWithCredential(user, pending.credential);
      return true;
    } catch (e) {
      // Signing in worked; linking is a convenience. The person can use Continue with Zoho Mail again later.
      console.warn('Could not link the Zoho account', e instanceof FirebaseError ? e.code : e);
      return false;
    }
  }

  return {
    // onIdTokenChanged also fires after updateProfile() + reload, unlike onAuthStateChanged.
    onChange: (cb) => onIdTokenChanged(auth, (u) => cb(toAppUser(u))),
    signInWithEmail: async (email, password) => {
      let linked = false;
      await guard(async () => {
        linked = await linkPendingZoho((await signInWithEmailAndPassword(auth, email.trim(), password)).user);
      });
      return linked;
    },
    createAccount: (fullName, email, password) =>
      guard(async () => {
        const { user } = await createUserWithEmailAndPassword(auth, email.trim(), password);
        await updateProfile(user, { displayName: fullName.trim() });
        await user.getIdToken(true);
        await sendEmailVerification(user);
      }),
    signInWithGoogle: async () => {
      let linked = false;
      await guard(async () => {
        linked = await linkPendingZoho((await signInWithPopup(auth, new GoogleAuthProvider().addScope('email'))).user);
      });
      return linked;
    },
    signInWithZoho: () =>
      guard(async () => {
        try {
          await signInWithPopup(auth, zohoProvider());
        } catch (e) {
          if (e instanceof FirebaseError && e.code === 'auth/account-exists-with-different-credential') {
            const credential = OAuthProvider.credentialFromError(e);
            const email = (e.customData?.email as string | undefined)?.toLowerCase();
            if (credential && email) pendingZoho = { credential, email };
          }
          throw e;
        }
      }),
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
      await callAction(fns, 'users-ensureProfile', {});
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
