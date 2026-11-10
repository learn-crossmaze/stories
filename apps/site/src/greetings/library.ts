// What makes the greetings a library's: for every day, a reading idea (`little`, shown under "Read for the day")
// and things to try with a book (`activities`), in place of the Crossmaze preschool ones; wishes that spoke of
// "little ones" read for every age; and the words for the library days. text.ts keeps the rest (titles, what the
// day is about, the greeting bar).
import { texts as base, fallbackText } from './text';
import type { OccasionText } from './types';

type Library = Partial<Pick<OccasionText, 'little' | 'activities' | 'wishes' | 'bar'>>;

const library: Record<string, Library> = {
  'new-year': {
    wishes: [(y) => `Wishing you a happy, healthy and book-filled ${y}.`, 'May the new year bring you new stories and new favourites.', 'Here is to a year of turning pages together.'],
    little: 'A fresh year is a good time for a <b>reading goal</b>: a book a month, a new author, or a genre you have never tried.',
    activities: ['Make a reading jar: write the titles you want to read on slips of paper and pick one whenever you finish a book.', 'Ask your librarian for “a book I would never pick myself” and give it the first chapter.'],
  },
  'republic-day': {
    little: 'Read about the people who wrote our <b>Constitution</b>, or a picture book about the <b>flag</b> and what its colours stand for.',
    activities: ['Read the Preamble aloud together and talk about one word in it, such as “justice” or “fraternity”.', 'Pick a book set in a part of India you have never visited.'],
  },
  'independence-day': {
    wishes: [(y) => `Celebrating ${y - 1947} years of a free India.`, 'Wishing every family a proud and happy Independence Day.', 'Stories of courage made our freedom: read one today.'],
    little: 'A day for stories of the <b>freedom struggle</b>: biographies, letters and novels about the people who made India free.',
    activities: ['Read about a freedom fighter from your own state and share one thing you learnt at dinner.', 'Look for a book of patriotic poems and read one aloud together.'],
  },
  'gandhi-jayanti': {
    little: 'Read <b>Gandhi’s own words</b>, or a picture biography for younger readers, and talk about truth and kindness.',
    activities: ['Read a chapter of “The Story of My Experiments with Truth” together, or a children’s life of Gandhi.', 'Pass on a book you have finished to someone who will enjoy it: a small act of sharing.'],
  },
  rajyotsava: {
    wishes: ['Wishing every family a happy Kannada Rajyotsava.', 'Celebrating Karnataka, its language and its stories.', 'May Kannada stories fill our homes and our shelves.'],
    little: 'A lovely day for <b>Kannada books</b>: folk tales, poems by Kuvempu and Bendre, and stories for every age.',
    activities: ['Borrow a Kannada book you can read with a grandparent or a friend.', 'Learn one Kannada poem or rhyme by heart and say it together.'],
  },
  'womens-day': {
    wishes: ['Celebrating the women who write, teach and inspire us.', 'Wishing every woman a happy Women’s Day.', 'Here is to brave heroines, on the page and off it.'],
    little: 'Read books by <b>women writers</b>, or stories of brave and clever girls and women, for every age.',
    activities: ['Pick a book by a woman writer you have not read before, and recommend it to a friend.', 'Read a story about a brave girl with a younger reader and ask what they would like to be.'],
    bar: 'Celebrating the women who write, teach and inspire us.',
  },
  'health-day': {
    wishes: ['Wishing you good health and happy reading.', 'A healthy mind loves a good book.', 'Read, rest and stay well.'],
    little: 'Books about the <b>body</b>, <b>food</b> and <b>feelings</b>: a gentle way to talk about staying well, at any age.',
    activities: ['Read a book about how the body works with a young reader and try naming the bones and muscles you use when you walk.', 'Swap ten minutes of screen time before bed for ten minutes of a book.'],
  },
  'earth-day': {
    little: 'Read about <b>nature</b>, <b>animals</b> and <b>caring for the planet</b>: a borrowed book is a greener book.',
    activities: ['Borrow a book about trees or birds and spot three of them on a walk.', 'Read a story about the ocean together and talk about one thing you can do to keep it clean.'],
  },
  'mothers-day': {
    wishes: ['Celebrating mothers, and every story they have read to us.', 'Wishing every mother a happy Mother’s Day.', 'Thank you for the bedtime stories, Amma.'],
    little: 'A day to read the books <b>your mother loved</b>, or a story about mothers and families, together.',
    activities: ['Ask your mother which book she loved as a child, and borrow it to read together.', 'Write a short thank-you note inside a bookmark and slip it into her next book.'],
    bar: 'Celebrating mothers, and every story they have read to us.',
  },
  'environment-day': {
    wishes: ['Every tree, every drop of water and every reader counts.', 'Wishing everyone a green and happy Environment Day.', 'Borrow, read, return: sharing books is good for the planet.'],
    little: 'Read about the <b>environment</b>, <b>climate</b> and <b>wildlife</b>, from picture books to big ideas.',
    activities: ['Borrow a book about a wild animal of India and make a fact card about it.', 'Share a book you have finished with a neighbour instead of buying a new one.'],
    bar: 'Borrow, read, return: sharing books is good for the planet.',
  },
  'fathers-day': {
    wishes: ['Celebrating fathers, and every story they have shared.', 'Wishing every father a happy Father’s Day.', 'Here is to bedtime stories and funny voices.'],
    little: 'Read a book <b>with your father</b>, or one about fathers and families, and take turns reading the pages.',
    activities: ['Ask your father about the first book he remembers, and look for it at the library.', 'Read a funny story together and give every character a different voice.'],
    bar: 'Celebrating fathers, and every story they have shared.',
  },
  'yoga-day': {
    little: 'Books about <b>yoga</b>, <b>breathing</b> and <b>calm</b>, for children and grown-ups.',
    activities: ['Read a yoga story book with a young reader and try each pose as it comes in the story.', 'End the day with five slow breaths and ten quiet minutes with a book.'],
  },
  'doctors-day': {
    wishes: ['Thank you to every doctor who keeps us healthy and safe.', 'Wishing every doctor a happy Doctors’ Day.', 'Healing hands, kind hearts: thank you, doctors.'],
    little: 'Read about <b>how doctors help us</b>, or the life of a great Indian doctor or scientist.',
    activities: ['Read a picture book about visiting the doctor with a young reader, to make the next visit less scary.', 'Borrow a biography of a doctor who changed medicine, such as Anandi Gopal Joshi.'],
    bar: 'Thanking every doctor who cares for our families.',
  },
  'sports-day': {
    little: 'Read about <b>sports heroes</b>: biographies of Indian athletes and stories about teamwork and trying again.',
    activities: ['Borrow the life story of an Indian sports star and find one thing they practised every day.', 'Read a sports story together, then go out and play the game.'],
  },
  'teachers-day': {
    wishes: ['Thank you to every teacher who opened a book for us.', 'Celebrating the patient, caring teachers in every life.', 'Wishing every teacher a happy Teachers’ Day.'],
    little: 'Read about <b>great teachers</b>, or a story about a classroom, and remember a teacher who made you love reading.',
    activities: ['Give a teacher a list of three books you loved this year: a gift that costs nothing.', 'Let a young reader be the teacher and read a story to you.'],
    bar: 'Thanking every teacher who opened a book for us.',
  },
  'childrens-day': {
    wishes: ['To every child: keep reading, wondering and laughing.', 'Wishing every child a day full of stories and fun.', 'Every child deserves a shelf of good books. Happy Children’s Day.'],
    little: 'A day for <b>children’s favourites</b>: picture books, comics and the stories they ask for again and again.',
    activities: ['Let your child choose any book at the library today, however big or small.', 'Read your child’s favourite book with them, and let them do the voices.'],
    bar: 'Wishing every child a day full of stories and fun.',
  },
  sankranti: {
    little: 'Read about <b>harvest festivals</b> across India, and stories of kites, farms and the sun.',
    activities: ['Read a story about kites, then make a paper one together.', 'Borrow a book of recipes from South India and cook something for the festival.'],
  },
  holi: {
    little: 'Read the story of <b>Prahlad and Holika</b>, or a picture book full of colours.',
    activities: ['Read a book about colours with a young reader and find each one around the house.', 'Tell the story of Holi in your own words, then read it in a book.'],
  },
  ugadi: {
    wishes: ['Wishing you a happy Ugadi and a sweet new year.', 'A little sweet, a little bitter, and lots of good books this year.', 'A new year, a new shelf of stories.'],
    little: 'A new year for many of us: a good day to start a <b>new book</b> or a reading list for the year.',
    activities: ['Read a Kannada or Telugu story together for the new year.', 'Make a list of six books for the next six months and pin it up at home.'],
  },
  'good-friday': {
    little: 'A quiet day for <b>reflection</b>: a book of stories about kindness and forgiveness.',
    activities: ['Spend a quiet hour with a book, away from screens.', 'Read a story about forgiveness together and talk about it.'],
  },
  'ram-navami': {
    little: 'Read the <b>Ramayana</b>: retellings for children, comics, or a novel for grown-ups.',
    activities: ['Read one episode of the Ramayana together and ask what each of you liked best.', 'Borrow two retellings of the Ramayana and compare how they tell the same story.'],
  },
  'mahavir-jayanti': {
    little: 'Read stories about <b>non-violence</b>, <b>kindness to animals</b> and <b>simple living</b>.',
    activities: ['Read a book about caring for animals with a young reader.', 'Talk about a story where someone chose kindness, and why.'],
  },
  'eid-ul-fitr': {
    little: 'Read stories about <b>Eid</b>, <b>sharing</b> and <b>family</b>, such as Premchand’s much-loved “Idgah”.',
    activities: ['Read “Idgah” by Premchand together and talk about Hamid’s gift.', 'Share a favourite book with a friend or neighbour as an Eid gift.'],
  },
  'raksha-bandhan': {
    little: 'Read stories about <b>brothers and sisters</b>, and the friends who are like family.',
    activities: ['Swap books with your brother or sister for a week, then talk about them.', 'Read a story with a sibling and take turns reading a page each.'],
  },
  janmashtami: {
    little: 'Read stories of <b>young Krishna</b>: butter, the flute and Mount Govardhan.',
    activities: ['Read a Krishna story together and act out your favourite part.', 'Borrow an Amar Chitra Katha on Krishna for a young reader.'],
  },
  onam: {
    little: 'Read the story of <b>King Mahabali</b>, and books about Kerala, its boats and its flowers.',
    activities: ['Read the story of Mahabali and Vamana together.', 'Borrow a book about Kerala and plan a pookalam with the flowers you find in it.'],
  },
  'ganesh-chaturthi': {
    little: 'Read stories of <b>Ganesha</b>: how he got his elephant head, and how he wrote the Mahabharata.',
    activities: ['Read how Ganesha wrote down the Mahabharata, then write a short story of your own.', 'Borrow a book of Ganesha stories for a young reader.'],
  },
  dussehra: {
    little: 'Read stories of <b>good winning over evil</b>: the Ramayana, Durga and the tales told during Navaratri.',
    activities: ['Read a story of Durga or Rama together and talk about what courage means.', 'Arrange a “golu” of your favourite books for the festival.'],
  },
  diwali: {
    wishes: ['Wishing you a bright and happy Diwali.', 'May every diya light up a happy new chapter.', 'Lights, sweets and a good book: happy Diwali.'],
    little: 'Read stories of <b>light</b>: the return of Rama, Lakshmi, and books to read by a diya after the crackers.',
    activities: ['Read a Diwali story together by the light of a diya.', 'Give a book as a Diwali gift: it lasts longer than sweets.'],
  },
  'guru-nanak-jayanti': {
    little: 'Read about <b>Guru Nanak</b>’s life and teachings of equality, sharing and service.',
    activities: ['Read a story from Guru Nanak’s travels together.', 'Talk about langar, the shared meal, after reading about it.'],
  },
  christmas: {
    little: 'Read <b>Christmas stories</b>: “A Christmas Carol”, picture books about giving, and winter tales.',
    activities: ['Read “A Christmas Carol” aloud over a few evenings.', 'Gift a book you loved this year, wrapped with a note about why.'],
  },

  // The library days (all words their own).
};

const libraryDays: Record<string, OccasionText> = {
  'childrens-book-day': {
    eyebrow: 'A day for picture books',
    title: () => 'Children’s Book Day',
    wishes: ['Every child deserves a book that feels like a friend.', 'Wishing every young reader a story-filled day.', 'Picture books, big dreams. Happy Children’s Book Day.'],
    heading: 'Happy International Children’s Book Day from Stories',
    about: 'International Children’s Book Day, on 2 April, is the birthday of Hans Christian Andersen, who wrote “The Ugly Duckling” and “The Little Mermaid”. It celebrates books for children and the joy of reading.',
    little: 'Read a <b>fairy tale</b> by Hans Christian Andersen, or the picture book your child asks for every night.',
    activities: ['Read “The Ugly Duckling” together and talk about how the duckling felt.', 'Let your child make a cover for their own story book, then write the first page together.'],
    bar: 'Celebrating the books that make young readers.',
  },
  'world-book-day': {
    eyebrow: 'A day for every reader',
    title: () => 'Happy World Book Day',
    wishes: ['Wishing you a good book and a quiet corner today.', 'One book can change a day. Happy World Book Day.', 'Celebrating every reader, every writer and every story.'],
    heading: 'Happy World Book Day from Stories',
    about: 'World Book and Copyright Day, on 23 April, is UNESCO’s day for books and reading, and the day Shakespeare and Cervantes died. Libraries and schools around the world celebrate reading.',
    little: 'Pick up the book you have been meaning to read, or <b>reread an old favourite</b>.',
    activities: ['Tell a friend about the best book you read this year, and borrow theirs.', 'Visit your branch and ask the librarian what they are reading.'],
    bar: 'Celebrating every reader, every writer and every story.',
  },
  'reading-day': {
    eyebrow: 'Read, and grow',
    title: () => 'Happy Reading Day',
    wishes: ['Read and grow: wishing everyone a happy Reading Day.', 'Ten minutes with a book is ten minutes well spent.', 'A home with books is a home with stories.'],
    heading: 'Happy National Reading Day from Stories',
    about: 'National Reading Day, on 19 June, remembers P. N. Panicker, who started the library movement in Kerala with the words “Read and grow”. Reading Week follows in schools and libraries.',
    little: 'Read something <b>together as a family</b>: a chapter each evening, or a book everyone takes turns with.',
    activities: ['Set a family reading time: twenty minutes, phones away, everyone with a book.', 'Start a reading log and write down every book you finish this week.'],
    bar: 'Read and grow: wishing everyone a happy Reading Day.',
  },
  'librarians-day': {
    eyebrow: 'Thank you, librarians',
    title: () => 'Librarians’ Day',
    wishes: ['Thank you to every librarian who found us the right book.', 'Celebrating the people who keep our stories safe.', 'Behind every reader is a librarian.'],
    heading: 'Happy National Librarians’ Day from Stories',
    about: 'National Librarians’ Day, on 12 August, is the birthday of Dr S. R. Ranganathan, the father of library science in India, who gave the world the five laws of library science, starting with “Books are for use”.',
    little: 'Ask your librarian for <b>their favourite book</b>, and read it this week.',
    activities: ['Say thank you to the librarian at your branch, and tell them about a book you loved.', 'Read Ranganathan’s five laws and spot them at work in your library.'],
    bar: 'Thank you to every librarian who found us the right book.',
  },
  'literacy-day': {
    eyebrow: 'Reading for all',
    title: () => 'Literacy Day',
    wishes: ['Every reader was once taught to read. Happy Literacy Day.', 'Wishing every child and grown-up the joy of reading.', 'Letters become words, words become worlds.'],
    heading: 'International Literacy Day greetings from Stories',
    about: 'International Literacy Day, on 8 September, is UNESCO’s day for reading and writing for all. It reminds us that millions of people still cannot read, and that books and libraries help everyone learn.',
    little: 'Read with someone who is <b>just learning</b>: a young child, or a grown-up learning a new language.',
    activities: ['Read a simple book with a young reader and let them point to the words as you go.', 'Donate a book in good condition to your branch for someone who is learning to read.'],
    bar: 'Wishing every child and grown-up the joy of reading.',
  },
};

/** The words for an occasion, as a library says them. */
export function textFor(id: string, name: string): OccasionText {
  const own = libraryDays[id];
  if (own) return own;
  const t = base[id] ?? fallbackText(name);
  return { ...t, ...library[id] };
}
