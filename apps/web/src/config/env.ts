import type { FirebaseOptions } from 'firebase/app';

// Build-time configuration from `.env.<mode>` (see apps/web/README.md).
const e = import.meta.env;

export type Flavor = 'dev' | 'staging' | 'prod';

export const env = {
  flavor: (e.VITE_STORIES_FLAVOR ?? 'dev') as Flavor,
  useEmulators: e.VITE_USE_EMULATORS === 'true',
  emulatorHost: e.VITE_EMULATOR_HOST || 'localhost',
  /** reCAPTCHA Enterprise site key for App Check. Empty disables App Check. */
  appCheckKey: e.VITE_APP_CHECK_RECAPTCHA_ENTERPRISE_KEY ?? '',
};

export function firebaseOptions(): FirebaseOptions {
  const projectId = e.VITE_FIREBASE_PROJECT_ID;
  const apiKey = e.VITE_FIREBASE_API_KEY;
  const appId = e.VITE_FIREBASE_APP_ID;
  if (!projectId || !apiKey || !appId) {
    throw new Error('Firebase is not configured. Run with --mode emulator (or dev/staging/prod).');
  }
  return {
    projectId,
    apiKey,
    appId,
    messagingSenderId: e.VITE_FIREBASE_MESSAGING_SENDER_ID || undefined,
    authDomain: e.VITE_FIREBASE_AUTH_DOMAIN || undefined,
    storageBucket: e.VITE_FIREBASE_STORAGE_BUCKET || undefined,
    measurementId: e.VITE_FIREBASE_MEASUREMENT_ID || undefined,
  };
}
