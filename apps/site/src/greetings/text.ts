// The words for each occasion: the card's title and wish, and the pop-up's text. Lists take turns year
// by year. Facts are general and widely known. From the Crossmaze website; library.ts gives each day a
// reading idea and library activities in place of the preschool ones, and adds the library days.
import { ordinal } from './card';
import type { OccasionText } from './types';

export const texts: Record<string, OccasionText> = {
  // National days
  'new-year': {
    eyebrow: 'A fresh start',
    title: (year) => `Happy New Year ${year}`,
    wishes: [
      (y) => `Wishing your family a happy, healthy and joyful ${y}.`,
      'May the new year bring your little one new friends and new wonders.',
      'Here is to a year of curious questions, big smiles and warm hugs.',
    ],
    heading: 'Happy New Year from Stories',
    about: 'New Year’s Day, 1 January, is the first day of the calendar year. Families welcome it with wishes, get-togethers and hopes for the months ahead.',
    little: 'For little ones it is a fun time to talk about <b>days</b>, <b>months</b> and <b>growing up</b>, and to think about what they would like to learn next.',
    activities: [
      'Make a simple “all about me” page: draw yourselves, trace your child’s hand and add their height. A keepsake that builds drawing and early measuring.',
      'Say the months of the year together in a song, clapping once for each. Helps with memory, rhythm and counting.',
    ],
    bar: 'Wishing every family a happy, healthy and joyful new year.',
  },
  'republic-day': {
    eyebrow: 'Our national day',
    title: (year) => `${ordinal(year - 1949)} Republic Day`,
    wishes: [
      'Proud of our country, our Constitution and our colourful people.',
      'Wishing every family a proud and happy Republic Day.',
      'Saffron, white and green: celebrating the India we share.',
    ],
    heading: 'Republic Day greetings from Stories',
    about: 'Republic Day marks 26 January 1950, when the Constitution of India came into force. The national flag is hoisted across the country and a grand parade is held in New Delhi.',
    little: 'For little ones it is a lovely day to learn the <b>colours of the flag</b>, sing the <b>national anthem</b> and talk about <b>being a good friend</b> to everyone.',
    activities: [
      'Make a paper flag together: colour three strips saffron, white and green, and draw the blue wheel in the middle. Good for colours and hand control.',
      'Sort toys or buttons into saffron, white and green piles and count each one. A simple game for sorting and counting.',
    ],
    bar: 'Wishing every family a proud and happy Republic Day.',
  },
  'independence-day': {
    eyebrow: 'Our national day',
    title: () => 'Happy Independence Day',
    wishes: [
      (y) => `Celebrating ${y - 1947} years of a free India.`,
      'Wishing every family a proud and happy Independence Day.',
      'May our little ones grow up kind, brave and proud of India.',
    ],
    heading: 'Independence Day greetings from Stories',
    about: 'Independence Day marks 15 August 1947, when India became free. The Prime Minister hoists the national flag at the Red Fort in Delhi, and flags fly in homes, schools and streets.',
    little: 'For little ones it is a good day to learn about the <b>national flag</b>, sing <b>patriotic songs</b> and talk about <b>caring for one another</b>.',
    activities: [
      'Make a tricolour with torn paper: stick saffron, white and green pieces in rows, then add a blue wheel. Tearing and sticking build fine motor skills.',
      'Sing a patriotic song together and march around the room, waving a paper flag. Great for rhythm, movement and language.',
    ],
    bar: 'Wishing every family a proud and happy Independence Day.',
  },
  'gandhi-jayanti': {
    eyebrow: 'Remembering Bapu',
    title: () => 'Gandhi Jayanti',
    wishes: [
      (y) => `Remembering Mahatma Gandhi on his ${ordinal(y - 1869)} birth anniversary.`,
      'May we all choose truth, kindness and peace, just as Bapu taught.',
      'Small acts of kindness can change the world. Happy Gandhi Jayanti.',
    ],
    heading: 'Gandhi Jayanti greetings from Stories',
    about: 'Gandhi Jayanti, on 2 October, is the birthday of Mahatma Gandhi, the Father of the Nation, who led India’s freedom struggle through truth and non-violence. People remember him with prayers, songs and cleaning drives.',
    little: 'For little ones it is a gentle day to talk about <b>telling the truth</b>, <b>being kind</b> and <b>keeping our space clean</b>.',
    activities: [
      'Tidy up a room together: put toys back in their places and sort them by type. A happy habit that builds sorting and responsibility.',
      'Talk about one kind thing each of you can do today, then draw it. Helps with language and caring for others.',
    ],
    bar: 'Remembering Bapu’s message of truth, kindness and peace.',
  },
  rajyotsava: {
    eyebrow: 'Our state’s day',
    title: () => 'Happy Rajyotsava',
    wishes: [
      'Wishing every family a happy Kannada Rajyotsava.',
      'Proud of Karnataka, its language, its music and its people.',
      'May our little ones grow up loving Kannada and its stories.',
    ],
    heading: 'Kannada Rajyotsava greetings from Stories',
    about: 'Kannada Rajyotsava marks the formation of the state of Karnataka on 1 November 1956, when Kannada-speaking regions came together as one state. The red and yellow Kannada flag is hoisted and the day is marked with songs and cultural programmes.',
    little: 'For little ones it is a lovely day to learn a few <b>Kannada words</b>, sing <b>Kannada rhymes</b> and enjoy the colours <b>red and yellow</b>.',
    activities: [
      'Make a red and yellow flag with paper and crayons, then hunt for red and yellow things around the house. Good for colours and observation.',
      'Learn and say a few Kannada words together, such as numbers or colours, and use them through the day. Builds language and memory.',
    ],
    bar: 'Wishing every family a happy Kannada Rajyotsava.',
  },

  // School and children's days
  'womens-day': {
    eyebrow: 'Celebrating women',
    title: () => 'Happy Women’s Day',
    wishes: [
      'Thank you to every mother, grandmother, aunt and teacher who cares.',
      'Celebrating the strong, kind women who help our children grow.',
      'Wishing every woman a day full of respect, joy and thanks.',
    ],
    heading: 'Women’s Day greetings from Stories',
    about: 'International Women’s Day, on 8 March, celebrates women and their achievements and calls for equal chances for everyone. People mark it by thanking the women in their lives and talking about fairness.',
    little: 'For little ones it is a good day to say <b>thank you</b> to the women who care for them and to learn that <b>girls and boys</b> can <b>be anything</b>.',
    activities: [
      'Make a thank-you card for a woman your child loves, such as a mother, grandmother, aunt or neighbour. Builds fine motor skills and gratitude.',
      'Read a story about a brave or clever girl and ask what your child would like to be. Helps with language and imagination.',
    ],
    bar: 'Thanking every woman who helps our children grow.',
  },
  'health-day': {
    eyebrow: 'Healthy habits',
    title: () => 'World Health Day',
    wishes: [
      'Wishing every family good health, good food and good sleep.',
      'Clean hands, healthy food and lots of play: here is to good health.',
      'May your little one grow up healthy, happy and strong.',
    ],
    heading: 'World Health Day greetings from Stories',
    about: 'World Health Day, on 7 April, is marked by the World Health Organization on the day it was founded in 1948. Each year it draws attention to good health for everyone.',
    little: 'For little ones it is a fun time to learn about <b>washing hands</b>, <b>eating fruit and vegetables</b> and <b>getting enough sleep</b>.',
    activities: [
      'Sing a song while washing hands, scrubbing palms, backs and between the fingers until the song ends. Builds a healthy habit and self-care.',
      'Sort pictures or toy foods into “everyday foods” and “sometimes foods”, and name their colours. Good for sorting and language.',
    ],
    bar: 'Wishing every family good health and happy days.',
  },
  'earth-day': {
    eyebrow: 'Caring for our planet',
    title: () => 'Happy Earth Day',
    wishes: [
      'Little hands can help our big, beautiful Earth.',
      'Wishing every family a green and happy Earth Day.',
      'Save water, plant a seed and love our planet.',
    ],
    heading: 'Earth Day greetings from Stories',
    about: 'Earth Day, on 22 April, is marked around the world to care for our planet. People plant trees, clean up their neighbourhoods and think about saving water and energy.',
    little: 'For little ones it is a lovely day to learn about <b>plants</b>, <b>saving water</b> and <b>not wasting things</b>.',
    activities: [
      'Plant a few seeds in a small pot, water them together and check on them each day. Teaches care, patience and how plants grow.',
      'Go on a short nature walk and collect fallen leaves, then sort them by size and colour. Good for observation and sorting.',
    ],
    bar: 'Wishing every family a green and happy Earth Day.',
  },
  'mothers-day': {
    eyebrow: 'With love and thanks',
    title: () => 'Happy Mother’s Day',
    wishes: [
      'Thank you to every mother, grandmother and carer for all the love.',
      'Celebrating the warm hugs and gentle hands that help children grow.',
      'Wishing every mum and every loving carer a happy Mother’s Day.',
    ],
    heading: 'Happy Mother’s Day from Stories',
    about: 'Mother’s Day, on the second Sunday of May in India, is a day to thank mothers and everyone who mothers: grandmothers, aunts and loving carers. Families mark it with cards, hugs and time together.',
    little: 'For little ones it is a sweet day to say <b>thank you</b>, give a <b>hug</b> and learn how to show <b>love</b> in small ways.',
    activities: [
      'Make a card with a handprint or a drawing for someone who cares for your child. Painting and folding build fine motor skills.',
      'Ask your child to help with a small job, like folding napkins or watering a plant, as a gift of help. Builds independence and kindness.',
    ],
    bar: 'Thanking every mother, grandmother and carer for all their love.',
  },
  'environment-day': {
    eyebrow: 'Caring for nature',
    title: () => 'Environment Day',
    wishes: [
      'Every tree, every drop of water and every little hand counts.',
      'Wishing every family a green and happy World Environment Day.',
      'Let us keep our world clean and green for our little ones.',
    ],
    heading: 'World Environment Day greetings from Stories',
    about: 'World Environment Day, on 5 June, is led by the United Nations to encourage everyone to protect nature. People plant trees, clean up and cut down on waste.',
    little: 'For little ones it is a good day to learn about <b>trees</b>, <b>animals</b> and putting <b>rubbish in the bin</b>.',
    activities: [
      'Turn an empty box or bottle into a toy or a pen holder and decorate it together. Reusing things builds creativity and fine motor skills.',
      'Water the plants at home together and count the leaves on one plant. Good for care, counting and observation.',
    ],
    bar: 'Wishing every family a green and happy World Environment Day.',
  },
  'fathers-day': {
    eyebrow: 'With love and thanks',
    title: () => 'Happy Father’s Day',
    wishes: [
      'Thank you to every father, grandfather and carer for all the love.',
      'Celebrating the big laughs and steady hands that help children grow.',
      'Wishing every dad and every loving carer a happy Father’s Day.',
    ],
    heading: 'Happy Father’s Day from Stories',
    about: 'Father’s Day, on the third Sunday of June, is a day to thank fathers and everyone who fathers: grandfathers, uncles and loving carers. Families mark it with cards, games and time together.',
    little: 'For little ones it is a happy day to say <b>thank you</b>, <b>play together</b> and share a <b>favourite story</b>.',
    activities: [
      'Make a card or a paper medal for someone who cares for your child and decorate it with stickers. Builds fine motor skills and gratitude.',
      'Build a tower of blocks together and count each block as it goes up. Great for counting, balance and teamwork.',
    ],
    bar: 'Thanking every father, grandfather and carer for all their love.',
  },
  'yoga-day': {
    eyebrow: 'Stretch and breathe',
    title: () => 'Happy Yoga Day',
    wishes: [
      'Stretch, breathe and smile: wishing every family a happy Yoga Day.',
      'May every family enjoy calm minds and happy, healthy bodies.',
      'Little stretches, deep breaths and big smiles.',
    ],
    heading: 'International Yoga Day greetings from Stories',
    about: 'International Day of Yoga, on 21 June, was declared by the United Nations to share yoga, which began in India. People around the world practise yoga together on the day.',
    little: 'For little ones it is a fun time to try <b>animal poses</b>, practise <b>slow breathing</b> and feel <b>calm</b>.',
    activities: [
      'Try a few animal poses together: stand tall like a tree, stretch like a cat and hiss like a cobra. Builds balance and body awareness.',
      'Breathe in slowly as if smelling a flower, then breathe out as if blowing a feather. Helps little ones calm down.',
    ],
    bar: 'Wishing every family calm minds and happy, healthy bodies.',
  },
  'doctors-day': {
    eyebrow: 'Thank you, doctors',
    title: () => 'Happy Doctors’ Day',
    wishes: [
      'Thank you to every doctor who keeps our children healthy and safe.',
      'Celebrating the kind doctors who care for our families.',
      'Wishing every doctor a happy and well-deserved Doctors’ Day.',
    ],
    heading: 'Doctors’ Day greetings from Stories',
    about: 'National Doctors’ Day in India is marked on 1 July, the birth and death anniversary of Dr B. C. Roy, a famous doctor and Chief Minister of West Bengal. It is a day to thank doctors for their care.',
    little: 'For little ones it is a good day to learn that <b>doctors help us</b>, to name <b>parts of the body</b> and to feel less worried about <b>check-ups</b>.',
    activities: [
      'Play doctor with a toy kit or a pretend one: listen to a teddy’s heartbeat and put on a bandage. Builds language and confidence.',
      'Point to and name body parts in a song, like “head, shoulders, knees and toes”. Good for language and movement.',
    ],
    bar: 'Thanking every doctor who cares for our children and families.',
  },
  'sports-day': {
    eyebrow: 'Let’s play',
    title: () => 'National Sports Day',
    wishes: [
      'Run, jump, play and smile: happy National Sports Day.',
      'Wishing every family a day full of play and fun.',
      'Every game is a chance to learn, share and try again.',
    ],
    heading: 'National Sports Day greetings from Stories',
    about: 'National Sports Day, on 29 August, is the birthday of hockey legend Major Dhyan Chand. It celebrates sport, fitness and the joy of playing together.',
    little: 'For little ones it is a happy day to <b>run</b>, <b>jump</b> and <b>take turns</b>, and to learn that trying is what matters.',
    activities: [
      'Roll a soft ball to each other and count how many catches you make in a row. Good for hand-eye coordination and counting.',
      'Set up a tiny obstacle course with cushions to jump over and crawl under. Builds balance, strength and following directions.',
    ],
    bar: 'Wishing every family a happy, playful National Sports Day.',
  },
  'teachers-day': {
    eyebrow: 'Thank you, teachers',
    title: () => 'Happy Teachers’ Day',
    wishes: [
      'Thank you to every teacher who helps little minds grow.',
      'Celebrating the patient, caring teachers in every child’s life.',
      'Wishing every teacher a happy and well-deserved Teachers’ Day.',
    ],
    heading: 'Teachers’ Day greetings from Stories',
    about: 'Teachers’ Day, on 5 September, is the birthday of Dr Sarvepalli Radhakrishnan, a great teacher and India’s second President. Children thank their teachers with cards, flowers and songs.',
    little: 'For little ones it is a lovely day to say <b>thank you</b>, to remember that <b>everyone can teach us something</b> and to enjoy <b>learning</b>.',
    activities: [
      'Make a thank-you card for a teacher with drawings, stickers or a handprint. Builds fine motor skills and gratitude.',
      'Swap roles and let your child be the teacher: they can show you a rhyme or how to draw a shape. Builds confidence and language.',
    ],
    bar: 'Thanking every teacher who helps little minds grow.',
  },
  'childrens-day': {
    eyebrow: 'A day for children',
    title: () => 'Happy Children’s Day',
    wishes: [
      'To every little one: keep laughing, playing and wondering.',
      'Wishing every child a day full of play, laughter and love.',
      'Every child is special. Happy Children’s Day.',
    ],
    heading: 'Happy Children’s Day from Stories',
    about: 'Children’s Day, on 14 November, is the birthday of Pandit Jawaharlal Nehru, India’s first Prime Minister, who loved children and was called Chacha Nehru. It is a day to celebrate children and their right to learn, play and be happy.',
    little: 'It is your little one’s day to <b>play</b>, <b>laugh</b> and feel <b>special</b>, just for being themselves.',
    activities: [
      'Let your child choose a game and play it together, then ask what made them happiest today. Builds language and confidence.',
      'Draw a picture of your family together and ask your child to tell its story. Good for drawing, imagination and talking.',
    ],
    bar: 'Wishing every child a day full of play, laughter and love.',
  },

  // Festivals
  sankranti: {
    eyebrow: 'Harvest festival',
    title: () => 'Happy Sankranti',
    wishes: [
      'Wishing your family a sweet and happy Sankranti and Pongal.',
      'May the harvest bring your home warmth, plenty and joy.',
      'Bright kites, sweet treats and happy days to every family.',
    ],
    heading: 'Happy Sankranti from Stories',
    about: 'Makar Sankranti and Pongal are harvest festivals that thank the sun, the land and the farmers. Families draw rangoli, share sweets made with jaggery, cook fresh rice and fly kites.',
    little: 'For little ones it is a lovely time to learn <b>where food comes from</b>, to thank <b>farmers</b> and to enjoy <b>kites</b> and <b>colours</b>.',
    activities: [
      'Fold a paper kite together, colour it in and stick on a ribbon tail. Folding, colouring and sticking build fine motor skills.',
      'Look at rice, dal and vegetables in the kitchen and talk about how farmers grow them. Good for language and curiosity.',
    ],
    bar: 'Wishing every family a sweet and happy harvest festival.',
  },
  holi: {
    eyebrow: 'Festival of colours',
    title: () => 'Happy Holi',
    wishes: [
      'Wishing your family a bright, colourful and happy Holi.',
      'May every colour of Holi bring your home joy and laughter.',
      'Pink, yellow, green and blue: a colourful Holi to you.',
    ],
    heading: 'Happy Holi from Stories',
    about: 'Holi is the festival of colours, welcoming spring and the victory of good over evil. Families and friends play with colours, share sweets and greet each other warmly.',
    little: 'For little ones it is a fun time to learn <b>colour names</b>, see <b>how colours mix</b> and enjoy <b>playing together</b>.',
    activities: [
      'Mix two paint colours on paper, such as yellow and blue, and see what new colour you make. Great for colours and curiosity.',
      'Make a handprint painting in many colours and name each one. Good for colours, language and sensory play.',
    ],
    bar: 'Wishing every family a bright and colourful Holi.',
  },
  ugadi: {
    eyebrow: 'A new year begins',
    title: () => 'Happy Ugadi',
    wishes: [
      'Wishing your family a sweet and happy Ugadi and a bright new year.',
      'May the new year bring your home health, joy and new beginnings.',
      'A little sweet, a little bitter, and lots of happiness this year.',
    ],
    heading: 'Happy Ugadi from Stories',
    about: 'Ugadi is the new year in Karnataka, Andhra Pradesh and Telangana. Homes are decorated with mango leaves and rangoli, and families share bevu-bella, neem and jaggery, a reminder that life brings both bitter and sweet.',
    little: 'For little ones it is a lovely time to talk about <b>new beginnings</b>, taste <b>sweet and bitter</b> and enjoy <b>patterns</b>.',
    activities: [
      'Cut leaf shapes from green paper and string them into a mini toran for a door. Builds fine motor skills and patterns.',
      'Talk about tastes: name something sweet, sour, salty and bitter at home. Good for language and the senses.',
    ],
    bar: 'Wishing every family a sweet and happy new year.',
  },
  'good-friday': {
    eyebrow: 'A day of reflection',
    title: () => 'Good Friday',
    wishes: [
      'Wishing every family peace, hope and quiet comfort.',
      'May kindness, forgiveness and hope be with every home.',
      'Thinking of peace and gentleness on this quiet day.',
    ],
    heading: 'Good Friday thoughts from Stories',
    about: 'Good Friday is a solemn day when Christians remember the death of Jesus on the cross. Many spend it in prayer, quiet reflection and church services.',
    little: 'It is a gentle day to talk with little ones about <b>kindness</b>, <b>forgiveness</b> and <b>caring for others</b>.',
    activities: [
      'Talk about a time someone was kind to you, and think of one kind thing to do for someone today. Builds language and empathy.',
      'Plant a seed together and talk about hope as you water it each day. Teaches care and patience.',
    ],
    bar: 'Wishing every family peace, hope and quiet comfort.',
  },
  'ram-navami': {
    eyebrow: 'Birth of Lord Rama',
    title: () => 'Happy Ram Navami',
    wishes: [
      'Wishing your family a peaceful and happy Ram Navami.',
      'May your home be filled with goodness, truth and joy.',
      'Wishing every family blessings, peace and happiness.',
    ],
    heading: 'Happy Ram Navami from Stories',
    about: 'Ram Navami celebrates the birth of Lord Rama. Families visit temples, offer prayers and share stories from the Ramayana.',
    little: 'For little ones it is a good time to hear <b>stories</b> and talk about <b>being truthful</b>, <b>kind</b> and <b>brave</b>.',
    activities: [
      'Tell a short story from the Ramayana and ask your child what they liked best. Builds listening and language.',
      'Draw a bow and arrow, a monkey or a crown from the story and colour it. Good for drawing and fine motor skills.',
    ],
    bar: 'Wishing every family peace and happiness on Ram Navami.',
  },
  'mahavir-jayanti': {
    eyebrow: 'A message of peace',
    title: () => 'Mahavir Jayanti',
    wishes: [
      'Wishing every family peace, kindness and compassion.',
      'May we be gentle with every living thing.',
      'Peace, truth and kindness to every home on Mahavir Jayanti.',
    ],
    heading: 'Mahavir Jayanti greetings from Stories',
    about: 'Mahavir Jayanti marks the birth of Lord Mahavir, who taught non-violence, truth and kindness to all living beings. The Jain community marks it with prayers, processions and acts of charity.',
    little: 'For little ones it is a gentle day to talk about <b>being kind to animals</b>, <b>sharing</b> and <b>not hurting anyone</b>.',
    activities: [
      'Put out a small bowl of water for birds and watch who comes to drink. Teaches care for animals and observation.',
      'Draw your favourite animals and talk about how we can be gentle with them. Good for drawing and empathy.',
    ],
    bar: 'Wishing every family peace and kindness on Mahavir Jayanti.',
  },
  'eid-ul-fitr': {
    eyebrow: 'A festival of joy',
    title: () => 'Eid Mubarak',
    wishes: [
      'Wishing your family a joyful and blessed Eid.',
      'May Eid bring your home peace, sweetness and happy smiles.',
      'Eid Mubarak to every family celebrating today.',
    ],
    heading: 'Eid Mubarak from Stories',
    about: 'Eid al-Fitr marks the end of Ramadan, the month of fasting. Families offer prayers, wear new clothes, share sweet dishes, give to those in need and visit loved ones.',
    little: 'For little ones it is a happy time to learn about <b>sharing</b>, <b>giving</b> and <b>greeting friends</b> warmly.',
    activities: [
      'Make an Eid card with a moon and stars cut from paper and give it to a friend or neighbour. Builds fine motor skills and kindness.',
      'Look at the moon together in the evening and talk about its shape. Good for shapes, curiosity and language.',
    ],
    bar: 'Wishing every family a joyful and blessed Eid.',
  },
  'raksha-bandhan': {
    eyebrow: 'A bond of love',
    title: () => 'Happy Raksha Bandhan',
    wishes: [
      'Celebrating the love between brothers, sisters and cousins.',
      'May the bond of rakhi keep your family close and happy.',
      'Wishing every family a happy and loving Raksha Bandhan.',
    ],
    heading: 'Happy Raksha Bandhan from Stories',
    about: 'Raksha Bandhan celebrates the bond between brothers and sisters. A sister ties a rakhi on her brother’s wrist, and they promise to care for each other and share sweets.',
    little: 'For little ones it is a sweet time to talk about <b>family</b>, <b>caring for each other</b> and <b>sharing</b>.',
    activities: [
      'Make a rakhi from wool and a paper flower, with an adult helping to tie it. Threading and knotting build fine motor skills.',
      'Name all the cousins and family members you love and count them on your fingers. Good for counting and language.',
    ],
    bar: 'Wishing every family a happy and loving Raksha Bandhan.',
  },
  janmashtami: {
    eyebrow: 'Birth of Lord Krishna',
    title: () => 'Happy Janmashtami',
    wishes: [
      'Wishing your family a joyful and blessed Janmashtami.',
      'May little Krishna’s smile bring joy to your home.',
      'Wishing every family love, laughter and sweet moments.',
    ],
    heading: 'Happy Janmashtami from Stories',
    about: 'Janmashtami celebrates the birth of Lord Krishna. Families decorate homes and cradles, sing bhajans, and little ones often dress up as Krishna and Radha.',
    little: 'For little ones it is a fun time to hear <b>stories</b> of little Krishna, enjoy <b>music</b> and play <b>dress-up</b>.',
    activities: [
      'Make a paper flute or a peacock feather with coloured paper and crayons. Good for colours and fine motor skills.',
      'Tell a story about little Krishna and the butter pot, and ask your child to act it out. Builds language and imagination.',
    ],
    bar: 'Wishing every family a joyful and blessed Janmashtami.',
  },
  onam: {
    eyebrow: 'Harvest festival',
    title: () => 'Happy Onam',
    wishes: [
      'Wishing your family a bright and happy Onam.',
      'May flowers, feasts and family fill your home with joy.',
      'Wishing every family plenty, peace and happiness this Onam.',
    ],
    heading: 'Happy Onam from Stories',
    about: 'Onam is the harvest festival of Kerala, welcoming the legendary King Mahabali. Families make pookalam flower carpets, wear new clothes and share a grand meal, the Onasadya, on banana leaves.',
    little: 'For little ones it is a lovely time to enjoy <b>flowers</b>, <b>circles and patterns</b> and <b>sharing a meal</b>.',
    activities: [
      'Make a small pookalam with fallen petals or coloured paper in circles. Builds patterns, colours and fine motor skills.',
      'Lay out a pretend feast with toy food on a paper leaf and name each item. Good for language and counting.',
    ],
    bar: 'Wishing every family a bright and happy Onam.',
  },
  'ganesh-chaturthi': {
    eyebrow: 'Welcoming Ganesha',
    title: () => 'Ganesh Chaturthi',
    wishes: [
      'Wishing your family a joyful and blessed Ganesh Chaturthi.',
      'May Lord Ganesha bring your home wisdom, joy and new beginnings.',
      'Wishing every family happiness and sweet modaks.',
    ],
    heading: 'Ganesh Chaturthi greetings from Stories',
    about: 'Ganesh Chaturthi celebrates the birth of Lord Ganesha, who is prayed to at every new beginning. Families welcome Ganesha idols home, offer prayers and share sweets such as modaks.',
    little: 'For little ones it is a fun time to hear <b>stories</b> of Ganesha, make <b>shapes</b> with clay and learn about <b>new beginnings</b>.',
    activities: [
      'Shape a little Ganesha from play dough or clay: a round body, a round head and a long trunk. Squeezing and rolling build fine motor skills.',
      'Count pretend modaks made of paper or play dough and share them out equally. Good for counting and sharing.',
    ],
    bar: 'Wishing every family joy and new beginnings this Ganesh Chaturthi.',
  },
  dussehra: {
    eyebrow: 'Good over evil',
    title: () => 'Happy Dussehra',
    wishes: [
      'Wishing your family a joyful and blessed Dussehra.',
      'May goodness always win in your home and your heart.',
      'Wishing every family happiness and success this Dasara.',
    ],
    heading: 'Happy Dussehra from Stories',
    about: 'Dussehra, or Dasara, celebrates the victory of good over evil and ends the nine nights of Navaratri. In Karnataka, Mysuru’s Dasara is famous, and many homes set up a display of dolls.',
    little: 'For little ones it is a good time to talk about <b>choosing good</b>, to enjoy <b>dolls and stories</b> and to learn <b>counting to nine</b>.',
    activities: [
      'Set up a small display of dolls and toys on steps or a shelf, and count them together. Good for arranging, counting and storytelling.',
      'Make a paper crown and act out a story where kindness wins. Builds imagination, language and fine motor skills.',
    ],
    bar: 'Wishing every family a joyful and blessed Dussehra.',
  },
  diwali: {
    eyebrow: 'Festival of lights',
    title: () => 'Happy Diwali',
    wishes: [
      'Wishing your family a bright and happy Diwali, full of laughter.',
      'May every diya light up a happy new beginning for your little one.',
      'May the festival of lights fill your home with joy and sweet smiles.',
    ],
    heading: 'Happy Diwali from Stories',
    about: 'Diwali celebrates the victory of light over darkness and good over evil. Families light diyas, draw colourful rangoli, share sweets and visit loved ones.',
    little: 'For little ones it is a lovely time to learn about <b>sharing</b>, <b>kindness</b> and <b>helping at home</b>, and to enjoy colours, shapes and patterns.',
    activities: [
      'Make a paper diya together: fold, colour and decorate it, then count the flames. A small craft that builds fine motor skills and counting.',
      'Draw a simple rangoli with chalk or rice: start with dots, join them into shapes, and fill them with colours. Great for patterns and hand control.',
    ],
    bar: 'Wishing every family a bright and happy festival of lights.',
  },
  'guru-nanak-jayanti': {
    eyebrow: 'Birth of Guru Nanak',
    title: () => 'Happy Gurpurab',
    wishes: [
      'Wishing every family peace, kindness and togetherness.',
      'May Guru Nanak’s message of sharing and equality guide us all.',
      'Wishing your family a peaceful and blessed Gurpurab.',
    ],
    heading: 'Guru Nanak Jayanti greetings from Stories',
    about: 'Guru Nanak Jayanti, or Gurpurab, marks the birth of Guru Nanak, the first Sikh Guru, who taught equality, honest work and sharing with others. Sikhs gather at gurdwaras for prayers and hymns, and langar, a free community meal, is served to all.',
    little: 'For little ones it is a good day to learn about <b>sharing</b>, <b>treating everyone equally</b> and <b>helping others</b>.',
    activities: [
      'Share a snack equally among the family, with your child handing out one piece to each person at a time. Good for counting and sharing.',
      'Help set the table or serve water to the family. Builds independence, coordination and a helping habit.',
    ],
    bar: 'Wishing every family peace and togetherness on Gurpurab.',
  },
  christmas: {
    eyebrow: 'Season of joy',
    title: () => 'Merry Christmas',
    wishes: [
      'Wishing your family a merry Christmas full of love and joy.',
      'May the season of giving bring warmth and smiles to your home.',
      'Twinkling stars, sweet carols and happy hearts to every family.',
    ],
    heading: 'Merry Christmas from Stories',
    about: 'Christmas celebrates the birth of Jesus. Families decorate trees and stars, sing carols, attend church, share cake and give gifts to loved ones.',
    little: 'For little ones it is a happy time to learn about <b>giving</b>, sing <b>carols</b> and enjoy <b>stars and lights</b>.',
    activities: [
      'Cut out paper stars, colour them and hang them up around the house. Good for shapes, colours and fine motor skills.',
      'Make a small gift or card for someone, such as a grandparent or neighbour. Builds kindness and fine motor skills.',
    ],
    bar: 'Wishing every family a merry Christmas full of love and joy.',
  },
};

/** Plain words for an occasion that has none of its own yet. */
export const fallbackText = (name: string): OccasionText => ({
  eyebrow: 'A special day',
  title: () => (name.length > 16 ? name : `Happy ${name}`),
  wishes: [`Warm wishes on ${name} from all of us at Stories for All.`],
  heading: `${name} from Stories`,
  about: `Today is ${name}.`,
  little: 'A lovely day to find a book about it.',
  activities: ['Ask at your branch for a book about the day, and read it together.'],
  bar: 'Warm wishes from all of us at Stories for All.',
});


