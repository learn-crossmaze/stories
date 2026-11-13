import '@testing-library/jest-dom/vitest';

import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
  // Lists a page keeps for the browser tab (e.g. what Receive books received) must not leak into the next test.
  sessionStorage.clear();
});

// Pages load on demand (lazy routes), which can take more than Testing Library's default second on a busy or slower
// computer (e.g. a Windows laptop running `npm run publish:all`). Wait up to 5 seconds before calling it missing.
configure({ asyncUtilTimeout: 5000 });
