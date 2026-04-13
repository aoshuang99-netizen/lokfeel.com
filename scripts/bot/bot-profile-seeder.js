const { PrismaClient, BotType, BotActivityLevel, Ethnicity, OnlinePattern } = require('../../src/generated');

const prisma = new PrismaClient();

// 多样性配置
const ETHNICITY_DISTRIBUTION = [
  { ethnicity: Ethnicity.CAUCASIAN, weight: 35 },
  { ethnicity: Ethnicity.ASIAN, weight: 25 },
  { ethnicity: Ethnicity.AFRICAN_AMERICAN, weight: 15 },
  { ethnicity: Ethnicity.HISPANIC_LATINO, weight: 12 },
  { ethnicity: Ethnicity.SOUTH_ASIAN, weight: 8 },
  { ethnicity: Ethnicity.MIDDLE_EASTERN, weight: 5 },
];

const OCCUPATIONS = [
  'Software Engineer', 'Product Manager', 'Data Scientist', 'UX Designer', 'Marketing Manager',
  'Teacher', 'Nurse', 'Doctor', 'Lawyer', 'Accountant', 'Financial Analyst', 'Consultant',
  'Writer', 'Journalist', 'Photographer', 'Musician', 'Artist', 'Chef', 'Entrepreneur',
  'Sales Manager', 'HR Manager', 'Operations Manager', 'Researcher', 'Professor',
  'Physical Therapist', 'Psychologist', 'Social Worker', 'Architect', 'Interior Designer',
  'Real Estate Agent', 'Event Planner', 'Personal Trainer', 'Yoga Instructor', 'Barista'
];

const INDUSTRIES = [
  'Technology', 'Healthcare', 'Education', 'Finance', 'Entertainment', 'Media',
  'Retail', 'Hospitality', 'Manufacturing', 'Consulting', 'Government', 'Non-profit',
  'Real Estate', 'Transportation', 'Energy', 'Legal', 'Marketing', 'Sports'
];

const INTERESTS_POOL = [
  'hiking', 'cooking', 'photography', 'traveling', 'reading', 'gaming', 'yoga', 'running',
  'swimming', 'cycling', 'dancing', 'painting', 'writing', 'music', 'movies', 'theater',
  'concerts', 'festivals', 'museums', 'art galleries', 'wine tasting', 'craft beer',
  'coffee', 'tea', 'vegan', 'fitness', 'crossfit', 'pilates', 'meditation', 'mindfulness'
];

const PERSONALITY_TYPES = ['explorer', 'selective', 'social', 'passive', 'enthusiastic', 'cautious'];

function weightedRandom(items) {
  const totalWeight = items.reduce((sum, i) => sum + i.weight, 0);
  let random = Math.random() * totalWeight;
  for (const { item, weight } of items) {
    random -= weight;
    if (random <= 0) return item;
  }
  return items[items.length - 1].item;
}

function randomSample(array, count) {
  const shuffled = [...array].sort(() => 0.5 - Math.random());
  return shuffled.slice(0, Math.min(count, array.length));
}

function generateBehaviorConfig(personality) {
  const configs = {
    explorer: { matchAcceptRate: 0.7, messageResponseRate: 0.8, superLikeRate: 0.15 },
    selective: { matchAcceptRate: 0.3, messageResponseRate: 0.6, superLikeRate: 0.05 },
    social: { matchAcceptRate: 0.6, messageResponseRate: 0.9, superLikeRate: 0.1 },
    passive: { matchAcceptRate: 0.4, messageResponseRate: 0.4, superLikeRate: 0.02 },
    enthusiastic: { matchAcceptRate: 0.8, messageResponseRate: 0.95, superLikeRate: 0.2 },
    cautious: { matchAcceptRate: 0.25, messageResponseRate: 0.5, superLikeRate: 0.03 }
  };
  return configs[personality] || configs.explorer;
}

async function generateBotProfile(profile) {
  const gender = profile.gender;
  const ethnicityWeights = gender === 'FEMALE' 
    ? ETHNICITY_DISTRIBUTION.map(e => ({ ...e, weight: e.weight * (e.ethnicity === Ethnicity.ASIAN ? 1.3 : 1) }))
    : ETHNICITY_DISTRIBUTION;
  
  const ethnicity = weightedRandom(ethnicityWeights.map(e => ({ item: e.ethnicity, weight: e.weight })));
  const occupation = OCCUPATIONS[Math.floor(Math.random() * OCCUPATIONS.length)];
  const industry = INDUSTRIES[Math.floor(Math.random() * INDUSTRIES.length)];
  
  const age = profile.age || 28;
  let educationLevel = "Bachelor's";
  if (age < 23) educationLevel = "High School";
  else if (age > 35 && Math.random() > 0.7) educationLevel = "Master's";
  
  const incomeRanges = ['$30k-50k', '$50k-75k', '$75k-100k', '$100k-150k', '$150k-200k', '$200k+'];
  const incomeRange = incomeRanges[Math.floor(Math.random() * incomeRanges.length)];
  
  const interests = randomSample(INTERESTS_POOL, 3 + Math.floor(Math.random() * 5));
  const onlinePatterns = Object.values(OnlinePattern);
  const onlinePattern = onlinePatterns[Math.floor(Math.random() * onlinePatterns.length)];
  const personality = PERSONALITY_TYPES[Math.floor(Math.random() * PERSONALITY_TYPES.length)];
  const behaviorConfig = generateBehaviorConfig(personality);
  const activityLevels = Object.values(BotActivityLevel);
  const activityLevel = activityLevels[Math.floor(Math.random() * activityLevels.length)];
  
  return {
    profileId: profile.id,
    botType: BotType.ACTIVE,
    activityLevel,
    ethnicity,
    occupation,
    industry,
    educationLevel,
    incomeRange,
    interests,
    onlinePattern,
    avgResponseTime: 10 + Math.floor(Math.random() * 120),
    maxDailyMatches: 1 + Math.floor(Math.random() * 10),
    behaviorConfig: JSON.stringify(behaviorConfig),
    preferredEthnicities: randomSample(Object.values(Ethnicity), 2),
    preferredOccupations: randomSample(OCCUPATIONS, 3),
    preferredEducation: randomSample(["High School", "Bachelor's", "Master's", "PhD"], 2),
    avatarStyle: ['professional', 'casual', 'artistic'][Math.floor(Math.random() * 3)],
    avatarSource: 'generated',
    isActive: true,
  };
}

async function main() {
  console.log('🤖 开始为数字用户生成BotProfile...');
  
  const botUsers = await prisma.profile.findMany({
    where: {
      user: {
        email: { endsWith: '@lokfeel.bot' }
      }
    },
    include: { user: true }
  });
  
  console.log(`找到 ${botUsers.length} 名数字用户`);
  
  let created = 0, skipped = 0, errors = 0;
  
  for (let i = 0; i < botUsers.length; i++) {
    const profile = botUsers[i];
    
    try {
      const existing = await prisma.botProfile.findUnique({
        where: { profileId: profile.id }
      });
      
      if (existing) {
        skipped++;
        continue;
      }
      
      const botProfileData = await generateBotProfile(profile);
      await prisma.botProfile.create({ data: botProfileData });
      created++;
      
      if ((i + 1) % 100 === 0) {
        console.log(`进度: ${i + 1}/${botUsers.length} (创建: ${created}, 跳过: ${skipped})`);
      }
    } catch (error) {
      errors++;
      console.error(`错误: ${profile.id}`, error.message);
    }
  }
  
  console.log('\n✅ BotProfile生成完成!');
  console.log(`总计: ${botUsers.length}, 创建: ${created}, 跳过: ${skipped}, 错误: ${errors}`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
