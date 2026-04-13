import { PrismaClient, BotType, BotActivityLevel, Ethnicity, OnlinePattern } from '../../src/generated';

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
  'coffee', 'tea', 'vegan', 'fitness', 'crossfit', 'pilates', 'meditation', 'mindfulness',
  'volunteering', 'politics', 'environment', 'sustainability', 'technology', 'startups',
  'investing', 'crypto', 'fashion', 'design', 'architecture', 'history', 'science',
  'astronomy', 'psychology', 'philosophy', 'spirituality', 'astrology', 'tarot',
  'board games', 'video games', 'puzzles', 'gardening', 'DIY', 'woodworking',
  'knitting', 'pottery', 'ceramics', 'jewelry making', 'vintage', 'thrifting',
  'minimalism', 'vanlife', 'digital nomad', 'languages', 'culture', 'foodie'
];

const HOBBIES_POOL = [
  'baking', 'grilling', 'mixology', 'gardening', 'home brewing', 'chess', 'go',
  'poker', 'billiards', 'bowling', 'golf', 'tennis', 'badminton', 'rock climbing',
  'bouldering', 'skateboarding', 'surfing', 'skiing', 'snowboarding', 'kayaking',
  'paddleboarding', 'scuba diving', 'snorkeling', 'fishing', 'camping', 'backpacking',
  'road trips', 'train travel', 'cruises', 'luxury travel', 'budget travel',
  'solo travel', 'group travel', 'pet ownership', 'dog training', 'cat care',
  'bird watching', 'stargazing', 'foraging', 'mushroom hunting', 'composting'
];

const MUSIC_GENRES = [
  'pop', 'rock', 'hip hop', 'rap', 'r&b', 'soul', 'funk', 'jazz', 'blues',
  'classical', 'opera', 'electronic', 'edm', 'house', 'techno', 'trance',
  'ambient', 'lo-fi', 'indie', 'alternative', 'punk', 'metal', 'hardcore',
  'country', 'folk', 'bluegrass', 'reggae', 'ska', 'latin', 'salsa', 'bachata',
  'k-pop', 'j-pop', 'c-pop', 'afrobeat', 'world music', 'soundtracks', 'musicals'
];

const MOVIE_GENRES = [
  'action', 'adventure', 'animation', 'comedy', 'crime', 'documentary', 'drama',
  'fantasy', 'horror', 'mystery', 'romance', 'sci-fi', 'thriller', 'war',
  'western', 'musical', 'noir', 'indie', 'foreign', 'classic', 'cult'
];

const PERSONALITY_TYPES = ['explorer', 'selective', 'social', 'passive', 'enthusiastic', 'cautious'];

// 辅助函数：加权随机选择
function weightedRandom<T>(items: { item: T; weight: number }[]): T {
  const totalWeight = items.reduce((sum, i) => sum + i.weight, 0);
  let random = Math.random() * totalWeight;
  for (const { item, weight } of items) {
    random -= weight;
    if (random <= 0) return item;
  }
  return items[items.length - 1].item;
}

// 辅助函数：随机选择多个不重复项
function randomSample<T>(array: T[], count: number): T[] {
  const shuffled = [...array].sort(() => 0.5 - Math.random());
  return shuffled.slice(0, Math.min(count, array.length));
}

// 生成行为配置
function generateBehaviorConfig(personality: string) {
  const configs: Record<string, any> = {
    explorer: {
      matchAcceptRate: 0.7,
      messageResponseRate: 0.8,
      superLikeRate: 0.15,
      dailySwipeCount: { min: 20, max: 50 },
      conversationDepth: 'high',
      initiativeLevel: 'high'
    },
    selective: {
      matchAcceptRate: 0.3,
      messageResponseRate: 0.6,
      superLikeRate: 0.05,
      dailySwipeCount: { min: 5, max: 15 },
      conversationDepth: 'medium',
      initiativeLevel: 'low'
    },
    social: {
      matchAcceptRate: 0.6,
      messageResponseRate: 0.9,
      superLikeRate: 0.1,
      dailySwipeCount: { min: 30, max: 80 },
      conversationDepth: 'high',
      initiativeLevel: 'high'
    },
    passive: {
      matchAcceptRate: 0.4,
      messageResponseRate: 0.4,
      superLikeRate: 0.02,
      dailySwipeCount: { min: 3, max: 10 },
      conversationDepth: 'low',
      initiativeLevel: 'low'
    },
    enthusiastic: {
      matchAcceptRate: 0.8,
      messageResponseRate: 0.95,
      superLikeRate: 0.2,
      dailySwipeCount: { min: 40, max: 100 },
      conversationDepth: 'very_high',
      initiativeLevel: 'very_high'
    },
    cautious: {
      matchAcceptRate: 0.25,
      messageResponseRate: 0.5,
      superLikeRate: 0.03,
      dailySwipeCount: { min: 5, max: 20 },
      conversationDepth: 'medium',
      initiativeLevel: 'medium'
    }
  };
  return configs[personality] || configs.explorer;
}

// 为单个用户生成BotProfile
async function generateBotProfile(profile: any) {
  const gender = profile.gender;
  
  // 根据性别调整种族分布（女性更多样化）
  const ethnicityWeights = gender === 'FEMALE' 
    ? ETHNICITY_DISTRIBUTION.map(e => ({ ...e, weight: e.weight * (e.ethnicity === Ethnicity.ASIAN ? 1.3 : 1) }))
    : ETHNICITY_DISTRIBUTION;
  
  const ethnicity = weightedRandom(ethnicityWeights.map(e => ({ item: e.ethnicity, weight: e.weight })));
  const occupation = OCCUPATIONS[Math.floor(Math.random() * OCCUPATIONS.length)];
  const industry = INDUSTRIES[Math.floor(Math.random() * INDUSTRIES.length)];
  
  // 教育水平与年龄相关
  const age = profile.age || 28;
  let educationLevel = "Bachelor's";
  if (age < 23) educationLevel = "High School";
  else if (age < 26) educationLevel = Math.random() > 0.5 ? "Bachelor's" : "Some College";
  else if (age > 35 && Math.random() > 0.7) educationLevel = "Master's";
  else if (age > 40 && Math.random() > 0.85) educationLevel = "PhD";
  
  // 收入范围
  const incomeRanges = ['$30k-50k', '$50k-75k', '$75k-100k', '$100k-150k', '$150k-200k', '$200k+'];
  const incomeRange = incomeRanges[Math.floor(Math.random() * incomeRanges.length)];
  
  // 兴趣标签（3-8个）
  const interests = randomSample(INTERESTS_POOL, 3 + Math.floor(Math.random() * 6));
  const hobbies = randomSample(HOBBIES_POOL, 2 + Math.floor(Math.random() * 4));
  const musicGenres = randomSample(MUSIC_GENRES, 2 + Math.floor(Math.random() * 4));
  const movieGenres = randomSample(MOVIE_GENRES, 2 + Math.floor(Math.random() * 4));
  
  // 在线模式偏好
  const onlinePatterns = Object.values(OnlinePattern);
  const onlinePattern = onlinePatterns[Math.floor(Math.random() * onlinePatterns.length)];
  
  // 人格类型
  const personality = PERSONALITY_TYPES[Math.floor(Math.random() * PERSONALITY_TYPES.length)];
  const behaviorConfig = generateBehaviorConfig(personality);
  
  // 活动级别
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
    hobbies,
    musicGenres,
    movieGenres,
    onlinePattern,
    avgResponseTime: 10 + Math.floor(Math.random() * 120), // 10-130分钟
    maxDailyMatches: 1 + Math.floor(Math.random() * 10),
    behaviorConfig: JSON.stringify(behaviorConfig),
    preferredEthnicities: randomSample(Object.values(Ethnicity), 1 + Math.floor(Math.random() * 4)),
    preferredOccupations: randomSample(OCCUPATIONS, 1 + Math.floor(Math.random() * 5)),
    preferredEducation: randomSample(["High School", "Bachelor's", "Master's", "PhD"], 1 + Math.floor(Math.random() * 3)),
    avatarStyle: ['professional', 'casual', 'artistic'][Math.floor(Math.random() * 3)],
    avatarSource: 'generated',
    isActive: true,
  };
}

async function main() {
  console.log('🤖 开始为数字用户生成BotProfile...');
  
  // 获取所有数字用户
  const botUsers = await prisma.profile.findMany({
    where: {
      user: {
        email: {
          endsWith: '@lokfeel.bot'
        }
      }
    },
    include: {
      user: true
    }
  });
  
  console.log(`找到 ${botUsers.length} 名数字用户`);
  
  let created = 0;
  let skipped = 0;
  let errors = 0;
  
  for (let i = 0; i < botUsers.length; i++) {
    const profile = botUsers[i];
    
    try {
      // 检查是否已存在
      const existing = await prisma.botProfile.findUnique({
        where: { profileId: profile.id }
      });
      
      if (existing) {
        skipped++;
        continue;
      }
      
      const botProfileData = await generateBotProfile(profile);
      
      await prisma.botProfile.create({
        data: botProfileData
      });
      
      created++;
      
      if ((i + 1) % 100 === 0) {
        console.log(`进度: ${i + 1}/${botUsers.length} (创建: ${created}, 跳过: ${skipped})`);
      }
    } catch (error) {
      errors++;
      console.error(`错误处理用户 ${profile.id}:`, error);
    }
  }
  
  console.log('\n✅ BotProfile生成完成!');
  console.log(`总计: ${botUsers.length}`);
  console.log(`创建: ${created}`);
  console.log(`跳过: ${skipped}`);
  console.log(`错误: ${errors}`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
