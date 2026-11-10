import './styles.css';
import './member/memberTheme.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';

import { AuthProvider } from './auth/AuthContext';
import { firebaseAuthRepository } from './auth/repository';
import { initFirebase } from './config/firebase';
import { setServices } from './data/services';
import { memberRoutes } from './memberRoutes';
import { applyAppearance, loadAppearance } from './shared/appearance';
import { installGlobalErrorReporting, reportError } from './shared/reportError';
import { installChunkReload } from './shared/staleChunks';

// The member area: members' pages only, served by the website at /account (vite.member.config.ts, docs/SITE.md).
installGlobalErrorReporting();
installChunkReload();
applyAppearance(loadAppearance());
window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener('change', () => applyAppearance(loadAppearance()));

export const MEMBER_BASE = '/account';
const root = createRoot(document.getElementById('root')!);

try {
  const { auth, db, fns } = initFirebase();
  setServices({ db, fns });
  const repo = firebaseAuthRepository(auth, db, fns);
  const router = createBrowserRouter(memberRoutes, { basename: MEMBER_BASE });
  root.render(
    <StrictMode>
      <AuthProvider repo={repo}>
        <RouterProvider router={router} />
      </AuthProvider>
    </StrictMode>,
  );
} catch (e) {
  reportError(e, 'startup');
  root.render(
    <div className="empty-state" role="alert">
      <h2>Your account couldn't open</h2>
      <p>{e instanceof Error ? e.message : String(e)}</p>
    </div>,
  );
}
