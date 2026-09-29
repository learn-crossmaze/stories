import { createContext, useContext } from 'react';

import type { ViewId } from '../auth/claims';
import { paths } from '../paths';

/** The view (Admin, Operations, Staff) the current page is shown in. */
export const ViewContext = createContext<ViewId>('admin');
export const useView = () => useContext(ViewContext);

/** Attendance and leave pages exist in both Admin and Operations: link within the current view. */
export function useTeamPaths() {
  const view = useView();
  return view === 'ops' ? { attendance: paths.opsAttendance, leave: paths.opsLeave } : { attendance: paths.adminAttendance, leave: paths.adminLeave };
}
