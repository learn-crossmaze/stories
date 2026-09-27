import { initializeApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
import { connectAuthEmulator, getAuth } from 'firebase/auth';

import { env, firebaseOptions } from './env';

// Firestore is added here (with connectFirestoreEmulator on :8080) when the
// first feature reads data; leaving it out keeps the bundle small until then.

/** Initializes Firebase for the configured environment. */
export function initFirebase() {
  const app = initializeApp(firebaseOptions());
  const auth = getAuth(app);

  if (env.useEmulators) {
    connectAuthEmulator(auth, `http://${env.emulatorHost}:9099`, { disableWarnings: true });
  } else if (env.appCheckKey) {
    initializeAppCheck(app, {
      provider: new ReCaptchaEnterpriseProvider(env.appCheckKey),
      isTokenAutoRefreshEnabled: true,
    });
  }
  return { app, auth };
}
