import { PrismaClient, Gender, RelationshipGoal, ProfileStatus, UserRole, SubscriptionPlan, SubscriptionStatus } from '../src/generated/client'

const prisma = new PrismaClient()

async function main() {
  console.log('🌱 Seeding database...')

  // Clean up existing data
  await prisma.analyticsEvent.deleteMany()
  await prisma.adminLog.deleteMany()
  await prisma.notification.deleteMany()
  await prisma.message.deleteMany()
  await prisma.chatRoomMember.deleteMany()
  await prisma.chatRoom.deleteMany()
  await prisma.matchReaction.deleteMany()
  await prisma.match.deleteMany()
  await prisma.payment.deleteMany()
  await prisma.subscription.deleteMany()
  await prisma.profile.deleteMany()
  await prisma.session.deleteMany()
  await prisma.account.deleteMany()
  await prisma.verificationToken.deleteMany()
  await prisma.systemConfig.deleteMany()
  await prisma.user.deleteMany()

  // ═══════ System Config ═══════
  console.log('  → System config')
  const configs = [
    { key: 'matching.min_score', value: '40', description: 'Minimum compatibility score to create a match' },
    { key: 'matching.weekly_limit', value: '5', description: 'Weekly match limit per user' },
    { key: 'matching.match_expiry_days', value: '7', description: 'Days before a pending match expires' },
    { key: 'pricing.premium_monthly', value: '9.99', description: 'Premium monthly price in USD' },
    { key: 'pricing.premium_yearly', value: '79.99', description: 'Premium yearly price in USD' },
    { key: 'app.maintenance_mode', value: 'false', description: 'Enable maintenance mode' },
    { key: 'app.allow_registration', value: 'true', description: 'Allow new user registration' },
    { key: 'app.auto_approve_profiles', value: 'false', description: 'Auto-approve user profiles' },
    { key: 'email.welcome_template', value: 'welcome', description: 'Welcome email template name' },
    { key: 'email.match_notification_template', value: 'new_match', description: 'Match notification template' },
  ]
  for (const c of configs) {
    await prisma.systemConfig.create({ data: c })
  }

  // ═══════ Demo Users ═══════
  console.log('  → Creating demo users')

  const adminUser = await prisma.user.create({
    data: {
      name: 'Nexus Admin',
      email: 'admin@nexus.app',
      emailVerified: new Date(),
      role: UserRole.SUPER_ADMIN,
    },
  })

  const users = [
    // Women
    { name: 'Sarah Mitchell', email: 'sarah@example.com', gender: Gender.FEMALE },
    { name: 'Elena Rodriguez', email: 'elena@example.com', gender: Gender.FEMALE },
    { name: 'Aisha Patel', email: 'aisha@example.com', gender: Gender.FEMALE },
    { name: 'Priya Sharma', email: 'priya@example.com', gender: Gender.FEMALE },
    { name: 'Jessica Chen', email: 'jessica@example.com', gender: Gender.FEMALE },
    // Men
    { name: 'James Thompson', email: 'james@example.com', gender: Gender.MALE },
    { name: 'Marcus Davis', email: 'marcus@example.com', gender: Gender.MALE },
    { name: 'David Kim', email: 'david@example.com', gender: Gender.MALE },
    { name: 'Chris Anderson', email: 'chris@example.com', gender: Gender.MALE },
    { name: 'Alex Rivera', email: 'alex@example.com', gender: Gender.MALE },
  ]

  const createdUsers = [adminUser]
  for (const u of users) {
    const user = await prisma.user.create({
      data: {
        name: u.name,
        email: u.email,
        emailVerified: new Date(),
        role: UserRole.USER,
      },
    })
    createdUsers.push(user)
  }

  // ═══════ Profiles ═══════
  console.log('  → Creating profiles')

  const profileData = [
    {
      userId: createdUsers[1].id, displayName: 'Sarah', age: 32, gender: Gender.FEMALE,
      sexuality: 'Bisexual', city: 'New York', country: 'US',
      bio: 'Seeks depth over surface. Communication is my love language.',
      relationshipGoal: RelationshipGoal.LONG_TERM, attachmentStyle: 'Secure',
      communicationStyle: 'Direct', conflictResolution: 'Collaborative',
      loveLanguage: 'Quality Time',
      boundaries: JSON.stringify(['No ghosting', 'Must meet within 2 weeks']),
      dealbreakers: JSON.stringify(['Smoking', 'Not interested in commitment']),
      lifePriorities: JSON.stringify(['Family', 'Career', 'Growth']),
      emotionalAvailability: 'Fully Available',
      profileStatus: ProfileStatus.APPROVED, isApproved: true,
    },
    {
      userId: createdUsers[2].id, displayName: 'Elena', age: 28, gender: Gender.FEMALE,
      sexuality: 'Pansexual', city: 'Los Angeles', country: 'US',
      bio: 'Ready for genuine partnership. Growth mindset, always.',
      relationshipGoal: RelationshipGoal.LONG_TERM, attachmentStyle: 'Secure',
      communicationStyle: 'Expressive', conflictResolution: 'Collaborative',
      loveLanguage: 'Words of Affirmation',
      boundaries: JSON.stringify(['Respect my time', 'Open communication required']),
      dealbreakers: JSON.stringify(['Controlling behavior', 'Lack of ambition']),
      lifePriorities: JSON.stringify(['Adventure', 'Career', 'Family']),
      emotionalAvailability: 'Fully Available',
      profileStatus: ProfileStatus.APPROVED, isApproved: true,
    },
    {
      userId: createdUsers[3].id, displayName: 'Aisha', age: 29, gender: Gender.FEMALE,
      sexuality: 'Queer', city: 'London', country: 'GB',
      bio: 'Wants intentional connection. Not here for games.',
      relationshipGoal: RelationshipGoal.DATING, attachmentStyle: 'Secure',
      communicationStyle: 'Reflective', conflictResolution: 'Compromising',
      loveLanguage: 'Acts of Service',
      boundaries: JSON.stringify(['Consent-first', 'Honesty required']),
      dealbreakers: JSON.stringify(['Jealousy', 'Poor listening']),
      lifePriorities: JSON.stringify(['Growth', 'Family', 'Stability']),
      emotionalAvailability: 'Building Trust',
      profileStatus: ProfileStatus.APPROVED, isApproved: true,
    },
    {
      userId: createdUsers[4].id, displayName: 'Priya', age: 27, gender: Gender.FEMALE,
      sexuality: 'Bisexual', city: 'San Francisco', country: 'US',
      bio: 'Loves growth & exploration. Looking for a thinking partner.',
      relationshipGoal: RelationshipGoal.LONG_TERM, attachmentStyle: 'Anxious-Preoccupied',
      communicationStyle: 'Analytical', conflictResolution: 'Collaborative',
      loveLanguage: 'Physical Touch',
      boundaries: JSON.stringify(['Need alone time', 'No rushing']),
      dealbreakers: JSON.stringify(['Emotional unavailability', 'Disrespect']),
      lifePriorities: JSON.stringify(['Career', 'Adventure', 'Growth']),
      emotionalAvailability: 'Processing Past',
      profileStatus: ProfileStatus.APPROVED, isApproved: true,
    },
    {
      userId: createdUsers[5].id, displayName: 'Jessica', age: 30, gender: Gender.FEMALE,
      sexuality: 'Straight', city: 'Toronto', country: 'CA',
      bio: 'Building a life I love, looking for someone to share it with.',
      relationshipGoal: RelationshipGoal.LONG_TERM, attachmentStyle: 'Secure',
      communicationStyle: 'Direct', conflictResolution: 'Collaborative',
      loveLanguage: 'Quality Time',
      boundaries: JSON.stringify(['No drama', 'Must love dogs']),
      dealbreakers: JSON.stringify(['Non-committal', 'Poor hygiene']),
      lifePriorities: JSON.stringify(['Family', 'Stability', 'Growth']),
      emotionalAvailability: 'Fully Available',
      profileStatus: ProfileStatus.PENDING_REVIEW,
    },
    // Men
    {
      userId: createdUsers[6].id, displayName: 'James', age: 35, gender: Gender.MALE,
      sexuality: 'Straight', city: 'New York', country: 'US',
      bio: 'Communication-first mindset. Seeking real partnership.',
      relationshipGoal: RelationshipGoal.LONG_TERM, attachmentStyle: 'Secure',
      communicationStyle: 'Direct', conflictResolution: 'Collaborative',
      loveLanguage: 'Words of Affirmation',
      boundaries: JSON.stringify(['Respect boundaries', 'No manipulation']),
      dealbreakers: JSON.stringify(['Dishonesty', 'Lack of empathy']),
      lifePriorities: JSON.stringify(['Family', 'Career', 'Growth']),
      emotionalAvailability: 'Fully Available',
      profileStatus: ProfileStatus.APPROVED, isApproved: true,
    },
    {
      userId: createdUsers[7].id, displayName: 'Marcus', age: 34, gender: Gender.MALE,
      sexuality: 'Straight', city: 'Los Angeles', country: 'US',
      bio: 'Values emotional intelligence. Relationships require work and I am here for it.',
      relationshipGoal: RelationshipGoal.LONG_TERM, attachmentStyle: 'Secure',
      communicationStyle: 'Reflective', conflictResolution: 'Compromising',
      loveLanguage: 'Quality Time',
      boundaries: JSON.stringify(['Need personal space', 'Growth required']),
      dealbreakers: JSON.stringify(['Controlling', 'Avoidant']),
      lifePriorities: JSON.stringify(['Family', 'Adventure', 'Stability']),
      emotionalAvailability: 'Fully Available',
      profileStatus: ProfileStatus.APPROVED, isApproved: true,
    },
    {
      userId: createdUsers[8].id, displayName: 'David', age: 31, gender: Gender.MALE,
      sexuality: 'Straight', city: 'London', country: 'GB',
      bio: 'Relationship-minded. Looking for my person.',
      relationshipGoal: RelationshipGoal.LONG_TERM, attachmentStyle: 'Secure',
      communicationStyle: 'Expressive', conflictResolution: 'Collaborative',
      loveLanguage: 'Acts of Service',
      boundaries: JSON.stringify(['Honest communication', 'Mutual respect']),
      dealbreakers: JSON.stringify(['Ghosting', 'Emotional unavailability']),
      lifePriorities: JSON.stringify(['Stability', 'Family', 'Career']),
      emotionalAvailability: 'Fully Available',
      profileStatus: ProfileStatus.APPROVED, isApproved: true,
    },
    {
      userId: createdUsers[9].id, displayName: 'Chris', age: 36, gender: Gender.MALE,
      sexuality: 'Straight', city: 'San Francisco', country: 'US',
      bio: 'Empathy-driven. Emotional intelligence is not optional.',
      relationshipGoal: RelationshipGoal.LONG_TERM, attachmentStyle: 'Secure',
      communicationStyle: 'Direct', conflictResolution: 'Collaborative',
      loveLanguage: 'Quality Time',
      boundaries: JSON.stringify(['Open dialogue', 'No passive aggression']),
      dealbreakers: JSON.stringify(['Lack of self-awareness', 'Controlling']),
      lifePriorities: JSON.stringify(['Growth', 'Family', 'Career']),
      emotionalAvailability: 'Fully Available',
      profileStatus: ProfileStatus.APPROVED, isApproved: true,
    },
    {
      userId: createdUsers[10].id, displayName: 'Alex', age: 33, gender: Gender.MALE,
      sexuality: 'Bisexual', city: 'Toronto', country: 'CA',
      bio: 'Exploring intentional connections. Let us see what unfolds.',
      relationshipGoal: RelationshipGoal.DATING, attachmentStyle: 'Dismissive-Avoidant',
      communicationStyle: 'Reflective', conflictResolution: 'Avoiding',
      loveLanguage: 'Physical Touch',
      boundaries: JSON.stringify(['Take it slow', 'Space is important']),
      dealbreakers: JSON.stringify(['Rushing', 'Neediness']),
      lifePriorities: JSON.stringify(['Career', 'Adventure', 'Growth']),
      emotionalAvailability: 'Needs Space',
      profileStatus: ProfileStatus.APPROVED, isApproved: true,
    },
  ]

  const createdProfiles: any[] = []
  for (const p of profileData) {
    const profile = await prisma.profile.create({
      data: {
        ...p,
        compatibilityScore: Math.floor(Math.random() * 30) + 60, // 60-89
      },
    })
    createdProfiles.push(profile)
  }

  // ═══════ Matches ═══════
  console.log('  → Creating demo matches')

  const matchPairs = [
    { senderIdx: 0, receiverIdx: 5, score: 87, type: 'WEEKLY' as const }, // Sarah ↔ James
    { senderIdx: 1, receiverIdx: 6, score: 82, type: 'WEEKLY' as const }, // Elena ↔ Marcus
    { senderIdx: 2, receiverIdx: 7, score: 79, type: 'WEEKLY' as const }, // Aisha ↔ David
    { senderIdx: 3, receiverIdx: 8, score: 74, type: 'WEEKLY' as const }, // Priya ↔ Chris
    { senderIdx: 0, receiverIdx: 7, score: 91, type: 'MANUAL' as const }, // Sarah ↔ David (high compat)
  ]

  for (const mp of matchPairs) {
    const senderProfile = createdProfiles[mp.senderIdx]
    const receiverProfile = createdProfiles[mp.receiverIdx]
    await prisma.match.create({
      data: {
        senderId: senderProfile.userId,
        receiverId: receiverProfile.userId,
        matchScore: mp.score,
        matchReason: `Both of you value ${senderProfile.communicationStyle?.toLowerCase()} communication and share a ${senderProfile.loveLanguage?.toLowerCase()} love language approach. Your relationship goals align around ${senderProfile.relationshipGoal === 'LONG_TERM' ? 'building a lasting partnership' : 'meaningful exploration'}.`,
        conflictWarnings: JSON.stringify([
          'You may have different conflict resolution styles — consider discussing this early.',
          'One partner may need more emotional processing time.',
        ]),
        attachmentCompat: 70 + Math.floor(Math.random() * 25),
        communicationCompat: 75 + Math.floor(Math.random() * 20),
        conflictCompat: 65 + Math.floor(Math.random() * 30),
        valuesCompat: 70 + Math.floor(Math.random() * 25),
        lifestyleCompat: 75 + Math.floor(Math.random() * 20),
        status: mp.score >= 85 ? 'ACCEPTED' : 'PENDING',
        matchType: mp.type,
      },
    })
  }

  // ═══════ Subscriptions ═══════
  console.log('  → Creating subscriptions')
  for (let i = 1; i <= 5; i++) {
    const plan = i <= 2 ? SubscriptionPlan.PREMIUM_YEARLY : SubscriptionPlan.FREE
    await prisma.subscription.create({
      data: {
        userId: createdUsers[i].id,
        plan,
        status: SubscriptionStatus.ACTIVE,
        weeklyMatchLimit: plan === SubscriptionPlan.FREE ? 5 : 999,
        endsAt: plan !== SubscriptionPlan.FREE ? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000) : null,
      },
    })
  }

  // ═══════ Sample Notifications ═══════
  console.log('  → Creating notifications')
  const notifTypes = ['NEW_MATCH', 'NEW_MESSAGE', 'WEEKLY_DIGEST', 'PROFILE_APPROVED']
  for (let i = 1; i <= 8; i++) {
    const type = notifTypes[Math.floor(Math.random() * notifTypes.length)]
    await prisma.notification.create({
      data: {
        userId: createdUsers[i].id,
        type: type as any,
        title: type === 'NEW_MATCH' ? 'New Match Found!' : type === 'NEW_MESSAGE' ? 'New Message' : type === 'WEEKLY_DIGEST' ? 'Your Weekly Matches' : 'Profile Approved',
        body: type === 'NEW_MATCH'
          ? 'You have a new high-compatibility match. Check your matches to see who it is!'
          : type === 'NEW_MESSAGE'
          ? 'Someone sent you a message.'
          : type === 'WEEKLY_DIGEST'
          ? 'Your 5 weekly matches are ready. Take a look!'
          : 'Great news! Your profile has been approved. You are now visible in matching.',
        isRead: Math.random() > 0.5,
        createdAt: new Date(Date.now() - Math.floor(Math.random() * 7 * 24 * 60 * 60 * 1000)),
      },
    })
  }

  console.log('✅ Seed completed successfully!')
  console.log(`   → ${createdUsers.length} users created`)
  console.log(`   → ${createdProfiles.length} profiles created`)
  console.log(`   → ${matchPairs.length} matches created`)
  console.log(`   → 5 subscriptions created`)
  console.log(`   → 8 notifications created`)
  console.log(`   → 10 system configs created`)
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => { console.error(e); prisma.$disconnect(); process.exit(1) })
