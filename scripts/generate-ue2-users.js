/**
 * generate-ue2-users.js
 * Generate 200 US-based UE test users (Round 2) for UI/UX bug testing
 * Prefix: ue-test2-
 * Run: cd nexus-app && node scripts/generate-ue2-users.js
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

const BATCH = 25;

const MALE_FIRST = [
  'Marcus','Tyrell','Javier','Malik','Andre','Terrence','Darius','Quentin','Deshawn','Kareem',
  'Dante','Corey','Trey','Deandre','Jamal','Rashad','Kendrick','Lamont','Jermaine','Antwan',
  'Cedric','Luther','Cornelius','Ezekiel','Montgomery','Sterling','Beauregard','Prescott','Tobias','Thaddeus',
  'River','Finn','Beau','Gage','Jett','Colt','Ryder','Bridger','Canyon','Denver',
  'Maverick','Bodhi','Zion','Jaxson','Kairo','Nash','Remy','Wells','Sawyer','Hayes'
];

const FEMALE_FIRST = [
  'Destiny','Sienna','Jada','Nia','Aaliyah','Kiara','Zara','Maya','Aria','Luna',
  'Naomi','Elena','Mila','Sofia','Valentina','Camila','Isabella','Gianna','Layla','Chloe',
  'Zoe','Harper','Amelia','Evelyn','Nova','Quinn','Piper','Rylee','Emery','Oakley',
  'Callie','Haven','Blair','Sage','Wren','Tatum','Marlowe','Lux','Rowan','Emerson',
  'Ellis','Finley','Noa','Arden','Sawyer','Harley','Robin','Frankie','Cameron','Shawn'
];

const LAST_NAMES = [
  'Washington','Jefferson','Adams','Madison','Monroe','Jackson','Harrison','Tyler','Polk','Taylor',
  'Fillmore','Pierce','Buchanan','Lincoln','Grant','Hayes','Garfield','Arthur','Cleveland','Wilson',
  'Harrison','McKinley','Roosevelt','Taft','Wilson','Harding','Coolidge','Hoover','Truman','Eisenhower',
  'Thompson','Richardson','Anderson','Campbell','Mitchell','Roberts','Carter','Phillips','Evans','Turner',
  'Torres','Parker','Collins','Edwards','Stewart','Flores','Morris','Nguyen','Murphy','Rivera',
  'Cook','Rogers','Morgan','Peterson','Cooper','Reed','Bailey','Bell','Howard','Ward'
];

const US_CITIES = [
  { city: 'New York', state: 'NY' }, { city: 'Los Angeles', state: 'CA' },
  { city: 'Chicago', state: 'IL' }, { city: 'Houston', state: 'TX' },
  { city: 'Miami', state: 'FL' }, { city: 'Atlanta', state: 'GA' },
  { city: 'Phoenix', state: 'AZ' }, { city: 'Denver', state: 'CO' },
  { city: 'Seattle', state: 'WA' }, { city: 'Portland', state: 'OR' },
  { city: 'Austin', state: 'TX' }, { city: 'Nashville', state: 'TN' },
  { city: 'San Diego', state: 'CA' }, { city: 'Boston', state: 'MA' },
  { city: 'Dallas', state: 'TX' }, { city: 'Minneapolis', state: 'MN' },
  { city: 'Charlotte', state: 'NC' }, { city: 'Tampa', state: 'FL' },
  { city: 'Las Vegas', state: 'NV' }, { city: 'Detroit', state: 'MI' },
];

const BIO_MALE = [
  'Looking for someone who can keep up with my energy — gym in the morning, brunch on weekends.',
  'Tech bro with a soft side. I run marathons and adopt senior dogs.',
  'Chef turned software developer. I make the best ramen you will ever taste.',
  'Stand-up comedian by night, data analyst by day. Laughs guaranteed.',
  'Outdoor enthusiast — camping, climbing, kayaking. Seeking my adventure partner.',
  'Music producer and vinyl collector. My apartment is basically a record store.',
  'Urban farmer and fermentation nerd. Homemade kimchi is my love language.',
  'Architect who designs tiny homes. Minimalist lifestyle, maximalist dreams.',
  'Former military, now pursuing my MBA. Discipline and ambition define me.',
  'Surf instructor in the summer, snowboard instructor in the winter.',
  'Amateur astronomer with a telescope on my roof. Let me show you the stars.',
  'Craft cocktail bartender who knows every speakeasy in the city.',
  'Electrician by trade, musician by passion. Blues guitar is my therapy.',
  'Personal trainer who believes in holistic wellness — mind, body, and soul.',
  'Documentary photographer capturing everyday heroes. Everyone has a story.',
  'Mechanical engineer who restores vintage motorcycles. Grease and gasoline.',
  'Coffee roaster and part-time DJ. I take both very seriously.',
  'High school history teacher and coach. Shaping minds and building character.',
  'Landscape architect who turns concrete jungles into green oases.',
  'Venture capitalist with a passion for sustainable startups and sushi.',
];

const BIO_FEMALE = [
  'Yoga therapist and meditation guide. Finding peace one breath at a time.',
  'Baker extraordinaire — my croissants have been featured in two magazines.',
  'Marine biologist working on coral reef restoration. The ocean is my office.',
  'Improv comedian and speech therapist. I help people find their voice, literally.',
  'Fashion designer focused on sustainable clothing. Style with a conscience.',
  'Sports medicine doctor for a professional soccer team. On the sidelines and in the game.',
  'Ceramic artist with a studio in Brooklyn. Each piece tells a story.',
  'Investigative journalist covering environmental justice. Truth matters.',
  'Somatic healer and dance movement therapist. The body keeps the score.',
  'Airbnb superhost and interior stylist. I make spaces feel like home.',
  'Neuroscientist studying the biology of attraction. Yes, I analyze everything.',
  'Equestrian trainer and animal rescue volunteer. Horses taught me patience.',
  'Mixologist and flavor chemist. I create drinks you have never tasted before.',
  'Civil rights attorney fighting for housing equality. Justice is not optional.',
  'Glassblower and installation artist. I shape fire into beauty.',
  'Paleontologist who digs up dinosaurs for a living. Old soul, literally.',
  'Nurse midwife and birth advocate. Bringing new life into the world.',
  'Soil scientist working on regenerative agriculture. Dirt is fascinating.',
  'Opera singer and vocal coach. I hit high notes in life and music.',
  'Tech ethics researcher at a major university. Building a better digital future.',
];

const OCCUPATIONS = [
  'Software Engineer','UX Designer','Product Manager','Data Scientist','Marketing Director',
  'Architect','Financial Analyst','ER Nurse','Doctor','Lawyer',
  'Photographer','Writer','Entrepreneur','Chef','Graphic Designer',
  'Physical Therapist','Veterinarian','Journalist','Research Scientist','Pilot',
  'Civil Engineer','Art Director','Clinical Psychologist','Real Estate Agent','Bartender',
  'Teacher','Paralegal','Interior Designer','Electrician','Personal Trainer',
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
  'Comedy','Theater','Podcasts','Astronomy','Pottery','Board Games',
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

async function createUserWithRetry(data, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await prisma.user.create(data);
      return true;
    } catch (err) {
      if (err.code === 'P2002' || (err.message && err.message.includes('UNIQUE constraint'))) return false;
      if (attempt === maxRetries) throw err;
      await new Promise(r => setTimeout(r, 1000 * attempt));
    }
  }
}

async function main() {
  const hashedPw = await bcrypt.hash('BotUser2026!Secure', 10);
  let created = 0, errors = 0;

  console.log(`\n${'='.repeat(50)}`);
  console.log(' LokFeel UE Test User Generator — Round 2');
  console.log(' 200 US Users (100M + 100F) | Prefix: ue-test2-');
  console.log(`${'='.repeat(50)}\n`);

  for (const gender of ['MALE', 'FEMALE']) {
    const count = 100;
    const isMale = gender === 'MALE';
    const names = isMale ? MALE_FIRST : FEMALE_FIRST;

    for (let batch = 0; batch < count / BATCH; batch++) {
      console.log(`  Creating batch ${batch + 1}/${count / BATCH} (${gender})...`);

      for (let i = 0; i < BATCH; i++) {
        const idx = batch * BATCH + i;
        if (idx >= count) break;
        const first = names[idx % names.length];
        const last = pick(LAST_NAMES);
        const loc = pick(US_CITIES);
        const age = rand(21, 42);
        const num = String(idx + 1).padStart(3, '0');
        const email = `ue-test2-${isMale ? 'm' : 'f'}${num}@lokfeel.bot`;
        const seed = `ue-test2-${isMale ? 'm' : 'f'}${num}`;

        try {
          const ok = await createUserWithRetry({
            data: {
              email,
              password: hashedPw,
              name: `${first} ${last}`,
              isBot: true,
              botType: 'training',
              emailVerified: new Date(),
              profile: {
                create: {
                  displayName: `${first} ${last.charAt(0)}.`,
                  age,
                  gender,
                  genderIdentity: gender,
                  sexuality: pick(['STRAIGHT','BISEXUAL','NOT_SURE','PANSEXUAL']),
                  city: `${loc.city}, ${loc.state}`,
                  country: 'US',
                  profileStatus: 'APPROVED',
                  isApproved: true,
                  isVerified: true,
                  onboardingStep: 9,
                  bio: isMale ? pick(BIO_MALE) : pick(BIO_FEMALE),
                  selectedTags: JSON.stringify(unique(INTERESTS, rand(3, 6))),
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
                  lifePriorities: JSON.stringify(unique(['Career','Family','Adventure','Stability','Creativity','Health','Travel','Learning','Community'], rand(2, 5))),
                  emotionalAvailability: pick(['Fully Available','Mostly Available','Working On It','Selectively Available']),
                  boundaries: JSON.stringify([]),
                  dealbreakers: JSON.stringify(unique(['Smoking','Dishonesty','No Ambition','Poor Communication','Jealousy','Controlling'], rand(1, 3))),
                }
              }
            }
          });
          if (ok) created++;
          else console.log(`   !! Duplicate: ${email}`);
        } catch (err) {
          console.error(`   !! ${email}: ${err.message?.substring(0, 80)}`);
          errors++;
        }
      }
      if (created % 50 === 0 || created > 0) console.log(`   -> ${created} users created so far...`);
      // Small delay between batches
      await new Promise(r => setTimeout(r, 200));
    }
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log(` DONE: ${created} created, ${errors} errors`);

  const total = await prisma.user.count({ where: { email: { startsWith: 'ue-test2-' } } });
  const males = await prisma.user.count({ where: { email: { startsWith: 'ue-test2-m' } } });
  const females = await prisma.user.count({ where: { email: { startsWith: 'ue-test2-f' } } });

  console.log(`   ue-test2-: Total=${total} | Male=${males} | Female=${females}`);

  const allUsers = await prisma.user.count();
  const allBots = await prisma.user.count({ where: { isBot: true } });
  const allProfiles = await prisma.profile.count();
  console.log(`   Grand Total: Users=${allUsers} | Bots=${allBots} | Profiles=${allProfiles}`);
  console.log(`${'='.repeat(50)}\n`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
