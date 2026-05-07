/**
 * generate-ue-users.ts
 * Generate 200 US-based test users for UX testing
 * Run: cd nexus-app && npx tsx scripts/generate-ue-users.ts
 */
const { PrismaClient } = require('../src/generated/client');
const { PrismaLibSql } = require('@prisma/adapter-libsql');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

// Load env vars from .env.local
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

const MALE_FIRST = [
  'James','Robert','John','Michael','David','William','Richard','Joseph','Thomas','Charles',
  'Christopher','Daniel','Matthew','Anthony','Mark','Donald','Steven','Paul','Andrew','Joshua',
  'Kenneth','Kevin','Brian','George','Timothy','Ronald','Edward','Jason','Jeffrey','Ryan',
  'Jacob','Gary','Nicholas','Eric','Jonathan','Stephen','Larry','Justin','Scott','Brandon',
  'Benjamin','Samuel','Raymond','Gregory','Frank','Alexander','Patrick','Jack','Dennis','Jerry',
  'Tyler','Aaron','Jose','Adam','Nathan','Henry','Douglas','Peter','Zachary','Ethan',
  'Noah','Liam','Mason','Logan','Lucas','Aiden','Elijah','Carter','Sebastian','Owen',
  'Caleb','Dylan','Luke','Gabriel','Jackson','Lincoln','Theodore','Wyatt','Leo','Hunter',
  'Ezra','Asher','Hudson','Kai','Silas','Jasper','Finn','Carson','Axel','Milo'
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
  'Leah','Hazel','Violet','Aurora','Savannah','Audrey','Brooklyn','Bella','Claire','Skylar'
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
  'Cruz','Hughes','Price','Myers','Long','Foster','Sanders','Ross','Morales','Powell'
];

const US_CITIES = [
  { city: 'New York', state: 'NY' },
  { city: 'Los Angeles', state: 'CA' },
  { city: 'Chicago', state: 'IL' },
  { city: 'San Francisco', state: 'CA' },
  { city: 'Seattle', state: 'WA' },
  { city: 'Austin', state: 'TX' },
  { city: 'Denver', state: 'CO' },
  { city: 'Miami', state: 'FL' },
  { city: 'Boston', state: 'MA' },
  { city: 'Portland', state: 'OR' },
  { city: 'Nashville', state: 'TN' },
  { city: 'Atlanta', state: 'GA' },
  { city: 'Phoenix', state: 'AZ' },
  { city: 'San Diego', state: 'CA' },
  { city: 'Dallas', state: 'TX' },
  { city: 'Minneapolis', state: 'MN' },
  { city: 'Charlotte', state: 'NC' },
  { city: 'Philadelphia', state: 'PA' },
  { city: 'Washington', state: 'DC' },
  { city: 'Las Vegas', state: 'NV' },
];

const INTERESTS = [
  'Photography','Travel','Hiking','Cooking','Yoga','Reading','Music','Movies','Art',
  'Fitness','Running','Cycling','Swimming','Dancing','Gaming','Wine','Coffee',
  'Meditation','Surfing','Rock Climbing','Camping','Skiing','Gardening','Writing',
  'Theater','Comedy','Fashion','Design','Tech','Startups'
];

const BIO_MALE = [
  'Adventure seeker and coffee lover. Looking for someone genuine.',
  'Tech guy by day, foodie by night. Let\'s grab sushi.',
  'New to the city, looking to explore and meet new people.',
  'Dog dad, marathon runner, and amateur chef.',
  'Passionate about music and outdoor adventures.',
  'Software engineer who loves hiking and craft beer.',
  'Bookworm with a passion for travel and good conversations.',
  'Fitness enthusiast looking for my workout partner.',
  'Creative soul - into photography, design, and late-night talks.',
  'Simple guy looking for real connections. No games.'
];

const BIO_FEMALE = [
  'Sunshine mixed with a little hurricane. Love travel and laughter.',
  'Book lover, wine enthusiast, and sunset chaser.',
  'Yoga instructor finding balance in the city.',
  'Art lover who believes in deep conversations and spontaneous trips.',
  'Foodie, adventurer, and hopeless romantic.',
  'Ambitious professional who loves cooking and weekend getaways.',
  'Coffee addict and cat mom. Let\'s explore the city together.',
  'Creative spirit - into music, art, and meaningful connections.',
  'Looking for someone who can keep up with my energy.',
  'Life is short - let\'s make it sweet.'
];

const REL_GOALS = ['CASUAL_DATING', 'MONOGAMY', 'LONG_TERM', 'ETHICAL_NON_MONOGAMY', 'FRIENDSHIP_FIRST'];
const ATT_STYLES = ['SECURE', 'ANXIOUS_PREOCCUPIED', 'DISMISSIVE_AVOIDANT', 'FEARFUL_AVOIDANT'];
const COM_STYLES = ['DIRECT', 'THOUGHTFUL', 'PLAYFUL', 'ANALYTICAL'];
const CONF_STYLES = ['COLLABORATIVE', 'COMPROMISING', 'ACCOMMODATING', 'COMPETING'];
const LOVE_LANGS = ['WORDS_OF_AFFIRMATION', 'QUALITY_TIME', 'PHYSICAL_TOUCH', 'ACTS_OF_SERVICE', 'GIFT_GIVING'];

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function unique(arr, count) {
  const shuffled = [...arr].sort(() => 0.5 - Math.random());
  return shuffled.slice(0, count);
}

async function main() {
  const PER_GENDER = 100;
  const BATCH = 20;

  console.log('\n🚀 UE Test User Generation');
  console.log(`   Target: ${PER_GENDER * 2} users (${PER_GENDER}M + ${PER_GENDER}F)`);
  console.log('   Prefix: ue-test\n');

  // Cleanup
  const existing = await prisma.user.findMany({
    where: { email: { startsWith: 'ue-test-' } },
    select: { id: true }
  });
  if (existing.length > 0) {
    console.log(`🧹 Cleaning up ${existing.length} existing ue-test users...`);
    await prisma.profile.deleteMany({ where: { userId: { in: existing.map(u => u.id) } } });
    await prisma.user.deleteMany({ where: { id: { in: existing.map(u => u.id) } } });
    console.log('   ✅ Cleaned\n');
  }

  const hashedPw = await bcrypt.hash('UETest2026!Secure', 10);
  let created = 0, errors = 0;

  for (let batch = 0; batch < PER_GENDER / BATCH; batch++) {
    for (const gender of ['MALE', 'FEMALE']) {
      const isMale = gender === 'MALE';
      const names = isMale ? MALE_FIRST : FEMALE_FIRST;

      for (let i = 0; i < BATCH; i++) {
        const idx = batch * BATCH + i;
        const first = names[idx % names.length];
        const last = pick(LAST_NAMES);
        const loc = pick(US_CITIES);
        const age = rand(21, 42);
        const num = String(idx + 1).padStart(3, '0');
        const email = `ue-test-${isMale ? 'm' : 'f'}${num}@lokfeel.bot`;

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
                  sexuality: 'STRAIGHT',
                  city: `${loc.city}, ${loc.state}`,
                  country: 'US',
                  profileStatus: 'APPROVED',
                  isApproved: true,
                  onboardingStep: 9,
                  bio: isMale ? pick(BIO_MALE) : pick(BIO_FEMALE),
                  selectedTags: JSON.stringify(unique(INTERESTS, rand(2, 5))),
                  occupation: pick(['Software Engineer','Designer','Marketing Manager','Teacher','Doctor','Financial Analyst','Product Manager','Consultant','Photographer','Writer','Entrepreneur','Architect','Data Scientist','Nurse','Lawyer','Chef']),
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
                  avatar: null,
                  galleryPhotos: '[]',
                  lifePriorities: JSON.stringify(unique(['Career','Family','Adventure','Stability','Creativity','Health','Travel','Learning'], rand(2, 4))),
                }
              }
            }
          });
          created++;
          if (created % 40 === 0) console.log(`   ✅ ${created} users created...`);
        } catch (err) {
          if (err.code === 'P2002') {
            console.log(`   ⚠️  Duplicate: ${email}`);
          } else {
            console.error(`   ❌ ${email}: ${err.message}`);
            errors++;
          }
        }
      }
    }
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log(`📊 DONE: ${created} created, ${errors} errors`);

  // Verify
  const total = await prisma.user.count({ where: { email: { startsWith: 'ue-test-' } } });
  const males = await prisma.user.count({ where: { email: { startsWith: 'ue-test-m' } } });
  const females = await prisma.user.count({ where: { email: { startsWith: 'ue-test-f' } } });
  const profiles = await prisma.profile.count({ where: { user: { email: { startsWith: 'ue-test-' } } } });

  console.log(`   Total: ${total} | Male: ${males} | Female: ${females} | Profiles: ${profiles}`);
  console.log(`${'='.repeat(50)}\n`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
