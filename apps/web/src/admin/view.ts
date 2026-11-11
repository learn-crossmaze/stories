import { paths } from '../paths';

/** Where the team's attendance and leave pages are (one place each, in the Staff part of the menu). */
export function useTeamPaths() {
  return { attendance: paths.adminAttendance, leave: paths.adminLeave };
}
