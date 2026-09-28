import './styles.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';

import { applyAppearance, loadAppearance } from './appearance';
import { AuthProvider } from './auth/AuthContext';
import { firebaseAuthRepository } from './auth/repository';
import { initFirebase } from './config/firebase';
import { setServices } from './data/services';
import { routes } from './routes';

// Personal appearance; a "system" theme follows the device's light/dark switch while the app is open.
applyAppearance(loadAppearance());
window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener('change', () => applyAppearance(loadAppearance()));

const root = createRoot(document.getElementById('root')!);

try {
  const { auth, db, fns } = initFirebase();
  setServices({ db, fns });
  const repo = firebaseAuthRepository(auth, db, fns);
  const router = createBrowserRouter(routes);
  root.render(
    <StrictMode>
      <AuthProvider repo={repo}>
        <RouterProvider router={router} />
      </AuthProvider>
    </StrictMode>,
  );
} catch (e) {
  // Never leave a blank page: show what failed so it can be fixed.
  console.error(e);
  root.render(
    <div className="empty-state" role="alert">
      <h2>Stories couldn't start</h2>
      <p>{e instanceof Error ? e.message : String(e)}</p>
    </div>,
  );
}
