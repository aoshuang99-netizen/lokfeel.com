/**
 * seed-bot-profiles.ts
 * 
 * Fills BotProfile data for all 3,500 digital users.
 * Reads from female-users.json and male-users.json, maps to database profiles,
 * and generates diverse BotProfile records with ethnicity, occupation, interests,
 * behavior config, and matching preferences.
 * 
 * Usage: npx tsx scripts/seed-bot-profiles.ts
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PrismaClient } = require('../src/generated/index.js');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PrismaPg } = require('@prisma/adapter-pg');

const databaseUrl = process.env.DATABASE_URL || '';
if (!databaseUrl) {
  throw new Error('DATABASE_URL environment variable is required');
}
const adapter = new PrismaPg({ connectionString: databaseUrl.trim() });
const db = new PrismaClient({ adapter });

// ─── Diversity Configuration ────────────────────────────────────────

const ETHNICITY_DISTRIBUTION: Array<{ ethnicity: string; weight: number }> = [
  { ethnicity: 'CAUCASIAN', weight: 35 },
  { ethnicity: 'ASIAN', weight: 25 },
  { ethnicity: 'AFRICAN_AMERICAN', weight: 15 },
  { ethnicity: 'HISPANIC_LATINO', weight: 12 },
  { ethnicity: 'SOUTH_ASIAN', weight: 8 },
  { ethnicity: 'MIDDLE_EASTERN', weight: 5 },
];

const ALL_ETHNICITIES = ETHNICITY_DISTRIBUTION.map(e => e.ethnicity);

const INDUSTRIES = [
  'Technology', 'Healthcare', 'Education', 'Finance', 'Marketing',
  'Legal', 'Creative Arts', 'Engineering', 'Science', 'Real Estate',
  'Hospitality', 'Nonprofit', 'Government', 'Media', 'Retail',
  'Manufacturing', 'Consulting', 'Sports & Fitness', 'Fashion', 'Agriculture',
];

const OCCUPATIONS_BY_INDUSTRY: Record<string, string[]> = {
  'Technology': ['Software Engineer', 'Product Manager', 'Data Scientist', 'UX Designer', 'DevOps Engineer', 'Frontend Developer', 'Backend Developer', 'AI Researcher', 'IT Manager', 'QA Engineer', 'Mobile Developer', 'Systems Architect', 'CTO', 'Technical Lead'],
  'Healthcare': ['Physician', 'Nurse Practitioner', 'Physical Therapist', 'Pharmacist', 'Psychologist', 'Surgeon', 'Dentist', 'Medical Researcher', 'Health Coach', 'Occupational Therapist', 'Radiologist', 'Pediatrician'],
  'Education': ['Teacher', 'Professor', 'School Counselor', 'Librarian', 'Education Consultant', 'Academic Researcher', 'Principal', 'Curriculum Developer', 'ESL Instructor', 'Special Education Teacher'],
  'Finance': ['Financial Analyst', 'Accountant', 'Investment Banker', 'Financial Advisor', 'Actuary', 'Portfolio Manager', 'Risk Analyst', 'Wealth Manager', 'Tax Consultant', 'Compliance Officer'],
  'Marketing': ['Marketing Manager', 'Content Strategist', 'SEO Specialist', 'Social Media Manager', 'Brand Manager', 'Copywriter', 'Growth Hacker', 'Public Relations Manager', 'Digital Marketing Director', 'Event Planner'],
  'Legal': ['Lawyer', 'Paralegal', 'Legal Counsel', 'Compliance Officer', 'Judge', 'Mediator', 'Patent Attorney', 'Corporate Lawyer', 'Human Rights Attorney', 'Legal Analyst'],
  'Creative Arts': ['Graphic Designer', 'Photographer', 'Filmmaker', 'Writer', 'Musician', 'Art Director', 'Animator', 'Interior Designer', 'Architect', 'Fashion Designer', 'Illustrator', 'Creative Director'],
  'Engineering': ['Mechanical Engineer', 'Civil Engineer', 'Electrical Engineer', 'Chemical Engineer', 'Aerospace Engineer', 'Environmental Engineer', 'Biomedical Engineer', 'Structural Engineer', 'Project Engineer'],
  'Science': ['Research Scientist', 'Biologist', 'Chemist', 'Physicist', 'Marine Biologist', 'Environmental Scientist', 'Geologist', 'Neuroscientist', 'Data Analyst', 'Lab Technician'],
  'Real Estate': ['Real Estate Agent', 'Property Manager', 'Real Estate Developer', 'Appraiser', 'Real Estate Investor', 'Mortgage Broker', 'Commercial Agent', 'Interior Stager'],
  'Hospitality': ['Chef', 'Restaurant Manager', 'Hotel Manager', 'Tour Guide', 'Flight Attendant', 'Sommelier', 'Event Coordinator', 'Barista', 'Baker', 'Catering Director'],
  'Nonprofit': ['Program Director', 'Fundraiser', 'Community Organizer', 'Social Worker', 'NGO Manager', 'Volunteer Coordinator', 'Grant Writer', 'Policy Analyst'],
  'Government': ['Policy Advisor', 'Urban Planner', 'Diplomat', 'Military Officer', 'Civil Servant', 'Public Administrator', 'Intelligence Analyst', 'Customs Officer'],
  'Media': ['Journalist', 'Editor', 'News Anchor', 'Podcast Host', 'Documentary Filmmaker', 'News Producer', 'Columnist', 'Broadcast Journalist', 'Media Analyst'],
  'Retail': ['Store Manager', 'E-commerce Manager', 'Buyer', 'Visual Merchandiser', 'Supply Chain Manager', 'Retail Analyst', 'Brand Ambassador'],
  'Manufacturing': ['Production Manager', 'Quality Control Inspector', 'Supply Chain Director', 'Plant Manager', 'Operations Manager', 'Industrial Designer'],
  'Consulting': ['Management Consultant', 'Strategy Consultant', 'Business Analyst', 'HR Consultant', 'IT Consultant', 'Operations Consultant'],
  'Sports & Fitness': ['Personal Trainer', 'Athletic Coach', 'Sports Psychologist', 'Nutritionist', 'Yoga Instructor', 'Physical Education Teacher', 'Sports Agent'],
  'Fashion': ['Fashion Designer', 'Stylist', 'Fashion Buyer', 'Textile Designer', 'Fashion Photographer', 'Boutique Owner', 'Fashion Writer'],
  'Agriculture': ['Agricultural Scientist', 'Farm Manager', 'Agronomist', 'Veterinarian', 'Environmental Conservationist', 'Sustainable Farmer'],
};

const EDUCATION_LEVELS = ["High School", "Associate's", "Bachelor's", "Master's", "PhD", "Professional Degree"];

const INCOME_RANGES = [
  '$30k-50k', '$50k-75k', '$75k-100k', '$100k-150k', '$150k-200k', '$200k+'
];

const MUSIC_GENRES = [
  'rock', 'pop', 'hip-hop', 'r&b', 'jazz', 'electronic', 'classical', 'indie',
  'country', 'folk', 'blues', 'metal', 'punk', 'soul', 'reggae', 'latin',
  'alternative', 'ambient', 'world music', 'k-pop'
];

const MOVIE_GENRES = [
  'thriller', 'romance', 'sci-fi', 'comedy', 'drama', 'horror', 'action',
  'documentary', 'animation', 'fantasy', 'mystery', 'adventure', 'musical',
  'biography', 'noir', 'war', 'western', 'crime', 'family', 'psychological'
];

const ONLINE_PATTERNS = [
  'MORNING', 'AFTERNOON', 'EVENING', 'NIGHT', 'RANDOM', 'WORK_HOURS', 'AFTER_WORK'
] as const;

const ACTIVITY_LEVELS = ['GHOST', 'LOW', 'MEDIUM', 'HIGH', 'FULL'] as const;

const BOT_TYPES = ['SEED', 'SIMULATION', 'ACTIVE'] as const;

const AVATAR_STYLES_MALE = ['professional', 'casual', 'artistic', 'adventurous', 'friendly'];
const AVATAR_STYLES_FEMALE = ['professional', 'casual', 'artistic', 'elegant', 'friendly'];

const PERSONALITY_TYPES = ['explorer', 'selective', 'social', 'passive', 'enthusiastic', 'cautious'] as const;

// ─── Helper Functions ────────────────────────────────────────────────

function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xFFFFFFFF;
    return (s >>> 0) / 0xFFFFFFFF;
  };
}

function pickWeighted<T>(items: Array<{ item: T; weight: number }>, rng: () => number): T {
  const totalWeight = items.reduce((sum, i) => sum + i.weight, 0);
  let r = rng() * totalWeight;
  for (const { item, weight } of items) {
    r -= weight;
    if (r <= 0) return item;
  }
  return items[items.length - 1].item;
}

function pickRandom<T>(arr: T[], rng: () => number, count: number): T[] {
  const shuffled = [...arr].sort(() => rng() - 0.5);
  return shuffled.slice(0, count);
}

function pickRandomOne<T>(arr: readonly T[], rng: () => number): T {
  return arr[Math.floor(rng() * arr.length)];
}

// Map JSON profession to industry
function inferIndustry(profession: string): string {
  const p = profession.toLowerCase();
  if (p.includes('software') || p.includes('developer') || p.includes('engineer') && !p.includes('chemical') && !p.includes('civil') && !p.includes('mechanical') || p.includes('data') || p.includes('product manager') || p.includes('ux') || p.includes('devops') || p.includes('frontend') || p.includes('backend') || p.includes('ai ') || p.includes('cto') || p.includes('tech') || p.includes('it ')) return 'Technology';
  if (p.includes('doctor') || p.includes('nurse') || p.includes('physician') || p.includes('therapist') || p.includes('pharmacist') || p.includes('psychologist') || p.includes('surgeon') || p.includes('dentist') || p.includes('medical') || p.includes('health') || p.includes('nutrition') || p.includes('fitness') || p.includes('yoga')) return 'Healthcare';
  if (p.includes('teacher') || p.includes('professor') || p.includes('tutor') || p.includes('academic') || p.includes('educat') || p.includes('principal') || p.includes('librarian') || p.includes('school') || p.includes('curriculum')) return 'Education';
  if (p.includes('finance') || p.includes('account') || p.includes('bank') || p.includes('invest') || p.includes('actuary') || p.includes('portfolio') || p.includes('wealth') || p.includes('tax') || p.includes('financial')) return 'Finance';
  if (p.includes('market') || p.includes('brand') || p.includes('seo') || p.includes('social media') || p.includes('content') || p.includes('copywriter') || p.includes('pr ') || p.includes('advertis') || p.includes('growth')) return 'Marketing';
  if (p.includes('lawyer') || p.includes('attorney') || p.includes('paralegal') || p.includes('legal') || p.includes('judge') || p.includes('mediator') || p.includes('compliance')) return 'Legal';
  if (p.includes('design') || p.includes('photograph') || p.includes('artist') || p.includes('film') || p.includes('writer') || p.includes('musician') || p.includes('animator') || p.includes('interior') || p.includes('architect') || p.includes('fashion') || p.includes('illustrat') || p.includes('creative')) return 'Creative Arts';
  if (p.includes('engineer') || p.includes('mechanic') || p.includes('civil') || p.includes('electrical') || p.includes('chemical') || p.includes('aerospace') || p.includes('structural') || p.includes('manufactur') || p.includes('production')) return 'Engineering';
  if (p.includes('scientist') || p.includes('biologist') || p.includes('chemist') || p.includes('physicist') || p.includes('research') || p.includes('marine') || p.includes('environmental') || p.includes('geologist') || p.includes('neurosci') || p.includes('lab')) return 'Science';
  if (p.includes('real estate') || p.includes('property') || p.includes('apprais') || p.includes('mortgage')) return 'Real Estate';
  if (p.includes('chef') || p.includes('restaurant') || p.includes('hotel') || p.includes('tour') || p.includes('flight') || p.includes('sommelier') || p.includes('event') || p.includes('barista') || p.includes('baker') || p.includes('hospitality') || p.includes('cater')) return 'Hospitality';
  if (p.includes('social work') || p.includes('nonprofit') || p.includes('fundrais') || p.includes('community') || p.includes('volunteer') || p.includes('ngo') || p.includes('grant')) return 'Nonprofit';
  if (p.includes('policy') || p.includes('diplomat') || p.includes('military') || p.includes('civil serv') || p.includes('government') || p.includes('urban plan') || p.includes('intelligence')) return 'Government';
  if (p.includes('journal') || p.includes('editor') || p.includes('news') || p.includes('podcast') || p.includes('documentary') || p.includes('media') || p.includes('columnist') || p.includes('broadcast')) return 'Media';
  if (p.includes('retail') || p.includes('store') || p.includes('e-commerce') || p.includes('buyer') || p.includes('merchandis') || p.includes('supply chain')) return 'Retail';
  if (p.includes('consult') || p.includes('business analyst') || p.includes('hr ') || p.includes('strategist')) return 'Consulting';
  if (p.includes('sport') || p.includes('coach') || p.includes('athletic') || p.includes('trainer') || p.includes('personal train')) return 'Sports & Fitness';
  if (p.includes('fashion') || p.includes('stylist') || p.includes('textile') || p.includes('boutique')) return 'Fashion';
  if (p.includes('farm') || p.includes('agricult') || p.includes('veterinar') || p.includes('agronomist') || p.includes('conservat')) return 'Agriculture';
  return pickRandomOne(INDUSTRIES, Math.random);
}

// Map JSON interests to music/movie genres
function inferMusicGenres(interests: string[], rng: () => number): string[] {
  const genres: string[] = [];
  const interestLower = interests.map(i => i.toLowerCase());
  
  if (interestLower.some(i => i.includes('music') || i.includes('concert') || i.includes('guitar') || i.includes('piano'))) genres.push(pickRandomOne(['rock', 'indie', 'jazz', 'blues', 'folk'], rng));
  if (interestLower.some(i => i.includes('dance') || i.includes('party') || i.includes('club'))) genres.push(pickRandomOne(['electronic', 'hip-hop', 'pop', 'latin', 'k-pop'], rng));
  if (interestLower.some(i => i.includes('yoga') || i.includes('meditat') || i.includes('mindful'))) genres.push(pickRandomOne(['ambient', 'classical', 'world music', 'soul'], rng));
  if (interestLower.some(i => i.includes('travel') || i.includes('backpack'))) genres.push(pickRandomOne(['world music', 'folk', 'indie', 'reggae'], rng));
  if (interestLower.some(i => i.includes('art') || i.includes('museum') || i.includes('gallery'))) genres.push(pickRandomOne(['classical', 'jazz', 'alternative', 'indie'], rng));
  if (interestLower.some(i => i.includes('gaming') || i.includes('video game') || i.includes('esport'))) genres.push(pickRandomOne(['electronic', 'rock', 'metal', 'alternative'], rng));
  if (interestLower.some(i => i.includes('cook') || i.includes('food') || i.includes('wine'))) genres.push(pickRandomOne(['jazz', 'soul', 'latin', 'folk'], rng));
  
  // Fill to 2-4 genres
  while (genres.length < 2) {
    const g = pickRandomOne(MUSIC_GENRES, rng);
    if (!genres.includes(g)) genres.push(g);
  }
  while (genres.length > 4) genres.pop();
  
  return genres;
}

function inferMovieGenres(interests: string[], rng: () => number): string[] {
  const genres: string[] = [];
  const interestLower = interests.map(i => i.toLowerCase());
  
  if (interestLower.some(i => i.includes('travel') || i.includes('adventure') || i.includes('hiking') || i.includes('camping'))) genres.push(pickRandomOne(['adventure', 'documentary', 'fantasy'], rng));
  if (interestLower.some(i => i.includes('art') || i.includes('book') || i.includes('read') || i.includes('film'))) genres.push(pickRandomOne(['drama', 'documentary', 'biography', 'psychological'], rng));
  if (interestLower.some(i => i.includes('gaming') || i.includes('sci-fi') || i.includes('tech') || i.includes('ai'))) genres.push(pickRandomOne(['sci-fi', 'action', 'thriller', 'animation'], rng));
  if (interestLower.some(i => i.includes('fitness') || i.includes('sport') || i.includes('martial'))) genres.push(pickRandomOne(['action', 'thriller', 'adventure'], rng));
  if (interestLower.some(i => i.includes('yoga') || i.includes('mindful') || i.includes('meditat'))) genres.push(pickRandomOne(['documentary', 'drama', 'biography'], rng));
  if (interestLower.some(i => i.includes('cooking') || i.includes('food') || i.includes('wine'))) genres.push(pickRandomOne(['documentary', 'family', 'comedy'], rng));
  if (interestLower.some(i => i.includes('fashion') || i.includes('beauty') || i.includes('design'))) genres.push(pickRandomOne(['comedy', 'drama', 'romance'], rng));
  if (interestLower.some(i => i.includes('music') || i.includes('concert'))) genres.push(pickRandomOne(['musical', 'documentary', 'drama'], rng));
  
  // Fill to 2-4 genres
  while (genres.length < 2) {
    const g = pickRandomOne(MOVIE_GENRES, rng);
    if (!genres.includes(g)) genres.push(g);
  }
  while (genres.length > 4) genres.pop();
  
  return genres;
}

// Generate behavior config JSON
function generateBehaviorConfig(
  personalityType: string,
  rng: () => number
): string {
  const configs: Record<string, object> = {
    explorer: {
      personalityType: 'explorer',
      matchAcceptanceRate: 0.6 + rng() * 0.25,
      messageInitiationRate: 0.7 + rng() * 0.2,
      responseProbability: 0.8 + rng() * 0.15,
      conversationLength: { min: 5, max: 20 },
      curiosityFactor: 0.8 + rng() * 0.2,
      opennessToNew: 0.9,
    },
    selective: {
      personalityType: 'selective',
      matchAcceptanceRate: 0.25 + rng() * 0.2,
      messageInitiationRate: 0.3 + rng() * 0.2,
      responseProbability: 0.5 + rng() * 0.3,
      conversationLength: { min: 3, max: 15 },
      curiosityFactor: 0.4 + rng() * 0.2,
      opennessToNew: 0.5,
    },
    social: {
      personalityType: 'social',
      matchAcceptanceRate: 0.7 + rng() * 0.2,
      messageInitiationRate: 0.8 + rng() * 0.15,
      responseProbability: 0.85 + rng() * 0.1,
      conversationLength: { min: 8, max: 30 },
      curiosityFactor: 0.7 + rng() * 0.2,
      opennessToNew: 0.8,
    },
    passive: {
      personalityType: 'passive',
      matchAcceptanceRate: 0.4 + rng() * 0.2,
      messageInitiationRate: 0.15 + rng() * 0.15,
      responseProbability: 0.5 + rng() * 0.2,
      conversationLength: { min: 2, max: 10 },
      curiosityFactor: 0.3 + rng() * 0.2,
      opennessToNew: 0.6,
    },
    enthusiastic: {
      personalityType: 'enthusiastic',
      matchAcceptanceRate: 0.75 + rng() * 0.2,
      messageInitiationRate: 0.85 + rng() * 0.1,
      responseProbability: 0.9 + rng() * 0.1,
      conversationLength: { min: 10, max: 40 },
      curiosityFactor: 0.9 + rng() * 0.1,
      opennessToNew: 0.95,
    },
    cautious: {
      personalityType: 'cautious',
      matchAcceptanceRate: 0.2 + rng() * 0.15,
      messageInitiationRate: 0.1 + rng() * 0.15,
      responseProbability: 0.4 + rng() * 0.2,
      conversationLength: { min: 2, max: 8 },
      curiosityFactor: 0.2 + rng() * 0.2,
      opennessToNew: 0.3,
    },
  };
  
  return JSON.stringify(configs[personalityType] || configs.explorer);
}

// Determine education level from age and profession
function inferEducation(profession: string, age: number, rng: () => number): string {
  const p = profession.toLowerCase();
  const needsAdvanced = ['professor', 'scientist', 'research', 'surgeon', 'psychologist', 'lawyer', 'attorney', 'dentist', 'pharmacist', 'architect'];
  
  if (needsAdvanced.some(n => p.includes(n))) {
    return rng() > 0.4 ? 'PhD' : (rng() > 0.5 ? "Master's" : 'Professional Degree');
  }
  
  const needsBachelors = ['engineer', 'developer', 'designer', 'manager', 'analyst', 'consultant', 'therapist', 'teacher', 'accountant', 'director'];
  if (needsBachelors.some(n => p.includes(n))) {
    return rng() > 0.3 ? "Master's" : (rng() > 0.5 ? "Bachelor's" : "Associate's");
  }
  
  // Distribution weighted by age
  if (age < 25) return pickRandomOne(["High School", "Associate's", "Bachelor's"], rng);
  if (age < 30) return pickRandomOne(["Associate's", "Bachelor's", "Master's"], rng);
  if (age < 40) return pickRandomOne(["Bachelor's", "Master's", "PhD"], rng);
  return pickRandomOne(["Bachelor's", "Master's", "PhD", "Professional Degree"], rng);
}

// Determine income from education and age
function inferIncome(education: string, age: number, rng: () => number): string {
  const eduMultiplier: Record<string, number> = {
    'High School': 0.6,
    'Associate\'s': 0.75,
    'Bachelor\'s': 1.0,
    'Master\'s': 1.3,
    'PhD': 1.4,
    'Professional Degree': 1.5,
  };
  
  const ageMultiplier = age < 25 ? 0.6 : age < 30 ? 0.8 : age < 40 ? 1.0 : age < 50 ? 1.2 : 1.3;
  const score = (eduMultiplier[education] || 1) * ageMultiplier * (0.7 + rng() * 0.6);
  
  if (score < 0.5) return '$30k-50k';
  if (score < 0.8) return '$50k-75k';
  if (score < 1.1) return '$75k-100k';
  if (score < 1.4) return '$100k-150k';
  if (score < 1.8) return '$150k-200k';
  return '$200k+';
}

// Determine bot type based on profile completeness and engagementScore
function determineBotType(engagementScore: number, rng: () => number): string {
  // High engagement = ACTIVE, medium = SIMULATION, low = SEED
  if (engagementScore >= 75) return 'ACTIVE';
  if (engagementScore >= 50) return 'SIMULATION';
  return rng() > 0.5 ? 'SEED' : 'SIMULATION';
}

// Determine activity level from bot type and engagement
function determineActivityLevel(botType: string, engagementScore: number, rng: () => number): string {
  const weights: Record<string, Record<string, number>> = {
    ACTIVE: { HIGH: 40, FULL: 25, MEDIUM: 25, LOW: 8, GHOST: 2 },
    SIMULATION: { MEDIUM: 35, LOW: 30, HIGH: 15, GHOST: 15, FULL: 5 },
    SEED: { LOW: 35, GHOST: 30, MEDIUM: 20, HIGH: 10, FULL: 5 },
  };
  
  const levelWeights = weights[botType] || weights.SEED;
  const items = Object.entries(levelWeights).map(([level, weight]) => ({ item: level, weight }));
  return pickWeighted(items, rng);
}

// ─── Interface Types ────────────────────────────────────────────────

interface JsonUser {
  id: string;
  gender: string;
  profile: {
    name: string;
    firstName: string;
    lastName: string;
    age: number;
    ageGroup: string;
    birthDate: string;
    city: string;
    country: string;
    region: string;
    profession: string;
    bio: string;
    avatarType: string;
  };
  personality: {
    attachmentStyle: string;
    communicationStyle: string;
    conflictStyle: string;
    loveLanguages: string;
    lifePriorities: string[];
    personalityTraits: string[];
  };
  preferences: {
    relationshipGoal: string;
    ageRangePreference: { min: number; max: number };
    locationPreference: string[];
    mustHaveInterests: string[];
    dealbreakers: string[];
    relationshipStructurePreference: string;
  };
  interests: string[];
  lifestyle: {
    zodiacSign: string;
    exerciseFrequency: string;
    dietPreference: string;
    drinkingHabit: string;
    smokingHabit: string;
    hasPets: boolean;
    hasChildren: boolean;
    wantsChildren: string;
    livingSituation: string;
  };
  dealbreakers: string[];
  metadata: {
    generatedAt: string;
    personaComplexity: number;
    engagementScore: number;
    compatibilityFactors: number;
  };
}

interface DbProfile {
  id: string;
  userId: string;
  displayName: string;
  gender: string;
  user: {
    email: string;
  };
}

// ─── Main Seeding Logic ─────────────────────────────────────────────

async function main() {
  console.log('🌱 BotProfile Seeding Script');
  console.log('═'.repeat(50));
  
  // 1. Load JSON data
  const femaleData = JSON.parse(fs.readFileSync(path.join(process.cwd(), '..', 'female-users.json'), 'utf-8'));
  const maleData = JSON.parse(fs.readFileSync(path.join(process.cwd(), '..', 'male-users.json'), 'utf-8'));
  
  const allUsers: JsonUser[] = [...femaleData.users, ...maleData.users];
  console.log(`📋 Loaded ${allUsers.length} users from JSON (${femaleData.users.length}F + ${maleData.users.length}M)`);
  
  // 2. Get all bot profiles from DB
  const botProfiles: DbProfile[] = await db.profile.findMany({
    where: {
      user: { isBot: true },
      botProfile: null, // Only profiles without existing BotProfile
    },
    select: {
      id: true,
      userId: true,
      displayName: true,
      gender: true,
      user: { select: { email: true } },
    },
  });
  
  console.log(`📊 Found ${botProfiles.length} bot profiles needing BotProfile`);
  
  if (botProfiles.length === 0) {
    console.log('✅ All bot profiles already have BotProfile data. Nothing to seed.');
    await db.$disconnect();
    return;
  }
  
  // 3. Build email → JSON user mapping
  const emailToUser = new Map<string, JsonUser>();
  for (const u of allUsers) {
    const emailId = u.id.toLowerCase().replace('f', 'bot-f').replace('m', 'bot-m');
    // Map: F00001 → bot-f00001@lokfeel.bot, M00001 → bot-m00001@lokfeel.bot
    const email = `bot-${u.id.toLowerCase()}@lokfeel.bot`;
    emailToUser.set(email, u);
  }
  
  // Verify mapping
  const matched = botProfiles.filter(p => emailToUser.has(p.user.email));
  const unmatched = botProfiles.filter(p => !emailToUser.has(p.user.email));
  console.log(`🔗 Matched: ${matched.length}, Unmatched: ${unmatched.length}`);
  
  if (unmatched.length > 0 && unmatched.length <= 10) {
    console.log('  Unmatched emails:', unmatched.map(p => p.user.email));
  } else if (unmatched.length > 10) {
    console.log('  First 10 unmatched:', unmatched.slice(0, 10).map(p => p.user.email));
  }
  
  // 4. Generate BotProfile data
  console.log('\n🔧 Generating BotProfile data...');
  
  const BATCH_SIZE = 100;
  let created = 0;
  let errors = 0;
  const ethnicityStats: Record<string, number> = {};
  const industryStats: Record<string, number> = {};
  const botTypeStats: Record<string, number> = {};
  const activityStats: Record<string, number> = {};
  
  for (let i = 0; i < matched.length; i += BATCH_SIZE) {
    const batch = matched.slice(i, i + BATCH_SIZE);
    
    const createData = batch.map((profile, _idx) => {
      const globalIdx = i + _idx;
      const email = profile.user.email;
      const userData = emailToUser.get(email)!;
      
      // Deterministic random based on user ID
      const idNum = parseInt(userData.id.replace(/\D/g, ''), 10);
      const rng = seededRandom(idNum * 7 + 42);
      
      const gender = profile.gender;
      const age = userData.profile.age;
      const profession = userData.profile.profession;
      const interests = userData.interests || [];
      const engagementScore = userData.metadata?.engagementScore || 50;
      
      // Ethnicity (weighted distribution)
      const ethnicityWeights = ETHNICITY_DISTRIBUTION.map(e => ({ item: e.ethnicity, weight: e.weight }));
      const ethnicity = pickWeighted(ethnicityWeights, rng);
      
      // Industry (infer from profession, fallback to random)
      const industry = inferIndustry(profession);
      
      // Occupation (use from JSON)
      const occupation = profession;
      
      // Education & Income
      const educationLevel = inferEducation(profession, age, rng);
      const incomeRange = inferIncome(educationLevel, age, rng);
      
      // Interests (from JSON, ensure 3-8)
      const userInterests = interests.length >= 3 ? interests.slice(0, 8) : [...interests, ...pickRandom(
        ['Travel', 'Cooking', 'Photography', 'Reading', 'Music', 'Gaming', 'Fitness', 'Art', 'Movies', 'Nature', 'Technology', 'Sports', 'Writing', 'Dancing', 'Volunteering', 'Gardening', 'Coffee', 'Wine', 'Hiking', 'Cycling'],
        rng, 8 - interests.length
      )];
      
      // Hobbies (subset of interests, 2-4)
      const hobbies = pickRandom(userInterests, rng, Math.min(Math.max(2, Math.floor(rng() * 3) + 2), userInterests.length));
      
      // Music & Movie genres
      const musicGenres = inferMusicGenres(interests, rng);
      const movieGenres = inferMovieGenres(interests, rng);
      
      // Bot type & activity
      const botType = determineBotType(engagementScore, rng);
      const activityLevel = determineActivityLevel(botType, engagementScore, rng);
      
      // Online pattern
      const onlinePattern = pickRandomOne(ONLINE_PATTERNS, rng);
      
      // Response time (based on activity)
      const baseResponseTime = activityLevel === 'FULL' ? 5 : activityLevel === 'HIGH' ? 15 : activityLevel === 'MEDIUM' ? 30 : activityLevel === 'LOW' ? 60 : 120;
      const avgResponseTime = baseResponseTime + Math.floor(rng() * baseResponseTime);
      
      // Max daily matches
      const maxDailyMatches = botType === 'ACTIVE' ? Math.floor(rng() * 5) + 3 : botType === 'SIMULATION' ? Math.floor(rng() * 3) + 1 : Math.floor(rng() * 3) + 1;
      
      // Personality type
      const personalityType = pickRandomOne(PERSONALITY_TYPES, rng);
      
      // Behavior config
      const behaviorConfig = generateBehaviorConfig(personalityType, rng);
      
      // Preferred ethnicities (2-4, including own)
      const preferredEthnicities = [ethnicity];
      const otherEthnicities = ALL_ETHNICITIES.filter(e => e !== ethnicity);
      preferredEthnicities.push(...pickRandom(otherEthnicities, rng, Math.floor(rng() * 3) + 1));
      
      // Preferred occupations (2-3 from related industries)
      const preferredOccupations = pickRandom(
        (OCCUPATIONS_BY_INDUSTRY[industry] || ['Software Engineer', 'Designer', 'Manager']),
        rng, Math.floor(rng() * 2) + 2
      );
      
      // Preferred education
      const eduOrder = EDUCATION_LEVELS.indexOf(educationLevel);
      const preferredEducation = EDUCATION_LEVELS.filter((_, idx) => Math.abs(idx - eduOrder) <= 2);
      
      // Avatar style
      const avatarStyle = gender === 'MALE' 
        ? pickRandomOne(AVATAR_STYLES_MALE, rng)
        : pickRandomOne(AVATAR_STYLES_FEMALE, rng);
      
      // Avatar source
      const avatarSource = gender === 'FEMALE' ? 'ai_avatar' : (rng() > 0.5 ? 'generated' : 'ai_avatar');
      
      // Initial engagement score from metadata
      const initialEngagement = Math.min(100, Math.max(0, engagementScore));
      
      // Track stats
      ethnicityStats[ethnicity] = (ethnicityStats[ethnicity] || 0) + 1;
      industryStats[industry] = (industryStats[industry] || 0) + 1;
      botTypeStats[botType] = (botTypeStats[botType] || 0) + 1;
      activityStats[activityLevel] = (activityStats[activityLevel] || 0) + 1;
      
      return {
        profileId: profile.id,
        botType,
        activityLevel,
        ethnicity,
        occupation,
        industry,
        educationLevel,
        incomeRange,
        interests: userInterests,
        hobbies,
        musicGenres,
        movieGenres,
        onlinePattern,
        avgResponseTime,
        maxDailyMatches,
        behaviorConfig,
        preferredEthnicities,
        preferredOccupations,
        preferredEducation,
        avatarStyle,
        avatarSource,
        isActive: true,
        lastActiveAt: new Date(Date.now() - Math.floor(rng() * 7 * 24 * 60 * 60 * 1000)),
        avgEngagementScore: initialEngagement,
      };
    });
    
    // 5. Insert batch
    try {
      const result = await db.botProfile.createMany({
        data: createData,
        skipDuplicates: true,
      });
      created += result.count;
      process.stdout.write(`\r  ✅ Created ${created}/${matched.length} BotProfiles (${Math.round(created / matched.length * 100)}%)`);
    } catch (error: any) {
      errors += batch.length;
      console.error(`\n  ❌ Batch error at ${i}:`, error.message);
    }
  }
  
  console.log('\n');
  console.log('═'.repeat(50));
  console.log(`\n📊 Final Stats:`);
  console.log(`  Total matched profiles: ${matched.length}`);
  console.log(`  Successfully created: ${created}`);
  console.log(`  Errors: ${errors}`);
  console.log(`  Unmatched (skipped): ${unmatched.length}`);
  
  console.log(`\n🌍 Ethnicity Distribution:`);
  for (const [e, c] of Object.entries(ethnicityStats).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${e}: ${c} (${(c / created * 100).toFixed(1)}%)`);
  }
  
  console.log(`\n💼 Top 10 Industries:`);
  for (const [ind, c] of Object.entries(industryStats).sort((a, b) => b[1] - a[1]).slice(0, 10)) {
    console.log(`  ${ind}: ${c}`);
  }
  
  console.log(`\n🤖 Bot Types:`);
  for (const [t, c] of Object.entries(botTypeStats).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${t}: ${c} (${(c / created * 100).toFixed(1)}%)`);
  }
  
  console.log(`\n📈 Activity Levels:`);
  for (const [l, c] of Object.entries(activityStats).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${l}: ${c} (${(c / created * 100).toFixed(1)}%)`);
  }
  
  // 6. Verify final count
  const finalCount = await db.botProfile.count();
  const linkedCount = await db.profile.count({
    where: { botProfile: { id: { not: undefined } } }
  });
  console.log(`\n✅ Total BotProfiles in DB: ${finalCount}`);
  console.log(`✅ Profiles with BotProfile: ${linkedCount}`);
  
  console.log('\n🎉 BotProfile seeding complete!');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
