/**
 * E2E Payment Test: Create 50 Paid Test Users
 * 
 * 直接通过数据库创建50个付费测试用户，模拟完整Stripe支付流程：
 * 1. 创建用户 + Profile（男性，可付费）
 * 2. 创建Subscription（PREMIUM_MONTHLY/PREMIUM_YEARLY混合）
 * 3. 创建Payment记录（SUCCEEDED）
 * 4. 创建Notification（支付成功通知）
 * 5. 验证所有数据完整性
 * 
 * Usage: npx tsx scripts/e2e-payment/create-paid-test-users.ts
 */

import 'dotenv/config';
import * as bcrypt from 'bcryptjs';
import { PrismaClient, $Enums } from '../../src/generated/index.js';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const PASSWORD = 'TestPaid123!';
const TEST_USER_COUNT = 50;

// ─── 名字库 ───────────────────────────────────────────────
const FIRST_NAMES_MALE = [
  'James', 'Robert', 'John', 'Michael', 'David', 'William', 'Richard', 'Joseph',
  'Thomas', 'Christopher', 'Charles', 'Daniel', 'Matthew', 'Anthony', 'Mark',
  'Donald', 'Steven', 'Andrew', 'Paul', 'Joshua', 'Kenneth', 'Kevin', 'Brian',
  'George', 'Timothy', 'Ronald', 'Edward', 'Jason', 'Jeffrey', 'Ryan',
  'Jacob', 'Gary', 'Nicholas', 'Eric', 'Jonathan', 'Stephen', 'Larry', 'Justin',
  'Scott', 'Brandon', 'Benjamin', 'Samuel', 'Raymond', 'Gregory', 'Frank',
  'Alexander', 'Patrick', 'Jack', 'Dennis', 'Henry',
];

const LAST_NAMES = [
  'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis',
  'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Gonzalez', 'Wilson', 'Anderson',
  'Thomas', 'Taylor', 'Moore', 'Jackson', 'Martin', 'Lee', 'Perez', 'Thompson',
  'White', 'Harris', 'Sanchez', 'Clark', 'Ramirez', 'Lewis', 'Robinson',
  'Walker', 'Young', 'Allen', 'King', 'Wright', 'Scott', 'Torres', 'Nguyen',
  'Hill', 'Flores', 'Green', 'Adams', 'Nelson', 'Baker', 'Hall', 'Rivera',
  'Campbell', 'Mitchell', 'Carter', 'Roberts',
];

const CITIES = [
  'New York', 'Los Angeles', 'Chicago', 'Houston', 'Phoenix',
  'Philadelphia', 'San Antonio', 'San Diego', 'Dallas', 'San Jose',
  'Austin', 'Jacksonville', 'Fort Worth', 'Columbus', 'Charlotte',
  'San Francisco', 'Indianapolis', 'Seattle', 'Denver', 'Washington',
  'Boston', 'El Paso', 'Nashville', 'Detroit', 'Portland',
  'Las Vegas', 'Memphis', 'Louisville', 'Baltimore', 'Milwaukee',
  'Albuquerque', 'Tucson', 'Fresno', 'Sacramento', 'Mesa',
  'Atlanta', 'Kansas City', 'Colorado Springs', 'Raleigh', 'Omaha',
  'Miami', 'Long Beach', 'Virginia Beach', 'Oakland', 'Minneapolis',
  'Tampa', 'Arlington', 'New Orleans', 'Cleveland', 'Bakersfield',
];

const BIOS = [
  'Love hiking and outdoor adventures. Looking for someone who enjoys exploring new trails and cozy nights in.',
  'Software engineer by day, amateur chef by night. Seeking a partner to share recipes and life with.',
  'Passionate about music and travel. Been to 15 countries and counting. Want a travel buddy for life.',
  'Fitness enthusiast and yoga practitioner. Looking for someone who values health and mindfulness.',
  'Book lover and coffee addict. Can often be found in cozy cafes with a good novel.',
  'Photographer and nature lover. Let me capture your best moments together.',
  'Dog dad and weekend warrior. Looking for someone who loves animals as much as I do.',
  'History buff and museum enthusiast. Seeking intellectual conversations and deep connections.',
  'Startup founder working on something exciting. Need a partner who understands the hustle.',
  'Jazz musician and wine connoisseur. Looking for someone to share sunset concerts with.',
  'Marathon runner and motivational speaker. Seeking someone who pushes boundaries.',
  'Artist and creative soul. Let\'s paint the town red and create beautiful memories.',
  'Tech investor and mentor. Looking for genuine connection beyond the screen.',
  'Surfing and beach life. Ready to ride the waves of a new relationship.',
  'Volunteer and community organizer. Seeking someone with a heart for giving back.',
  'Architect with an eye for design. Looking for someone to build something beautiful together.',
  'Math teacher who loves puzzles. Seeking a partner for life\'s greatest equation.',
  'Craft beer brewer and foodie. Looking for someone to taste test new recipes.',
  'Med school graduate, new doctor in town. Seeking someone patient and understanding.',
  'Writer and storyteller. Looking for my co-author in the story of life.',
  'Electric guitar player in a local band. Seeking a muse and a partner.',
  'Financial analyst who loves numbers and weekend getaways. Let\'s calculate our future.',
  'Environmental scientist and nature conservationist. Looking for an eco-conscious partner.',
  'Basketball coach and sports fan. Seeking a teammate for the game of life.',
  'Real estate agent who knows the best spots in town. Looking for a home in someone\'s heart.',
];

const RELATIONSHIP_GOALS = ['LONG_TERM', 'DATING', 'FRIENDSHIP', 'NOT_SURE'] as const;
const ATTACHMENT_STYLES = ['Secure', 'Anxious', 'Avoidant', 'Fearful-Avoidant'] as const;
const COMMUNICATION_STYLES = ['Direct', 'Diplomatic', 'Expressive', 'Analytical'] as const;
const CONFLICT_RESOLUTIONS = ['Collaborative', 'Compromising', 'Accommodating', 'Problem-Solving'] as const;
const LOVE_LANGUAGES = ['Quality Time', 'Words of Affirmation', 'Physical Touch', 'Acts of Service', 'Receiving Gifts'] as const;
const EMOTIONAL_AVAILABILITIES = ['Fully Available', 'Mostly Available', 'Opening Up'] as const;

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// 生成Stripe模拟ID
function mockStripeId(prefix: string, index: number): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const random = Array.from({ length: 14 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  return `${prefix}_${random}`;
}

async function main() {
  console.log('🧪 E2E Payment Test: Creating 50 Paid Test Users');
  console.log('=================================================\n');

  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const results = {
    created: 0,
    skipped: 0,
    errors: 0,
    premiumMonthly: 0,
    premiumYearly: 0,
    totalRevenue: 0,
  };

  for (let i = 0; i < TEST_USER_COUNT; i++) {
    const index = i + 1;
    const email = `test.paid.${String(index).padStart(3, '0')}@lokfeel.com`;
    const firstName = FIRST_NAMES_MALE[i % FIRST_NAMES_MALE.length];
    const lastName = LAST_NAMES[(i * 7 + 3) % LAST_NAMES.length]; // 分散选取
    const name = `${firstName} ${lastName}`;
    const age = randomInt(25, 45);
    const city = CITIES[i % CITIES.length];
    const bio = BIOS[i % BIOS.length];
    const avatarSeed = `${firstName}-${lastName}-paid`;
    const avatarUrl = `https://randomuser.me/api/portraits/men/${(i % 99) + 1}.jpg`;

    // 70% 月付，30% 年付
    const plan = Math.random() < 0.7 ? 'PREMIUM_MONTHLY' as const : 'PREMIUM_YEARLY' as const;
    const amount = plan === 'PREMIUM_MONTHLY' ? 19.99 : 149.99;

    // 模拟Stripe IDs
    const stripeCustomerId = mockStripeId('cus', i);
    const stripeSubscriptionId = mockStripeId('sub', i);
    const stripePaymentIntentId = mockStripeId('pi', i);
    const stripePriceId = plan === 'PREMIUM_MONTHLY' 
      ? 'price_premium_monthly_test' 
      : 'price_premium_yearly_test';

    try {
      // ─── Check if exists ────────────────────────────
      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing) {
        console.log(`  ⏭️  [${index}/50] ${email} already exists, skipping`);
        results.skipped++;
        continue;
      }

      // ─── Create User + Profile + Subscription + Payment + Notification ───
      const periodEnd = new Date();
      periodEnd.setDate(periodEnd.getDate() + (plan === 'PREMIUM_MONTHLY' ? 30 : 365));

      const user = await prisma.user.create({
        data: {
          email,
          name,
          password: passwordHash,
          role: 'USER',
          emailVerified: new Date(),
          isBot: false,

          // Profile
          profile: {
            create: {
              displayName: name,
              age,
              gender: 'MALE',
              sexuality: 'Straight',
              bio,
              avatar: avatarUrl,
              avatarType: 'photo',
              city,
              country: 'US',
              relationshipGoal: pick(RELATIONSHIP_GOALS),
              attachmentStyle: pick(ATTACHMENT_STYLES),
              communicationStyle: pick(COMMUNICATION_STYLES),
              conflictResolution: pick(CONFLICT_RESOLUTIONS),
              loveLanguage: pick(LOVE_LANGUAGES),
              boundaries: JSON.stringify(['Respect personal space', 'Honest communication']),
              dealbreakers: JSON.stringify(['Dishonesty', 'Lack of ambition']),
              lifePriorities: JSON.stringify(['Career', 'Family', 'Health']),
              emotionalAvailability: pick(EMOTIONAL_AVAILABILITIES),
              preferredAgeMin: 23,
              preferredAgeMax: 40,
              preferredGender: 'female',
              preferredDistance: 50,
              preferredLocation: city,
              profileStatus: 'APPROVED',
              onboardingStep: 8,
              isApproved: true,
              isVerified: true,
            },
          },

          // Subscription (模拟Webhook写入)
          subscriptions: {
            create: {
              plan: plan as any,
              status: 'ACTIVE',
              stripeCustomerId,
              stripeSubscriptionId,
              stripePriceId,
              stripeCurrentPeriodEnd: periodEnd,
              weeklyMatchLimit: 5,
              canInitiateChat: true,
              canViewFullProfile: true,
              startsAt: new Date(),
            },
          },

          // Payment (模拟Stripe checkout.session.completed)
          payments: {
            create: {
              stripePaymentIntentId,
              amount,
              currency: 'usd',
              status: 'SUCCEEDED',
              description: `LokFeel ${plan === 'PREMIUM_YEARLY' ? 'Yearly' : 'Monthly'} Premium`,
              metadata: JSON.stringify({
                plan,
                testUser: true,
                e2eTest: true,
                createdAt: new Date().toISOString(),
              }),
            },
          },

          // Notification (支付成功通知)
          notifications: {
            create: {
              type: 'SYSTEM_ANNOUNCEMENT',
              title: 'Premium Activated! 🎉',
              body: `Your LokFeel ${plan === 'PREMIUM_YEARLY' ? 'Yearly' : 'Monthly'} Premium is now active. Enjoy unlimited matching!`,
              data: JSON.stringify({ plan }),
            },
          },
        },
      });

      results.created++;
      if (plan === 'PREMIUM_MONTHLY') results.premiumMonthly++;
      else results.premiumYearly++;
      results.totalRevenue += amount;

      const planLabel = plan === 'PREMIUM_MONTHLY' ? 'Monthly' : 'Yearly';
      console.log(`  ✅ [${index}/50] ${name} → Premium ${planLabel} ($${amount})`);

    } catch (error: any) {
      results.errors++;
      console.error(`  ❌ [${index}/50] ${email}: ${error.message}`);
    }
  }

  // ─── Summary ──────────────────────────────────────────
  console.log('\n\n📊 E2E Payment Test: User Creation Summary');
  console.log('==========================================');
  console.log(`  Created:        ${results.created}/50`);
  console.log(`  Skipped:        ${results.skipped}`);
  console.log(`  Errors:         ${results.errors}`);
  console.log(`  Premium Monthly: ${results.premiumMonthly} × $19.99 = $${(results.premiumMonthly * 19.99).toFixed(2)}`);
  console.log(`  Premium Yearly:  ${results.premiumYearly} × $149.99 = $${(results.premiumYearly * 149.99).toFixed(2)}`);
  console.log(`  Total Revenue:   $${results.totalRevenue.toFixed(2)}`);
  console.log(`\n🔐 Login: test.paid.001@lokfeel.com / ${PASSWORD}`);

  // ─── Verify Data Integrity ──────────────────────────
  console.log('\n🔍 Verifying data integrity...');

  const [userCount, subCount, paymentCount, notifCount] = await Promise.all([
    prisma.user.count({ where: { email: { startsWith: 'test.paid.' } } }),
    prisma.subscription.count({
      where: {
        user: { email: { startsWith: 'test.paid.' } },
        status: 'ACTIVE',
        plan: { in: ['PREMIUM_MONTHLY', 'PREMIUM_YEARLY'] },
      },
    }),
    prisma.payment.count({
      where: {
        user: { email: { startsWith: 'test.paid.' } },
        status: 'SUCCEEDED',
      },
    }),
    prisma.notification.count({
      where: {
        user: { email: { startsWith: 'test.paid.' } },
        type: 'SYSTEM_ANNOUNCEMENT',
      },
    }),
  ]);

  console.log(`  Users with test.paid.*:   ${userCount}`);
  console.log(`  Active Premium subs:      ${subCount}`);
  console.log(`  Succeeded payments:       ${paymentCount}`);
  console.log(`  Payment notifications:    ${notifCount}`);

  const integrityOk = userCount === subCount && subCount === paymentCount && paymentCount === notifCount;
  console.log(`\n  Data Integrity: ${integrityOk ? '✅ PASS (1:1:1:1 ratio)' : '❌ FAIL (mismatch)'}`);

  await prisma.$disconnect();
}

main();
