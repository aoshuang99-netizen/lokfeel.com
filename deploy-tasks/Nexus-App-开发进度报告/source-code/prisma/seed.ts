import { hash } from 'bcryptjs'
import 'dotenv/config'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PrismaClient } = require('../src/generated/index.js')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PrismaPg } = require('@prisma/adapter-pg')

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const db = new PrismaClient({ adapter })

/**
 * Nexus Database Seed
 * 
 * Creates demo users with complete relationship blueprints
 * for testing the matching engine and UI.
 */

async function main() {
  console.log('🌱 Seeding Nexus database...')

  // Clean up existing data (in order due to foreign keys)
  console.log('🧹 Cleaning existing data...')
  const tablenames = [
    'AnalyticsEvent', 'AdminLog', 'Payment', 'Message', 'ChatRoomMember',
    'ChatRoom', 'MatchReaction', 'Match', 'Notification', 'Subscription',
    'Profile', 'Session', 'Account', 'VerificationToken', 'SystemConfig', 'User',
  ]

  for (const tablename of tablenames) {
    try {
      // @ts-ignore
      await db[tablename.toLowerCase()].deleteMany()
    } catch {
      console.log(`  ⚠️  Could not clean ${tablename} (table may not exist yet)`)
    }
  }

  // ─── Create Users ────────────────────────────────────────────────

  const password = await hash('demo123456', 12)

  const users = [
    {
      id: 'user_admin',
      email: 'admin@nexus.app',
      name: 'Nexus Admin',
      password,
      role: 'SUPER_ADMIN' as const,
      emailVerified: new Date(),
    },
    {
      id: 'user_sarah',
      email: 'sarah@example.com',
      name: 'Sarah Mitchell',
      password,
      role: 'USER' as const,
      emailVerified: new Date(),
      image: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=200&h=200&fit=crop',
    },
    {
      id: 'user_michael',
      email: 'michael@example.com',
      name: 'Michael Chen',
      password,
      role: 'USER' as const,
      emailVerified: new Date(),
      image: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&h=200&fit=crop',
    },
    {
      id: 'user_emma',
      email: 'emma@example.com',
      name: 'Emma Rodriguez',
      password,
      role: 'USER' as const,
      emailVerified: new Date(),
      image: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=200&h=200&fit=crop',
    },
    {
      id: 'user_james',
      email: 'james@example.com',
      name: 'James Park',
      password,
      role: 'USER' as const,
      emailVerified: new Date(),
      image: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=200&h=200&fit=crop',
    },
    {
      id: 'user_maya',
      email: 'maya@example.com',
      name: 'Maya Patel',
      password,
      role: 'USER' as const,
      emailVerified: new Date(),
      image: 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=200&h=200&fit=crop',
    },
    {
      id: 'user_alex',
      email: 'alex@example.com',
      name: 'Alex Thompson',
      password,
      role: 'USER' as const,
      emailVerified: new Date(),
      image: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200&h=200&fit=crop',
    },
  ]

  console.log('👥 Creating users...')
  for (const userData of users) {
    // @ts-ignore
    await db.user.create({ data: userData })
  }

  // ─── Create Profiles with Relationship Blueprints ────────────────

  const profiles = [
    {
      userId: 'user_sarah',
      displayName: 'Sarah',
      age: 28,
      gender: 'FEMALE' as const,
      sexuality: 'Straight',
      bio: 'Introverted bookworm who finds peace in nature. Looking for someone who values deep conversation over small talk.',
      avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=200&h=200&fit=crop',
      city: 'New York',
      country: 'US',
      relationshipGoal: 'LONG_TERM',
      attachmentStyle: 'Secure',
      communicationStyle: 'Reflective',
      conflictResolution: 'Collaborative',
      loveLanguage: 'Quality Time',
      boundaries: JSON.stringify(['Need alone time to recharge', 'No contact with exes', 'Honest communication always']),
      dealbreakers: JSON.stringify(['Not emotionally available', 'Doesnt want children', 'Heavy drinker']),
      lifePriorities: JSON.stringify(['Family', 'Career', 'Stability', 'Adventure']),
      emotionalAvailability: 'Fully Available',
      preferredAgeMin: 26,
      preferredAgeMax: 38,
      preferredDistance: 50,
      profileStatus: 'APPROVED' as const,
      onboardingStep: 5,
      isApproved: true,
    },
    {
      userId: 'user_michael',
      displayName: 'Michael',
      age: 31,
      gender: 'MALE' as const,
      sexuality: 'Straight',
      bio: 'Software engineer by day, amateur chef by night. I believe the best relationships are built on mutual respect and good food.',
      avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&h=200&fit=crop',
      city: 'New York',
      country: 'US',
      relationshipGoal: 'LONG_TERM',
      attachmentStyle: 'Secure',
      communicationStyle: 'Direct',
      conflictResolution: 'Collaborative',
      loveLanguage: 'Acts of Service',
      boundaries: JSON.stringify(['Work-life balance matters', 'Open about finances', 'Weekly date nights']),
      dealbreakers: JSON.stringify(['Not ambitious', 'Doesnt like cooking', 'Passive communication']),
      lifePriorities: JSON.stringify(['Career', 'Family', 'Stability']),
      emotionalAvailability: 'Fully Available',
      preferredAgeMin: 25,
      preferredAgeMax: 36,
      preferredDistance: 30,
      profileStatus: 'APPROVED' as const,
      onboardingStep: 5,
      isApproved: true,
    },
    {
      userId: 'user_emma',
      displayName: 'Emma',
      age: 29,
      gender: 'FEMALE' as const,
      sexuality: 'Bisexual',
      bio: 'Yoga instructor and part-time writer. I value emotional intelligence and personal growth above everything else.',
      avatar: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=200&h=200&fit=crop',
      city: 'Los Angeles',
      country: 'US',
      relationshipGoal: 'LONG_TERM',
      attachmentStyle: 'Secure',
      communicationStyle: 'Expressive',
      conflictResolution: 'Collaborative',
      loveLanguage: 'Words of Affirmation',
      boundaries: JSON.stringify(['Need space after arguments', 'Morning routine is sacred', 'No ghosting']),
      dealbreakers: JSON.stringify(['Emotionally unavailable', 'Judgmental', 'Not interested in self-growth']),
      lifePriorities: JSON.stringify(['Adventure', 'Family', 'Personal Growth', 'Health']),
      emotionalAvailability: 'Fully Available',
      preferredAgeMin: 27,
      preferredAgeMax: 40,
      preferredDistance: 100,
      profileStatus: 'APPROVED' as const,
      onboardingStep: 5,
      isApproved: true,
    },
    {
      userId: 'user_james',
      displayName: 'James',
      age: 33,
      gender: 'MALE' as const,
      sexuality: 'Straight',
      bio: 'Architect who loves hiking and photography. Recently moved to NYC from Seattle. Looking for genuine connection.',
      avatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=200&h=200&fit=crop',
      city: 'New York',
      country: 'US',
      relationshipGoal: 'DATING',
      attachmentStyle: 'Secure',
      communicationStyle: 'Reflective',
      conflictResolution: 'Compromising',
      loveLanguage: 'Quality Time',
      boundaries: JSON.stringify(['Need outdoor time regularly', 'Work can be demanding', 'Value honesty over comfort']),
      dealbreakers: JSON.stringify(['Doesnt like outdoors', 'Very clingy']),
      lifePriorities: JSON.stringify(['Adventure', 'Career', 'Stability']),
      emotionalAvailability: 'Fully Available',
      preferredAgeMin: 26,
      preferredAgeMax: 38,
      preferredDistance: 50,
      profileStatus: 'APPROVED' as const,
      onboardingStep: 5,
      isApproved: true,
    },
    {
      userId: 'user_maya',
      displayName: 'Maya',
      age: 27,
      gender: 'FEMALE' as const,
      sexuality: 'Straight',
      bio: 'Doctor in residency. Busy but intentional about making time for the right person. Lets grab coffee.',
      avatar: 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=200&h=200&fit=crop',
      city: 'Boston',
      country: 'US',
      relationshipGoal: 'LONG_TERM',
      attachmentStyle: 'Anxious-Preoccupied',
      communicationStyle: 'Expressive',
      conflictResolution: 'Accommodating',
      loveLanguage: 'Physical Touch',
      boundaries: JSON.stringify(['Need validation and reassurance', 'Texting back promptly matters', 'No games']),
      dealbreakers: JSON.stringify(['Emotionally distant', 'Doesnt communicate', 'Not looking for something serious']),
      lifePriorities: JSON.stringify(['Career', 'Family', 'Stability', 'Health']),
      emotionalAvailability: 'Building Trust',
      preferredAgeMin: 28,
      preferredAgeMax: 38,
      preferredDistance: 100,
      profileStatus: 'APPROVED' as const,
      onboardingStep: 5,
      isApproved: true,
    },
    {
      userId: 'user_alex',
      displayName: 'Alex',
      age: 29,
      gender: 'NON_BINARY' as const,
      sexuality: 'Queer',
      bio: 'Graphic designer with a passion for live music and vintage vinyl. Looking for creative minds who think differently.',
      avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200&h=200&fit=crop',
      city: 'New York',
      country: 'US',
      relationshipGoal: 'DATING',
      attachmentStyle: 'Fearful-Avoidant',
      communicationStyle: 'Analytical',
      conflictResolution: 'Avoiding',
      loveLanguage: 'Quality Time',
      boundaries: JSON.stringify(['Need personal space', 'Slow to open up', 'Art comes first sometimes']),
      dealbreakers: JSON.stringify(['Pushy about commitment', 'Doesnt respect boundaries', 'Judgmental']),
      lifePriorities: JSON.stringify(['Career', 'Adventure', 'Creativity']),
      emotionalAvailability: 'Processing Past',
      preferredAgeMin: 25,
      preferredAgeMax: 40,
      preferredDistance: 30,
      profileStatus: 'APPROVED' as const,
      onboardingStep: 5,
      isApproved: true,
    },
  ]

  console.log('📋 Creating profiles with relationship blueprints...')
  for (const profileData of profiles) {
    // @ts-ignore
    await db.profile.create({ data: profileData })
  }

  // ─── Create Demo Matches ──────────────────────────────────────────

  console.log('💕 Creating demo matches...')
  const matches = [
    {
      id: 'match_sarah_michael',
      senderId: 'user_sarah',
      receiverId: 'user_michael',
      matchScore: 87,
      matchReason: 'Your attachment styles align well — both secure. You share a collaborative approach to conflict and complementary communication styles (Reflective + Direct). Both in NYC with similar relationship goals.',
      conflictWarnings: null,
      attachmentCompat: 95,
      communicationCompat: 80,
      conflictCompat: 95,
      valuesCompat: 75,
      lifestyleCompat: 85,
      status: 'PENDING' as const,
      matchType: 'WEEKLY' as const,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
    {
      id: 'match_sarah_james',
      senderId: 'user_sarah',
      receiverId: 'user_james',
      matchScore: 82,
      matchReason: 'Complementary attachment patterns — both secure with a preference for meaningful connection. Shared love language (Quality Time) and both in NYC make this a natural fit.',
      conflictWarnings: null,
      attachmentCompat: 95,
      communicationCompat: 85,
      conflictCompat: 82,
      valuesCompat: 65,
      lifestyleCompat: 75,
      status: 'PENDING' as const,
      matchType: 'WEEKLY' as const,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
    {
      id: 'match_michael_emma',
      senderId: 'user_michael',
      receiverId: 'user_emma',
      matchScore: 74,
      matchReason: 'Different communication styles (Direct + Expressive) can create dynamic conversations. Both are long-term oriented with a collaborative approach to conflict.',
      conflictWarnings: '["Different communication styles may require patience and adaptation"]',
      attachmentCompat: 95,
      communicationCompat: 70,
      conflictCompat: 95,
      valuesCompat: 55,
      lifestyleCompat: 50,
      status: 'ACCEPTED' as const,
      matchType: 'WEEKLY' as const,
    },
    {
      id: 'match_maya_james',
      senderId: 'user_maya',
      receiverId: 'user_james',
      matchScore: 61,
      matchReason: 'Different attachment styles may require awareness. Maya tends toward anxious-preoccupied while James is secure — this can actually be stabilizing for Maya.',
      conflictWarnings: '["Potential attachment dynamic: Anxious-Preoccupied + Secure may require patience from the secure partner"]',
      attachmentCompat: 75,
      communicationCompat: 65,
      conflictCompat: 72,
      valuesCompat: 58,
      lifestyleCompat: 40,
      status: 'PENDING' as const,
      matchType: 'AI_SUGGESTED' as const,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  ]

  for (const matchData of matches) {
    // @ts-ignore
    await db.match.create({ data: matchData })
  }

  // ─── Create Chat Room for Accepted Match ──────────────────────────

  console.log('💬 Creating chat rooms...')
  const chatRoom = await db.chatRoom.create({
    data: {
      matchId: 'match_michael_emma',
      lastMessageAt: new Date(),
      members: {
        create: [
          { userId: 'user_michael' },
          { userId: 'user_emma' },
        ],
      },
    },
  })

  const demoMessages = [
    {
      roomId: chatRoom.id,
      senderId: 'user_michael',
      content: "Hey Emma! Great to match with you. I saw we both enjoy collaborative conversations — looking forward to getting to know you!",
      messageType: 'TEXT' as const,
      isRead: true,
      createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
    },
    {
      roomId: chatRoom.id,
      senderId: 'user_emma',
      content: "Hi Michael! Yes, I noticed that too. I love that Nexus explains the 'why' behind matches. What kind of cooking do you enjoy?",
      messageType: 'TEXT' as const,
      isRead: true,
      createdAt: new Date(Date.now() - 2.5 * 60 * 60 * 1000),
    },
    {
      roomId: chatRoom.id,
      senderId: 'user_michael',
      content: "Mostly Italian and Japanese! I find cooking really therapeutic after a long day of coding. How about you — what does a perfect Sunday look like for you?",
      messageType: 'TEXT' as const,
      isRead: true,
      createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
    },
    {
      roomId: chatRoom.id,
      senderId: 'user_emma',
      content: "Sunday mornings are sacred — yoga, farmer's market, then cooking something new. We'd probably get along great at a farmer's market!",
      messageType: 'TEXT' as const,
      isRead: false,
      createdAt: new Date(Date.now() - 1.5 * 60 * 60 * 1000),
    },
  ]

  for (const msg of demoMessages) {
    // @ts-ignore
    await db.message.create({ data: msg })
  }

  // ─── Create Notifications ─────────────────────────────────────────

  console.log('🔔 Creating notifications...')
  const notifications = [
    {
      userId: 'user_sarah',
      type: 'NEW_MATCH' as const,
      title: 'New Match!',
      body: 'You and Michael have 87% compatibility. Check out why you match!',
      actionUrl: '/dashboard/matches/match_sarah_michael',
    },
    {
      userId: 'user_sarah',
      type: 'NEW_MATCH' as const,
      title: 'New Match!',
      body: 'You and James have 82% compatibility. Both love Quality Time!',
      actionUrl: '/dashboard/matches/match_sarah_james',
    },
    {
      userId: 'user_michael',
      type: 'MATCH_ACCEPTED' as const,
      title: 'Match Accepted!',
      body: 'Emma accepted your match! Start a conversation now.',
      actionUrl: '/dashboard/chat',
    },
    {
      userId: 'user_michael',
      type: 'NEW_MESSAGE' as const,
      title: 'New Message from Emma',
      body: "Farmer's market sounds amazing! We'd probably get along great there.",
      actionUrl: '/dashboard/chat',
    },
    {
      userId: 'user_maya',
      type: 'NEW_MATCH' as const,
      title: 'New Match!',
      body: 'You and James were matched. Your secure/anxious dynamic can be stabilizing.',
      actionUrl: '/dashboard/matches/match_maya_james',
    },
    {
      userId: 'user_sarah',
      type: 'SYSTEM_ANNOUNCEMENT' as const,
      title: 'Welcome to Nexus! 🎉',
      body: 'Complete your relationship blueprint to start receiving matches tailored to your unique relationship patterns.',
      actionUrl: '/dashboard/profile',
    },
  ]

  for (const notif of notifications) {
    // @ts-ignore
    await db.notification.create({ data: notif })
  }

  // ─── Create Subscriptions ─────────────────────────────────────────

  console.log('💳 Creating subscriptions...')
  const subscriptions = [
    {
      userId: 'user_michael',
      plan: 'PREMIUM_MONTHLY' as const,
      status: 'ACTIVE' as const,
      weeklyMatchLimit: 99,
      canInitiateChat: true,
      canViewFullProfile: true,
      startsAt: new Date(),
      endsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
  ]

  for (const sub of subscriptions) {
    // @ts-ignore
    await db.subscription.create({ data: sub })
  }

  console.log('')
  console.log('✅ Seed completed successfully!')
  console.log('')
  console.log('📋 Demo accounts:')
  console.log('  Admin:   admin@nexus.app / demo123456')
  console.log('  Sarah:   sarah@example.com / demo123456')
  console.log('  Michael: michael@example.com / demo123456')
  console.log('  Emma:    emma@example.com / demo123456')
  console.log('  James:   james@example.com / demo123456')
  console.log('  Maya:    maya@example.com / demo123456')
  console.log('  Alex:    alex@example.com / demo123456')
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e)
    process.exit(1)
  })
  .finally(async () => {
    // @ts-ignore
    await db.$disconnect()
  })
