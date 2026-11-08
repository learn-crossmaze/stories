import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

if (!getApps().length) initializeApp();

export const db = getFirestore();
export const auth = getAuth();

export const REGION = 'asia-south1';

/** App Check is enforced once it is registered for the web app (docs/DEPLOYMENT.md, one-time steps). */
export const ENFORCE_APP_CHECK = process.env.ENFORCE_APP_CHECK === 'true';
