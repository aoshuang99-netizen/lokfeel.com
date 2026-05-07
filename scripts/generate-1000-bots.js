/**
 * generate-1000-bots.js
 * Generate 1000 bot users (500M + 500F) for matching engine activity
 * Run: cd nexus-app && node scripts/generate-1000-bots.js
 */
const { PrismaClient } = require('../src/generated/client');
const { PrismaLibSql } = require('@prisma/adapter-libsql');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '..', '.env.local');
const envContent = fs.readFileSync(envPath, 'utf8');
const envVars = {};
envContent.split('\n').forEach(line => {
  const [key, ...rest] = line.split('=');
  if (key && rest.length) envVars[key.trim()] = rest.join('=').trim();
});

const rawUrl = (envVars.DATABASE_URL || '').trim();
const authToken = (envVars.TURSO_AUTH_TOKEN || '').trim();

function cleanLibsqlUrl(url) {
  try {
    const parsed = new URL(url);
    ['sslmode','ssl','channel_binding','connect_timeout','statement_timeout','application_name','options'].forEach(p => parsed.searchParams.delete(p));
    return parsed.toString();
  } catch { return url; }
}

const adapter = new PrismaLibSql({ url: cleanLibsqlUrl(rawUrl), authToken: authToken || undefined });
const prisma = new PrismaClient({ adapter });

const BATCH = 50;

const MALE_FIRST = [
  'James','Robert','John','Michael','David','William','Richard','Joseph','Thomas','Charles',
  'Christopher','Daniel','Matthew','Anthony','Mark','Donald','Steven','Paul','Andrew','Joshua',
  'Kenneth','Kevin','Brian','George','Timothy','Ronald','Edward','Jason','Jeffrey','Ryan',
  'Jacob','Gary','Nicholas','Eric','Jonathan','Stephen','Larry','Justin','Scott','Brandon',
  'Benjamin','Samuel','Raymond','Gregory','Frank','Alexander','Patrick','Jack','Dennis','Jerry',
  'Tyler','Aaron','Jose','Adam','Nathan','Henry','Douglas','Peter','Zachary','Ethan',
  'Noah','Liam','Mason','Logan','Lucas','Aiden','Elijah','Carter','Sebastian','Owen',
  'Caleb','Dylan','Luke','Gabriel','Jackson','Lincoln','Theodore','Wyatt','Leo','Hunter',
  'Ezra','Asher','Hudson','Kai','Silas','Jasper','Finn','Carson','Axel','Milo',
  'Max','Adrian','Jace','Wayne','Elliott','Miles','Dominic','Nash','River','Sawyer',
  'Tristan','Beckett','Tobias','Declan','Graham','Colton','Camden','Beau','Atlas','Remy',
  'Enzo','Arlo','Felix','Brooks','Hendrix','Knox','Leon','Phoenix','Zane','Ace',
  'Paxton','Gunnar','Soren','Orion','Ryder','Titan','Cruz','Bryce','Jensen','Lane'
];

const FEMALE_FIRST = [
  'Mary','Patricia','Jennifer','Linda','Barbara','Elizabeth','Susan','Jessica','Sarah','Karen',
  'Lisa','Nancy','Betty','Margaret','Sandra','Ashley','Dorothy','Kimberly','Emily','Donna',
  'Michelle','Carol','Amanda','Melissa','Deborah','Stephanie','Rebecca','Sharon','Laura','Cynthia',
  'Kathleen','Amy','Angela','Shirley','Anna','Brenda','Pamela','Emma','Nicole','Helen',
  'Samantha','Katherine','Christine','Debra','Rachel','Carolyn','Janet','Catherine','Maria','Heather',
  'Olivia','Ava','Sophia','Isabella','Mia','Charlotte','Amelia','Harper','Evelyn','Abigail',
  'Ella','Scarlett','Grace','Lily','Chloe','Zoey','Penelope','Layla','Riley','Nora',
  'Camila','Hannah','Aria','Addison','Eleanor','Aubrey','Ellie','Stella','Natalie','Zoe',
  'Leah','Hazel','Violet','Aurora','Savannah','Audrey','Brooklyn','Bella','Claire','Skylar',
  'Lucy','Paisley','Elliana','Nova','Naomi','Caroline','Genesis','Emilia','Kennedy','Maya',
  'Willow','Kinsley','Aaliyah','Elena','Ariana','Allison','Gabriella','Alice','Madelyn','Cora',
  'Ruby','Eva','Serena','Valentina','Emery','Liliana','Clara','Iris','Quinn','Stella'
];

const LAST_NAMES = [
  'Smith','Johnson','Williams','Brown','Jones','Garcia','Miller','Davis','Rodriguez','Martinez',
  'Hernandez','Lopez','Gonzalez','Wilson','Anderson','Thomas','Taylor','Moore','Jackson','Martin',
  'Lee','Perez','Thompson','White','Harris','Sanchez','Clark','Ramirez','Lewis','Robinson',
  'Walker','Young','Allen','King','Wright','Scott','Torres','Nguyen','Hill','Flores',
  'Green','Adams','Nelson','Baker','Hall','Rivera','Campbell','Mitchell','Carter','Roberts',
  'Turner','Phillips','Evans','Collins','Edwards','Stewart','Morris','Murphy','Cook','Rogers',
  'Morgan','Peterson','Cooper','Reed','Bailey','Bell','Gomez','Kelly','Howard','Ward',
  'Cox','Diaz','Richardson','Wood','Watson','Brooks','Bennett','Gray','James','Reyes',
  'Cruz','Hughes','Price','Myers','Long','Foster','Sanders','Ross','Morales','Powell',
  'Sullivan','Russell','Ortiz','Jenkins','Gutierrez','Perry','Butler','Barnes','Fisher','Henderson',
  'Cole','West','Jordan','Reynolds','Elliott','Crawford','Ruiz','Gonzales','Mason','Grant'
];

const CITIES = [
  { city: 'New York', state: 'NY' }, { city: 'Los Angeles', state: 'CA' },
  { city: 'Chicago', state: 'IL' }, { city: 'Houston', state: 'TX' },
  { city: 'San Francisco', state: 'CA' }, { city: 'Seattle', state: 'WA' },
  { city: 'Austin', state: 'TX' }, { city: 'Denver', state: 'CO' },
  { city: 'Miami', state: 'FL' }, { city: 'Boston', state: 'MA' },
  { city: 'Portland', state: 'OR' }, { city: 'Nashville', state: 'TN' },
  { city: 'Phoenix', state: 'AZ' }, { city: 'Atlanta', state: 'GA' },
  { city: 'Dallas', state: 'TX' }, { city: 'San Diego', state: 'CA' },
  { city: 'Minneapolis', state: 'MN' }, { city: 'Tampa', state: 'FL' },
  { city: 'Charlotte', state: 'NC' }, { city: 'Philadelphia', state: 'PA' },
];

const BIO_MALE = [
  'Love hiking and trying new restaurants. Looking for someone genuine who shares my passion for adventure.',
  'Software engineer by day, home cook by night. I believe the best dates involve great food and deeper conversations.',
  'Fitness enthusiast and dog dad. Weekend warrior looking for my partner in crime.',
  'Creative soul who enjoys photography, live music, and spontaneous road trips.',
  'Ambitious professional who values work-life balance. Looking for someone to explore the city with.',
  'Book lover and coffee snob. Let me make you my famous espresso and talk about our favorite novels.',
  'Sports fan, craft beer lover, and aspiring chef. I can grill a mean steak!',
  'Tech startup founder with a passion for travel. 30 countries and counting.',
  'Musician at heart — play guitar and write songs. Looking for my biggest fan.',
  'Outdoor adventurer who kayaks, climbs, and camps. Nature is my therapy.',
  'Data scientist who loves finding patterns — except in dating, where surprises are welcome.',
  'Yoga practitioner who can still enjoy a good burger. Balance is everything.',
  'Architecture lover who explores cities on foot. Every building tells a story.',
  'Aspiring sommelier and world cuisine enthusiast. Let me cook you dinner.',
  'Night owl who enjoys stargazing, deep conversations, and midnight snacks.',
  'Volunteer firefighter and mechanical engineer. I fix things — including hearts.',
  'Comedy fan and amateur improv performer. I promise to make you laugh.',
  'Marine biology grad who still gets excited about tide pools. Ocean lover for life.',
  'Urban farmer with a rooftop garden. Tomatoes, herbs, and good company.',
  'Former college athlete turned consultant. Still competitive — especially at board games.',
];

const BIO_FEMALE = [
  'Yoga instructor and wellness coach. Looking for balance in love and life.',
  'Creative director who loves art galleries, wine tasting, and weekend getaways.',
  'Travel writer who has lived in 5 countries. Always planning the next adventure.',
  'Startup founder passionate about edtech. Coffee addict and bookworm.',
  'Musician and music teacher. Love jazz, indie rock, and teaching kids to play piano.',
  'Environmental lawyer fighting climate change. Looking for someone who cares about the planet.',
  'Foodie and amateur chef. Always hunting for the best tacos in town.',
  'ER nurse with a wicked sense of humor. I save lives and crack jokes.',
  'Graphic designer and cat mom. My apartment is a mix of design books and cat hair.',
  'Former professional dancer turned physical therapist. Movement is my love language.',
  'Architect who designs sustainable buildings. I see beauty in structure and in people.',
  'Financial analyst by day, salsa dancer by night. Numbers and rhythm — I love both.',
  'Photographer specializing in street art and portraits. Let me take your photo.',
  'Veterinarian who works with rescue animals. My heart is full of fur babies.',
  'Documentary filmmaker. I tell stories that matter and want to hear yours.',
  'UX designer who cares about making the world more accessible. Also obsessed with houseplants.',
  'Surgeon with a passion for painting. Precision and creativity — in the OR and on canvas.',
  'Journalist covering social justice issues. Looking for someone who stands for something.',
  'Interior designer who can transform any space. My apartment is my portfolio.',
  'Marine biologist studying coral reefs. Ocean lover seeking a land connection.',
];

const OCCUPATIONS = [
  'Software Engineer','UX Designer','Product Manager','Data Scientist','Marketing Manager',
  'Consultant','Architect','Financial Analyst','Nurse','Doctor','Lawyer','Teacher',
  'Photographer','Writer','Entrepreneur','Chef','Graphic Designer','Physical Therapist',
  'Veterinarian','Journalist','Interior Designer','Research Scientist','Civil Engineer',
  'Art Director','Environmental Consultant','Investment Banker','Clinical Psychologist',
  'Biomedical Engineer','Real Estate Agent','Pilot',
];

const REL_GOALS = ['LONG_TERM','DATING','NOT_SURE','FRIENDSHIP'];
const ATT_STYLES = ['SECURE','ANXIOUS_PREOCCUPIED','DISMISSIVE_AVOIDANT','FEARFUL_AVOIDANT'];
const COM_STYLES = ['DIRECT','THOUGHTFUL','EMOTIONAL','ANALYTICAL'];
const CONF_STYLES = ['COLLABORATIVE','COMPROMISING','ACCOMMODATING','AVOIDING'];
const LOVE_LANGS = ['WORDS_OF_AFFIRMATION','QUALITY_TIME','PHYSICAL_TOUCH','ACTS_OF_SERVICE','GIFT_GIVING'];

const INTERESTS = [
  'Travel','Cooking','Photography','Hiking','Yoga','Reading','Music','Art',
  'Fitness','Movies','Gaming','Dancing','Coffee','Wine','Craft Beer',
  'Surfing','Rock Climbing','Cycling','Running','Swimming','Skiing',
  'Meditation','Gardening','Writing','Painting','Volunteering','Languages',
  'Tech','Science','Fashion','Architecture','History','Philosophy',
  'Comedy','Theater','Podcasts','Astronomy','Birdwatching','Pottery',
];

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function unique(arr, n) {
  const copy = [...arr].sort(() => Math.random() - 0.5);
  return copy.slice(0, Math.min(n, copy.length));
}

function generateAvatarUrl(gender, seed) {
  const style = gender === 'MALE' ? 'avataaars' : 'notionists';
  return `https://api.dicebear.com/7.x/${style}/svg?seed=${encodeURIComponent(seed)}&backgroundColor=b6e3f4,c0aede,d1d4f9`;
}

// Retry wrapper for Turso transient errors
async function createUserWithRetry(email, first, last, gender, isMale, loc, age, seed, hashedPw, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await prisma.user.create({
        data: {
          email,
          password: hashedPw,
          name: `${first} ${last}`,
          isBot: true,
          botType: 'seed',
          emailVerified: new Date(),
          profile: {
            create: {
              displayName: `${first} ${last.charAt(0)}.`,
              age,
              gender,
              genderIdentity: gender,
              sexuality: pick(['STRAIGHT','BISEXUAL','NOT_SURE']),
              city: `${loc.city}, ${loc.state}`,
              country: 'US',
              profileStatus: 'APPROVED',
              isApproved: true,
              isVerified: true,
              onboardingStep: 9,
              bio: isMale ? pick(BIO_MALE) : pick(BIO_FEMALE),
              selectedTags: JSON.stringify(unique(INTERESTS, rand(2, 5))),
              occupation: pick(OCCUPATIONS),
              relationshipGoal: pick(REL_GOALS),
              attachmentStyle: pick(ATT_STYLES),
              communicationStyle: pick(COM_STYLES),
              conflictResolution: pick(CONF_STYLES),
              loveLanguage: pick(LOVE_LANGS),
              preferredGender: isMale ? 'FEMALE' : 'MALE',
              personalityData: JSON.stringify({
                openness: rand(50,95), conscientiousness: rand(50,95),
                extraversion: rand(30,90), agreeableness: rand(40,95), neuroticism: rand(10,60),
              }),
              avatar: generateAvatarUrl(gender, seed),
              galleryPhotos: '[]',
              lifePriorities: JSON.stringify(unique(['Career','Family','Adventure','Stability','Creativity','Health','Travel','Learning'], rand(2, 4))),
              emotionalAvailability: pick(['Fully Available','Mostly Available','Working On It']),
              boundaries: JSON.stringify([]),
              dealbreakers: JSON.stringify(unique(['Smoking','Dishonesty','No Ambition','Poor Communication'], rand(1, 3))),
            }
          }
        }
      });
      return; // success
    } catch (err) {
      if (err.code === 'P2002' || (err.message && err.message.includes('UNIQUE constraint'))) throw err; // duplicate, don't retry
      if (attempt === maxRetries) throw err;
      console.log(`   .. Retry ${attempt}/${maxRetries} for ${email} (${err.message?.substring(0, 50)})`);
      await new Promise(r => setTimeout(r, 1000 * attempt)); // backoff
    }
  }
}

async function main() {
  const hashedPw = await bcrypt.hash('BotUser2026!Secure', 10);
  let created = 0, errors = 0;

  console.log(`\n${'='.repeat(50)}`);
  console.log(' LokFeel Bot User Generator — 1000 Users');
  console.log(' 500 Male + 500 Female | Prefix: bot3-');
  console.log(`${'='.repeat(50)}\n`);

  for (const gender of ['MALE', 'FEMALE']) {
    const count = 500;
    const isMale = gender === 'MALE';
    const names = isMale ? MALE_FIRST : FEMALE_FIRST;

    for (let batch = 0; batch < count / BATCH; batch++) {
      console.log(`  Creating batch ${batch + 1}/${count / BATCH} (${gender})...`);

      for (let i = 0; i < BATCH; i++) {
        const idx = batch * BATCH + i;
        const first = names[idx % names.length];
        const last = pick(LAST_NAMES);
        const loc = pick(CITIES);
        const age = rand(21, 42);
        const num = String(idx + 1).padStart(4, '0');
        const email = `bot3-${isMale ? 'm' : 'f'}${num}@lokfeel.bot`;
        const seed = `bot3-${isMale ? 'm' : 'f'}${num}`;

        try {
          await createUserWithRetry(email, first, last, gender, isMale, loc, age, seed, hashedPw);
          created++;
          if (created % 100 === 0) console.log(`   -> ${created} users created...`);
        } catch (err) {
          if (err.code === 'P2002') {
            console.log(`   !! Duplicate: ${email} (skipping)`);
          } else {
            console.error(`   !! ${email}: ${err.message?.substring(0, 80)}`);
            errors++;
          }
        }

        // Small delay to avoid Turso rate limits
        if (i % 10 === 0) await new Promise(r => setTimeout(r, 100));
      }
    }
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log(` DONE: ${created} created, ${errors} errors`);

  const total = await prisma.user.count({ where: { email: { startsWith: 'bot3-' } } });
  const males = await prisma.user.count({ where: { email: { startsWith: 'bot3-m' } } });
  const females = await prisma.user.count({ where: { email: { startsWith: 'bot3-f' } } });
  const profiles = await prisma.profile.count({ where: { user: { email: { startsWith: 'bot3-' } } } });

  console.log(`   bot2- prefix: Total=${total} | Male=${males} | Female=${females} | Profiles=${profiles}`);

  // Grand total
  const allUsers = await prisma.user.count();
  const allBots = await prisma.user.count({ where: { isBot: true } });
  const allProfiles = await prisma.profile.count();
  console.log(`   Grand Total: Users=${allUsers} | Bots=${allBots} | Profiles=${allProfiles}`);
  console.log(`${'='.repeat(50)}\n`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
