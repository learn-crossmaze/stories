// Is today (in India) one of the greeting days? Small on purpose: every page runs it, and the card engine
// (ui.ts) loads only when the answer is yes.
import { datesTable, indiaToday, occasionsOn } from './calendar';
import dates from './dates.json';
import { schedule } from './schedule';

const table = datesTable(dates.events, schedule);

export const greetingDaysOn = (iso = indiaToday()) => occasionsOn(iso, schedule, table);
