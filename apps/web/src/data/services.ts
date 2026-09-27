import type { Firestore } from 'firebase/firestore';
import type { Functions } from 'firebase/functions';

// Set once at startup (main.tsx); feature code reads Firebase through here so
// tests can render screens without initializing Firebase.
let current: { db: Firestore; fns: Functions } | null = null;

export function setServices(s: { db: Firestore; fns: Functions }) {
  current = s;
}

export function services() {
  if (!current) throw new Error('Firebase services are not initialized');
  return current;
}
