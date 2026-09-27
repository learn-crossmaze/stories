import './styles.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';

import { AuthProvider } from './auth/AuthContext';
import { firebaseAuthRepository } from './auth/repository';
import { initFirebase } from './config/firebase';
import { routes } from './routes';

const root = createRoot(document.getElementById('root')!);

try {
  const { auth } = initFirebase();
  const repo = firebaseAuthRepository(auth);
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
