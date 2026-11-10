// The days the website greets visitors on (from the Crossmaze website's list, plus the library days). Fixed dates are
// here; dates that move each year come from Google's calendar of Indian holidays (scripts/festival-dates.mjs
// writes them to dates.json at every build). The words for each are in text.ts, the drawings in designs/.
import * as days from './designs/days';
import * as festivals from './designs/festivals';
import * as festivals2 from './designs/festivals2';
import * as library from './designs/library';
import * as national from './designs/national';
import * as school from './designs/school';
import type { Occasion } from './types';

export const occasions: Occasion[] = [
  // National days
  { id: 'new-year', name: 'New Year', when: { fixed: [1, 1] }, keywords: ['new year'], designs: national.newYear },
  { id: 'republic-day', name: 'Republic Day', when: { fixed: [1, 26] }, keywords: ['republic day'], designs: national.republicDay },
  { id: 'independence-day', name: 'Independence Day', when: { fixed: [8, 15] }, keywords: ['independence day'], designs: national.independenceDay },
  { id: 'gandhi-jayanti', name: 'Gandhi Jayanti', when: { fixed: [10, 2] }, keywords: ['gandhi jayanti', 'gandhi'], designs: national.gandhiJayanti },
  { id: 'rajyotsava', name: 'Kannada Rajyotsava', when: { fixed: [11, 1] }, keywords: ['rajyotsava', 'karnataka'], designs: national.rajyotsava },

  // Library and reading days
  { id: 'childrens-book-day', name: "International Children's Book Day", when: { fixed: [4, 2] }, keywords: ["children's book", 'picture book'], designs: library.childrensBookDay },
  { id: 'world-book-day', name: 'World Book Day', when: { fixed: [4, 23] }, keywords: ['world book day', 'book day'], designs: library.worldBookDay },
  { id: 'reading-day', name: 'National Reading Day', when: { fixed: [6, 19] }, keywords: ['reading day'], designs: library.readingDay },
  { id: 'librarians-day', name: "National Librarians' Day", when: { fixed: [8, 12] }, keywords: ['librarian'], designs: library.librariansDay },
  { id: 'literacy-day', name: 'International Literacy Day', when: { fixed: [9, 8] }, keywords: ['literacy'], designs: library.literacyDay },

  // Family and children's days
  { id: 'womens-day', name: "Women's Day", when: { fixed: [3, 8] }, keywords: ["women's day", 'womens day'], designs: days.womensDay },
  { id: 'health-day', name: 'World Health Day', when: { fixed: [4, 7] }, keywords: ['health day'], designs: days.healthDay },
  { id: 'earth-day', name: 'Earth Day', when: { fixed: [4, 22] }, keywords: ['earth day'], designs: days.earthDay },
  { id: 'mothers-day', name: "Mother's Day", when: { nth: [2, 0, 5] }, keywords: ["mother's day", 'mothers day'], designs: days.mothersDay },
  { id: 'environment-day', name: 'World Environment Day', when: { fixed: [6, 5] }, keywords: ['environment day'], designs: days.environmentDay },
  { id: 'fathers-day', name: "Father's Day", when: { nth: [3, 0, 6] }, keywords: ["father's day", 'fathers day'], designs: days.fathersDay },
  { id: 'yoga-day', name: 'International Yoga Day', when: { fixed: [6, 21] }, keywords: ['yoga day', 'yoga'], designs: school.yogaDay },
  { id: 'doctors-day', name: "Doctors' Day", when: { fixed: [7, 1] }, keywords: ["doctors' day", 'doctors day'], designs: school.doctorsDay },
  { id: 'sports-day', name: 'National Sports Day', when: { fixed: [8, 29] }, keywords: ['sports day'], designs: school.sportsDay },
  { id: 'teachers-day', name: "Teachers' Day", when: { fixed: [9, 5] }, keywords: ["teachers' day", 'teachers day'], designs: school.teachersDay },
  { id: 'childrens-day', name: "Children's Day", when: { fixed: [11, 14] }, keywords: ["children's day", 'childrens day'], designs: school.childrensDay },

  // Festivals (the names are as Google's calendar writes them)
  { id: 'sankranti', name: 'Makar Sankranti and Pongal', when: { calendar: ['Makar Sankranti'] }, keywords: ['sankranti', 'pongal'], designs: festivals.sankranti },
  { id: 'holi', name: 'Holi', when: { calendar: ['Holi'] }, keywords: ['holi'], designs: festivals.holi },
  { id: 'ugadi', name: 'Ugadi', when: { calendar: ['Ugadi'] }, keywords: ['ugadi'], designs: festivals.ugadi },
  { id: 'good-friday', name: 'Good Friday', when: { calendar: ['Good Friday'] }, solemn: true, keywords: ['good friday', 'easter'], designs: festivals.goodFriday },
  { id: 'ram-navami', name: 'Ram Navami', when: { calendar: ['Rama Navami', 'Ram Navami'] }, keywords: ['ram navami', 'rama navami'], designs: festivals.ramNavami },
  { id: 'mahavir-jayanti', name: 'Mahavir Jayanti', when: { calendar: ['Mahavir Jayanti'] }, keywords: ['mahavir'], designs: festivals.mahavirJayanti },
  { id: 'eid-ul-fitr', name: 'Eid al-Fitr', when: { calendar: ['Ramzan Id', 'Eid al-Fitr', 'Id-ul-Fitr'] }, keywords: ['eid', 'ramzan', 'ramadan'], designs: festivals.eid },
  { id: 'raksha-bandhan', name: 'Raksha Bandhan', when: { calendar: ['Raksha Bandhan'] }, keywords: ['raksha bandhan', 'rakhi'], designs: festivals2.rakshaBandhan },
  { id: 'janmashtami', name: 'Janmashtami', when: { calendar: ['Janmashtami'] }, keywords: ['janmashtami', 'krishna'], designs: festivals2.janmashtami },
  { id: 'onam', name: 'Onam', when: { calendar: ['Onam'] }, keywords: ['onam'], designs: festivals2.onam },
  { id: 'ganesh-chaturthi', name: 'Ganesh Chaturthi', when: { calendar: ['Ganesh Chaturthi'] }, keywords: ['ganesh', 'ganesha', 'vinayaka'], designs: festivals2.ganeshChaturthi },
  { id: 'dussehra', name: 'Dussehra', when: { calendar: ['Dussehra'] }, keywords: ['dussehra', 'dasara', 'navratri', 'navaratri'], designs: festivals2.dussehra },
  { id: 'diwali', name: 'Diwali', when: { calendar: ['Diwali/Deepavali', 'Diwali'] }, keywords: ['diwali', 'deepavali'], designs: festivals.diwali },
  { id: 'guru-nanak-jayanti', name: 'Guru Nanak Jayanti', when: { calendar: ['Guru Nanak Jayanti'] }, keywords: ['guru nanak', 'gurpurab'], designs: festivals2.guruNanakJayanti },
  { id: 'christmas', name: 'Christmas', when: { fixed: [12, 25] }, keywords: ['christmas'], designs: festivals.christmas },
];

export const occasionById = (id: string) => occasions.find((o) => o.id === id);
