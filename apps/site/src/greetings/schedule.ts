// When each greeting falls (no drawings), so every page can check today's date cheaply; the drawings and words
// load only on the days there is a greeting (occasions.ts, ui.ts).
import type { Occasion } from './types';

export type ScheduleEntry = Pick<Occasion, 'id' | 'name' | 'when' | 'solemn'>;

export const schedule: ScheduleEntry[] = [
  { id: 'new-year', name: 'New Year', when: { fixed: [1, 1] } },
  { id: 'republic-day', name: 'Republic Day', when: { fixed: [1, 26] } },
  { id: 'independence-day', name: 'Independence Day', when: { fixed: [8, 15] } },
  { id: 'gandhi-jayanti', name: 'Gandhi Jayanti', when: { fixed: [10, 2] } },
  { id: 'rajyotsava', name: 'Kannada Rajyotsava', when: { fixed: [11, 1] } },
  { id: 'childrens-book-day', name: "International Children's Book Day", when: { fixed: [4, 2] } },
  { id: 'world-book-day', name: 'World Book Day', when: { fixed: [4, 23] } },
  { id: 'reading-day', name: 'National Reading Day', when: { fixed: [6, 19] } },
  { id: 'librarians-day', name: "National Librarians' Day", when: { fixed: [8, 12] } },
  { id: 'literacy-day', name: 'International Literacy Day', when: { fixed: [9, 8] } },
  { id: 'womens-day', name: "Women's Day", when: { fixed: [3, 8] } },
  { id: 'health-day', name: 'World Health Day', when: { fixed: [4, 7] } },
  { id: 'earth-day', name: 'Earth Day', when: { fixed: [4, 22] } },
  { id: 'mothers-day', name: "Mother's Day", when: { nth: [2, 0, 5] } },
  { id: 'environment-day', name: 'World Environment Day', when: { fixed: [6, 5] } },
  { id: 'fathers-day', name: "Father's Day", when: { nth: [3, 0, 6] } },
  { id: 'yoga-day', name: 'International Yoga Day', when: { fixed: [6, 21] } },
  { id: 'doctors-day', name: "Doctors' Day", when: { fixed: [7, 1] } },
  { id: 'sports-day', name: 'National Sports Day', when: { fixed: [8, 29] } },
  { id: 'teachers-day', name: "Teachers' Day", when: { fixed: [9, 5] } },
  { id: 'childrens-day', name: "Children's Day", when: { fixed: [11, 14] } },
  { id: 'sankranti', name: 'Makar Sankranti and Pongal', when: { calendar: ['Makar Sankranti'] } },
  { id: 'holi', name: 'Holi', when: { calendar: ['Holi'] } },
  { id: 'ugadi', name: 'Ugadi', when: { calendar: ['Ugadi'] } },
  { id: 'good-friday', name: 'Good Friday', when: { calendar: ['Good Friday'] }, solemn: true },
  { id: 'ram-navami', name: 'Ram Navami', when: { calendar: ['Rama Navami', 'Ram Navami'] } },
  { id: 'mahavir-jayanti', name: 'Mahavir Jayanti', when: { calendar: ['Mahavir Jayanti'] } },
  { id: 'eid-ul-fitr', name: 'Eid al-Fitr', when: { calendar: ['Ramzan Id', 'Eid al-Fitr', 'Id-ul-Fitr'] } },
  { id: 'raksha-bandhan', name: 'Raksha Bandhan', when: { calendar: ['Raksha Bandhan'] } },
  { id: 'janmashtami', name: 'Janmashtami', when: { calendar: ['Janmashtami'] } },
  { id: 'onam', name: 'Onam', when: { calendar: ['Onam'] } },
  { id: 'ganesh-chaturthi', name: 'Ganesh Chaturthi', when: { calendar: ['Ganesh Chaturthi'] } },
  { id: 'dussehra', name: 'Dussehra', when: { calendar: ['Dussehra'] } },
  { id: 'diwali', name: 'Diwali', when: { calendar: ['Diwali/Deepavali', 'Diwali'] } },
  { id: 'guru-nanak-jayanti', name: 'Guru Nanak Jayanti', when: { calendar: ['Guru Nanak Jayanti'] } },
  { id: 'christmas', name: 'Christmas', when: { fixed: [12, 25] } },
];
