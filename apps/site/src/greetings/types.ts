// Festival and special-day greetings: the shapes shared by the occasion list, the card drawings and the
// website's greeting bar (src/scripts/greetings.ts). See README, "Festival greetings".

/** A deterministic random number generator: the same seed always gives the same numbers. */
export type Rng = () => number;

/** The colours of a card, taken from the website's colour theme of the day. */
export interface Palette {
  /** Three soft background colours, blended. */
  bg: [string, string, string];
  /** Text and outlines. */
  ink: string;
  /** The two ends of the title's gradient. */
  head: [string, string];
  /** Bright colours for the drawing (balloons, petals, flags…). */
  acc: string[];
}

/**
 * One drawing for an occasion. It returns SVG markup for the illustration area: viewBox 0 0 1080 680,
 * kept inside x 30–1050 and y 10–650. The card adds the logo above it and the text panel below it.
 * `r` is seeded by occasion and year, so the arrangement changes every year but never on reload.
 */
export type Design = (r: Rng, p: Palette) => string;

/** When an occasion falls. */
export type When =
  /** The same date every year (month 1–12). */
  | { fixed: [month: number, day: number] }
  /** The nth weekday of a month: Mother's Day is the 2nd Sunday (weekday 0) of May. */
  | { nth: [n: number, weekday: number, month: number] }
  /** A date that moves every year, from Google's calendar of Indian holidays (src/greetings/dates.json). */
  | { calendar: string[] };

export interface Occasion {
  /** Short id, used in dates.json and the greeting bar. */
  id: string;
  /** Its name as visitors know it: "Diwali", "Children's Day". */
  name: string;
  when: When;
  /** A solemn day (Good Friday): a quiet greeting, no celebration words, no admissions box. */
  solemn?: boolean;
  /** Words that find the school's blog post about it ("Diwali celebrations at Neotown"). */
  keywords: string[];
  /** The drawings, used in turn year by year. */
  designs: Design[];
}

/** The words for an occasion (src/greetings/text.ts). Lists are used in turn, year by year. */
export interface OccasionText {
  /** The small coloured label above the title: "Festival of lights". */
  eyebrow: string;
  /** The card's big title. `year` is the year of the greeting. Keep it under about 22 characters. */
  title: (year: number) => string;
  /** One short line on the card under the title (about 70 characters at most), or a function of the year. */
  wishes: (string | ((year: number) => string))[];
  /** The pop-up's heading: "Happy Diwali from Crossmaze". */
  heading: string;
  /** What the day is and how it is marked: one or two sentences, general and widely known. */
  about: string;
  /** What little ones can learn from it or enjoy: one sentence. Simple HTML (<b>) allowed. */
  little: string;
  /** "Try this at home": something a parent can do with a 2 to 6 year old, and what it helps with. */
  activities: string[];
  /** The greeting bar's line after the name: "Wishing every family a bright and happy festival of lights." */
  bar: string;
}

/**
 * An admin's choice for one day's card in one year (site.greetings.picks, keyed "<id>-<year>"), made on the
 * admin panel's Festival greetings page. Anything left out stays automatic.
 */
export interface CardPick {
  /** Which of the occasion's designs to draw (instead of taking turns by year). */
  design?: number;
  /** A different arrangement of the drawing (older choices). */
  seed?: number;
  /** A new drawing from the card maker ("Try another"): its seed (src/greetings/maker.ts). */
  gen?: number;
  /** The admin's own words for the card, instead of the year's wish. */
  wish?: string;
  /** The admin's own picture instead of a drawing: a Storage path in Firestore, a page address on the website. */
  photo?: string;
}

/** The key of a pick: "diwali-2026". */
export const pickKey = (id: string, year: number) => `${id}-${year}`;
