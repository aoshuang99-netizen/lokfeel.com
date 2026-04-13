/**
 * LokFeel Matching Engine Training Data Preparation
 * 
 * 为匹配引擎准备训练数据：
 * - 导出成功的匹配案例
 * - 分析用户偏好和兼容性模式
 * - 生成训练数据集用于ML模型
 * 
 * Usage: npx ts-node scripts/matching-engine-training.ts
 */

import { PrismaClient } from '../src/generated';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

// Training data configuration
const CONFIG = {
  OUTPUT_DIR: './training-data',
  MIN_MATCH_SCORE: 60,
  TRAIN_TEST_SPLIT: 0.8,
};

/**
 * Calculate compatibility features between two profiles
 */
function calculateCompatibilityFeatures(profileA: any, profileB: any) {
  const features: Record<string, number> = {};

  // 1. Age compatibility (0-1)
  const ageDiff = Math.abs(profileA.age - profileB.age);
  features.ageCompatibility = Math.max(0, 1 - ageDiff / 20);

  // 2. Attachment style compatibility
  const attachmentCompatMap: Record<string, Record<string, number>> = {
    'Secure': { 'Secure': 1.0, 'Anxious-Preoccupied': 0.7, 'Dismissive-Avoidant': 0.7, 'Fearful-Avoidant': 0.6 },
    'Anxious-Preoccupied': { 'Secure': 0.7, 'Anxious-Preoccupied': 0.5, 'Dismissive-Avoidant': 0.3, 'Fearful-Avoidant': 0.4 },
    'Dismissive-Avoidant': { 'Secure': 0.7, 'Anxious-Preoccupied': 0.3, 'Dismissive-Avoidant': 0.5, 'Fearful-Avoidant': 0.4 },
    'Fearful-Avoidant': { 'Secure': 0.6, 'Anxious-Preoccupied': 0.4, 'Dismissive-Avoidant': 0.4, 'Fearful-Avoidant': 0.3 },
  };
  features.attachmentCompatibility = attachmentCompatMap[profileA.attachmentStyle]?.[profileB.attachmentStyle] || 0.5;

  // 3. Communication style compatibility
  const commStyleScores: Record<string, number> = { 'Direct': 0.8, 'Reflective': 0.7, 'Expressive': 0.9, 'Analytical': 0.6 };
  features.communicationCompatibility = (
    (commStyleScores[profileA.communicationStyle] || 0.5) +
    (commStyleScores[profileB.communicationStyle] || 0.5)
  ) / 2;

  // 4. Conflict resolution compatibility
  const conflictScores: Record<string, number> = { 'Collaborative': 1.0, 'Compromising': 0.9, 'Accommodating': 0.7, 'Competing': 0.3, 'Avoiding': 0.4 };
  features.conflictCompatibility = (
    (conflictScores[profileA.conflictResolution] || 0.5) +
    (conflictScores[profileB.conflictResolution] || 0.5)
  ) / 2;

  // 5. Life priorities overlap
  const prioritiesA = JSON.parse(profileA.lifePriorities || '[]');
  const prioritiesB = JSON.parse(profileB.lifePriorities || '[]');
  const commonPriorities = prioritiesA.filter((p: string) => prioritiesB.includes(p));
  features.priorityOverlap = commonPriorities.length / Math.max(prioritiesA.length, prioritiesB.length, 1);

  // 6. Love language compatibility
  features.loveLanguageMatch = profileA.loveLanguage === profileB.loveLanguage ? 1.0 : 0.5;

  // 7. Relationship goal alignment
  features.goalAlignment = profileA.relationshipGoal === profileB.relationshipGoal ? 1.0 : 0.6;

  // 8. Location preference
  features.locationMatch = profileA.preferredLocation === profileB.city ? 1.0 : 0.3;

  return features;
}

/**
 * Export successful matches as training data
 */
async function exportSuccessfulMatches() {
  console.log('📊 Exporting successful matches...');

  const acceptedMatches = await prisma.match.findMany({
    where: { status: 'ACCEPTED' },
    include: {
      sender: { include: { profile: true } },
      receiver: { include: { profile: true } },
    },
  });

  const trainingData = acceptedMatches.map(match => {
    const senderProfile = match.sender.profile;
    const receiverProfile = match.receiver.profile;

    if (!senderProfile || !receiverProfile) return null;

    const features = calculateCompatibilityFeatures(senderProfile, receiverProfile);

    return {
      matchId: match.id,
      matchScore: match.matchScore,
      features,
      sender: {
        id: match.senderId,
        gender: senderProfile.gender,
        age: senderProfile.age,
        attachmentStyle: senderProfile.attachmentStyle,
        communicationStyle: senderProfile.communicationStyle,
        isBot: match.sender.isBot,
      },
      receiver: {
        id: match.receiverId,
        gender: receiverProfile.gender,
        age: receiverProfile.age,
        attachmentStyle: receiverProfile.attachmentStyle,
        communicationStyle: receiverProfile.communicationStyle,
        isBot: match.receiver.isBot,
      },
      outcome: 1, // Accepted
    };
  }).filter(Boolean);

  // Save to file
  const outputPath = path.join(CONFIG.OUTPUT_DIR, 'successful-matches.json');
  fs.writeFileSync(outputPath, JSON.stringify(trainingData, null, 2));

  console.log(`  ✅ Exported ${trainingData.length} successful matches to ${outputPath}`);
  return trainingData;
}

/**
 * Export rejected matches for negative training examples
 */
async function exportRejectedMatches() {
  console.log('📊 Exporting rejected matches...');

  const rejectedMatches = await prisma.match.findMany({
    where: { status: 'REJECTED' },
    include: {
      sender: { include: { profile: true } },
      receiver: { include: { profile: true } },
    },
  });

  const trainingData = rejectedMatches.map(match => {
    const senderProfile = match.sender.profile;
    const receiverProfile = match.receiver.profile;

    if (!senderProfile || !receiverProfile) return null;

    const features = calculateCompatibilityFeatures(senderProfile, receiverProfile);

    return {
      matchId: match.id,
      matchScore: match.matchScore,
      features,
      sender: {
        id: match.senderId,
        gender: senderProfile.gender,
        age: senderProfile.age,
        attachmentStyle: senderProfile.attachmentStyle,
        isBot: match.sender.isBot,
      },
      receiver: {
        id: match.receiverId,
        gender: receiverProfile.gender,
        age: receiverProfile.age,
        attachmentStyle: receiverProfile.attachmentStyle,
        isBot: match.receiver.isBot,
      },
      outcome: 0, // Rejected
    };
  }).filter(Boolean);

  const outputPath = path.join(CONFIG.OUTPUT_DIR, 'rejected-matches.json');
  fs.writeFileSync(outputPath, JSON.stringify(trainingData, null, 2));

  console.log(`  ✅ Exported ${trainingData.length} rejected matches to ${outputPath}`);
  return trainingData;
}

/**
 * Generate comprehensive training dataset
 */
async function generateTrainingDataset() {
  console.log('📊 Generating comprehensive training dataset...');

  const [successful, rejected] = await Promise.all([
    exportSuccessfulMatches(),
    exportRejectedMatches(),
  ]);

  // Combine and shuffle
  const allData = [...successful, ...rejected].sort(() => Math.random() - 0.5);

  // Split into train/test
  const splitIndex = Math.floor(allData.length * CONFIG.TRAIN_TEST_SPLIT);
  const trainData = allData.slice(0, splitIndex);
  const testData = allData.slice(splitIndex);

  // Save datasets
  fs.writeFileSync(
    path.join(CONFIG.OUTPUT_DIR, 'train.json'),
    JSON.stringify(trainData, null, 2)
  );
  fs.writeFileSync(
    path.join(CONFIG.OUTPUT_DIR, 'test.json'),
    JSON.stringify(testData, null, 2)
  );

  console.log(`\n✅ Training Dataset Generated!`);
  console.log(`  📈 Total samples: ${allData.length}`);
  console.log(`  🎓 Training set: ${trainData.length}`);
  console.log(`  🧪 Test set: ${testData.length}`);
  console.log(`  ✅ Success rate: ${(successful.length / allData.length * 100).toFixed(1)}%`);
}

/**
 * Export user preference patterns
 */
async function exportPreferencePatterns() {
  console.log('📊 Analyzing preference patterns...');

  const profiles = await prisma.profile.findMany({
    include: { user: { select: { isBot: true } } },
  });

  const patterns = {
    attachmentStyleDistribution: {} as Record<string, number>,
    communicationStyleDistribution: {} as Record<string, number>,
    relationshipGoalDistribution: {} as Record<string, number>,
    ageRangePreferences: [] as number[],
    locationPreferences: {} as Record<string, number>,
  };

  profiles.forEach(profile => {
    // Attachment styles
    patterns.attachmentStyleDistribution[profile.attachmentStyle || 'Unknown'] = 
      (patterns.attachmentStyleDistribution[profile.attachmentStyle || 'Unknown'] || 0) + 1;

    // Communication styles
    patterns.communicationStyleDistribution[profile.communicationStyle || 'Unknown'] = 
      (patterns.communicationStyleDistribution[profile.communicationStyle || 'Unknown'] || 0) + 1;

    // Relationship goals
    patterns.relationshipGoalDistribution[profile.relationshipGoal || 'Unknown'] = 
      (patterns.relationshipGoalDistribution[profile.relationshipGoal || 'Unknown'] || 0) + 1;

    // Age preferences
    if (profile.preferredAgeMin && profile.preferredAgeMax) {
      patterns.ageRangePreferences.push(profile.preferredAgeMax - profile.preferredAgeMin);
    }

    // Location preferences
    if (profile.preferredLocation) {
      patterns.locationPreferences[profile.preferredLocation] = 
        (patterns.locationPreferences[profile.preferredLocation] || 0) + 1;
    }
  });

  // Save patterns
  fs.writeFileSync(
    path.join(CONFIG.OUTPUT_DIR, 'preference-patterns.json'),
    JSON.stringify(patterns, null, 2)
  );

  console.log(`  ✅ Exported preference patterns`);
  console.log(`  📊 Analyzed ${profiles.length} profiles`);
}

/**
 * Main function
 */
async function main() {
  console.log('🎯 LokFeel Matching Engine Training Data Preparation');
  console.log('=====================================================\n');

  try {
    // Create output directory
    if (!fs.existsSync(CONFIG.OUTPUT_DIR)) {
      fs.mkdirSync(CONFIG.OUTPUT_DIR, { recursive: true });
    }

    // Generate all training datasets
    await generateTrainingDataset();
    await exportPreferencePatterns();

    console.log('\n✅ All training data prepared!');
    console.log(`📁 Output directory: ${CONFIG.OUTPUT_DIR}`);
    console.log('\nFiles generated:');
    console.log('  - successful-matches.json');
    console.log('  - rejected-matches.json');
    console.log('  - train.json');
    console.log('  - test.json');
    console.log('  - preference-patterns.json');

  } catch (error) {
    console.error('\n❌ Failed to generate training data:', error);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the script
main();
