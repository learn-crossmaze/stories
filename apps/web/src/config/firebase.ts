import { initializeApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
import { connectAuthEmulator, getAuth } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore';
import { connectFunctionsEmulator, getFunctions } from 'firebase/functions';

import { env, firebaseOptions } from './env';

/** Cloud Functions region (functions/src/core/firebase.ts). */
export const FUNCTIONS_REGION = 'asia-south1';

/** Initializes Firebase for the configured environment. */
export function initFirebase() {
  const app = initializeApp(firebaseOptions());
  const auth = getAuth(app);
  const db = getFirestore(app);
  const fns = getFunctions(app, FUNCTIONS_REGION);

  if (env.useEmulators) {
    connectAuthEmulator(auth, `http://${env.emulatorHost}:9099`, { disableWarnings: true });
    connectFirestoreEmulator(db, env.emulatorHost, 8080);
    connectFunctionsEmulator(fns, env.emulatorHost, 5001);
  } else if (env.appCheckKey) {
    initializeAppCheck(app, {
      provider: new ReCaptchaEnterpriseProvider(env.appCheckKey),
      isTokenAutoRefreshEnabled: true,
    });
  }
  return { app, auth, db, fns };
}
