import './styles.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';

import { AuthProvider } from './auth/AuthContext';
import { firebaseAuthRepository } from './auth/repository';
import { initFirebase } from './config/firebase';
import { routes } from './routes';

const { auth } = initFirebase();
const repo = firebaseAuthRepository(auth);
const router = createBrowserRouter(routes);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider repo={repo}>
      <RouterProvider router={router} />
    </AuthProvider>
  </StrictMode>,
);
